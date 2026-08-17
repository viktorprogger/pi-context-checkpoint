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

## Fallback

Pi's compaction API is asynchronous. If its completion callback reports an error—including the short-session `nothing to compact` case—the extension queues an internal follow-up through `pi.sendUserMessage` and registers a unique command whose handler creates a replacement session seeded with the final checkpoint as a user message. UI notifications are emitted only when `ctx.hasUI` is true.

Important compatibility limitation: Pi 0.74 and the active 0.84 runtime currently call `sendUserMessage` with command parsing disabled, so a queued slash-command message is treated as ordinary user text rather than dispatched to the registered handler. Automatic replacement fallback therefore requires a runtime command-dispatch path that is not exposed by the current ExtensionAPI; the code keeps `newSession()` confined to the command handler rather than using an unsafe ordinary event context workaround.

## Limitations and API uncertainty

- The implementation intentionally calls `ctx.modelRegistry.complete`, not `pi-ai.complete`. The local dependency/declaration baseline is coding-agent `0.74.0`, which omits this method; the active CLI used during development is `0.84.1`, where the runtime exposes it. This declaration/runtime boundary is version-sensitive: the extension performs one narrow structural check and fails clearly when the method is unavailable. Use a runtime that provides `modelRegistry.complete` for model-backed checkpoints.
- Tool-result `usage` and `terminate` fields are runtime-compatible extension fields. Older Pi versions whose declarations/runtime predate those fields may not account for nested usage or stop after the tool; the extension does not silently substitute another completion API.
- The read-only session manager is never mutated while generating a checkpoint. The active context is rebuilt with the public `buildSessionContext(ctx.sessionManager.getBranch())` path before conversion and serialization.
- The extension deliberately makes exactly three sequential completion requests on a successful tool execution. It does not retry nested calls or compact during tool execution.
- Serialized conversation text and intermediate draft/review text are delimited as untrusted evidence. Unknown or contradictory facts are requested as labeled unknowns; model output cannot guarantee factuality beyond the evidence supplied.

## Development checks

```bash
npm test
npm run check
```
