import { expect, test } from "@playwright/test";
import { checkPage } from "../support/checks";
import {
	anonymousClient,
	isLocalStackConfigured,
	localStack,
	seededLogin,
} from "../support/local-stack";

test.skip(
	!isLocalStackConfigured,
	"the local Supabase stack is not configured in .env.local",
);

test("a publishable-key client without a session reads zero invoices", async () => {
	const { data, error } = await anonymousClient()
		.from("invoices")
		.select("id")
		.limit(10);
	expect(error === null || data === null).toBe(true);
	expect(data ?? []).toHaveLength(0);
});

test("a signed-out visitor is sent to the login page", async ({ page }) => {
	await page.goto("/");
	await expect(page).toHaveURL(/#\/dang-nhap$/);
	await expect(page.getByRole("heading", { name: "Đăng nhập" })).toBeVisible();
	await expect(
		page.getByRole("button", { name: "Xem bản demo" }),
	).toBeVisible();
	await checkPage(page);
});

test("wrong credentials show an error", async ({ page }) => {
	await page.goto("/#/dang-nhap");
	await page.getByLabel("E-mail").fill(seededLogin.email);
	await page.getByLabel("Mật khẩu").fill("not-the-password");
	await page.getByRole("button", { name: "Đăng nhập" }).click();
	await expect(page.getByRole("alert")).toHaveText(
		"E-mail hoặc mật khẩu không đúng.",
	);
});

test("a password-reset request reaches the mail catcher", async ({
	page,
	request,
}) => {
	const startedAt = Date.now();
	await page.goto("/#/quen-mat-khau");
	await checkPage(page);
	await page.getByLabel("E-mail").fill(seededLogin.email);
	await page.getByRole("button", { name: "Gửi liên kết" }).click();
	await expect(page.getByTestId("reset-sent")).toBeVisible();
	await expect
		.poll(
			async () => {
				const response = await request.get(
					`${localStack.mailCatcherUrl}/api/v1/messages?limit=20`,
				);
				const body = (await response.json()) as {
					messages: { Created: string; To: { Address: string }[] }[];
				};
				return body.messages.some(
					(message) =>
						Date.parse(message.Created) >= startedAt - 1_000 &&
						message.To.some((to) => to.Address === seededLogin.email),
				);
			},
			{ timeout: 20_000 },
		)
		.toBe(true);
});

test("the new-password page explains an expired link when there is no session", async ({
	page,
}) => {
	await page.goto("/#/mat-khau-moi");
	await expect(
		page.getByText(
			"Liên kết đặt lại không còn hiệu lực. Hãy yêu cầu liên kết mới.",
		),
	).toBeVisible();
	await checkPage(page);
});

test("the login page opens the demo for the session with a visible exit", async ({
	page,
}) => {
	await page.goto("/#/dang-nhap");
	await expect(page).toHaveTitle("Đăng nhập · FNB Manager");
	await page.getByRole("button", { name: "Xem bản demo" }).click();
	await expect(page.getByTestId("demo-banner")).toBeVisible();
	await expect(page.getByTestId("card-today-net_revenue")).toBeVisible();
	await expect(
		page.getByRole("heading", { level: 1, name: "Hôm nay" }),
	).toBeFocused();
	await expect(page).toHaveTitle("Hôm nay · FNB Manager");
	await page.reload();
	await expect(page.getByTestId("demo-banner")).toBeVisible();
	await page.getByRole("button", { name: "Thoát bản demo" }).click();
	await expect(page).toHaveURL(/#\/dang-nhap$/);
	await expect(page.getByTestId("demo-banner")).toHaveCount(0);
});
