# Treat small-session compaction as a successful no-op

## Problem
Pi rejects `ctx.compact()` before extension compaction hooks when there is nothing old enough to remove, reporting `Nothing to compact (session too small)`. A completed checkpoint was incorrectly routed into manual recovery and Pi displayed a compaction error for this benign condition.

## Decision and approach
Use the public context estimate to skip `ctx.compact()` when the session is at or below Pi's default keep-recent budget, preventing the core error. Retain an exact-error callback fallback for races or older runtimes, clear the in-flight state without recovery, preserve manual recovery for all other failures, and do not fabricate an empty compaction entry through private session APIs.

## Implemented
`turn_end` now performs the conservative short-session preflight and handles the exact short-session error as a no-op. README and project memory document the public-API limitation that effective custom `keepRecentTokens` is not exposed by `ExtensionContext`.

## Validation
`npm test` — 14 passed; `npm run check` — passed; extension import and `npm pack --dry-run` — passed; independent lifecycle verification found no defects for default settings.

## Follow-up
Revisit the preflight if Pi exposes the effective compaction settings to extensions, or if custom `keepRecentTokens` configurations need exact short-session suppression.
