# Project Memory

## Context checkpoint lifecycle

- **Current rule:** The `checkpoint_context` extension tool summarizes the active Pi context with a draft/review/final model pipeline and hands the final summary to Pi's compaction lifecycle after the current turn. If compaction fails, it retains one pending checkpoint and exposes `/checkpoint_context_recover`; only that user-invoked command may create a replacement session.
- **Why:** The checkpoint must preserve rationale and unfinished work without letting the summary tool call interrupt its own turn. Pi's extension-originated `sendUserMessage()` skips slash-command expansion, and `newSession()` is restricted to command contexts to avoid deadlocks.
- **Authority:** `extensions/context-checkpoint.ts` and the task records for this feature.
- **History:** [2026-08-18 hardened recovery](2026-08-18-harden-context-checkpoint.md), [2026-02-17 context checkpoint](2026-02-17-context-checkpoint.md)
- **Revisit:** Revisit automatic recovery only if Pi exposes a supported public API for session replacement from lifecycle events or zero-tail compaction.

## Summary model selection

- **Current rule:** The active Pi model generates checkpoints unless `PI_CHECKPOINT_MODEL=provider/model` selects an available authenticated model.
- **Why:** This works without additional configuration while allowing a cheaper or stronger summarizer.
- **Authority:** `extensions/context-checkpoint.ts` and its README.
- **History:** [2026-02-17 context checkpoint](2026-02-17-context-checkpoint.md)
