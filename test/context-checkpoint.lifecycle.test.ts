import assert from "node:assert/strict";
import test from "node:test";

import contextCheckpoint from "../extensions/context-checkpoint.ts";

type AnyFn = (...args: any[]) => any;

function fixture() {
  const events = new Map<string, AnyFn>() as Map<string, AnyFn> & { get(key: string): AnyFn };
  const commands = new Map<string, AnyFn>() as Map<string, AnyFn> & { get(key: string): AnyFn };
  const commandDescriptions = new Map<string, string>();
  const tools = new Map<string, any>();
  const notifications: string[] = [];
  const sentMessages: any[] = [];
  const completions: any[] = [];
  let waitForIdleCalls = 0;
  const appended: any[] = [];
  let compactOptions: any;
  let compactCalls = 0;
  let contextUsage: { tokens: number | null } | undefined;
  let newSessions = 0;
  let sessionFile = "parent.jsonl";

  const api: any = {
    on(name: string, handler: AnyFn) {
      events.set(name, handler);
    },
    registerCommand(name: string, options: { handler: AnyFn; description?: string }) {
      commands.set(name, options.handler);
      commandDescriptions.set(name, options.description ?? "");
    },
    registerTool(tool: any) {
      tools.set(tool.name, tool);
    },
    sendMessage(message: any, options: any) {
      sentMessages.push({ message, options });
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
    getContextUsage: () => contextUsage,
    waitForIdle: async () => {
      waitForIdleCalls += 1;
    },
    compact: (options: any) => {
      compactCalls += 1;
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
    commandDescriptions,
    tools,
    notifications,
    sentMessages,
    completions,
    appended,
    get compactOptions() {
      return compactOptions;
    },
    get compactCalls() {
      return compactCalls;
    },
    setContextUsage(usage: { tokens: number | null } | undefined) {
      contextUsage = usage;
    },
    get newSessions() {
      return newSessions;
    },
    get waitForIdleCalls() {
      return waitForIdleCalls;
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
  return f.tools.get("checkpoint").execute("tool-1", params, undefined, undefined, f.context());
}

test("tool guidance makes checkpoint a bridge between substantial phases", () => {
  const f = fixture();
  const tool = f.tools.get("checkpoint");
  const promptSnippet = tool.promptSnippet;
  assert.match(promptSnippet, /between two substantial phases/i);
  assert.match(promptSnippet, /after substantial work/i);
  assert.match(promptSnippet, /another substantial phase remaining/i);
  assert.match(promptSnippet, /not for a final\/pre-work or immediate pressure-driven call/i);
  const guidelines = tool.promptGuidelines.join(" ");
  assert.match(guidelines, /between two substantial parts/i);
  assert.match(guidelines, /after substantial work has accumulated/i);
  assert.match(guidelines, /another substantial phase remains/i);
  assert.match(guidelines, /not a final report/i);
  assert.match(guidelines, /before substantial work has accumulated/i);
  assert.match(guidelines, /no recommendation means do not call/i);
});

test("registers the manual command and runs exactly two completions after waiting for idle", async () => {
  const f = fixture();
  assert.equal(f.commands.has("checkpoint"), true);
  await f.commands.get("checkpoint")!("", f.context());
  assert.equal(f.waitForIdleCalls, 1);
  assert.equal(f.completions.length, 2);
  assert.equal(f.compactCalls, 1);
});

test("manual checkpoint skips compaction for a short session and continues", async () => {
  const f = fixture();
  f.setContextUsage({ tokens: 1 });
  await f.commands.get("checkpoint")!("", f.context());
  assert.equal(f.completions.length, 2);
  assert.equal(f.compactCalls, 0);
  assert.equal(f.sentMessages.length, 1);
});

test("manual checkpoint compaction completion requests one continuation", async () => {
  const f = fixture();
  await f.commands.get("checkpoint")!("", f.context());
  assert.equal(f.compactCalls, 1);
  f.compactOptions.onComplete({ summary: "runtime summary" });
  f.compactOptions.onComplete({ summary: "duplicate" });
  assert.equal(f.sentMessages.length, 1);
});

test("manual checkpoint command guard avoids a second generation", async () => {
  const f = fixture();
  const first = f.commands.get("checkpoint")!("", f.context());
  const second = f.commands.get("checkpoint")!("", f.context());
  await Promise.all([first, second]);
  assert.equal(f.completions.length, 2);
  assert.match(f.notifications[0], /already generating|compacting/);
});

test("recovery command warns that it is only for checkpoint compaction errors and reports no pending recovery", async () => {
  const f = fixture();
  await f.commands.get("checkpoint_context_recover")!("", f.context());
  assert.match(f.notifications[0], /No checkpoint recovery is pending/);
  assert.match(f.commandDescriptions.get("checkpoint_context_recover") ?? "", /ONLY/i);
});

test("registers and executes the tool with two nested completions, then persists custom compaction", async () => {
  const f = fixture();
  assert.ok(f.tools.has("checkpoint"));
  const result = await executeCheckpoint(f);
  assert.equal(f.completions.length, 2);
  assert.equal(result.terminate, true);

  await f.events.get("turn_end")!({
    toolResults: [{ toolName: "checkpoint", toolCallId: "tool-1" }],
  }, f.context());
  assert.equal(f.compactCalls, 0);
  assert.equal(f.compactOptions, undefined);
  await f.events.get("agent_settled")!({}, f.context());
  const compactOptions: any = f.compactOptions;
  assert.ok(compactOptions);
  const before = await f.events.get("session_before_compact")!({
    preparation: { firstKeptEntryId: "fallback", tokensBefore: 42 },
    signal: new AbortController().signal,
  }, f.context());
  assert.equal(before.compaction.summary, "pass-2");
  assert.equal(before.compaction.firstKeptEntryId, "fallback");
  assert.equal(before.compaction.tokensBefore, 42);
  assert.equal(before.compaction.details.toolCallId, "tool-1");
  assert.equal(f.sentMessages.length, 0);
  compactOptions.onComplete({ summary: "runtime summary" });
  compactOptions.onComplete({ summary: "duplicate" });
  assert.equal(f.notifications.length, 0);
  assert.equal(f.sentMessages.length, 1);
  assert.equal(f.sentMessages[0].message.customType, "checkpoint-continuation");
  assert.equal(f.sentMessages[0].message.display, false);
  assert.equal(f.sentMessages[0].options.triggerTurn, true);
});

test("automatic compaction completion also resumes the agent without duplication", async () => {
  const f = fixture();
  await executeCheckpoint(f);
  await f.events.get("turn_end")!({
    toolResults: [{ toolName: "checkpoint", toolCallId: "tool-1" }],
  }, f.context());
  assert.equal(f.compactCalls, 0);

  await f.events.get("session_compact")!({
    fromExtension: true,
    reason: "threshold",
    compactionEntry: { details: { version: 1, toolCallId: "tool-1" } },
  }, f.context());

  assert.equal(f.sentMessages.length, 1);
  assert.equal(f.sentMessages[0].options.triggerTurn, true);
  assert.equal(f.sentMessages[0].options.deliverAs, "followUp");
  assert.equal(f.compactOptions, undefined);
  assert.equal(f.sentMessages.length, 1);
});

test("blocks later tool calls in the same assistant batch", async () => {
  const f = fixture();
  const checkpointCall = await f.events.get("tool_call")!({ toolName: "checkpoint" }, f.context());
  assert.equal(checkpointCall, undefined);
  const blocked = await f.events.get("tool_call")!({ toolName: "bash" }, f.context());
  assert.equal(blocked.block, true);
  assert.equal(blocked.terminate, true);
  await f.events.get("turn_end")!({ toolResults: [] }, f.context());
  assert.equal(await f.events.get("tool_call")!({ toolName: "bash" }, f.context()), undefined);
});

test("known tiny session skips compaction without arming recovery", async () => {
  const f = fixture();
  f.setContextUsage({ tokens: 1 });
  await executeCheckpoint(f);
  await f.events.get("turn_end")!({
    toolResults: [{ toolName: "checkpoint", toolCallId: "tool-1" }],
  }, f.context());

  assert.equal(f.compactCalls, 0);
  assert.equal(f.notifications.length, 0);
  assert.equal(f.sentMessages.length, 0);
  await f.events.get("agent_settled")!({}, f.context());
  assert.equal(f.sentMessages.length, 1);
  assert.equal(f.sentMessages[0].options.deliverAs, undefined);
  await assert.doesNotReject(() => executeCheckpoint(f));
});

test("tiny-session compaction callback is a successful no-op for races and older runtimes", async () => {
  const f = fixture();
  await executeCheckpoint(f);
  await f.events.get("turn_end")!({
    toolResults: [{ toolName: "checkpoint", toolCallId: "tool-1" }],
  }, f.context());
  await f.events.get("agent_settled")!({}, f.context());

  assert.equal(f.compactCalls, 1);
  f.compactOptions.onError(new Error("Nothing to compact (session too small)"));
  f.compactOptions.onError(new Error("duplicate"));

  assert.equal(f.notifications.length, 0);
  assert.equal(f.sentMessages.length, 1);
  assert.equal(f.sentMessages[0].options.deliverAs, undefined);
  await assert.doesNotReject(() => executeCheckpoint(f));
});

test("compaction error arms one manual recovery and the command seeds a replacement session", async () => {
  const f = fixture();
  await executeCheckpoint(f);
  await f.events.get("turn_end")!({
    toolResults: [{ toolName: "checkpoint", toolCallId: "tool-1" }],
  }, f.context());
  await f.events.get("agent_settled")!({}, f.context());
  f.compactOptions.onError(new Error("nothing to compact"));
  f.compactOptions.onError(new Error("duplicate"));
  assert.equal(f.sentMessages.length, 0);
  assert.match(f.notifications[0], /\/checkpoint_context_recover/);
  assert.equal(f.commands.has("checkpoint_context_recover"), true);

  await f.commands.get("checkpoint_context_recover")!("", f.context());
  await f.commands.get("checkpoint_context_recover")!("", f.context());
  assert.equal(f.newSessions, 1);
  assert.equal(f.appended[0].content, "pass-2");
  assert.equal(f.completions.length, 2);
});

test("recovery does not notify through the old context after cancelled replacement", async () => {
  const f = fixture();
  await executeCheckpoint(f);
  await f.events.get("turn_end")!({
    toolResults: [{ toolName: "checkpoint", toolCallId: "tool-1" }],
  }, f.context());
  await f.events.get("agent_settled")!({}, f.context());
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
    toolResults: [{ toolName: "checkpoint", toolCallId: "tool-1" }],
  }, f.context());
  await f.events.get("agent_settled")!({}, f.context());
  f.compactOptions.onError(new Error("failure"));
  await f.events.get("session_start")!({}, f.context());
  await f.commands.get("checkpoint_context_recover")!("", f.context());
  assert.equal(f.newSessions, 0);
});

test("context handler injects the ctx-usage hint only when useful", async () => {
  const f = fixture();
  assert.ok(f.events.has("context"));

  const messages: any[] = [
    { role: "user", content: "hi", timestamp: 1 },
    {
      role: "toolResult",
      toolCallId: "call-1",
      toolName: "bash",
      content: [{ type: "text", text: "ok" }],
      isError: false,
      timestamp: 2,
    },
  ];
  const event = { type: "context", messages };

  // No usage reported -> no change, nothing re-emitted.
  assert.equal(await f.events.get("context")!(event, f.context()), undefined);

  // Known pressure on a 200k window: 157910 tokens is 86% of the 183616-token autocompact limit.
  f.setContextUsage({ tokens: 157_910, contextWindow: 200_000 } as { tokens: number | null });
  const result = await f.events.get("context")!({ type: "context", messages }, f.context());
  assert.ok(result);
  assert.notEqual(result.messages, messages);
  const injected = result.messages[1].content[1];
  assert.deepEqual(injected, {
    type: "text",
    text: "<ctx-usage>86% of autocompact limit - URGENT: checkpoint at the next safe boundary between substantial phases if substantial work remains; do not start new subtasks.</ctx-usage>",
  });
  // Inputs stay untouched (pi hands handlers deep copies, but we never mutate anyway).
  assert.equal(messages[1].content.length, 1);

  // Assistant-final tail -> skip silently for that turn.
  const finalTurn = [
    { role: "user", content: "hi", timestamp: 1 },
    { role: "assistant", content: [{ type: "text", text: "done" }], timestamp: 2 },
  ];
  assert.equal(await f.events.get("context")!({ type: "context", messages: finalTurn }, f.context()), undefined);
});
