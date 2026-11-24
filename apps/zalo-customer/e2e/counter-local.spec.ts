// Test design (ISTQB) for the rest of G-91, the counter claim (ADR-043 and ADR-044): system tests on the live local
// stack with the REAL functions of the database and both Mini Apps side by side (`pnpm zalo:dev`), on the synthetic
// tenant loyalty-sim whose store sim-1 is put in staff mode with self claims for the test and back afterwards.
// - use case: the staff app shows the counter QR (Mã quầy), the customer scans it with the stand-in camera and claims
//   a bill, the claim waits for a staff member (never confirmed by itself: auto-approval is off by default), the staff
//   member answers blind with the total on the paper bill and the wallet shows the stamp and the points (level 2);
// - state transitions: awaiting_staff -> confirmed (agreeing total), -> rejected (a reason, no earn), -> queued (a
//   disagreeing total goes to a manager, no earn); an answer to an answered claim is refused;
// - equivalence partitions of the QR: a valid code, a replayed code (code_used), a code expired beyond the grace and a
//   code not yet issued (code_expired), an unknown code, a code with another store's code in it, a genuine code of a
//   store on the POS sync (not_available), malformed texts (22023, nothing counted) and a text that is not a counter QR
//   at all (never sent);
// - boundary values: a code 115 s past its expiry still claims (the grace is 120 s) and 125 s past does not (the exact
//   second is in pgTAP 223_bill_boundaries), the 3rd counter claim of a day is taken and the 4th is refused
//   (daily_limit), 9,999 is below the minimum and 10,000 is not, 0 and 100,000,001 are malformed, the owner's
//   auto-approval limit (a total of 50,000 within a limit of 50,000 confirms at once, 50,001 waits, and so does the
//   second claim of a day when the daily count is 1);
// - decision table of the refusals before a bill exists: code_used, bill_used, bill_conflict, below_minimum,
//   daily_limit, locked, each leaving no bill and no earn;
// - the camera: the browser stand-in of Zalo's scanQRCode (permission refused, cancelled, a text that is not a counter
//   QR) leaves the scan screen and sends nothing; the real camera is Zalo's native one (G-99);
// - security: five wrong tokens lock the member out, even for a good code (locked, with the retry time); no full phone
//   in any data response of either app; the staff list shows the masked phone and never the customer's total.
// Every member, phone, bill number and code is synthetic; the specs erase their customers, bills, counter codes and
// attempt counters and restore the stores.
import { checkMiniAppScreen } from "@fnb/zalo-mini/testing/design-checks";
import {
	callRpc,
	watchResponsePhones,
	watchRpcCredentials,
} from "@fnb/zalo-mini/testing/network-scan";
import { expect, test } from "@playwright/test";
import {
	answerClaim,
	billNo,
	openCounter,
	openCounterScan,
	openStaffHome,
	POS_STORE,
	STORE,
	scanAndSend,
	setStandInCamera,
	staffLoopArgs,
	stampsOnCard,
	submitClaim,
} from "./counter-flow";
import { checkCustomerScreen, watchCustomerPage } from "./customer-checks";
import { LocalLoop, localStackRuns, portOf, type Ready } from "./local-loop";
import {
	type LoyaltyFixture,
	openLoyaltyFixture,
	type SyntheticCustomer,
	type SyntheticStaff,
} from "./loyalty-fixture";
import { browseAndJoin, customerLoopArgs } from "./loyalty-flow";

const CUSTOMER_PORT = portOf(5786);
const STAFF_PORT = portOf(5787);
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

const CUSTOMER_TOTAL = /(?:85|60|70)[.,\s]?000/;

test("the staff app shows the counter QR, the customer claims with it and the claim waits for staff; a blind agreeing total confirms it, a rejection and a disagreement leave no stamp (use case, state transitions)", async ({
	page,
	browser,
}) => {
	const f = need();
	const { tenant } = f;
	const customer = await f.newCustomer();
	const staff = await f.newStaff(STORE, "staff");
	const [customerReady, staffReady] = await Promise.all([
		startCustomerLoop(customer),
		startStaffLoop(staff),
	]);
	const customerScan = scanOf(page, customerReady, [customer.phone]);
	const credentials = watchRpcCredentials(page);
	await browseAndJoin(page, customerReady.appUrl, tenant);
	const desk = await openStaffHome(browser, page, staffReady, contexts);
	const deskScan = scanOf(desk, staffReady);
	const deskCredentials = watchRpcCredentials(desk);

	// ADR-044: a counter claim is not auto-approved until the owner raises the limits
	const [limits] = await f.sql<{ max: string; per_day: number }>`
		select auto_approve_max_amount::text as max, auto_approve_per_day as per_day
		from public.loyalty_store_settings where store_id = ${f.storeId(STORE)}::uuid
	`;
	expect([Number(limits?.max), limits?.per_day]).toEqual([0, 0]);

	// the staff app: Mã quầy shows the live QR and nobody waiting
	const payload = await openCounter(desk);
	expect(payload).toMatch(
		new RegExp(`^fnb-counter:1:${STORE}:[A-HJ-NP-Z2-9]{12}$`),
	);
	await expect(desk.getByTestId("counter-refresh")).toContainText(
		"Mã tự làm mới lúc",
	);
	await expect(desk.getByTestId("claims-empty")).toBeVisible();
	await checkMiniAppScreen(desk);
	const token = payload.split(":")[3] ?? "";
	const [issued] = await f.sql<{ life: number; by: string | null }>`
		select extract(epoch from (expires_at - issued_at))::integer as life, issued_by::text as by
		from public.loyalty_counter_codes where token = ${token}
	`;
	expect(issued).toEqual({ life: 90, by: staff.userId });

	// the customer scans it (the stand-in camera reads the payload) and claims the bill
	await setStandInCamera(page, `scanCode=${encodeURIComponent(payload)}`);
	await openCounterScan(page);
	await checkCustomerScreen(page);
	const first = billNo();
	await scanAndSend(page, first, 85_000);
	const result = page.getByTestId("counter-result");
	await expect(result).toHaveAttribute("data-state", "awaiting_staff");
	await expect(result.getByTestId("counter-result-body")).toHaveText(
		new RegExp(
			`^Nhân viên sẽ đối chiếu hóa đơn ${first} trước .+\\. Điểm được cộng khi khớp\\.$`,
		),
	);
	await expect(result.getByTestId("counter-earned")).toHaveCount(0);
	await checkCustomerScreen(page);
	expect(await f.bills(customer)).toEqual([
		expect.objectContaining({
			billNo: first,
			source: "counter_claim",
			state: "awaiting_staff",
			evidenceLevel: 0,
			autoApproved: false,
			earns: 0,
			confirms: 0,
			stamps: 0,
			points: 0,
			customerAnswers: 1,
			staffAnswers: 0,
		}),
	]);
	await stampsOnCard(page, f, 0);

	// the staff list: masked phone, the bill number, never the customer's total
	await desk.getByRole("button", { name: "Làm mới" }).click();
	const row = desk.locator(
		`[data-testid=counter-claim][data-bill-no=${first}]`,
	);
	await expect(row).toBeVisible();
	await expect(row.getByTestId("claim-member")).toContainText(
		customer.phone.slice(-3),
	);
	await expect(row.getByTestId("claim-member")).not.toContainText(
		customer.phone,
	);
	expect((await row.textContent()) ?? "").not.toMatch(CUSTOMER_TOTAL);
	await checkMiniAppScreen(desk);
	await row
		.getByRole("button", { name: `Nhập tổng tiền cho hóa đơn ${first}` })
		.click();
	await expect(desk.getByTestId("claim-blind")).toBeVisible();
	expect((await desk.getByTestId("counter").textContent()) ?? "").not.toMatch(
		CUSTOMER_TOTAL,
	);
	await desk.getByTestId("claim-total").fill("85000");
	await desk.getByRole("button", { name: "Xác nhận", exact: true }).click();
	await expect(desk.getByTestId("result-modal")).toHaveText(
		"Đã cộng cho khách",
	);
	expect(await f.bills(customer)).toEqual([
		expect.objectContaining({
			billNo: first,
			state: "confirmed",
			evidenceLevel: 2,
			autoApproved: false,
			earns: 1,
			stamps: 1,
			points: 8,
			customerAnswers: 1,
			staffAnswers: 1,
		}),
	]);
	await stampsOnCard(page, f, 1);
	const earn = page.getByTestId("history-item").first();
	await expect(earn).toHaveAttribute("data-state", "confirmed");
	await expect(earn).toContainText("+1 dấu");
	await expect(earn).toContainText("+8 điểm");

	// a second answer to the answered claim is refused and writes nothing
	const session = deskCredentials();
	const [answered] = await f.bills(customer);
	if (answered === undefined) throw new Error("no bill");
	const again = await answerClaim(session, answered.id, { total: 85_000 });
	expect(again.body).toMatchObject({
		state: "refused",
		refusal: "already_answered",
		bill_state: "confirmed",
	});

	// awaiting_staff -> rejected: the staff member refuses with a reason, no stamp
	const second = billNo();
	const code2 = await f.insertCounterCode(STORE, {
		issuedAgo: 5,
		expiresIn: 85,
	});
	const claim2 = await submitClaim(
		credentials(),
		code2.payload,
		second,
		60_000,
	);
	expect(claim2.body).toMatchObject({ state: "awaiting_staff", refusal: null });
	await desk.getByRole("button", { name: "Làm mới" }).click();
	const row2 = desk.locator(
		`[data-testid=counter-claim][data-bill-no=${second}]`,
	);
	await row2.getByRole("button", { name: `Từ chối hóa đơn ${second}` }).click();
	await desk
		.getByRole("button", { name: "Từ chối hóa đơn", exact: true })
		.click();
	await expect(desk.getByTestId("claim-reason-problem")).toHaveText(
		"Hãy ghi lý do.",
	);
	await desk.getByTestId("claim-reason").fill("Hóa đơn không thuộc khách này");
	await desk
		.getByRole("button", { name: "Từ chối hóa đơn", exact: true })
		.click();
	await expect(desk.getByTestId("result-modal")).toHaveText(
		"Đã từ chối hóa đơn",
	);
	const afterReject = await f.bills(customer);
	expect(afterReject.find((bill) => bill.billNo === second)).toMatchObject({
		state: "rejected",
		decisionReason: "Hóa đơn không thuộc khách này",
		earns: 0,
		stamps: 0,
		points: 0,
	});
	await stampsOnCard(page, f, 1);

	// awaiting_staff -> queued: a disagreeing total goes to a manager, no earn yet
	const third = billNo();
	const code3 = await f.insertCounterCode(STORE, {
		issuedAgo: 5,
		expiresIn: 85,
	});
	const claim3 = await submitClaim(credentials(), code3.payload, third, 70_000);
	expect(claim3.body).toMatchObject({ state: "awaiting_staff" });
	await desk.getByRole("button", { name: "Làm mới" }).click();
	await desk
		.locator(`[data-testid=counter-claim][data-bill-no=${third}]`)
		.getByRole("button", { name: `Nhập tổng tiền cho hóa đơn ${third}` })
		.click();
	await desk.getByTestId("claim-total").fill("20000");
	await desk.getByRole("button", { name: "Xác nhận", exact: true }).click();
	await expect(desk.getByTestId("result-modal")).toHaveText(
		"Đã chuyển quản lý duyệt",
	);
	const afterQueue = await f.bills(customer);
	expect(afterQueue.find((bill) => bill.billNo === third)).toMatchObject({
		state: "queued",
		queueReason: "disagreement",
		evidenceLevel: 0,
		earns: 0,
		stamps: 0,
		customerAnswers: 1,
		staffAnswers: 1,
	});
	await stampsOnCard(page, f, 1);

	expect(await deskScan.leaks()).toEqual([]);
	expect(await customerScan.leaks()).toEqual([]);
	expect((await customerScan.responses()).join("\n")).toContain(
		"rpc/customer_submit_counter_claim (200)",
	);
	expect((await deskScan.responses()).join("\n")).toContain(
		"rpc/staff_answer_counter_claim (200)",
	);
});

test("the counter QR rotates after half of its life and the old one stays valid to its end and a grace", async ({
	page,
	browser,
}) => {
	const f = need();
	const staff = await f.newStaff(STORE, "staff");
	const staffReady = await startStaffLoop(staff);
	const desk = await openStaffHome(browser, page, staffReady, contexts);
	const deskCredentials = watchRpcCredentials(desk);
	const first = await openCounter(desk);
	const session = deskCredentials();
	const same = await callRpc(session, "staff_counter_code", {
		p_store_id: f.storeId(STORE),
	});
	expect((same.body as { qr_payload: string }).qr_payload).toBe(first);

	// half of the 90 s life is gone: the next ask issues a new code, the old row stays
	await f.moveCounterCode(first.split(":")[3] ?? "", {
		issuedAgo: 50,
		expiresIn: 40,
	});
	const rotated = await callRpc(session, "staff_counter_code", {
		p_store_id: f.storeId(STORE),
	});
	const next = (rotated.body as { qr_payload: string }).qr_payload;
	expect(next).toMatch(/^fnb-counter:1:sim-1:[A-HJ-NP-Z2-9]{12}$/);
	expect(next).not.toBe(first);
	const again = await callRpc(session, "staff_counter_code", {
		p_store_id: f.storeId(STORE),
	});
	expect((again.body as { qr_payload: string }).qr_payload).toBe(next);
	const [codes] = await f.sql<{ n: number }>`
		select count(*)::integer as n from public.loyalty_counter_codes where store_id = ${f.storeId(STORE)}::uuid
	`;
	expect(codes?.n).toBe(2);
	// a store without self claims shows no code at all
	await f.configureStore(STORE, { selfClaim: false });
	const off = await callRpc(session, "staff_counter_code", {
		p_store_id: f.storeId(STORE),
	});
	expect(off.body).toMatchObject({
		state: "refused",
		refusal: "not_available",
	});
});

test("the QR text decides the answer: partitions of the code, the grace boundary, the daily limit, the guessing lockout (equivalence partitioning, boundary values, decision table)", async ({
	page,
}) => {
	const f = need();
	const { tenant } = f;
	const customer = await f.newCustomer();
	const customerReady = await startCustomerLoop(customer);
	const credentials = watchRpcCredentials(page);
	const scan = scanOf(page, customerReady, [customer.phone]);
	await browseAndJoin(page, customerReady.appUrl, tenant);
	const session = credentials();
	const fresh = () =>
		f.insertCounterCode(STORE, { issuedAgo: 5, expiresIn: 85 });
	const noOf = async (): Promise<number> => (await f.bills(customer)).length;

	// the camera stand-in: refused, cancelled and a text that is not a counter QR leave the scan screen and send nothing
	const sentBefore = (await scan.responses()).length;
	await setStandInCamera(page, "scan=refused");
	await openCounterScan(page);
	await page.getByTestId("counter-scan-button").click();
	await expect(page.getByTestId("counter-notice")).toHaveText(
		"Hãy cho phép Zalo dùng camera để quét mã tại quầy.",
	);
	await expect(page.getByTestId("counter-form")).toHaveCount(0);
	await checkCustomerScreen(page);
	await setStandInCamera(page, "scan=cancel");
	await openCounterScan(page);
	await page.getByTestId("counter-scan-button").click();
	await expect(page.getByTestId("counter-scan")).toBeVisible();
	await expect(page.getByTestId("counter-notice")).toHaveCount(0);
	for (const text of [
		"fnb-member:1:sim-1:123456",
		"https://example.invalid/pay",
		"fnb-counter:2:sim-1:ABCDEFGHJKLM",
	]) {
		await setStandInCamera(page, `scanCode=${encodeURIComponent(text)}`);
		await openCounterScan(page);
		await page.getByTestId("counter-scan-button").click();
		await expect(page.getByTestId("counter-notice")).toHaveText(
			"Đây không phải mã tại quầy. Hãy quét mã QR trên màn hình của nhân viên thu ngân.",
		);
		await expect(page.getByTestId("counter-form")).toHaveCount(0);
	}
	const sentAfter = (await scan.responses()).slice(sentBefore).join("\n");
	expect(sentAfter).not.toContain("customer_submit_counter_claim");

	// 1. a valid code: the claim waits for staff (no auto-approval by default)
	const a = await fresh();
	const x1 = billNo();
	const claimed = await submitClaim(session, a.payload, x1, 85_000);
	expect(claimed.status).toBe(200);
	expect(claimed.body).toMatchObject({
		state: "awaiting_staff",
		refusal: null,
		evidence_level: 0,
	});
	// 2. the same code again, from the same member: replayed
	const replay = await submitClaim(session, a.payload, billNo(), 85_000);
	expect(replay.body).toMatchObject({ state: "refused", refusal: "code_used" });
	expect(await noOf()).toBe(1);
	// 2b. the same bill again with the same code (its answer was lost): the first outcome and no second bill (G-92)
	const resent = await submitClaim(session, a.payload, x1, 85_000);
	expect(resent.body).toMatchObject({
		state: "awaiting_staff",
		refusal: null,
		bill_id: (claimed.body as Record<string, unknown>).bill_id,
		replayed: true,
	});
	expect(await noOf()).toBe(1);

	// 3. refusals before a bill exists, each leaving no bill (decision table)
	const e = await fresh();
	const dupSame = await submitClaim(session, e.payload, x1, 85_000);
	expect(dupSame.body).toMatchObject({
		state: "refused",
		refusal: "bill_used",
	});
	const dupOther = await submitClaim(session, e.payload, x1, 90_000);
	expect(dupOther.body).toMatchObject({
		state: "refused",
		refusal: "bill_conflict",
	});
	const x2 = billNo();
	const small = await submitClaim(session, e.payload, x2, 9_999);
	expect(small.body).toMatchObject({
		state: "refused",
		refusal: "below_minimum",
	});
	for (const [total, no] of [
		[0, x2],
		[100_000_001, x2],
		[85_000, "has space"],
		[85_000, "N".repeat(41)],
	] as const) {
		const bad = await submitClaim(session, e.payload, no, total);
		expect([bad.status, bad.code], `${total} ${no.slice(0, 8)}`).toEqual([
			400,
			"22023",
		]);
	}
	for (const text of [
		e.payload.toLowerCase(),
		e.payload.slice(0, -1),
		`${e.payload}X`,
		e.payload.replace("fnb-counter:1:", "fnb-counter:2:"),
		"",
	]) {
		const bad = await submitClaim(session, text, billNo(), 85_000);
		expect([bad.status, bad.code], text.slice(0, 20)).toEqual([400, "22023"]);
	}
	expect(await noOf()).toBe(1);

	// 4. boundary of the grace: 115 s past its expiry still claims, 125 s past does not, a future code does not
	const inside = await f.insertCounterCode(STORE, {
		issuedAgo: 205,
		expiresIn: -115,
	});
	const edge = await submitClaim(session, inside.payload, x2, 10_000);
	expect(edge.body).toMatchObject({ state: "awaiting_staff" });
	const outside = await f.insertCounterCode(STORE, {
		issuedAgo: 215,
		expiresIn: -125,
	});
	const late = await submitClaim(session, outside.payload, billNo(), 85_000);
	expect(late.body).toMatchObject({
		state: "refused",
		refusal: "code_expired",
	});
	const future = await f.insertCounterCode(STORE, {
		issuedAgo: -60,
		expiresIn: 150,
	});
	const early = await submitClaim(session, future.payload, billNo(), 85_000);
	expect(early.body).toMatchObject({
		state: "refused",
		refusal: "code_expired",
	});
	expect(await noOf()).toBe(2);

	// 5. the 3rd claim of the day is taken, the 4th is refused (daily_limit)
	const x3 = billNo();
	const third = await submitClaim(session, (await fresh()).payload, x3, 60_000);
	expect(third.body).toMatchObject({ state: "awaiting_staff" });
	const fourth = await submitClaim(
		session,
		(await fresh()).payload,
		billNo(),
		60_000,
	);
	expect(fourth.body).toMatchObject({
		state: "refused",
		refusal: "daily_limit",
	});
	expect(await noOf()).toBe(3);

	// 6. a genuine code of a store on the POS sync, and codes that do not belong: nothing is claimed
	const pos = await f.insertCounterCode(POS_STORE, {
		issuedAgo: 5,
		expiresIn: 85,
	});
	const posClaim = await submitClaim(session, pos.payload, billNo(), 85_000);
	expect(posClaim.body).toMatchObject({
		state: "refused",
		refusal: "not_available",
	});
	const crossed = await submitClaim(
		session,
		pos.payload.replace(`:${POS_STORE}:`, `:${STORE}:`),
		billNo(),
		85_000,
	);
	expect(crossed.body).toMatchObject({
		state: "refused",
		refusal: "wrong_store",
	});
	const nowhere = await submitClaim(
		session,
		pos.payload.replace(`:${POS_STORE}:`, ":zzz-9:"),
		billNo(),
		85_000,
	);
	expect(nowhere.body).toMatchObject({
		state: "refused",
		refusal: "wrong_store",
	});
	const unknown = await submitClaim(
		session,
		"fnb-counter:1:sim-1:ABCDEFGHJKLM",
		billNo(),
		85_000,
	);
	expect(unknown.body).toMatchObject({
		state: "refused",
		refusal: "code_unknown",
	});
	expect(await noOf()).toBe(3);

	// 7. the screen says so in words for a code that expired (UI wording) ...
	await setStandInCamera(
		page,
		`scanCode=${encodeURIComponent(outside.payload)}`,
	);
	await openCounterScan(page);
	await scanAndSend(page, billNo(), 85_000);
	const expired = page.getByTestId("counter-result");
	await expect(expired).toHaveAttribute("data-refusal", "code_expired");
	await expect(expired.getByTestId("counter-result-body")).toHaveText(
		"Mã tại quầy đã hết hạn. Hãy quét mã mới trên màn hình của nhân viên.",
	);
	await expect(expired.getByRole("button", { name: "Quét lại" })).toBeVisible();
	await checkCustomerScreen(page);

	// 8. ... and the fifth wrong token locks the member out, even for a good code
	const missesSoFar = 3; // unknown, crossed and nowhere
	for (let miss = missesSoFar; miss < 5; miss += 1) {
		const wrong = await submitClaim(
			session,
			`fnb-counter:1:sim-1:${"ABCDEFGHJKLMNPQRSTUVWXYZ".slice(miss, miss + 12)}`,
			billNo(),
			85_000,
		);
		expect(wrong.body).toMatchObject({ refusal: "code_unknown" });
	}
	const goodCode = await fresh();
	const locked = await submitClaim(session, goodCode.payload, billNo(), 85_000);
	expect(locked.body).toMatchObject({ state: "refused", refusal: "locked" });
	expect(typeof locked.body.retry_at).toBe("string");
	expect(Date.parse(String(locked.body.retry_at))).toBeGreaterThan(Date.now());
	await setStandInCamera(
		page,
		`scanCode=${encodeURIComponent(goodCode.payload)}`,
	);
	await openCounterScan(page);
	await scanAndSend(page, billNo(), 85_000);
	const lockedScreen = page.getByTestId("counter-result");
	await expect(lockedScreen).toHaveAttribute("data-refusal", "locked");
	await expect(lockedScreen.getByTestId("counter-result-body")).toHaveText(
		/^Bạn đã quét sai mã quá nhiều lần\. Hãy thử lại sau .+\.$/,
	);
	await checkCustomerScreen(page);

	// nothing above made an earn, a stamp or an auto-approval
	const rows = await f.bills(customer);
	expect(rows.map((row) => [row.billNo, row.total, row.state])).toEqual(
		expect.arrayContaining([
			[x1, 85_000, "awaiting_staff"],
			[x2, 10_000, "awaiting_staff"],
			[x3, 60_000, "awaiting_staff"],
		]),
	);
	expect(
		rows.every(
			(row) =>
				row.source === "counter_claim" &&
				!row.autoApproved &&
				row.earns === 0 &&
				row.customerAnswers === 1 &&
				row.staffAnswers === 0,
		),
	).toBe(true);
	expect((await f.customerState(customer)).earnsByPath).toEqual({});
	expect(await scan.leaks()).toEqual([]);
});

test("the owner's auto-approval limits decide which claims confirm at once: 50,000 within a limit of 50,000 does, 50,001 and the second of a day do not (boundary values, decision table)", async ({
	page,
}) => {
	const f = need();
	const { tenant } = f;
	await f.configureStore(STORE, {
		autoApproveMaxAmount: 50_000,
		autoApprovePerDay: 1,
	});
	const customer = await f.newCustomer();
	const customerReady = await startCustomerLoop(customer);
	const credentials = watchRpcCredentials(page);
	const scan = scanOf(page, customerReady, [customer.phone]);
	await browseAndJoin(page, customerReady.appUrl, tenant);
	const session = credentials();
	const fresh = () =>
		f.insertCounterCode(STORE, { issuedAgo: 5, expiresIn: 85 });

	const over = await submitClaim(
		session,
		(await fresh()).payload,
		billNo(),
		50_001,
	);
	expect(over.body).toMatchObject({ state: "awaiting_staff" });
	const edge = await submitClaim(
		session,
		(await fresh()).payload,
		billNo(),
		50_000,
	);
	expect(edge.body).toMatchObject({
		state: "confirmed",
		evidence_level: 0,
		stamps_earned: 1,
		points_earned: 5,
	});
	const spent = await submitClaim(
		session,
		(await fresh()).payload,
		billNo(),
		50_000,
	);
	expect(spent.body).toMatchObject({ state: "awaiting_staff" });

	const rows = await f.bills(customer);
	expect(
		rows.map((row) => [row.total, row.state, row.autoApproved, row.earns]),
	).toEqual(
		expect.arrayContaining([
			[50_001, "awaiting_staff", false, 0],
			[50_000, "confirmed", true, 1],
		]),
	);
	expect(rows.filter((row) => row.autoApproved)).toHaveLength(1);
	await stampsOnCard(page, f, 1);
	const earn = page.getByTestId("history-item").first();
	await expect(earn).toHaveAttribute("data-state", "confirmed");
	expect(await scan.leaks()).toEqual([]);
	// the store is back to the default (ADR-044) for the next spec
	await f.configureStore(STORE, {
		autoApproveMaxAmount: 0,
		autoApprovePerDay: 0,
	});
	const [limits] = await f.sql<{ per_day: number }>`
		select auto_approve_per_day as per_day from public.loyalty_store_settings where store_id = ${f.storeId(STORE)}::uuid
	`;
	expect(limits?.per_day).toBe(0);
});
