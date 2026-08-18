# Structured continuation checkpoints

## Problem
The checkpoint pipeline flattened the active dialogue into a serialized evidence string and framed its passes as external extraction and review. That preserved facts but weakened conversational continuity and could include the in-flight checkpoint tool call in malformed nested context.

## Decision and approach
Pass the active compaction-aware LLM messages directly to nested completions. Remove the current incomplete checkpoint tool-call message and everything after it from the copied sequence without mutating the read-only session. Run three chained future-self turns: continuation checkpoint, self-reflection/correction, and final continuation note; use only the final answer as the tool and compaction summary.

## Implemented
- Replaced serialized conversation prompts with structured `Message[]` contexts.
- Added explicit in-flight tool-call truncation and immutable-context tests.
- Chained draft and reflection responses as structured assistant messages into later passes.
- Added detailed per-section final checkpoint guidance, including the `Conversation Continuity Contract` with Type, Strength, Rule, Evidence, and Application fields.
- Split file guidance into `Files to read for next work` and `Files changed so far`, with path-specific reasons and verification notes.
- Updated security wording and documentation for historical structured messages, explicit fields, and intermediate answers.

## Validation
- `npm test` — 12 tests passed.
- `npm run check` — passed against locked Pi 0.84.2 declarations.
- Extension module smoke load — passed.
- `npm pack --dry-run` — intended five files.
- `git diff --check` — passed.
- Independent verifier — PASS; no provider-backed calls were made.

## Follow-up
A live provider-backed structured-message run remains an optional manual smoke test. The compaction boundary still follows Pi's valid `firstKeptEntryId` tail contract; summary-only compaction would require a separate compatibility decision or explicit Pi API support.
