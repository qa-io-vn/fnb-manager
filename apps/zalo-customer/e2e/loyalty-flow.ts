import { expect, type Page, test } from "@playwright/test";
import {
	checkCustomerScreen,
	nativeStorageKeys,
	sdkCalls,
} from "./customer-checks";
import {
	type LoyaltyFixture,
	SIM_BRAND,
	SIM_TENANT,
	type SimTenant,
	type SyntheticCustomer,
} from "./loyalty-fixture";

// The steps the live-stack specs of the customer app share: the loop's arguments for a mock customer, the browse and
// join screens up to the member card, and a member code with enough life left to be typed at the till.

export function customerLoopArgs(
	customer: SyntheticCustomer,
	port: string,
): string[] {
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
		port,
	];
}

export async function browseAndJoin(
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

export async function freshMemberCode(page: Page): Promise<string> {
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

/**
 * The member code on the screen, checked against the database. The screen can show a code that a second, concurrent
 * request of the same mount has already replaced (G-98); the spec then waits for the next rotation and says so in an
 * annotation instead of failing on a defect that is not under test.
 */
export async function liveMemberCode(
	page: Page,
	fixture: LoyaltyFixture,
	storeCode: string,
): Promise<string> {
	for (let attempt = 0; attempt < 2; attempt += 1) {
		const code = await freshMemberCode(page);
		if (await fixture.codeIsLive(storeCode, code)) return code;
		test.info().annotations.push({
			type: "G-98",
			description: "the shown member code was already replaced",
		});
		await expect(page.getByTestId("member-code")).not.toHaveText(code, {
			timeout: 90_000,
		});
	}
	throw new Error("the member code on the screen is never a live code");
}
