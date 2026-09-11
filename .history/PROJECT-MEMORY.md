# Project Memory

## Context checkpoint lifecycle

- **Current rule:** The `checkpoint` extension tool and manual `/checkpoint` command copy the active compaction-aware LLM messages as structured context, remove the incomplete checkpoint tool call when applicable, and run two chained future-self passes: factual extraction followed by review/correction combined with final checkpoint generation. The manual command waits for Pi to become idle and uses safely defaulted progress fields. Both paths hand only the final durable checkpoint to Pi's compaction lifecycle and start one hidden continuation turn after successful manual or automatic extension compaction; when the public context estimate is at or below Pi's default keep-recent budget, they skip compaction as a successful no-op and queue the same continuation. The exact `Nothing to compact (session too small)` callback is also benign. Checkpoint compaction uses Pi's native retained-tail boundary so it does not discard more visible history than native `/compact`. Other compaction failures retain one pending checkpoint and expose `/checkpoint_context_recover`, which is only for that recovery case; only the user-invoked recovery command may create a replacement session.
- **Why:** Structured messages preserve conversational continuity better than a flattened transcript, while truncating the in-flight call avoids malformed nested provider context. Pi's extension-originated `sendUserMessage()` skips slash-command expansion, `sendMessage()` with `triggerTurn` is the public continuation path, and `newSession()` is restricted to command contexts to avoid deadlocks.
- **Authority:** `extensions/context-checkpoint.ts`, `src/checkpoint-core.ts`, and the task records for this feature.
- **History:** [2026-09-07 two-pass checkpoint generation](2026-09-07-two-pass-checkpoint-generation.md), [2026-08-20 manual checkpoint command](2026-08-20-manual-checkpoint-command.md), [2026-08-19 checkpoint rename and continuation](2026-08-19-checkpoint-continuation.md), [2026-08-19 small-session no-op](2026-08-19-ignore-small-session-compaction.md), [2026-08-18 structured continuation](2026-08-18-structured-continuation.md), [2026-08-18 hardened recovery](2026-08-18-harden-context-checkpoint.md), [2026-02-17 context checkpoint](2026-02-17-context-checkpoint.md)
- **Revisit:** Revisit summary-only compaction when Pi exposes an explicit zero-tail API or effective `keepRecentTokens` to extensions; current compaction follows Pi's native retained-tail boundary and uses the default keep-recent budget for its conservative preflight.

## Checkpoint timing

- **Current rule:** The LLM-facing checkpoint guidance treats `checkpoint` as an amortization boundary between two substantial phases: substantial work must already have accumulated and another substantial phase must remain. It explicitly excludes final-report checkpoints and pre-work checkpoints; context-pressure hints defer urgent calls to the next safe boundary between substantial phases when future substantial work exists.
- **Why:** Each checkpoint performs two nested LLM passes over the active context, so running it after the last substantial phase or before meaningful context exists can cost more than it saves.
- **Authority:** `extensions/context-checkpoint.ts`, `src/context-usage-hint.ts`, and `README.md`.
- **History:** [Trigger checkpoints between substantial phases](2026-09-11-between-substantial-phases.md), [Context usage hints for checkpoint timing](2026-08-25-context-usage-hints.md)
- **Revisit:** Revisit wording or thresholds after observing provider-backed timing behavior.

## Checkpoint summary model selection and settings

- **Current rule:** Immediately before checkpoint generation, resolve the model with precedence `PI_CHECKPOINT_MODEL → project → global → active`; only an available authenticated candidate is accepted. Persist overrides under the extension-owned `pi-context-checkpoint.endlessModel` key as `provider/model` in global or trusted-project settings. Global Default removes the global override; project Default removes the project override and therefore inherits global or active behavior. `/endless-settings` exposes the scoped model picker without changing Pi's active or default model.
- **Why:** Checkpoint summarization can use a separately configured model while preserving Pi's normal model selection and safely retaining unrelated settings fields. Project trust gating prevents untrusted project files from controlling model selection without disabling global fallback.
- **Authority:** `extensions/context-checkpoint.ts`, `src/endless-settings.ts`, `src/endless-model-selector.ts`, and `README.md`.
- **History:** [Checkpoint summary model settings](2026-09-07-endless-settings.md), [2026-02-17 context checkpoint](2026-02-17-context-checkpoint.md)
- **Revisit:** Run a controlled live-provider checkpoint when authenticated network testing is explicitly available and acceptable.
