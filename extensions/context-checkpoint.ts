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
const FALLBACK_COMMAND = "checkpoint_context_internal_fallback";
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
  // Pi 0.74 does not declare this method; keep the compatibility assertion at this call boundary only.
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
  let fallbackCheckpoint: CheckpointState | undefined;
  let fallbackQueued = false;
  let generationInFlight = false;

  const notify = (ctx: ExtensionContext, message: string, type: "info" | "warning" | "error" = "info") => {
    if (ctx.hasUI) ctx.ui.notify(message, type);
  };

  const queueFallback = (ctx: ExtensionContext, checkpoint: CheckpointState, reason: unknown): void => {
    if (
      fallbackQueued ||
      fallbackCheckpoint ||
      !compactionInFlight ||
      compactionInFlight.toolCallId !== checkpoint.toolCallId ||
      ctx.signal?.aborted
    ) {
      return;
    }

    compactionInFlight = undefined;
    fallbackCheckpoint = checkpoint;
    fallbackQueued = true;
    try {
      pi.sendUserMessage(`/${FALLBACK_COMMAND}`, { deliverAs: "followUp" });
    } catch (error) {
      fallbackCheckpoint = undefined;
      fallbackQueued = false;
      notify(ctx, `Checkpoint compaction failed and fallback could not be queued: ${errorMessage(error)}`, "error");
      return;
    }
    notify(ctx, `Checkpoint compaction failed; queued a replacement session fallback (${errorMessage(reason)}).`, "warning");
  };

  pi.registerCommand(FALLBACK_COMMAND, {
    description: "Internal checkpoint recovery command",
    handler: async (_args, ctx) => {
      const pending = fallbackCheckpoint;
      fallbackCheckpoint = undefined;
      fallbackQueued = false;
      if (!pending) return;
      if (ctx.signal?.aborted) {
        notify(ctx, "Checkpoint replacement fallback was aborted.", "error");
        return;
      }

      // Keep these plain values in the command closure before replacement tears down this extension instance.
      const summary = String(pending.summary);
      const parentSession = ctx.sessionManager.getSessionFile();
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
        if (result.cancelled) notify(ctx, "Checkpoint replacement session was cancelled.", "error");
      } catch (error) {
        notify(ctx, `Checkpoint replacement session failed: ${errorMessage(error)}`, "error");
      }
    },
  });

  pi.on("session_start", async (_event, _ctx) => {
    waitingForTurnEnd = undefined;
    compactionInFlight = undefined;
    fallbackCheckpoint = undefined;
    fallbackQueued = false;
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
      if (generationInFlight || waitingForTurnEnd || compactionInFlight || fallbackCheckpoint || fallbackQueued) {
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
        onError: (error) => queueFallback(ctx, checkpoint, error),
      });
    } catch (error) {
      queueFallback(ctx, checkpoint, error);
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
