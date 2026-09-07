# Project Memory

## Context checkpoint lifecycle

- **Current rule:** The `checkpoint` extension tool and manual `/checkpoint` command copy the active compaction-aware LLM messages as structured context, remove the incomplete checkpoint tool call when applicable, and run two chained future-self passes: factual extraction followed by review/correction combined with final checkpoint generation. The manual command waits for Pi to become idle and uses safely defaulted progress fields. Both paths hand only the final durable checkpoint to Pi's compaction lifecycle and start one hidden continuation turn after successful manual or automatic extension compaction; when the public context estimate is at or below Pi's default keep-recent budget, they skip compaction as a successful no-op and queue the same continuation. The exact `Nothing to compact (session too small)` callback is also benign. Checkpoint compaction uses Pi's native retained-tail boundary so it does not discard more visible history than native `/compact`. Other compaction failures retain one pending checkpoint and expose `/checkpoint_context_recover`, which is only for that recovery case; only the user-invoked recovery command may create a replacement session.
- **Why:** Structured messages preserve conversational continuity better than a flattened transcript, while truncating the in-flight call avoids malformed nested provider context. Pi's extension-originated `sendUserMessage()` skips slash-command expansion, `sendMessage()` with `triggerTurn` is the public continuation path, and `newSession()` is restricted to command contexts to avoid deadlocks.
- **Authority:** `extensions/context-checkpoint.ts`, `src/checkpoint-core.ts`, and the task records for this feature.
- **History:** [2026-09-07 two-pass checkpoint generation](2026-09-07-two-pass-checkpoint-generation.md), [2026-08-20 manual checkpoint command](2026-08-20-manual-checkpoint-command.md), [2026-08-19 checkpoint rename and continuation](2026-08-19-checkpoint-continuation.md), [2026-08-19 small-session no-op](2026-08-19-ignore-small-session-compaction.md), [2026-08-18 structured continuation](2026-08-18-structured-continuation.md), [2026-08-18 hardened recovery](2026-08-18-harden-context-checkpoint.md), [2026-02-17 context checkpoint](2026-02-17-context-checkpoint.md)
- **Revisit:** Revisit summary-only compaction when Pi exposes an explicit zero-tail API or effective `keepRecentTokens` to extensions; current compaction follows Pi's native retained-tail boundary and uses the default keep-recent budget for its conservative preflight.

## Summary model selection

- **Current rule:** The active Pi model generates checkpoints unless `PI_CHECKPOINT_MODEL=provider/model` selects an available authenticated model.
- **Why:** This works without additional configuration while allowing a cheaper or stronger summarizer.
- **Authority:** `extensions/context-checkpoint.ts` and its README.
- **History:** [2026-02-17 context checkpoint](2026-02-17-context-checkpoint.md)
