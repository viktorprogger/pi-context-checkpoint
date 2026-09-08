import assert from "node:assert/strict";
import { test } from "node:test";
import { modelPicker } from "../src/endless-model-selector.ts";

test("Kitty printable input filters the model list", () => {
  const picker = modelPicker({ requestRender() {} }, [
    { provider: "provider", id: "q-model" },
    { provider: "provider", id: "other-model" },
  ], [], "default", () => {});

  (picker as any).handleInput("\x1b[113u");
  const rendered = picker.render(80).join("\n");
  assert.match(rendered, /provider\/q-model/);
  assert.doesNotMatch(rendered, /provider\/other-model/);
});

test("renders the exact global and project default labels", () => {
  const globalPicker = modelPicker({ requestRender() {} }, [], [], "Default (current active)", () => {});
  const projectPicker = modelPicker({ requestRender() {} }, [], [], "Default (inherit global setting)", () => {});

  assert.match(globalPicker.render(80).join("\n"), /Default \(current active\)/);
  assert.match(projectPicker.render(80).join("\n"), /Default \(inherit global setting\)/);
});
