# Context checkpoint extension

## Problem
Pi needs an explicit phase checkpoint that preserves task intent, engineering rationale, execution state, and continuation plans before compaction, while the local coding-agent declarations do not expose the newer model-registry completion method.

## Decision and approach
Implement a package-ready TypeScript extension with a `checkpoint_context` tool. Capture the active branch through public session-context construction and serialization, treat conversation and intermediate model output as untrusted evidence, and use exactly three sequential registry completions: draft/evidence, independent review, and final synthesis. Keep the read-only session manager untouched during generation. After the persisted tool result appears at `turn_end`, provide the generated checkpoint through `session_before_compact`; if asynchronous compaction fails, queue one internal command that creates a replacement session seeded with the final summary.

## Implemented
- Added explicit TypeBox fields, sequential tool execution, termination, durable details, and combined nested usage accounting.
- Added UUIDv7 nested session IDs, `cacheRetention: "none"`, abort propagation, authenticated model selection, and a clear runtime guard for missing `ctx.modelRegistry.complete`.
- Added compaction lifecycle state tied to the tool call ID, minimal retained-tail lookup, abort/error handling, and a guarded replacement-session fallback.
- Added pure serialization, prompt, model-selection, usage, first-kept-entry, and completion-pipeline helpers with deterministic Node test coverage.
- Added package metadata, peer dependencies, Node 24-compatible scripts/configuration, and installation/configuration/fallback/API-version documentation.

## Validation
- `npm test` — 8 tests passed.
- `npm run check` — TypeScript completed with `--noEmit` and no errors.
- Extension module smoke-loaded successfully under Node 24 TypeScript stripping.
- A fake registry smoke check observed three sequential calls, unique UUIDv7 session IDs, `cacheRetention: "none"`, and a single post-result compaction request.

## Follow-up
The local `@earendil-works/pi-coding-agent` 0.74 declarations/runtime do not expose `modelRegistry.complete`; use the active runtime version that provides it (the development CLI was 0.84.1), as documented in the README. Pi 0.74 and active 0.84 also disable extension-command parsing for `pi.sendUserMessage`, so automatic replacement fallback needs a future public command-dispatch API; the implementation deliberately does not call `newSession()` from an ordinary event context.
