import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { ENDLESS_MODEL_KEY, parseModelSetting, readEndlessSettings, resolveCheckpointModel, settingsPaths, writeEndlessSetting } from "../src/endless-settings.ts";

test("checkpoint model precedence is environment, project, global, active", () => {
  const active = { provider: "a", id: "active" }, global = { provider: "g", id: "global" }, project = { provider: "p", id: "project" }, env = { provider: "e", id: "env" };
  const find = (provider: string, id: string) => [active, global, project, env].find((m) => m.provider === provider && m.id === id);
  const auth = () => true;
  assert.equal(resolveCheckpointModel({ env: "e/env", project: "p/project", global: "g/global", active, find, hasConfiguredAuth: auth }), env);
  assert.equal(resolveCheckpointModel({ projectSettings: { [ENDLESS_MODEL_KEY]: "p/project" }, global: "g/global", active, find, hasConfiguredAuth: auth }), project);
  assert.equal(resolveCheckpointModel({ global: "g/global", active, find, hasConfiguredAuth: auth }), global);
  assert.equal(resolveCheckpointModel({ active, find, hasConfiguredAuth: auth }), active);
  assert.throws(() => resolveCheckpointModel({ env: "", active, find, hasConfiguredAuth: auth }), /provider\/model/);
});

test("untrusted project settings are unavailable without blocking global fallback", async () => {
  const root = await mkdtemp(join(tmpdir(), "checkpoint-settings-trust-"));
  const paths = settingsPaths(join(root, "project"), join(root, "agent"));
  await mkdir(join(root, "agent"), { recursive: true });
  await writeFile(paths.global, JSON.stringify({ [ENDLESS_MODEL_KEY]: "global/model" }), "utf8");
  const stored = await readEndlessSettings(paths, false);
  assert.equal(stored.project, undefined);
  assert.equal(stored.global, "global/model");
  const global = { provider: "global", id: "model" };
  assert.equal(resolveCheckpointModel({ project: stored.project, global: stored.global, active: { provider: "active", id: "model" }, find: (provider, id) => provider === global.provider && id === global.id ? global : undefined, hasConfiguredAuth: () => true }), global);
});

test("settings writes preserve unrelated keys and create parent directories", async () => {
  const root = await mkdtemp(join(tmpdir(), "checkpoint-settings-"));
  const paths = settingsPaths(join(root, "project"), join(root, "agent"));
  await writeEndlessSetting("project", "provider/model", paths, true);
  const data = JSON.parse(await readFile(paths.project, "utf8"));
  assert.equal(data[ENDLESS_MODEL_KEY], "provider/model");
  await writeEndlessSetting("project", null, paths, true);
  assert.equal(JSON.parse(await readFile(paths.project, "utf8"))[ENDLESS_MODEL_KEY], undefined);
  assert.equal(parseModelSetting("  "), undefined);
});
