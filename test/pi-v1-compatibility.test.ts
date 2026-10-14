import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const packageJson = JSON.parse(readFileSync(join(projectRoot, "package.json"), "utf8")) as {
  engines?: { node?: string };
  peerDependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};

test("targets the Pi 1 package family and runtime", () => {
  assert.equal(packageJson.engines?.node, ">=22.19.0");

  for (const packageName of [
    "@earendil-works/pi-agent-core",
    "@earendil-works/pi-ai",
    "@earendil-works/pi-coding-agent",
    "@earendil-works/pi-tui",
  ]) {
    assert.equal(packageJson.peerDependencies?.[packageName], ">=1.0.0");
    assert.equal(packageJson.devDependencies?.[packageName], "1.0.0");
  }

  assert.equal(packageJson.devDependencies?.["@earendil-works/pi-ai"], "1.0.0");
  assert.equal(packageJson.devDependencies?.typebox, "1.3.27");
});
