import { DEFAULT_COMPACTION_SETTINGS } from "@earendil-works/pi-coding-agent";
import type { AgentMessage } from "@earendil-works/pi-agent-core";

/**
 * Pi auto-compacts when context tokens exceed `contextWindow - reserveTokens`
 * (see `shouldCompact` in pi's compaction core). Checkpoint guidance therefore
 * measures pressure against this effective limit, not against the full window.
 */
export const COMPACTION_RESERVE_TOKENS: number = DEFAULT_COMPACTION_SETTINGS.reserveTokens;

/** Structural subset of Pi's `ContextUsage` used for hint computation. */
export interface ContextUsageLike {
	/** Estimated context tokens, or null when unknown (e.g. right after compaction). */
	tokens: number | null;
	contextWindow: number;
}

/**
 * Checkpoint-pressure bands as percent of the autocompact limit consumed:
 * - early (<25): too early to checkpoint;
 * - optional (25-49): only at a major milestone boundary;
 * - good (50-69): best time for a phase checkpoint;
 * - tight (70-84): context is running out, wrap up soon;
 * - urgent (85+): checkpoint immediately regardless of task state.
 */
export type UsageHintBand = "early" | "optional" | "good" | "tight" | "urgent";

const BAND_ADVICE: Record<UsageHintBand, string> = {
	early: "",
	optional: "checkpoint only at a major milestone boundary.",
	good: "good time to call checkpoint at a phase boundary.",
	tight: "context is getting tight - plan to checkpoint soon.",
	urgent: "URGENT: call checkpoint now regardless of task state; do not start new subtasks.",
};

/**
 * Percent of the autocompact limit currently consumed. Values above 100 are
 * possible while waiting for threshold compaction to kick in (+Infinity maps
 * to 100 as "no headroom left"); NaN and negative tokens report 0 because
 * they carry no usable measurement. A degenerate (non-positive) limit reports
 * 100 because there is no headroom by definition.
 */
export function compactionUsagePercent(
	tokens: number,
	contextWindow: number,
	reserveTokens: number = COMPACTION_RESERVE_TOKENS,
): number {
	if (!Number.isFinite(contextWindow) || !Number.isFinite(reserveTokens)) return 100;
	const limit = contextWindow - reserveTokens;
	if (!(limit > 0)) return 100;
	if (tokens === Number.POSITIVE_INFINITY) return 100;
	const safeTokens = Number.isFinite(tokens) && tokens > 0 ? tokens : 0;
	return Math.round((safeTokens / limit) * 100);
}

export function usageBand(percent: number): UsageHintBand {
	if (!(percent >= 25)) return "early";
	if (percent < 50) return "optional";
	if (percent < 70) return "good";
	if (percent < 85) return "tight";
	return "urgent";
}

/** One-line LLM-facing readout. The early band stays neutral: silence is the "too early" signal. */
export function contextUsageHint(percent: number): string {
	// Defense-in-depth mirroring compactionUsagePercent: never render "NaN%";
	// +Infinity means "no headroom left", NaN and negatives carry no measurement.
	const safePercent = !Number.isFinite(percent)
		? percent === Number.POSITIVE_INFINITY
			? 100
			: 0
		: Math.max(0, percent);
	const base = `${Math.round(safePercent)}% of autocompact limit`;
	const advice = BAND_ADVICE[usageBand(percent)];
	return advice ? `${base} - ${advice}` : base;
}

/**
 * Append an ephemeral `<ctx-usage>` hint to the LAST message when it is a tool
 * result, which places the marker at the very end of LLM-visible context with
 * maximal recency attention. The mutation is meant for Pi's `context` event
 * (deep copy, never persisted), so the session file keeps no accumulating
 * boilerplate copies. Returns the ORIGINAL reference when nothing changed so
 * callers can skip re-emitting unchanged messages.
 */
export function appendContextUsageHint(
	messages: readonly AgentMessage[],
	usage: ContextUsageLike | undefined,
	reserveTokens: number = COMPACTION_RESERVE_TOKENS,
): AgentMessage[] {
	if (
		!usage ||
		usage.tokens === null ||
		!Number.isFinite(usage.tokens) ||
		!Number.isFinite(usage.contextWindow) ||
		messages.length === 0
	) {
		return messages as AgentMessage[];
	}
	const last = messages[messages.length - 1];
	const candidate = last as unknown as { role?: unknown; content?: unknown } | undefined;
	if (!candidate || candidate.role !== "toolResult" || !Array.isArray(candidate.content)) {
		return messages as AgentMessage[];
	}

	const percent = compactionUsagePercent(usage.tokens, usage.contextWindow, reserveTokens);
	const block = { type: "text", text: `<ctx-usage>${contextUsageHint(percent)}</ctx-usage>` };
	const nextLast = { ...(last as object), content: [...candidate.content, block] };
	return [...messages.slice(0, -1), nextLast] as AgentMessage[];
}
