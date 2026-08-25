# Add a manual checkpoint command

## Problem
Users need a direct `/checkpoint` command that has the same durable checkpoint lifecycle as an LLM-called checkpoint, while `/checkpoint_context_recover` must remain reserved for failed checkpoint compaction recovery.

## Decision and approach
Share the three-pass generation and compaction state machine between the tool and command. The manual command waits for Pi to become idle, supplies safely defaulted progress fields, compacts when the session requires it, and starts the same hidden continuation. Keep replacement-session creation explicit in the recovery command only.

## Implemented
- Registered `/checkpoint` alongside the `checkpoint` tool.
- Added idle waiting, manual generation, short-session no-op handling, compaction, and guarded continuation coverage.
- Made the recovery command description begin with an explicit only-after-compaction-error warning and report when no recovery is pending.
- Documented the manual command and replacement-session recovery process.

## Validation
`npm test` — 20 passed; `npm run check` — passed; extension import — passed; `git diff --check` — passed; independent verifier — PASS.

## Follow-up
Provider-backed interactive behavior remains an optional manual smoke test; automated coverage intentionally stays deterministic and provider-free.
