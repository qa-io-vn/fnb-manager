import {
	checkMiniAppScreen,
	watchMiniAppPage,
} from "@fnb/zalo-mini/testing/design-checks";
import { expect, type Page, test } from "@playwright/test";
import { expectOnePrimaryAction, mockSdkApis } from "./entry-checks";

const NOON = new Date("2026-11-19T12:00:00+07:00");
const NOTICE_START = "Khi liên kết, Cửa hàng Mẫu chỉ dùng mã tài khoản Zalo";
const NOTICE_END =
	"Bạn có thể ngừng bất cứ lúc nào trong Cài đặt → Cảnh báo, hoặc nhờ chủ cửa hàng gỡ liên kết. Nhật ký gửi tin được lưu khoảng 13 tháng.";

test.beforeEach(async ({ page }) => {
	await page.clock.setFixedTime(NOON);
	await watchMiniAppPage(page);
});

async function openSettings(page: Page, query: string): Promise<void> {
	await page.goto(`./${query}`);
	await page
		.getByRole("navigation", { name: "Điều hướng chính" })
		.getByRole("button", { name: "Cá nhân" })
		.click();
	const section = page.getByTestId("profile-notifications");
	await expect(section).toBeVisible();
	await checkMiniAppScreen(page);
	await section.getByRole("button", { name: "Cài đặt nhận thông báo" }).click();
	await expect(page.getByTestId("consent-state")).toBeVisible();
}

test("staff see their linked destination and consent, and follow the OA after its purpose", async ({
	page,
}) => {
	await openSettings(page, "?role=staff");
	const destination = page.getByTestId("destination");
	await expect(destination).toHaveCount(1);
	await expect(destination).toContainText("Zalo Bot");
	await expect(destination.getByTestId("destination-state")).toHaveText(
		"Đang nhận",
	);
	await expect(page.getByTestId("consent-state")).toContainText(
		"Bạn đồng ý nhận bản tin và cảnh báo lúc",
	);
	await expect(page.getByTestId("bot-linked")).toBeVisible();
	await expect(page.getByText("Chưa sẵn sàng")).toHaveCount(0);
	const follow = page.getByTestId("notify-follow");
	await expect(follow.getByTestId("follow-purpose")).toHaveText(
		"Theo dõi OA để nhận tin vận hành ngay trong Zalo.",
	);
	expect(await mockSdkApis(page)).not.toContain("followOA");
	await checkMiniAppScreen(page);
	await follow.getByRole("button", { name: "Theo dõi OA" }).click();
	await expect(follow.getByTestId("follow-done")).toHaveText(
		"Bạn đã theo dõi OA.",
	);
	expect(await mockSdkApis(page)).toContain("followOA");
	await checkMiniAppScreen(page);
	await page.getByRole("button", { name: "Quay lại" }).click();
	await expect(page.getByTestId("profile")).toBeVisible();
});

test("refusing the follow changes nothing else", async ({ page }) => {
	await openSettings(page, "?role=staff&follow=refused");
	const follow = page.getByTestId("notify-follow");
	await follow.getByRole("button", { name: "Theo dõi OA" }).click();
	await expect(follow.getByTestId("follow-refused")).toContainText(
		"Bạn chưa theo dõi OA.",
	);
	await expect(
		follow.getByRole("button", { name: "Theo dõi OA" }),
	).toBeEnabled();
	await expect(
		page.getByTestId("destination").getByTestId("destination-state"),
	).toHaveText("Đang nhận");
	await checkMiniAppScreen(page);
});

test("a member reads the notice first, then gets a code to send to the Bot, which expires", async ({
	page,
}) => {
	await openSettings(page, "?role=staff&notify=unlinked");
	await expect(page.getByTestId("destinations-empty")).toBeVisible();
	await expect(page.getByTestId("consent-state")).toHaveText(
		"Bạn chưa đồng ý nhận bản tin và cảnh báo.",
	);
	const bot = page.getByTestId("notify-bot");
	await bot.getByRole("button", { name: "Liên kết Zalo Bot" }).click();
	const notice = bot.getByTestId("bot-notice");
	await expect(notice).toHaveAttribute("data-version", "ops-notifications-v1");
	await expect(notice.getByTestId("notice-text")).toContainText(NOTICE_START);
	await expect(notice.getByTestId("notice-text")).toContainText(NOTICE_END);
	await expect(bot.getByTestId("link-code")).toHaveCount(0);
	await expectOnePrimaryAction(page);
	await checkMiniAppScreen(page);
	await notice.getByRole("button", { name: "Tạo mã liên kết" }).click();
	await expect(bot.getByTestId("link-code")).toHaveText("FNB-MAUTHU27");
	await expect(bot.getByTestId("link-countdown")).toHaveText(
		"Mã hết hạn sau 15:00",
	);
	await expect(bot.getByTestId("link-steps")).toContainText(
		"Mở Zalo và tìm Bot Mẫu.",
	);
	await expect(bot.getByTestId("link-steps")).toContainText(
		"Trả lời ĐỒNG Ý để bắt đầu nhận tin.",
	);
	await expect(page.getByTestId("destination-waiting")).toHaveText(
		"Gửi mã liên kết cho Bot trong khung chat Zalo để tiếp tục.",
	);
	await checkMiniAppScreen(page);
	await page.clock.setFixedTime(new Date(NOON.getTime() + 16 * 60_000));
	await expect(bot.getByTestId("link-expired")).toHaveText(
		"Mã đã hết hạn. Tạo mã mới để liên kết.",
	);
	await expect(bot.getByTestId("link-code")).toHaveCount(0);
	await bot.getByRole("button", { name: "Tạo mã mới" }).click();
	await expect(bot.getByTestId("notice-text")).toContainText(NOTICE_START);
	await bot.getByRole("button", { name: "Tạo mã liên kết" }).click();
	await expect(bot.getByTestId("link-code")).toHaveText("FNB-MAUTHU35");
	await checkMiniAppScreen(page);
});

test("a member mutes a kind of message, then stops every notification after confirming", async ({
	page,
}) => {
	await openSettings(page, "?role=staff");
	const group = page.getByTestId("mute-destination");
	await expect(group).toContainText("Zalo Bot …3f7a");
	const checklist = group.getByTestId("mute-checklist_unfinished");
	await expect(checklist).toBeChecked();
	await checklist.click();
	await expect(checklist).not.toBeChecked();
	await expect(page.getByTestId("destination-muted")).toHaveText(
		"Đã tắt 1 loại tin ở nơi nhận này.",
	);
	await checkMiniAppScreen(page);
	const stop = page.getByTestId("notify-stop");
	await stop.getByRole("button", { name: "Dừng nhận thông báo" }).click();
	const confirm = stop.getByTestId("stop-confirm");
	await expect(confirm).toContainText("Dừng nhận mọi thông báo?");
	await checkMiniAppScreen(page);
	await confirm.getByRole("button", { name: "Dừng nhận" }).click();
	await expect(stop.getByTestId("stop-done")).toContainText(
		"Đã dừng nhận thông báo.",
	);
	await expect(stop.getByTestId("stop-staff-ops")).toHaveText(
		"Dừng nhận thông báo không ảnh hưởng đến việc bạn dùng ứng dụng nhân viên.",
	);
	await expect(
		page.getByTestId("destination").getByTestId("destination-state"),
	).toHaveText("Đã dừng");
	await expect(page.getByTestId("destination-reason")).toHaveText(
		"Bạn đã dừng nhận thông báo.",
	);
	await expect(page.getByTestId("consent-state")).toContainText(
		"Bạn đã dừng nhận thông báo lúc",
	);
	await expect(
		page.getByTestId("notify-bot").getByRole("button", {
			name: "Liên kết Zalo Bot",
		}),
	).toBeVisible();
	await checkMiniAppScreen(page);
	await page.getByRole("button", { name: "Quay lại" }).click();
	await expect(page.getByTestId("profile")).toBeVisible();
});
