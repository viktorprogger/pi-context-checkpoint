# Gate active work and queue input during checkpoint processing

## Problem
Checkpoint generation and compaction must not race with other Pi tool or subagent executions. If user input arrives while checkpoint generation or its compaction lifecycle is active, Pi may otherwise process it before the checkpoint boundary has been established or fail to combine multiple inputs. The extension needs a guarded checkpoint start and a single release path for queued input.

## Decision and approach
Track Pi tool execution lifecycle events and block the `checkpoint` tool when any other Pi tool is active; do not abort active tools. Queue ordinary interactive/RPC user input while the checkpoint lifecycle is active, then release the queued messages as one batch after checkpoint success or failure. Keep Pi's existing continuation and compaction ordering, avoid awaiting release from lifecycle handlers, and document that detached OS processes are outside Pi's tool lifecycle visibility.

## Implemented
The extension tracks Pi tool execution lifecycle events and blocks `checkpoint` when another Pi tool or subagent is active without aborting it. It queues input events delivered by Pi from interactive/RPC sources during checkpoint processing and releases them exactly once through the terminal lifecycle path, including manual and automatic compaction boundaries, cancellation/failure paths, session shutdown, and short-session no-ops. Automatic compaction release waits for `agent_settled`; manual release waits for the public compaction callback. The README documents the public-API limits: RPC prompts rejected before `input`, Pi-native interactive queues, detached processes, slash commands, and the manual fallback when no automatic hook is exposed.

## Validation
Fresh independent verification passed: isolated `npm test` 48/48, `npm run check`, `git diff --check`, extension import smoke, and `npm pack --dry-run`. No provider-backed calls were made.

## Follow-up
Run a controlled provider-backed interactive/RPC smoke test when authenticated testing is available and acceptable. Revisit the input and automatic-compaction guarantees if Pi exposes a pre-lock input hook or public automatic compaction completion event.
