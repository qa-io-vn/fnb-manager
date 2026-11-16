import { DemoSettingsStore } from "@fnb/demo-analytics";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
	fireEvent,
	render,
	screen,
	waitFor,
	within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../i18n";
import { createDemoSettingsSource } from "../demo-settings-source";
import {
	type FeeRateRow,
	type Membership,
	type PaymentMethodEntry,
	type SettingsSource,
	SettingsWriteError,
} from "../source";
import { FEE_FIXED_MAX, feeFixedAmount, issueOf } from "../validation";
import {
	defaultFeeScope,
	feeGroupsOf,
	feeMethodsOf,
	rateDateHintOf,
	rateHistoryOf,
	withSavedFeeRates,
} from "./fees";
import { FeesTab } from "./fees-tab";

const NOW = new Date("2026-11-04T05:30:00.000Z");
const TODAY = "2026-11-04";
const FIRST_DAY = "2023-01-01";
const TIME_ZONE = "Asia/Ho_Chi_Minh";
const STORE = "MOCK-S1";
const OTHER_STORE = "MOCK-S2";
const WHOLE_HISTORY = "Áp dụng cho toàn bộ lịch sử bán.";
const KEEPS_EARLIER = "Từ ngày này trở đi; các ngày trước giữ mức phí cũ.";
const CATCH_UP_NOTE =
	"Ước tính phí của các ngày đã qua sẽ được tính lại theo mức phí này.";
const PERCENT_LABEL = /^Tỷ lệ phí mới cho /;
const FIXED_LABEL = /^Phí cố định mỗi lần cho /;
const DATE_LABEL = /^Áp dụng từ ngày cho /;

const TENANT = {
	id: "33333333-3333-4333-8333-333333333333",
	name: "Quán mẫu",
	currencyCode: "VND",
	timeZone: TIME_ZONE,
	countryCode: "VN",
};

const STORES = [
	{
		id: STORE,
		tenantId: TENANT.id,
		name: "Cửa hàng một",
		code: null,
		timeZone: TIME_ZONE,
		businessDayStartMinutes: 0,
		posAccountId: "ACC-1",
	},
	{
		id: OTHER_STORE,
		tenantId: TENANT.id,
		name: "Cửa hàng hai",
		code: null,
		timeZone: TIME_ZONE,
		businessDayStartMinutes: 0,
		posAccountId: "ACC-2",
	},
];

function method(
	posAccountId: string,
	externalId: string,
	name: string,
	kind: PaymentMethodEntry["kind"],
): PaymentMethodEntry {
	return {
		posAccountId,
		posAccountName: `POS ${posAccountId}`,
		externalId,
		name,
		posKind: kind,
		overrideKind: null,
		kind,
		audit: null,
	};
}

const METHODS: readonly PaymentMethodEntry[] = [
	method("ACC-1", "QR", "Ví QR", "ewallet"),
	method("ACC-1", "CASH", "Tiền mặt", "cash"),
	method("ACC-1", "CARD", "Thẻ", "card"),
	method("ACC-2", "CASH", "Tiền mặt", "cash"),
	method("ACC-2", "BANK", "Chuyển khoản", "bank_transfer"),
];

const current = vi.hoisted(() => ({
	state: { status: "loading" } as unknown,
	catchUpStarts: 0,
}));

vi.mock("../../state/tenant-scope", () => ({
	useReadyTenantScope: () => ({ tenant: TENANT, stores: STORES }),
}));

vi.mock("../settings-source-context", () => ({
	useSettingsSourceState: () => current.state,
	useRetrySettingsSource: () => () => undefined,
}));

vi.mock("../catch-up/catch-up-context", () => ({
	useCatchUpRunner: () => ({
		running: false,
		problem: null,
		completed: false,
		start: () => {
			current.catchUpStarts += 1;
		},
		abort: () => undefined,
		dismiss: () => undefined,
	}),
}));

const OWNER: Membership = { role: "owner", storeIds: null };

function renderTab(
	store: DemoSettingsStore,
	{
		membership = OWNER,
		saveFeeRates,
	}: {
		membership?: Membership;
		saveFeeRates?: SettingsSource["saveFeeRates"];
	} = {},
) {
	const demo = createDemoSettingsSource(store);
	current.state = {
		status: "ready",
		source: {
			...demo,
			membership: async () => membership,
			paymentMethods: async () => [...METHODS],
			...(saveFeeRates === undefined ? {} : { saveFeeRates }),
		},
		manual: null,
	};
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	return render(
		<I18nProvider language="vi" onLanguageChange={() => undefined}>
			<QueryClientProvider client={client}>
				<FeesTab />
			</QueryClientProvider>
		</I18nProvider>,
	);
}

async function rowOf(methodId: string): Promise<HTMLElement> {
	return waitFor(() => {
		const row = screen
			.getAllByTestId("fee-row")
			.find((candidate) => candidate.dataset.method === methodId);
		if (row === undefined) throw new Error(`no row for ${methodId}`);
		return row;
	});
}

function percentInput(row: HTMLElement): HTMLElement {
	return within(row).getByLabelText(PERCENT_LABEL);
}

function fixedInput(row: HTMLElement): HTMLElement {
	return within(row).getByLabelText(FIXED_LABEL);
}

function dateInput(row: HTMLElement): HTMLElement {
	return within(row).getByLabelText(DATE_LABEL);
}

function type(input: HTMLElement, text: string): void {
	fireEvent.change(input, { target: { value: text } });
}

async function save(): Promise<void> {
	await userEvent.click(screen.getByRole("button", { name: "Lưu" }));
	await waitFor(() =>
		expect(screen.getByTestId("settings-save-bar-status")).toHaveTextContent(
			"Đã lưu.",
		),
	);
}

function ratesOf(store: DemoSettingsStore) {
	return store.feeRates().map((rate) => ({ ...rate }));
}

describe("the Phí thanh toán tab", () => {
	beforeEach(() => {
		vi.useFakeTimers({ toFake: ["Date"], now: NOW });
		current.catchUpStarts = 0;
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("groups the methods of every POS account by kind, each method once, and a store lists its own account's methods", async () => {
		const user = userEvent.setup({ delay: null });
		renderTab(new DemoSettingsStore());
		await rowOf("QR");
		const kinds = () =>
			screen.getAllByTestId("fee-kind").map((section) => ({
				kind: section.dataset.kind,
				heading: within(section).getByRole("heading", { level: 3 }).textContent,
				methods: within(section)
					.getAllByTestId("fee-row")
					.map((row) => row.dataset.method),
			}));
		expect(kinds()).toEqual([
			{ kind: "cash", heading: "Tiền mặt", methods: ["CASH"] },
			{ kind: "ewallet", heading: "Ví điện tử", methods: ["QR"] },
			{ kind: "bank_transfer", heading: "Chuyển khoản", methods: ["BANK"] },
			{ kind: "card", heading: "Thẻ", methods: ["CARD"] },
		]);
		expect(screen.getByLabelText("Áp dụng cho")).toHaveValue("all");
		await user.selectOptions(screen.getByLabelText("Áp dụng cho"), OTHER_STORE);
		await waitFor(() =>
			expect(
				screen.getAllByTestId("fee-row").map((row) => row.dataset.method),
			).toEqual(["CASH", "BANK"]),
		);
	});

	it("dates a method's first rate 01/01/2023 and a later one today, keeping the earlier days, and starts the catch-up after each save", async () => {
		const store = new DemoSettingsStore();
		renderTab(store);
		const row = await rowOf("QR");
		expect(within(row).getByTestId("fee-current")).toHaveTextContent(
			"Chưa có mức phí.",
		);
		expect(dateInput(row)).toHaveValue(FIRST_DAY);
		expect(dateInput(row)).toHaveAccessibleDescription(WHOLE_HISTORY);
		expect(percentInput(row)).toHaveAttribute("inputmode", "decimal");
		type(percentInput(row), "1,1");
		expect(screen.queryByTestId("fees-catch-up-note")).toBeNull();
		await save();
		expect(ratesOf(store)).toEqual([
			{
				storeId: null,
				paymentMethodExternalId: "QR",
				feePct: 1.1,
				fixedFeeAmount: 0,
				effectiveFrom: FIRST_DAY,
			},
		]);
		expect(current.catchUpStarts).toBe(1);
		expect(screen.getByTestId("fees-catch-up-note")).toHaveTextContent(
			CATCH_UP_NOTE,
		);
		expect(within(row).getByTestId("fee-current")).toHaveTextContent(
			"Phí hôm nay: 1,1%, từ 01/01/2023",
		);
		expect(percentInput(row)).toHaveValue("");
		expect(dateInput(row)).toHaveValue(TODAY);
		expect(dateInput(row)).toHaveAccessibleDescription(KEEPS_EARLIER);
		type(percentInput(row), "1,5");
		type(fixedInput(row), "1000");
		await save();
		expect(current.catchUpStarts).toBe(2);
		expect(ratesOf(store)).toEqual([
			{
				storeId: null,
				paymentMethodExternalId: "QR",
				feePct: 1.1,
				fixedFeeAmount: 0,
				effectiveFrom: FIRST_DAY,
			},
			{
				storeId: null,
				paymentMethodExternalId: "QR",
				feePct: 1.5,
				fixedFeeAmount: 1_000,
				effectiveFrom: TODAY,
			},
		]);
		expect(within(row).getByTestId("fee-current")).toHaveTextContent(
			"Phí hôm nay: 1,5% cộng 1.000 ₫ mỗi lần thanh toán, từ 04/11/2026",
		);
		await userEvent.click(within(row).getByTestId("fee-history-toggle"));
		const history = within(row).getAllByTestId("fee-history-row");
		expect(history).toHaveLength(2);
		expect(history[0]).toHaveTextContent(
			"Từ 04/11/2026: 1,5% cộng 1.000 ₫ mỗi lần thanh toán · đang áp dụng",
		);
		expect(history[1]).toHaveTextContent("Từ 01/01/2023: 1,1%");
		expect(history[1]).not.toHaveTextContent("đang áp dụng");
		type(dateInput(row), FIRST_DAY);
		expect(dateInput(row)).toHaveAccessibleDescription(
			"Thay mức phí đang có từ đúng ngày này.",
		);
		type(dateInput(row), "2025-06-01");
		expect(dateInput(row)).toHaveAccessibleDescription(
			"Từ ngày này đến hết 03/11/2026; các ngày trước giữ mức phí cũ.",
		);
	});

	it("refuses a 21 % fee, more than three decimals, a fixed fee above 100.000 ₫ or with a fraction, and a fixed fee without a rate, sending nothing", async () => {
		const saveFeeRates = vi.fn();
		renderTab(new DemoSettingsStore(), { saveFeeRates });
		const row = await rowOf("QR");
		const errors = () =>
			within(row)
				.queryAllByTestId("settings-field-error")
				.map((error) => (error.textContent ?? "").replace(/\s+/g, " "));
		type(percentInput(row), "21");
		expect(errors()).toEqual(["Nhập giá trị từ 0% đến 20%."]);
		type(percentInput(row), "1,1255");
		expect(errors()).toEqual(["Chỉ nhập tối đa 3 chữ số sau dấu phẩy."]);
		type(percentInput(row), "-1");
		expect(errors()).toEqual(["Nhập giá trị từ 0% đến 20%."]);
		type(percentInput(row), "20");
		type(fixedInput(row), "100001");
		expect(errors()).toEqual(["Nhập giá trị không quá 100.000 ₫."]);
		type(fixedInput(row), "1500,5");
		expect(errors()).toEqual(["Nhập số tiền chẵn đồng, không có phần lẻ."]);
		type(percentInput(row), "");
		type(fixedInput(row), "1000");
		expect(errors()).toEqual(["Ô này không được để trống."]);
		expect(screen.getByTestId("settings-save")).toHaveAttribute(
			"aria-disabled",
			"true",
		);
		expect(screen.getByLabelText("Áp dụng cho")).toBeDisabled();
		fireEvent.click(screen.getByTestId("settings-save"));
		expect(saveFeeRates).not.toHaveBeenCalled();
		expect(current.catchUpStarts).toBe(0);
		await userEvent.click(screen.getByTestId("settings-cancel"));
		expect(errors()).toEqual([]);
		expect(screen.getByLabelText("Áp dụng cho")).toBeEnabled();
	});

	it("shows a store the rate for all stores until its own, dated today by default, and says when dating it back replaces the shared rate", async () => {
		const user = userEvent.setup({ delay: null });
		const store = new DemoSettingsStore();
		store.saveFeeRates([
			{
				storeId: null,
				paymentMethodExternalId: "CASH",
				feePct: 0.5,
				fixedFeeAmount: 0,
				effectiveFrom: FIRST_DAY,
			},
		]);
		renderTab(store);
		await rowOf("CASH");
		await user.selectOptions(screen.getByLabelText("Áp dụng cho"), STORE);
		const row = await rowOf("CASH");
		expect(within(row).getByTestId("fee-current")).toHaveTextContent(
			"Phí hôm nay: 0,5%, từ 01/01/2023, theo Tất cả cửa hàng",
		);
		expect(dateInput(row)).toHaveValue(TODAY);
		expect(dateInput(row)).toHaveAccessibleDescription(
			"Từ ngày này trở đi; các ngày trước giữ mức phí chung.",
		);
		type(dateInput(row), FIRST_DAY);
		expect(dateInput(row)).toHaveAccessibleDescription(
			"Thay mức phí chung ở cửa hàng này từ ngày này trở đi, kể cả các ngày đã qua.",
		);
		type(percentInput(row), "0,8");
		await save();
		expect(ratesOf(store).at(-1)).toEqual({
			storeId: STORE,
			paymentMethodExternalId: "CASH",
			feePct: 0.8,
			fixedFeeAmount: 0,
			effectiveFrom: FIRST_DAY,
		});
		expect(within(row).getByTestId("fee-current")).toHaveTextContent(
			"Phí hôm nay: 0,8%, từ 01/01/2023",
		);
		expect(within(row).getByTestId("fee-current")).not.toHaveTextContent(
			"theo Tất cả cửa hàng",
		);
	});

	it("opens a store-limited manager on their store and shows the rates for all stores read-only", async () => {
		const user = userEvent.setup({ delay: null });
		const store = new DemoSettingsStore();
		store.saveFeeRates([
			{
				storeId: null,
				paymentMethodExternalId: "QR",
				feePct: 1.1,
				fixedFeeAmount: 0,
				effectiveFrom: FIRST_DAY,
			},
		]);
		renderTab(store, { membership: { role: "manager", storeIds: [STORE] } });
		await waitFor(() =>
			expect(screen.getByLabelText("Áp dụng cho")).toHaveValue(STORE),
		);
		expect(percentInput(await rowOf("QR"))).toBeInTheDocument();
		await user.selectOptions(screen.getByLabelText("Áp dụng cho"), "all");
		await waitFor(() =>
			expect(screen.getByTestId("settings-read-only")).toHaveTextContent(
				"Mức phí cho tất cả cửa hàng chỉ chủ hoặc quản lý xem được tất cả cửa hàng mới sửa được",
			),
		);
		const shared = await rowOf("QR");
		expect(within(shared).getByTestId("fee-current")).toHaveTextContent(
			"Phí hôm nay: 1,1%, từ 01/01/2023",
		);
		expect(within(shared).queryByLabelText(PERCENT_LABEL)).toBeNull();
		expect(screen.queryByTestId("settings-save-bar")).toBeNull();
	});

	it("names each field after its method, announces the catch-up note and words the database's limit refusal", async () => {
		const store = new DemoSettingsStore();
		const demo = createDemoSettingsSource(store);
		let refuse = true;
		const saveFeeRates = vi.fn(
			(tenantId: string, rows: Parameters<typeof demo.saveFeeRates>[1]) => {
				if (refuse) {
					refuse = false;
					return Promise.reject(
						new SettingsWriteError(
							"invalid",
							"payment_fee_rates_within_limits",
						),
					);
				}
				return demo.saveFeeRates(tenantId, rows);
			},
		);
		renderTab(store, { saveFeeRates });
		const row = await rowOf("QR");
		expect(
			within(row).getByRole("textbox", { name: "Tỷ lệ phí mới cho Ví QR" }),
		).toBeInTheDocument();
		expect(
			within(row).getByRole("textbox", {
				name: "Phí cố định mỗi lần cho Ví QR",
			}),
		).toBeInTheDocument();
		expect(
			within(row).getByLabelText("Áp dụng từ ngày cho Ví QR"),
		).toBeInTheDocument();
		type(percentInput(row), "1");
		await userEvent.click(screen.getByRole("button", { name: "Lưu" }));
		await waitFor(() =>
			expect(screen.getByTestId("settings-save-bar-status")).toHaveTextContent(
				"Không lưu được: tỷ lệ phí phải từ 0% đến 20% và phí cố định là số đồng chẵn từ 0 đến 100.000 ₫.",
			),
		);
		expect(current.catchUpStarts).toBe(0);
		type(percentInput(row), "1,5");
		await save();
		expect(screen.getByTestId("fees-catch-up-note")).toHaveAttribute(
			"role",
			"status",
		);
		expect(current.catchUpStarts).toBe(1);
	});

	it("shows staff every rate read-only with no field or save bar", async () => {
		renderTab(new DemoSettingsStore(), {
			membership: { role: "staff", storeIds: null },
		});
		await waitFor(() =>
			expect(screen.getByTestId("settings-read-only")).toHaveTextContent(
				"Chỉ chủ và quản lý mới nhập được dữ liệu này",
			),
		);
		await rowOf("QR");
		expect(screen.queryByLabelText(PERCENT_LABEL)).toBeNull();
		expect(screen.queryByTestId("settings-save-bar")).toBeNull();
	});

	it("keeps the typed rate after a lost connection, starts no catch-up, and sends the same rows again on Thử lại", async () => {
		const store = new DemoSettingsStore();
		const demo = createDemoSettingsSource(store);
		let fail = true;
		const saveFeeRates = vi.fn(
			(tenantId: string, rows: Parameters<typeof demo.saveFeeRates>[1]) => {
				if (fail) {
					fail = false;
					return Promise.reject(new SettingsWriteError("network"));
				}
				return demo.saveFeeRates(tenantId, rows);
			},
		);
		renderTab(store, { saveFeeRates });
		const row = await rowOf("BANK");
		type(percentInput(row), "0,3");
		await userEvent.click(screen.getByRole("button", { name: "Lưu" }));
		const retry = await screen.findByTestId("settings-retry-save");
		expect(current.catchUpStarts).toBe(0);
		expect(screen.queryByTestId("fees-catch-up-note")).toBeNull();
		expect(percentInput(row)).toHaveValue("0,3");
		await userEvent.click(retry);
		await waitFor(() =>
			expect(within(row).getByTestId("fee-current")).toHaveTextContent(
				"Phí hôm nay: 0,3%, từ 01/01/2023",
			),
		);
		expect(saveFeeRates.mock.calls.map((call) => call[1])).toEqual([
			[
				{
					storeId: null,
					paymentMethodExternalId: "BANK",
					feePct: 0.3,
					fixedFeeAmount: 0,
					effectiveFrom: FIRST_DAY,
				},
			],
			[
				{
					storeId: null,
					paymentMethodExternalId: "BANK",
					feePct: 0.3,
					fixedFeeAmount: 0,
					effectiveFrom: FIRST_DAY,
				},
			],
		]);
		expect(current.catchUpStarts).toBe(1);
	});
});

describe("the fee helpers", () => {
	function rate(
		storeId: string | null,
		effectiveFrom: string,
		feePct = 1,
	): FeeRateRow {
		return {
			id: `${storeId}-${effectiveFrom}`,
			storeId,
			paymentMethodExternalId: "QR",
			feePct,
			fixedFeeAmount: 0,
			effectiveFrom,
			audit: null,
		};
	}

	it("keeps methods that only have a rate under Khác and orders a group by name", () => {
		const methods = feeMethodsOf(METHODS, "ACC-1", ["QR", "OLD"]);
		expect(methods.map((each) => each.externalId)).toEqual([
			"QR",
			"CASH",
			"CARD",
			"OLD",
		]);
		expect(feeGroupsOf(methods).map((group) => group.kind)).toEqual([
			"cash",
			"ewallet",
			"card",
			"other",
		]);
	});

	it("opens store-limited owners and managers on their store and everyone else on all stores", () => {
		expect(defaultFeeScope(OWNER, STORES)).toBeNull();
		expect(
			defaultFeeScope({ role: "owner", storeIds: [OTHER_STORE] }, STORES),
		).toBe(OTHER_STORE);
		expect(
			defaultFeeScope({ role: "viewer", storeIds: [OTHER_STORE] }, STORES),
		).toBeNull();
	});

	it("names the last day a rate covers before a later rate and a store's first own rate after a shared one", () => {
		const rows = [rate(null, FIRST_DAY), rate(null, "2026-06-01")];
		expect(
			rateDateHintOf(rateHistoryOf(rows, null, "QR"), "2025-01-01", TODAY),
		).toEqual({ kind: "keepsEarlier", until: "2026-05-31" });
		expect(
			rateDateHintOf(rateHistoryOf(rows, STORE, "QR"), TODAY, TODAY),
		).toEqual({ kind: "keepsShared", until: null });
		expect(
			rateDateHintOf(rateHistoryOf([], STORE, "QR"), FIRST_DAY, TODAY),
		).toEqual({ kind: "wholeHistory", until: null });
		const replaced = { ...rate(null, FIRST_DAY), feePct: 2 };
		expect(withSavedFeeRates(rows, [replaced])).toEqual([replaced, rows[1]]);
	});

	it("has the demo refuse what payment_fee_rates_within_limits refuses, under that name", async () => {
		const demo = createDemoSettingsSource(new DemoSettingsStore());
		const rate = {
			storeId: null,
			paymentMethodExternalId: "QR",
			feePct: 20,
			fixedFeeAmount: 100_000,
			effectiveFrom: FIRST_DAY,
		};
		await expect(demo.saveFeeRates(TENANT.id, [rate])).resolves.toHaveLength(1);
		for (const refused of [
			{ ...rate, feePct: 21 },
			{ ...rate, fixedFeeAmount: 100_001 },
			{ ...rate, fixedFeeAmount: 150.5 },
		]) {
			await expect(
				demo.saveFeeRates(TENANT.id, [refused]),
			).rejects.toMatchObject({
				code: "invalid",
				constraint: "payment_fee_rates_within_limits",
			});
		}
	});

	it("checks a fixed fee from 0 to 100,000 in whole đồng", () => {
		const schema = feeFixedAmount(0);
		expect(FEE_FIXED_MAX).toBe(100_000);
		expect(issueOf(schema, 0)).toBeNull();
		expect(issueOf(schema, FEE_FIXED_MAX)).toBeNull();
		expect(issueOf(schema, FEE_FIXED_MAX + 1)).toEqual({
			key: "atMost",
			max: FEE_FIXED_MAX,
		});
		expect(issueOf(schema, -1)).toEqual({ key: "atLeast", min: 0 });
		expect(issueOf(schema, 0.5)).toEqual({ key: "wholeMoney" });
	});
});
