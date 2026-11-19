import { expect, test } from "@playwright/test";
import {
	checkPage,
	expectNoSeriousAxeViolations,
	waitForCharts,
} from "../support/checks";
import {
	expectNoConsoleErrors,
	expectNoExternalRequests,
	expectShiftsLabelledByNumber,
	watchConsoleErrors,
} from "../support/reports";
import {
	choosePreset,
	chooseSemicolonCsv,
	csvTablesWithBom,
	expectDecimalCommas,
	expectEveryThemeCardSettled,
	expectRangeRoundTrip,
	expectSemicolonCsvTables,
	expectThemeInEnglish,
	expectThemePrintLayout,
	openTheme,
	shiftNumberedCardIds,
	themeCard,
	themeCardIds,
	themeCards,
	themeSearch,
	themeUrl,
	waitForSettledThemeCards,
} from "../support/themes";

const POS_SHIFT_NAMES = /Ca (sáng|chiều|tối)/;
const EMAIL_PATTERN = /[^\s@]+@[^\s@]+\.[^\s@]+/;
const SORT_ARROWS = /[↑↓↕]\s*$/;

test("Ca & két tiền opens on the last four weeks with its five cards settled, and 13 weeks fit", async ({
	page,
}) => {
	await openTheme(page, "shifts");
	await expect(
		page.getByRole("heading", { level: 1, name: "Ca & két tiền" }),
	).toBeVisible();
	expect(themeSearch(page).get("range")).toBe("28d");
	await expect(themeCards(page, "shifts")).toHaveCount(
		themeCardIds.shifts.length,
	);
	await expectEveryThemeCardSettled(page, "shifts");
	await expect(page.getByTestId("catch-up-banner")).toHaveCount(0);
	await expect(page.getByTestId("range-clamped")).toHaveCount(0);
	await expect(
		themeCard(page, "shifts", "shift_sales").getByTestId("sentence"),
	).toContainText(/Ca \d cao nhất/);
	await choosePreset(page, "13 tuần");
	await expectEveryThemeCardSettled(page, "shifts");
	expect(themeSearch(page).get("range")).toBe("91d");
	await expect(page.getByTestId("range-clamped")).toHaveCount(0);
	expectNoConsoleErrors(page);
});

test("a preset or a link longer than 92 days is shortened to the last 92 days with the notice, and steps by 92 days", async ({
	page,
}) => {
	await openTheme(page, "shifts");
	await page
		.getByTestId("range-presets")
		.getByRole("radio", { name: "52 tuần" })
		.click();
	await expect(page.getByTestId("range-clamped")).toContainText("92");
	await waitForSettledThemeCards(page);
	expect(themeSearch(page).get("from")).toBe("2026-08-04");
	expect(themeSearch(page).get("to")).toBe("2026-11-03");
	await expect(page.getByTestId("range-label")).toContainText("92 ngày");
	await expectEveryThemeCardSettled(page, "shifts");
	await page.getByRole("button", { name: "Khoảng trước" }).click();
	await waitForSettledThemeCards(page);
	expect(themeSearch(page).get("from")).toBe("2026-05-04");
	expect(themeSearch(page).get("to")).toBe("2026-08-03");
	await openTheme(page, "shifts", "from=2026-01-01&to=2026-11-03");
	await expect(page.getByTestId("range-clamped")).toContainText("92");
	expect(themeSearch(page).get("from")).toBe("2026-08-04");
	expectNoConsoleErrors(page);
});

test("the tab from a year-long range of another theme opens the last 92 days", async ({
	page,
}) => {
	await openTheme(page, "revenue", "range=364d&store=MOCK-S1");
	await page
		.getByTestId("theme-tabs")
		.getByRole("link", { name: "Ca & két tiền" })
		.click();
	await expect(page).toHaveURL(/#\/chu-de\/ca-ket-tien\?/);
	await waitForSettledThemeCards(page);
	expect(themeSearch(page).get("from")).toBe("2026-08-04");
	expect(themeSearch(page).get("to")).toBe("2026-11-03");
	expect(themeSearch(page).get("store")).toBe("MOCK-S1");
	await expectEveryThemeCardSettled(page, "shifts");
	expectNoConsoleErrors(page);
});

test("a custom range survives a reload, steps by its own length and comes back", async ({
	page,
}) => {
	await expectRangeRoundTrip(page, "shifts");
	expectNoConsoleErrors(page);
});

test("the young store settles every card, and its first weeks show the z-score dash with the notice", async ({
	page,
}) => {
	await openTheme(page, "shifts", "range=28d&store=MOCK-S2");
	await expectEveryThemeCardSettled(page, "shifts");
	await openTheme(
		page,
		"shifts",
		"from=2026-08-31&to=2026-09-13&store=MOCK-S2",
	);
	await expectEveryThemeCardSettled(page, "shifts");
	const adjustments = themeCard(page, "shifts", "adjustments");
	await expect(adjustments.getByTestId("card-notice")).toContainText(
		"chưa có đủ 3 ca trước đó",
	);
	const table = adjustments.getByRole("table", {
		name: "Các ca, điểm z cao nhất trước",
		exact: true,
	});
	const headers = (await table.locator("thead th").allTextContents()).map(
		(text) => text.replace(SORT_ARROWS, "").trim(),
	);
	for (const label of ["Điểm z hủy", "Điểm z xóa món"]) {
		const column = headers.indexOf(label);
		expect(column, label).toBeGreaterThan(0);
		const cells = await table
			.locator(`tbody tr td:nth-child(${column + 1})`)
			.allTextContents();
		expect(cells.length, label).toBeGreaterThan(10);
		expect(
			cells.map((cell) => cell.trim()),
			label,
		).toContain("—");
	}
	expectNoConsoleErrors(page);
});

test("the drawer and adjustment cards state their thresholds and basis, and the drawer has a table per cashier", async ({
	page,
}) => {
	await openTheme(page, "shifts");
	const drawer = themeCard(page, "shifts", "drawer");
	await expect(drawer.getByTestId("sentence")).toContainText("Ngưỡng:");
	await expect(drawer.getByTestId("sentence")).toContainText("50.000");
	const perCashier = drawer.getByRole("table", {
		name: "Lệch két theo thu ngân",
	});
	await expect(perCashier).toBeVisible();
	await expect(perCashier.locator("thead")).toContainText(
		"Ca lệch két vượt ngưỡng",
	);
	const adjustments = themeCard(page, "shifts", "adjustments");
	await expect(adjustments.getByTestId("sentence")).toContainText(
		"không phải kết luận về một người",
	);
	await expect(adjustments.getByTestId("sentence")).toContainText(
		"56 ngày trước",
	);
	expectNoConsoleErrors(page);
});

test("every card that lists shifts labels them Ca n on screen, in CSV and in print, and no card shows a POS name or an e-mail address", async ({
	page,
}) => {
	await openTheme(page, "shifts");
	for (const id of shiftNumberedCardIds) {
		await expectShiftsLabelledByNumber(
			page,
			`card-shifts-${id}`,
			POS_SHIFT_NAMES,
		);
	}
	for (const id of themeCardIds.shifts) {
		await expect(themeCard(page, "shifts", id)).not.toContainText("@");
		await expect(themeCard(page, "shifts", id)).not.toContainText(
			POS_SHIFT_NAMES,
		);
	}
	const cashiers = themeCard(page, "shifts", "cashiers");
	await page.emulateMedia({ media: "print" });
	try {
		await expect(cashiers.getByRole("table")).toBeAttached();
		await expect(cashiers).not.toContainText("@");
		await expect(cashiers).not.toContainText(EMAIL_PATTERN);
		await expect(cashiers).not.toContainText(POS_SHIFT_NAMES);
	} finally {
		await page.emulateMedia({ media: "screen" });
	}
	expectNoConsoleErrors(page);
});

test("the cashier card ranks the cashiers by drawer shifts over the thresholds, with the caution and no e-mail address, and passes axe at 360 and 1280 px in light and dark", async ({
	page,
}) => {
	await openTheme(page, "shifts", "range=28d&store=MOCK-S1");
	await expectEveryThemeCardSettled(page, "shifts");
	const card = themeCard(page, "shifts", "cashiers");
	await card.scrollIntoViewIfNeeded();
	await expect(
		card.getByRole("heading", { level: 3, name: "Theo thu ngân" }),
	).toBeVisible();
	await expect(card.getByTestId("headline")).toHaveText(/\d/);
	await expect(card.getByTestId("sentence")).toContainText(
		"không phải kết luận về một người",
	);
	await expect(card.getByTestId("card-notice")).toHaveCount(0);
	const table = card.getByRole("table", {
		name: "Các thu ngân, nhiều ca lệch két vượt ngưỡng nhất trước",
		exact: true,
	});
	const headers = (await table.locator("thead th").allTextContents()).map(
		(text) => text.replace(SORT_ARROWS, "").trim(),
	);
	expect(headers).toEqual([
		"Thu ngân",
		"Số ca",
		"Doanh thu thuần",
		"Ca lệch két vượt ngưỡng",
		"Tổng lệch két (tuyệt đối)",
		"Số lần hủy",
		"Món bị xóa",
		"Sửa sau khi đóng ca",
	]);
	expect(await table.locator("tbody tr").count()).toBeGreaterThan(1);
	const [csv, ...others] = await csvTablesWithBom(page, card);
	expect(others).toHaveLength(0);
	expect(csv).toContain("Ca lệch két vượt ngưỡng");
	expect(csv).not.toContain("@");
	expect(csv).not.toMatch(EMAIL_PATTERN);
	await expect(card).not.toContainText("@");
	await checkPage(page);
	await page.emulateMedia({ colorScheme: "dark" });
	try {
		await expectNoSeriousAxeViolations(page);
	} finally {
		await page.emulateMedia({ colorScheme: "light" });
	}
	await page.getByRole("button", { name: "EN", exact: true }).click();
	try {
		await expect(
			card.getByRole("heading", { level: 3, name: "By cashier" }),
		).toBeVisible();
		await expect(card.getByTestId("sentence")).toContainText(
			"not a conclusion about a person",
		);
		await expect(
			card.getByRole("table", {
				name: "Cashiers, most shifts over the drawer thresholds first",
				exact: true,
			}),
		).toBeVisible();
	} finally {
		await page.getByRole("button", { name: "VI", exact: true }).click();
	}
	expectNoConsoleErrors(page);
});

function csvRows(text: string): string[][] {
	return text
		.trim()
		.split("\r\n")
		.map((line) => line.split(","));
}

function percentOf(text: string | null): number {
	return Number((text ?? "").replace(/[^\d,]/g, "").replace(",", "."));
}

test("the member share card heads with the share its table adds up to, names the lowest Ca n, downloads its CSV with a BOM and no phone, says plainly when no invoice has a member, and passes axe at 360 and 1280 px in light and dark", async ({
	page,
}) => {
	await openTheme(page, "shifts", "range=28d&store=MOCK-S1");
	await expectEveryThemeCardSettled(page, "shifts");
	const card = themeCard(page, "shifts", "member_share");
	await card.scrollIntoViewIfNeeded();
	await expect(
		card.getByRole("heading", {
			level: 3,
			name: "Tỷ lệ hóa đơn có hội viên theo ca",
		}),
	).toBeVisible();
	await expect(card.getByTestId("sentence")).toContainText(
		/Ca \d thấp nhất: .*%/,
	);
	const table = card.getByRole("table", {
		name: "Các ca và hóa đơn có hội viên, mới nhất trước",
		exact: true,
	});
	const headers = (await table.locator("thead th").allTextContents()).map(
		(text) => text.replace(SORT_ARROWS, "").trim(),
	);
	expect(headers).toEqual([
		"Ngày",
		"Ca",
		"Hóa đơn",
		"Hóa đơn có hội viên",
		"Tỷ lệ có hội viên",
	]);
	const [csv, ...others] = await csvTablesWithBom(page, card);
	expect(others).toHaveLength(0);
	const [header, ...rows] = csvRows(csv ?? "");
	expect(header?.[1]).toBe("Ca");
	expect(rows.length).toBeGreaterThan(28);
	expect(rows.every((row) => /^Ca \d+$/.test(row[1] ?? ""))).toBe(true);
	const invoices = rows.reduce((sum, row) => sum + Number(row[2]), 0);
	const members = rows.reduce((sum, row) => sum + Number(row[3]), 0);
	expect(members).toBeGreaterThan(0);
	const headline = card.getByTestId("headline");
	expect(
		Math.abs(
			percentOf(await headline.getAttribute("data-exact")) -
				(100 * members) / invoices,
		),
	).toBeLessThan(0.1);
	await expect(headline.locator("..")).toContainText(
		`${members.toLocaleString("vi-VN")} trên ${invoices.toLocaleString("vi-VN")} hóa đơn có hội viên`,
	);
	expect(csv).not.toMatch(/0\d{9}/);
	await expect(card).not.toContainText(/0\d{9}/);
	await expect(card).not.toContainText("@");
	await checkPage(page);
	await page.emulateMedia({ colorScheme: "dark" });
	try {
		await page.setViewportSize({ width: 360, height: 800 });
		await expectNoSeriousAxeViolations(page);
	} finally {
		await page.emulateMedia({ colorScheme: "light" });
		await page.setViewportSize({ width: 1280, height: 800 });
	}
	await openTheme(
		page,
		"shifts",
		"from=2026-09-01&to=2026-09-28&store=MOCK-S1",
	);
	await expectEveryThemeCardSettled(page, "shifts");
	const before = themeCard(page, "shifts", "member_share");
	await expect(before.getByTestId("sentence")).toContainText(
		"chưa hóa đơn nào",
	);
	await expect(before.getByTestId("sentence")).toContainText("Thêm khách hàng");
	expectNoConsoleErrors(page);
});

test("every Ca & két tiền table downloads as UTF-8 CSV with a BOM, its headers and no @", async ({
	page,
}) => {
	await openTheme(page, "shifts");
	const texts: string[] = [];
	for (const id of themeCardIds.shifts) {
		texts.push(
			...(await csvTablesWithBom(page, themeCard(page, "shifts", id))),
		);
	}
	expect(texts).toHaveLength(6);
	const all = texts.join("\r\n");
	for (const label of [
		"Mở ca",
		"Đóng ca",
		"Tiền mặt dự kiến",
		"Tổng lệch két",
		"Điểm z hủy",
		"Sửa sau khi đóng ca",
		"Ca lệch két vượt ngưỡng",
		"Hóa đơn có hội viên",
	]) {
		expect(all).toContain(label);
	}
	expect(all).toContain("Ca 1");
	expect(all).not.toContain("@");
	expect(all).not.toMatch(EMAIL_PATTERN);
	expect(all).not.toMatch(POS_SHIFT_NAMES);
	expectNoConsoleErrors(page);
});

test("Ca & két tiền prints without controls, passes axe, fits 360 px, stays local and reads in English", async ({
	page,
}) => {
	watchConsoleErrors(page);
	await expectNoExternalRequests(page, async () => {
		await page.goto(themeUrl("shifts"));
		await waitForSettledThemeCards(page);
	});
	await waitForCharts(page);
	await expectThemePrintLayout(page);
	await checkPage(page);
	await expectThemeInEnglish(page, "Shifts and cash drawer");
	expectNoConsoleErrors(page);
});

test("Ca & két tiền downloads every table semicolon-separated with its exact headers and decimal commas on a device set to that format", async ({
	page,
}) => {
	await chooseSemicolonCsv(page);
	await openTheme(page, "shifts");
	const texts: string[] = [];
	for (const id of themeCardIds.shifts) {
		texts.push(
			...(await expectSemicolonCsvTables(page, themeCard(page, "shifts", id))),
		);
	}
	expectDecimalCommas(texts);
	expect(texts.join("\r\n")).not.toContain("@");
	expectNoConsoleErrors(page);
});
