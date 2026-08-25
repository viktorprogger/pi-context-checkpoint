# History

- 2026-08-25 — [Context usage hints for checkpoint timing](2026-08-25-context-usage-hints.md): Injects an ephemeral tail-of-context `<ctx-usage>` line via the `context` event so the model sees autocompact pressure each turn without session-file boilerplate.
- 2026-08-20 — [Manual checkpoint command and explicit recovery boundary](2026-08-20-manual-checkpoint-command.md): Adds `/checkpoint` as the shared generation/compaction/continuation path and keeps `/checkpoint_context_recover` for failed checkpoint compaction only.
- 2026-08-19 — [Preserve Pi's native compaction history boundary](2026-08-19-preserve-native-compaction-tail.md): Stops checkpoint compaction from forcing the checkpoint call to be the first visible retained entry.
- 2026-08-19 — [Checkpoint rename and continuation](2026-08-19-checkpoint-continuation.md): Renames the tool to `checkpoint` and resumes the agent after successful compaction or a short-session no-op.
- 2026-08-19 — [Small-session compaction no-op](2026-08-19-ignore-small-session-compaction.md): Treats Pi's exact `Nothing to compact (session too small)` result as successful without manual recovery.
- 2026-08-18 — [Structured continuation checkpoints](2026-08-18-structured-continuation.md): Replaced serialized evidence prompts with a chained structured-message future-self pipeline and formal continuity contract.
- 2026-08-18 — [Harden context checkpoint recovery and packaging](2026-08-18-harden-context-checkpoint.md): Replaced the unsupported automatic fallback with safe manual recovery and aligned the package with Pi 0.84.x.
- 2026-02-17 — [Context checkpoint extension](2026-02-17-context-checkpoint.md): Implemented LLM-callable phase checkpoints with draft/review/final synthesis, custom compaction, usage accounting, and a replacement-session fallback.
