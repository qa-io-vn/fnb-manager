import type { TickSummary } from "./repository.js";

export const CYCLE_COUNT_KEYS = [
	"claimed",
	"sent",
	"retried",
	"failed",
	"uncertain",
	"lost_lease",
	"finish_errors",
	"render_failed",
	"digests_built",
	"digests_failed",
	"digest_messages",
	"poll_rounds",
	"poll_skipped",
	"poll_errors",
	"links_matched",
	"links_accepted",
	"updates_discarded",
] as const;

export type CycleCountKey = (typeof CYCLE_COUNT_KEYS)[number];

export class CycleReport {
	tick: TickSummary | null = null;
	stoppedBy: string | null = null;
	private readonly values = new Map<CycleCountKey, number>();

	add(key: CycleCountKey, amount = 1): void {
		this.values.set(key, (this.values.get(key) ?? 0) + amount);
	}

	get(key: CycleCountKey): number {
		return this.values.get(key) ?? 0;
	}

	counts(): Record<CycleCountKey, number> {
		return Object.fromEntries(
			CYCLE_COUNT_KEYS.map((key) => [key, this.get(key)]),
		) as Record<CycleCountKey, number>;
	}

	line(): string {
		return [
			`messages sent ${this.get("sent")}`,
			`retried ${this.get("retried")}`,
			`failed ${this.get("failed")}`,
			`uncertain ${this.get("uncertain")}`,
			`lost lease ${this.get("lost_lease")}`,
			`links matched ${this.get("links_matched")}`,
			`accepted ${this.get("links_accepted")}`,
		].join(" · ");
	}
}

export function emptyCycleReport(): CycleReport {
	return new CycleReport();
}
