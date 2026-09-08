# Checkpoint summary model settings

## Problem
Checkpoint summaries needed an independently configurable model without changing Pi's active or default model, while project settings had to remain restricted to trusted projects.

## Decision and approach
Resolve the model immediately before checkpoint generation with the precedence `PI_CHECKPOINT_MODEL → project → global → active`. Store the extension-owned `pi-context-checkpoint.endlessModel` value as `provider/model`; treat the scoped Default action as removal of that override. Use public extension UI APIs for `/endless-settings` and a custom picker rather than Pi's internal model-selector components. Read and write project settings only for trusted projects, preserving unrelated settings fields through locked atomic read-modify-write operations.

## Implemented
Added global/project settings persistence, resolver and trust-aware fallback; `/endless-settings` with exact global/project Default labels, scoped/full model lists, Tab switching, filtering, keyboard navigation, cancellation, and Kitty CSI-u handling; and checkpoint integration for both summary-generation passes. The active/default Pi model and existing checkpoint lifecycle remain unchanged.

## Validation
Independent verification passed with `npm test` (36/36), `npm run check`, import smoke, `npm pack --dry-run`, and `git diff --check`. Real PTY Pi smoke with cached authenticated model metadata and `PI_OFFLINE=1` exercised global/project scopes, exact Default labels, picker cancellation/closure, Tab, and text filtering. No live provider completion was run.

## Follow-up
Run an authenticated-provider checkpoint only when controlled credentials and network effects are explicitly acceptable.
