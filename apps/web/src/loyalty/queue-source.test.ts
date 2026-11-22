import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import {
	createSupabaseCustomerSource,
	QUEUE_PATHS_SHOWN,
} from "./supabase-loyalty-source";

const TENANT = "33333333-3333-4333-8333-333333333333";
const STORE = "11111111-1111-4111-8111-111111111111";

type Row = Record<string, unknown>;

function queueRow(id: string, overrides: Row = {}): Row {
	return {
		id,
		tenant_id: TENANT,
		store_id: STORE,
		membership_id: "55555555-5555-4555-8555-555555555555",
		matched_path: "B",
		candidate_invoice_ids: [],
		reason: "two_candidates",
		state: "open",
		created_at: "2026-11-20T02:00:00+00:00",
		resolved_at: null,
		resolved_by: null,
		chosen_invoice_id: null,
		resolution_reason: null,
		entry_id: null,
		membership: { phone_masked: "090****000" },
		checkin: null,
		claim: null,
		...overrides,
	};
}

// A path D row as `app.reconcile_redemptions` writes it: no member, no
// candidates, and a reason the check-in and claim paths never use.
const PATH_D_ROW = queueRow("00000000-0000-4000-8000-0000000000d1", {
	matched_path: "D",
	membership_id: null,
	reason: "verified_without_invoice",
	membership: null,
});

// A client that keeps the rows in memory and applies the filters it is given,
// the way PostgREST does, so a missing path filter lets a path D row through.
function clientHolding(rows: readonly Row[]) {
	const filters: [string, string, unknown][] = [];
	const client = {
		from(table: string) {
			if (table !== "loyalty_queue") throw new Error(`unexpected ${table}`);
			const mine: ((row: Row) => boolean)[] = [];
			let max = Number.POSITIVE_INFINITY;
			const chain: Record<string, unknown> = {};
			const add =
				(
					kind: string,
					test: (column: string, value: unknown) => (row: Row) => boolean,
				) =>
				(column: string, value?: unknown) => {
					filters.push([kind, column, value]);
					mine.push(test(column, value));
					return settled;
				};
			chain.select = () => settled;
			chain.eq = add("eq", (c, v) => (r) => r[c] === v);
			chain.neq = add("neq", (c, v) => (r) => r[c] !== v);
			chain.in = add("in", (c, v) => (r) => (v as unknown[]).includes(r[c]));
			chain.gt = add("gt", (c, v) => (r) => String(r[c]) > String(v));
			chain.order = () => settled;
			chain.limit = (count: number) => {
				max = count;
				return settled;
			};
			// Settles after the chain is built, like a PostgREST request.
			const settled = Promise.resolve().then(() => ({
				data: rows
					.filter((row) => mine.every((test) => test(row)))
					.slice(0, max),
				error: null,
			}));
			Object.assign(settled, chain);
			return settled;
		},
	};
	return { client: client as unknown as SupabaseClient, filters };
}

describe("the manager queue (web loader)", () => {
	it("lists only the paths the page can show", () => {
		expect([...QUEUE_PATHS_SHOWN]).toEqual(["B", "C"]);
	});

	it("leaves a path D item out of the open and the closed list instead of failing the page", async () => {
		const open = queueRow("00000000-0000-4000-8000-0000000000b1");
		const closed = queueRow("00000000-0000-4000-8000-0000000000c1", {
			matched_path: "C",
			reason: "duplicate_receipt",
			state: "resolved",
			resolved_at: "2026-11-20T03:00:00+00:00",
		});
		const closedD = queueRow("00000000-0000-4000-8000-0000000000d2", {
			...PATH_D_ROW,
			state: "resolved",
			resolved_at: "2026-11-20T04:00:00+00:00",
		});
		const { client } = clientHolding([open, PATH_D_ROW, closed, closedD]);
		const items = await createSupabaseCustomerSource(client).queue(TENANT);
		expect(items.map((item) => item.id).sort()).toEqual([
			"00000000-0000-4000-8000-0000000000b1",
			"00000000-0000-4000-8000-0000000000c1",
		]);
		expect(items.every((item) => ["B", "C"].includes(item.matchedPath))).toBe(
			true,
		);
	});

	it("asks the database for paths B and C in both queries", async () => {
		const { client, filters } = clientHolding([]);
		await createSupabaseCustomerSource(client).queue(TENANT);
		const pathFilters = filters.filter(
			([kind, column]) => kind === "in" && column === "matched_path",
		);
		expect(pathFilters).toHaveLength(2);
		for (const [, , value] of pathFilters) expect(value).toEqual(["B", "C"]);
	});

	it("shows an empty queue when only path D items exist", async () => {
		const { client } = clientHolding([PATH_D_ROW]);
		expect(await createSupabaseCustomerSource(client).queue(TENANT)).toEqual(
			[],
		);
	});
});
