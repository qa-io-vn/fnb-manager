import { expect, type Page, test } from "@playwright/test";
import {
	checkCustomerScreen,
	nativeStorageKeys,
	openTab,
	sdkCalls,
	watchCustomerPage,
} from "./customer-checks";
import { LocalLoop, localStackRuns, portOf } from "./local-loop";
import {
	type LoyaltyFixture,
	openLoyaltyFixture,
	SIM_BRAND,
	SIM_TENANT,
	type SimTenant,
	type SyntheticCustomer,
} from "./loyalty-fixture";

const CUSTOMER_PORT = portOf(5781);
const STAFF_PORT = portOf(5782);
const SALE_AMOUNT = 60_000;
const STACK_SKIP =
	"set ZALO_LOCAL_DEV=1 with the local stack running to drive pnpm zalo:dev on loyalty-sim";

function customerLoopArgs(customer: SyntheticCustomer): string[] {
	return [
		"--app",
		"customer",
		"--live",
		"--tenant",
		SIM_TENANT,
		"--brand",
		SIM_BRAND,
		"--mock-user",
		customer.mockUser,
		"--mock-name",
		customer.mockName,
		"--mock-phone",
		customer.phone,
		"--port",
		CUSTOMER_PORT,
	];
}

async function browseAndJoin(
	page: Page,
	url: string,
	tenant: SimTenant,
): Promise<void> {
	await page.goto(url);
	await expect(
		page.getByRole("heading", { name: tenant.programmeName }),
	).toBeVisible();
	await expect(page.getByTestId("store-list").getByRole("button")).toHaveCount(
		tenant.stores.length,
	);
	await checkCustomerScreen(page);
	const firstStore = tenant.stores[0];
	if (firstStore === undefined) throw new Error("loyalty-sim has no store");
	await page
		.getByTestId("store-list")
		.getByRole("button", { name: new RegExp(firstStore.name) })
		.click();
	await expect(
		page.getByRole("heading", { name: firstStore.name }),
	).toBeVisible();
	await checkCustomerScreen(page);
	await page.getByRole("button", { name: "Quay lại" }).click();
	await page.getByRole("button", { name: "Chính sách bảo mật" }).click();
	const privacy = page.getByRole("dialog");
	await expect(privacy.getByTestId("legal-document")).toBeVisible();
	await checkCustomerScreen(page);
	await privacy.getByRole("button", { name: /Đóng/ }).click();
	expect(await sdkCalls(page)).not.toContain("getPhoneNumber");

	await page.getByRole("button", { name: "Tham gia thành viên" }).click();
	await expect(
		page.getByRole("heading", { name: "Tham gia thành viên" }),
	).toBeVisible();
	await checkCustomerScreen(page);
	await page.getByRole("button", { name: "Tiếp tục" }).click();
	await expect(
		page.getByRole("heading", { name: "Đồng ý tham gia" }),
	).toBeVisible();
	await expect(page.getByRole("checkbox")).not.toBeChecked();
	await expect(page.getByRole("switch")).not.toBeChecked();
	await expect(page.getByRole("button", { name: "Tham gia" })).toBeDisabled();
	await checkCustomerScreen(page);
	expect(await sdkCalls(page)).not.toContain("getPhoneNumber");
	await page.getByRole("checkbox").check();
	await page.getByRole("button", { name: "Tham gia" }).click();
	await expect(
		page.getByRole("heading", { name: "Chào mừng bạn!" }),
	).toBeVisible();
	await expect(page.getByTestId("welcome-stamps")).toHaveText(
		`Bạn nhận được ${tenant.welcomeStamps} dấu chào mừng.`,
	);
	expect(await sdkCalls(page)).toContain("getPhoneNumber");
	await checkCustomerScreen(page);
	await page.getByRole("button", { name: "Bỏ qua" }).click();
	await expect(page.getByTestId("member-card")).toBeVisible();
	await expect(page.getByTestId("stamp-count")).toHaveText(
		`${tenant.welcomeStamps}/${tenant.stampsPerCard} dấu`,
	);
	await checkCustomerScreen(page);
	expect(await nativeStorageKeys(page)).toEqual(["fnb.customer-session"]);
}

const MIN_CODE_SECONDS = 15;

async function freshMemberCode(page: Page): Promise<string> {
	const code = page.getByTestId("member-code");
	const countdown = page.getByTestId("code-countdown");
	const seconds = Number(
		/(\d+)/.exec((await countdown.textContent()) ?? "")?.[1] ?? "0",
	);
	if (seconds < MIN_CODE_SECONDS) {
		const old = (await code.textContent()) ?? "";
		await expect(code).not.toHaveText(old, { timeout: 90_000 });
		await expect(countdown).toHaveText(/^Mã đổi sau [1-6]\d giây$/);
	}
	const value = (await code.textContent()) ?? "";
	expect(value).toMatch(/^\d{6}$/);
	return value;
}

let fixture: LoyaltyFixture | null = null;
const loops: LocalLoop[] = [];

test.beforeEach(async ({ page }) => {
	test.skip(!(await localStackRuns()), STACK_SKIP);
	await watchCustomerPage(page, null);
	fixture = await openLoyaltyFixture();
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

test("a customer browses loyalty-sim, joins with the phone consent, claims a receipt from the till, sees it confirmed and asks to delete their data", async ({
	page,
}) => {
	if (fixture === null) throw new Error("no fixture");
	const { tenant } = fixture;
	const customer = await fixture.newCustomer();
	const loop = new LocalLoop();
	loops.push(loop);
	const ready = await loop.start(customerLoopArgs(customer));
	expect(ready.role).toBe("customer");
	const hosts = new Set<string>();
	page.on("request", (request) => hosts.add(new URL(request.url()).host));

	await browseAndJoin(page, ready.appUrl, tenant);
	const joined = await fixture.customerState(customer);
	expect(joined).toMatchObject({
		customers: 1,
		memberships: 1,
		welcomeStamps: tenant.welcomeStamps,
		loyaltyConsents: 1,
		marketingConsents: 0,
	});

	const claimStore = tenant.stores[1] ?? tenant.stores[0];
	if (claimStore === undefined) throw new Error("loyalty-sim has no store");
	const sale = await fixture.ringSale({
		store: claimStore.code,
		amount: SALE_AMOUNT,
	});
	await page.getByRole("button", { name: "Nhận điểm từ hóa đơn" }).click();
	await expect(
		page.getByRole("heading", { name: "Nhận điểm từ hóa đơn" }),
	).toBeVisible();
	await page.getByTestId("claim-store").selectOption(claimStore.code);
	await page.getByTestId("claim-receipt").fill(sale.receiptNo);
	await page.getByTestId("claim-amount").fill(String(SALE_AMOUNT));
	await page.getByTestId("claim-date").selectOption(sale.businessDate);
	await checkCustomerScreen(page);
	await page.getByRole("button", { name: "Gửi hóa đơn" }).click();
	await expect(page.getByTestId("claim-result")).toHaveAttribute(
		"data-state",
		"matched",
	);
	await checkCustomerScreen(page);
	await page.getByRole("button", { name: "Xem thẻ thành viên" }).click();
	await expect(page.getByTestId("stamp-count")).toHaveText(
		`${tenant.welcomeStamps + 1}/${tenant.stampsPerCard} dấu`,
	);
	const earn = page.getByTestId("history-item").first();
	await expect(earn).toHaveAttribute("data-state", "confirmed");
	await expect(earn).toContainText("Qua hóa đơn bạn gửi");
	await expect(earn).toContainText(sale.receiptNo);
	await expect(page.getByTestId("claim-item").first()).toHaveAttribute(
		"data-state",
		"matched",
	);
	await checkCustomerScreen(page);

	const claimed = await fixture.customerState(customer);
	expect(claimed.earnsByPath).toEqual({ C: 1 });
	expect(claimed.matchedClaims).toBe(1);
	expect(claimed.openDeletionRequests).toBe(0);

	await openTab(page, "Tài khoản");
	await page
		.getByTestId("settings-delete")
		.getByRole("button", { name: "Xóa dữ liệu của tôi" })
		.click();
	const confirm = page.getByRole("dialog", { name: "Xóa dữ liệu của bạn?" });
	await confirm.getByRole("checkbox").check();
	await confirm.getByRole("button", { name: "Gửi yêu cầu xóa" }).click();
	await expect(page.getByTestId("deletion-status")).toHaveAttribute(
		"data-status",
		"received",
	);
	await expect(page.getByTestId("deletion-deadline")).toBeVisible();
	await checkCustomerScreen(page);
	const due = await fixture.deletionDueDates(customer);
	await expect(page.getByTestId("deletion-reply-by")).toHaveText(
		`Chủ quán phản hồi chậm nhất ngày ${due.firstResponse}.`,
	);
	await expect(page.getByTestId("deletion-done-by")).toHaveText(
		`Dữ liệu được xóa xong chậm nhất ngày ${due.completion}.`,
	);

	await page.reload();
	await openTab(page, "Tài khoản");
	const card = page.getByTestId("settings-delete");
	await expect(card.getByTestId("deletion-status")).toHaveAttribute(
		"data-status",
		"received",
	);
	await expect(card.getByTestId("deletion-done-by")).toHaveText(
		`Dữ liệu được xóa xong chậm nhất ngày ${due.completion}.`,
	);
	await expect(
		card.getByRole("button", { name: "Xóa dữ liệu của tôi" }),
	).toHaveCount(0);
	await checkCustomerScreen(page);
	const asked = await fixture.customerState(customer);
	expect(asked.openDeletionRequests).toBe(1);
	expect(asked.memberships).toBe(1);
	expect([...hosts].filter((host) => host !== "")).toEqual([
		`127.0.0.1:${CUSTOMER_PORT}`,
	]);
	expect(await loop.stop()).toBe(0);
});

test("the staff app records the customer's member code at sim-1, a sale rung in the window earns it and the customer's wallet shows path member_code", async ({
	page,
	browser,
}) => {
	if (fixture === null) throw new Error("no fixture");
	const { tenant } = fixture;
	const store = tenant.stores.find((entry) => entry.code === "sim-1");
	if (store === undefined) throw new Error("loyalty-sim has no sim-1");
	const customer = await fixture.newCustomer();
	const staff = await fixture.newStaff(store.code);
	const customerLoop = new LocalLoop();
	const staffLoop = new LocalLoop();
	loops.push(customerLoop, staffLoop);
	const [customerReady, staffReady] = await Promise.all([
		customerLoop.start(customerLoopArgs(customer)),
		staffLoop.start([
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
		]),
	]);
	expect(staffReady).toMatchObject({ role: "manager", boundNow: true });
	expect(staffLoop.lines()).toContain(
		"loyalty tools: the staff loyalty functions of the local stack",
	);

	await browseAndJoin(page, customerReady.appUrl, tenant);
	await openTab(page, "Trang chủ");
	await page
		.getByTestId("store-list")
		.getByRole("button", { name: new RegExp(store.name) })
		.click();
	await page
		.getByRole("button", { name: "Mã thành viên tại cửa hàng này" })
		.click();
	await expect(page.getByTestId("member-code")).toHaveText(/^\d{6}$/);
	await checkCustomerScreen(page);

	const staffContext = await browser.newContext({
		viewport: page.viewportSize(),
		isMobile: true,
		hasTouch: true,
		locale: "vi-VN",
		timezoneId: "Asia/Ho_Chi_Minh",
	});
	try {
		const desk = await staffContext.newPage();
		await desk.goto(staffReady.appUrl);
		await desk.getByRole("button", { name: "Tiếp tục" }).click();
		const card = desk.getByTestId("home-loyalty");
		await expect(card).toBeVisible();
		await card.getByRole("button", { name: "Ghi nhận khách" }).click();
		await expect(desk.getByTestId("checkin-entry")).toBeVisible();
		await expect(
			desk.getByText("Dữ liệu mẫu, chưa ghi vào hệ thống"),
		).toHaveCount(0);
		await fixture.quietStore(store.code);
		await desk.getByTestId("checkin-entry").fill(await freshMemberCode(page));
		await desk.getByRole("button", { name: "Ghi nhận" }).click();
		await expect(desk.getByTestId("checkin-state")).toHaveText(
			"Đang chờ xác nhận",
		);
		await expect(desk.getByTestId("checkin-member")).toHaveText(
			`Khách •••• ••• ${customer.phone.slice(-3)}`,
		);
		await expect(desk.locator("body")).not.toContainText(customer.phone);

		await desk.getByRole("button", { name: "Ghi nhận khách khác" }).click();
		await desk.getByTestId("checkin-entry").fill(customer.phone);
		await desk.getByRole("button", { name: "Ghi nhận" }).click();
		await expect(desk.getByTestId("checkin-problem")).toHaveText(
			/^Khách này vừa được ghi nhận ở cửa hàng này\./,
		);

		const sale = await fixture.ringSale({
			store: store.code,
			amount: SALE_AMOUNT,
		});
		expect(sale.output).toMatch(/loyalty: reconciled,[^\n]*\bb_matched 1\b/);
		const earned = await fixture.customerState(customer);
		expect(earned.earnsByPath).toEqual({ B: 1 });
		expect(earned.matchedCheckins).toBe(1);

		await openTab(page, "Thẻ thành viên");
		await expect(page.getByTestId("stamp-count")).toHaveText(
			`${tenant.welcomeStamps + 1}/${tenant.stampsPerCard} dấu`,
		);
		const earn = page.getByTestId("history-item").first();
		await expect(earn).toHaveAttribute("data-state", "confirmed");
		await expect(earn).toContainText("Qua mã thành viên");
		await expect(earn).toContainText(store.name);
		await checkCustomerScreen(page);
		await desk.close();
	} finally {
		await staffContext.close();
	}
	expect(await staffLoop.stop()).toBe(0);
	expect(await customerLoop.stop()).toBe(0);
});

test("a member redeems a reward at sim-1, the staff app verifies the code, the till rings its discount entry and the voucher shows Đã dùng", async ({
	page,
	browser,
}) => {
	if (fixture === null) throw new Error("no fixture");
	const { tenant } = fixture;
	const store = tenant.stores.find((entry) => entry.code === "sim-1");
	if (store === undefined) throw new Error("loyalty-sim has no sim-1");
	const cost = tenant.welcomeStamps + 1;
	const reward = await fixture.seedReward(store.code, cost);
	const customer = await fixture.newCustomer();
	const staff = await fixture.newStaff(store.code);
	const customerLoop = new LocalLoop();
	const staffLoop = new LocalLoop();
	loops.push(customerLoop, staffLoop);
	const [customerReady, staffReady] = await Promise.all([
		customerLoop.start(customerLoopArgs(customer)),
		staffLoop.start([
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
		]),
	]);

	await browseAndJoin(page, customerReady.appUrl, tenant);

	const staffContext = await browser.newContext({
		viewport: page.viewportSize(),
		isMobile: true,
		hasTouch: true,
		locale: "vi-VN",
		timezoneId: "Asia/Ho_Chi_Minh",
	});
	try {
		const desk = await staffContext.newPage();
		await desk.goto(staffReady.appUrl);
		await desk.getByRole("button", { name: "Tiếp tục" }).click();
		const tools = desk.getByTestId("home-loyalty");
		await tools.getByRole("button", { name: "Tra cứu thành viên" }).click();
		await desk.getByTestId("lookup-phone").fill(customer.phone);
		await desk.getByRole("button", { name: "Tra cứu" }).click();
		await expect(desk.getByTestId("member-stamps")).toHaveText(
			`${tenant.welcomeStamps}/${tenant.stampsPerCard}`,
		);
		await desk.getByRole("button", { name: "Điều chỉnh" }).click();
		await desk.getByTestId("request-stamps").fill("1");
		await desk
			.getByTestId("request-reason")
			.fill("Bù dấu cho lần mua trước, bộ kiểm thử.");
		await desk.getByRole("button", { name: "Gửi" }).click();
		await expect(desk.getByTestId("result-modal")).toHaveText(/Đã điều chỉnh/);
		await expect(desk.getByTestId("member-stamps")).toHaveText(
			`${cost}/${tenant.stampsPerCard}`,
		);

		await openTab(page, "Trang chủ");
		await openTab(page, "Thẻ thành viên");
		await expect(page.getByTestId("stamp-count")).toHaveText(
			`${cost}/${tenant.stampsPerCard} dấu`,
		);
		await page.getByRole("button", { name: "Đổi quà" }).click();
		await expect(page.getByTestId("reward-store-picker")).toHaveValue(
			store.code,
		);
		const offered = page.getByTestId("reward").filter({ hasText: reward.name });
		await expect(offered.getByTestId("reward-cost")).toHaveText(`${cost} dấu`);
		await expect(offered.getByTestId("reward-state")).toHaveAttribute(
			"data-available",
			"true",
		);
		await checkCustomerScreen(page);
		await offered.getByRole("button", { name: "Đổi quà" }).click();
		const dialog = page.getByRole("dialog", { name: `Đổi ${reward.name}?` });
		await expect(dialog.getByTestId("redeem-cost")).toHaveText(
			`Bạn dùng ${cost} dấu để đổi quà này tại ${store.name}.`,
		);
		await checkCustomerScreen(page);
		await dialog.getByRole("button", { name: "Xác nhận đổi" }).click();
		const code = page.getByTestId("voucher-code");
		await expect(code).toHaveText(/^[A-Z0-9]{8}$/);
		const voucherCode = (await code.textContent()) ?? "";
		await expect(page.getByTestId("voucher-qr")).toHaveAttribute(
			"data-payload",
			`fnb-redeem:1:${voucherCode}`,
		);
		await expect(page.getByTestId("voucher-countdown")).toHaveText(
			/^Còn (24:00:00|23:59:\d\d)$/,
		);
		await checkCustomerScreen(page);
		expect(await fixture.redemptionState(reward)).toMatchObject({
			held: 1,
			verified: 0,
		});

		await desk.getByRole("button", { name: "Quay lại" }).click();
		await tools.getByRole("button", { name: "Kiểm tra ưu đãi" }).click();
		await desk.getByTestId("redeem-code").fill(voucherCode);
		await desk.getByRole("button", { name: "Kiểm tra" }).click();
		await expect(desk.getByTestId("redeem-instruction")).toHaveAttribute(
			"data-kind",
			"pos_discount",
		);
		await expect(desk.getByTestId("redeem-apply")).toHaveText(
			reward.discountName,
		);
		await expect(desk.getByTestId("redeem-reward")).toHaveText(reward.name);
		expect(await fixture.redemptionState(reward)).toMatchObject({
			held: 1,
			verified: 1,
		});

		const sale = await fixture.ringSale({
			store: store.code,
			amount: SALE_AMOUNT,
			discountName: reward.discountName,
		});
		expect(sale.output).toMatch(
			/loyalty: reconciled,[^\n]*\bdiscount_confirmed 1\b/,
		);
		expect(await fixture.redemptionState(reward)).toMatchObject({
			held: 0,
			confirmed: 1,
		});

		await page.getByRole("button", { name: "Ví voucher" }).click();
		const voucher = page.getByTestId("voucher-item").first();
		await expect(voucher).toHaveAttribute("data-state", "used");
		await expect(voucher).toContainText("Đã dùng");
		await expect(voucher).toContainText(reward.name);
		await checkCustomerScreen(page);
		const state = await fixture.customerState(customer);
		expect(state.earnsByPath).toEqual({ D: 1 });

		await desk.getByRole("button", { name: "Kiểm tra mã khác" }).click();
		await desk.getByTestId("redeem-code").fill(`fnb-redeem:1:${voucherCode}`);
		await desk.getByRole("button", { name: "Kiểm tra" }).click();
		const refused = desk.getByTestId("redeem-refused");
		await expect(refused).toHaveAttribute("data-refusal", "used");
		await expect(refused).toContainText("Mã đã được sử dụng");
		await expect(refused).not.toContainText(customer.phone);
		await desk.close();
	} finally {
		await staffContext.close();
	}
	expect(await staffLoop.stop()).toBe(0);
	expect(await customerLoop.stop()).toBe(0);
});
