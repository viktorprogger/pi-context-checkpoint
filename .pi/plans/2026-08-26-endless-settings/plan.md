# Implementation plan

## Ordered changes

1. **Add `src/endless-settings.ts`.** Define the public/internal extension types and constants for the `pi-context-checkpoint.endlessModel` key and canonical `provider/model` schema. Implement pure parsing and precedence resolution with injectable environment value, raw global/project values, active model, registry lookup, and auth predicate. The resolver must enforce `PI_CHECKPOINT_MODEL` (defined, including empty) > project > global > active, preserve explicit invalid/auth error messages, and distinguish absent/blank persisted settings from malformed values.
2. **Implement the settings adapter in `src/endless-settings.ts`.** Resolve the global settings path from Pi's exported agent-dir/config helper and the project path from `ctx.cwd/.pi/settings.json`. Read scopes independently; do not use Pi's merged effective settings. Add safe JSON read-modify-write that preserves unknown keys, creates the project directory/file when needed, uses a lock plus temporary-file/atomic rename strategy, and does not write project scope unless the caller has confirmed `ctx.isProjectTrusted()`. Expose narrow read/write functions so tests can use temporary paths without mutating a real home directory.
3. **Implement command orchestration and picker in `extensions/context-checkpoint.ts` / `src/endless-model-selector.ts`.** Register `endless-settings` beside the existing commands. Require `ctx.hasUI`, select global/project scope, then open an extension-owned `ctx.ui.custom()` picker using public `@earendil-works/pi-tui` primitives. Match the requested `/model` interaction contract: scope-specific Default row, provider/model rows, scoped/all TAB switching, text filtering, arrows, Enter, and Escape. Start scoped when scoped models exist, validate the selected model again with `find`/`hasConfiguredAuth`, and persist only after a completed selection. Handle cancellation, no available models, no UI, malformed registry entries, untrusted project scope, and write failures through notifications; never call `/model`, alter `ctx.model`, or import Pi's internal `ModelSelectorComponent`.
4. **Integrate resolution in `extensions/context-checkpoint.ts` and `src/checkpoint-core.ts`.** Replace the current two-argument `selectCheckpointModel` call, which only understands the environment override and active model, with a call that supplies the independently read settings and resolves at checkpoint-generation time. Keep `modelRegistry.complete`, message preparation, pass sequencing, compaction, and continuation behavior unchanged. If the resolver is better kept in the settings module, retain a small compatibility-facing core export only if existing callers/tests need it.
5. **Update `README.md`.** Document the setting key/schema, exact precedence, blank/null semantics, environment-variable behavior, trusted-project requirement, `/endless-settings` flow, and the intentional public-UI compatibility tradeoff versus Pi's internal `/model` selector. Replace the current statement that the environment override is simply selected over the active model with the full four-level order.
6. **Add `test/endless-settings.test.ts`.** Cover schema parsing and resolver precedence for all combinations: environment over project, project over global, global over active, active fallback, absent versus blank persisted values, defined empty/malformed environment value, malformed/non-string setting values, unknown models, and missing authentication. Cover global/project raw reads, unrelated-key preservation, file creation, atomic/locked update behavior, and refusal to read/write project settings when trust is false. Cover command registration with fake public UI/registry contexts, scope/model selection, cancellation at each level, no-UI handling, unavailable models, revalidation, and notifications.
7. **Modify `test/checkpoint-core.test.ts`.** Update existing model-selection tests and add assertions for the new resolver contract, especially that an explicit project/global candidate is selected before `active`, while `PI_CHECKPOINT_MODEL` is selected before both; retain malformed, missing-registry, missing-auth, and no-active error coverage.
8. **Modify `test/context-checkpoint.lifecycle.test.ts`.** Extend the fake context with settings paths/trust and registry model listings, set temporary global/project files or inject the adapter, and verify checkpoint generation sends the resolved model to both nested completion calls. Add command tests for `/endless-settings`, cancellation, project trust denial, and ensuring active chat model/default behavior is unchanged. Keep existing lifecycle/compaction assertions intact.

## API choice and compatibility tradeoff

Use the documented extension APIs (`registerCommand`, `ui.custom`, `ui.select`, `ui.notify`, `modelRegistry.getAvailable/find/hasConfiguredAuth`, `ctx.scopedModels`, `ctx.isProjectTrusted`) plus public `@earendil-works/pi-tui` primitives for the picker. This preserves the requested keyboard/filter/scoped interaction without importing Pi's internal `ModelSelectorComponent`/`ModelRuntime`; it may differ in minor visual/catalog-refresh details from `/model`. The command selects only this extension's setting and never changes Pi's active/default model.

## Setting, trust, and persistence contract

- Key: `pi-context-checkpoint.endlessModel`.
- Value: optional canonical `provider/model` string; missing, `null`, and blank persisted values are unset. Non-string or malformed non-empty persisted values are errors.
- `PI_CHECKPOINT_MODEL`: environment presence is highest precedence; including an empty value is treated as an invalid override, preserving current explicit-failure behavior.
- Project scope is available only when `ctx.isProjectTrusted()` is true. On false, the command reports refusal and performs no project read/write. Global selection remains available independently.
- Writes preserve all other JSON keys, use the exact Pi global/project paths, and are lock/atomic updates. A canceled or failed selection does not write.

## Verification commands

Run, in order:

```bash
npm test
npm run check
node -e "import('./extensions/context-checkpoint.ts')"
npm pack --dry-run
```

Also perform a manual trusted-project TUI smoke test: set global and project values, confirm project beats global and the environment beats both; cancel without changes; attempt project selection in an untrusted directory; select a model and run `/checkpoint` to confirm both nested calls use it while the active `/model` selection remains unchanged.
