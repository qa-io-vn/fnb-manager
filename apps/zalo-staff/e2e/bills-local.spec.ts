// Test design (ISTQB) for G-91, staff side: system tests of recording a bill (path E, ADR-043 and ADR-044) in the staff
// Mini App against the REAL functions of the local database (`pnpm zalo:dev`), on the synthetic tenant loyalty-sim whose
// store sim-1 is put in staff mode for the test (sim-2 stays on the POS sync) and restored afterwards. The customer side
// (blind confirmation, the wallet's stamp) is in zalo-customer:e2e/bills-local; here the members and their codes are
// made by the loyalty functions of the fixture, as the customer app would show them.
// - use case: a staff member records a bill from the member's code, sees the earn waiting for the customer and the
//   bill in the recent list;
// - decision table of the refusals: below_minimum, code_used, bill_used, bill_conflict and daily_limit each read in
//   words, and a refusal before the bill is written leaves the member's code usable;
// - boundary values: 9,999 (no stamp and no point) is refused, 10,000 (one point) is recorded; the 3rd bill of a member
//   in a day is recorded, the 4th is refused daily_limit;
// - store mode and scope: a bill at a store on the POS sync is refused not_staff_mode, a staff session of sim-2 is
//   refused every staff bill function of sim-1 (42501), a staff check-in at the staff-mode store is refused staff_mode
//   and points to Ghi hóa đơn, a staff role is refused the manager's decide and reverse (42501);
// - security: no full phone in any data response or on any screen, the member code single use, a staff session cannot
//   answer a customer's bill.
// Every member, phone and bill number is synthetic; the fixture erases its customers, bills, audit rows and alerts.
import { randomBytes } from "node:crypto";
import {
	checkMiniAppScreen,
	watchMiniAppPage,
} from "@fnb/zalo-mini/testing/design-checks";
import {
	callRpc,
	watchResponsePhones,
	watchRpcCredentials,
} from "@fnb/zalo-mini/testing/network-scan";
import { expect, type Page, test } from "@playwright/test";
import {
	type LoyaltyFixture,
	openLoyaltyFixture,
	type SeededMember,
	SIM_BRAND,
	SIM_TENANT,
	type SyntheticStaff,
} from "../../zalo-customer/e2e/loyalty-fixture";
import { LocalLoop, localStackRuns, portOf, type Ready } from "./local-loop";
import { localDatabaseUrl } from "./pairing-fixture";

const PORT = portOf(5765);
const STAFF_STORE = "sim-1";
const POS_STORE = "sim-2";
const STACK_SKIP =
	"set ZALO_LOCAL_DEV=1 with the local stack running to drive pnpm zalo:dev on loyalty-sim";

let fixture: LoyaltyFixture | null = null;
const loops: LocalLoop[] = [];

test.beforeEach(async () => {
	test.skip(!(await localStackRuns()) || localDatabaseUrl() === "", STACK_SKIP);
	fixture = await openLoyaltyFixture();
	await fixture.setStoreMode(STAFF_STORE, "staff");
});

test.afterEach(async () => {
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
		PORT,
	]);
}

async function signIn(page: Page, ready: Ready): Promise<void> {
	await watchMiniAppPage(page);
	await page.goto(ready.appUrl);
	await page.getByRole("button", { name: "Tiếp tục" }).click();
	await expect(page.getByTestId("home-loyalty")).toBeVisible();
}

async function openBills(page: Page): Promise<void> {
	await page
		.getByTestId("home-loyalty")
		.getByRole("button", { name: "Ghi hóa đơn" })
		.click();
	await expect(page.getByTestId("bills-body")).toHaveAttribute(
		"data-status",
		"ready",
	);
}

async function fillBill(
	page: Page,
	code: string,
	no: string,
	total: number,
): Promise<void> {
	await page.getByTestId("bill-code").fill(code);
	await page.getByTestId("bill-no").fill(no);
	await page.getByTestId("bill-total").fill(String(total));
	await page.getByRole("button", { name: "Ghi hóa đơn", exact: true }).click();
}

async function expectRefused(
	page: Page,
	refusal: string,
	words: string,
): Promise<void> {
	const alert = page.getByTestId("bill-refused");
	await expect(alert).toHaveAttribute("data-refusal", refusal);
	await expect(alert).toHaveText(words);
	await expect(page.getByTestId("bill-result")).toHaveCount(0);
}

async function expectRecorded(page: Page, earn: string): Promise<void> {
	await expect(page.getByTestId("bill-result")).toHaveAttribute(
		"data-state",
		"awaiting_customer",
	);
	await expect(page.getByTestId("bill-earn")).toHaveText(earn);
	await expect(page.getByTestId("bill-confirm-by")).toHaveText(
		/^Khách xác nhận trước \d\d:\d\d ngày \d\d\/\d\d\/\d{4}$/,
	);
}

async function again(page: Page): Promise<void> {
	await page.getByRole("button", { name: "Ghi hóa đơn khác" }).click();
	await expect(page.getByTestId("bill-code")).toBeVisible();
}

async function member(): Promise<SeededMember> {
	return need().seedMember(STAFF_STORE);
}

function scanOf(page: Page, ready: Ready) {
	return watchResponsePhones(page, new URL(ready.appUrl).origin);
}

test("a staff member records bills at a staff-mode store, each refusal reads in words and the daily limit stops the 4th bill (decision table, boundary values)", async ({
	page,
}) => {
	const f = need();
	const staff = await f.newStaff(STAFF_STORE, "staff");
	const ready = await startStaffLoop(staff);
	expect(ready).toMatchObject({ role: "staff", boundNow: true });
	const scan = scanOf(page, ready);
	const credentials = watchRpcCredentials(page);
	const memberA = await member();
	const memberB = await member();
	await signIn(page, ready);
	await openBills(page);
	await expect(page.getByTestId("bills-pos-sync")).toHaveCount(0);
	await expect(page.getByTestId("bill-code")).toBeVisible();
	await expect(page.getByRole("button", { name: /^Hoàn tác/ })).toHaveCount(0);
	await checkMiniAppScreen(page);

	// boundary: 9,999 earns neither a stamp nor a point, and the refusal leaves the code usable
	const codeA = await f.issueCode(memberA, STAFF_STORE);
	const first = billNo();
	await fillBill(page, codeA, first, 9_999);
	await expectRefused(
		page,
		"below_minimum",
		"Hóa đơn chưa đạt mức tối thiểu để được cộng dấu hay điểm.",
	);
	await checkMiniAppScreen(page);
	// boundary: 10,000 earns one point and no stamp
	await fillBill(page, codeA, first, 10_000);
	await expectRecorded(page, "+0 dấu · +1 điểm");
	await expect(page.getByTestId("bill-member")).toHaveText(
		`Khách •••• ••• ${memberA.phone.slice(-3)}`,
	);
	await expect(
		page.locator(`[data-testid=recent-bill][data-bill-no=${first}]`),
	).toHaveAttribute("data-state", "awaiting_customer");
	await expect(page.locator("body")).not.toContainText(memberA.phone);
	await checkMiniAppScreen(page);

	// the code is single use
	await again(page);
	await fillBill(page, codeA, billNo(), 60_000);
	await expectRefused(
		page,
		"code_used",
		"Mã này đã được dùng. Hãy nhờ khách mở mã mới.",
	);

	// the same bill number: the same total is a repeat, another total a conflict
	const codeA2 = await f.issueCode(memberA, STAFF_STORE);
	await fillBill(page, codeA2, first, 10_000);
	await expectRefused(
		page,
		"bill_used",
		"Hóa đơn này đã được ghi rồi. Không cần ghi lại.",
	);
	await fillBill(page, codeA2, first, 95_000);
	await expectRefused(
		page,
		"bill_conflict",
		"Số hóa đơn này đã được ghi với tổng tiền khác. Quản lý đã được báo; hãy kiểm tra lại hóa đơn.",
	);
	// neither refusal wrote a bill or spent the code: a new number records with it
	const second = billNo();
	await fillBill(page, codeA2, second, 60_000);
	await expectRecorded(page, "+1 dấu · +6 điểm");
	expect(
		(await f.bills(memberA)).map((bill) => [bill.billNo, bill.total]),
	).toEqual([
		[first, 10_000],
		[second, 60_000],
	]);

	// a malformed form is refused on the screen before any call
	await again(page);
	const sent = (await scan.responses()).length;
	await fillBill(page, "12345", "", 0);
	await expect(page.getByTestId("bill-problem-code")).toHaveText(
		"Mã thành viên gồm đúng 6 chữ số.",
	);
	await expect(page.getByTestId("bill-problem-billNo")).toHaveText(
		"Hãy nhập số hóa đơn.",
	);
	expect((await scan.responses()).length).toBe(sent);

	// daily limit of the member: the 3rd earn of the day is recorded, the 4th is refused (boundary 3 and 4)
	for (let n = 1; n <= 3; n += 1) {
		const code = await f.issueCode(memberB, STAFF_STORE);
		await fillBill(page, code, billNo(), 50_000);
		await expectRecorded(page, "+1 dấu · +5 điểm");
		await again(page);
	}
	await fillBill(
		page,
		await f.issueCode(memberB, STAFF_STORE),
		billNo(),
		50_000,
	);
	await expectRefused(
		page,
		"daily_limit",
		"Hôm nay khách đã tích đủ số hóa đơn tối đa trong ngày.",
	);
	const rowsB = await f.bills(memberB);
	expect(rowsB).toHaveLength(3);
	expect(rowsB.every((bill) => bill.state === "awaiting_customer")).toBe(true);
	expect(rowsB.every((bill) => bill.earns === 1 && bill.stamps === 1)).toBe(
		true,
	);
	await checkMiniAppScreen(page);

	// role: a staff member is refused the manager's functions on a real bill (42501), and cannot answer for a customer
	const session = credentials();
	const [billOfB] = rowsB;
	if (billOfB === undefined) throw new Error("no bill of member B");
	for (const [name, args] of [
		[
			"staff_decide_bill",
			{ p_bill_id: billOfB.id, p_decision: "approved", p_reason: "synthetic" },
		],
		["staff_reverse_bill", { p_bill_id: billOfB.id, p_reason: "synthetic" }],
		["staff_bill_queue", { p_store_id: f.storeId(STAFF_STORE) }],
	] as const) {
		const refused = await callRpc(session, name, args);
		expect([refused.status, refused.code], `${name} as staff`).toEqual([
			403,
			"42501",
		]);
	}
	const asCustomer = await callRpc(session, "customer_confirm_bill", {
		p_bill_id: billOfB.id,
		p_total: 50_000,
	});
	expect([asCustomer.status, asCustomer.code]).toEqual([403, "42501"]);
	expect((await f.bills(memberB))[0]).toMatchObject({
		state: "awaiting_customer",
		customerAnswers: 0,
	});

	expect(await scan.leaks()).toEqual([]);
	expect((await scan.responses()).join("\n")).toContain(
		"rpc/staff_submit_bill (200)",
	);
});

test("a staff session of a POS-sync store cannot record bills there and is refused every staff bill function of another store (not_staff_mode, 42501)", async ({
	page,
}) => {
	const f = need();
	const staff = await f.newStaff(POS_STORE, "staff");
	const ready = await startStaffLoop(staff);
	const scan = scanOf(page, ready);
	const credentials = watchRpcCredentials(page);
	const seeded = await f.seedMember(STAFF_STORE);
	await signIn(page, ready);
	// the home card of a POS-sync store offers Ghi nhận khách and no Ghi hóa đơn (the bills screen's own wording is unit-tested)
	const card = page.getByTestId("home-loyalty");
	await expect(
		card.getByRole("button", { name: "Ghi nhận khách" }),
	).toBeVisible();
	await expect(card.getByRole("button", { name: "Ghi hóa đơn" })).toHaveCount(
		0,
	);
	await checkMiniAppScreen(page);

	const session = credentials();
	const posStore = f.storeId(POS_STORE);
	const staffStore = f.storeId(STAFF_STORE);
	const code = await f.issueCode(seeded, STAFF_STORE);
	// the store of the session, on the POS sync: refused in words by the function
	const atPos = await callRpc(session, "staff_submit_bill", {
		p_store_id: posStore,
		p_code: code,
		p_bill_no: billNo(),
		p_total: 85_000,
	});
	expect(atPos.status).toBe(200);
	expect(atPos.body).toEqual({
		state: "refused",
		refusal: "not_staff_mode",
		bill_id: null,
	});
	// the staff-mode store of the same tenant, outside the session's scope: refused by scope, whatever the code
	for (const [name, args] of [
		[
			"staff_submit_bill",
			{
				p_store_id: staffStore,
				p_code: code,
				p_bill_no: billNo(),
				p_total: 85_000,
			},
		],
		["staff_recent_bills", { p_store_id: staffStore }],
		["staff_bill_queue", { p_store_id: staffStore }],
		["staff_counter_code", { p_store_id: staffStore }],
		["staff_counter_claims", { p_store_id: staffStore }],
	] as const) {
		const refused = await callRpc(session, name, args);
		expect(
			[refused.status, refused.code],
			`${name} for a store outside the scope`,
		).toEqual([403, "42501"]);
	}
	expect(await f.bills(seeded)).toEqual([]);
	// the member's code was not spent by any refusal above
	const [live] = await f.sql<{ status: string }>`
		select status from public.pending_checkins
		where code = ${code} and store_id = ${staffStore}::uuid order by created_at desc limit 1
	`;
	expect(live?.status).toBe("issued");
	expect(await scan.leaks()).toEqual([]);
});

test("Ghi nhận khách at a staff-mode store is refused staff_mode, points to Ghi hóa đơn and leaves the member's code for the bill", async ({
	page,
}) => {
	const f = need();
	// the home card of a staff-mode store offers Ghi hóa đơn only, so the member of two stores reaches Ghi nhận khách
	// through the POS-sync store and picks the staff-mode one there
	const staff = await f.newStaff(STAFF_STORE, "staff", [POS_STORE]);
	const ready = await startStaffLoop(staff);
	const scan = scanOf(page, ready);
	const seeded = await member();
	await signIn(page, ready);
	await page
		.getByLabel("Cửa hàng", { exact: true })
		.first()
		.selectOption({ label: "Synthetic store 2" });
	await page
		.getByTestId("home-loyalty")
		.getByRole("button", { name: "Ghi nhận khách" })
		.click();
	await expect(page.getByTestId("checkin-entry")).toBeVisible();
	await page
		.getByTestId("loyalty-store-picker")
		.selectOption({ label: "Synthetic store 1" });
	const code = await f.issueCode(seeded, STAFF_STORE);
	await page.getByTestId("checkin-entry").fill(code);
	await page.getByRole("button", { name: "Ghi nhận", exact: true }).click();
	const problem = page.getByTestId("checkin-problem");
	await expect(problem).toHaveAttribute("data-refusal", "staff_mode");
	await expect(problem).toHaveText(
		"Cửa hàng này ghi hóa đơn tay thay cho máy POS. Hãy dùng Ghi hóa đơn để cộng dấu và điểm cho khách.",
	);
	await expect(page.locator("body")).not.toContainText(seeded.phone);
	await checkMiniAppScreen(page);

	await page.getByTestId("checkin-to-bills").click();
	await expect(
		page.getByRole("heading", { level: 1, name: "Ghi hóa đơn" }),
	).toBeVisible();
	await expect(page.getByTestId("bills-body")).toHaveAttribute(
		"data-status",
		"ready",
	);
	const no = billNo();
	await fillBill(page, code, no, 85_000);
	await expectRecorded(page, "+1 dấu · +8 điểm");
	expect(await f.bills(seeded)).toEqual([
		expect.objectContaining({
			billNo: no,
			state: "awaiting_customer",
			evidenceLevel: 0,
			earns: 1,
			stamps: 1,
			points: 8,
		}),
	]);
	expect((await f.customerState(seeded)).earnsByPath).toEqual({ E: 1 });
	await expect(page.locator("body")).not.toContainText(seeded.phone);
	expect(await scan.leaks()).toEqual([]);
});
