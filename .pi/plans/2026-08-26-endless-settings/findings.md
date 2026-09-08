# Findings

## Repository

- This package is a Pi extension (`package.json`, `pi.extensions`) whose implementation entry point is `extensions/context-checkpoint.ts`; checkpoint model selection currently uses `ctx.model` and `PI_CHECKPOINT_MODEL` (`extensions/context-checkpoint.ts:102-119`, `README.md: Configuration`). `ctx.modelRegistry.complete` is the supported nested-completion API in the current 0.84.x baseline.
- The requested setting affects checkpoint completions only; it must not change Pi's active chat model. Existing resolution is extension-owned and can remain pure/testable in `src/checkpoint-core.ts` or a new settings module.
- Pi settings are JSON files: global `~/.pi/agent/settings.json`, project `.pi/settings.json`; normal Pi effective settings use project over global, and project resources require trust (`@earendil-works/pi-coding-agent/docs/settings.md`, `docs/security.md`). The requested order is intentionally different and must read the two raw scopes separately.

## Supported APIs and constraints

- `ExtensionAPI.registerCommand` and `ctx.ui.select`/`notify` are public extension APIs. `ctx.modelRegistry.getAvailable()`, `find()`, `hasConfiguredAuth()`, `ctx.model`, `ctx.scopedModels`, `ctx.cwd`, and `ctx.isProjectTrusted()` are available on the command context.
- Pi's built-in `/model` uses the internal `ModelSelectorComponent` and session callbacks. An extension cannot soundly invoke the exact implementation through a documented public launcher; its exported component also requires internal `ModelRuntime`/TUI dependencies.
- There is no public generic settings writer or project default-model setter. `SettingsManager` exposes reads and some global default setters, but using those would alter Pi's normal active/default model. Independent extension settings therefore need a small raw JSON read-modify-write adapter, with atomic replacement/locking and preservation of unrelated keys.

## Required precedence and schema

Viktor clarified the final checkpoint selection precedence: **`PI_CHECKPOINT_MODEL` (when set) > project setting > global setting > current active model**. This resolves the prior contradiction in the earlier artifact, which had recommended active-model-first despite the environment-variable override requirement and README behavior.

- Use the namespaced JSON key `pi-context-checkpoint.endlessModel`.
- Its schema is an optional canonical `provider/model` string; missing, `null`, or empty/whitespace values mean unset. A present non-string or malformed non-empty value is invalid. For the environment variable, preserve existing behavior: if defined (including empty), validate it as `provider/model` and report an explicit error rather than silently falling through.
- For each configured candidate, parse `provider/model`, resolve with `modelRegistry.find(provider, modelId)`, and require configured authentication. A configured invalid/missing-auth candidate should produce the existing explicit error rather than silently falling through to a lower-priority source; only an absent setting falls through. If all settings are absent, use and authenticate the active model.

## UI and trust

- Register `/endless-settings`. Use public `ctx.ui.select` rather than internal `/model` implementation details: choose global/project scope, then an authenticated model from `getAvailable()`, validate again, and persist only after selection. This is a deliberate compatibility tradeoff: it is stable across Pi versions but does not promise exact `/model` search/grouping/refresh/Ctrl+S behavior. Project writes require `ctx.isProjectTrusted()`; untrusted projects must be rejected without writing. Global and project files must preserve unknown settings and be safely updated.

## Verification implications

- Tests need pure precedence/validation coverage, raw persistence coverage (including trust, preservation, creation, and concurrent/locked updates), command/UI registration/cancellation, and checkpoint integration proving the selected model reaches both nested completions.
- Existing checks documented in `README.md` are `npm test`, `npm run check`, `node -e "import('./extensions/context-checkpoint.ts')"`, and `npm pack --dry-run`.
