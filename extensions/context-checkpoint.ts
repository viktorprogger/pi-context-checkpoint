import {
  buildSessionContext,
  DEFAULT_COMPACTION_SETTINGS,
  type CompactionResult,
  type ExtensionAPI,
  type ExtensionContext,
  type SessionBeforeCompactEvent,
  type SessionCompactEvent,
  type SessionCompactFailedEvent,
  type ToolCallEvent,
  type TurnEndEvent,
  type InputEvent,
} from "@earendil-works/pi-coding-agent";
import { uuidv7 } from "@earendil-works/pi-ai";
import { Type, type Static } from "typebox";
import { modelPicker } from "../src/endless-model-selector.ts";
import {
  ENDLESS_MODEL_KEY,
  readEndlessSettings,
  settingsPaths,
  writeEndlessSetting,
  resolveCheckpointModel,
  type Scope,
} from "../src/endless-settings.ts";

import {
  runCheckpointPasses,
  selectCheckpointModel,
  prepareCheckpointMessages,
  sumUsage,
  type CheckpointFields,
  type CompletionFunction,
  type Usage,
} from "../src/checkpoint-core.ts";
import { appendContextUsageHint } from "../src/context-usage-hint.ts";

const TOOL_NAME = "checkpoint";
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

function isTinySessionCompactionError(error: unknown): boolean {
  return errorMessage(error) === "Nothing to compact (session too small)";
}

function isCheckpointCompactionDetails(details: unknown, toolCallId: string): boolean {
  if (!details || typeof details !== "object") return false;
  const candidate = details as { version?: unknown; toolCallId?: unknown };
  return candidate.version === CHECKPOINT_DETAILS_VERSION && candidate.toolCallId === toolCallId;
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

function manualCheckpointFields(): CheckpointFields {
  return {
    stage: "manual checkpoint",
    status: "Manual checkpoint requested from the current conversation.",
    completed: [],
    incomplete: [],
    nextActions: ["Continue the original task after checkpoint processing."],
    notes: "Progress fields were safely defaulted because this checkpoint was requested manually.",
  };
}

// Structural subset of Pi's ContextUsage; cast defensively so installations
// with stale declarations fail softly instead of crashing at load time.
function readContextUsage(ctx: ExtensionContext): { tokens: number | null; contextWindow: number } | undefined {
  const getContextUsage = (
    ctx as unknown as { getContextUsage?: () => { tokens: number | null; contextWindow: number } | undefined }
  ).getContextUsage;
  return typeof getContextUsage === "function" ? getContextUsage.call(ctx) : undefined;
}

function resolveComplete(modelRegistry: ExtensionContext["modelRegistry"]): CompletionFunction {
  // Keep the runtime check at this call boundary for installations with stale declarations or runtimes.
  const complete = (modelRegistry as unknown as { complete?: CompletionFunction }).complete;
  if (typeof complete !== "function") {
    throw new Error(
      "checkpoint requires ctx.modelRegistry.complete; the installed Pi runtime does not expose this API (use a newer Pi runtime).",
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
    // Stop this internal turn so ctx.compact() cannot race a follow-up model call.
    // The lifecycle below explicitly starts the next turn after compaction completes.
    terminate: true,
  };
}

export default function contextCheckpoint(pi: ExtensionAPI): void {
  let waitingForTurnEnd: CheckpointState | undefined;
  let compactionInFlight: CheckpointState | undefined;
  let pendingRecovery: CheckpointState | undefined;
  let recoveryInFlight = false;
  let generationInFlight = false;
  let continuationIssuedFor: string | undefined;
  let checkpointBatchInFlight = false;
  let compactionStartedFor: string | undefined;
  let compactionAbortedFor: string | undefined;
  // Automatic compaction has no extension completion callback.  Keep its
  // lifecycle pending until agent_settled, which is after Pi has released its
  // public compaction lock (and processed any queued continuation).
  let automaticCompactionFor: string | undefined;
  let automaticCompactionOutcome: "success" | "aborted" | "failed" | undefined;
  let continuationAfterSettled: CheckpointState | undefined;
  const activeToolExecutions = new Set<string>();
  let checkpointLifecycleActive = false;
  let queuedInputs: Array<{ text: string; images?: InputEvent["images"] }> = [];

  const finishCheckpointLifecycle = (): void => {
    if (!queuedInputs.length) { checkpointLifecycleActive = false; return; }
    const content: any[] = [];
    for (const input of queuedInputs) {
      content.push({ type: "text", text: input.text });
      if (input.images) content.push(...input.images);
    }
    queuedInputs = [];
    checkpointLifecycleActive = false;
    if (content.length) void Promise.resolve(pi.sendUserMessage(content, { deliverAs: "followUp" }));
  };

  const notify = (ctx: ExtensionContext, message: string, type: "info" | "warning" | "error" = "info") => {
    if (ctx.hasUI) ctx.ui.notify(message, type);
  };

  const generateCheckpoint = async (
    toolCallId: string,
    fields: CheckpointFields,
    signal: AbortSignal | undefined,
    ctx: ExtensionContext,
  ): Promise<CheckpointState> => {
    generationInFlight = true;
    continuationIssuedFor = undefined;
    try {
      const trusted = typeof (ctx as any).isProjectTrusted === "function" ? ctx.isProjectTrusted() : true;
      const paths = settingsPaths(ctx.cwd || process.cwd());
      const stored = await readEndlessSettings(paths, trusted);
      const model = resolveCheckpointModel({
        env: Object.prototype.hasOwnProperty.call(process.env, "PI_CHECKPOINT_MODEL") ? process.env.PI_CHECKPOINT_MODEL : undefined,
        project: stored.project,
        global: stored.global,
        active: ctx.model,
        find: (provider, modelId) => ctx.modelRegistry.find(provider, modelId),
        hasConfiguredAuth: (candidate) => ctx.modelRegistry.hasConfiguredAuth(candidate),
      });
      const complete = resolveComplete(ctx.modelRegistry);
      const sessionContext = buildSessionContext(ctx.sessionManager.getBranch());
      const conversation = prepareCheckpointMessages(sessionContext.messages, toolCallId);
      const passes = await runCheckpointPasses(complete, model, fields, conversation, signal, uuidv7);
      const combinedUsage = sumUsage([passes.draft.usage, passes.final.usage]);
      return {
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
    } catch (error) {
      finishCheckpointLifecycle();
      throw error;
    } finally {
      generationInFlight = false;
    }
  };

  const requestContinuation = (checkpoint: CheckpointState, deliverAs?: "followUp"): void => {
    if (continuationIssuedFor === checkpoint.toolCallId) return;
    continuationIssuedFor = checkpoint.toolCallId;
    pi.sendMessage(
      {
        customType: "checkpoint-continuation",
        content:
          "Checkpoint processing is complete. Continue working on the original task from the current state; do not stop merely because the checkpoint finished. Take the next appropriate action.",
        display: false,
      },
      deliverAs ? { triggerTurn: true, deliverAs } : { triggerTurn: true },
    );
  };

  const queueRecovery = (
    ctx: ExtensionContext,
    checkpoint: CheckpointState,
    reason: unknown,
    deferRelease = false,
  ): void => {
    if (pendingRecovery || !compactionInFlight || compactionInFlight.toolCallId !== checkpoint.toolCallId) return;

    // An aborted context cannot be recovered in a replacement session.  It is
    // still a terminal lifecycle outcome, so do not strand input behind it.
    if (ctx.signal?.aborted) {
      compactionInFlight = undefined;
      finishCheckpointLifecycle();
      return;
    }

    // Automatic compaction failure is reported while Pi still owns its
    // compaction lifecycle. Keep the checkpoint marked in-flight until
    // agent_settled releases the public lock and queued input.
    if (!deferRelease) compactionInFlight = undefined;
    pendingRecovery = checkpoint;
    notify(ctx, `Checkpoint compaction failed (${errorMessage(reason)}). Run /${RECOVERY_COMMAND} to start a replacement session.`, "warning");
    if (!deferRelease) finishCheckpointLifecycle();
  };

  const isCompactionCancellationError = (error: unknown): boolean =>
    errorMessage(error) === "Compaction cancelled" || (error instanceof Error && error.name === "AbortError");

  const handleCompactionError = (ctx: ExtensionContext, checkpoint: CheckpointState, error: unknown): void => {
    if (isCompactionCancellationError(error) || compactionAbortedFor === checkpoint.toolCallId) {
      if (compactionInFlight?.toolCallId === checkpoint.toolCallId) {
        compactionInFlight = undefined;
        compactionAbortedFor = undefined;
        finishCheckpointLifecycle();
      }
      return;
    }
    if (ctx.signal?.aborted) {
      if (compactionInFlight?.toolCallId === checkpoint.toolCallId) {
        compactionInFlight = undefined;
        finishCheckpointLifecycle();
      }
      return;
    }
    if (isTinySessionCompactionError(error)) {
      if (compactionInFlight?.toolCallId === checkpoint.toolCallId) {
        compactionInFlight = undefined;
        requestContinuation(checkpoint);
        finishCheckpointLifecycle();
      }
      return;
    }
    queueRecovery(ctx, checkpoint, error);
  };

  const startCompaction = (ctx: ExtensionContext, checkpoint: CheckpointState): void => {
    if (
      compactionStartedFor === checkpoint.toolCallId ||
      !compactionInFlight ||
      compactionInFlight.toolCallId !== checkpoint.toolCallId
    ) {
      return;
    }
    compactionStartedFor = checkpoint.toolCallId;

    try {
      ctx.compact({
        onComplete: () => {
          if (compactionInFlight?.toolCallId === checkpoint.toolCallId) {
            compactionInFlight = undefined;
            if (compactionAbortedFor === checkpoint.toolCallId) {
              compactionAbortedFor = undefined;
              finishCheckpointLifecycle();
              return;
            }
            requestContinuation(checkpoint);
            finishCheckpointLifecycle();
          }
        },
        onError: (error) => handleCompactionError(ctx, checkpoint, error),
      });
    } catch (error) {
      handleCompactionError(ctx, checkpoint, error);
    }
  };

  pi.registerCommand(RECOVERY_COMMAND, {
    description: "ONLY use after a checkpoint compaction error: recover in a replacement session",
    handler: async (_args, ctx) => {
      const pending = pendingRecovery;
      if (!pending) {
        notify(ctx, "No checkpoint recovery is pending.");
        return;
      }
      if (recoveryInFlight) return;
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

  pi.registerCommand("endless-settings", {
    description: "Choose the model used for checkpoint summarization",
    handler: async (_args, ctx) => {
      if (!ctx.hasUI) { notify(ctx, "/endless-settings requires an interactive UI.", "warning"); return; }
      try {
        const scope = await ctx.ui.select("Endless settings scope", ["global", "project"]);
        if (!scope) return;
        const selectedScope = scope as Scope;
        const trusted = typeof (ctx as any).isProjectTrusted === "function" ? ctx.isProjectTrusted() : true;
        if (selectedScope === "project" && !trusted) { notify(ctx, "Project settings require a trusted project.", "error"); return; }
        const paths = settingsPaths(ctx.cwd || process.cwd());
        const allModels = ctx.modelRegistry.getAvailable().filter((m) => ctx.modelRegistry.hasConfiguredAuth(m));
        const scoped = new Set(ctx.scopedModels.map((item) => `${item.model.provider}/${item.model.id}`));
        const scopedModels = allModels.filter((m) => scoped.has(`${m.provider}/${m.id}`));
        if (!allModels.length) { notify(ctx, "No authenticated models are available.", "warning"); return; }
        const defaultLabel = selectedScope === "project" ? "Default (inherit global setting)" : "Default (current active)";
        const scopedChoices = scopedModels.length ? scopedModels : allModels;
        const choice = await new Promise<string | undefined>((resolve, reject) => {
          let settled = false;
          const finishOnError = (error: unknown) => {
            if (settled) return;
            settled = true;
            reject(error);
          };
          ctx.ui.custom(
            (tui, _theme, _keybinding, done) =>
              modelPicker(tui, scopedChoices, allModels, defaultLabel, (value) => {
                if (settled) return;
                settled = true;
                done(value);
                resolve(value);
              }),
            { overlay: true },
          ).catch(finishOnError);
        });
        if (choice === undefined) return;
        if (choice === "") { await writeEndlessSetting(selectedScope, null, paths, trusted); notify(ctx, `Cleared ${selectedScope} checkpoint model.`); return; }
        const match = /^([^/]+)\/(.+)$/.exec(choice);
        if (!match) { notify(ctx, "Invalid model selection.", "error"); return; }
        const candidate = ctx.modelRegistry.find(match[1], match[2]);
        if (!candidate || !ctx.modelRegistry.hasConfiguredAuth(candidate)) { notify(ctx, "Selected model is no longer available or authenticated.", "error"); return; }
        await writeEndlessSetting(selectedScope, choice, paths, trusted);
        notify(ctx, `Saved ${selectedScope} checkpoint model: ${choice}`);
      } catch (error) {
        notify(ctx, `Unable to persist endless settings: ${errorMessage(error)}`, "error");
      }
    },
  });

  pi.registerCommand(TOOL_NAME, {
    description: "Generate, compact, and continue from a checkpoint using the current conversation",
    handler: async (_args, ctx) => {
      if (generationInFlight || waitingForTurnEnd || compactionInFlight || pendingRecovery || recoveryInFlight) {
        notify(ctx, "A checkpoint is already generating or compacting a checkpoint.", "warning");
        return;
      }
      await ctx.waitForIdle();
      if (generationInFlight || waitingForTurnEnd || compactionInFlight || pendingRecovery || recoveryInFlight) {
        notify(ctx, "A checkpoint is already generating or compacting a checkpoint.", "warning");
        return;
      }
      if (ctx.signal?.aborted) {
        notify(ctx, "Manual checkpoint was aborted.", "error");
        return;
      }

      checkpointLifecycleActive = true;
      const checkpoint = await generateCheckpoint(uuidv7(), manualCheckpointFields(), ctx.signal, ctx);
      const contextUsage = readContextUsage(ctx);
      if (contextUsage && contextUsage.tokens !== null && contextUsage.tokens <= DEFAULT_COMPACTION_SETTINGS.keepRecentTokens) {
        requestContinuation(checkpoint);
        finishCheckpointLifecycle();
        return;
      }
      compactionInFlight = checkpoint;
      startCompaction(ctx, checkpoint);
    },
  });

  pi.on("session_shutdown", async (_event, _ctx) => {
    // Replacement tears down the old extension instance before the new one
    // receives session_start. Release Pi-delivered input at this terminal
    // boundary, while this instance still owns the queue. The release path is
    // idempotent, so a later/duplicate lifecycle notification is harmless.
    finishCheckpointLifecycle();
  });

  pi.on("session_start", async (_event, _ctx) => {
    // A session switch can arrive before the checkpoint reaches its normal
    // terminal callback. Release Pi-delivered input before resetting the
    // lifecycle, otherwise clearing the queue silently loses it.
    finishCheckpointLifecycle();
    waitingForTurnEnd = undefined;
    compactionInFlight = undefined;
    pendingRecovery = undefined;
    recoveryInFlight = false;
    generationInFlight = false;
    continuationIssuedFor = undefined;
    checkpointBatchInFlight = false;
    compactionStartedFor = undefined;
    compactionAbortedFor = undefined;
    automaticCompactionFor = undefined;
    automaticCompactionOutcome = undefined;
    continuationAfterSettled = undefined;
    activeToolExecutions.clear();
  });

  pi.on("tool_execution_start", async (event) => {
    activeToolExecutions.add(event.toolCallId);
  });

  pi.on("tool_execution_end", async (event) => {
    activeToolExecutions.delete(event.toolCallId);
  });

  pi.on("input", async (event: InputEvent) => {
    if (!checkpointLifecycleActive || (event.source !== "interactive" && event.source !== "rpc")) return;
    queuedInputs.push({ text: event.text, images: event.images });
    return { action: "handled" };
  });

  pi.on("tool_call", async (event: ToolCallEvent, _ctx) => {
    if (event.toolName === TOOL_NAME && [...activeToolExecutions].some((id) => id !== event.toolCallId)) {
      return { block: true, reason: "checkpoint must wait until other Pi tools finish executing; retry it after the active tools complete." };
    }
    if (event.toolName === TOOL_NAME) {
      checkpointBatchInFlight = true;
      return;
    }
    if (!checkpointBatchInFlight) return;
    return {
      block: true,
      reason: "checkpoint must be the final tool in an assistant batch; wait for compaction before continuing.",
      terminate: true,
    };
  });

  pi.on("session_compact", async (event: SessionCompactEvent, _ctx) => {
    const checkpoint = compactionInFlight;
    if (
      !checkpoint ||
      !event.fromExtension ||
      !isCheckpointCompactionDetails(event.compactionEntry.details, checkpoint.toolCallId)
    ) {
      return;
    }

    compactionStartedFor = checkpoint.toolCallId;
    // Manual ctx.compact() emits this event while Pi still holds its
    // compaction lock.  Leave the lifecycle (and queued input) active until
    // ctx.compact()'s onComplete callback, which runs after that lock clears.
    if (event.reason === "manual") return;

    // Threshold/overflow compaction runs before the agent settles, so queue a
    // follow-up. Keep the lifecycle active until agent_settled: session_compact
    // is still inside Pi's public compaction lock.
    automaticCompactionFor = checkpoint.toolCallId;
    automaticCompactionOutcome = "success";
    requestContinuation(checkpoint, "followUp");
  });

  pi.on("session_compact_failed", async (event: SessionCompactFailedEvent, ctx) => {
    const checkpoint = compactionInFlight;
    if (
      !checkpoint ||
      !automaticCompactionFor ||
      automaticCompactionFor !== checkpoint.toolCallId ||
      compactionStartedFor === checkpoint.toolCallId ||
      !event.fromExtension
    ) {
      return;
    }

    if (event.aborted) {
      automaticCompactionOutcome = "aborted";
      return;
    }

    automaticCompactionOutcome = "failed";
    queueRecovery(
      ctx,
      checkpoint,
      new Error(event.errorMessage ?? "automatic compaction failed"),
      true,
    );
  });

  pi.on("agent_settled", async (_event, ctx) => {
    const continuation = continuationAfterSettled;
    continuationAfterSettled = undefined;
    if (continuation) {
      requestContinuation(continuation);
      finishCheckpointLifecycle();
    }

    const checkpoint = compactionInFlight;
    if (checkpoint && automaticCompactionFor === checkpoint.toolCallId) {
      // This covers successful automatic compaction, cancellation or failure
      // reported by the Pi 1 session_compact_failed event, and an automatic
      // attempt that produced no session_compact event. In all cases this is
      // the terminal point for the automatic attempt; never start a second
      // manual compaction.
      compactionInFlight = undefined;
      automaticCompactionFor = undefined;
      automaticCompactionOutcome = undefined;
      finishCheckpointLifecycle();
      return;
    }
    // No automatic-compaction marker means Pi did not expose an automatic hook
    // for this checkpoint. The normal path is to apply the checkpoint through
    // the intended manual-compaction fallback; Pi's public extension API cannot
    // distinguish that case from an automatic failure before its first hook.
    if (checkpoint) startCompaction(ctx, checkpoint);
  });

  pi.registerTool({
    name: TOOL_NAME,
    label: "Checkpoint",
    description:
      "Create a durable engineering checkpoint from the active conversation and explicit progress fields, compact it, and then continue working on the task.",
    promptSnippet:
      "Use only between two substantial phases: after substantial work, with another substantial phase remaining—not for a final/pre-work or immediate pressure-driven call.",
    promptGuidelines: [
      "Use checkpoint only at the boundary between two substantial parts of ongoing work: call it after substantial work has accumulated and only when another substantial phase remains. It is not a final report or a pre-work ritual; do not call it before substantial work has accumulated. Provide concrete completed, incomplete, nextActions, and notes fields.",
      "Watch the <ctx-usage> line appended after recent tool results: it reports percent of the autocompact limit used by checkpoint policy and gives timing guidance. Treat that guidance as subordinate to the between-phases rule above; no recommendation means do not call the checkpoint tool.",
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
        throw new Error("checkpoint is already generating or compacting a checkpoint.");
      }
      // execute() runs before the assistant tool call/result is persisted. The shared
      // generator copies only the context before that in-flight call.
      checkpointLifecycleActive = true;
      const state = await generateCheckpoint(toolCallId, normalizeFields(params), signal, ctx);
      waitingForTurnEnd = state;
      return checkpointResult(state);
    },
  });

  pi.on("turn_end", async (event: TurnEndEvent, ctx) => {
    checkpointBatchInFlight = false;
    const checkpoint = waitingForTurnEnd;
    if (!checkpoint) return;
    const persisted = event.toolResults.some(
      (result) => result.toolName === TOOL_NAME && result.toolCallId === checkpoint.toolCallId,
    );
    if (!persisted) return;

    waitingForTurnEnd = undefined;
    compactionInFlight = checkpoint;

    // Pi's core reports tiny-session compaction as an error before extension callbacks
    // run. Avoid that known case when the public usage estimate makes it certain.
    const contextUsage = readContextUsage(ctx);
    if (contextUsage && contextUsage.tokens !== null && contextUsage.tokens <= DEFAULT_COMPACTION_SETTINGS.keepRecentTokens) {
      compactionInFlight = undefined;
      continuationAfterSettled = checkpoint;
      return;
    }

    // Wait for agent_settled before calling ctx.compact(). Pi's compact() first
    // waits for the active run to become idle; starting it here can deadlock or
    // race queued work after this turn.
  });

  // Inject an ephemeral tail-of-context checkpoint-pressure hint before every LLM
  // call. The `context` event receives a deep copy that is never persisted, so the
  // session file keeps no accumulating boilerplate: at any moment the model sees
  // exactly one fresh `<ctx-usage>` line, placed after the latest tool result for
  // maximal recency attention and provider cache stability.
  pi.on("context", async (event, ctx) => {
    const contextUsage = readContextUsage(ctx);
    const messages = appendContextUsageHint(event.messages, contextUsage);
    if (messages === event.messages) return undefined;
    return { messages };
  });

  pi.on("session_before_compact", async (event: SessionBeforeCompactEvent, _ctx) => {
    const checkpoint = compactionInFlight;
    if (!checkpoint) return;
    if (event.signal.aborted) {
      // An automatic attempt has no ctx.compact() callback (and therefore no
      // cancellation error callback).  Mark it here and finalize at
      // agent_settled, after Pi releases the public compaction lock.
      if (compactionStartedFor !== checkpoint.toolCallId) {
        automaticCompactionFor = checkpoint.toolCallId;
        automaticCompactionOutcome = "aborted";
      } else {
        // Manual ctx.compact() still reports cancellation through onError.
        compactionAbortedFor = checkpoint.toolCallId;
      }
      return { cancel: true };
    }

    // Seeing this hook without a preceding ctx.compact() call identifies an
    // automatic attempt.  If it later fails before emitting session_compact,
    // agent_settled will close it without launching a duplicate manual one.
    if (compactionStartedFor !== checkpoint.toolCallId) {
      automaticCompactionFor = checkpoint.toolCallId;
      automaticCompactionOutcome = undefined;
    }

    // Preserve Pi's native retained-tail boundary. Overriding it with the checkpoint
    // tool-call entry made the UI discard every earlier message even when native
    // /compact would have kept those messages visible.
    const compaction = {
      summary: checkpoint.summary,
      firstKeptEntryId: event.preparation.firstKeptEntryId,
      tokensBefore: event.preparation.tokensBefore,
      usage: checkpoint.usage,
      details: checkpoint.details,
    } as CompactionResult<CheckpointDetails> & { usage: Usage };
    return { compaction };
  });
}
