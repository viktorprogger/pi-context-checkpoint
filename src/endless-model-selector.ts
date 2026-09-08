import { Box, decodeKittyPrintable, Input, SelectList, Text, type Component, type SelectItem } from "@earendil-works/pi-tui";

export interface PickerModel { provider: string; id: string }
const theme = { selectedPrefix: (s: string) => `> ${s}`, selectedText: (s: string) => s, description: (s: string) => s, scrollInfo: (s: string) => s, noMatch: (s: string) => s };
/** A small extension-owned picker; it never edits Pi's active/default model. */
export function modelPicker(tui: any, scopedModels: PickerModel[], allModels: PickerModel[], defaultLabel: string, done: (value: string | undefined) => void): Component {
  let allMode = !scopedModels.length;
  const input = new Input();
  const heading = new Text(`Checkpoint model\nTab: ${allMode ? "scoped" : "all"} models  Esc: cancel`);
  let active = new SelectList([], 12, theme);
  const pool = () => allMode ? allModels : scopedModels;
  const refresh = () => {
    const filter = input.getValue().toLowerCase();
    const items: SelectItem[] = [{ value: "", label: defaultLabel }, ...pool()
      .filter((m) => `${m.provider}/${m.id}`.toLowerCase().includes(filter))
      .map((m) => ({ value: `${m.provider}/${m.id}`, label: `${m.provider}/${m.id}` }))];
    active = new SelectList(items, 12, theme);
    active.onSelect = (item) => done(item.value);
    active.onCancel = () => done(undefined);
  };
  refresh();
  input.onSubmit = () => done(active.getSelectedItem()?.value);
  input.onEscape = () => done(undefined);
  const list: Component = { render: (width) => active.render(width), handleInput: (key) => active.handleInput(key), invalidate: () => active.invalidate() };
  const root = new Box(1, 1);
  root.addChild(heading); root.addChild(input); root.addChild(list);
  (root as any).handleInput = (key: string) => {
    if (key === "\t") { allMode = !allMode; refresh(); tui.requestRender?.(); return; }
    if (key === "\x1b") { done(undefined); return; }
    if (decodeKittyPrintable(key) !== undefined) { input.handleInput(key); refresh(); tui.requestRender?.(); return; }
    if (key === "\r" || key === "\n" || key.startsWith("\x1b[")) { active.handleInput(key); tui.requestRender?.(); return; }
    input.handleInput(key); refresh(); tui.requestRender?.();
  };
  return root;
}
