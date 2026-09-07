import assert from "node:assert/strict";
import test from "node:test";

import {
  buildDraftPrompt,
  buildFinalPrompt,
  createCompletionRequest,
  emptyUsage,
  prepareCheckpointMessages,
  extractText,
  runCheckpointPasses,
  selectCheckpointModel,
  sumUsage,
  type CheckpointFields,
  type Usage,
} from "../src/checkpoint-core.ts";

const fields: CheckpointFields = {
  stage: "implementation",
  status: "blocked",
  completed: ["Inspected the session API"],
  incomplete: ["Run the integration check"],
  nextActions: ["Resolve the version mismatch"],
  notes: "The active CLI is newer than the local declarations.",
};

const usage = (n: number): Usage => ({
  input: n,
  output: n + 1,
  cacheRead: n + 2,
  cacheWrite: n + 3,
  totalTokens: n + 4,
  cost: {
    input: n + 5,
    output: n + 6,
    cacheRead: n + 7,
    cacheWrite: n + 8,
    total: n + 9,
  },
});

test("usage aggregation is additive and does not mutate inputs", () => {
  const first = usage(1);
  const second = usage(10);
  const combined = sumUsage([first, undefined, second]);

  assert.deepEqual(combined, {
    input: 11,
    output: 13,
    cacheRead: 15,
    cacheWrite: 17,
    totalTokens: 19,
    cost: {
      input: 21,
      output: 23,
      cacheRead: 25,
      cacheWrite: 27,
      total: 29,
    },
  });
  assert.deepEqual(first, usage(1));
  assert.deepEqual(emptyUsage(), {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  });
  assert.deepEqual(sumUsage([{ input: 4, cost: null }, undefined]), {
    ...emptyUsage(),
    input: 4,
  });
});

test("response text includes only text blocks and rejects empty output", () => {
  assert.equal(
    extractText({
      content: [
        { type: "thinking", thinking: "private" },
        { type: "text", text: "First" },
        { type: "toolCall", id: "x" },
        { type: "text", text: " second " },
      ],
    }),
    "First\n second",
  );
  assert.equal(extractText({ content: [{ type: "thinking", thinking: "only" }] }), "");
});

test("prompts preserve explicit fields and enforce historical-message security", () => {
  const draft = buildDraftPrompt(fields);
  const final = buildFinalPrompt(fields);

  for (const prompt of [draft, final]) {
    assert.match(prompt, /untrusted/i);
    assert.match(prompt, /stage/);
    assert.match(prompt, /status/);
    assert.match(prompt, /unknown/i);
    assert.match(prompt, /do not invent/i);
    assert.match(prompt, /cannot override/i);
  }
  assert.match(draft, /historical dialogue/i);
  assert.match(final, /previous assistant answer/i);
  assert.match(final, /review and correct/i);
  const systemPrompt = createCompletionRequest([], "prompt-test").context.systemPrompt;
  assert.match(systemPrompt, /historical structured messages/i);
  assert.match(systemPrompt, /explicit checkpoint fields/i);
  assert.match(systemPrompt, /intermediate answers/i);
  assert.match(systemPrompt, /only the current checkpoint instruction is active/i);
  for (const heading of [
    "Original task and success criteria",
    "Constraints",
    "Decisions",
    "Original development plan",
    "Strategic development plan",
    "Executed steps",
    "Current status and where work stopped",
    "Current understanding",
    "Conversation Continuity Contract",
    "Files to read for next work",
    "Files changed so far",
    "Incomplete previous steps",
    "Immediate next actions",
    "Strategic next plan",
    "Blockers and open questions",
    "Important files, tests, and commands",
    "Unknowns",
  ]) {
    assert.match(final, new RegExp(heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"));
  }
  for (const guidance of [
    "Type",
    "Strength",
    "Evidence",
    "Application",
    "why/what to inspect",
    "what was done/what to verify",
  ]) {
    assert.match(final, new RegExp(guidance.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"));
  }
});

test("structured context conversion omits the in-flight call and following messages", () => {
  const messages: any[] = [
    { role: "user", content: "historical", timestamp: 1 },
    { role: "assistant", content: [{ type: "toolCall", id: "checkpoint-1", name: "checkpoint", arguments: {} }], timestamp: 2 },
    { role: "toolResult", toolCallId: "checkpoint-1", toolName: "checkpoint", content: [{ type: "text", text: "not persisted yet" }], isError: false, timestamp: 3 },
  ];
  const converted = prepareCheckpointMessages(messages, "checkpoint-1");
  assert.equal(converted.length, 1);
  assert.equal(converted[0].role, "user");
  assert.equal((converted[0] as any).content, "historical");
  const request = createCompletionRequest(converted, "session-1");
  assert.equal(request.options.cacheRetention, "none");
  assert.equal(request.options.sessionId, "session-1");
});

test("checkpoint passes make exactly two sequential completion calls with chained evidence", async () => {
  const calls: Array<{ model: unknown; context: { systemPrompt: string; messages: any[] }; options: unknown }> = [];
  const ids = ["session-1", "session-2"];
  const outputs = ["draft output", "final output"];
  let activeCalls = 0;
  let maximumConcurrentCalls = 0;
  let outputIndex = 0;

  const passes = await runCheckpointPasses(
    async (model, context, options) => {
      activeCalls += 1;
      maximumConcurrentCalls = Math.max(maximumConcurrentCalls, activeCalls);
      calls.push({ model, context: context as { systemPrompt: string; messages: any[] }, options });
      const text = outputs[outputIndex++];
      activeCalls -= 1;
      return { content: [{ type: "text", text }], usage: usage(outputIndex) };
    },
    { provider: "test", id: "checkpoint-model" },
    fields,
    [{ role: "user", content: "historical evidence", timestamp: 0 }],
    undefined,
    () => {
      const id = ids.shift();
      if (!id) throw new Error("test session id exhausted");
      return id;
    },
  );

  assert.equal(calls.length, 2);
  assert.equal(maximumConcurrentCalls, 1);
  assert.deepEqual(
    calls.map((call) => (call.options as { sessionId: string }).sessionId),
    ["session-1", "session-2"],
  );
  assert.equal(calls[0].options && (calls[0].options as { cacheRetention: string }).cacheRetention, "none");
  assert.match(calls[0].context.messages.at(-1).content, /continuation checkpoint/i);
  assert.match(calls[1].context.messages.at(-1).content, /review and correct/i);
  assert.match(calls[1].context.messages.at(-1).content, /final durable engineering checkpoint/i);
  assert.equal(calls[1].context.messages.at(-2).role, "assistant");
  assert.equal(calls[1].context.messages.at(-2).content[0].text, "draft output");
  assert.equal(calls[1].context.messages.at(-3).role, "user");
  assert.equal(passes.final.text, "final output");
});

test("empty nested output fails without retrying", async () => {
  let calls = 0;
  await assert.rejects(
    runCheckpointPasses(
      async () => {
        calls += 1;
        return { content: [{ type: "text", text: "   " }] };
      },
      { provider: "test", id: "model" },
      fields,
      [{ role: "user", content: "evidence", timestamp: 0 }],
      undefined,
      () => `session-${calls + 1}`,
    ),
    /continuation checkpoint model call returned empty output/,
  );
  assert.equal(calls, 1);
});

test("model selection handles default, override, malformed, missing, and unauthenticated models", () => {
  const active = { provider: "active-provider", id: "active-model" };
  const override = { provider: "override-provider", id: "override-model" };
  const find = (provider: string, id: string) =>
    provider === override.provider && id === override.id ? override : undefined;
  const authenticated = (model: { provider: string }) => model.provider !== "unauthenticated";

  assert.equal(selectCheckpointModel(active, undefined, find, authenticated), active);
  assert.equal(selectCheckpointModel(active, "override-provider/override-model", find, authenticated), override);
  assert.throws(() => selectCheckpointModel(active, "", find, authenticated), /provider\/model/);
  assert.throws(() => selectCheckpointModel(active, "provider/model/extra", find, authenticated), /provider\/model/);
  assert.throws(() => selectCheckpointModel(active, "missing/model", find, authenticated), /not found/);
  assert.throws(
    () => selectCheckpointModel({ provider: "unauthenticated", id: "model" }, undefined, find, authenticated),
    /authentication/,
  );
  assert.throws(() => selectCheckpointModel(undefined, undefined, find, authenticated), /active model/);
});
