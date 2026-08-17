import {
  buildSessionContext,
  type CompactionResult,
  type ExtensionAPI,
  type ExtensionContext,
  type SessionBeforeCompactEvent,
  type TurnEndEvent,
} from "@earendil-works/pi-coding-agent";
import { uuidv7 } from "@earendil-works/pi-agent-core";
import { Type, type Static } from "typebox";

import {
  findFirstKeptEntryId,
  runCheckpointPasses,
  selectCheckpointModel,
  serializeCheckpointContext,
  sumUsage,
  type CheckpointFields,
  type CompletionFunction,
  type Usage,
} from "../src/checkpoint-core.ts";

const TOOL_NAME = "checkpoint_context";
const RECOVERY_COMMAND = "checkpoint_context_recover";
const CHECKPOINT_DETAILS_VERSION = 1;

const CheckpointParameters = Type.Object({
  stage: Type.String({ description: "Current project or task stage." }),
  status: Type.String({ description: "Current status and where work stopped." }),
  completed: Type.Array(Type.String(), { description: "Steps completed so far." }),
  incomplete: Type.Array(Type.String(), { description: "Previous steps that remain incomplete." }),
  nextActions: Type.Array(Type.String(), { description: "Immediate next actions." }),
  notes: Type.String({ description: "Additional facts, blockers, decisions, or open questions." }),
});

type CheckpointParameters = Static<typeof CheckpointParameters>;

interface CheckpointDetails {
  version: number;
  toolCallId: string;
  summary: string;
  fields: CheckpointFields;
  usage: Usage;
}

interface CheckpointState {
  toolCallId: string;
  summary: string;
  fields: CheckpointFields;
  usage: Usage;
  details: CheckpointDetails;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function normalizeFields(params: CheckpointParameters): CheckpointFields {
  return {
    stage: params.stage,
    status: params.status,
    completed: [...params.completed],
    incomplete: [...params.incomplete],
    nextActions: [...params.nextActions],
    notes: params.notes,
  };
}

function resolveComplete(modelRegistry: ExtensionContext["modelRegistry"]): CompletionFunction {
  // Keep the runtime check at this call boundary for installations with stale declarations or runtimes.
  const complete = (modelRegistry as unknown as { complete?: CompletionFunction }).complete;
  if (typeof complete !== "function") {
    throw new Error(
      "checkpoint_context requires ctx.modelRegistry.complete; the installed Pi runtime does not expose this API (use a newer Pi runtime).",
    );
  }
  return complete.bind(modelRegistry);
}

function checkpointResult(state: CheckpointState): {
  content: [{ type: "text"; text: string }];
  details: CheckpointDetails;
  usage: Usage;
  terminate: true;
} {
  return {
    content: [{ type: "text", text: state.summary }],
    details: state.details,
    usage: state.usage,
    terminate: true,
  };
}

export default function contextCheckpoint(pi: ExtensionAPI): void {
  let waitingForTurnEnd: CheckpointState | undefined;
  let compactionInFlight: CheckpointState | undefined;
  let pendingRecovery: CheckpointState | undefined;
  let recoveryInFlight = false;
  let generationInFlight = false;

  const notify = (ctx: ExtensionContext, message: string, type: "info" | "warning" | "error" = "info") => {
    if (ctx.hasUI) ctx.ui.notify(message, type);
  };

  const queueRecovery = (ctx: ExtensionContext, checkpoint: CheckpointState, reason: unknown): void => {
    if (
      pendingRecovery ||
      !compactionInFlight ||
      compactionInFlight.toolCallId !== checkpoint.toolCallId ||
      ctx.signal?.aborted
    ) {
      return;
    }

    compactionInFlight = undefined;
    pendingRecovery = checkpoint;
    notify(ctx, `Checkpoint compaction failed (${errorMessage(reason)}). Run /${RECOVERY_COMMAND} to start a replacement session.`, "warning");
  };

  pi.registerCommand(RECOVERY_COMMAND, {
    description: "Recover from a failed checkpoint compaction in a replacement session",
    handler: async (_args, ctx) => {
      const pending = pendingRecovery;
      if (!pending || recoveryInFlight) return;
      if (ctx.signal?.aborted) {
        notify(ctx, "Checkpoint replacement recovery was aborted.", "error");
        return;
      }
      recoveryInFlight = true;

      // Keep these plain values in the command closure before replacement tears down this extension instance.
      const summary = String(pending.summary);
      const parentSession = ctx.sessionManager.getSessionFile();
      notify(ctx, "Starting checkpoint replacement recovery.", "warning");
      try {
        const result = await ctx.newSession({
          parentSession,
          setup: async (sessionManager) => {
            sessionManager.appendMessage({
              role: "user",
              content: summary,
              timestamp: Date.now(),
            });
          },
          withSession: async (replacementCtx) => {
            notify(replacementCtx, "Started a replacement session seeded with the final checkpoint.", "warning");
          },
        });
        if (result.cancelled) {
          // The original context may have been invalidated even when replacement is cancelled.
          console.error("Checkpoint replacement session was cancelled; recovery can be retried.");
        } else {
          pendingRecovery = undefined;
        }
      } catch (error) {
        // Do not use the original context here: newSession may have replaced or torn down it.
        console.error(`Checkpoint replacement session failed: ${errorMessage(error)}`);
      } finally {
        recoveryInFlight = false;
      }
    },
  });

  pi.on("session_start", async (_event, _ctx) => {
    waitingForTurnEnd = undefined;
    compactionInFlight = undefined;
    pendingRecovery = undefined;
    recoveryInFlight = false;
    generationInFlight = false;
  });

  pi.registerTool({
    name: TOOL_NAME,
    label: "Checkpoint Context",
    description:
      "Create a durable engineering checkpoint from the active conversation and explicit progress fields, then stop this turn so Pi can compact around it.",
    promptSnippet: "Capture a durable engineering checkpoint before a phase boundary or context compaction",
    promptGuidelines: [
      "Use checkpoint_context only when a durable phase checkpoint is needed, and provide concrete completed, incomplete, nextActions, and notes fields.",
    ],
    executionMode: "sequential",
    parameters: CheckpointParameters,
    async execute(
      toolCallId: string,
      params: CheckpointParameters,
      signal: AbortSignal | undefined,
      _onUpdate: unknown,
      ctx: ExtensionContext,
    ) {
      if (generationInFlight || waitingForTurnEnd || compactionInFlight || pendingRecovery || recoveryInFlight) {
        throw new Error("checkpoint_context is already generating or compacting a checkpoint.");
      }
      generationInFlight = true;
      try {
        const model = selectCheckpointModel(
          ctx.model,
          process.env.PI_CHECKPOINT_MODEL,
          (provider, modelId) => ctx.modelRegistry.find(provider, modelId),
          (candidate) => ctx.modelRegistry.hasConfiguredAuth(candidate),
        );
        const complete = resolveComplete(ctx.modelRegistry);
        const sessionContext = buildSessionContext(ctx.sessionManager.getBranch());
        const serializedConversation = serializeCheckpointContext(sessionContext.messages);
        const fields = normalizeFields(params);

        // runCheckpointPasses makes exactly three explicit, sequential calls: draft, independent review, final synthesis.
        const passes = await runCheckpointPasses(
          complete,
          model,
          fields,
          serializedConversation,
          signal,
          uuidv7,
        );

        const combinedUsage = sumUsage([passes.draft.usage, passes.review.usage, passes.final.usage]);
        const state: CheckpointState = {
          toolCallId,
          summary: passes.final.text,
          fields,
          usage: combinedUsage,
          details: {
            version: CHECKPOINT_DETAILS_VERSION,
            toolCallId,
            summary: passes.final.text,
            fields,
            usage: combinedUsage,
          },
        };
        waitingForTurnEnd = state;
        return checkpointResult(state);
      } finally {
        generationInFlight = false;
      }
    },
  });

  pi.on("turn_end", async (event: TurnEndEvent, ctx) => {
    const checkpoint = waitingForTurnEnd;
    if (!checkpoint) return;
    const persisted = event.toolResults.some(
      (result) => result.toolName === TOOL_NAME && result.toolCallId === checkpoint.toolCallId,
    );
    if (!persisted) return;

    waitingForTurnEnd = undefined;
    compactionInFlight = checkpoint;
    try {
      ctx.compact({
        onComplete: () => {
          if (compactionInFlight?.toolCallId === checkpoint.toolCallId) compactionInFlight = undefined;
        },
        onError: (error) => queueRecovery(ctx, checkpoint, error),
      });
    } catch (error) {
      queueRecovery(ctx, checkpoint, error);
    }
  });

  pi.on("session_before_compact", async (event: SessionBeforeCompactEvent, ctx) => {
    const checkpoint = compactionInFlight;
    if (!checkpoint) return;
    if (event.signal.aborted) {
      compactionInFlight = undefined;
      return { cancel: true };
    }

    const branch = ctx.sessionManager.getBranch();
    const firstKeptEntryId = findFirstKeptEntryId(
      branch,
      checkpoint.toolCallId,
      event.preparation.firstKeptEntryId,
    );
    const compaction = {
      summary: checkpoint.summary,
      firstKeptEntryId,
      tokensBefore: event.preparation.tokensBefore,
      usage: checkpoint.usage,
      details: checkpoint.details,
    } as CompactionResult<CheckpointDetails> & { usage: Usage };
    return { compaction };
  });
}
