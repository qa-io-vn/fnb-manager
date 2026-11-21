// Test design (ISTQB) for the camera screen of the staff app, the part of G-91 that does not need a phone: the staff
// app's "Quét mã thành viên" on Ghi hóa đơn against the REAL functions of the local database (`pnpm zalo:dev`), on the
// synthetic tenant loyalty-sim whose store sim-1 is put in staff mode for the test and restored afterwards.
// The camera is Zalo's own (zmp-sdk scanQRCode), not a browser camera, so Chromium's fake media devices do not reach it:
// in a browser the app reads a stand-in that the address drives (`scan=refused`, `scan=cancel`, `scanCode=<text>`), and
// this spec drives that seam end to end. What the real camera needs (the Zalo runtime, the permission prompt, a QR in
// front of a lens) stays open as G-99 in docs/test-gaps.md.
// - equivalence partitions of what the camera returns: permission refused (the typed code still works), cancelled
//   (nothing changes), a text that is not a member code (a counter QR, a phone number, a link, a short number: the
//   screen says so and shows none of it), a member QR of another store (the function refuses wrong_store in words and
//   spends nothing) and a member QR of this store (the code fills in, the hint says it was scanned, the bill records);
// - security: nothing the camera read is echoed on the screen, no full phone on any screen or in any
//   data response.
// Every member, phone and bill number is synthetic; the fixture erases its customers, bills and audit rows.
import { randomBytes } from "node:crypto";
import {
	checkMiniAppScreen,
	watchMiniAppPage,
} from "@fnb/zalo-mini/testing/design-checks";
import { watchResponsePhones } from "@fnb/zalo-mini/testing/network-scan";
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

const PORT = portOf(5790);
const STORE = "sim-1";
const OTHER_STORE = "sim-2";
const STACK_SKIP =
	"set ZALO_LOCAL_DEV=1 with the local stack running to drive pnpm zalo:dev on loyalty-sim";

let fixture: LoyaltyFixture | null = null;
const loops: LocalLoop[] = [];

test.beforeEach(async () => {
	test.skip(!(await localStackRuns()) || localDatabaseUrl() === "", STACK_SKIP);
	fixture = await openLoyaltyFixture();
	await fixture.setStoreMode(STORE, "staff");
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

/** the staff app with the stand-in camera set by `query`, signed in and on Ghi hóa đơn */
async function openBillsWith(
	page: Page,
	ready: Ready,
	query: Record<string, string>,
): Promise<void> {
	const url = new URL(ready.appUrl);
	for (const [name, value] of Object.entries(query))
		url.searchParams.set(name, value);
	await page.goto(url.toString());
	await page.getByRole("button", { name: "Tiếp tục" }).click();
	await page
		.getByTestId("home-loyalty")
		.getByRole("button", { name: "Ghi hóa đơn" })
		.click();
	await expect(page.getByTestId("bills-body")).toHaveAttribute(
		"data-status",
		"ready",
	);
	await expect(page.getByTestId("bill-code")).toBeVisible();
}

async function recordWith(
	page: Page,
	no: string,
	total: number,
	code?: string,
): Promise<void> {
	if (code !== undefined) await page.getByTestId("bill-code").fill(code);
	await page.getByTestId("bill-no").fill(no);
	await page.getByTestId("bill-total").fill(String(total));
	await page.getByRole("button", { name: "Ghi hóa đơn", exact: true }).click();
}

async function memberWithCode(
	f: LoyaltyFixture,
	store = STORE,
): Promise<{ member: SeededMember; code: string }> {
	const member = await f.seedMember(STORE);
	return { member, code: await f.issueCode(member, store) };
}

test("the staff app's stand-in camera: refused, cancelled, unreadable texts and a member QR of another store leave no bill; a member QR of this store records one (equivalence partitioning)", async ({
	page,
}) => {
	const f = need();
	const staff = await f.newStaff(STORE, "staff");
	const ready = await startStaffLoop(staff);
	expect(ready).toMatchObject({ role: "staff", boundNow: true });
	await watchMiniAppPage(page);
	const scan = watchResponsePhones(page, new URL(ready.appUrl).origin);

	// 1. permission refused: the screen says so and the typed code still records
	const typed = await memberWithCode(f);
	await openBillsWith(page, ready, { scan: "refused" });
	await page.getByTestId("scan").click();
	await expect(page.getByTestId("scan-refused")).toHaveText(
		"Bạn chưa cho phép quét mã. Hãy nhập mã 6 số khách đang mở trong ứng dụng.",
	);
	await expect(page.getByTestId("bill-code")).toBeFocused();
	await expect(page.getByTestId("bill-scanned")).toHaveCount(0);
	await checkMiniAppScreen(page);
	const first = billNo();
	await recordWith(page, first, 85_000, typed.code);
	await expect(page.getByTestId("bill-result")).toHaveAttribute(
		"data-state",
		"awaiting_customer",
	);
	expect(
		(await f.bills(typed.member)).map((bill) => [bill.billNo, bill.state]),
	).toEqual([[first, "awaiting_customer"]]);

	// 2. cancelled: nothing changes
	await openBillsWith(page, ready, { scan: "cancel" });
	await page.getByTestId("scan").click();
	await expect(page.getByTestId("scan-refused")).toHaveCount(0);
	await expect(page.getByTestId("scan-unreadable")).toHaveCount(0);
	await expect(page.getByTestId("bill-code")).toHaveValue("");
	await expect(page.getByTestId("bill-scanned")).toHaveCount(0);

	// 3. texts that are not a member code: said in words, never shown, nothing recorded
	const stranger = await f.seedMember(STORE);
	for (const text of [
		"fnb-counter:1:sim-1:ABCDEFGHJKLM",
		stranger.phone,
		"https://example.invalid/pay?x=1",
		"fnb-member:1:sim-1:12345",
		"fnb-redeem:1:ABCD1234",
	]) {
		await openBillsWith(page, ready, { scanCode: text });
		await page.getByTestId("scan").click();
		await expect(page.getByTestId("scan-unreadable")).toHaveText(
			"Mã vừa quét không phải mã thành viên. Hãy quét lại hoặc nhập mã 6 số.",
		);
		await expect(page.getByTestId("bill-code")).toHaveValue("");
		await expect(page.getByTestId("bill-scanned")).toHaveCount(0);
		const shown = (await page.locator("body").textContent()) ?? "";
		expect(shown).not.toContain(stranger.phone);
		expect(shown).not.toContain("example.invalid");
	}
	await checkMiniAppScreen(page);
	expect(await f.bills(stranger)).toEqual([]);

	// 4. a member QR of another store: refused in words by the function, nothing spent
	const away = await memberWithCode(f);
	await openBillsWith(page, ready, {
		scanCode: `fnb-member:1:${OTHER_STORE}:${away.code}`,
	});
	await page.getByTestId("scan").click();
	await expect(page.getByTestId("bill-scanned")).toBeVisible();
	await expect(page.getByTestId("bill-code")).toHaveValue(away.code);
	await recordWith(page, billNo(), 85_000);
	const wrong = page.getByTestId("bill-refused");
	await expect(wrong).toHaveAttribute("data-refusal", "wrong_store");
	await expect(wrong).toHaveText(
		"Mã này được tạo cho cửa hàng khác. Hãy nhờ khách chọn đúng cửa hàng trong ứng dụng.",
	);
	expect(await f.bills(away.member)).toEqual([]);
	expect(await f.codeIsLive(STORE, away.code)).toBe(true);

	// 5. a member QR of this store: the code fills in, the hint says it was scanned, the bill records
	const good = await memberWithCode(f);
	await openBillsWith(page, ready, {
		scanCode: `fnb-member:1:${STORE}:${good.code}`,
	});
	await page.getByTestId("scan").click();
	await expect(page.getByTestId("bill-scanned")).toHaveText(
		"Đã quét mã thành viên của khách.",
	);
	await expect(page.getByTestId("bill-code")).toHaveValue(good.code);
	const last = billNo();
	await recordWith(page, last, 60_000);
	await expect(page.getByTestId("bill-result")).toHaveAttribute(
		"data-state",
		"awaiting_customer",
	);
	await expect(page.getByTestId("bill-member")).toHaveText(
		`Khách •••• ••• ${good.member.phone.slice(-3)}`,
	);
	await expect(page.locator("body")).not.toContainText(good.member.phone);
	await checkMiniAppScreen(page);
	expect(
		(await f.bills(good.member)).map((bill) => [bill.billNo, bill.state]),
	).toEqual([[last, "awaiting_customer"]]);

	expect(await scan.leaks()).toEqual([]);
});
