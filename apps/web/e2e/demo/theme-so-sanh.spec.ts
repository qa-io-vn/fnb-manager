import { expect, type Locator, type Page, test } from "@playwright/test";
import { checkPage, waitForCharts } from "../support/checks";
import {
	csvTextOf,
	expectNoConsoleErrors,
	expectNoExternalRequests,
	REPORT_CLOCK,
	watchConsoleErrors,
} from "../support/reports";
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

const NEED_TWO = "Chọn ít nhất hai cửa hàng để so sánh.";
const NOT_SET_UP = "chưa thiết lập";
const ALL_STORES = "Tất cả cửa hàng";
const STORE_NAMES = ["Cửa hàng mẫu 1", "Cửa hàng mẫu 2"];

function csvRows(text: string): string[][] {
	const rows: string[][] = [];
	let row: string[] = [];
	let cell = "";
	let quoted = false;
	for (let index = 0; index < text.length; index += 1) {
		const character = text[index];
		if (quoted) {
			if (character === '"' && text[index + 1] === '"') {
				cell += '"';
				index += 1;
			} else if (character === '"') {
				quoted = false;
			} else {
				cell += character;
			}
		} else if (character === '"') {
			quoted = true;
		} else if (character === ",") {
			row.push(cell);
			cell = "";
		} else if (character === "\r" && text[index + 1] === "\n") {
			row.push(cell);
			rows.push(row);
			row = [];
			cell = "";
			index += 1;
		} else {
			cell += character;
		}
	}
	return rows;
}

function kpiTable(page: Page): Locator {
	return themeCard(page, "stores", "kpis").getByRole("table", {
		name: "Chỉ số của từng cửa hàng và của tất cả cửa hàng",
		exact: true,
	});
}

test("So sánh opens on the last four weeks with every card settled for both stores", async ({
	page,
}) => {
	await openTheme(page, "stores");
	await expect(
		page.getByRole("heading", { level: 1, name: "So sánh cửa hàng" }),
	).toBeVisible();
	expect(themeSearch(page).get("range")).toBe("28d");
	await expect(themeCards(page, "stores")).toHaveCount(
		themeCardIds.stores.length,
	);
	await expectEveryThemeCardSettled(page, "stores");
	for (const id of themeCardIds.stores) {
		const card = themeCard(page, "stores", id);
		await expect(card.getByTestId("headline"), id).toHaveText(/\d/);
		await expect(card.getByTestId("sentence"), id).not.toContainText(NEED_TWO);
	}
	const kpis = themeCard(page, "stores", "kpis");
	await expect(kpis).toContainText("dẫn đầu doanh thu thuần");
	const rows = kpiTable(page).locator("tbody tr");
	await expect(rows).toHaveCount(STORE_NAMES.length + 1);
	await expect(rows.last()).toContainText(ALL_STORES);
	const young = rows.filter({ hasText: STORE_NAMES[1] ?? "" });
	await expect(young.getByText(NOT_SET_UP, { exact: true })).toHaveCount(2);
	await expect(
		rows.filter({ hasText: STORE_NAMES[0] ?? "" }).getByText(NOT_SET_UP),
	).toHaveCount(0);
	await expect(
		kpis.getByTestId("card-notice").getByRole("link"),
	).toHaveAttribute("href", /cai-dat\/cua-hang/);
	const sameDay = themeCard(page, "stores", "same_day");
	await expect(sameDay.getByTestId("sentence")).toContainText(
		"lệch nhau nhiều nhất ngày",
	);
	const since = themeCard(page, "stores", "since_opening");
	await expect(since.getByTestId("sentence")).toContainText(
		"sau khai trương: Cửa hàng mẫu 2 đạt",
	);
	await expect(since).toContainText("của Cửa hàng mẫu 2");
	await expect(since.getByTestId("sentence")).toContainText(
		"có ngày Tết ở một trong hai cửa hàng nên không dùng để so sánh",
	);
	await expect(
		since.getByRole("columnheader", { name: "Sắp xếp theo Tết", exact: true }),
	).toBeVisible();
	await expect(sameDay).toContainText("chênh lệch chỉ số giữa các cửa hàng");
	expectNoConsoleErrors(page);
});

test("the stores' net revenue and invoices in the figures table add up to the all-stores row", async ({
	page,
}) => {
	await openTheme(page, "stores");
	const [header, ...body] = csvRows(await csvTextOf(page, "card-stores-kpis"));
	const column = (label: string) => header?.indexOf(label) ?? -1;
	const net = column("Doanh thu thuần");
	const invoices = column("Hóa đơn");
	expect(net).toBeGreaterThan(0);
	expect(invoices).toBeGreaterThan(0);
	const all = body.find((row) => row[0] === ALL_STORES);
	const stores = body.filter((row) => STORE_NAMES.includes(row[0] ?? ""));
	expect(stores).toHaveLength(STORE_NAMES.length);
	const sum = (index: number) =>
		stores.reduce((total, row) => total + Number(row[index]), 0);
	expect(Number(all?.[net])).toBeGreaterThan(0);
	expect(Number(all?.[net])).toBeCloseTo(sum(net), 2);
	expect(Number(all?.[invoices])).toBe(sum(invoices));
	expect(body.flat()).toContain(NOT_SET_UP);
	expectNoConsoleErrors(page);
});

test("with one store every card asks for a second store and shows no figure", async ({
	page,
}) => {
	await openTheme(page, "stores", "range=28d&store=MOCK-S1");
	await expect(themeCards(page, "stores")).toHaveCount(
		themeCardIds.stores.length,
	);
	await expectEveryThemeCardSettled(page, "stores");
	for (const id of themeCardIds.stores) {
		const card = themeCard(page, "stores", id);
		await expect(card.getByTestId("sentence"), id).toHaveText(NEED_TWO);
		await expect(card.getByTestId("headline"), id).toHaveText("—");
		await expect(card.getByRole("table"), id).toHaveCount(0);
	}
	await checkPage(page);
	expectNoConsoleErrors(page);
});

test("the same-day card switches from days to weeks with the range, and every card settles on each preset", async ({
	page,
}) => {
	await openTheme(page, "stores");
	const days = themeCard(page, "stores", "same_day").getByRole("table", {
		name: "Doanh thu và chỉ số so với mức trung bình của từng cửa hàng",
		exact: true,
	});
	await expect(days.getByRole("columnheader").first()).toContainText("Ngày");
	await choosePreset(page, "13 tuần");
	await expectEveryThemeCardSettled(page, "stores");
	await expect(days.getByRole("columnheader").first()).toContainText("Ngày");
	await choosePreset(page, "52 tuần");
	await expectEveryThemeCardSettled(page, "stores");
	await expect(days.getByRole("columnheader").first()).toContainText("Tuần từ");
	await expect(
		themeCard(page, "stores", "same_day").getByTestId("sentence"),
	).toContainText("tuần từ");
	await choosePreset(page, "Tháng trước");
	await expectEveryThemeCardSettled(page, "stores");
});

test("a custom range survives a reload, steps by its own length and comes back", async ({
	page,
}) => {
	await expectRangeRoundTrip(page, "stores");
});

test("every So sánh table downloads as UTF-8 CSV with a BOM", async ({
	page,
}) => {
	await openTheme(page, "stores");
	const headers: string[] = [];
	for (const id of themeCardIds.stores) {
		headers.push(
			...(await expectCsvTablesWithBom(page, themeCard(page, "stores", id))),
		);
	}
	const text = headers.join(" ");
	for (const label of [
		"Cửa hàng",
		"Doanh thu so với kỳ trước",
		"Doanh thu mỗi ghế mỗi giờ",
		"Chỉ số so với trung bình",
		"Tuần thứ",
		"TB mỗi ngày",
	]) {
		expect(text).toContain(label);
	}
	expectNoConsoleErrors(page);
});

test("So sánh downloads every table semicolon-separated with its exact headers and decimal commas on a device set to that format", async ({
	page,
}) => {
	await chooseSemicolonCsv(page);
	await openTheme(page, "stores");
	const texts: string[] = [];
	for (const id of themeCardIds.stores) {
		texts.push(
			...(await expectSemicolonCsvTables(page, themeCard(page, "stores", id))),
		);
	}
	expectDecimalCommas(texts);
	expectNoConsoleErrors(page);
});

test("So sánh prints without controls, passes axe, fits 360 px, stays local and reads in English", async ({
	page,
}) => {
	watchConsoleErrors(page);
	await page.clock.setFixedTime(REPORT_CLOCK);
	await expectNoExternalRequests(page, async () => {
		await page.goto(themeUrl("stores"));
		await waitForSettledThemeCards(page);
	});
	await waitForCharts(page);
	await expectThemePrintLayout(page);
	await checkPage(page);
	await expectThemeInEnglish(page, "Store comparison");
	expectNoConsoleErrors(page);
});
