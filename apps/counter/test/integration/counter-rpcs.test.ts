import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addLine, emptyDraft, requestOf } from "../../src/create/draft";
import { query, RpcError, rpc } from "../../src/lib/rpc";
import { byCategory, counterMenu, setSoldOut } from "../../src/menu/menu-api";
import {
	act,
	orderDetail,
	recordPayment,
	refund,
	refundable,
} from "../../src/orders/api";
import type { BoardAnswer, Order } from "../../src/orders/types";
import {
	clockIn,
	clockOut,
	counterQr,
	managerShifts,
	myShift,
} from "../../src/shift/api";
import {
	COFFEE_L,
	connect,
	dropCounterTenant,
	type LocalStack,
	localStackFromEnv,
	type SeededPerson,
	type SeededTenant,
	seedCounterTenant,
} from "../support/seed";

// counter:integration (ADR-066): the app's own calls (src/**/api.ts, rpc and query) against the real RPCs and RLS of
// the local stack through PostgREST, each person signed in with a real session; a synthetic tenant only. Use cases of
// the counter (board, counter order, payment, lifecycle, refund refusal, sold out, shifts) and the refusals the screens
// rely on: 42501 as RpcError.forbidden, and an update RLS skips answering no row.

const stack: LocalStack | null = localStackFromEnv();

describe.skipIf(stack === null)(
	"the counter's calls on the local stack",
	() => {
		let sql: Sql;
		let seeded: SeededTenant;
		const clients = new Map<string, SupabaseClient>();

		async function as(person: SeededPerson): Promise<SupabaseClient> {
			const held = clients.get(person.id);
			if (held !== undefined) return held;
			const client = createClient(
				stack?.supabaseUrl ?? "",
				stack?.publishableKey ?? "",
				{
					auth: { persistSession: false, autoRefreshToken: false },
				},
			);
			const { error } = await client.auth.signInWithPassword({
				email: person.email,
				password: person.password,
			});
			if (error !== null) throw error;
			clients.set(person.id, client);
			return client;
		}

		beforeAll(async () => {
			if (stack === null) return;
			sql = connect(stack);
			seeded = await seedCounterTenant(stack, sql, "ct-it");
		});

		afterAll(async () => {
			if (stack === null || seeded === undefined) return;
			await dropCounterTenant(stack, sql, seeded);
			await sql.end({ timeout: 5 });
		});

		it("reads the board from cursor 0 and then only what changed", async () => {
			const client = await as(seeded.people.staff);
			const first = await rpc<BoardAnswer>(client, "counter_board", {
				p_store: seeded.storeA,
				p_cursor: 0,
			});
			expect(first.store_id).toBe(seeded.storeA);
			expect(typeof first.cursor).toBe("number");
			const again = await rpc<BoardAnswer>(client, "counter_board", {
				p_store: seeded.storeA,
				p_cursor: first.cursor,
			});
			expect(again.orders).toEqual([]);
		});

		it("refuses another store's board as forbidden", async () => {
			const client = await as(seeded.people.staff);
			const refused = await rpc(client, "counter_board", {
				p_store: seeded.storeB,
				p_cursor: 0,
			}).catch((error: unknown) => error);
			expect(refused).toBeInstanceOf(RpcError);
			expect((refused as RpcError).forbidden).toBe(true);
		});

		it("keys a counter order from the app's draft, pays it, moves it through its lifecycle and refuses a staff refund", async () => {
			const client = await as(seeded.people.staff);
			const token = (
				await counterQr(await as(seeded.people.manager), seeded.storeA, false)
			).token;
			const shift = await clockIn(client, seeded.storeA, token, 0);
			expect(shift.state).toBe("clocked_in");
			const menu = await counterMenu(client, seeded.storeA);
			expect(byCategory(menu.items).map(([category]) => category)).toEqual([
				"Cà phê",
				"Trà",
				"Bánh",
			]);
			const coffee = menu.items.find((item) => item.id === seeded.items.coffee);
			const large = coffee?.sizes.find(
				(size) => size.id === seeded.sizes.coffeeL,
			);
			expect(large?.price).toBe(COFFEE_L);
			const draft = addLine(
				{ ...emptyDraft(crypto.randomUUID()), tableId: seeded.tables.t1 },
				{
					itemId: seeded.items.coffee,
					itemName: "Cà phê sữa",
					sizeId: seeded.sizes.coffeeL,
					sizeLabel: "Lớn",
					unitPrice: COFFEE_L,
					options: [],
					qty: 2,
					note: "",
				},
			);
			const created = await rpc<{ state: string; order: Order }>(
				client,
				"counter_create_order",
				{ p_store: seeded.storeA, p_request: requestOf(draft) },
			);
			expect(created.state).toBe("placed");
			expect(created.order.total).toBe(2 * COFFEE_L);
			const replay = await rpc<{
				state: string;
				replayed: boolean;
				order: Order;
			}>(client, "counter_create_order", {
				p_store: seeded.storeA,
				p_request: requestOf(draft),
			});
			expect(replay).toMatchObject({ state: "placed", replayed: true });
			expect(replay.order.id).toBe(created.order.id);

			const startAnswer = await act(client, created.order, "start");
			const started = startAnswer.order;
			const done = (await act(client, started, "done")).order;
			const unpaid = await act(client, done, "complete");
			expect(unpaid).toMatchObject({
				state: "refused",
				refusal: "payment_required",
			});
			const paid = await recordPayment(client, done, "cash");
			expect(paid.state).toBe("paid");
			const completed = await act(client, paid.order, "complete");
			expect(completed.order.status).toBe("completed");
			const detail = await orderDetail(client, created.order.id);
			expect(refundable(detail)).toBe(2 * COFFEE_L);
			expect(detail.timeline?.map((event) => event.action)).toContain("paid");
			const staffRefund = await refund(client, created.order.id, 1_000, "thử");
			expect(staffRefund).toMatchObject({
				state: "refused",
				refusal: "manager_required",
			});

			const closed = await clockOut(client, 2 * COFFEE_L);
			expect(closed.state).toBe("closed");
			const mine = await myShift(client);
			expect(mine.shift).toBeNull();
			expect(mine.recent[0]?.status).toBe("closed");
		});

		it("a stale version is a conflict, the same step again a replay", async () => {
			const client = await as(seeded.people.staff2);
			const draft = addLine(
				{ ...emptyDraft(crypto.randomUUID()), type: "takeaway" },
				{
					itemId: seeded.items.bread,
					itemName: "Bánh chuối",
					sizeId: seeded.sizes.bread,
					sizeLabel: null,
					unitPrice: 25_000,
					options: [],
					qty: 1,
					note: "",
				},
			);
			const created = await rpc<{ order: Order }>(
				client,
				"counter_create_order",
				{ p_store: seeded.storeA, p_request: requestOf(draft) },
			);
			const paid = await recordPayment(client, created.order, "card");
			const started = await act(client, paid.order, "start");
			expect(started.state).toBe("ok");
			const again = await act(client, paid.order, "start");
			expect(again).toMatchObject({ state: "ok", replayed: true });
			const stale = await act(client, paid.order, "cancel", "store_busy");
			expect(stale.state).toBe("conflict");
			expect(stale.order.status).toBe("preparing");
		});

		it("switches an item sold out and back", async () => {
			const client = await as(seeded.people.staff);
			const off = await setSoldOut(
				client,
				seeded.storeA,
				seeded.items.tea,
				true,
			);
			expect(off.sold_out).toBe(true);
			const menu = await counterMenu(client, seeded.storeA);
			expect(
				menu.items.find((item) => item.id === seeded.items.tea)?.available,
			).toBe(false);
			await setSoldOut(client, seeded.storeA, seeded.items.tea, false);
		});

		it("an update RLS does not allow touches no row (the menu editor says so), and the owner's is logged", async () => {
			const manager = await as(seeded.people.manager);
			const skipped = await query<unknown[]>(
				manager
					.from("menu_item_sizes")
					.update({ price: 40_000 })
					.eq("id", seeded.sizes.tea)
					.select("id"),
			);
			expect(skipped).toEqual([]);
			const owner = await as(seeded.people.owner);
			const written = await query<unknown[]>(
				owner
					.from("menu_item_sizes")
					.update({ price: 40_000 })
					.eq("id", seeded.sizes.tea)
					.select("id"),
			);
			expect(written).toHaveLength(1);
			const log = await query<{ new_price: number; changed_by: string }[]>(
				owner
					.from("menu_price_changes")
					.select("new_price, changed_by")
					.eq("size_id", seeded.sizes.tea)
					.order("changed_at", { ascending: false })
					.limit(1),
			);
			expect(log[0]).toMatchObject({ changed_by: seeded.people.owner.id });
			expect(Number(log[0]?.new_price)).toBe(40_000);
		});

		it("manager reads are forbidden to staff and answered to the manager", async () => {
			const staff = await as(seeded.people.staff);
			const refused = await managerShifts(
				staff,
				seeded.storeA,
				"2026-11-01",
				"2026-11-28",
			).catch((error: unknown) => error);
			expect((refused as RpcError).forbidden).toBe(true);
			const blocked = await rpc(staff, "manager_blocked_signins", {
				p_tenant: seeded.tenantId,
			}).catch((error: unknown) => error);
			expect((blocked as RpcError).forbidden).toBe(true);
			const manager = await as(seeded.people.manager);
			await expect(
				rpc<{ requests: unknown[] }>(manager, "manager_blocked_signins", {
					p_tenant: seeded.tenantId,
				}),
			).resolves.toEqual({ requests: [] });
			const shifts = await managerShifts(
				manager,
				seeded.storeA,
				"2026-11-01",
				"2026-12-31",
			);
			expect(shifts.shifts.length).toBeGreaterThanOrEqual(1);
		});
	},
);
