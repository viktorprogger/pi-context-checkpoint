# pi-context-checkpoint

`pi-context-checkpoint` adds an LLM-callable `checkpoint_context` tool for durable engineering phase checkpoints. It captures Pi's active, compaction-aware conversation plus explicit progress fields, runs a draft/evidence pass, an independent omissions/contradictions review, and a final synthesis, then terminates the current turn.

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

Ask the agent to call `checkpoint_context` at a phase boundary and provide:

- `stage` — the current project or task stage;
- `status` — current status and where work stopped;
- `completed` — completed steps;
- `incomplete` — previous steps that remain incomplete;
- `nextActions` — immediate next actions;
- `notes` — decisions, blockers, open questions, and other relevant facts.

The tool returns the final checkpoint as its result, persists the summary in tool details, and returns `terminate: true` so Pi does not make an unnecessary follow-up model call. After the tool result is persisted, the extension requests compaction and supplies the generated checkpoint as the compaction summary.

## Configuration

By default, the tool uses the active `ctx.model`. To use another authenticated registry model, set:

```bash
export PI_CHECKPOINT_MODEL=provider/model
```

The override is resolved with `modelRegistry.find(provider, modelId)`. Missing models, missing authentication, missing active models, malformed overrides, and empty model output fail with explicit errors. Each of the three nested requests receives the tool abort signal, a fresh UUIDv7 session ID, and `cacheRetention: "none"`.

## Recovery after compaction errors

Pi's compaction API is asynchronous. If its completion callback reports an error—including the short-session `nothing to compact` case—the extension retains one pending checkpoint and, when a UI is available, tells you to run the exact command `/checkpoint_context_recover`. The command handler safely creates a replacement session and seeds it with the final checkpoint summary. Recovery is manual because Pi 0.84.x disables slash-command expansion for extension-originated `sendUserMessage()` calls; this extension never sends that automatic fallback message or calls `newSession()` from an ordinary lifecycle event. Duplicate recovery requests are ignored, and a new session clears stale pending state.

## Limitations and API uncertainty

- The implementation calls the public `ctx.modelRegistry.complete` API (Pi 0.84.x), not `pi-ai.complete`. Use Pi 0.84.x or newer; the extension performs one narrow structural check and fails clearly when the method is unavailable.
- Tool-result `usage` and `terminate` fields are runtime-compatible extension fields. Older Pi versions whose declarations/runtime predate those fields may not account for nested usage or stop after the tool; the extension does not silently substitute another completion API.
- The read-only session manager is never mutated while generating a checkpoint. The active context is rebuilt with the public `buildSessionContext(ctx.sessionManager.getBranch())` path before conversion and serialization.
- The extension deliberately makes exactly three sequential completion requests on a successful tool execution. It does not retry nested calls or compact during tool execution.
- Serialized conversation text and intermediate draft/review text are delimited as untrusted evidence. Unknown or contradictory facts are requested as labeled unknowns; model output cannot guarantee factuality beyond the evidence supplied.

## Development checks

```bash
npm test
npm run check
node -e "import('./extensions/context-checkpoint.ts')"
npm pack --dry-run
```
