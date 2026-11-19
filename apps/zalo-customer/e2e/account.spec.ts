import { expect, test } from "@playwright/test";
import {
	checkCustomerScreen,
	nativeStorageKeys,
	openHome,
	openTab,
	PROGRAMME,
	watchCustomerPage,
} from "./customer-checks";

test.beforeEach(async ({ page }) => {
	await watchCustomerPage(page);
});

test("a member asks to delete their data after a clear confirmation and sees the request's state", async ({
	page,
}) => {
	await openHome(page, "?member=1");
	await openTab(page, "Tài khoản");
	const card = page.getByTestId("settings-delete");
	await expect(card.getByRole("heading")).toHaveText("Xóa dữ liệu của tôi");
	await checkCustomerScreen(page);
	await card.getByRole("button", { name: "Xóa dữ liệu của tôi" }).click();
	const dialog = page.getByRole("dialog", { name: "Xóa dữ liệu của bạn?" });
	await expect(dialog).toContainText("phản hồi trong 2 ngày làm việc");
	await expect(dialog).toContainText("xóa xong trong 20 ngày");
	const send = dialog.getByRole("button", { name: "Gửi yêu cầu xóa" });
	await expect(send).toBeDisabled();
	await checkCustomerScreen(page);
	await dialog
		.getByRole("checkbox", {
			name: "Tôi hiểu dấu, điểm và ưu đãi chưa dùng sẽ mất.",
		})
		.check();
	await send.click();
	await expect(page.getByTestId("result-modal")).toContainText(
		"Đã gửi yêu cầu xóa dữ liệu",
	);
	await expect(page.getByTestId("result-modal")).toBeHidden();
	await expect(page.getByTestId("deletion-status")).toHaveText(
		"Chủ quán đã nhận yêu cầu",
	);
	await expect(page.getByTestId("deletion-requested")).toContainText(
		"Gửi lúc 10:00 19/11/2026",
	);
	await expect(page.getByTestId("deletion-deadline")).toBeVisible();
	await expect(page.getByTestId("deletion-reply-by")).toHaveText(
		"Chủ quán phản hồi chậm nhất ngày 23/11/2026.",
	);
	await expect(page.getByTestId("deletion-done-by")).toHaveText(
		"Dữ liệu được xóa xong chậm nhất ngày 09/12/2026.",
	);
	await expect(
		card.getByRole("button", { name: "Xóa dữ liệu của tôi" }),
	).toHaveCount(0);
	await checkCustomerScreen(page);
	expect(await nativeStorageKeys(page)).toEqual(["fnb.customer-session"]);
});

test("a deletion request sent before the app restarted shows its state and due dates, and a refused one can be sent again", async ({
	page,
}) => {
	await openHome(page, "?member=1&deletion=received");
	await openTab(page, "Tài khoản");
	const card = page.getByTestId("settings-delete");
	await expect(card.getByTestId("deletion-status")).toHaveText(
		"Chủ quán đã nhận yêu cầu",
	);
	await expect(card.getByTestId("deletion-requested")).toContainText(
		"Gửi lúc 10:00 18/11/2026",
	);
	await expect(card.getByTestId("deletion-reply-by")).toHaveText(
		"Chủ quán phản hồi chậm nhất ngày 20/11/2026.",
	);
	await expect(card.getByTestId("deletion-done-by")).toHaveText(
		"Dữ liệu được xóa xong chậm nhất ngày 08/12/2026.",
	);
	await expect(
		card.getByRole("button", { name: "Xóa dữ liệu của tôi" }),
	).toHaveCount(0);
	await checkCustomerScreen(page);

	await openHome(page, "?member=1&deletion=in_progress&lang=en");
	await openTab(page, "Account");
	await expect(card.getByTestId("deletion-status")).toHaveText(
		"The owner is handling it",
	);
	await expect(card.getByTestId("deletion-reply-by")).toHaveCount(0);
	await expect(card.getByTestId("deletion-done-by")).toHaveText(
		"Your data is deleted by 08/12/2026 at the latest.",
	);

	await openHome(page, "?member=1&deletion=rejected");
	await openTab(page, "Tài khoản");
	await expect(card.getByTestId("deletion-status")).toHaveText(
		"Yêu cầu không được thực hiện",
	);
	await card.getByRole("button", { name: "Xóa dữ liệu của tôi" }).click();
	const dialog = page.getByRole("dialog", { name: "Xóa dữ liệu của bạn?" });
	await dialog.getByRole("checkbox").check();
	await dialog.getByRole("button", { name: "Gửi yêu cầu xóa" }).click();
	await expect(card.getByTestId("deletion-status")).toHaveText(
		"Chủ quán đã nhận yêu cầu",
	);
	await expect(card.getByTestId("deletion-requested")).toContainText(
		"Gửi lúc 10:00 19/11/2026",
	);
	await checkCustomerScreen(page);
});

test("offline, the app says so on every screen and drops the notice when the connection is back", async ({
	page,
	context,
}) => {
	await openHome(page, "?member=1");
	await context.setOffline(true);
	await expect(page.getByTestId("offline")).toContainText(
		"Bạn đang ngoại tuyến.",
	);
	await checkCustomerScreen(page);
	await openTab(page, "Thẻ thành viên");
	await expect(page.getByTestId("member-card")).toBeVisible();
	await expect(page.getByTestId("offline")).toBeVisible();
	await checkCustomerScreen(page);
	await context.setOffline(false);
	await expect(page.getByTestId("offline")).toHaveCount(0);
});

test("without a store open to members, the home and the member screens say so", async ({
	page,
}) => {
	await page.goto("./?member=1&stores=none");
	await expect(page.getByRole("heading", { name: PROGRAMME })).toBeVisible();
	await expect(page.getByTestId("no-stores")).toContainText(
		"Chưa có cửa hàng nào nhận thành viên.",
	);
	await checkCustomerScreen(page);
	await openTab(page, "Thẻ thành viên");
	await page.getByRole("button", { name: "Mã thành viên" }).click();
	await expect(
		page.getByTestId("member-code-screen").getByTestId("no-stores"),
	).toBeVisible();
	await checkCustomerScreen(page);
	await page.getByRole("button", { name: "Quay lại" }).click();
	await page.getByRole("button", { name: "Nhận điểm từ hóa đơn" }).click();
	await expect(
		page.getByTestId("claim").getByTestId("no-stores"),
	).toBeVisible();
	await checkCustomerScreen(page);
});

test("the account tab speaks English with the same deletion deadlines", async ({
	page,
}) => {
	await page.goto("./?member=1&lang=en");
	await expect(page.getByRole("heading", { name: PROGRAMME })).toBeVisible();
	await openTab(page, "Account");
	await page.getByRole("button", { name: "Delete my data" }).click();
	const dialog = page.getByRole("dialog", { name: "Delete your data?" });
	await expect(dialog).toContainText("a reply within 2 working days");
	await checkCustomerScreen(page);
});
