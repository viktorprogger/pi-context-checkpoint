# Concise checkpoint resumption contract

## Problem
The checkpoint prompts preserve broad task state but leave current user reversals, permission/wait gates, and delegated-work verification state implicit.

## Decision and approach
Strengthen existing prompt clauses with minimal replacements rather than new sections or a skill. Preserve current user scope and exclusions over superseded plans; make the next authorized action or required question/wait explicit; conditionally preserve delegated/background state and distinguish reported from verified results. Do not impose a personal agent workflow or change checkpoint timing, lifecycle, or APIs.

## Implemented
Reworded four existing final-pass clauses: constraints retain limits/impacts and user exclusions; original-plan history is distinct from current user decisions; executed work distinguishes reported results from verification and conditionally records delegated ownership/state; next actions include required clarification, approval, or waiting. Removed redundant explanations in those clauses. The final contract grows from 422 to 435 whitespace-separated words; the draft, headings, lifecycle, and APIs are unchanged.

## Validation
The focused regression failed before implementation; a subsequent verifier-required regression reproduced missing user authority before correction. Fresh independent verification passed: focused tests 10/10, isolated-HOME full suite 53/53, `npm run check`, `git diff --check`, and artifact links. A follow-up test-isolation fix now redirects lifecycle tests to a temporary `PI_CODING_AGENT_DIR`, restoring the prior environment and removing the directory afterward; focused lifecycle tests pass 27/27 and the ordinary-HOME full suite passes 53/53. Production model selection is unchanged, no provider calls were made, and provider-backed summary quality remains unverified by deterministic tests.
