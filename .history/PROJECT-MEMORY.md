# Project Memory

## Context checkpoint lifecycle

- **Current rule:** The `checkpoint_context` extension tool copies the active compaction-aware LLM messages as structured context, removes the incomplete checkpoint tool call, runs three chained future-self passes, and hands only the final continuation note to Pi's compaction lifecycle after the current turn. If compaction fails, it retains one pending checkpoint and exposes `/checkpoint_context_recover`; only that user-invoked command may create a replacement session.
- **Why:** Structured messages preserve conversational continuity better than a flattened transcript, while truncating the in-flight call avoids malformed nested provider context. Pi's extension-originated `sendUserMessage()` skips slash-command expansion, and `newSession()` is restricted to command contexts to avoid deadlocks.
- **Authority:** `extensions/context-checkpoint.ts`, `src/checkpoint-core.ts`, and the task records for this feature.
- **History:** [2026-08-18 structured continuation](2026-08-18-structured-continuation.md), [2026-08-18 hardened recovery](2026-08-18-harden-context-checkpoint.md), [2026-02-17 context checkpoint](2026-02-17-context-checkpoint.md)
- **Revisit:** Revisit summary-only compaction when Pi exposes an explicit zero-tail API; current compaction keeps the valid checkpoint tool-call tail.

## Summary model selection

- **Current rule:** The active Pi model generates checkpoints unless `PI_CHECKPOINT_MODEL=provider/model` selects an available authenticated model.
- **Why:** This works without additional configuration while allowing a cheaper or stronger summarizer.
- **Authority:** `extensions/context-checkpoint.ts` and its README.
- **History:** [2026-02-17 context checkpoint](2026-02-17-context-checkpoint.md)
