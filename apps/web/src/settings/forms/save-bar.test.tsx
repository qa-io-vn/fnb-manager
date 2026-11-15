import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../i18n";
import { renderWithLanguage } from "../../test/render";
import { RestoreDefaultsButton, SaveBar, type SaveBarProps } from "./save-bar";

function renderBar(
	props: Partial<SaveBarProps> = {},
	language: "vi" | "en" = "vi",
) {
	const handlers = {
		onSave: vi.fn(),
		onCancel: vi.fn(),
	};
	renderWithLanguage(
		<SaveBar
			pendingCount={2}
			canSave
			saving={false}
			{...handlers}
			{...props}
		/>,
		language,
	);
	return handlers;
}

function expectUnavailable(testId: string) {
	const button = screen.getByTestId(testId);
	expect(button).toHaveAttribute("aria-disabled", "true");
	expect(button).toBeEnabled();
}

describe("SaveBar", () => {
	it("counts the pending changes and saves or discards them", async () => {
		const user = userEvent.setup();
		const handlers = renderBar();
		expect(
			screen.getByRole("region", { name: "Lưu thay đổi" }),
		).toBeInTheDocument();
		expect(screen.getByTestId("settings-save-bar-pending")).toHaveTextContent(
			"2 thay đổi chưa lưu",
		);
		await user.click(screen.getByRole("button", { name: "Lưu" }));
		await user.click(screen.getByRole("button", { name: "Hủy thay đổi" }));
		expect(handlers.onSave).toHaveBeenCalledOnce();
		expect(handlers.onCancel).toHaveBeenCalledOnce();
	});

	it("offers nothing to save or discard without changes", () => {
		renderBar({ pendingCount: 0 });
		expect(screen.getByTestId("settings-save-bar-pending")).toHaveTextContent(
			"Chưa có thay đổi.",
		);
		expectUnavailable("settings-save");
		expectUnavailable("settings-cancel");
	});

	it("will not save while a value is invalid", async () => {
		const user = userEvent.setup();
		const handlers = renderBar({ canSave: false });
		expectUnavailable("settings-save");
		expect(screen.getByTestId("settings-cancel")).not.toHaveAttribute(
			"aria-disabled",
		);
		await user.click(screen.getByTestId("settings-save"));
		expect(handlers.onSave).not.toHaveBeenCalled();
	});

	it("says it is saving, refuses a second save and reports the outcome in a live region", async () => {
		const user = userEvent.setup();
		const handlers = renderBar({ saving: true });
		expect(screen.getByRole("status")).toHaveTextContent("Đang lưu…");
		expectUnavailable("settings-save");
		expectUnavailable("settings-cancel");
		await user.click(screen.getByTestId("settings-save"));
		await user.click(screen.getByTestId("settings-cancel"));
		expect(handlers.onSave).not.toHaveBeenCalled();
		expect(handlers.onCancel).not.toHaveBeenCalled();
	});

	it("keeps keyboard focus on Lưu when it becomes unavailable", async () => {
		const user = userEvent.setup();
		const { rerender } = renderWithLanguage(
			<SaveBar
				pendingCount={1}
				canSave
				saving={false}
				onSave={() => undefined}
				onCancel={() => undefined}
			/>,
		);
		await user.tab();
		expect(screen.getByTestId("settings-cancel")).toHaveFocus();
		await user.tab();
		expect(screen.getByTestId("settings-save")).toHaveFocus();
		rerender(
			<I18nProvider language="vi" onLanguageChange={() => undefined}>
				<SaveBar
					pendingCount={1}
					canSave
					saving
					onSave={() => undefined}
					onCancel={() => undefined}
				/>
			</I18nProvider>,
		);
		expect(screen.getByTestId("settings-save")).toHaveFocus();
	});

	it("shows an error in the error colour", () => {
		renderBar({ status: { tone: "error", text: "Không lưu được." } });
		expect(screen.getByRole("status")).toHaveTextContent("Không lưu được.");
		expect(screen.getByRole("status")).toHaveClass("text-negative");
	});

	it("keeps every control at least 44 px high and stays above the phone navigation", () => {
		renderBar();
		const bar = screen.getByTestId("settings-save-bar");
		expect(bar).toHaveClass("sticky", "min-h-14");
		expect(bar.className).toContain(
			"bottom-[calc(3.5rem+env(safe-area-inset-bottom))]",
		);
		for (const button of screen.getAllByRole("button")) {
			expect(button).toHaveClass("min-h-11");
		}
	});

	it("uses the singular in English for one change", () => {
		renderBar({ pendingCount: 1 }, "en");
		expect(screen.getByTestId("settings-save-bar-pending")).toHaveTextContent(
			"1 unsaved change",
		);
		expect(
			screen.getByRole("button", { name: "Discard changes" }),
		).toBeEnabled();
	});

	it("offers restoring the defaults as a separate page action", async () => {
		const user = userEvent.setup();
		const onClick = vi.fn();
		renderWithLanguage(<RestoreDefaultsButton onClick={onClick} />);
		await user.click(
			screen.getByRole("button", { name: "Khôi phục mặc định" }),
		);
		expect(onClick).toHaveBeenCalledOnce();
	});
});
