# Update the checkpoint extension for Pi 1

## Problem
The checkpoint package targeted Pi 0.84-era dependencies and Node 20, while Pi 1.0 moves the runtime to the 1.x package family, Node 22.19+, and relocates `uuidv7` to `@earendil-works/pi-ai`. Pi 1 also exposes an explicit automatic-compaction failure event that the extension must handle instead of guessing at settlement.

## Decision and approach
Require the Pi 1 package family and Node 22.19+, import `uuidv7` from `pi-ai`, and use Pi 1's typed `session_compact_failed` lifecycle event. Preserve queued input until `agent_settled` for automatic failures, retain one manual recovery checkpoint for non-aborted failures, and avoid starting a duplicate manual compaction. Keep the existing public completion, session, input, and tool lifecycle contracts.

## Implemented
Updated package metadata and lockfile to Pi 1.0.0, added the direct `pi-ai` peer dependency, moved the UUID import, and registered automatic-compaction failure handling. Added package-target and automatic-failure regression coverage and updated the README's Pi/API compatibility guidance.

## Validation
- Isolated-HOME `npm test`: 50/50 passed.
- `npm run check`: passed.
- Extension import smoke: passed.
- `npm pack --dry-run`: passed.
- `git diff --check`: passed.
- After `/reload`, the checkpoint invocation completed and returned the continuation checkpoint; the old `newSessionId` runtime error did not recur.

## Follow-up
Separate authenticated-provider coverage and real interactive/RPC input delivery remain unverified.
