# Retry empty checkpoint-model output

## Problem

A nested checkpoint completion can return a successful response with only whitespace or no usable text. Treating that transient response as final failure makes the checkpoint tool fail even when the provider can recover immediately. The failure must still reach the agent as a failed tool result if bounded recovery is exhausted.

## Decision and approach

Keep the existing two sequential checkpoint passes and retry only whitespace-only extracted output. Each pass makes the initial request plus up to three retries, with a fresh UUIDv7 nested session ID for every attempt. Provider exceptions, aborts, malformed responses, and explicit error stop reasons continue to fail immediately. After the retry budget is exhausted, `completePass` throws the existing stage-specific empty-output error; Pi converts the thrown custom-tool error into a model-visible failed tool result.

## Implemented

Updated `src/checkpoint-core.ts` to bound empty-output retries independently for the draft and final passes. Added regressions covering recovery after an initial empty response and the final-pass exhaustion path, including the expected five calls when the draft succeeds and all four final attempts are empty. Updated the README and project records with the retry contract.

## Validation

- Focused empty-output regressions: passed.
- Isolated-HOME `npm test`: 52/52 passed.
- `npm run check`: passed.
- Provider-backed live behavior and usage accounting for discarded empty responses remain unverified.
