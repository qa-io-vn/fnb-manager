import {
	readCancelRequestAnswer,
	readCustomerRequests,
	readDataExport,
	readDeleteAccountAnswer,
	readStampCard,
	readStampCodeAnswer,
} from "@fnb/zalo-mini/ordering";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addLine, emptyDraft, requestOf } from "../../src/create/draft";
import { RpcError, rpc } from "../../src/lib/rpc";
import {
	answerRequest,
	inbox,
	markRead,
	vietnamInstant,
} from "../../src/manager/requests";
import { orderDetail, recordPayment } from "../../src/orders/api";
import {
	attachMember,
	lookupMember,
	readMemberCode,
} from "../../src/orders/member";
import type { Order } from "../../src/orders/types";
import {
	clockIn,
	clockOut,
	confirmShift,
	counterQr,
	managerShifts,
	myShift,
	onShiftAt,
	stageAfterClockOut,
} from "../../src/shift/api";
import {
	asCustomer,
	COFFEE_M,
	connect,
	dropCounterTenant,
	issueStampCode,
	type LocalStack,
	localStackFromEnv,
	placeCustomerOrder,
	type SeededPerson,
	type SeededTenant,
	seedCounterTenant,
	seedCustomer,
	seedJoinedCustomer,
	submitBooking,
} from "../support/seed";

// counter:integration/screens-phase1: the calls behind the screens wired on 2026-11-28 (native-till.md section 16),
// through PostgREST with real staff sessions and, for the customer's side, the customer app's own readers
// (@fnb/zalo-mini/ordering) on the database's real answers; a synthetic tenant only.
// - Q02 (state transitions): count → reason required → reason kept → manager confirms; BVA/EP of the reason and note
//   against the server; the count stays blind; staff cannot confirm (manager-only).
// - Q01-I8: cash and card need an open shift at the order's store (shift_required at another store's shift).
// - Q01/C20: the member code issued, looked up by number and by QR (only the short name and the stamps), attached,
//   replayed, another holder refused, another store's staff refused (IDOR), guesses limited.
// - M01: mark as read and the unread count, a proposal (BVA of the time on the server), the customer's view of it and
//   their cancel, a confirmation moving the booking; staff refused.
// - C19: delete a never-joined login (open orders refuse; a joined login is sent to the request), the export holds only
//   the caller's data; C06: ready_estimate_at.

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
	"the phase-1 screens' calls on the local stack",
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

		async function counterOrder(person: SeededPerson): Promise<Order> {
			const draft = addLine(
				{ ...emptyDraft(crypto.randomUUID()), type: "takeaway" },
				{
					itemId: seeded.items.coffee,
					itemName: "Cà phê sữa",
					sizeId: seeded.sizes.coffeeM,
					sizeLabel: "Vừa",
					unitPrice: COFFEE_M,
					options: [],
					qty: 2,
					note: "",
				},
			);
			const created = await rpc<{ state: string; order: Order }>(
				await as(person),
				"counter_create_order",
				{ p_store: seeded.storeA, p_request: requestOf(draft) },
			);
			expect(created.state).toBe("placed");
			return created.order;
		}

		const forbidden = (error: unknown) =>
			error instanceof RpcError && error.forbidden;

		beforeAll(async () => {
			if (stack === null) return;
			sql = connect(stack);
			seeded = await seedCounterTenant(stack, sql, "ct-sp");
		});

		afterAll(async () => {
			if (stack === null || seeded === undefined) return;
			await dropCounterTenant(stack, sql, seeded);
			await sql.end({ timeout: 5 });
		});

		it("Q02 (ST): a short count asks the cashier's reason, the reason is kept for the manager, and only a manager confirms", async () => {
			const staff = await as(seeded.people.staff);
			const manager = await as(seeded.people.manager);
			const token = (await counterQr(manager, seeded.storeA, false)).token;
			expect((await clockIn(staff, seeded.storeA, token, 100_000)).state).toBe(
				"clocked_in",
			);
			// the count is blind: the open shift carries no expected cash
			const open = await myShift(staff);
			expect(open.shift?.status).toBe("open");
			expect(open.shift?.expected_cash).toBeUndefined();

			const short = await clockOut(staff, 50_000);
			expect(short).toMatchObject({
				state: "awaiting_confirmation",
				reason_required: true,
			});
			expect(stageAfterClockOut(short, "open")).toBe("reason_required");

			// the server's bounds of the reason and its note (EP, BVA)
			const refusedWith = async (args: Record<string, unknown>) =>
				await rpc(staff, "staff_clock_out", {
					p_counted_cash: 50_000,
					...args,
				}).catch((error: unknown) => (error as RpcError).code);
			expect(await refusedWith({ p_reason: "petty_cash", p_note: null })).toBe(
				"22023",
			);
			expect(await refusedWith({ p_reason: null, p_note: "Mua đá" })).toBe(
				"22023",
			);
			expect(await refusedWith({ p_reason: "other", p_note: "Mua đá" })).toBe(
				"22023",
			);
			expect(
				await refusedWith({ p_reason: "petty_cash", p_note: "a".repeat(201) }),
			).toBe("22023");
			expect(
				await refusedWith({ p_reason: "petty_cash", p_note: "dòng một\nhai" }),
			).toBe("22023");

			const given = await clockOut(staff, 50_000, {
				code: "petty_cash",
				note: ` ${"á".repeat(199)}b `,
			});
			expect(given).toMatchObject({
				state: "awaiting_confirmation",
				reason_required: false,
			});
			const kept = await clockOut(staff, 50_000, {
				code: "wrong_change",
				note: "Trả thừa khách bàn 2",
			});
			expect(stageAfterClockOut(kept, "awaiting_manager")).toBe(
				"awaiting_manager",
			);
			expect(kept.state === "refused" ? null : kept.shift).toMatchObject({
				difference_reason: "wrong_change",
				difference_note: "Trả thừa khách bàn 2",
				cash_difference: -50_000,
			});

			const today = new Date(Date.now() + 7 * HOUR);
			const list = await managerShifts(
				manager,
				seeded.storeA,
				new Date(today.getTime() - 24 * HOUR).toISOString().slice(0, 10),
				new Date(today.getTime() + 24 * HOUR).toISOString().slice(0, 10),
			);
			const row = list.shifts.find(
				(entry) => entry.user_id === seeded.people.staff.id,
			);
			expect(row).toMatchObject({
				status: "awaiting_confirmation",
				difference_reason: "wrong_change",
				difference_note: "Trả thừa khách bàn 2",
			});
			// manager-only: the staff member cannot confirm (their own or anyone's) shift
			const refused = await confirmShift(
				staff,
				row?.id ?? "",
				"tự xác nhận",
			).catch((error: unknown) => error);
			expect(forbidden(refused)).toBe(true);
			const confirmed = await confirmShift(
				manager,
				row?.id ?? "",
				"Trả nhầm tiền thừa · đã xem",
			);
			expect(confirmed.state).toBe("closed");
		});

		it("Q01-I8: cash and card are refused (shift_required) while the person's open shift is at another store", async () => {
			const owner = await as(seeded.people.owner);
			const tokenB = (await counterQr(owner, seeded.storeB, false)).token;
			const shift = await clockIn(owner, seeded.storeB, tokenB, 0);
			expect(shift.state).toBe("clocked_in");
			expect(onShiftAt(shift.shift, seeded.storeA)).toBe(false);
			expect(onShiftAt(shift.shift, seeded.storeB)).toBe(true);
			const order = await counterOrder(seeded.people.owner);
			for (const method of ["cash", "card"] as const) {
				const answer = await recordPayment(owner, order, method);
				expect(answer).toMatchObject({
					state: "refused",
					refusal: "shift_required",
				});
			}
			expect((await orderDetail(owner, order.id)).payment_status).toBe(
				"unpaid",
			);
			expect((await clockOut(owner, 0)).state).toBe("closed");
		});

		it("C20 → Q01: the member code is looked up by number and by QR, shows only the short name and stamps, and attaches once", async () => {
			const staff = await as(seeded.people.staff);
			const joined = await seedJoinedCustomer(
				sql,
				seeded,
				"Trần Thị Mẫu",
				"0900000002",
			);
			const issued = readStampCodeAnswer(
				await issueStampCode(sql, seeded, joined),
			);
			if (issued.state !== "issued") throw new Error("no code");
			const { code } = issued;
			expect(Date.parse(code.expiresAt) - Date.parse(code.issuedAt)).toBe(
				10 * 60_000,
			);
			expect(Date.parse(code.refreshAt) - Date.parse(code.issuedAt)).toBe(
				9 * 60_000,
			);
			// the app's own check digit agrees with the server's number
			expect(readMemberCode(code.displayNumber)).toEqual({
				ok: true,
				kind: "number",
				code: code.number,
			});

			const byNumber = await lookupMember(staff, seeded.storeA, code.number);
			expect(byNumber).toMatchObject({
				state: "found",
				member: { name: "Mẫu", stamps: 0, stamps_per_reward: 9 },
			});
			// security: no phone, no full name, no id in what the counter receives
			const seen = JSON.stringify(byNumber);
			for (const secret of ["0900000002", "Trần Thị", joined])
				expect(seen).not.toContain(secret);
			expect(Object.keys(byNumber.member ?? {}).sort()).toEqual([
				"code_expires_at",
				"name",
				"rewards_available",
				"stamps",
				"stamps_per_reward",
			]);
			const byQr = await lookupMember(staff, seeded.storeA, code.qrPayload);
			expect(byQr.state).toBe("found");
			const slipped = `${code.number.slice(0, 7)}${(Number(code.number[7]) + 1) % 10}`;
			expect(readMemberCode(slipped)).toMatchObject({ ok: false });
			expect(await lookupMember(staff, seeded.storeA, slipped)).toMatchObject({
				state: "refused",
				refusal: "code_mistyped",
			});

			const visitor = await seedCustomer(sql, seeded);
			const visitorCode = readStampCodeAnswer(
				await issueStampCode(sql, seeded, visitor),
			);
			if (visitorCode.state !== "issued") throw new Error("no code");
			expect(
				await lookupMember(staff, seeded.storeA, visitorCode.code.number),
			).toMatchObject({ state: "found", member: { name: null } });

			const order = await counterOrder(seeded.people.staff);
			expect(order.member_attached).toBe(false);
			const attached = await attachMember(staff, order, code.number);
			expect(attached).toMatchObject({
				state: "attached",
				replayed: false,
				stamps: 2,
				stamps_earned_now: false,
			});
			expect(attached.order.member_attached).toBe(true);
			const replay = await attachMember(staff, order, code.qrPayload);
			expect(replay).toMatchObject({ state: "attached", replayed: true });
			const other = await attachMember(
				staff,
				attached.order,
				visitorCode.code.number,
			);
			expect(other).toMatchObject({
				state: "refused",
				refusal: "already_attached",
			});

			// IDOR: a staff member of store B reaches neither A's order nor A's lookup
			const staffB = await as(seeded.people.staffB);
			expect(
				forbidden(
					await attachMember(staffB, attached.order, code.number).catch(
						(error: unknown) => error,
					),
				),
			).toBe(true);
			expect(
				forbidden(
					await lookupMember(staffB, seeded.storeA, code.number).catch(
						(error: unknown) => error,
					),
				),
			).toBe(true);

			// the customer sees the attach on their card (C20 frame 5)
			const card = await asCustomer(sql, seeded, joined, async (tx) => {
				const [row] = await tx<
					{ r: unknown }[]
				>`select public.customer_stamp_card() as r`;
				return readStampCard(row?.r);
			});
			expect(card.attached).toHaveLength(1);
			expect(card.attached[0]).toMatchObject({
				orderNo: order.display_no,
				stamps: 2,
			});

			// a new code revokes the earlier one
			const again = readStampCodeAnswer(
				await issueStampCode(sql, seeded, joined),
			);
			expect(again.state).toBe("issued");
			expect(
				await lookupMember(staff, seeded.storeA, code.number),
			).toMatchObject({ state: "refused", refusal: "code_unknown" });
		});

		it("security: member number guesses are limited to 5 misses a person (then rate_limited with a time)", async () => {
			const guesser = await as(seeded.people.staff2);
			const guesses: string[] = [];
			for (let seed = 1000; guesses.length < 6; seed += 1) {
				const candidate = `${String(seed).padStart(7, "0")}`;
				for (let check = 0; check <= 9; check += 1) {
					const read = readMemberCode(`${candidate}${check}`);
					if (read.ok) {
						guesses.push(read.code);
						break;
					}
				}
			}
			const answers = [];
			for (const guess of guesses)
				answers.push(await lookupMember(guesser, seeded.storeA, guess));
			expect(answers.slice(0, 5).map((answer) => answer.refusal)).toEqual(
				Array(5).fill("code_unknown"),
			);
			expect(answers[5]).toMatchObject({
				state: "refused",
				refusal: "rate_limited",
			});
			expect(
				answers[5]?.state === "refused" ? answers[5].retry_at : null,
			).toBeTruthy();
		});

		it("M01 (ST): opening reads a request, a proposal is checked by the server, the customer sees it and cancels; a confirmation moves the booking", async () => {
			const manager = await as(seeded.people.manager);
			const staff = await as(seeded.people.staff);
			const customer = await seedCustomer(sql, seeded);
			const asked = vietnamTomorrowAt("19:00");
			const first = await submitBooking(sql, seeded, customer, asked);

			const before = await inbox(manager, seeded.storeA);
			const row = before.requests.find((entry) => entry.id === first.id);
			expect(row).toMatchObject({ status: "new", read_at: null });
			expect(before.unread).toBeGreaterThanOrEqual(1);
			// manager-only: staff can neither read the inbox nor mark a request read
			expect(
				forbidden(
					await inbox(staff, seeded.storeA).catch((error: unknown) => error),
				),
			).toBe(true);
			expect(
				forbidden(
					await markRead(staff, first.id).catch((error: unknown) => error),
				),
			).toBe(true);

			const read = await markRead(manager, first.id);
			expect(read.request).toMatchObject({ read_by: seeded.people.manager.id });
			const readAt = read.request.read_at;
			expect((await markRead(manager, first.id)).request.read_at).toBe(readAt);
			const after = await inbox(manager, seeded.storeA);
			expect(after.unread).toBe(before.unread - 1);

			// BVA on the server: 10 minutes ahead and the very time asked are refused
			const soon = new Date(Date.now() + 10 * 60_000).toISOString();
			expect(
				await answerRequest(
					manager,
					first,
					"proposed",
					"Giờ đó kín bàn.",
					soon,
				),
			).toMatchObject({ state: "refused", refusal: "time_invalid" });
			expect(
				await answerRequest(
					manager,
					first,
					"proposed",
					"Giờ đó kín bàn.",
					asked,
				),
			).toMatchObject({ state: "refused", refusal: "time_invalid" });
			const proposed = vietnamTomorrowAt("19:30");
			const answered = await answerRequest(
				manager,
				first,
				"proposed",
				"Giờ đó kín bàn,\nquán còn chỗ lúc 19:30.",
				proposed,
			);
			expect(answered).toMatchObject({
				state: "answered",
				request: { status: "proposed" },
			});
			expect(Date.parse(answered.request?.proposed_for ?? "")).toBe(
				Date.parse(proposed),
			);

			const seen = await asCustomer(sql, seeded, customer, async (tx) => {
				const [r] = await tx<
					{ r: unknown }[]
				>`select public.customer_requests() as r`;
				return r?.r;
			});
			expect(JSON.stringify(seen)).not.toContain("0900000001");
			const mine = readCustomerRequests(seen).requests.find(
				(entry) => entry.id === first.id,
			);
			expect(mine).toMatchObject({
				status: "proposed",
				answerMessage: "Giờ đó kín bàn, quán còn chỗ lúc 19:30.",
			});
			expect(Date.parse(mine?.proposedFor ?? "")).toBe(Date.parse(proposed));
			const cancelled = await asCustomer(sql, seeded, customer, async (tx) => {
				const [r] = await tx<
					{ r: unknown }[]
				>`select public.customer_cancel_request(${first.id}::uuid) as r`;
				return readCancelRequestAnswer(r?.r);
			});
			expect(cancelled).toMatchObject({
				state: "cancelled",
				request: { status: "cancelled" },
			});

			// a second booking: proposed, then the customer agrees and the manager confirms: the time moves
			const second = await submitBooking(
				sql,
				seeded,
				customer,
				vietnamTomorrowAt("18:00"),
			);
			const moved = await answerRequest(
				manager,
				second,
				"proposed",
				"Mời bạn đến lúc 18:30.",
				vietnamTomorrowAt("18:30"),
			);
			const agreed = await answerRequest(
				manager,
				moved.request ?? second,
				"confirmed",
				"",
			);
			expect(agreed).toMatchObject({
				state: "answered",
				request: { status: "confirmed" },
			});
			expect(Date.parse(agreed.request?.requested_for ?? "")).toBe(
				Date.parse(vietnamTomorrowAt("18:30")),
			);
		});

		it("C19: a never-joined login with an open order is refused, then deleted at once; a joined login goes to the request", async () => {
			const visitor = await seedCustomer(sql, seeded);
			const placed = await placeCustomerOrder(sql, seeded, visitor, {
				table: seeded.tables.t2,
				lines: [{ size: seeded.sizes.tea, qty: 1 }],
				expectedTotal: 39_000,
			});
			expect(placed.state).toBe("placed");
			const deleteAs = (customer: string) =>
				asCustomer(sql, seeded, customer, async (tx) => {
					const [r] = await tx<
						{ r: unknown }[]
					>`select public.customer_delete_account(true) as r`;
					return readDeleteAccountAnswer(r?.r);
				});
			expect(await deleteAs(visitor)).toEqual({
				state: "refused",
				refusal: "open_orders",
				orders: 1,
			});
			await asCustomer(sql, seeded, visitor, async (tx) => {
				await tx`select public.customer_cancel_order(${placed.order?.id ?? ""}::uuid)`;
			});
			const deleted = await deleteAs(visitor);
			expect(deleted.state).toBe("deleted");
			// the old session does nothing any more
			const after = await asCustomer(
				sql,
				seeded,
				visitor,
				async (tx) => tx`select public.customer_stamp_code()`,
			).then(
				() => "ok",
				(error: { code?: string }) => error.code,
			);
			expect(after).toBe("42501");

			const joined = await seedJoinedCustomer(
				sql,
				seeded,
				"Khách Thành Viên",
				"0900000003",
			);
			expect(await deleteAs(joined)).toMatchObject({
				state: "refused",
				refusal: "member_request",
			});
		});

		it("C19: the export holds the caller's own data only, and the app's reader takes it", async () => {
			const one = await seedCustomer(sql, seeded);
			const two = await seedCustomer(sql, seeded);
			const mine = await submitBooking(
				sql,
				seeded,
				one,
				vietnamTomorrowAt("17:00"),
			);
			const theirs = await submitBooking(
				sql,
				seeded,
				two,
				vietnamTomorrowAt("17:30"),
			);
			const exported = await asCustomer(sql, seeded, one, async (tx) => {
				const [r] = await tx<
					{ r: unknown }[]
				>`select public.customer_export_data() as r`;
				return readDataExport(r?.r);
			});
			const text = JSON.stringify(exported.raw);
			expect(text).toContain(mine.id);
			expect(text).not.toContain(theirs.id);
			expect(exported.sections.map((section) => section.key)).toContain(
				"not_kept",
			);
		});

		it("C06: ready_estimate_at is null before acceptance and the acceptance plus the store's preparation time after", async () => {
			const customer = await seedCustomer(sql, seeded);
			const placed = await placeCustomerOrder(sql, seeded, customer, {
				table: seeded.tables.t3,
				lines: [{ size: seeded.sizes.coffeeM, qty: 1 }],
				expectedTotal: COFFEE_M,
			});
			const staff = await as(seeded.people.staff);
			const detail = await orderDetail(staff, placed.order?.id ?? "");
			if (detail.status === "accepted" && detail.accepted_at !== null) {
				expect(
					Date.parse(detail.ready_estimate_at ?? "") -
						Date.parse(detail.accepted_at),
				).toBe(10 * 60_000);
			} else {
				expect(detail.ready_estimate_at ?? null).toBeNull();
			}
		});
	},
);
