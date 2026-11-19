import { expect, type Locator, type Page, test } from "@playwright/test";
import {
	checkPage,
	expectNoSeriousAxeViolations,
	waitForCharts,
} from "../support/checks";
import {
	expectNoConsoleErrors,
	expectNoExternalRequests,
} from "../support/reports";
import { openSettings, saveSettings } from "../support/settings";
import {
	choosePreset,
	chooseSemicolonCsv,
	expectCsvTablesWithBom,
	expectDecimalCommas,
	expectEveryThemeCardSettled,
	expectRangeRoundTrip,
	expectSemicolonCsvTables,
	expectThemeInEnglish,
	expectThemePrintLayout,
	openTheme,
	themeCard,
	themeCardIds,
	themeCards,
	themeSearch,
	themeUrl,
	waitForSettledThemeCards,
} from "../support/themes";

const SISTER_STORE = "Cửa hàng không chạy chương trình";
const PRIOR_WEEKS = "Các tuần trước chương trình";
const BASELINE = "Cùng thứ các tuần trước";
const NO_CONTROL =
	"Mọi cửa hàng đang chọn đều chạy chương trình này nên không có cửa hàng để so sánh.";
const PRE_WEEKS = "Số tuần trước khuyến mãi";
const SPRING = {
	from: "2026-03-03",
	to: "2026-06-02",
	promotion: "bill:Giảm 5% hóa đơn",
} as const;

function liftCard(page: Page): Locator {
	return themeCard(page, "promotions", "lift");
}

function comparator(page: Page, name: string): Locator {
	return liftCard(page).getByRole("radio", { name, exact: true });
}

function promotionSelect(page: Page): Locator {
	return liftCard(page).getByRole("combobox", { name: "Chương trình" });
}

async function expectLiftSubtitle(page: Page, text: string): Promise<void> {
	await expect(liftCard(page)).toContainText(text);
}

test("Khuyến mãi opens on the last four weeks with its seven cards settled and the lift of the costliest promotion", async ({
	page,
}) => {
	await openTheme(page, "promotions");
	await expect(
		page.getByRole("heading", { level: 1, name: "Khuyến mãi & giảm giá" }),
	).toBeVisible();
	expect(themeSearch(page).get("range")).toBe("28d");
	await expect(themeCards(page, "promotions")).toHaveCount(
		themeCardIds.promotions.length,
	);
	await expectEveryThemeCardSettled(page, "promotions");
	const redemptions = themeCard(page, "promotions", "redemptions");
	await expect(redemptions).toContainText("Ưu đãi thành viên đã đổi");
	await expect(redemptions.getByTestId("headline")).toHaveText("—");
	await expect(redemptions.getByTestId("sentence")).toHaveText(
		"Chưa có dữ liệu ưu đãi thành viên: bản demo không có chương trình khách hàng thân thiết.",
	);
	await expect(redemptions.getByTestId("comparison-chip")).toHaveCount(0);
	await expect(redemptions.locator("table")).toHaveCount(0);
	const cost = themeCard(page, "promotions", "discount_cost");
	await expect(cost.getByTestId("comparison-chip")).toHaveCount(4);
	await expect(cost.getByTestId("comparison-chip").first()).toContainText(
		"so với 4 tuần trước",
	);
	await expect(cost.getByTestId("comparison-chip").nth(2)).toContainText(
		"tỷ lệ giảm giá so với 4 tuần trước",
	);
	await expect(cost).toContainText("doanh thu gộp");
	const vouchers = themeCard(page, "promotions", "vouchers");
	await expect(vouchers.getByTestId("comparison-chip")).toHaveCount(2);
	await expect(vouchers.getByTestId("sentence")).toContainText(
		"hóa đơn có dùng voucher",
	);
	await expect(promotionSelect(page)).toHaveValue("voucher:Voucher 20k");
	await expect(comparator(page, BASELINE)).toBeChecked();
	await expectLiftSubtitle(page, "Voucher 20k (Voucher) · 28 ngày cuối kỳ");
	await expectLiftSubtitle(
		page,
		"đối chứng: cùng thứ trong 8 tuần trước của chính cửa hàng",
	);
	await expect(liftCard(page).getByTestId("headline")).toHaveText("—");
	await expect(liftCard(page).getByTestId("card-notice")).toContainText(
		"Chưa đủ 7 ngày không khuyến mãi",
	);
	await expect(liftCard(page).getByTestId("card-notice")).toContainText(
		"hãy chọn khoảng ngày có những ngày không chạy chương trình này",
	);
	await expect(liftCard(page).getByTestId("card-notice")).not.toContainText(
		"cửa hàng",
	);
	await expect(liftCard(page).getByTestId("sentence")).toContainText(
		"Chưa đo được hiệu quả của Voucher 20k (Voucher)",
	);
	await expect(liftCard(page).getByTestId("sentence")).not.toContainText(
		"ròng",
	);
	await choosePreset(page, "13 tuần");
	await expectEveryThemeCardSettled(page, "promotions");
	await expectLiftSubtitle(page, "91 ngày cuối kỳ");
	await choosePreset(page, "Năm nay");
	await expectEveryThemeCardSettled(page, "promotions");
	await expectLiftSubtitle(page, "92 ngày cuối kỳ");
	expectNoConsoleErrors(page);
});

test("the rule cards check the cap with its basis and vouchers apart, count discount days as information only after the reported repeal, and warn about the lucky-draw name in the catalogue", async ({
	page,
}) => {
	await openTheme(page, "promotions");
	await expectEveryThemeCardSettled(page, "promotions");
	const cap = themeCard(page, "promotions", "rule_cap");
	await expect(cap).toContainText(
		"Tối đa 50% giá ngay trước khuyến mãi (Thông tư 39/2025/TT-BCT, Điều 4); đối chiếu với quy định đến ngày 12/11/2026, không thay cho tư vấn pháp lý.",
	);
	await expect(cap.getByTestId("headline")).toHaveText("0");
	await expect(cap.getByTestId("sentence")).toContainText(
		"Không có giảm giá món hay giảm giá hóa đơn nào quá 50%",
	);
	await expect(cap.getByTestId("sentence")).toContainText(
		"Voucher được ghi riêng, không tính vào mức giảm này",
	);
	await expect(cap.getByTestId("card-notice")).toContainText(
		"chương trình khuyến mại tập trung do cơ quan nhà nước tổ chức được giảm đến 100%",
	);
	const capTables = cap.locator("table");
	await expect(capTables).toHaveCount(2);
	await expect(capTables.first().locator("tbody tr").last()).toContainText(
		"Cả hóa đơn (gồm voucher)",
	);
	await expect(capTables.nth(1).locator("tbody tr").first()).toContainText(
		"Voucher 20k",
	);
	const days = themeCard(page, "promotions", "rule_days");
	await expect(days).toContainText("năm 2026 · chỉ để theo dõi");
	const daysSentence = days.getByTestId("sentence");
	await expect(daysSentence).toContainText(
		"Giới hạn 120 ngày giảm giá bán mỗi món mỗi năm (Nghị định 81/2018/NĐ-CP, Điều 10) được cho là đã bãi bỏ từ 26/06/2026 theo Nghị định 239/2026/NĐ-CP; thông tin này còn đang được kiểm tra",
	);
	await expect(daysSentence).toContainText(
		"Không món nào có hơn 120 ngày giảm giá bán trong 01/01/2026 – 25/06/2026, khi giới hạn còn áp dụng.",
	);
	await expect(daysSentence).toContainText(
		"ngày tặng món và ngày dùng voucher là hình thức khuyến mại khác",
	);
	await expect(days.getByTestId("table-preview-toggle")).toBeVisible();
	const catalogue = themeCard(page, "promotions", "catalogue");
	await expect(catalogue.getByTestId("headline")).toHaveText("5");
	await expect(catalogue.getByTestId("sentence")).toContainText(
		"4 chương trình đang bật trong danh mục POS không được dùng hơn 90 ngày tính đến 03/11/2026",
	);
	const warning = catalogue.getByTestId("card-notice");
	await expect(warning).toContainText("Tên của Vòng quay may mắn");
	await expect(warning).toContainText(
		"phải đăng ký với Sở Công Thương nếu chạy trong một tỉnh",
	);
	await expect(warning).toContainText("Nghị định 81/2018/NĐ-CP, Điều 13 và 19");
	await expect(warning).toContainText(
		"Nghị định 239/2026/NĐ-CP được cho là đã thay đổi thủ tục này",
	);
	await expect(warning).toContainText(
		"Đối chiếu với quy định đến ngày 12/11/2026; không thay cho tư vấn pháp lý.",
	);
	await expectNoSeriousAxeViolations(page);
	await page.emulateMedia({ colorScheme: "dark" });
	await expectNoSeriousAxeViolations(page);
	await page.emulateMedia({ colorScheme: "light" });
	await openTheme(page, "promotions", "from=2026-05-29&to=2026-06-25");
	await expectEveryThemeCardSettled(page, "promotions");
	await expect(days.getByTestId("sentence")).toContainText(
		"Theo Nghị định 81/2018/NĐ-CP, Điều 10, mỗi món được giảm giá bán không quá 120 ngày trong một năm.",
	);
	await expect(days).not.toContainText("chỉ để theo dõi");
	await expectThemeInEnglish(page, "Promotions & discounts");
	expectNoConsoleErrors(page);
});

test("a custom range survives a reload, steps by its own length and comes back", async ({
	page,
}) => {
	await expectRangeRoundTrip(page, "promotions");
	await expectEveryThemeCardSettled(page, "promotions");
});

test("the young store shows its missing last year rather than zeros", async ({
	page,
}) => {
	await openTheme(page, "promotions", "range=28d&store=MOCK-S2");
	await expectEveryThemeCardSettled(page, "promotions");
	const cost = themeCard(page, "promotions", "discount_cost");
	await expect(cost.getByTestId("comparison-chip").nth(1)).toContainText(
		"chưa có dữ liệu năm trước",
	);
	await expect(cost.getByTestId("comparison-chip").nth(3)).toContainText(
		"chưa có dữ liệu năm trước",
	);
	await expect(
		themeCard(page, "promotions", "vouchers")
			.getByTestId("comparison-chip")
			.nth(1),
	).toContainText("chưa có dữ liệu năm trước");
	await expect(comparator(page, SISTER_STORE)).toBeDisabled();
	expectNoConsoleErrors(page);
});

test("switching the comparator and the promotion updates the address and redraws the lift card, and the sister store stays disabled while both stores ran it", async ({
	page,
}) => {
	await openTheme(page, "promotions");
	await expect(comparator(page, SISTER_STORE)).toBeDisabled();
	await expect(liftCard(page).getByTestId("theme-param-reason-cmp")).toHaveText(
		NO_CONTROL,
	);
	await expect(comparator(page, SISTER_STORE)).toHaveAccessibleDescription(
		NO_CONTROL,
	);
	await comparator(page, PRIOR_WEEKS).click();
	await expect(page).toHaveURL(/cmp=prior_weeks/);
	await waitForSettledThemeCards(page);
	await expect(comparator(page, PRIOR_WEEKS)).toBeChecked();
	await expectLiftSubtitle(
		page,
		"đối chứng: 4 tuần trước ngày khuyến mãi đầu tiên",
	);
	await expect(liftCard(page).getByTestId("headline")).toHaveText("—");
	await promotionSelect(page).selectOption("item:PROMO-04");
	await promotionSelect(page).press("Enter");
	await expect(page).toHaveURL(/promo=item%3APROMO-04/);
	await waitForSettledThemeCards(page);
	expect(themeSearch(page).get("cmp")).toBe("prior_weeks");
	await expectLiftSubtitle(page, "Giảm 10% món (Giảm giá món)");
	await page.goBack();
	await waitForSettledThemeCards(page);
	expect(themeSearch(page).get("promo")).toBeNull();
	await expectLiftSubtitle(page, "Voucher 20k (Voucher)");
	await page.goto(themeUrl("promotions", "range=28d&cmp=sister_store"));
	await waitForSettledThemeCards(page);
	await expect.poll(() => themeSearch(page).get("cmp")).toBeNull();
	await expect(comparator(page, BASELINE)).toBeChecked();
	await expect(comparator(page, SISTER_STORE)).toBeDisabled();
	await expectEveryThemeCardSettled(page, "promotions");
});

test("the spring bill discount of both stores shows a measured loss with its gross lift, cost and trend, and offers the sister store", async ({
	page,
}) => {
	await openTheme(
		page,
		"promotions",
		`from=${SPRING.from}&to=${SPRING.to}&cmp=prior_weeks`,
	);
	await promotionSelect(page).selectOption(SPRING.promotion);
	await promotionSelect(page).press("Enter");
	await expect(page).toHaveURL(/promo=bill%3AGi/);
	await waitForSettledThemeCards(page);
	await expectEveryThemeCardSettled(page, "promotions");
	await expectLiftSubtitle(page, "Giảm 5% hóa đơn (Giảm giá hóa đơn)");
	await expectLiftSubtitle(page, "92 ngày cuối kỳ");
	const headline = liftCard(page).getByTestId("headline");
	await expect(headline).toHaveText(/^[-−]\s?532\.571\s₫$/);
	await expect(liftCard(page)).toContainText("Doanh thu gộp tăng thêm");
	await expect(liftCard(page)).toContainText("chi phí giảm giá 163.000");
	const sentence = liftCard(page).getByTestId("sentence");
	await expect(sentence).toContainText("lỗ ròng");
	await expect(sentence).toContainText("trong 18 ngày khuyến mãi đo được");
	await expect(sentence).toContainText("Đã trừ xu hướng chung");
	await expect(liftCard(page).getByTestId("card-notice")).toHaveCount(0);
	await expect(comparator(page, SISTER_STORE)).toBeEnabled();
	await expect(
		liftCard(page).getByTestId("theme-param-reason-cmp"),
	).toHaveCount(0);
	await comparator(page, SISTER_STORE).click();
	await expect(page).toHaveURL(/cmp=sister_store/);
	await waitForSettledThemeCards(page);
	await expect(comparator(page, SISTER_STORE)).toBeChecked();
	expect(themeSearch(page).get("cmp")).toBe("sister_store");
	await expectLiftSubtitle(
		page,
		"đối chứng: cửa hàng không chạy chương trình, so với 4 tuần trước của chính nó",
	);
	await expect(headline).toHaveText("—");
	await expectThemeInEnglish(page, "Promotions & discounts");
	expectNoConsoleErrors(page);
});

test("every Khuyến mãi table downloads as UTF-8 CSV with a BOM and the Vietnamese column labels", async ({
	page,
}) => {
	await openTheme(page, "promotions");
	const headers: string[] = [];
	for (const id of themeCardIds.promotions) {
		headers.push(
			...(await expectCsvTablesWithBom(
				page,
				themeCard(page, "promotions", id),
			)),
		);
	}
	expect(headers).toHaveLength(8);
	const text = headers.join(" ");
	for (const label of [
		"Loại giảm giá",
		"Tỷ trọng chi phí",
		"Dùng lần đầu",
		"Dùng lần cuối",
		"Thành phần",
		"Tỷ lệ hóa đơn",
		"Ngày khuyến mãi",
		"Ngày đối chứng",
		"Mốc so sánh",
		"Dự kiến nếu không khuyến mãi",
		"Trong danh mục POS",
		"Số ngày dùng trong 365 ngày",
		"Mức giảm một phần cao nhất",
		"Lần vượt mức",
		"Giảm toàn bộ",
		"Ngày giảm giá bán",
		"Ngày tặng món",
		"Ngày dùng voucher",
		"Lần trừ hơn mức tối đa",
	]) {
		expect(text).toContain(label);
	}
});

test("Khuyến mãi downloads every table semicolon-separated with decimal commas on a device set to that format", async ({
	page,
}) => {
	await chooseSemicolonCsv(page);
	await openTheme(page, "promotions");
	const texts: string[] = [];
	for (const id of themeCardIds.promotions) {
		texts.push(
			...(await expectSemicolonCsvTables(
				page,
				themeCard(page, "promotions", id),
			)),
		);
	}
	expectDecimalCommas(texts);
});

test("Khuyến mãi prints without pickers, passes axe, fits 360 px, stays local and reads in English", async ({
	page,
}) => {
	await expectNoExternalRequests(page, async () => {
		await page.goto(themeUrl("promotions"));
		await waitForSettledThemeCards(page);
	});
	await waitForCharts(page);
	await expectThemePrintLayout(page);
	await page.emulateMedia({ media: "print" });
	await expect(page.getByTestId("card-controls")).toBeHidden();
	await expect(liftCard(page)).toContainText("Voucher 20k (Voucher)");
	await page.emulateMedia({ media: "screen" });
	await checkPage(page);
	await expectThemeInEnglish(page, "Promotions & discounts");
	expectNoConsoleErrors(page);
});

test("the pre-period weeks saved on Ngưỡng báo cáo reach the lift on the next view, and restoring the default brings it back", async ({
	page,
}) => {
	await openTheme(page, "promotions", "range=28d&cmp=prior_weeks");
	await expectLiftSubtitle(
		page,
		"đối chứng: 4 tuần trước ngày khuyến mãi đầu tiên",
	);
	await openSettings(page, "bao-cao");
	const form = page.getByTestId("thresholds-form");
	const weeks = form.getByLabel(PRE_WEEKS, { exact: true });
	await expect(weeks).toHaveValue("4");
	await expect(form).toContainText("Mặc định: 4 tuần.");
	await weeks.fill("9");
	await weeks.blur();
	await expect(form.getByTestId("settings-field-error")).toHaveText(
		"Nhập giá trị từ 2 đến 8.",
	);
	await weeks.fill("6");
	await weeks.blur();
	await saveSettings(page.getByTestId("settings-save-bar"));
	await openTheme(page, "promotions", "range=28d&cmp=prior_weeks");
	await expectLiftSubtitle(
		page,
		"đối chứng: 6 tuần trước ngày khuyến mãi đầu tiên",
	);
	await expectEveryThemeCardSettled(page, "promotions");
	await openSettings(page, "bao-cao");
	await page.getByTestId("settings-restore-defaults").click();
	await expect(weeks).toHaveValue("4");
	await saveSettings(page.getByTestId("settings-save-bar"));
	await openTheme(page, "promotions", "range=28d&cmp=prior_weeks");
	await expectLiftSubtitle(
		page,
		"đối chứng: 4 tuần trước ngày khuyến mãi đầu tiên",
	);
	expectNoConsoleErrors(page);
});
