import assert from "node:assert/strict";
import test from "node:test";

import { DEFAULT_COMPACTION_SETTINGS } from "@earendil-works/pi-coding-agent";

import {
  COMPACTION_RESERVE_TOKENS,
  appendContextUsageHint,
  compactionUsagePercent,
  contextUsageHint,
  usageBand,
  type ContextUsageLike,
} from "../src/context-usage-hint.ts";

const WINDOW = 200_000;
const RESERVE = 16_384;

function toolResult(text: string, toolCallId = "call-1"): any {
  return {
    role: "toolResult",
    toolCallId,
    toolName: "bash",
    content: [{ type: "text", text }],
    isError: false,
    timestamp: 3,
  };
}

const userMessage: any = { role: "user", content: "historical", timestamp: 1 };
const assistantMessage: any = {
  role: "assistant",
  content: [{ type: "text", text: "working" }],
  timestamp: 2,
};

const usageWithTokens = (tokens: number | null): ContextUsageLike => ({ tokens, contextWindow: WINDOW });

test("reserve constant mirrors Pi's default autocompact settings", () => {
  assert.equal(COMPACTION_RESERVE_TOKENS, DEFAULT_COMPACTION_SETTINGS.reserveTokens);
});

test("percent is measured against window minus reserve", () => {
  const limit = WINDOW - RESERVE; // 183616
  assert.equal(compactionUsagePercent(limit / 2, WINDOW, RESERVE), 50);
  assert.equal(compactionUsagePercent(limit, WINDOW, RESERVE), 100);
  assert.equal(compactionUsagePercent(0, WINDOW, RESERVE), 0);
  // Over the limit while threshold compaction has not fired yet.
  assert.ok(compactionUsagePercent(WINDOW, WINDOW, RESERVE) > 100);
});

test("percent handles degenerate limits and invalid token values", () => {
  assert.equal(compactionUsagePercent(5_000, RESERVE, RESERVE), 100);
  assert.equal(compactionUsagePercent(5_000, RESERVE - 1, RESERVE), 100);
  assert.equal(compactionUsagePercent(-42, WINDOW, RESERVE), 0);
  assert.equal(compactionUsagePercent(Number.NaN, WINDOW, RESERVE), 0);
  assert.equal(compactionUsagePercent(Number.POSITIVE_INFINITY, WINDOW, RESERVE), 100);
});

test("bands split at 20/50/70/85 and treat NaN as early", () => {
  const cases: Array<[number, ReturnType<typeof usageBand>]> = [
    [0, "early"],
    [19, "early"],
    [20, "optional"],
    [49, "optional"],
    [50, "good"],
    [69, "good"],
    [70, "tight"],
    [84, "tight"],
    [85, "urgent"],
    [100, "urgent"],
    [120, "urgent"],
    [Number.NaN, "early"],
  ];
  for (const [percent, band] of cases) {
    assert.equal(usageBand(percent), band, `band(${percent})`);
  }
});

test("hint text stays neutral below 20% and escalates wording above thresholds", () => {
  const early = contextUsageHint(12);
  assert.match(early, /12% of autocompact limit/);
  assert.doesNotMatch(early, /checkpoint/i);

  assert.match(contextUsageHint(30), /30% of autocompact limit - checkpoint only at a major milestone boundary\./);
  assert.match(contextUsageHint(55), /good time to call checkpoint at a phase boundary\./);
  assert.match(contextUsageHint(72), /context is getting tight - plan to checkpoint soon\./);
  assert.match(
    contextUsageHint(90),
    /URGENT: call checkpoint now regardless of task state; do not start new subtasks\./,
  );
});

test("hint marker wraps the one-line readout", () => {
  assert.equal(contextUsageHint(64.4), "64% of autocompact limit - good time to call checkpoint at a phase boundary.");
});

test("non-finite percent never renders as NaN", () => {
  assert.match(contextUsageHint(Number.NaN), /^0%/);
  assert.match(contextUsageHint(Number.POSITIVE_INFINITY), /^100%/);
});

test("hint is appended to a trailing tool result without mutating inputs", () => {
  const input = [userMessage, assistantMessage, toolResult("exit code 0")];
  const result = appendContextUsageHint(input, usageWithTokens((WINDOW - RESERVE) / 2), RESERVE);

  assert.notEqual(result, input);
  assert.equal(result.length, 3);
  assert.deepEqual(result[0], userMessage);
  assert.deepEqual(result[1], assistantMessage);

  const lastContent = (result[2] as any).content as Array<{ type: string; text: string }>;
  assert.equal(lastContent.length, 2);
  assert.deepEqual(lastContent[1], {
    type: "text",
    text: "<ctx-usage>50% of autocompact limit - good time to call checkpoint at a phase boundary.</ctx-usage>",
  });

  // Originals stay untouched (the extension relies on fresh deep copies).
  assert.equal(input[2].content.length, 1);
});

test("hint skips non-tool-result tails, unknown tokens, missing usage, and empty contexts", () => {
  const finalTurn = [userMessage, assistantMessage];
  assert.equal(appendContextUsageHint(finalTurn, usageWithTokens(90_000), RESERVE), finalTurn);

  const afterCompaction = [userMessage, toolResult("ok")];
  assert.equal(appendContextUsageHint(afterCompaction, usageWithTokens(null), RESERVE), afterCompaction);

  assert.equal(appendContextUsageHint(afterCompaction, undefined, RESERVE), afterCompaction);
  assert.equal(appendContextUsageHint([], usageWithTokens(90_000), RESERVE).length, 0);

  // Malformed tail content array is left alone rather than crashing the hook.
  const malformed: any[] = [{ role: "toolResult", toolCallId: "x", toolName: "bash", content: "not-an-array" }];
  assert.equal(appendContextUsageHint(malformed, usageWithTokens(90_000), RESERVE), malformed);
});

test("injected percent reflects real pressure numbers end to end", () => {
  // Pi default reserve on a 200k window: 183616 tokens of headroom.
  const tokens = Math.round((WINDOW - DEFAULT_COMPACTION_SETTINGS.reserveTokens) * 0.86);
  const result = appendContextUsageHint([toolResult("done")], { tokens, contextWindow: WINDOW });
  const injected = ((result[0] as any).content as Array<{ type: string; text: string }>)[1].text;
  assert.match(injected, /^<ctx-usage>86% of autocompact limit - URGENT:/);
});
