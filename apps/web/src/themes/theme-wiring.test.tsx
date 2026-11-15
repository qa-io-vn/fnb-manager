import { type ThemeDefinition, themeDefinitions } from "@fnb/reports";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, renderHook, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../i18n";
import type { CatchUpStatus } from "../settings/source";
import { PreferencesProvider } from "../state/preferences";
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

vi.mock("./use-theme-load", () => ({
	useThemeLoad: () => ({ failed: false, cards: [], retry: () => undefined }),
}));

function paymentsTheme(): ThemeDefinition {
	const definition = themeDefinitions.payments;
	if (definition === undefined)
		throw new Error("the payments theme is missing");
	return definition;
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
