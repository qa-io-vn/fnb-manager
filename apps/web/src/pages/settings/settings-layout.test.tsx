import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../i18n";
import { settingsPageOf } from "../../settings/pages";
import type { CatchUpStatus } from "../../settings/source";
import { loadedPageOf, SettingsLayout } from "./settings-layout";

const PENDING: CatchUpStatus = {
	inputsChangedAt: "2026-11-14T17:30:00Z",
	pendingFrom: "2026-05-01",
	pendingTo: "2026-11-15",
	pendingDays: 199,
	canRefresh: false,
};

const current = vi.hoisted(() => ({ pendingDays: 0 }));

vi.mock("../../app-mode/app-mode", () => ({
	useAppMode: () => ({ mode: "live" }),
}));

vi.mock("../../state/tenant-scope", () => ({
	useReadyTenantScope: () => ({
		tenant: {
			id: "tenant-1",
			name: "Quán mẫu",
			currencyCode: "VND",
			timeZone: "Asia/Ho_Chi_Minh",
			countryCode: "VN",
		},
	}),
}));

vi.mock("../../settings/catch-up/use-analytics-catch-up", () => ({
	useAnalyticsCatchUp: () => ({
		status: PENDING,
		pendingDays: current.pendingDays,
		running: false,
		problem: null,
		completed: false,
		start: () => undefined,
		abort: () => undefined,
		dismiss: () => undefined,
	}),
}));

function renderSettings(path: string) {
	return render(
		<MemoryRouter initialEntries={[path]}>
			<I18nProvider language="vi" onLanguageChange={() => undefined}>
				<Routes>
					<Route path="/cai-dat/:slug" element={<SettingsLayout />} />
				</Routes>
			</I18nProvider>
		</MemoryRouter>,
	);
}

describe("SettingsLayout", () => {
	beforeAll(() => {
		Element.prototype.scrollIntoView = () => undefined;
	});

	beforeEach(() => {
		current.pendingDays = 0;
	});

	it("opens the page of the address with its place in the sub-navigation", () => {
		renderSettings("/cai-dat/ngay-le");
		expect(
			screen.getByRole("heading", { level: 2, name: "Ngày lễ" }),
		).toBeInTheDocument();
		expect(screen.getByRole("link", { name: "Ngày lễ" })).toHaveAttribute(
			"aria-current",
			"page",
		);
		expect(screen.getByTestId("settings-placeholder")).toHaveTextContent("10b");
		expect(screen.queryByTestId("catch-up-banner")).toBeNull();
	});

	it("makes each page's lazy component once, so a move between two built pages can finish", () => {
		const thresholds = settingsPageOf("bao-cao");
		const roles = settingsPageOf("phan-loai");
		const holidays = settingsPageOf("ngay-le");
		if (thresholds === null || roles === null || holidays === null) {
			throw new Error("a settings page is missing");
		}
		expect(loadedPageOf(thresholds)).toBe(loadedPageOf(thresholds));
		expect(loadedPageOf(roles)).toBe(loadedPageOf(roles));
		expect(loadedPageOf(roles)).not.toBe(loadedPageOf(thresholds));
		expect(loadedPageOf(holidays)).toBeNull();
	});

	it("shows the catch-up line on every settings page while days are pending, with no action for a member who may not refresh", () => {
		current.pendingDays = 198;
		renderSettings("/cai-dat/ngay-le");
		const banner = screen.getByTestId("catch-up-banner");
		expect(banner).toHaveTextContent("còn 198 ngày");
		expect(banner).toHaveTextContent("Chủ hoặc quản lý có thể cập nhật ngay.");
		expect(screen.queryByTestId("catch-up-action")).toBeNull();
		expect(
			banner.compareDocumentPosition(screen.getByTestId("settings-nav")) &
				Node.DOCUMENT_POSITION_FOLLOWING,
		).toBeTruthy();
	});
});
