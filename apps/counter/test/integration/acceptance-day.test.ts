import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addLine, emptyDraft, requestOf } from "../../src/create/draft";
import { query, RpcError, rpc } from "../../src/lib/rpc";
import { type InvoiceRow, summarizeDay } from "../../src/manager/overview";
import { act, orderDetail, recordPayment } from "../../src/orders/api";
import type { Order } from "../../src/orders/types";
import {
	clockIn,
	clockOut,
	counterQr,
	dayReconciliation,
	myShift,
	shiftReconciliation,
	workedDays,
} from "../../src/shift/api";
import {
	asCustomer,
	COFFEE_M,
	connect,
	dropCounterTenant,
	type LocalStack,
	localStackFromEnv,
	placeCustomerOrder,
	type SeededPerson,
	type SeededTenant,
	seedCounterTenant,
	seedCustomer,
	TEA,
} from "../support/seed";

// counter:integration/acceptance-day: acceptance criteria 6 and 7 of the owner's plan, phase 1, through the counter's
// own calls (src/shift/api.ts, src/orders/api.ts, src/manager/overview.ts) and PostgREST with real sessions; a
// synthetic tenant only (ct-acc-…), removed at the end with its payment attempts and exceptions.
// - Criterion 6 (use case, oracle): one business day today at store A with a cash table order of the customer app, a
//   card order keyed at the counter and a VietQR transfer the bank confirms (checkout_settle, as bank-webhook calls
//   it). The manager's Đối chiếu ngày matches; its revenue equals Tổng quan ngày's (summarizeDay over the invoices the
//   manager reads), its online figure equals the gateway's confirmed transaction, its cash the cashier's count; the
//   cashier's own Đối chiếu of the shift adds up to the same day. Equivalence partitions of who reads it: staff are
//   refused (42501 as RpcError.forbidden).
// - Criterion 7 (oracle, boundary values): recorded shifts of September 2026 (8 h, 4 h, 7:57, a night across midnight,
//   an open shift) read by the manager (S11, workedDays) and by each person (myShift) give the same days, equal to
//   the days recomputed from the recorded instants; staff are refused the manager's view.

const stack: LocalStack | null = localStackFromEnv();
const MINUTE = 60_000;

/** Whether the day may turn over (Vietnam midnight) during the test: the day's figures would then split. */
function nearVietnamMidnight(now = Date.now()): boolean {
	const minutes = Math.floor((now + 7 * 60 * MINUTE) / MINUTE) % (24 * 60);
	return minutes > 24 * 60 - 10 || minutes < 2;
}

describe.skipIf(stack === null)(
	"acceptance criteria 6 and 7 through the counter's calls on the local stack",
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

		const forbidden = (error: unknown) =>
			error instanceof RpcError && error.forbidden;

		async function complete(person: SeededPerson, id: string): Promise<Order> {
			const client = await as(person);
			let order = await orderDetail(client, id);
			for (const action of ["start", "done", "complete"] as const) {
				order = (await act(client, order, action)).order;
			}
			return order;
		}

		beforeAll(async () => {
			if (stack === null) return;
			sql = connect(stack);
			seeded = await seedCounterTenant(stack, sql, "ct-acc");
		});

		afterAll(async () => {
			if (stack === null || seeded === undefined) return;
			await sql`delete from app.payment_attempts where tenant_id = ${seeded.tenantId}`;
			await sql`delete from public.payment_exceptions where tenant_id = ${seeded.tenantId}`;
			await dropCounterTenant(stack, sql, seeded);
			await sql.end({ timeout: 5 });
		});

		it("criterion 6: today's revenue on the app equals the gateway's confirmed transfer, the card and the cash counted at the end of the shift", async (context) => {
			if (nearVietnamMidnight()) {
				context.skip();
			}
			const staff = await as(seeded.people.staff);
			const manager = await as(seeded.people.manager);
			const [today] = await sql<{ date: string }[]>`
				select to_char(app.store_business_date(${seeded.storeA}::uuid, now()), 'YYYY-MM-DD') as date`;
			const date = today?.date ?? "";

			// The store takes VietQR in the gateway's sandbox (the provider row a mock bank service settles).
			const provider = randomUUID();
			await sql`insert into public.payment_providers (id, tenant_id, brand_id, method, adapter, mode, secret_name, settings)
				values (${provider}, ${seeded.tenantId}, ${seeded.brandId}, 'vietqr', 'mock', 'sandbox', 'PAYMENT_BANK_BRAND_1',
				${sql.json({ bank_bin: "970400", bank_name: "Ngân hàng mẫu", account_number: "0123456789", account_name: "CUA HANG MAU", reference_prefix: "FNB" })})`;
			await sql`update public.store_ordering_settings set payment_methods = array['counter', 'vietqr'] where store_id = ${seeded.storeA}`;

			const token = (await counterQr(manager, seeded.storeA, false)).token;
			expect((await clockIn(staff, seeded.storeA, token, 200_000)).state).toBe(
				"clocked_in",
			);

			// A customer at Bàn 1 pays at the counter in cash.
			const customer = await seedCustomer(sql, seeded);
			const placed = await placeCustomerOrder(sql, seeded, customer, {
				table: seeded.tables.t1,
				lines: [{ size: seeded.sizes.coffeeM, qty: 1 }],
				expectedTotal: COFFEE_M,
			});
			expect(placed.state).toBe("placed");
			const cashOrder = await orderDetail(staff, placed.order?.id ?? "");
			expect((await recordPayment(staff, cashOrder, "cash")).state).toBe(
				"paid",
			);
			expect((await complete(seeded.people.staff, cashOrder.id)).status).toBe(
				"completed",
			);

			// A tea keyed at the counter, paid by card.
			const keyed = await rpc<{ state: string; order: Order }>(
				staff,
				"counter_create_order",
				{
					p_store: seeded.storeA,
					p_request: requestOf(
						addLine(
							{ ...emptyDraft(randomUUID()), type: "takeaway" },
							{
								itemId: seeded.items.tea,
								itemName: "Trà đào",
								sizeId: seeded.sizes.tea,
								sizeLabel: null,
								unitPrice: TEA,
								options: [],
								qty: 1,
								note: "",
							},
						),
					),
				},
			);
			expect((await recordPayment(staff, keyed.order, "card")).state).toBe(
				"paid",
			);
			expect((await complete(seeded.people.staff, keyed.order.id)).status).toBe(
				"completed",
			);

			// A customer at Bàn 2 pays by VietQR; the bank's notification is settled as bank-webhook does.
			const qrCustomer = await seedCustomer(sql, seeded);
			const [tableToken] = await sql<{ token: string }[]>`
				select app.table_qr_token(${seeded.tenantId}::uuid, ${seeded.tables.t2}::uuid, 1) as token`;
			const online = await asCustomer(sql, seeded, qrCustomer, async (tx) => {
				const [row] = await tx<{ r: { state: string; order: Order } }[]>`
					select app.customer_place_order(${tx.json({
						request_id: randomUUID(),
						store: seeded.storeCodeA,
						type: "table",
						table_token: tableToken?.token ?? "",
						payment: "vietqr",
						lines: [{ size: seeded.sizes.coffeeM, qty: 1, options: [] }],
						expected_total: COFFEE_M,
					} as never)}::jsonb, now()) as r`;
				return row?.r;
			});
			expect(online?.order.status).toBe("awaiting_payment");
			const [attempt] = await sql<
				{ r: { payment: { reference: string } } }[]
			>`select app.checkout_begin(${sql.json({
				user_id: qrCustomer,
				order_id: online?.order.id ?? "",
				method: "vietqr",
				idempotency_key: `key-acc-${randomUUID().slice(0, 8)}`,
				for: "customer",
			} as never)}::jsonb, now()) as r`;
			const [settled] = await sql<{ r: { outcome: string } }[]>`
				select app.checkout_settle(${sql.json({
					provider_id: provider,
					provider_ref: `mock:acc-${randomUUID().slice(0, 8)}`,
					candidates: [attempt?.r.payment.reference ?? ""],
					amount: COFFEE_M,
					success: true,
				} as never)}::jsonb, now()) as r`;
			expect(settled?.r.outcome).toBe("confirmed");
			expect(
				(await complete(seeded.people.staff, online?.order.id ?? "")).status,
			).toBe("completed");

			// The cashier counts the drawer blind: the opening cash and the coffee's cash.
			const closed = await clockOut(staff, 200_000 + COFFEE_M);
			expect(closed.state).toBe("closed");

			const day = await dayReconciliation(manager, seeded.storeA, date);
			expect(day).toMatchObject({
				revenue: COFFEE_M + TEA + COFFEE_M,
				online_confirmed: COFFEE_M,
				card: TEA,
				cash: { counted: COFFEE_M, expected: COFFEE_M, difference: 0 },
				shifts_open: 0,
				shifts_awaiting_confirmation: 0,
				paid_not_completed: 0,
				difference: 0,
				matched: true,
			});
			expect(day.revenue).toBe(
				day.online_confirmed + day.card + day.cash.counted,
			);

			// Tổng quan ngày reads the same revenue from the invoices the manager can read.
			const invoices = await query<InvoiceRow[]>(
				manager
					.from("invoices")
					.select("id, sold_at, net_amount, status")
					.eq("store_id", seeded.storeA)
					.eq("business_date", date),
			);
			const overview = summarizeDay(invoices, []);
			expect(overview).toMatchObject({ revenue: day.revenue, orders: 3 });

			// The gateway's side: the transactions it confirmed for the day, as its statement would list them.
			const [gateway] = await sql<{ total: number }[]>`
				select coalesce(sum(p.amount), 0)::int as total from public.order_payments p join public.orders o on o.id = p.order_id
				where o.store_id = ${seeded.storeA} and o.business_date = ${date}::date and p.method in ('vietqr', 'zalo_checkout')
					and p.status = 'succeeded' and p.provider_ref is not null`;
			expect(day.online_confirmed).toBe(gateway?.total);

			// The cashier's Đối chiếu of the shift adds up to the same day: the drawer's sales plus what is not in it.
			const mine = await myShift(staff);
			const shiftId = mine.recent[0]?.id ?? "";
			const own = await shiftReconciliation(staff, shiftId);
			expect(own.state).toBe("ok");
			if (own.state === "ok") {
				const recon = own.reconciliation;
				expect(recon.matched).toBe(true);
				expect(
					recon.cash_sales.total +
						recon.not_in_drawer.card.total +
						recon.not_in_drawer.vietqr.total +
						recon.not_in_drawer.zalo_checkout.total,
				).toBe(day.revenue);
			}

			// Staff do not read the day.
			await expect(
				dayReconciliation(staff, seeded.storeA, date),
			).rejects.toSatisfy(forbidden);
		});

		it("criterion 7: the month's worked days the manager reads equal each person's own and the recorded clock-ins and clock-outs", async () => {
			const manager = await as(seeded.people.manager);
			const at = (text: string) => `${text}+07`;
			const shifts: readonly [SeededPerson, string, string | null][] = [
				[seeded.people.staff, "2026-09-01 08:00", "2026-09-01 16:00"],
				[seeded.people.staff, "2026-09-02 08:00", "2026-09-02 12:00"],
				[seeded.people.staff, "2026-09-03 08:00", "2026-09-03 15:57"],
				[seeded.people.staff, "2026-09-30 22:00", "2026-10-01 02:00"],
				[seeded.people.staff2, "2026-09-10 07:00", "2026-09-10 11:00"],
				[seeded.people.staff2, "2026-09-10 13:00", "2026-09-10 19:00"],
				[seeded.people.staff2, "2026-09-11 08:00", null],
			];
			for (const [person, from, to] of shifts) {
				await sql`insert into public.staff_shifts (tenant_id, store_id, user_id, business_date, clock_in_at, clock_out_at,
						expected_cash, counted_cash, cash_difference, status, closed_at)
					values (${seeded.tenantId}, ${seeded.storeA}, ${person.id}, ${from.slice(0, 10)}::date, ${at(from)}::timestamptz,
						${to === null ? null : at(to)}::timestamptz, ${to === null ? null : 0}, ${to === null ? null : 0}, ${to === null ? null : 0},
						${to === null ? "open" : "closed"}, ${to === null ? null : at(to)}::timestamptz)`;
			}
			const month = await workedDays(manager, seeded.storeA, "2026-09-15");
			expect(month).toMatchObject({
				month: "2026-09",
				standard_days: 28,
			});
			const byPerson = new Map(
				month.people.map((person) => [person.user_id, person]),
			);
			expect(byPerson.get(seeded.people.staff.id)).toMatchObject({
				name: seeded.people.staff.name,
				hours: 23.95,
				worked_days: 2.99,
				open_shifts: 0,
			});
			expect(
				byPerson
					.get(seeded.people.staff.id)
					?.days.map((day) => `${day.date}=${day.days}`),
			).toEqual([
				"2026-09-01=1",
				"2026-09-02=0.5",
				"2026-09-03=0.99",
				"2026-09-30=0.5",
			]);
			expect(byPerson.get(seeded.people.staff2.id)).toMatchObject({
				hours: 10,
				worked_days: 1,
				open_shifts: 1,
			});

			// The oracle: every day recomputed from the recorded instants (8 hours a day, at most 1).
			const oracle = await sql<{ user_id: string; days: string }[]>`
				select user_id, sum(least(1, round(h / 8, 2)))::text as days from (
					select user_id, business_date, sum(extract(epoch from clock_out_at - clock_in_at)) / 3600 as h
					from public.staff_shifts where store_id = ${seeded.storeA} and clock_out_at is not null
						and business_date between '2026-09-01' and '2026-09-30'
					group by user_id, business_date) x group by user_id`;
			for (const row of oracle) {
				expect(byPerson.get(row.user_id)?.worked_days).toBe(Number(row.days));
			}

			// Each person reads the same month as the manager.
			for (const person of [seeded.people.staff, seeded.people.staff2]) {
				const own = await myShift(await as(person), "2026-09-01");
				const entry = own.months
					.find((entry) => entry.store_id === seeded.storeA)
					?.people.find((entry) => entry.user_id === person.id);
				expect(entry?.worked_days).toBe(byPerson.get(person.id)?.worked_days);
				expect(entry?.hours).toBe(byPerson.get(person.id)?.hours);
			}

			await expect(
				workedDays(await as(seeded.people.staff), seeded.storeA, "2026-09-15"),
			).rejects.toSatisfy(forbidden);
			await expect(
				workedDays(await as(seeded.people.staffB), seeded.storeA, "2026-09-15"),
			).rejects.toSatisfy(forbidden);
		});
	},
);
