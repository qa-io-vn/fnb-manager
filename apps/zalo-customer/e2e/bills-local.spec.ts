// Test design (ISTQB) for G-91: system tests of the bill evidence ladder (path E, ADR-043 and ADR-044) on the live local
// stack, with the REAL functions of the database and the staff and customer Mini Apps side by side (`pnpm zalo:dev`),
// on the synthetic tenant loyalty-sim whose store sim-1 is put in staff mode for the test and back afterwards.
// - use case: the staff app records a paper bill from the member code the customer shows, the customer's wallet asks
//   for the total without showing the staff total, the agreeing total confirms at once (evidence level 2) and the
//   wallet shows the stamp and the points;
// - boundary values of the amount tolerance (1,000 đồng): exactly 1,000 apart agrees, 1 đồng more disagrees and queues
//   the bill for a manager without a stamp;
// - state transition: a bill answered once refuses the second answer from a stale screen (already_answered) and
//   writes no second earn;
// - security: a customer session is refused every staff bill function (42501), the anonymous role too, an unknown bill
//   answers like another member's (unknown_bill, no existence oracle); no full phone in any data response of any page.
// Every member, phone and bill number is synthetic; the specs erase their customers and bills and restore the stores.
import { randomBytes, randomUUID } from "node:crypto";
import {
	checkMiniAppScreen,
	watchMiniAppPage,
} from "@fnb/zalo-mini/testing/design-checks";
import {
	callRpc,
	watchResponsePhones,
	watchRpcCredentials,
} from "@fnb/zalo-mini/testing/network-scan";
import { type Browser, expect, type Page, test } from "@playwright/test";
import {
	checkCustomerScreen,
	openTab,
	watchCustomerPage,
} from "./customer-checks";
import { LocalLoop, localStackRuns, portOf, type Ready } from "./local-loop";
import {
	type LoyaltyFixture,
	openLoyaltyFixture,
	SIM_BRAND,
	SIM_TENANT,
	type SyntheticCustomer,
	type SyntheticStaff,
} from "./loyalty-fixture";
import {
	browseAndJoin,
	customerLoopArgs,
	liveMemberCode,
} from "./loyalty-flow";

const CUSTOMER_PORT = portOf(5784);
const STAFF_PORT = portOf(5785);
const STORE = "sim-1";
const BILL_TOTAL = 85_000;
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

function billNo(): string {
	return `IT${randomBytes(3).toString("hex").toUpperCase()}`;
}

async function startCustomerLoop(customer: SyntheticCustomer): Promise<Ready> {
	const loop = new LocalLoop();
	loops.push(loop);
	return loop.start(customerLoopArgs(customer, CUSTOMER_PORT));
}

async function startStaffLoop(staff: SyntheticStaff): Promise<Ready> {
	const loop = new LocalLoop();
	loops.push(loop);
	return loop.start([
		"--tenant",
		SIM_TENANT,
		"--brand",
		SIM_BRAND,
		"--member",
		staff.email,
		"--mock-user",
		staff.mockUser,
		"--mock-name",
		staff.mockName,
		"--port",
		STAFF_PORT,
	]);
}

async function openBills(desk: Page): Promise<void> {
	await desk
		.getByTestId("home-loyalty")
		.getByRole("button", { name: "Ghi hóa đơn" })
		.click();
	await expect(desk.getByTestId("bills-body")).toHaveAttribute(
		"data-status",
		"ready",
	);
	await expect(desk.getByTestId("bills-pos-sync")).toHaveCount(0);
	await expect(desk.getByTestId("bill-code")).toBeVisible();
}

/** The staff app on its own phone-sized context, signed in and on Ghi hóa đơn. */
async function openDesk(
	browser: Browser,
	page: Page,
	staffReady: Ready,
): Promise<Page> {
	const context = await browser.newContext({
		viewport: page.viewportSize(),
		isMobile: true,
		hasTouch: true,
		locale: "vi-VN",
		timezoneId: "Asia/Ho_Chi_Minh",
	});
	contexts.push(context);
	const desk = await context.newPage();
	await watchMiniAppPage(desk);
	await desk.goto(staffReady.appUrl);
	await desk.getByRole("button", { name: "Tiếp tục" }).click();
	await openBills(desk);
	return desk;
}

async function record(
	desk: Page,
	code: string,
	no: string,
	total: number,
): Promise<void> {
	await desk.getByTestId("bill-code").fill(code);
	await desk.getByTestId("bill-no").fill(no);
	await desk.getByTestId("bill-total").fill(String(total));
	await desk.getByRole("button", { name: "Ghi hóa đơn", exact: true }).click();
	await expect(desk.getByTestId("bill-result")).toHaveAttribute(
		"data-state",
		"awaiting_customer",
	);
}

async function openMemberCode(page: Page): Promise<string> {
	await openTab(page, "Trang chủ");
	await page
		.getByTestId("store-list")
		.getByRole("button", { name: /Synthetic store 1/ })
		.click();
	await page
		.getByRole("button", { name: "Mã thành viên tại cửa hàng này" })
		.click();
	return liveMemberCode(page, need(), STORE);
}

async function openWalletBills(page: Page, count: number): Promise<void> {
	await openTab(page, "Trang chủ");
	await openTab(page, "Thẻ thành viên");
	await expect(page.getByTestId("bill-to-confirm")).toHaveCount(count);
}

async function typeAndConfirm(page: Page, total: number): Promise<void> {
	const card = page.getByTestId("bills-to-confirm");
	await card.getByTestId("bill-total").fill(String(total));
	await card.getByTestId("bill-confirm").click();
}

async function expectNoStaffTotal(page: Page): Promise<void> {
	const text = (await page.locator("body").textContent()) ?? "";
	expect(text).not.toMatch(/85[.,\s]?000/);
	expect(text).not.toMatch(/0900000\d{3}|\+84/);
	expect(page.url()).not.toMatch(/85000|total|phone/i);
}

function scanOf(page: Page, ready: Ready, allowed: readonly string[] = []) {
	return watchResponsePhones(page, new URL(ready.appUrl).origin, allowed);
}

test("staff record a bill, the customer confirms the total blind and the wallet shows the stamp and the points (level 2)", async ({
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
	expect(staffReady).toMatchObject({ role: "staff", boundNow: true });
	const customerScan = scanOf(page, customerReady, [customer.phone]);

	await browseAndJoin(page, customerReady.appUrl, tenant);
	const desk = await openDesk(browser, page, staffReady);
	const deskScan = scanOf(desk, staffReady);
	const no = billNo();
	// the member code rotates after a minute: show it only when the desk is ready, record at once
	await record(desk, await openMemberCode(page), no, BILL_TOTAL);
	await expect(desk.getByTestId("bill-member")).toHaveText(
		`Khách •••• ••• ${customer.phone.slice(-3)}`,
	);
	await expect(desk.getByTestId("bill-earn")).toHaveText("+1 dấu · +8 điểm");
	await expect(desk.locator("body")).not.toContainText(customer.phone);
	await checkMiniAppScreen(desk);

	expect(await f.bills(customer)).toEqual([
		expect.objectContaining({
			billNo: no,
			total: BILL_TOTAL,
			state: "awaiting_customer",
			evidenceLevel: 0,
			earns: 1,
			confirms: 0,
			customerAnswers: 0,
		}),
	]);

	await openWalletBills(page, 1);
	const card = page.getByTestId("bills-to-confirm");
	await expect(card.getByTestId("bill-to-confirm")).toContainText(
		`Hóa đơn ${no}`,
	);
	await expect(card.getByTestId("bill-to-confirm")).toContainText(
		"Synthetic store 1",
	);
	await expect(page.getByTestId("stamp-count")).toHaveText(
		`${tenant.welcomeStamps}/${tenant.stampsPerCard} dấu`,
	);
	await expect(page.getByTestId("history-item").first()).toHaveAttribute(
		"data-state",
		"pending",
	);
	await expectNoStaffTotal(page);
	await checkCustomerScreen(page);

	await typeAndConfirm(page, BILL_TOTAL);
	await expect(card.getByTestId("bill-result")).toHaveText(
		`Đã xác nhận hóa đơn ${no}. Điểm đã được cộng vào thẻ.`,
	);
	await expect(card.getByTestId("bill-result")).toHaveAttribute(
		"data-outcome",
		"bill.result.confirmed",
	);
	await expect(page.getByTestId("stamp-count")).toHaveText(
		`${tenant.welcomeStamps + 1}/${tenant.stampsPerCard} dấu`,
	);
	const earn = page.getByTestId("history-item").first();
	await expect(earn).toHaveAttribute("data-state", "confirmed");
	await expect(earn).toContainText("Qua hóa đơn nhân viên ghi nhận");
	await expect(earn).toContainText("Synthetic store 1");
	await expect(earn).toContainText("+1 dấu");
	await expect(earn).toContainText("+8 điểm");
	await expectNoStaffTotal(page);
	await checkCustomerScreen(page);

	expect(await f.bills(customer)).toEqual([
		expect.objectContaining({
			billNo: no,
			state: "confirmed",
			evidenceLevel: 2,
			queueReason: null,
			earns: 1,
			confirms: 1,
			clawbacks: 0,
			stamps: 1,
			points: 8,
			customerAnswers: 1,
		}),
	]);
	expect((await f.customerState(customer)).earnsByPath).toEqual({ E: 1 });

	await desk.getByRole("button", { name: "Quay lại" }).click();
	await openBills(desk);
	await expect(
		desk.locator(`[data-testid=recent-bill][data-bill-no=${no}]`),
	).toHaveAttribute("data-state", "confirmed");
	await expect(desk.locator("body")).not.toContainText(customer.phone);

	expect(await deskScan.leaks()).toEqual([]);
	expect(await customerScan.leaks()).toEqual([]);
	expect((await deskScan.responses()).join("\n")).toContain(
		"rpc/staff_submit_bill (200)",
	);
	expect((await customerScan.responses()).join("\n")).toContain(
		"rpc/customer_confirm_bill (200)",
	);
});

test("a total 1,000 apart agrees and a total 1 đồng further disagrees: no stamp, a manager decides (boundary values)", async ({
	page,
	browser,
}) => {
	const f = need();
	const { tenant } = f;
	const [tolerance] = await f.sql<{ tolerance: string }>`
		select bill_amount_tolerance::text as tolerance from public.loyalty_store_settings
		where store_id = ${f.storeId(STORE)}::uuid
	`;
	expect(Number(tolerance?.tolerance)).toBe(1000);
	const customer = await f.newCustomer();
	const staff = await f.newStaff(STORE, "manager");
	const [customerReady, staffReady] = await Promise.all([
		startCustomerLoop(customer),
		startStaffLoop(staff),
	]);
	const customerScan = scanOf(page, customerReady, [customer.phone]);
	await browseAndJoin(page, customerReady.appUrl, tenant);
	const desk = await openDesk(browser, page, staffReady);
	const deskScan = scanOf(desk, staffReady);

	// 1 đồng beyond the tolerance: disagrees
	const apart = billNo();
	const code = await openMemberCode(page);
	await record(desk, code, apart, BILL_TOTAL);
	await openWalletBills(page, 1);
	await typeAndConfirm(page, BILL_TOTAL - 1001);
	const card = page.getByTestId("bills-to-confirm");
	await expect(card.getByTestId("bill-result")).toHaveText(
		`Tổng tiền bạn nhập cho hóa đơn ${apart} chưa khớp với cửa hàng ghi nhận. Quản lý cửa hàng sẽ kiểm tra, điểm được cộng khi hóa đơn đúng.`,
	);
	await expect(card.getByTestId("bill-result")).toHaveAttribute(
		"data-outcome",
		"bill.result.queued",
	);
	await expect(page.getByTestId("stamp-count")).toHaveText(
		`${tenant.welcomeStamps}/${tenant.stampsPerCard} dấu`,
	);
	await expect(page.getByTestId("history-item").first()).toHaveAttribute(
		"data-state",
		"pending",
	);
	await expectNoStaffTotal(page);
	await checkCustomerScreen(page);
	expect(await f.bills(customer)).toEqual([
		expect.objectContaining({
			billNo: apart,
			state: "queued",
			queueReason: "disagreement",
			evidenceLevel: 0,
			earns: 1,
			confirms: 0,
			clawbacks: 0,
			customerAnswers: 1,
		}),
	]);
	await desk.getByRole("button", { name: "Quay lại" }).click();
	await expect(desk.getByTestId("home-bill-queue-count")).toHaveText(
		"1 việc cần duyệt",
	);
	await openBills(desk);
	await expect(
		desk.locator(`[data-testid=recent-bill][data-bill-no=${apart}]`),
	).toHaveAttribute("data-state", "queued");
	await expect(desk.locator("body")).not.toContainText(customer.phone);

	// exactly the tolerance: agrees (the first member code is spent, a fresh one is shown)
	const fresh = await openMemberCode(page);
	expect(fresh).not.toBe(code);
	const edge = billNo();
	await record(desk, fresh, edge, BILL_TOTAL);
	await openWalletBills(page, 1);
	await typeAndConfirm(page, BILL_TOTAL - 1000);
	await expect(
		page.getByTestId("bill-result").filter({ hasText: edge }),
	).toHaveAttribute("data-outcome", "bill.result.confirmed");
	await expect(page.getByTestId("stamp-count")).toHaveText(
		`${tenant.welcomeStamps + 1}/${tenant.stampsPerCard} dấu`,
	);
	const rows = await f.bills(customer);
	expect(rows.map((row) => [row.billNo, row.state, row.evidenceLevel])).toEqual(
		[
			[apart, "queued", 0],
			[edge, "confirmed", 2],
		],
	);
	expect(rows.reduce((sum, row) => sum + row.earns, 0)).toBe(2);

	expect(await deskScan.leaks()).toEqual([]);
	expect(await customerScan.leaks()).toEqual([]);
});

test("a second answer from a stale screen is refused as already answered and writes no second stamp", async ({
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
	await browseAndJoin(page, customerReady.appUrl, tenant);
	const desk = await openDesk(browser, page, staffReady);
	const no = billNo();
	await record(desk, await openMemberCode(page), no, BILL_TOTAL);

	const stale = await page.context().newPage();
	await watchCustomerPage(stale, null);
	const staleScan = scanOf(stale, customerReady, [customer.phone]);
	await stale.goto(customerReady.appUrl);
	await expect(
		stale.getByRole("heading", { name: tenant.programmeName }),
	).toBeVisible();
	await openWalletBills(stale, 1);
	await openWalletBills(page, 1);

	await typeAndConfirm(page, BILL_TOTAL);
	await expect(
		page.getByTestId("bills-to-confirm").getByTestId("bill-result"),
	).toHaveAttribute("data-outcome", "bill.result.confirmed");
	await expect(page.getByTestId("stamp-count")).toHaveText(
		`${tenant.welcomeStamps + 1}/${tenant.stampsPerCard} dấu`,
	);

	await typeAndConfirm(stale, BILL_TOTAL);
	const refused = stale
		.getByTestId("bills-to-confirm")
		.getByTestId("bill-result");
	await expect(refused).toHaveAttribute(
		"data-outcome",
		"bill.refusal.already_answered",
	);
	await expect(refused).toHaveText(`Hóa đơn ${no} đã được trả lời trước đó.`);
	await checkCustomerScreen(stale);

	await openWalletBills(stale, 0);
	await expect(stale.getByTestId("stamp-count")).toHaveText(
		`${tenant.welcomeStamps + 1}/${tenant.stampsPerCard} dấu`,
	);
	expect(await f.bills(customer)).toEqual([
		expect.objectContaining({
			billNo: no,
			state: "confirmed",
			evidenceLevel: 2,
			earns: 1,
			confirms: 1,
			stamps: 1,
			points: 8,
			customerAnswers: 1,
		}),
	]);
	expect((await f.customerState(customer)).earnsByPath).toEqual({ E: 1 });
	expect(await customerScan.leaks()).toEqual([]);
	expect(await staleScan.leaks()).toEqual([]);
});

test("a customer session is refused every staff bill function, the anonymous role too, and an unknown bill answers as another member's", async ({
	page,
}) => {
	const f = need();
	const customer = await f.newCustomer();
	const customerReady = await startCustomerLoop(customer);
	const credentials = watchRpcCredentials(page);
	const scan = scanOf(page, customerReady, [customer.phone]);
	await browseAndJoin(page, customerReady.appUrl, f.tenant);
	const store = f.storeId(STORE);
	const session = credentials();

	const staffCalls: readonly [string, Record<string, unknown>][] = [
		[
			"staff_submit_bill",
			{
				p_store_id: store,
				p_code: "123456",
				p_bill_no: "IT0000",
				p_total: 85000,
			},
		],
		["staff_recent_bills", { p_store_id: store }],
		["staff_bill_queue", { p_store_id: store }],
		["staff_counter_code", { p_store_id: store }],
		["staff_counter_claims", { p_store_id: store }],
		[
			"staff_decide_bill",
			{ p_bill_id: randomUUID(), p_decision: "approve", p_reason: null },
		],
		["staff_reverse_bill", { p_bill_id: randomUUID(), p_reason: "synthetic" }],
	];
	for (const [name, args] of staffCalls) {
		const asCustomer = await callRpc(session, name, args);
		expect(
			[asCustomer.status, asCustomer.code],
			`${name} as a customer session`,
		).toEqual([403, "42501"]);
		const asAnonymous = await callRpc(session, name, args, {
			anonymous: true,
		});
		expect(
			[asAnonymous.status, asAnonymous.code],
			`${name} as the anonymous role`,
		).toEqual([401, "42501"]);
	}

	const unknown = await callRpc(session, "customer_confirm_bill", {
		p_bill_id: randomUUID(),
		p_total: 85000,
	});
	expect(unknown.status).toBe(200);
	expect(unknown.body).toEqual({ state: "refused", refusal: "unknown_bill" });
	const outOfRange = await callRpc(session, "customer_confirm_bill", {
		p_bill_id: randomUUID(),
		p_total: 100_000_001,
	});
	expect([outOfRange.status, outOfRange.code]).toEqual([400, "22023"]);
	const anonymousConfirm = await callRpc(
		session,
		"customer_confirm_bill",
		{ p_bill_id: randomUUID(), p_total: 85000 },
		{ anonymous: true },
	);
	expect(anonymousConfirm.code).toBe("42501");

	expect(await f.bills(customer)).toEqual([]);
	expect(await scan.leaks()).toEqual([]);
});

test("twelve member-code requests in flight together all get the same code (G-98: serialised per membership and store)", async ({
	page,
}) => {
	const f = need();
	const customer = await f.newCustomer();
	const customerReady = await startCustomerLoop(customer);
	const credentials = watchRpcCredentials(page);
	await browseAndJoin(page, customerReady.appUrl, f.tenant);
	const session = credentials();

	// Joining has not opened the member-code screen, so no live code exists yet: every call below races to issue one.
	const replies = await Promise.all(
		Array.from({ length: 12 }, () =>
			callRpc(session, "customer_member_code", { p_store: STORE }),
		),
	);
	for (const reply of replies) expect(reply.status).toBe(200);
	const codes = replies.map(
		(reply) => (reply.body as { code?: string }).code ?? "",
	);
	expect(codes[0]).toMatch(/^\d{6}$/);
	expect(new Set(codes).size).toBe(1);
	expect(await f.codeIsLive(STORE, codes[0] ?? "")).toBe(true);
});
