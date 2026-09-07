# Reduce checkpoint generation to two LLM passes

## Problem
Each checkpoint currently performs draft, review, and final completion requests, replaying the full conversation three times and increasing cost and latency.

## Decision and approach
Use two sequential passes: retain factual extraction in the first pass, then combine review/correction with final durable checkpoint generation in the second pass. Preserve the existing evidence-safety rules, required continuity sections, usage aggregation, compaction lifecycle, and structured-message chaining.

## Implemented
The checkpoint now makes exactly two sequential completion requests: factual extraction first, followed by a chained review/correction pass that emits the final durable checkpoint. Structured assistant evidence, usage aggregation, evidence-safety rules, and the compaction/continuation lifecycle remain unchanged.

## Validation
The full test suite passes (31/31), including focused checkpoint and lifecycle coverage. `npm run check`, extension import, `npm pack --dry-run`, and `git diff --check` also pass. The current implementation uses a 25% context-usage threshold, and its stale boundary documentation/test expectations were synchronized.

## Follow-up
Benchmark one-pass generation later if checkpoint quality data supports further reduction.
