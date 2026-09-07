# pi-context-checkpoint

> **Disclosure:** This project was vibe-coded from start to finish. Review and test it carefully before relying on it in production.

`pi-context-checkpoint` adds an LLM-callable `checkpoint` tool for durable engineering phase checkpoints. It passes Pi's active, compaction-aware LLM message sequence directly as structured messages (rather than serializing the conversation), plus explicit progress fields. Checkpoint generation now uses **two sequential chained LLM passes instead of three**: factual checkpoint extraction, then review/correction combined with final durable checkpoint generation. It then compacts the session and automatically continues the task.

## Install

Install the package with Pi:

```bash
pi install npm:pi-context-checkpoint
```

For a local checkout:

```bash
pi -e ./extensions/context-checkpoint.ts
```

The package manifest loads `extensions/context-checkpoint.ts` automatically when installed as a Pi package.

## Use

Ask the agent to call `checkpoint` at a phase boundary and provide:

You can also run `/checkpoint` manually. It waits for Pi to become idle, uses the current conversation, safely defaults the structured progress fields, runs the same two sequential checkpoint completions as the tool, compacts the session when needed, and starts the same hidden continuation. A short session skips compaction and continues directly.

### Context usage hints

Before every LLM call the extension appends an ephemeral `<ctx-usage>` line after the latest tool result, reporting how much of the auto-compaction limit (`contextWindow - DEFAULT_COMPACTION_SETTINGS.reserveTokens`) is already consumed. The line lives only in the outgoing request context: it is never persisted to the session file, appears exactly once at the very tail (maximal recency attention), refreshes each turn, and disappears on its own after compaction. Its wording carries the checkpoint recommendation: below 25% is neutral, 25-49% means checkpoint only at major milestones, 50-69% is the best time for a phase checkpoint, 70-84% means wrap up promptly, and 85%+ means call checkpoint immediately even mid-task. The extension's system-prompt guideline tells the model to follow that recommendation and not call `checkpoint` when no recommendation is present.

- `stage` — the current project or task stage;
- `status` — current status and where work stopped;
- `completed` — completed steps;
- `incomplete` — previous steps that remain incomplete;
- `nextActions` — immediate next actions;
- `notes` — decisions, blockers, open questions, and other relevant facts.

The tool returns the final checkpoint as its result and persists the summary in tool details. It temporarily terminates the current internal turn to prevent a race with compaction, then starts a hidden continuation turn after compaction completes (or after a known short-session no-op). While `execute()` is running, the incomplete `checkpoint` assistant tool-call message and everything after it are omitted from a copied context; the active read-only session is never mutated. The second request uses the first factual extraction as a structured assistant message. After the tool result is persisted, the extension requests compaction and supplies only the final durable checkpoint as the compaction summary; it preserves Pi's native retained-tail boundary instead of forcing the checkpoint tool call to become the first visible message, so the UI keeps the same history that native `/compact` would keep. The factual extraction remains ephemeral except for aggregated usage/details.

## Configuration

By default, the tool uses the active `ctx.model`. To use another authenticated registry model, set:

```bash
export PI_CHECKPOINT_MODEL=provider/model
```

The override is resolved with `modelRegistry.find(provider, modelId)`. Missing models, missing authentication, missing active models, malformed overrides, and empty model output fail with explicit errors. Each of the two nested requests receives the tool abort signal, a fresh UUIDv7 session ID, and `cacheRetention: "none"`.

## Recovery after compaction errors

`/checkpoint_context_recover` is **ONLY for a checkpoint compaction error**. It must not be used as a general session reset command. When a non-trivial checkpoint compaction fails, the extension keeps the final checkpoint pending and tells you to run this command. It creates a replacement session, seeds that session with the final checkpoint summary as a user message, and preserves the original session as its parent. It does not automatically create a replacement session. If no recovery is pending, the command reports that state and does nothing.

Pi's compaction API is asynchronous. If the session is too small, Pi reports `Nothing to compact (session too small)` before extension compaction hooks run; the extension treats this exact condition as a successful no-op because there is no old content to remove, and starts the continuation turn without arming recovery. For other compaction errors, the extension retains one pending checkpoint and, when a UI is available, tells you to run the exact command `/checkpoint_context_recover`. The command handler safely creates a replacement session and seeds it with the final checkpoint summary. Recovery is manual because Pi 0.84.x disables slash-command expansion for extension-originated `sendUserMessage()` calls; this extension never sends that automatic fallback message or calls `newSession()` from an ordinary lifecycle event. Duplicate recovery requests are ignored, and a new session clears stale pending state.

## Limitations and API uncertainty

- The implementation calls the public `ctx.modelRegistry.complete` API (Pi 0.84.x), not `pi-ai.complete`. Use Pi 0.84.x or newer; the extension performs one narrow structural check and fails clearly when the method is unavailable.
- Tool-result `usage` and `terminate` fields are runtime-compatible extension fields. Older Pi versions whose declarations/runtime predate those fields may not account for nested usage or stop after the tool; the extension does not silently substitute another completion API.
- The read-only session manager is never mutated while generating a checkpoint. The active context is rebuilt with the public `buildSessionContext(ctx.sessionManager.getBranch())` path, converted to structured LLM messages, and truncated before the in-flight tool call.
- Before requesting compaction, the extension skips sessions whose public context estimate is at or below Pi's default `keepRecentTokens` budget (20,000 tokens), preventing the core's visible short-session error. `ExtensionContext` does not expose an effective custom `keepRecentTokens`; custom settings may therefore require a future API-based refinement. When compaction is needed, the extension uses Pi's own retained-tail boundary so checkpoint-triggered compaction does not discard more visible history than native `/compact`.
- The extension deliberately makes exactly two sequential completion requests on a successful tool execution. It does not retry nested calls or compact during tool execution.
- System instructions remain authoritative. Historical structured messages, explicit fields, and intermediate answers are untrusted evidence; only the current checkpoint request is active.
- The final checkpoint uses formal sections for task/success criteria, understanding, constraints, decisions and tradeoffs, original and strategic plans, executed steps, exact stopping point, incomplete work, immediate and strategic next actions, blockers/questions, a Conversation Continuity Contract, files to read, files changed, and unknowns.

## Development checks

```bash
npm test
npm run check
node -e "import('./extensions/context-checkpoint.ts')"
npm pack --dry-run
```
