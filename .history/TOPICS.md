# Topics

## Checkpoint model selection and settings

Model-resolution precedence, persisted overrides, trust boundaries, and the `/endless-settings` picker.

- [Checkpoint summary model settings](2026-09-07-endless-settings.md)

## Checkpoint lifecycle and continuation

Generation, compaction, continuation, and recovery boundaries.

- [Reduce checkpoint generation to two LLM passes](2026-09-07-two-pass-checkpoint-generation.md)
- [Manual checkpoint command and explicit recovery boundary](2026-08-20-manual-checkpoint-command.md)
- [Preserve Pi's native compaction history boundary](2026-08-19-preserve-native-compaction-tail.md)
- [Checkpoint rename and continuation](2026-08-19-checkpoint-continuation.md)
- [Small-session compaction no-op](2026-08-19-ignore-small-session-compaction.md)
- [Structured continuation checkpoints](2026-08-18-structured-continuation.md)
- [Harden context checkpoint recovery and packaging](2026-08-18-harden-context-checkpoint.md)
- [Context checkpoint extension](2026-02-17-context-checkpoint.md)

## Context and checkpoint timing

Context-usage signaling used to guide checkpoint timing.

- [Context usage hints for checkpoint timing](2026-08-25-context-usage-hints.md)
