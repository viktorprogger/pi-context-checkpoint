# Project Memory

## Context checkpoint lifecycle

- **Current rule:** The `checkpoint_context` extension tool summarizes the active Pi context with a draft/review/final model pipeline and hands the final summary to Pi's compaction lifecycle after the current turn.
- **Why:** The checkpoint must preserve rationale and unfinished work without letting the summary tool call interrupt its own turn.
- **Authority:** `extensions/context-checkpoint.ts` and the task record for this feature.
- **History:** [2026-02-17 context checkpoint](2026-02-17-context-checkpoint.md)
- **Revisit:** Revisit the replacement-session fallback if Pi exposes a supported public API for zero-tail compaction.

## Summary model selection

- **Current rule:** The active Pi model generates checkpoints unless `PI_CHECKPOINT_MODEL=provider/model` selects an available authenticated model.
- **Why:** This works without additional configuration while allowing a cheaper or stronger summarizer.
- **Authority:** `extensions/context-checkpoint.ts` and its README.
- **History:** [2026-02-17 context checkpoint](2026-02-17-context-checkpoint.md)
