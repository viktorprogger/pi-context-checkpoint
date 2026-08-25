# Context usage hints for checkpoint timing

## Problem
The agent had no visibility into how close it was to Pi's auto-compaction threshold, so checkpoint timing was guesswork: too early wastes three nested LLM calls, too late loses durable context to a generic emergency compaction summary. The signal needed high model attention (recency tail), freshness on every turn, and no accumulating boilerplate that trains habituation.

## Decision and approach
Inject an ephemeral `<ctx-usage>` one-liner via Pi's `context` event (deep copy before each LLM call, never persisted) appended only to a trailing `toolResult`, instead of persistent injection (`tool_result` mutation / custom messages), which accumulates copies in the session file and causes alert fatigue. Static interpretation rules live in a `promptGuidelines` bullet; dynamic data lives alone at the context tail — this split keeps provider prefix caching valid up to the natural growth point. Bands measure percent of the autocompact limit (`contextWindow - DEFAULT_COMPACTION_SETTINGS.reserveTokens`), not of the full window: <20% neutral silence (no "too early" nagging — silence is the signal), 20-49% milestone-only, 50-69% best time, 70-84% tight, >=85% urgent regardless of task state. Rejected: dynamic system-prompt updates (cache-invalidating) and a pull-based status tool (relies on the agent remembering to check — the exact failure mode being fixed).

## Implemented
- `src/context-usage-hint.ts`: pure band/percent/hint logic plus `appendContextUsageHint` splice helper with identity-return contract on no-op paths.
- `extensions/context-checkpoint.ts`: `pi.on("context")` handler; shared `readContextUsage(ctx)` helper replacing duplicated defensive casts; second promptGuidelines bullet stating the band policy.
- README section documenting the hint behavior.

## Validation
- `npm test`: 31 pass, 0 fail (percent math vs `shouldCompact`, all band boundaries 19/20/49/50/69/70/84/85, immutability, identity-return, non-finite handling; lifecycle harness covers the registered `context` handler end to end: injection into trailing toolResult, no-op returns undefined, assistant-final tail skipped).
- `npm run check` clean; extension smoke import OK; `npm pack --dry-run` includes the module.
- Independent verifier PASS: confirmed `context` event deep-copy/non-persistence semantics in pi dist, no leak into nested checkpoint passes (they bypass transformContext), guideline bullet names the tool explicitly.
- Verified live in an interactive Pi session: the `<ctx-usage>` line renders after tool results with correct early-band neutrality (5% on a fresh session).

## Follow-up
If Pi exposes effective custom compaction settings publicly, replace reliance on `DEFAULT_COMPACTION_SETTINGS` so settings.json overrides are reflected.
