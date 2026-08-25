# Gate agent work until checkpoint compaction

## Problem
The checkpoint lifecycle can request `ctx.compact()` while Pi is still completing the current agent run. The fire-and-forget compaction can then wait on the active run, while queued or subsequent agent work may start before the checkpoint summary is persisted. The checkpoint must be a hard phase barrier.

## Decision and approach
Keep the checkpoint tool's terminating result, block any later tool call in the same assistant batch, and arm compaction at `turn_end` without starting it there. Start the explicit compaction only from `agent_settled`, when Pi's run and post-run processing are idle. Allow continuation only from a persisted `session_compact` event or the compaction callback/no-op path.

## Implemented
Pending implementation.

## Validation
Pending tests and lifecycle checks.

## Follow-up
Provider-backed interactive smoke testing remains useful for confirming latency and continuation behavior under the installed CLI.
