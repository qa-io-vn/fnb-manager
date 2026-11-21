// Test design (ISTQB) for the rest of G-91, the manager queue (ADR-043 and ADR-044): system tests on the live local
// stack with the REAL functions of the database, the customer Mini App (the wallet) and the staff Mini App's
// "Duyệt hóa đơn" screen, on the synthetic tenant loyalty-sim whose store sim-1 is put in staff mode with self claims
// for the test and back afterwards. The queued bills are made the way a store makes them: the customer claims with the
// counter QR and the staff member's blind total disagrees, or a total is above the approval threshold.
// - use case: a manager sees the queue at the store (count on the home card, both totals, the reason, who recorded it),
//   approves one bill (the customer's wallet then shows the stamp and the points) and does not approve another (no
//   stamp, nothing in the ledger);
// - state transitions: queued -> confirmed (approved) and queued -> rejected (a counter claim has no earn to claw
//   back); decisions on a bill that is no longer queued are refused (not_queued) and write nothing: a repeated
//   decision is not an idempotent success but a refusal that names the state the bill is in;
// - decision table of who may decide: a store manager decides (the reason is required, 1 to 200 characters), a manager
//   may not approve the bill they recorded themselves (own_bill), another manager of the store may, a staff member
//   (42501), a manager of another store (42501, the same answer as for a bill that does not exist, so no existence
//   oracle), the customer and the anonymous role (42501) may not;
// - boundary values: a counter claim of exactly the approval threshold (1,000,000 with agreeing totals) confirms at
//   once, 1,000,001 waits for a manager (over_approval), a reason of 200 characters is taken and 201 is refused;
// - security: no full phone in any data response of either app, the queue is empty for a manager of another store and
//   refused for the store it does not belong to, no staff function answers a customer session.
// Every member, phone, bill number and code is synthetic; the specs erase their customers, bills, counter codes, audit
// rows and alerts, and restore the stores.
import { checkMiniAppScreen } from "@fnb/zalo-mini/testing/design-checks";
import {
	callRpc,
	type RpcCredentials,
	watchResponsePhones,
	watchRpcCredentials,
} from "@fnb/zalo-mini/testing/network-scan";
import { expect, test } from "@playwright/test";
import {
	answerClaim,
	billNo,
	billOf,
	decide,
	openStaffHome,
	STORE,
	staffLoopArgs,
	stampsOnCard,
	submitClaim,
} from "./counter-flow";
import { watchCustomerPage } from "./customer-checks";
import { LocalLoop, localStackRuns, portOf, type Ready } from "./local-loop";
import {
	type LoyaltyFixture,
	openLoyaltyFixture,
	type SyntheticCustomer,
	type SyntheticStaff,
} from "./loyalty-fixture";
import { browseAndJoin, customerLoopArgs } from "./loyalty-flow";

const CUSTOMER_PORT = portOf(5788);
const STAFF_PORT = portOf(5789);
const POS_STORE = "sim-2";
const STACK_SKIP =
	"set ZALO_LOCAL_DEV=1 with the local stack running to drive pnpm zalo:dev on loyalty-sim";

let fixture: LoyaltyFixture | null = null;
const loops: LocalLoop[] = [];
const contexts: { close(): Promise<void> }[] = [];

test.beforeEach(async ({ page }) => {
	test.skip(!(await localStackRuns()), STACK_SKIP);
	await watchCustomerPage(page, null);
	fixture = await openLoyaltyFixture();
	await fixture.setStoreMode(STORE, "staff");
	await fixture.configureStore(STORE, { selfClaim: true });
});

test.afterEach(async () => {
	for (const context of contexts.splice(0)) await context.close();
	for (const loop of loops.splice(0)) await loop.dispose();
	const current = fixture;
	fixture = null;
	if (current !== null) {
		const counts = await current.cleanup();
		test.info().annotations.push({
			type: "cleanup",
			description: JSON.stringify(counts),
		});
	}
});

function need(): LoyaltyFixture {
	if (fixture === null) throw new Error("no fixture");
	return fixture;
}

async function startCustomerLoop(customer: SyntheticCustomer): Promise<Ready> {
	const loop = new LocalLoop();
	loops.push(loop);
	return loop.start(customerLoopArgs(customer, CUSTOMER_PORT));
}

async function startStaffLoop(staff: SyntheticStaff): Promise<Ready> {
	const loop = new LocalLoop();
	loops.push(loop);
	return loop.start(staffLoopArgs(staff, STAFF_PORT));
}

function scanOf(
	page: Parameters<typeof watchResponsePhones>[0],
	ready: Ready,
	allowed: readonly string[] = [],
) {
	return watchResponsePhones(page, new URL(ready.appUrl).origin, allowed);
}

interface Queued {
	readonly no: string;
	readonly id: string;
}

/** a counter claim by the customer, answered by `answerer` with a total that disagrees: the bill is queued */
async function queueClaim(
	f: LoyaltyFixture,
	customerSession: RpcCredentials,
	answerer: RpcCredentials,
	customerTotal: number,
	staffTotal: number,
): Promise<Queued> {
	const code = await f.insertCounterCode(STORE, {
		issuedAgo: 5,
		expiresIn: 85,
	});
	const no = billNo();
	const claim = await submitClaim(
		customerSession,
		code.payload,
		no,
		customerTotal,
	);
	expect(claim.body).toMatchObject({ state: "awaiting_staff" });
	const id = billOf(claim);
	const answered = await answerClaim(answerer, id, { total: staffTotal });
	expect(answered.body).toMatchObject({ state: "queued" });
	return { no, id };
}

const REASON = "Đã kiểm tra hóa đơn giấy";

test("a manager reviews the queue: approves one bill (the wallet shows the stamp), does not approve another (no stamp), and the roles that may not decide are refused (use case, state transitions, decision table)", async ({
	page,
	browser,
}) => {
	const f = need();
	const { tenant } = f;
	const customer = await f.newCustomer();
	const staffMember = await f.newStaff(STORE, "staff");
	const manager = await f.newStaff(STORE, "manager");
	const second = await f.newStaff(STORE, "manager");
	const outsider = await f.newStaff(POS_STORE, "manager");
	const [customerReady, managerReady] = await Promise.all([
		startCustomerLoop(customer),
		startStaffLoop(manager),
	]);
	const customerScan = scanOf(page, customerReady, [customer.phone]);
	const credentials = watchRpcCredentials(page);
	await browseAndJoin(page, customerReady.appUrl, tenant);
	const customerSession = credentials();
	const asStaff = await f.staffSession(staffMember);
	const asManager = await f.staffSession(manager);
	const asSecond = await f.staffSession(second);
	const asOutsider = await f.staffSession(outsider);

	// three queued bills: two answered by a staff member, one by the manager who will review the queue
	const q1 = await queueClaim(f, customerSession, asStaff, 85_000, 20_000);
	const q2 = await queueClaim(f, customerSession, asStaff, 60_000, 20_000);
	const q3 = await queueClaim(f, customerSession, asManager, 70_000, 20_000);
	const states = async () =>
		(await f.bills(customer)).map((bill) => [
			bill.billNo,
			bill.state,
			bill.queueReason,
			bill.earns,
		]);
	const queuedStates = [
		[q1.no, "queued", "disagreement", 0],
		[q2.no, "queued", "disagreement", 0],
		[q3.no, "queued", "disagreement", 0],
	];
	expect(await states()).toEqual(expect.arrayContaining(queuedStates));

	// who may decide: a staff member, a manager of another store, the customer and the anonymous role are refused and
	// nothing changes; a bill that does not exist answers a manager of another store exactly like a real one
	const store = f.storeId(STORE);
	const staffDecision = await decide(asStaff, q1.id, "approved", REASON);
	expect([staffDecision.status, staffDecision.code]).toEqual([403, "42501"]);
	const staffQueue = await callRpc(asStaff, "staff_bill_queue", {
		p_store_id: store,
	});
	expect([staffQueue.status, staffQueue.code]).toEqual([403, "42501"]);
	const outsiderReal = await decide(asOutsider, q1.id, "approved", REASON);
	const outsiderNone = await decide(
		asOutsider,
		"00000000-0000-4000-8000-000000000000",
		"approved",
		REASON,
	);
	expect([outsiderReal.status, outsiderReal.code]).toEqual([403, "42501"]);
	expect([outsiderNone.status, outsiderNone.code]).toEqual([403, "42501"]);
	expect(outsiderReal.body.message).toBe(outsiderNone.body.message);
	for (const name of ["staff_bill_queue", "staff_recent_bills"] as const) {
		const seen = await callRpc(asOutsider, name, { p_store_id: store });
		expect([seen.status, seen.code], `${name} of another store`).toEqual([
			403,
			"42501",
		]);
	}
	const ownQueue = await callRpc(asOutsider, "staff_bill_queue", {
		p_store_id: f.storeId(POS_STORE),
	});
	expect(ownQueue.status).toBe(200);
	expect(ownQueue.body).toEqual({ bills: [], audits: [] });
	const asCustomer = await decide(customerSession, q1.id, "approved", REASON);
	expect([asCustomer.status, asCustomer.code]).toEqual([403, "42501"]);
	const asAnonymous = await callRpc(
		customerSession,
		"staff_decide_bill",
		{ p_bill_id: q1.id, p_decision: "approved", p_reason: REASON },
		{ anonymous: true },
	);
	expect(asAnonymous.code).toBe("42501");
	expect(await states()).toEqual(expect.arrayContaining(queuedStates));

	// input abuse by the right role: another decision, no reason, 201 characters, a control character (22023)
	for (const [decision, reason] of [
		["maybe", REASON],
		[null, REASON],
		["approved", null],
		["approved", "   "],
		["approved", "x".repeat(201)],
		["approved", "bad\u0007reason"],
		["Approved", REASON],
	] as const) {
		const bad = await decide(asSecond, q1.id, decision, reason);
		expect(
			[bad.status, bad.code],
			`${decision} ${String(reason).slice(0, 6)}`,
		).toEqual([400, "22023"]);
	}
	expect(await states()).toEqual(expect.arrayContaining(queuedStates));

	// the manager's screen
	const desk = await openStaffHome(browser, page, managerReady, contexts);
	const deskScan = scanOf(desk, managerReady);
	await expect(desk.getByTestId("home-bill-queue-count")).toHaveText(
		"3 việc cần duyệt",
	);
	await desk
		.getByTestId("home-bill-queue")
		.getByRole("button", { name: "Mở duyệt hóa đơn" })
		.click();
	await expect(desk.getByTestId("bill-queue-body")).toHaveAttribute(
		"data-status",
		"ready",
	);
	const cards = desk.getByTestId("queued-bill");
	await expect(cards).toHaveCount(3);
	await expect(cards.nth(0)).toHaveAttribute("data-bill-no", q1.no);
	await expect(cards.nth(1)).toHaveAttribute("data-bill-no", q2.no);
	await expect(cards.nth(2)).toHaveAttribute("data-bill-no", q3.no);
	const card1 = desk.locator(
		`[data-testid=queued-bill][data-bill-no=${q1.no}]`,
	);
	await expect(card1).toHaveAttribute("data-reason", "disagreement");
	await expect(card1).toContainText("Hai số tiền khác nhau");
	await expect(card1).toContainText("Khách tự gửi");
	await expect(card1.getByTestId("staff-total")).toHaveText(
		/Nhân viên nhập: 20[.,\s]?000/,
	);
	await expect(card1.getByTestId("customer-total")).toHaveText(
		/Khách nhập: 85[.,\s]?000/,
	);
	await expect(card1.getByTestId("queued-member")).toContainText(
		customer.phone.slice(-3),
	);
	await expect(card1.getByTestId("queued-member")).not.toContainText(
		customer.phone,
	);
	await expect(card1.getByTestId("queued-own")).toHaveCount(0);
	const card3 = desk.locator(
		`[data-testid=queued-bill][data-bill-no=${q3.no}]`,
	);
	await expect(card3.getByTestId("queued-own")).toHaveText(
		"Bạn ghi hóa đơn này",
	);
	await checkMiniAppScreen(desk);

	const decisions = async () =>
		(await deskScan.responses()).filter((line) =>
			line.includes("staff_decide_bill"),
		);
	// no reason: the screen refuses before any call
	await card1.getByRole("button", { name: `Xử lý hóa đơn ${q1.no}` }).click();
	await desk.getByRole("button", { name: "Duyệt", exact: true }).click();
	await expect(desk.getByTestId("bill-decide-reason-problem")).toHaveText(
		"Hãy ghi lý do.",
	);
	expect(await decisions()).toEqual([]);
	// approve the first
	await desk.getByTestId("bill-decide-reason").fill(REASON);
	await desk.getByRole("button", { name: "Duyệt", exact: true }).click();
	await expect(desk.getByTestId("result-modal")).toHaveText("Đã duyệt hóa đơn");
	await expect(desk.getByTestId("result-modal")).toHaveCount(0);
	const afterApprove = (await f.bills(customer)).find(
		(bill) => bill.billNo === q1.no,
	);
	expect(afterApprove).toMatchObject({
		state: "confirmed",
		queueReason: null,
		decisionReason: REASON,
		evidenceLevel: 0,
		earns: 1,
		stamps: 1,
		points: 8,
		clawbacks: 0,
	});
	await stampsOnCard(page, f, 1);
	const earn = page.getByTestId("history-item").first();
	await expect(earn).toHaveAttribute("data-state", "confirmed");
	await expect(earn).toContainText("+1 dấu");
	await expect(earn).toContainText("+8 điểm");

	// do not approve the second: rejected, no earn, nothing to claw back
	await expect(desk.getByTestId("queued-bill")).toHaveCount(2);
	const card2 = desk.locator(
		`[data-testid=queued-bill][data-bill-no=${q2.no}]`,
	);
	await card2.getByRole("button", { name: `Xử lý hóa đơn ${q2.no}` }).click();
	await desk
		.getByTestId("bill-decide-reason")
		.fill("Không khớp với hóa đơn giấy");
	await desk.getByRole("button", { name: "Không duyệt", exact: true }).click();
	await expect(desk.getByTestId("result-modal")).toHaveText(
		"Đã không duyệt hóa đơn",
	);
	await expect(desk.getByTestId("result-modal")).toHaveCount(0);
	const afterReject = (await f.bills(customer)).find(
		(bill) => bill.billNo === q2.no,
	);
	expect(afterReject).toMatchObject({
		state: "rejected",
		queueReason: null,
		decisionReason: "Không khớp với hóa đơn giấy",
		earns: 0,
		confirms: 0,
		clawbacks: 0,
		stamps: 0,
		points: 0,
	});
	await stampsOnCard(page, f, 1);

	// a manager may not approve the bill they recorded: refused in words, still queued
	await expect(desk.getByTestId("queued-bill")).toHaveCount(1);
	await card3.getByRole("button", { name: `Xử lý hóa đơn ${q3.no}` }).click();
	await desk.getByTestId("bill-decide-reason").fill(REASON);
	await desk.getByRole("button", { name: "Duyệt", exact: true }).click();
	const refused = desk.getByTestId("bill-decide-refused");
	await expect(refused).toHaveAttribute("data-refusal", "own_bill");
	await expect(refused).toHaveText(
		"Quản lý không được tự duyệt hóa đơn mình đã ghi. Hãy nhờ chủ cửa hàng hoặc quản lý khác.",
	);
	await checkMiniAppScreen(desk);
	expect(
		(await f.bills(customer)).find((bill) => bill.billNo === q3.no),
	).toMatchObject({ state: "queued", earns: 0 });
	// another manager of the store may
	const byOther = await decide(asSecond, q3.id, "approved", REASON);
	expect(byOther.body).toMatchObject({
		state: "approved",
		bill_state: "confirmed",
	});
	await stampsOnCard(page, f, 2);

	// a decision on a bill that is no longer queued is refused and writes nothing (not idempotent: it names the state)
	for (const [id, decision, billState] of [
		[q1.id, "approved", "confirmed"],
		[q1.id, "rejected", "confirmed"],
		[q2.id, "approved", "rejected"],
		[q2.id, "rejected", "rejected"],
		[q3.id, "rejected", "confirmed"],
	] as const) {
		for (const session of [asManager, asSecond]) {
			const repeat = await decide(session, id, decision, REASON);
			expect(repeat.body, `${decision} on a ${billState} bill`).toMatchObject({
				state: "refused",
				refusal: "not_queued",
				bill_state: billState,
			});
		}
	}
	const finalRows = await f.bills(customer);
	expect(
		finalRows.map((bill) => [
			bill.billNo,
			bill.state,
			bill.earns,
			bill.stamps,
			bill.points,
			bill.clawbacks,
		]),
	).toEqual(
		expect.arrayContaining([
			[q1.no, "confirmed", 1, 1, 8, 0],
			[q2.no, "rejected", 0, 0, 0, 0],
			[q3.no, "confirmed", 1, 1, 7, 0],
		]),
	);
	const trail = await f.sql<{ action: string; actor: string | null }>`
		select action, actor::text as actor from public.loyalty_audit_events
		where subject_id in (${q1.id}::uuid, ${q2.id}::uuid, ${q3.id}::uuid)
			and action in ('bill_confirmed', 'bill_rejected')
		order by occurred_at
	`;
	expect(trail.map((row) => [row.action, row.actor])).toEqual([
		["bill_confirmed", manager.userId],
		["bill_rejected", manager.userId],
		["bill_confirmed", second.userId],
	]);

	// the queue is empty for the manager now
	await desk.getByRole("button", { name: "Quay lại" }).click();
	await expect(desk.getByTestId("home-bill-queue-count")).toHaveText(
		"Không có hóa đơn cần duyệt",
	);
	expect(await deskScan.leaks()).toEqual([]);
	expect(await customerScan.leaks()).toEqual([]);
	expect((await deskScan.responses()).join("\n")).toContain(
		"rpc/staff_bill_queue (200)",
	);
	expect(await decisions()).toEqual(
		expect.arrayContaining([
			expect.stringContaining("rpc/staff_decide_bill (200)"),
		]),
	);
});

test("a counter claim of exactly the approval threshold confirms with agreeing totals, one 1 đồng above waits for a manager (over_approval), and the manager's queue answers carry no full phone (boundary values)", async ({
	page,
}) => {
	const f = need();
	const { tenant } = f;
	const customer = await f.newCustomer();
	const staffMember = await f.newStaff(STORE, "staff");
	const manager = await f.newStaff(STORE, "manager");
	const customerReady = await startCustomerLoop(customer);
	const customerScan = scanOf(page, customerReady, [customer.phone]);
	const credentials = watchRpcCredentials(page);
	await browseAndJoin(page, customerReady.appUrl, tenant);
	const customerSession = credentials();
	const asStaff = await f.staffSession(staffMember);
	const asManager = await f.staffSession(manager);
	const [threshold] = await f.sql<{ above: string }>`
		select bill_manager_approval_above::text as above from public.loyalty_store_settings
		where store_id = ${f.storeId(STORE)}::uuid
	`;
	expect(Number(threshold?.above)).toBe(1_000_000);

	const claim = async (total: number) => {
		const code = await f.insertCounterCode(STORE, {
			issuedAgo: 5,
			expiresIn: 85,
		});
		const no = billNo();
		const sent = await submitClaim(customerSession, code.payload, no, total);
		expect(sent.body).toMatchObject({ state: "awaiting_staff" });
		return { no, id: billOf(sent) };
	};
	const atEdge = await claim(1_000_000);
	const edgeAnswer = await answerClaim(asStaff, atEdge.id, {
		total: 1_000_000,
	});
	expect(edgeAnswer.body).toMatchObject({
		state: "confirmed",
		evidence_level: 2,
		stamps_earned: 1,
		points_earned: 100,
	});
	const above = await claim(1_000_001);
	const aboveAnswer = await answerClaim(asStaff, above.id, {
		total: 1_000_001,
	});
	expect(aboveAnswer.body).toMatchObject({ state: "queued" });
	expect(
		(await f.bills(customer)).map((bill) => [
			bill.billNo,
			bill.state,
			bill.queueReason,
			bill.evidenceLevel,
		]),
	).toEqual(
		expect.arrayContaining([
			[atEdge.no, "confirmed", null, 2],
			[above.no, "queued", "over_approval", 2],
		]),
	);

	// the manager reads both totals through the data API; only a masked phone is in the answer
	const queue = await callRpc(asManager, "staff_bill_queue", {
		p_store_id: f.storeId(STORE),
	});
	expect(queue.status).toBe(200);
	const listed = (queue.body as { bills: Record<string, unknown>[] }).bills;
	expect(listed).toHaveLength(1);
	expect(listed[0]).toMatchObject({
		bill_no: above.no,
		source: "counter_claim",
		queue_reason: "over_approval",
		customer_total: 1_000_001,
		staff_total: 1_000_001,
		own: false,
	});
	expect(JSON.stringify(queue.body)).not.toContain(customer.phone);
	expect(String(listed[0]?.phone_masked)).toContain(customer.phone.slice(-3));

	// a reason of 200 characters is taken; the bill is confirmed with the level it reached (2)
	const approved = await decide(
		asManager,
		above.id,
		"approved",
		"x".repeat(200),
	);
	expect(approved.body).toMatchObject({
		state: "approved",
		bill_state: "confirmed",
	});
	expect(
		(await f.bills(customer)).find((bill) => bill.billNo === above.no),
	).toMatchObject({
		state: "confirmed",
		evidenceLevel: 2,
		earns: 1,
		stamps: 1,
		points: 100,
	});
	await stampsOnCard(page, f, 2);
	expect(await customerScan.leaks()).toEqual([]);
});
