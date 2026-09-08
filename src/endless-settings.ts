import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export const ENDLESS_MODEL_KEY = "pi-context-checkpoint.endlessModel";
export type ModelRef = { provider: string; id: string };
export type Scope = "global" | "project";

export function parseModelSetting(value: unknown, source = "setting"): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") throw new Error(`${source} must be a provider/model string.`);
  if (!value.trim()) return undefined;
  if (!/^([^/\s]+)\/([^/\s]+)$/.test(value.trim())) {
    throw new Error(`${source} must use the provider/model format.`);
  }
  return value.trim();
}

export interface ResolveOptions<T extends ModelRef> {
  env?: string;
  project?: unknown;
  global?: unknown;
  projectSettings?: Record<string, unknown>;
  globalSettings?: Record<string, unknown>;
  active?: T;
  find: (provider: string, id: string) => T | undefined;
  hasConfiguredAuth: (model: T) => boolean;
}
function choose<T extends ModelRef>(value: unknown, source: string, options: ResolveOptions<T>): T | undefined {
  const ref = parseModelSetting(value, source);
  if (!ref) return undefined;
  const [, provider, id] = /^([^/\s]+)\/([^/\s]+)$/.exec(ref)!;
  const model = options.find(provider, id);
  if (!model) throw new Error(`checkpoint model ${ref} was not found in the model registry.`);
  if (!options.hasConfiguredAuth(model)) throw new Error(`checkpoint model ${provider}/${id} is missing configured authentication.`);
  return model;
}
export function resolveCheckpointModel<T extends ModelRef>(options: ResolveOptions<T>): T {
  // env presence (including empty string) is significant; persisted blank values are not.
  if (options.env !== undefined && !options.env.trim()) throw new Error("PI_CHECKPOINT_MODEL must use the provider/model format.");
  const projectValue = options.projectSettings ? options.projectSettings[ENDLESS_MODEL_KEY] : options.project;
  const globalValue = options.globalSettings ? options.globalSettings[ENDLESS_MODEL_KEY] : options.global;
  const selected = options.env !== undefined ? choose(options.env, "PI_CHECKPOINT_MODEL", options)
    : choose(projectValue, ENDLESS_MODEL_KEY, options) ?? choose(globalValue, ENDLESS_MODEL_KEY, options);
  if (selected) return selected;
  if (!options.active) throw new Error("checkpoint requires an active model; select an authenticated model first.");
  if (!options.hasConfiguredAuth(options.active)) throw new Error(`checkpoint model ${options.active.provider}/${options.active.id} is missing configured authentication.`);
  return options.active;
}

export function settingsPaths(cwd: string, agentDir = getAgentDir()): Record<Scope, string> {
  return { global: join(agentDir, "settings.json"), project: join(cwd, ".pi", "settings.json") };
}
async function readJson(path: string): Promise<Record<string, unknown>> {
  try {
    const text = await readFile(path, "utf8");
    const parsed: unknown = JSON.parse(text);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error(`${path} must contain a JSON object.`);
    return parsed as Record<string, unknown>;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw error;
  }
}
export async function readEndlessSetting(scope: Scope, paths: Record<Scope, string>, trusted = true): Promise<unknown> {
  if (scope === "project" && !trusted) throw new Error("Project settings require a trusted project.");
  return (await readJson(paths[scope]))[ENDLESS_MODEL_KEY];
}
export async function writeEndlessSetting(scope: Scope, value: string | null, paths: Record<Scope, string>, trusted = true): Promise<void> {
  if (scope === "project" && !trusted) throw new Error("Project settings require a trusted project.");
  const path = paths[scope];
  await mkdir(dirname(path), { recursive: true });
  const lock = `${path}.lock`;
  for (let i = 0; i < 100; i++) {
    try { await mkdir(lock); break; } catch (e) { if ((e as NodeJS.ErrnoException).code !== "EEXIST" || i === 99) throw e; await new Promise(r => setTimeout(r, 5)); }
  }
  try {
    const data = await readJson(path);
    if (value === null || !value.trim()) delete data[ENDLESS_MODEL_KEY]; else data[ENDLESS_MODEL_KEY] = value.trim();
    const temp = `${path}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(temp, `${JSON.stringify(data, null, 2)}\n`, "utf8");
    await rename(temp, path);
  } finally { await rm(lock, { recursive: true, force: true }); }
}

export async function readEndlessSettings(paths: Record<Scope, string>, trusted = true): Promise<{ project: unknown; global: unknown }> {
  // An untrusted project is not an error for checkpoint resolution: its
  // override is simply unavailable, while the global scope remains usable.
  const project = trusted ? await readEndlessSetting("project", paths, true) : undefined;
  const global = await readEndlessSetting("global", paths, true);
  return { project, global };
}
