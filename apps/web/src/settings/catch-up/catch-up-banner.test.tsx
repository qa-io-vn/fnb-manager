import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../i18n";
import { renderWithLanguage, vndFormatters } from "../../test/render";
import type { CatchUpStatus } from "../source";
import { CatchUpBanner } from "./catch-up-banner";
import type { AnalyticsCatchUp } from "./use-analytics-catch-up";

const current = vi.hoisted(() => ({ catchUp: null as unknown }));

vi.mock("./use-analytics-catch-up", () => ({
	useAnalyticsCatchUp: () => current.catchUp,
}));

const PENDING: CatchUpStatus = {
	inputsChangedAt: "2026-11-14T17:30:00Z",
	pendingFrom: "2026-05-01",
	pendingTo: "2026-11-15",
	pendingDays: 199,
	canRefresh: true,
};

function catchUpWith(overrides: Partial<AnalyticsCatchUp> = {}) {
	const catchUp: AnalyticsCatchUp = {
		status: PENDING,
		pendingDays: 198,
		running: false,
		problem: null,
		completed: false,
		start: vi.fn(),
		abort: vi.fn(),
		dismiss: vi.fn(),
		...overrides,
	};
	current.catchUp = catchUp;
	return catchUp;
}

function banner() {
	return (
		<CatchUpBanner formatters={vndFormatters()} timeZone="Asia/Ho_Chi_Minh" />
	);
}

function renderBanner(
	overrides: Partial<AnalyticsCatchUp> = {},
	language: "vi" | "en" = "vi",
) {
	const catchUp = catchUpWith(overrides);
	const view = renderWithLanguage(banner(), language);
	return { catchUp, ...view };
}

describe("CatchUpBanner", () => {
	it("shows nothing while the status is unknown, or when no day a report can show is pending", () => {
		renderBanner({ status: null, pendingDays: 0 });
		expect(screen.queryByTestId("catch-up-banner")).toBeNull();
		renderBanner({ pendingDays: 0 });
		expect(screen.queryByTestId("catch-up-banner")).toBeNull();
	});

	it("says when the mapping changed and how many days are left, and lets an owner or manager refresh now", async () => {
		const user = userEvent.setup();
		const { catchUp } = renderBanner();
		expect(screen.getByTestId("catch-up-banner")).toHaveTextContent(
			"Số liệu đang cập nhật theo thay đổi phân loại lúc 00:30 ngày 15/11/2026: còn 198 ngày.",
		);
		expect(screen.getByRole("status")).toBeEmptyDOMElement();
		await user.click(screen.getByRole("button", { name: "Cập nhật ngay" }));
		expect(catchUp.start).toHaveBeenCalledOnce();
	});

	it("offers no refresh to staff and viewers and says who can", () => {
		renderBanner({ status: { ...PENDING, canRefresh: false } });
		expect(screen.queryByRole("button")).toBeNull();
		expect(screen.getByTestId("catch-up-banner")).toHaveTextContent(
			"Chủ hoặc quản lý có thể cập nhật ngay",
		);
	});

	it("says it is refreshing and ignores a second press", async () => {
		const user = userEvent.setup();
		const { catchUp } = renderBanner({ running: true });
		expect(screen.getByRole("status")).toHaveTextContent("Đang cập nhật…");
		const button = screen.getByTestId("catch-up-action");
		expect(button).toHaveAttribute("aria-disabled", "true");
		expect(button).toBeEnabled();
		await user.click(button);
		expect(catchUp.start).not.toHaveBeenCalled();
	});

	it("keeps saying it is refreshing while only days no report shows are left", () => {
		renderBanner({ running: true, pendingDays: 0 });
		expect(screen.getByTestId("catch-up-banner")).toHaveTextContent(
			"Số liệu đang cập nhật theo thay đổi phân loại.",
		);
		expect(screen.getByRole("status")).toHaveTextContent("Đang cập nhật…");
	});

	it("says why the refresh stopped and offers to try again", async () => {
		const user = userEvent.setup();
		const { catchUp } = renderBanner({ problem: "network" });
		expect(screen.getByRole("status")).toHaveTextContent(
			"Chưa cập nhật xong vì mất kết nối; kiểm tra mạng rồi thử lại.",
		);
		await user.click(screen.getByRole("button", { name: "Thử lại" }));
		expect(catchUp.start).toHaveBeenCalledOnce();
	});

	it.each([
		["forbidden", "tài khoản của bạn không có quyền cập nhật số liệu"],
		["stalled", "số ngày còn lại không giảm"],
		["failed", "Chưa cập nhật xong vì có lỗi"],
		["invalid", "Chưa cập nhật xong vì có lỗi"],
	] as const)("explains the problem %s in its own words", (problem, text) => {
		renderBanner({ problem });
		expect(screen.getByRole("status")).toHaveTextContent(text);
	});

	it("says when the refresh is done, keeps the keyboard where it was and closes on request", async () => {
		const user = userEvent.setup();
		const { rerender } = renderBanner({ running: true });
		screen.getByTestId("catch-up-action").focus();
		const done = catchUpWith({
			running: false,
			completed: true,
			pendingDays: 0,
			status: {
				...PENDING,
				pendingFrom: null,
				pendingTo: null,
				pendingDays: 0,
			},
		});
		rerender(
			<I18nProvider language="vi" onLanguageChange={() => undefined}>
				{banner()}
			</I18nProvider>,
		);
		expect(screen.getByRole("status")).toHaveTextContent(
			"Đã cập nhật xong số liệu theo thay đổi phân loại.",
		);
		const close = screen.getByRole("button", { name: "Đóng" });
		expect(close).toHaveFocus();
		expect(close).not.toHaveAttribute("aria-disabled");
		await user.click(close);
		expect(done.dismiss).toHaveBeenCalledOnce();
		expect(done.start).not.toHaveBeenCalled();
	});

	it("leaves the time out when the change was never stamped, and reads in English", () => {
		renderBanner({ status: { ...PENDING, inputsChangedAt: null } }, "en");
		expect(screen.getByTestId("catch-up-banner")).toHaveTextContent(
			"The numbers are catching up with a mapping change. Days left: 198.",
		);
		expect(
			screen.getByRole("button", { name: "Refresh now" }),
		).toBeInTheDocument();
	});
});
