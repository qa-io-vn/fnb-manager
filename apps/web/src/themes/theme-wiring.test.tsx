import {
	COMPARATOR_PARAM,
	LIFT_CALL_KEY,
	PROMOTION_PARAM,
	PROMOTIONS_W92_CALL_KEY,
	promotionParams,
	rangeOfPreset,
	type ThemeDefinition,
	themeDefinitions,
} from "@fnb/reports";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
	act,
	fireEvent,
	render,
	renderHook,
	screen,
	waitFor,
	within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import {
	MemoryRouter,
	useLocation,
	useNavigate,
	useNavigationType,
} from "react-router-dom";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../i18n";
import type { CatchUpStatus } from "../settings/source";
import { PREFERENCES_KEY, PreferencesProvider } from "../state/preferences";
import { ThemePage } from "./theme-page";
import { useThemeContext } from "./use-theme-context";

const STORE = {
	id: "store-1",
	tenantId: "tenant-1",
	name: "Cửa hàng mẫu 1",
	code: "S1",
	timeZone: "Asia/Ho_Chi_Minh",
	businessDayStartMinutes: 0,
	posAccountId: "account-1",
};

const TENANT = {
	id: "tenant-1",
	name: "Quán mẫu",
	currencyCode: "VND",
	timeZone: "Asia/Ho_Chi_Minh",
	countryCode: "VN",
};

const PENDING: CatchUpStatus = {
	inputsChangedAt: "2026-11-14T17:30:00Z",
	pendingFrom: "2026-05-01",
	pendingTo: "2026-11-15",
	pendingDays: 199,
	canRefresh: true,
};

const current = vi.hoisted(() => ({
	status: undefined as unknown,
	pendingDays: 0,
}));

vi.mock("../state/tenant-scope", async (importOriginal) => ({
	...(await importOriginal<typeof import("../state/tenant-scope")>()),
	useReadyTenantScope: () => ({
		status: "ready",
		tenant: TENANT,
		stores: [STORE],
		selectedStores: [STORE],
		allStoresSelected: true,
		selectStores: () => undefined,
		source: { kind: "demo" },
	}),
}));

vi.mock("../settings/queries", () => ({
	useCatchUpStatus: () => ({ data: current.status }),
}));

vi.mock("../settings/catch-up/use-analytics-catch-up", () => ({
	useAnalyticsCatchUp: () => ({
		status: current.status ?? null,
		pendingDays: current.pendingDays,
		running: false,
		problem: null,
		completed: false,
		start: () => undefined,
		abort: () => undefined,
		dismiss: () => undefined,
	}),
}));

const loaded = vi.hoisted(() => ({
	cards: [] as unknown[],
	rows: {} as Record<string, readonly unknown[]>,
}));

vi.mock("./use-theme-load", () => ({
	useThemeLoad: () => ({
		failed: false,
		cards: loaded.cards,
		retry: () => undefined,
		answered: { rows: (key: string) => loaded.rows[key] },
	}),
}));

function paymentsTheme(): ThemeDefinition {
	const definition = themeDefinitions.payments;
	if (definition === undefined)
		throw new Error("the payments theme is missing");
	return definition;
}

const probed = { search: "", navigation: "" };

function AddressProbe() {
	probed.search = useLocation().search;
	probed.navigation = useNavigationType();
	return null;
}

const PROMOTION_ROWS = [
	{
		promotion_kind: "bill",
		promotion_key: "unnamed",
		promotion_name: null,
		discount_amount: 90_000,
	},
	{
		promotion_kind: "item",
		promotion_key: "KM-01",
		promotion_name: "Mua 2 tặng 1",
		discount_amount: 410_000,
	},
];

function withPromotionParams(): ThemeDefinition {
	return { ...paymentsTheme(), params: promotionParams };
}

function wrapper({ children }: { children: ReactNode }) {
	return (
		<MemoryRouter initialEntries={["/chu-de/thanh-toan"]}>
			<I18nProvider language="vi" onLanguageChange={() => undefined}>
				<QueryClientProvider client={new QueryClient()}>
					<PreferencesProvider>{children}</PreferencesProvider>
				</QueryClientProvider>
			</I18nProvider>
		</MemoryRouter>
	);
}

describe("the catch-up on a theme page", () => {
	beforeAll(() => {
		Element.prototype.scrollIntoView = () => undefined;
	});

	beforeEach(() => {
		current.status = undefined;
		current.pendingDays = 0;
		window.localStorage.clear();
	});

	it("hands the cards the pending range, and nothing while none is known or pending", () => {
		const { result, rerender } = renderHook(
			() => useThemeContext(paymentsTheme()),
			{ wrapper },
		);
		expect(result.current.context.catchUpPending).toBeNull();
		current.status = PENDING;
		rerender();
		expect(result.current.context.catchUpPending).toEqual({
			from: "2026-05-01",
			to: "2026-11-15",
		});
		current.status = { ...PENDING, pendingFrom: null, pendingTo: null };
		rerender();
		expect(result.current.context.catchUpPending).toBeNull();
	});

	it("shows the banner above the cards while days are pending, and not otherwise", () => {
		const { unmount } = render(<ThemePage definition={paymentsTheme()} />, {
			wrapper,
		});
		expect(screen.queryByTestId("catch-up-banner")).toBeNull();
		unmount();
		current.status = PENDING;
		current.pendingDays = 198;
		render(<ThemePage definition={paymentsTheme()} />, { wrapper });
		expect(screen.getByTestId("catch-up-banner")).toHaveTextContent(
			"còn 198 ngày",
		);
		expect(
			screen
				.getByTestId("catch-up-banner")
				.compareDocumentPosition(screen.getByTestId("report-cards")) &
				Node.DOCUMENT_POSITION_FOLLOWING,
		).toBeTruthy();
	});
});

function wrapperAt(entry: string) {
	return ({ children }: { children: ReactNode }) => (
		<MemoryRouter initialEntries={[entry]}>
			<I18nProvider language="vi" onLanguageChange={() => undefined}>
				<QueryClientProvider client={new QueryClient()}>
					<PreferencesProvider>{children}</PreferencesProvider>
				</QueryClientProvider>
			</I18nProvider>
		</MemoryRouter>
	);
}

function storedPreset(): unknown {
	const stored = window.localStorage.getItem(PREFERENCES_KEY);
	return stored === null ? null : JSON.parse(stored).themePreset;
}

describe("the device's last theme preset", () => {
	beforeAll(() => {
		Element.prototype.scrollIntoView = () => undefined;
	});

	beforeEach(() => {
		current.status = undefined;
		current.pendingDays = 0;
		window.localStorage.clear();
	});

	it("remembers a preset read from the address, but not two custom dates", () => {
		renderHook(() => useThemeContext(paymentsTheme()), {
			wrapper: wrapperAt("/chu-de/thanh-toan?range=91d"),
		});
		expect(storedPreset()).toBe("91d");
		window.localStorage.clear();
		renderHook(() => useThemeContext(paymentsTheme()), {
			wrapper: wrapperAt("/chu-de/thanh-toan?from=2026-10-08&to=2026-10-21"),
		});
		expect(storedPreset() ?? null).toBeNull();
	});

	it("opens the remembered preset when the address names no range", () => {
		window.localStorage.setItem(
			PREFERENCES_KEY,
			JSON.stringify({ themePreset: "7d" }),
		);
		const { result } = renderHook(() => useThemeContext(paymentsTheme()), {
			wrapper: wrapperAt("/chu-de/thanh-toan"),
		});
		expect(result.current.context.range.preset).toBe("7d");
	});
});

describe("the range notices", () => {
	beforeAll(() => {
		Element.prototype.scrollIntoView = () => undefined;
	});

	beforeEach(() => {
		current.status = undefined;
		current.pendingDays = 0;
		window.localStorage.clear();
	});

	it("keep saying the range was shortened after the address is rewritten, until another range is chosen", async () => {
		const { result } = renderHook(() => useThemeContext(paymentsTheme()), {
			wrapper: wrapperAt("/chu-de/thanh-toan?from=2023-06-01&to=2099-12-31"),
		});
		await waitFor(() =>
			expect(result.current.context.range.preset).toBe("custom"),
		);
		await waitFor(() =>
			expect(result.current.context.range.days).toBe(
				paymentsTheme().maxRangeDays,
			),
		);
		expect(result.current.rangeClamped).toBe(true);
		expect(result.current.todayClamped).toBe(true);
		act(() =>
			result.current.goTo(
				rangeOfPreset("7d", result.current.context.range.asOf),
			),
		);
		await waitFor(() => expect(result.current.context.range.preset).toBe("7d"));
		expect(result.current.rangeClamped).toBe(false);
		expect(result.current.todayClamped).toBe(false);
	});
});

describe("the theme address in the history", () => {
	beforeAll(() => {
		Element.prototype.scrollIntoView = () => undefined;
	});

	beforeEach(() => {
		current.status = undefined;
		current.pendingDays = 0;
		window.localStorage.clear();
	});

	it("replaces the entry when it writes the address in full, and pushes one for the user's step", async () => {
		const { result } = renderHook(
			() => ({
				location: useThemeContext(paymentsTheme()),
				navigation: useNavigationType(),
			}),
			{ wrapper: wrapperAt("/chu-de/thanh-toan") },
		);
		await waitFor(() => expect(result.current.navigation).toBe("REPLACE"));
		expect(result.current.location.context.range.preset).toBe("28d");
		act(() =>
			result.current.location.goTo(
				rangeOfPreset("91d", result.current.location.context.range.asOf),
			),
		);
		await waitFor(() =>
			expect(result.current.location.context.range.preset).toBe("91d"),
		);
		expect(result.current.navigation).toBe("PUSH");
	});
});

describe("the parameters of a theme card", () => {
	beforeAll(() => {
		Element.prototype.scrollIntoView = () => undefined;
	});

	beforeEach(() => {
		current.status = undefined;
		current.pendingDays = 0;
		loaded.cards = [];
		loaded.rows = {};
		window.localStorage.clear();
	});

	it("replaces an entry whose parameters it cannot read, and pushes one entry for each change", async () => {
		const definition = withPromotionParams();
		const { result } = renderHook(
			() => ({
				location: useThemeContext(definition),
				navigation: useNavigationType(),
				address: useLocation(),
				navigate: useNavigate(),
			}),
			{
				wrapper: wrapperAt(
					"/chu-de/thanh-toan?range=28d&promo=combo%3AKM-01&cmp=sometimes",
				),
			},
		);
		await waitFor(() => expect(result.current.navigation).toBe("REPLACE"));
		expect(result.current.location.context.params).toEqual({
			[PROMOTION_PARAM]: "",
			[COMPARATOR_PARAM]: "baseline",
		});
		expect(result.current.address.search).toBe("?range=28d");
		const change = (id: string, value: string) =>
			act(() =>
				result.current.location.goTo(result.current.location.context.range, {
					params: { ...result.current.location.context.params, [id]: value },
				}),
			);
		change(COMPARATOR_PARAM, "sister_store");
		await waitFor(() =>
			expect(result.current.location.context.params[COMPARATOR_PARAM]).toBe(
				"sister_store",
			),
		);
		expect(result.current.navigation).toBe("PUSH");
		expect(result.current.address.search).toBe("?range=28d&cmp=sister_store");
		change(PROMOTION_PARAM, "voucher:Giảm 20k");
		await waitFor(() =>
			expect(result.current.location.context.params[PROMOTION_PARAM]).toBe(
				"voucher:Giảm 20k",
			),
		);
		expect(result.current.navigation).toBe("PUSH");
		expect(result.current.address.search).toBe(
			"?range=28d&promo=voucher%3AGi%E1%BA%A3m%2020k&cmp=sister_store",
		);
		change(COMPARATOR_PARAM, "baseline");
		await waitFor(() =>
			expect(result.current.address.search).toBe(
				"?range=28d&promo=voucher%3AGi%E1%BA%A3m%2020k",
			),
		);
		act(() => result.current.navigate(-1));
		await waitFor(() =>
			expect(result.current.location.context.params).toEqual({
				[PROMOTION_PARAM]: "voucher:Giảm 20k",
				[COMPARATOR_PARAM]: "sister_store",
			}),
		);
		act(() => result.current.navigate(-1));
		await waitFor(() =>
			expect(result.current.location.context.params).toEqual({
				[PROMOTION_PARAM]: "",
				[COMPARATOR_PARAM]: "sister_store",
			}),
		);
	});

	it("shows the parameters inside their card, ordered by discount, and writes a change into the address", async () => {
		loaded.cards = [{ id: "lift", status: "error", retry: () => undefined }];
		loaded.rows = { [PROMOTIONS_W92_CALL_KEY]: PROMOTION_ROWS };
		render(
			<>
				<ThemePage definition={withPromotionParams()} />
				<AddressProbe />
			</>,
			{ wrapper: wrapperAt("/chu-de/thanh-toan?range=28d") },
		);
		const card = screen.getByTestId("card-payments-lift");
		const select = within(card).getByRole("combobox", { name: "Chương trình" });
		expect(
			within(select)
				.getAllByRole("option")
				.map((option) => option.textContent),
		).toEqual(["Mua 2 tặng 1 (Giảm giá món)", "Giảm giá hóa đơn không tên"]);
		expect(select).toHaveValue("item:KM-01");
		expect(within(card).getByRole("group", { name: "So với" })).toBeVisible();
		fireEvent.change(select, { target: { value: "bill:unnamed" } });
		fireEvent.blur(select);
		await waitFor(() =>
			expect(probed.search).toBe("?range=28d&promo=bill%3Aunnamed"),
		);
		expect(probed.navigation).toBe("PUSH");
		expect(
			within(screen.getByTestId("card-payments-lift")).getByRole("combobox", {
				name: "Chương trình",
			}),
		).toHaveValue("bill:unnamed");
	});

	it("drops a promotion the answered call does not offer from the address, replacing the entry", async () => {
		loaded.cards = [{ id: "lift", status: "error", retry: () => undefined }];
		loaded.rows = {};
		const view = render(
			<>
				<ThemePage definition={withPromotionParams()} />
				<AddressProbe />
			</>,
			{
				wrapper: wrapperAt("/chu-de/thanh-toan?range=28d&promo=item%3AKM-OLD"),
			},
		);
		expect(probed.search).toBe("?range=28d&promo=item%3AKM-OLD");
		expect(
			within(screen.getByTestId("card-payments-lift")).getByRole("combobox", {
				name: "Chương trình",
			}),
		).toBeDisabled();
		loaded.rows = { [PROMOTIONS_W92_CALL_KEY]: PROMOTION_ROWS };
		view.rerender(
			<>
				<ThemePage definition={withPromotionParams()} />
				<AddressProbe />
			</>,
		);
		await waitFor(() => expect(probed.search).toBe("?range=28d"));
		expect(probed.navigation).toBe("REPLACE");
	});

	it("disables the sister store with its reason once the lift found no store without the promotion, and drops it from the address", async () => {
		loaded.cards = [{ id: "lift", status: "error", retry: () => undefined }];
		loaded.rows = {
			[PROMOTIONS_W92_CALL_KEY]: PROMOTION_ROWS,
			[LIFT_CALL_KEY]: [{ business_date: null, control_store_count: 0 }],
		};
		render(
			<>
				<ThemePage definition={withPromotionParams()} />
				<AddressProbe />
			</>,
			{ wrapper: wrapperAt("/chu-de/thanh-toan?range=28d&cmp=sister_store") },
		);
		const card = screen.getByTestId("card-payments-lift");
		const sister = within(card).getByRole("radio", {
			name: "Cửa hàng không chạy chương trình",
		});
		expect(sister).toBeDisabled();
		expect(sister).toHaveAccessibleDescription(
			"Mọi cửa hàng đang chọn đều chạy chương trình này nên không có cửa hàng để so sánh.",
		);
		await waitFor(() => expect(probed.search).toBe("?range=28d"));
		expect(probed.navigation).toBe("REPLACE");
		expect(
			within(screen.getByTestId("card-payments-lift")).getByRole("radio", {
				name: "Cùng thứ các tuần trước",
			}),
		).toBeChecked();
	});

	it("keeps the sister store disabled while only the comparator changes and its lift loads, and offers it again for another promotion until that lift answers", async () => {
		const user = userEvent.setup();
		loaded.cards = [{ id: "lift", status: "error", retry: () => undefined }];
		loaded.rows = {
			[PROMOTIONS_W92_CALL_KEY]: PROMOTION_ROWS,
			[LIFT_CALL_KEY]: [{ business_date: null, control_store_count: 0 }],
		};
		render(
			<>
				<ThemePage definition={withPromotionParams()} />
				<AddressProbe />
			</>,
			{ wrapper: wrapperAt("/chu-de/thanh-toan?range=28d") },
		);
		const card = () => screen.getByTestId("card-payments-lift");
		const sister = () =>
			within(card()).getByRole("radio", {
				name: "Cửa hàng không chạy chương trình",
			});
		expect(sister()).toBeDisabled();
		loaded.rows = { [PROMOTIONS_W92_CALL_KEY]: PROMOTION_ROWS };
		await user.click(
			within(card()).getByRole("radio", {
				name: "Các tuần trước chương trình",
			}),
		);
		await waitFor(() =>
			expect(probed.search).toBe("?range=28d&cmp=prior_weeks"),
		);
		expect(sister()).toBeDisabled();
		const select = within(card()).getByRole("combobox", {
			name: "Chương trình",
		});
		fireEvent.change(select, { target: { value: "bill:unnamed" } });
		fireEvent.blur(select);
		await waitFor(() =>
			expect(probed.search).toBe(
				"?range=28d&promo=bill%3Aunnamed&cmp=prior_weeks",
			),
		);
		expect(sister()).toBeEnabled();
	});

	it("keeps a card's controls while it loads and gives the focus back to the control that changed", async () => {
		const user = userEvent.setup();
		loaded.cards = [{ id: "lift", status: "error", retry: () => undefined }];
		loaded.rows = { [PROMOTIONS_W92_CALL_KEY]: PROMOTION_ROWS };
		const page = (
			<>
				<ThemePage definition={withPromotionParams()} />
				<AddressProbe />
			</>
		);
		const view = render(page, {
			wrapper: wrapperAt("/chu-de/thanh-toan?range=28d"),
		});
		await user.click(
			within(screen.getByTestId("card-payments-lift")).getByRole("radio", {
				name: "Cửa hàng không chạy chương trình",
			}),
		);
		await waitFor(() =>
			expect(probed.search).toBe("?range=28d&cmp=sister_store"),
		);
		loaded.cards = [{ id: "lift", status: "loading" }];
		view.rerender(page);
		const loading = screen.getByTestId("card-payments-lift");
		expect(loading).toHaveAttribute("aria-busy", "true");
		const radio = within(loading).getByRole("radio", {
			name: "Cửa hàng không chạy chương trình",
		});
		expect(radio).toBeChecked();
		expect(document.activeElement).toBe(radio);
		loaded.cards = [{ id: "lift", status: "error", retry: () => undefined }];
		view.rerender(page);
		expect(document.activeElement).toBe(
			within(screen.getByTestId("card-payments-lift")).getByRole("radio", {
				name: "Cửa hàng không chạy chương trình",
			}),
		);
	});
});
