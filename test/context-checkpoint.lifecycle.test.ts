import assert from "node:assert/strict";
import test from "node:test";

import contextCheckpoint from "../extensions/context-checkpoint.ts";

type AnyFn = (...args: any[]) => any;

function fixture() {
  const events = new Map<string, AnyFn>() as Map<string, AnyFn> & { get(key: string): AnyFn };
  const commands = new Map<string, AnyFn>() as Map<string, AnyFn> & { get(key: string): AnyFn };
  const tools = new Map<string, any>();
  const notifications: string[] = [];
  const completions: any[] = [];
  const appended: any[] = [];
  let compactOptions: any;
  let newSessions = 0;
  let sessionFile = "parent.jsonl";

  const api: any = {
    on(name: string, handler: AnyFn) {
      events.set(name, handler);
    },
    registerCommand(name: string, options: { handler: AnyFn }) {
      commands.set(name, options.handler);
    },
    registerTool(tool: any) {
      tools.set(tool.name, tool);
    },
  };
  contextCheckpoint(api);

  const context = (hasUI = true): any => ({
    hasUI,
    signal: new AbortController().signal,
    model: { provider: "test", id: "model" },
    modelRegistry: {
      find: () => undefined,
      hasConfiguredAuth: () => true,
      complete: async (...args: any[]) => {
        completions.push(args);
        return { content: [{ type: "text", text: `pass-${completions.length}` }] };
      },
    },
    ui: { notify: (message: string) => notifications.push(message) },
    compact: (options: any) => {
      compactOptions = options;
    },
    sessionManager: {
      getBranch: () => [],
      getSessionFile: () => sessionFile,
    },
    newSession: async (options: any) => {
      newSessions += 1;
      sessionFile = "replacement.jsonl";
      await options.setup({
        appendMessage: (message: any) => appended.push(message),
      });
      await options.withSession(context());
      return { cancelled: false };
    },
  });

  return {
    events,
    commands,
    tools,
    notifications,
    completions,
    appended,
    get compactOptions() {
      return compactOptions;
    },
    get newSessions() {
      return newSessions;
    },
    context,
  };
}

const params = {
  stage: "implementation",
  status: "ready",
  completed: ["write code"],
  incomplete: [],
  nextActions: ["run tests"],
  notes: "deterministic test",
};

async function executeCheckpoint(f: ReturnType<typeof fixture>) {
  return f.tools.get("checkpoint_context").execute("tool-1", params, undefined, undefined, f.context());
}

test("registers and executes the tool with three nested completions, then persists custom compaction", async () => {
  const f = fixture();
  assert.ok(f.tools.has("checkpoint_context"));
  const result = await executeCheckpoint(f);
  assert.equal(f.completions.length, 3);
  assert.equal(result.terminate, true);

  await f.events.get("turn_end")!({
    toolResults: [{ toolName: "checkpoint_context", toolCallId: "tool-1" }],
  }, f.context());
  assert.ok(f.compactOptions);
  const before = await f.events.get("session_before_compact")!({
    preparation: { firstKeptEntryId: "fallback", tokensBefore: 42 },
    signal: new AbortController().signal,
  }, f.context());
  assert.equal(before.compaction.summary, "pass-3");
  assert.equal(before.compaction.tokensBefore, 42);
  assert.equal(before.compaction.details.toolCallId, "tool-1");
  f.compactOptions.onComplete({ summary: "runtime summary" });
  assert.equal(f.notifications.length, 0);
});

test("compaction error arms one manual recovery and the command seeds a replacement session", async () => {
  const f = fixture();
  await executeCheckpoint(f);
  await f.events.get("turn_end")!({
    toolResults: [{ toolName: "checkpoint_context", toolCallId: "tool-1" }],
  }, f.context());
  f.compactOptions.onError(new Error("nothing to compact"));
  f.compactOptions.onError(new Error("duplicate"));
  assert.match(f.notifications[0], /\/checkpoint_context_recover/);
  assert.equal(f.commands.has("checkpoint_context_recover"), true);

  await f.commands.get("checkpoint_context_recover")!("", f.context());
  await f.commands.get("checkpoint_context_recover")!("", f.context());
  assert.equal(f.newSessions, 1);
  assert.equal(f.appended[0].content, "pass-3");
  assert.equal(f.completions.length, 3);
});

test("recovery does not notify through the old context after cancelled replacement", async () => {
  const f = fixture();
  await executeCheckpoint(f);
  await f.events.get("turn_end")!({
    toolResults: [{ toolName: "checkpoint_context", toolCallId: "tool-1" }],
  }, f.context());
  f.compactOptions.onError(new Error("failure"));

  const recoveryContext = f.context();
  let attempts = 0;
  recoveryContext.newSession = async () => {
    attempts += 1;
    await Promise.resolve();
    recoveryContext.ui.notify = () => {
      throw new Error("stale context used");
    };
    return { cancelled: true };
  };

  const errors: string[] = [];
  const originalError = console.error;
  console.error = (...args: any[]) => errors.push(args.join(" "));
  try {
    await f.commands.get("checkpoint_context_recover")!("", recoveryContext);
    // A fresh command context remains usable for retry after cancellation.
    await f.commands.get("checkpoint_context_recover")!("", f.context());
  } finally {
    console.error = originalError;
  }

  assert.equal(attempts, 1);
  assert.equal(f.newSessions, 1);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /cancelled/);
});

test("session_start clears stale pending recovery", async () => {
  const f = fixture();
  await executeCheckpoint(f);
  await f.events.get("turn_end")!({
    toolResults: [{ toolName: "checkpoint_context", toolCallId: "tool-1" }],
  }, f.context());
  f.compactOptions.onError(new Error("failure"));
  await f.events.get("session_start")!({}, f.context());
  await f.commands.get("checkpoint_context_recover")!("", f.context());
  assert.equal(f.newSessions, 0);
});
