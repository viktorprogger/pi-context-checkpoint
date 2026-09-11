# Trigger checkpoints between substantial phases

## Problem
The checkpoint costs two nested LLM passes over the active context, so calling it after the last substantial work—before a short final report—can cost more than it saves. Calling it before substantial work also wastes that cost when little context has accumulated. The timing guidance must make the checkpoint a bridge between two substantial phases of an ongoing task.

## Decision and approach
Rewrite the LLM-facing guidance and dynamic context-pressure hints to require both sides of the bridge: substantial work has already accumulated and another substantial phase remains. Explicitly reject final-report checkpoints and pre-work checkpoints with little prior work. Preserve urgent pressure guidance, but defer the call to the next safe phase boundary when a substantial phase remains rather than demanding an unconditional mid-task call.

## Implemented
Updated the checkpoint tool prompt and README guidance to make `checkpoint` a bridge between substantial completed work and another substantial phase, excluding final-report and pre-work calls. Updated context-pressure hints to recommend the next safe substantial-phase boundary rather than an unconditional mid-task call, including urgent pressure. Added focused coverage for the prompt guidance and all revised hint wording and injection behavior.

## Validation
- Full `npm test`: 37/37 passed in an isolated `HOME`.
- `npm run check` passed.
- Focused checkpoint lifecycle and context-usage hint tests passed.
- `git diff --check` passed.
- Live provider-backed behavior remains unverified.

## Follow-up
Observe live checkpoint timing if provider-backed interactive testing becomes available.
