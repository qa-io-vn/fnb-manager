import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StoreRow } from "../../data/row-source";
import { createExportReader, type ExportReader } from "../../exports/reader";
import {
	createFakePostgrest,
	type FakePostgrestOptions,
	type FakeStore,
} from "../../exports/testing/fake-postgrest";
import {
	STORE_ONE,
	STORE_TWO,
	syntheticTables,
} from "../../exports/testing/synthetic-data";
import { I18nProvider } from "../../i18n";
import { ExportWorkflow } from "./export-tab";

const NOW = new Date("2026-11-16T03:00:00Z");

const TENANT = {
	id: "33333333-3333-4333-8333-333333333333",
	name: "Quán mẫu",
	currencyCode: "VND",
	timeZone: "Asia/Ho_Chi_Minh",
	countryCode: "VN",
};

function storeRow(store: FakeStore): StoreRow {
	return {
		id: store.id,
		tenantId: TENANT.id,
		name: store.name,
		code: null,
		timeZone: store.timeZone,
		businessDayStartMinutes: store.businessDayStartMinutes,
		posAccountId: "44444444-4444-4444-8444-444444444444",
	};
}

function fakeReader(
	options: Partial<FakePostgrestOptions> = {},
	stores: readonly FakeStore[] = [STORE_ONE, STORE_TWO],
): ExportReader {
	const fake = createFakePostgrest({
		stores,
		tables: syntheticTables({
			stores: [STORE_ONE, STORE_TWO],
			from: "2026-09-29",
			to: "2026-11-16",
			invoicesPerDay: 3,
		}),
		...options,
	});
	return createExportReader(fake.client);
}

function renderWorkflow(
	reader: ExportReader,
	stores: readonly FakeStore[] = [STORE_ONE, STORE_TWO],
	personalAllowed = true,
) {
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	return render(
		<I18nProvider language="vi" onLanguageChange={() => undefined}>
			<QueryClientProvider client={client}>
				<MemoryRouter>
					<ExportWorkflow
						reader={reader}
						tenant={TENANT}
						stores={stores.map(storeRow)}
						defaultStoreIds={stores.map((store) => store.id)}
						personalAllowed={personalAllowed}
						dialect="semicolon"
						now={NOW}
					/>
				</MemoryRouter>
			</QueryClientProvider>
		</I18nProvider>,
	);
}

async function formReady() {
	await waitFor(() =>
		expect(screen.getByRole("button", { name: "Xuất dữ liệu" })).toBeEnabled(),
	);
}

describe("the export form", () => {
	beforeEach(() => {
		URL.createObjectURL = vi.fn(() => "blob:fnb-export");
		URL.revokeObjectURL = vi.fn();
	});

	afterEach(() => {
		window.localStorage.clear();
	});

	it("starts with the top bar's stores, every table, CSV and the last complete month", async () => {
		renderWorkflow(fakeReader());
		await formReady();
		expect(
			screen.getByRole("checkbox", { name: STORE_ONE.name }),
		).toBeChecked();
		expect(
			screen.getByRole("checkbox", { name: STORE_TWO.name }),
		).toBeChecked();
		for (const name of [
			"Hóa đơn",
			"Dòng hóa đơn",
			"Thanh toán",
			"Ca",
			"Tổng hợp ngày",
		]) {
			expect(screen.getByRole("checkbox", { name })).toBeChecked();
		}
		expect(
			screen.getByRole("radio", {
				name: "CSV (dấu chấm phẩy, dấu phẩy thập phân)",
			}),
		).toBeChecked();
		expect(
			screen.getByRole("link", { name: /Ngưỡng báo cáo/ }),
		).toHaveAttribute("href", "/cai-dat/bao-cao");
		expect(screen.getByLabelText("Từ tháng")).toHaveValue("2026-10");
		expect(screen.getByLabelText("Đến tháng")).toHaveValue("2026-10");
		expect(
			within(screen.getByLabelText("Từ tháng"))
				.getAllByRole("option")
				.map((option) => option.textContent),
		).toEqual([
			"Tháng 8/2026",
			"Tháng 9/2026",
			"Tháng 10/2026",
			"Tháng 11/2026",
		]);
		expect(
			screen.getByRole("checkbox", { name: "Kèm thông tin cá nhân" }),
		).not.toBeChecked();
	});

	it("refuses more than twelve months with the spec's message", async () => {
		const user = userEvent.setup();
		const early: FakeStore = { ...STORE_ONE, historyStart: "2025-01-10" };
		renderWorkflow(fakeReader({}, [early, STORE_TWO]), [early, STORE_TWO]);
		await formReady();
		await user.selectOptions(screen.getByLabelText("Từ tháng"), "2025-10");
		await user.selectOptions(screen.getByLabelText("Đến tháng"), "2026-10");
		expect(screen.getByTestId("export-plan-error")).toHaveTextContent(
			"Tối đa 12 tháng mỗi lần xuất",
		);
		expect(screen.getByRole("button", { name: "Xuất dữ liệu" })).toBeDisabled();
		expect(screen.getByRole("button", { name: "Ước tính" })).toBeDisabled();
		await user.selectOptions(screen.getByLabelText("Từ tháng"), "2025-11");
		expect(screen.queryByTestId("export-plan-error")).toBeNull();
		expect(screen.getByRole("button", { name: "Xuất dữ liệu" })).toBeEnabled();
	});

	it("asks for a store, a table and months in order", async () => {
		const user = userEvent.setup();
		renderWorkflow(fakeReader());
		await formReady();
		await user.selectOptions(screen.getByLabelText("Từ tháng"), "2026-11");
		expect(screen.getByTestId("export-plan-error")).toHaveTextContent(
			"Tháng bắt đầu phải trước hoặc trùng tháng kết thúc.",
		);
		await user.selectOptions(screen.getByLabelText("Từ tháng"), "2026-10");
		for (const name of [
			"Hóa đơn",
			"Dòng hóa đơn",
			"Thanh toán",
			"Ca",
			"Tổng hợp ngày",
		]) {
			await user.click(screen.getByRole("checkbox", { name }));
		}
		expect(screen.getByTestId("export-plan-error")).toHaveTextContent(
			"Chọn ít nhất một bảng dữ liệu.",
		);
		await user.click(screen.getByRole("checkbox", { name: "Ca" }));
		await user.click(screen.getByRole("checkbox", { name: STORE_ONE.name }));
		await user.click(screen.getByRole("checkbox", { name: STORE_TWO.name }));
		expect(screen.getByTestId("export-plan-error")).toHaveTextContent(
			"Chọn ít nhất một cửa hàng.",
		);
	});

	it("estimates the transfer from the database's counts", async () => {
		const user = userEvent.setup();
		renderWorkflow(fakeReader());
		await formReady();
		await user.click(screen.getByRole("button", { name: "Ước tính" }));
		expect(
			await screen.findByTestId("exports-estimate-summary"),
		).toHaveTextContent(
			/^Ước tính khoảng [\d,]+ MB dữ liệu truyền tải \(gói Free: 5 GB mỗi tháng\)$/,
		);
		const estimate = screen.getByTestId("exports-estimate");
		expect(estimate).toHaveTextContent("Tháng 10/2026 · S1: 93 hóa đơn");
		expect(estimate).toHaveTextContent("Tổng hợp ngày: 93 dòng");
	});

	it("asks before an export estimated above 100 MB and can step back", async () => {
		const user = userEvent.setup();
		renderWorkflow(
			fakeReader({
				controlTotalsOverride: (row) => ({ ...row, lines: 200_000 }),
			}),
		);
		await formReady();
		await user.click(screen.getByRole("button", { name: "Xuất dữ liệu" }));
		const confirm = await screen.findByTestId("exports-confirm");
		expect(confirm).toHaveTextContent(
			"Lần xuất này ước tính hơn 100 MB. Vẫn xuất?",
		);
		await user.click(within(confirm).getByRole("button", { name: "Thôi" }));
		expect(screen.queryByTestId("exports-confirm")).toBeNull();
		expect(screen.getByTestId("exports-estimate")).toBeInTheDocument();
	});

	it("exports, shows one verification line per store-month and the bytes received", async () => {
		const user = userEvent.setup();
		renderWorkflow(fakeReader());
		await formReady();
		await user.click(
			screen.getByRole("checkbox", { name: "Kèm thông tin cá nhân" }),
		);
		await user.click(screen.getByRole("button", { name: "Xuất dữ liệu" }));
		const result = await screen.findByTestId("export-result");
		expect(
			within(result).getByRole("link", {
				name: "Tải fnb-xuat-du-lieu_2026-10_2026-10.zip",
			}),
		).toHaveAttribute("download", "fnb-xuat-du-lieu_2026-10_2026-10.zip");
		const lines = within(screen.getByTestId("export-checks")).getAllByRole(
			"listitem",
		);
		expect(lines.map((line) => line.textContent)).toEqual([
			expect.stringMatching(
				/^Tháng 10\/2026 · S1 · Đã đối chiếu với cơ sở dữ liệu: 93 hóa đơn · [\d.]+ dòng · [\d.]+ thanh toán · 62 ca — khớp$/,
			),
			expect.stringMatching(
				/^Tháng 10\/2026 · S2 · Đã đối chiếu với cơ sở dữ liệu: /,
			),
			"Tháng 10/2026 · S1 · Tổng hợp ngày khớp hóa đơn",
			"Tháng 10/2026 · S2 · Tổng hợp ngày khớp hóa đơn",
		]);
		expect(screen.getByTestId("export-received")).toHaveTextContent(
			/^Đã nhận [\d,]+ MB \(chưa nén\)$/,
		);
		expect(screen.getByTestId("exports-tally")).toHaveTextContent(
			/^Đã xuất tháng này khoảng [\d,]+ MB \(trên thiết bị này\)$/,
		);
		await user.click(screen.getByRole("button", { name: "Xuất lần khác" }));
		expect(
			await screen.findByRole("checkbox", { name: "Kèm thông tin cá nhân" }),
		).not.toBeChecked();
	});

	it("says when data changed during the export and keeps the archive", async () => {
		const user = userEvent.setup();
		let moving = 0;
		renderWorkflow(
			fakeReader({
				beforeRpc: (name, _index, tables) => {
					if (name !== "export_control_totals") return;
					moving += 1;
					const template = tables.invoices.find(
						(row) =>
							row.store_id === STORE_ONE.id &&
							row.business_date === "2026-10-04",
					);
					if (template) {
						tables.invoices.push({
							...template,
							id: `00000000-0000-4000-8000-${String(moving).padStart(12, "0")}`,
						});
					}
				},
			}),
			[STORE_ONE],
		);
		await formReady();
		await user.click(screen.getByRole("button", { name: "Xuất dữ liệu" }));
		const result = await screen.findByTestId("export-result");
		expect(within(result).getByTestId("export-checks")).toHaveTextContent(
			"Tháng 10/2026 · S1 · Dữ liệu thay đổi trong lúc xuất; thử lại sau ít phút",
		);
		expect(within(result).getByTestId("export-download")).toBeInTheDocument();
	});

	it("stops an export with Dừng", async () => {
		const user = userEvent.setup();
		const base = fakeReader();
		let release: () => void = () => undefined;
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		const reader: ExportReader = {
			...base,
			async page(request) {
				await gate;
				return base.page(request);
			},
		};
		renderWorkflow(reader);
		await formReady();
		await user.click(screen.getByRole("button", { name: "Xuất dữ liệu" }));
		await user.click(await screen.findByRole("button", { name: "Dừng" }));
		release();
		expect(await screen.findByTestId("exports-stopped")).toHaveTextContent(
			"Đã dừng xuất dữ liệu.",
		);
	});
});
