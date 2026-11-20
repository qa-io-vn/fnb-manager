import { checkPage } from "../support/checks";
import { expect, test } from "../support/policy-test";
import {
	expectNoConsoleErrors,
	REPORT_CLOCK,
	watchConsoleErrors,
} from "../support/reports";

// The demo login is an owner, so both entries show. The other roles are covered by
// src/shell/secondary-navigation.test.ts, which runs the same gate on every role.

test.beforeEach(async ({ page }) => {
	await page.clock.setFixedTime(REPORT_CLOCK);
	watchConsoleErrors(page);
});

test("the side rail offers Khách hàng and Vận hành, the phone's bottom bar keeps its five", async ({
	page,
}) => {
	await page.setViewportSize({ width: 1280, height: 800 });
	await page.goto("/#/");
	const rail = page.getByTestId("side-rail");
	const secondary = rail.getByTestId("side-rail-secondary");
	await expect(secondary.getByRole("link")).toHaveText([
		"Khách hàng",
		"Vận hành",
	]);
	await expect(secondary).toHaveAccessibleName("Khách hàng và vận hành");

	await secondary.getByRole("link", { name: "Khách hàng" }).click();
	await expect(page).toHaveURL(/#\/khach-hang\/thanh-vien$/);
	await expect(
		secondary.getByRole("link", { name: "Khách hàng" }),
	).toHaveAttribute("aria-current", "page");
	await expect(
		secondary.getByRole("link", { name: "Vận hành" }),
	).not.toHaveAttribute("aria-current", "page");

	await secondary.getByRole("link", { name: "Vận hành" }).click();
	await expect(page).toHaveURL(/#\/van-hanh\/checklist(\?.*)?$/);
	await expect(
		secondary.getByRole("link", { name: "Vận hành" }),
	).toHaveAttribute("aria-current", "page");

	await page.getByRole("button", { name: "EN", exact: true }).click();
	await expect(secondary.getByRole("link")).toHaveText([
		"Customers",
		"Operations",
	]);

	await page.setViewportSize({ width: 360, height: 800 });
	await expect(rail).toBeHidden();
	await expect(
		page.getByTestId("bottom-navigation").getByRole("link"),
	).toHaveCount(5);
	await page.setViewportSize({ width: 1280, height: 800 });
	await checkPage(page);
	expectNoConsoleErrors(page);
});
