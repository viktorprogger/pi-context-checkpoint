# Architecture

## Goal and boundaries

Add an extension-owned checkpoint-model setting and `/endless-settings` command without changing Pi core or Pi's active chat model. The extension owns schema, scoped persistence, precedence, validation, and command state. Existing checkpoint lifecycle, two-pass generation, abort handling, and nested `modelRegistry.complete` usage remain intact.

**The prior contradiction is resolved:** Viktor clarified that the environment override is highest priority. The authoritative order is now `PI_CHECKPOINT_MODEL` (when set) > project setting > global setting > current active model; the earlier active-model-first recommendation is obsolete.

## Resolution and data flow

At each checkpoint generation, read the raw global and project settings independently, then resolve in this exact order:

1. `PI_CHECKPOINT_MODEL` when the variable is defined;
2. `pi-context-checkpoint.endlessModel` in `.pi/settings.json`;
3. `pi-context-checkpoint.endlessModel` in global `~/.pi/agent/settings.json`;
4. `ctx.model`.

The setting value is an optional canonical `provider/model` string. Missing, `null`, or blank setting values are unset; a non-string or malformed non-empty setting is an error. A defined environment variable, including an empty value, retains current behavior and is validated as an override, so malformed input fails explicitly. Every configured reference is resolved with `modelRegistry.find()` and authenticated with `hasConfiguredAuth()`. An invalid or unauthenticated selected candidate fails explicitly; only an absent candidate falls through. The active fallback is also authenticated. Keep this resolver pure and pass its result to the existing completion path.

Do not use Pi's merged effective settings: Pi's normal project-over-global merge would invert the requested global/project ordering.

## Settings and persistence

Use the namespaced JSON key `pi-context-checkpoint.endlessModel`. A persistence adapter reads each file separately and performs locked/atomic JSON read-modify-write while preserving unrelated keys. Global path resolution uses Pi's agent-dir helper; project path is `<ctx.cwd>/.pi/settings.json`. Project reads and writes require `ctx.isProjectTrusted()`; an untrusted project gets a notification/error and no file mutation. The adapter does not call Pi's default-model setters because that would change Pi startup/active-model behavior, and no public generic project setting writer exists.

## `/endless-settings` UI/API choice

Register `pi.registerCommand("endless-settings", ...)`. With UI available, first select global/project scope, then open an extension-owned `ctx.ui.custom()` picker built from public `@earendil-works/pi-tui` primitives and keybindings. The picker must match the requested `/model` interaction contract: a scope-specific Default row, provider/model rows, scoped/all TAB switching, text filtering, arrows, Enter, and Escape. Start in scoped mode when scoped models exist. Revalidate a selected model through the registry before persisting. Cancellation at any stage leaves files unchanged. No-UI invocation reports that the command requires an interactive UI.

Do not import Pi's internal `ModelSelectorComponent`/`ModelRuntime`; that would be more visually exact but couples the package to internal constructor dependencies. The custom picker preserves the required interaction semantics and keeps the command from changing Pi's active/default model.

## Responsibilities and risks

- **Resolver:** pure precedence, parsing, registry lookup, and authentication logic.
- **Settings adapter:** scoped raw reads and safe writes, including trust and preservation rules.
- **Command:** UI orchestration and notifications; no checkpoint-generation side effects.
- **Checkpoint integration:** obtains settings at generation time and injects the resolved model only.

Main risks are concurrent JSON writes, runtime differences in available model APIs, and users expecting `/model` parity. Tests must cover lock/atomic behavior, malformed settings, trust denial, exact precedence, and both nested completions.

## Verification

Run unit/integration tests for resolver, persistence, command, and checkpoint model injection, then `npm test`, `npm run check`, `node -e "import('./extensions/context-checkpoint.ts')"`, and `npm pack --dry-run`. Manually smoke-test trusted global/project selection, cancellation, untrusted project rejection, environment precedence, and a checkpoint completion.
