import type { BusinessDateWindow } from "@fnb/connector-core";
import { businessDate } from "@fnb/core";
import { type Redactor, type StoreRecord, safeErrorMessage } from "@fnb/sync";
import type { RunnerEnvironment } from "./connectors.js";

export const LOYALTY_FAST_LANE_VARIABLE = "LOYALTY_FAST_LANE";
export const FAST_LANE_WINDOW_MINUTES = 60;
export const FAST_LANE_SPACING_MINUTES = 5;

export type LoyaltyCounts = Readonly<Record<string, number>>;

export interface FastLaneRun {
	readonly runId: string;
	readonly tenantId: string;
	readonly storeId: string;
	readonly windowFrom: string;
	readonly windowTo: string;
}

export interface LoyaltyDatabase {
	reconcileLoyalty(
		tenantId: string,
		window: BusinessDateWindow,
		at: Date,
	): Promise<LoyaltyCounts | null>;
	loyaltyNightly(tenantId: string, at: Date): Promise<LoyaltyCounts>;
	loyaltyTenants(): Promise<{ tenantId: string; slug: string }[]>;
	claimFastLaneRuns(at: Date, limit: number): Promise<FastLaneRun[]>;
	finishFastLaneRun(runId: string, outcome: string, at: Date): Promise<void>;
}

export type LoyaltyStepOutcome =
	| { readonly status: "reconciled"; readonly counts: LoyaltyCounts }
	| { readonly status: "skipped"; readonly reason: string }
	| { readonly status: "failed"; readonly error: string };

export function fastLaneEnabled(environment: RunnerEnvironment): boolean {
	return (
		(environment[LOYALTY_FAST_LANE_VARIABLE] ?? "").trim().toLowerCase() ===
		"on"
	);
}

export function fastLaneWindow(
	store: Pick<StoreRecord, "timezone" | "business_day_start_minutes">,
	at: Date,
	minutes: number = FAST_LANE_WINDOW_MINUTES,
): BusinessDateWindow {
	if (!Number.isInteger(minutes) || minutes < 1 || minutes > 24 * 60) {
		throw new RangeError(
			`a fast-lane window covers 1 to 1440 minutes, got ${minutes}`,
		);
	}
	const from = new Date(at.getTime() - minutes * 60_000);
	return {
		fromDate: businessDate(
			from,
			store.timezone,
			store.business_day_start_minutes,
		),
		toDate: businessDate(at, store.timezone, store.business_day_start_minutes),
	};
}

export function windowDays(window: BusinessDateWindow): number {
	const from = Date.parse(`${window.fromDate}T00:00:00Z`);
	const to = Date.parse(`${window.toDate}T00:00:00Z`);
	return Math.round((to - from) / 86_400_000) + 1;
}

export async function reconcileLoyaltySafely(
	database: Pick<LoyaltyDatabase, "reconcileLoyalty"> | undefined,
	tenantId: string,
	window: BusinessDateWindow,
	at: Date,
	redact: Redactor,
): Promise<LoyaltyStepOutcome> {
	if (!database) {
		return { status: "skipped", reason: "not_wired" };
	}
	try {
		const counts = await database.reconcileLoyalty(tenantId, window, at);
		return counts === null
			? { status: "skipped", reason: "no_active_programme" }
			: { status: "reconciled", counts };
	} catch (error) {
		return { status: "failed", error: safeErrorMessage(error, redact) };
	}
}

export function loyaltyLine(outcome: LoyaltyStepOutcome): string {
	if (outcome.status === "skipped") {
		return `loyalty: skipped (${outcome.reason})`;
	}
	if (outcome.status === "failed") {
		return `loyalty: failed (${outcome.error})`;
	}
	const parts = Object.entries(outcome.counts)
		.filter(([, value]) => value !== 0)
		.sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
		.map(([key, value]) => `${key} ${value}`);
	return `loyalty: reconciled${parts.length > 0 ? `, ${parts.join(", ")}` : ", nothing to do"}`;
}
