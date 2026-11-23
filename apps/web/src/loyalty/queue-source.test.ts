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
function clientHolding(
	rows: readonly Row[],
	others: Readonly<Record<string, readonly Row[]>> = {},
) {
	const filters: [string, string, unknown][] = [];
	const client = {
		from(table: string) {
			const held = table === "loyalty_queue" ? rows : others[table];
			if (held === undefined) throw new Error(`unexpected ${table}`);
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
			chain.select = (columns: string) => {
				filters.push(["select", table, columns]);
				return settled;
			};
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
				data: held
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

// G-100: the path D items (a verified redemption without an invoice, a discount without a redemption, an amount that
// differs from the reward) are listed by their own loader, which reads ids from the queue and the entry name and the
// receipt by id, and never selects a code or a phone.
const D_ROW = (id: string, overrides: Row = {}): Row =>
	queueRow(id, {
		matched_path: "D",
		membership_id: null,
		membership: null,
		redemption_id: null,
		invoice_id: null,
		...overrides,
	});

describe("the path D items (web loader, G-100)", () => {
	const REDEMPTION = "44444444-4444-4444-8444-444444444441";
	const INVOICE = "44444444-4444-4444-8444-444444444442";
	const rows = [
		queueRow("00000000-0000-4000-8000-0000000000b1"),
		D_ROW("00000000-0000-4000-8000-0000000000d1", {
			reason: "verified_without_invoice",
			redemption_id: REDEMPTION,
		}),
		D_ROW("00000000-0000-4000-8000-0000000000d2", {
			reason: "discount_without_redemption",
			invoice_id: INVOICE,
			created_at: "2026-11-20T03:00:00+00:00",
		}),
		D_ROW("00000000-0000-4000-8000-0000000000d3", {
			reason: "amount_mismatch",
			redemption_id: REDEMPTION,
			invoice_id: INVOICE,
			state: "resolved",
			resolved_at: "2026-11-21T03:00:00+00:00",
		}),
	];
	const others = {
		invoices: [
			{
				id: INVOICE,
				receipt_no: "R-778",
				sold_at: "2026-11-20T02:30:00+00:00",
				bill_discount_name: "Giảm tay",
			},
		],
		redemptions: [{ id: REDEMPTION, pos_discount_name: "Giảm thành viên 10%" }],
	};

	it("lists only path D items, with the entry name and the receipt read by id", async () => {
		const { client } = clientHolding(rows, others);
		const items =
			await createSupabaseCustomerSource(client).reconciliation(TENANT);
		const byReason = new Map(items.map((item) => [item.reason, item]));
		expect(items).toHaveLength(3);
		expect(byReason.get("verified_without_invoice")).toMatchObject({
			state: "open",
			entryName: "Giảm thành viên 10%",
			receiptNo: null,
			soldAt: null,
		});
		expect(byReason.get("discount_without_redemption")).toMatchObject({
			state: "open",
			entryName: "Giảm tay",
			receiptNo: "R-778",
			soldAt: "2026-11-20T02:30:00+00:00",
		});
		expect(byReason.get("amount_mismatch")).toMatchObject({
			state: "resolved",
			resolvedAt: "2026-11-21T03:00:00+00:00",
			entryName: "Giảm thành viên 10%",
			receiptNo: "R-778",
		});
	});

	it("asks the database for path D in both queries, never B or C", async () => {
		const { client, filters } = clientHolding(rows, others);
		await createSupabaseCustomerSource(client).reconciliation(TENANT);
		const paths = filters.filter(
			([kind, column]) => kind === "eq" && column === "matched_path",
		);
		expect(paths).toHaveLength(2);
		for (const [, , value] of paths) expect(value).toBe("D");
	});

	it("never selects a redemption code, a voucher code or a phone", async () => {
		const { client, filters } = clientHolding(rows, others);
		await createSupabaseCustomerSource(client).reconciliation(TENANT);
		const selected = filters
			.filter(([kind]) => kind === "select")
			.map(([, table, columns]) => `${table}:${String(columns)}`);
		expect(selected).toContain("redemptions:id,pos_discount_name");
		expect(selected).toContain(
			"invoices:id,receipt_no,sold_at,bill_discount_name",
		);
		for (const entry of selected) {
			expect(entry).not.toMatch(/code(?!_)|voucher_code|phone|customer/);
		}
	});

	it("falls back to the bill's discount name, then to nothing, when the redemption is not visible", async () => {
		const only = [
			D_ROW("00000000-0000-4000-8000-0000000000d4", {
				reason: "amount_mismatch",
				redemption_id: REDEMPTION,
				invoice_id: INVOICE,
			}),
			D_ROW("00000000-0000-4000-8000-0000000000d5", {
				reason: "verified_without_invoice",
				redemption_id: REDEMPTION,
			}),
		];
		const { client } = clientHolding(only, {
			invoices: others.invoices,
			redemptions: [],
		});
		const items =
			await createSupabaseCustomerSource(client).reconciliation(TENANT);
		const names = Object.fromEntries(
			items.map((item) => [item.reason, item.entryName]),
		);
		expect(names).toEqual({
			amount_mismatch: "Giảm tay",
			verified_without_invoice: null,
		});
	});

	it("lists the fourth reason, an invoice voided after its voucher was confirmed, and never fails on a reason it does not know", async () => {
		const voided = D_ROW("00000000-0000-4000-8000-0000000000d6", {
			reason: "confirmed_invoice_voided",
			redemption_id: REDEMPTION,
			invoice_id: INVOICE,
		});
		const future = D_ROW("00000000-0000-4000-8000-0000000000d7", {
			reason: "a_reason_added_by_a_later_migration",
			redemption_id: REDEMPTION,
			created_at: "2026-11-21T03:00:00+00:00",
		});
		const { client } = clientHolding([voided, future], others);
		const items =
			await createSupabaseCustomerSource(client).reconciliation(TENANT);
		expect(items.map((item) => item.reason).sort()).toEqual([
			"confirmed_invoice_voided",
			"other",
		]);
		expect(items.find((item) => item.reason === "other")?.entryName).toBe(
			"Giảm thành viên 10%",
		);
	});

	it("reads the receipt of the invoice a manager chose when a voucher used with no invoice was resolved", async () => {
		const resolved = D_ROW("00000000-0000-4000-8000-0000000000d8", {
			reason: "verified_without_invoice",
			redemption_id: REDEMPTION,
			invoice_id: null,
			chosen_invoice_id: INVOICE,
			state: "resolved",
			resolved_at: "2026-11-21T03:00:00+00:00",
		});
		const { client } = clientHolding([resolved], others);
		const [item] =
			await createSupabaseCustomerSource(client).reconciliation(TENANT);
		expect(item).toMatchObject({
			state: "resolved",
			receiptNo: "R-778",
			soldAt: "2026-11-20T02:30:00+00:00",
		});
	});

	it("is empty, and reads no invoice or redemption, when only paths B and C exist", async () => {
		const { client, filters } = clientHolding(
			[queueRow("00000000-0000-4000-8000-0000000000b9")],
			others,
		);
		expect(
			await createSupabaseCustomerSource(client).reconciliation(TENANT),
		).toEqual([]);
		expect(
			filters.filter(
				([kind, table]) => kind === "select" && table !== "loyalty_queue",
			),
		).toEqual([]);
	});
});
