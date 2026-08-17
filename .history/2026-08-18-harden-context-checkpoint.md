# Harden context checkpoint recovery and packaging

## Problem
The initial checkpoint extension had a documented automatic fallback that could not work: Pi's extension-originated `sendUserMessage()` skips slash-command expansion, while `newSession()` is safe only from a user-invoked command context. Development metadata also targeted the older 0.74 API baseline and lifecycle behavior lacked deterministic integration coverage.

## Decision and approach
Replace automatic fallback delivery with a bounded manual recovery command, `/checkpoint_context_recover`. On compaction failure, retain one pending checkpoint and notify the user; only the command handler may create the replacement session. Align the package with the public Pi 0.84.x `modelRegistry.complete` API and lock development dependencies.

## Implemented
- Removed lifecycle `sendUserMessage()` fallback and added guarded manual recovery with duplicate, abort, cancellation, and session-reset handling.
- Kept old session-bound contexts out of post-`newSession()` paths; replacement UI work uses only `withSession` context.
- Added lifecycle tests for tool execution, custom compaction, manual recovery, stale-state reset, and stale-context protection.
- Updated package metadata to version 0.2.0, Pi 0.84.x peer requirements, Node >=20, and a committed npm lockfile.
- Updated README and CTX exclusions to document the supported runtime and recovery behavior.

## Validation
- `npm ci` from `package-lock.json`.
- `npm test` — 12 tests passed.
- `npm run check` — passed against locked Pi 0.84.2 declarations.
- Extension module smoke load — passed.
- `npm pack --dry-run` — contained the intended five package files.
- Independent verifier — PASS; no provider-backed model call was made.

## Follow-up
A real provider-backed checkpoint run remains an optional manual smoke test; automated coverage intentionally stays provider-free and deterministic.
