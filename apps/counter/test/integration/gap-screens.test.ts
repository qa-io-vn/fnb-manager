import {
	readAcceptProposalAnswer,
	readCustomerRequests,
	readStampCodeAnswer,
} from "@fnb/zalo-mini/ordering";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
	addLine,
	type Draft,
	emptyDraft,
	requestOf,
} from "../../src/create/draft";
import { RpcError, rpc } from "../../src/lib/rpc";
import {
	answerRequest,
	inbox,
	inboxOrder,
	isAcceptedUnseen,
	markRead,
	unreadCount,
	vietnamInstant,
} from "../../src/manager/requests";
import { counterMenu } from "../../src/menu/menu-api";
import { act, recordPayment, refund } from "../../src/orders/api";
import { attachMember, ticketStamps } from "../../src/orders/member";
import type { Order } from "../../src/orders/types";
import {
	clockIn,
	clockOut,
	counterQr,
	drawerLines,
	mayReadReconciliation,
	myShift,
	shiftReconciliation,
} from "../../src/shift/api";
import {
	asCustomer,
	BREAD,
	COFFEE_M,
	connect,
	dropCounterTenant,
	issueStampCode,
	type LocalStack,
	localStackFromEnv,
	type SeededPerson,
	type SeededTenant,
	seedCounterTenant,
	seedCustomer,
	seedJoinedCustomer,
	submitBooking,
	TEA,
} from "../support/seed";

// counter:integration/gap-screens: the calls behind the screens wired for native-till.md section 18 (2026-11-28),
// through PostgREST with real staff sessions and, for the customer, the customer app's own readers on the database's
// real answers; a synthetic tenant only, removed at the end.
// - Q01 stamps (use case, decision table): counter_menu's flags and stamp cards; the ticket's ticketStamps over the
//   real menu equals the stamps the order earns when it completes for the attached member (the server's rule is the
//   oracle); a card switched off says nothing; another store's staff cannot read the menu (IDOR).
// - M01 + C08 (state transitions new → proposed → confirmed·accepted_unseen → seen): the customer accepts with one
//   request id, a replay writes nothing, the inbox lists and counts it until the manager opens it, the first reader of
//   the contact is kept; refusals: not_allowed, request_conflict, proposal_expired (BVA at the instant), and
//   unknown_request for another customer's or a website request (IDOR); staff refused (manager-only).
// - Q02 "Đối chiếu" (state transitions open → counted): the person's own open shift is count_required with no expected
//   figure anywhere in the answer, a manager's own open shift too; a manager reads another person's open shift as the
//   figures so far; after the count the breakdown (cash sales, a cash refund, a card payment) adds up to the expected
//   cash and states the difference; another staff member or another store's staff is refused (42501).

const stack: LocalStack | null = localStackFromEnv();
const HOUR = 3_600_000;

function vietnamTomorrowAt(clock: string): string {
	const tomorrow = new Date(Date.now() + 24 * HOUR + 7 * HOUR)
		.toISOString()
		.slice(0, 10);
	const at = vietnamInstant(tomorrow, clock);
	if (at === null) throw new Error("no instant");
	return at;
}

describe.skipIf(stack === null)(
	"the section-18 screens' calls on the local stack",
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

		function draftOf(
			lines: readonly {
				itemId: string;
				itemName: string;
				sizeId: string;
				price: number;
				qty: number;
			}[],
		): Draft {
			return lines.reduce(
				(draft, line) =>
					addLine(draft, {
						itemId: line.itemId,
						itemName: line.itemName,
						sizeId: line.sizeId,
						sizeLabel: null,
						unitPrice: line.price,
						options: [],
						qty: line.qty,
						note: "",
					}),
				{ ...emptyDraft(crypto.randomUUID()), type: "takeaway" } as Draft,
			);
		}

		async function place(person: SeededPerson, draft: Draft): Promise<Order> {
			const created = await rpc<{ state: string; order: Order }>(
				await as(person),
				"counter_create_order",
				{ p_store: seeded.storeA, p_request: requestOf(draft) },
			);
			expect(created.state).toBe("placed");
			return created.order;
		}

		beforeAll(async () => {
			if (stack === null) return;
			sql = connect(stack);
			seeded = await seedCounterTenant(stack, sql, "ct-gs");
		});

		afterAll(async () => {
			if (stack === null || seeded === undefined) return;
			await dropCounterTenant(stack, sql, seeded);
			await sql.end({ timeout: 5 });
		});

		it("Q01: the ticket's stamps equal what the order earns its member on completion, and nothing while the card is off", async () => {
			const staff = await as(seeded.people.staff);
			const menu = await counterMenu(staff, seeded.storeA);
			const flags = Object.fromEntries(
				menu.items.map((item) => [item.id, item.counts_for_stamps]),
			);
			expect(flags).toMatchObject({
				[seeded.items.coffee]: true,
				[seeded.items.tea]: true,
				[seeded.items.bread]: false,
			});
			// a brand without stamp settings: on, 9 to a reward
			expect(menu.stamp_cards).toEqual([
				{ brand_id: seeded.brandId, enabled: true, stamps_per_reward: 9 },
			]);
			// IDOR: another store's staff cannot read this store's menu
			expect(
				forbidden(
					await counterMenu(
						await as(seeded.people.staffB),
						seeded.storeA,
					).catch((error: unknown) => error),
				),
			).toBe(true);

			const draft = draftOf([
				{
					itemId: seeded.items.coffee,
					itemName: "Cà phê sữa",
					sizeId: seeded.sizes.coffeeM,
					price: COFFEE_M,
					qty: 2,
				},
				{
					itemId: seeded.items.tea,
					itemName: "Trà đào",
					sizeId: seeded.sizes.tea,
					price: TEA,
					qty: 1,
				},
				{
					itemId: seeded.items.bread,
					itemName: "Bánh chuối",
					sizeId: seeded.sizes.bread,
					price: BREAD,
					qty: 3,
				},
			]);
			const shown = ticketStamps(draft.lines, menu.items, menu.stamp_cards);
			expect(shown).toBe(3);

			const token = (
				await counterQr(await as(seeded.people.manager), seeded.storeA, false)
			).token;
			expect((await clockIn(staff, seeded.storeA, token, 0)).state).toBe(
				"clocked_in",
			);
			const joined = await seedJoinedCustomer(
				sql,
				seeded,
				"Khách Tích Dấu",
				"0900000011",
			);
			const issued = readStampCodeAnswer(
				await issueStampCode(sql, seeded, joined),
			);
			if (issued.state !== "issued") throw new Error("no code");
			const order = await place(seeded.people.staff, draft);
			const attached = await attachMember(staff, order, issued.code.number);
			expect(attached).toMatchObject({ state: "attached", stamps: shown });
			const paid = await recordPayment(staff, attached.order, "cash");
			expect(paid.state).toBe("paid");
			const started = (await act(staff, paid.order, "start")).order;
			const done = (await act(staff, started, "done")).order;
			const completed = await act(staff, done, "complete");
			expect(completed.order.status).toBe("completed");
			const [earned] = await sql<{ delta: number }[]>`
				select delta from public.stamp_entries where order_id = ${order.id} and kind = 'order_earned'`;
			// the oracle: the server's own rule on completion
			expect(earned?.delta).toBe(shown);

			// the brand's card switched off: the menu says so and the ticket says nothing
			await sql`insert into public.stamp_card_settings (tenant_id, brand_id, enabled, stamps_per_reward)
				values (${seeded.tenantId}, ${seeded.brandId}, false, 9)`;
			const off = await counterMenu(staff, seeded.storeA);
			expect(off.stamp_cards).toEqual([
				{ brand_id: seeded.brandId, enabled: false, stamps_per_reward: 9 },
			]);
			expect(ticketStamps(draft.lines, off.items, off.stamp_cards)).toBeNull();
			await sql`delete from public.stamp_card_settings where brand_id = ${seeded.brandId}`;
			expect(
				(await clockOut(staff, 2 * COFFEE_M + TEA + 3 * BREAD)).state,
			).toBe("closed");
		});

		it("M01 + C08 (ST): the customer accepts the time proposed once, the inbox flags it until a manager opens it", async () => {
			const manager = await as(seeded.people.manager);
			const staff = await as(seeded.people.staff);
			const customer = await seedCustomer(sql, seeded);
			const booking = await submitBooking(
				sql,
				seeded,
				customer,
				vietnamTomorrowAt("19:00"),
			);
			// the manager reads it first (the first reader of the contact), then proposes 19:30
			await markRead(manager, booking.id);
			const proposedFor = vietnamTomorrowAt("19:30");
			const proposed = await answerRequest(
				manager,
				booking,
				"proposed",
				"Giờ đó kín bàn, quán còn chỗ lúc 19:30.",
				proposedFor,
			);
			expect(proposed.state).toBe("answered");

			const accept = (who: string, request: string, attempt: string) =>
				asCustomer(sql, seeded, who, async (tx) => {
					const [row] = await tx<
						{ r: unknown }[]
					>`select public.customer_accept_proposal(${request}::uuid, ${attempt}::uuid) as r`;
					return readAcceptProposalAnswer(row?.r);
				});
			const attempt = crypto.randomUUID();
			// IDOR: another customer of the tenant answers as an unknown request, nothing written
			const stranger = await seedCustomer(sql, seeded);
			expect(await accept(stranger, booking.id, crypto.randomUUID())).toEqual({
				state: "refused",
				refusal: "unknown_request",
				request: null,
			});

			const accepted = await accept(customer, booking.id, attempt);
			expect(accepted).toMatchObject({
				state: "accepted",
				replayed: false,
				request: { status: "confirmed" },
			});
			if (accepted.state !== "accepted") throw new Error("not accepted");
			expect(Date.parse(accepted.request.requestedFor ?? "")).toBe(
				Date.parse(proposedFor),
			);
			expect(accepted.request.customerAcceptedAt).not.toBeNull();
			// a retry after a lost answer: the same id is a replay, nothing written
			expect(await accept(customer, booking.id, attempt)).toMatchObject({
				state: "accepted",
				replayed: true,
			});
			// a new id on the confirmed request: not_allowed; the same id on another request: request_conflict
			expect(
				await accept(customer, booking.id, crypto.randomUUID()),
			).toMatchObject({ state: "refused", refusal: "not_allowed" });
			const other = await submitBooking(
				sql,
				seeded,
				customer,
				vietnamTomorrowAt("17:00"),
			);
			expect(await accept(customer, other.id, attempt)).toMatchObject({
				state: "refused",
				refusal: "request_conflict",
			});
			// the customer's list reads it confirmed at the new time
			const mine = await asCustomer(sql, seeded, customer, async (tx) => {
				const [row] = await tx<
					{ r: unknown }[]
				>`select public.customer_requests() as r`;
				return readCustomerRequests(row?.r);
			});
			expect(
				mine.requests.find((entry) => entry.id === booking.id),
			).toMatchObject({ status: "confirmed" });

			const box = await inbox(manager, seeded.storeA);
			const row = box.requests.find((entry) => entry.id === booking.id);
			expect(row).toMatchObject({
				status: "confirmed",
				accepted_unseen: true,
				read_by: seeded.people.manager.id,
			});
			expect(row !== undefined && isAcceptedUnseen(row)).toBe(true);
			expect(box.accepted_unseen).toBe(1);
			expect(unreadCount(box)).toBe(box.unread + 1);
			// listed right after the new requests, by the server and by the screen's own order
			const firstNotNew = box.requests.findIndex(
				(entry) => entry.status !== "new",
			);
			expect(box.requests[firstNotNew]?.id).toBe(booking.id);
			const ordered = inboxOrder(box.requests);
			expect(ordered.filter((entry) => entry.status !== "new")[0]?.id).toBe(
				booking.id,
			);

			// manager-only: staff can neither read the inbox nor clear the flag
			expect(
				forbidden(
					await inbox(staff, seeded.storeA).catch((error: unknown) => error),
				),
			).toBe(true);
			expect(
				forbidden(
					await markRead(staff, booking.id).catch((error: unknown) => error),
				),
			).toBe(true);

			const seen = await markRead(manager, booking.id);
			expect(seen.request).toMatchObject({
				accepted_unseen: false,
				accept_seen_by: seeded.people.manager.id,
				read_by: seeded.people.manager.id,
			});
			const after = await inbox(manager, seeded.storeA);
			expect(after.accepted_unseen).toBe(0);
			expect(
				after.requests.find((entry) => entry.id === booking.id)
					?.accepted_unseen,
			).toBe(false);
		});

		it("C08 (BVA, IDOR): a proposal expires at its instant; a website request is unknown to the customer", async () => {
			const manager = await as(seeded.people.manager);
			const customer = await seedCustomer(sql, seeded);
			const booking = await submitBooking(
				sql,
				seeded,
				customer,
				vietnamTomorrowAt("18:00"),
			);
			await answerRequest(
				manager,
				booking,
				"proposed",
				"Mời bạn đến lúc 18:30.",
				vietnamTomorrowAt("18:30"),
			);
			// the time proposed moved to the past (synthetic): the acceptance is refused at and after the instant
			await sql`update public.store_requests set proposed_for = now() - interval '1 minute' where id = ${booking.id}`;
			const expired = await asCustomer(sql, seeded, customer, async (tx) => {
				const [row] = await tx<
					{ r: unknown }[]
				>`select public.customer_accept_proposal(${booking.id}::uuid, ${crypto.randomUUID()}::uuid) as r`;
				return readAcceptProposalAnswer(row?.r);
			});
			expect(expired).toMatchObject({
				state: "refused",
				refusal: "proposal_expired",
				request: { status: "proposed" },
			});
			// a website request: unknown to any customer
			const [web] = await sql<{ r: { request: { id: string } } }[]>`
				select app.web_submit_request(${seeded.brandId}::uuid, ${`synthetic-client-${crypto.randomUUID()}`}, ${sql.json(
					{
						request_id: crypto.randomUUID(),
						store: seeded.storeCodeA,
						kind: "booking",
						name: "Khách Website",
						phone: "0900000012",
						party_size: 2,
						at: vietnamTomorrowAt("16:00"),
					} as never,
				)}::jsonb, now()) as r`;
			const webAnswer = await asCustomer(sql, seeded, customer, async (tx) => {
				const [row] = await tx<
					{ r: unknown }[]
				>`select public.customer_accept_proposal(${web?.r.request.id ?? ""}::uuid, ${crypto.randomUUID()}::uuid) as r`;
				return readAcceptProposalAnswer(row?.r);
			});
			expect(webAnswer).toEqual({
				state: "refused",
				refusal: "unknown_request",
				request: null,
			});
			// a staff session is not a customer session
			expect(
				forbidden(
					await rpc(await as(seeded.people.staff), "customer_accept_proposal", {
						p_request: booking.id,
						p_request_id: crypto.randomUUID(),
					}).catch((error: unknown) => error),
				),
			).toBe(true);
		});

		it("Q02 (ST, security): the count stays blind, then Đối chiếu adds up and states the difference", async () => {
			const staff = await as(seeded.people.staff2);
			const manager = await as(seeded.people.manager);
			const token = (await counterQr(manager, seeded.storeA, false)).token;
			expect((await clockIn(staff, seeded.storeA, token, 100_000)).state).toBe(
				"clocked_in",
			);
			const coffee = draftOf([
				{
					itemId: seeded.items.coffee,
					itemName: "Cà phê sữa",
					sizeId: seeded.sizes.coffeeM,
					price: COFFEE_M,
					qty: 2,
				},
			]);
			const sale = await place(seeded.people.staff2, coffee);
			expect((await recordPayment(staff, sale, "cash")).state).toBe("paid");
			const byCard = await place(seeded.people.staff2, {
				...coffee,
				requestId: crypto.randomUUID(),
			});
			expect((await recordPayment(staff, byCard, "card")).state).toBe("paid");
			const returned = await place(seeded.people.staff2, {
				...coffee,
				requestId: crypto.randomUUID(),
			});
			const paidBack = await recordPayment(staff, returned, "cash");
			const cancelled = await act(
				staff,
				paidBack.order,
				"cancel",
				"customer_request",
			);
			expect(cancelled.order.payment_status).toBe("refund_pending");
			expect(
				(await refund(staff, returned.id, 2 * COFFEE_M, "Khách đổi ý")).state,
			).toBe("succeeded");

			// the blind count: the person's own open shift answers count_required, with no expected figure anywhere
			const open = (await myShift(staff)).shift;
			expect(open?.status).toBe("open");
			expect(open === null || mayReadReconciliation(open, null)).toBe(false);
			const blind = await shiftReconciliation(staff, open?.id ?? "");
			expect(blind).toMatchObject({
				state: "refused",
				refusal: "count_required",
				reconciliation: null,
			});
			expect(JSON.stringify(blind)).not.toMatch(/expected|cash_difference/);
			// a manager reads another person's open shift: the figures so far, not counted
			const soFar = await shiftReconciliation(manager, open?.id ?? "");
			expect(soFar).toMatchObject({
				state: "ok",
				reconciliation: {
					counted: false,
					counted_cash: null,
					matched: null,
					expected_cash: 100_000 + 2 * COFFEE_M,
				},
			});
			// security: another staff member of the store and another store's staff are refused
			for (const person of [seeded.people.staff, seeded.people.staffB])
				expect(
					forbidden(
						await shiftReconciliation(await as(person), open?.id ?? "").catch(
							(error: unknown) => error,
						),
					),
				).toBe(true);

			// the count: 8.000đ short
			const counted = await clockOut(staff, 100_000 + 2 * COFFEE_M - 8_000);
			expect(counted.state).toBe("awaiting_confirmation");
			const after = (await myShift(staff)).shift;
			expect(after !== null && mayReadReconciliation(after, null)).toBe(true);
			const read = await shiftReconciliation(staff, after?.id ?? "");
			if (read.state !== "ok") throw new Error("still blind");
			const value = read.reconciliation;
			expect(value).toMatchObject({
				counted: true,
				opening_cash: 100_000,
				cash_sales: { count: 2, total: 4 * COFFEE_M },
				cash_refunds: { count: 1, total: 2 * COFFEE_M },
				paid_outs: { count: 0, total: 0 },
				expected_cash: 100_000 + 2 * COFFEE_M,
				counted_cash: 100_000 + 2 * COFFEE_M - 8_000,
				cash_difference: -8_000,
				matched: false,
				not_in_drawer: {
					card: { count: 1, total: 2 * COFFEE_M },
					card_refunds: { count: 0, total: 0 },
				},
			});
			// the screen's lines add up to the server's expected cash (opening + sales − refunds − paid-outs)
			expect(
				drawerLines(value).reduce((sum, line) => sum + line.amount, 0),
			).toBe(value.expected_cash);
			// the owner reads it too (any store of the tenant)
			expect(
				(
					await shiftReconciliation(
						await as(seeded.people.owner),
						after?.id ?? "",
					)
				).state,
			).toBe("ok");
		});

		it("Q02 (security): a manager on shift counts blind too", async () => {
			const manager = await as(seeded.people.manager);
			const token = (await counterQr(manager, seeded.storeA, false)).token;
			expect((await clockIn(manager, seeded.storeA, token, 0)).state).toBe(
				"clocked_in",
			);
			const own = (await myShift(manager)).shift;
			const answer = await shiftReconciliation(manager, own?.id ?? "");
			expect(answer).toMatchObject({
				state: "refused",
				refusal: "count_required",
				reconciliation: null,
			});
			expect(JSON.stringify(answer)).not.toMatch(/expected|cash_difference/);
			expect((await clockOut(manager, 0)).state).toBe("closed");
			const closed = await shiftReconciliation(manager, own?.id ?? "");
			expect(closed).toMatchObject({
				state: "ok",
				reconciliation: { counted: true, matched: true, cash_difference: 0 },
			});
		});
	},
);
