import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { RpcError, rpc } from "../../src/lib/rpc";
import {
	loadTakeawaySettings,
	saveTakeawaySettings,
	takeawayWriteError,
} from "../../src/manager/takeaway-settings";
import {
	applyBoard,
	EMPTY_BOARD,
	isScheduled,
	laneOrders,
	scheduledOrders,
} from "../../src/orders/board-model";
import type { BoardAnswer } from "../../src/orders/types";
import {
	allowTakeawayBooking,
	bookTakeaway,
	connect,
	dropCounterTenant,
	type LocalStack,
	localStackFromEnv,
	nextSlot,
	type SeededPerson,
	type SeededTenant,
	seedCounterTenant,
	seedCustomer,
} from "../support/seed";

// counter:integration/takeaway (C17, ADR-072): the counter's own calls against the real RPCs and RLS of the local
// stack, each person signed in with a real session; a synthetic tenant only.
// - use case: a customer's takeaway booked for later and paid (the app's placement and the server's payment
//   confirmation) reaches counter_board as accepted, scheduled, with start_at the pick-up less the preparation time
//   and in counts.scheduled; the queue's model, fed the real answer, keeps it out of Mới without a chime and lets it
//   in, ringing, at its start;
// - decision table of the settings write (who × which store): a manager of the store writes the three numbers; staff,
//   a manager of another store write nothing (RLS: no row, said as 42501); a value out of bounds is the table's 23514;
//   staff read no settings row.

const stack: LocalStack | null = localStackFromEnv();

describe.skipIf(stack === null)("takeaway bookings at the counter", () => {
	let sql: Sql;
	let seeded: SeededTenant;
	const clients = new Map<string, SupabaseClient>();

	async function as(person: SeededPerson): Promise<SupabaseClient> {
		const held = clients.get(person.id);
		if (held !== undefined) return held;
		const client = createClient(
			stack?.supabaseUrl ?? "",
			stack?.publishableKey ?? "",
			{ auth: { persistSession: false, autoRefreshToken: false } },
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
		await allowTakeawayBooking(sql, seeded);
	});

	afterAll(async () => {
		if (stack === null || seeded === undefined) return;
		await dropCounterTenant(stack, sql, seeded);
		await sql.end({ timeout: 5 });
	});

	it("a paid booking reaches the board as scheduled with its start, and the queue lets it in at that start", async () => {
		const staff = await as(seeded.people.staff);
		const first = await rpc<BoardAnswer>(staff, "counter_board", {
			p_store: seeded.storeA,
			p_cursor: 0,
		});
		const loaded = applyBoard(EMPTY_BOARD, first, Date.now());
		const pickup = await nextSlot(sql, 60);
		const customer = await seedCustomer(sql, seeded);
		const booked = await bookTakeaway(sql, seeded, customer, pickup);

		const next = await rpc<BoardAnswer>(staff, "counter_board", {
			p_store: seeded.storeA,
			p_cursor: loaded.cursor,
		});
		const order = next.orders.find((item) => item.id === booked.id);
		expect(order?.status).toBe("accepted");
		expect(order?.payment_status).toBe("paid");
		expect(order?.scheduled).toBe(true);
		expect(Date.parse(order?.pickup_at ?? "")).toBe(Date.parse(pickup));
		expect(Date.parse(order?.start_at ?? "")).toBe(
			Date.parse(pickup) - 15 * 60_000,
		);
		expect(next.counts.scheduled).toBe(1);
		expect(next.counts.accepted).toBe(1);

		const now = Date.now();
		const held = applyBoard(loaded, next, now);
		expect(held.fresh).toEqual([]);
		expect(scheduledOrders(held, now).map((item) => item.id)).toEqual([
			booked.id,
		]);
		expect(laneOrders(held, "new", now)).toEqual([]);
		if (order === undefined) throw new Error("no order");
		expect(isScheduled(order, now)).toBe(true);

		const start = Date.parse(order.start_at ?? "");
		const due = applyBoard(
			held,
			{ ...next, orders: [], cursor: next.cursor },
			start,
		);
		expect(due.fresh).toEqual([booked.id]);
		expect(laneOrders(due, "new", start).map((item) => item.id)).toEqual([
			booked.id,
		]);
	});

	it("a manager of the store writes the three numbers; staff and a manager of another store write nothing", async () => {
		const manager = await as(seeded.people.manager);
		expect(await loadTakeawaySettings(manager, seeded.storeA)).toEqual({
			prep_minutes: 15,
			takeaway_slot_minutes: 15,
			takeaway_slot_limit: 6,
		});
		const saved = await saveTakeawaySettings(manager, seeded.storeA, {
			prep_minutes: 12,
			takeaway_slot_minutes: 20,
			takeaway_slot_limit: 8,
		});
		expect(saved).toEqual({
			prep_minutes: 12,
			takeaway_slot_minutes: 20,
			takeaway_slot_limit: 8,
		});
		const [row] = await sql<{ p: number; s: number; l: number }[]>`
			select prep_minutes as p, takeaway_slot_minutes as s, takeaway_slot_limit as l
			from public.store_ordering_settings where store_id = ${seeded.storeA}`;
		expect(row).toEqual({ p: 12, s: 20, l: 8 });

		const refusal = async (client: SupabaseClient, store: string) => {
			try {
				await saveTakeawaySettings(client, store, {
					prep_minutes: 30,
					takeaway_slot_minutes: 30,
					takeaway_slot_limit: 2,
				});
				return "written";
			} catch (error) {
				return error instanceof RpcError ? error.code : "error";
			}
		};
		const staff = await as(seeded.people.staff);
		expect(await refusal(staff, seeded.storeA)).toBe("42501");
		expect(await loadTakeawaySettings(staff, seeded.storeA)).toBeNull();
		expect(await refusal(manager, seeded.storeB)).toBe("42501");
		const [after] = await sql<{ p: number }[]>`
			select prep_minutes as p from public.store_ordering_settings where store_id = ${seeded.storeA}`;
		expect(after?.p).toBe(12);

		// a value the form would refuse, sent anyway, is the table's 23514, said in words
		try {
			await saveTakeawaySettings(manager, seeded.storeA, {
				prep_minutes: 12,
				takeaway_slot_minutes: 7,
				takeaway_slot_limit: 8,
			});
			throw new Error("accepted");
		} catch (error) {
			expect(error instanceof RpcError && error.code).toBe("23514");
			expect(takeawayWriteError(error)).toBe("takeaway.error.invalid");
		}
		await allowTakeawayBooking(sql, seeded);
	});
});
