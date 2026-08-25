# Preserve Pi's native compaction history boundary

## Problem
The checkpoint extension forced the checkpoint tool-call entry to be the first retained entry. That could hide all earlier chat messages in Pi's UI, even when native `/compact` would retain a larger visible tail.

## Decision and approach
Use `session_before_compact`'s public `preparation.firstKeptEntryId` unchanged. This makes checkpoint-triggered compaction follow Pi's normal history-retention policy instead of imposing a checkpoint-specific UI boundary.

## Implemented
The custom checkpoint summary remains persisted with checkpoint details, while its retained-tail boundary is delegated to Pi. Short sessions still skip compaction, and the existing continuation and recovery lifecycle is unchanged.

## Validation
`npm test` (16 tests), `npm run check`, and `git diff --check` pass. The lifecycle test asserts that the native preparation boundary is preserved.

## Follow-up
If Pi later exposes an explicit API for a summary-only compaction that retains full UI history while reducing LLM context, reassess whether the extension should adopt it.
