import {
	type CardModel,
	COVERAGE_CALL_KEY,
	type ReportSource,
	type ReportStore,
} from "@fnb/reports";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	type CardsPlan,
	type LoadContext,
	type PlannedCall,
	useCardsLoad,
} from "./use-cards-load";

const AS_OF = "2026-11-03";

const STORE: ReportStore = {
	id: "11111111-1111-4111-8111-111111111111",
	name: "Cửa hàng mẫu",
	timeZone: "Asia/Ho_Chi_Minh",
	businessDayStartMinutes: 0,
};

interface Context extends LoadContext {
	readonly to: string;
}

const source = vi.hoisted(() => ({ current: null as unknown }));

vi.mock("../data/analytics-source-context", () => ({
	useAnalyticsSourceState: () => ({ status: "ready", source: source.current }),
}));

interface FakeSource extends ReportSource {
	readonly log: string[];
	failNext: Set<string>;
}

function fakeSource(): FakeSource {
	const log: string[] = [];
	const answer = async (name: string, args: unknown) => {
		log.push(`${name} ${JSON.stringify(args)}`);
		if (fake.failNext.has(name)) {
			fake.failNext.delete(name);
			throw new Error(`${name} failed`);
		}
		if (name === "store_coverage") return [];
		if (name === "range_totals") return [{ row: 1 }, { row: 2 }];
		return [{ row: 1 }];
	};
	const fake: FakeSource = {
		kind: "demo",
		log,
		failNext: new Set(),
		call: answer as ReportSource["call"],
		callTheme: answer as ReportSource["callTheme"],
	};
	return fake;
}

function card(id: string): CardModel {
	return { id } as unknown as CardModel;
}

function rangeArgs(to: string) {
	return {
		store_ids: [STORE.id],
		from_dates: ["2026-10-07"],
		to_dates: [to],
	};
}

function plan(withPrevious = false): CardsPlan<Context> {
	return {
		cards: [
			{
				id: "totals",
				needs: ["totals", "twin"],
				visible: () => true,
				build: ({ results }) =>
					card(`totals:${results.rows("totals", "range_totals")?.length}`),
			},
			{
				id: "series",
				needs: ["series"],
				visible: () => true,
				build: ({ results }) =>
					card(`series:${results.rows("series", "period_series")?.length}`),
			},
		],
		primaryCalls: (context): PlannedCall[] => [
			{
				key: COVERAGE_CALL_KEY,
				name: "store_coverage",
				args: {
					store_ids: [STORE.id],
					from_date: "2026-10-07",
					to_date: context.to,
				},
			},
			{ key: "totals", name: "range_totals", args: rangeArgs(context.to) },
			{ key: "twin", name: "range_totals", args: rangeArgs(context.to) },
		],
		followUpCalls: (context, _coverage, results): PlannedCall[] => [
			{
				key: "series",
				name: "period_series",
				args: {
					store_ids: [STORE.id],
					grain: "day",
					from_date: "2026-10-07",
					to_date: context.to,
					rows: results.rows("totals", "range_totals")?.length ?? 0,
				},
			},
		],
		asOf: () => AS_OF,
		previous: (context) =>
			withPrevious ? { ...context, to: "2026-10-06" } : null,
	};
}

const CONTEXT: Context = {
	tenantId: "tenant-1",
	stores: [STORE],
	sample: true,
	to: AS_OF,
};

function load(cardsPlan: CardsPlan<Context>) {
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	const wrapper = ({ children }: { children: ReactNode }) => (
		<QueryClientProvider client={client}>{children}</QueryClientProvider>
	);
	return renderHook(() => useCardsLoad(cardsPlan, CONTEXT), { wrapper });
}

function idsOf(result: { current: ReturnType<typeof useCardsLoad> }) {
	return result.current.cards.map((entry) =>
		entry.status === "ready" ? entry.model.id : entry.status,
	);
}

let current: FakeSource;

beforeEach(() => {
	current = fakeSource();
	source.current = current;
});

describe("useCardsLoad", () => {
	it("plans the follow-ups once coverage answers and plans them again when their inputs arrive", async () => {
		let releaseTotals: () => void = () => undefined;
		const totalsHeld = new Promise<void>((resolve) => {
			releaseTotals = resolve;
		});
		const answer = current.callTheme;
		current.callTheme = (async (name: string, args: unknown) => {
			if (name === "range_totals") await totalsHeld;
			return answer(name as never, args as never);
		}) as typeof current.callTheme;
		const { result } = load(plan());
		await waitFor(() =>
			expect(
				current.log.filter((entry) => entry.startsWith("period_series")),
			).toHaveLength(1),
		);
		expect(
			current.log.find((entry) => entry.startsWith("period_series")),
		).toContain('"rows":0');
		expect(idsOf(result)[0]).toBe("loading");
		act(() => releaseTotals());
		await waitFor(() =>
			expect(idsOf(result)).toEqual(["totals:2", "series:1"]),
		);
		const series = current.log.filter((entry) =>
			entry.startsWith("period_series"),
		);
		expect(series.at(-1)).toContain('"rows":2');
	});

	it("asks once for each distinct call, then plans the follow-ups from the primary rows", async () => {
		const { result } = load(plan());
		expect(idsOf(result)).toEqual(["loading", "loading"]);
		await waitFor(() =>
			expect(idsOf(result)).toEqual(["totals:2", "series:1"]),
		);
		const calls = current.log.map((entry) => entry.split(" ")[0]);
		expect(calls.filter((name) => name === "range_totals")).toHaveLength(1);
		expect(calls.filter((name) => name === "store_coverage")).toHaveLength(1);
		expect(
			current.log.find((entry) => entry.startsWith("period_series")),
		).toContain('"rows":2');
		expect(result.current.failed).toBe(false);
		expect(result.current.coverage).not.toBeNull();
	});

	it("shows an error with a retry for the card whose call failed, and recovers", async () => {
		current.failNext.add("range_totals");
		const { result } = load(plan());
		await waitFor(() =>
			expect(result.current.cards.map((entry) => entry.status)).toEqual([
				"error",
				"ready",
			]),
		);
		const failed = result.current.cards[0];
		if (failed?.status !== "error") throw new Error("expected an error");
		act(() => failed.retry());
		await waitFor(() =>
			expect(idsOf(result)).toEqual(["totals:2", "series:1"]),
		);
	});

	it("reports a failed coverage call and retries it", async () => {
		current.failNext.add("store_coverage");
		const { result } = load(plan());
		await waitFor(() => expect(result.current.failed).toBe(true));
		expect(result.current.cards.map((entry) => entry.status)).toEqual([
			"loading",
			"loading",
		]);
		act(() => result.current.retry());
		await waitFor(() =>
			expect(idsOf(result)).toEqual(["totals:2", "series:1"]),
		);
		expect(result.current.failed).toBe(false);
	});

	it("fetches the range before ahead once the cards have settled", async () => {
		const { result } = load(plan(true));
		await waitFor(() =>
			expect(idsOf(result)).toEqual(["totals:2", "series:1"]),
		);
		await waitFor(
			() =>
				expect(
					current.log.some(
						(entry) =>
							entry.startsWith("range_totals") && entry.includes("2026-10-06"),
					),
				).toBe(true),
			{ timeout: 2000 },
		);
	});
});
