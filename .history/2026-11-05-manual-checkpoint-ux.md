# Distinguish manual and agent checkpoint continuation

## Problem
Manual `/checkpoint` and agent `checkpoint` initiation had different user-facing lifecycle expectations, but shared processing needed one consistent in-chat notification and explicit initiation state.

## Decision and approach
Share the `Starting checkpoint processing.` notification while tracking `manual` versus `agent` initiation internally. Request hidden continuation only for agent/tool checkpoints; keep persisted `CheckpointDetails` unchanged.

## Implemented
Manual and agent checkpoints now emit the shared notification. Agent/tool checkpoints request hidden continuation, while manual successful compaction and known short-session paths leave the next turn to the user. Recovery, cancellation, queue, and agent continuation behavior remain intact.

## Validation
Focused lifecycle tests 28/28; full suite 54/54; `npm run check`; import smoke test; `npm pack --dry-run`; `git diff --check`; and fresh verifier all passed. No provider-backed/UI exercise was run; deterministic tests were the accepted gate.

## Follow-up
None.
