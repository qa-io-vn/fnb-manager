import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../i18n";
import {
	countdownText,
	PairingCodePanel,
	remainingSeconds,
} from "./pairing-code";
import { PAIRING_CODE_TTL_MS } from "./source";

const ISSUED_AT = Date.parse("2026-11-18T03:00:00.000Z");
const CODE = "482913";

function issued() {
	return {
		rosterId: "row-1",
		code: CODE,
		expiresAt: new Date(ISSUED_AT + PAIRING_CODE_TTL_MS).toISOString(),
	};
}

function renderPanel(onClose = vi.fn(), now: () => number = Date.now) {
	render(
		<I18nProvider language="vi" onLanguageChange={() => undefined}>
			<PairingCodePanel
				issued={issued()}
				memberName="Nhân viên 1"
				onClose={onClose}
				now={now}
			/>
		</I18nProvider>,
	);
	return onClose;
}

describe("the pairing code countdown", () => {
	it("counts whole seconds down to zero and never below", () => {
		const expiresAt = new Date(ISSUED_AT + PAIRING_CODE_TTL_MS).toISOString();
		expect(remainingSeconds(expiresAt, ISSUED_AT)).toBe(600);
		expect(remainingSeconds(expiresAt, ISSUED_AT + 1)).toBe(600);
		expect(remainingSeconds(expiresAt, ISSUED_AT + 1000)).toBe(599);
		expect(remainingSeconds(expiresAt, ISSUED_AT + 700_000)).toBe(0);
		expect(countdownText(600)).toBe("10:00");
		expect(countdownText(65)).toBe("01:05");
		expect(countdownText(0)).toBe("00:00");
	});
});

describe("PairingCodePanel", () => {
	beforeEach(() => {
		vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "Date"] });
		vi.setSystemTime(ISSUED_AT);
	});

	afterEach(() => {
		vi.useRealTimers();
		window.localStorage.clear();
		window.sessionStorage.clear();
	});

	it("shows the code once with a ten-minute countdown, then hides it when it expires", () => {
		renderPanel();
		expect(screen.getByTestId("pairing-code-value")).toHaveTextContent(CODE);
		expect(screen.getByRole("timer")).toHaveTextContent("Còn hiệu lực 10:00");
		expect(screen.getByTestId("pairing-code")).toHaveTextContent(
			"Mã ghép nối cho Nhân viên 1",
		);
		act(() => {
			vi.advanceTimersByTime(61_000);
		});
		expect(screen.getByRole("timer")).toHaveTextContent("Còn hiệu lực 08:59");
		act(() => {
			vi.advanceTimersByTime(PAIRING_CODE_TTL_MS);
		});
		expect(screen.queryByTestId("pairing-code-value")).toBeNull();
		expect(screen.queryByRole("timer")).toBeNull();
		expect(screen.getByTestId("pairing-code")).toHaveAttribute(
			"data-state",
			"expired",
		);
		expect(screen.getByTestId("pairing-code-expired")).toHaveTextContent(
			"Mã đã hết hạn.",
		);
		expect(document.body).not.toHaveTextContent(CODE);
	});

	it("writes the code to no storage, address or console", () => {
		const setItem = vi.spyOn(Storage.prototype, "setItem");
		const pushState = vi.spyOn(window.history, "pushState");
		const replaceState = vi.spyOn(window.history, "replaceState");
		const logs = (["log", "info", "warn", "error", "debug"] as const).map(
			(method) => vi.spyOn(console, method).mockImplementation(() => undefined),
		);
		const before = window.location.href;
		renderPanel();
		act(() => {
			vi.advanceTimersByTime(PAIRING_CODE_TTL_MS + 1000);
		});
		expect(setItem).not.toHaveBeenCalled();
		expect(pushState).not.toHaveBeenCalled();
		expect(replaceState).not.toHaveBeenCalled();
		for (const log of logs) expect(log).not.toHaveBeenCalled();
		expect(window.location.href).toBe(before);
		expect(window.location.href).not.toContain(CODE);
		expect(window.localStorage.length).toBe(0);
		expect(window.sessionStorage.length).toBe(0);
		expect(document.cookie).not.toContain(CODE);
		vi.restoreAllMocks();
	});

	it("puts the focus on the copy button, copies the code only when asked, and closes on its button or on Escape", async () => {
		vi.useRealTimers();
		const user = userEvent.setup();
		const writeText = vi.fn(async (_text: string) => undefined);
		Object.defineProperty(navigator, "clipboard", {
			configurable: true,
			value: { writeText },
		});
		const onClose = renderPanel(vi.fn(), () => ISSUED_AT + 30_000);
		const copy = screen.getByRole("button", { name: "Chép mã" });
		expect(copy).toHaveFocus();
		expect(writeText).not.toHaveBeenCalled();
		await user.click(copy);
		expect(writeText).toHaveBeenCalledExactlyOnceWith(CODE);
		expect(screen.getByTestId("pairing-code-copy-status")).toHaveTextContent(
			"Đã chép mã.",
		);
		await user.keyboard("{Escape}");
		await user.click(screen.getByRole("button", { name: "Đóng" }));
		expect(onClose).toHaveBeenCalledTimes(2);
		Reflect.deleteProperty(navigator, "clipboard");
	});

	it("says the code could not be copied when the browser has no clipboard", async () => {
		vi.useRealTimers();
		const user = userEvent.setup();
		Object.defineProperty(navigator, "clipboard", {
			configurable: true,
			value: undefined,
		});
		renderPanel(vi.fn(), () => ISSUED_AT + 30_000);
		await user.click(screen.getByRole("button", { name: "Chép mã" }));
		expect(screen.getByTestId("pairing-code-copy-status")).toHaveTextContent(
			"Không chép được mã",
		);
		Reflect.deleteProperty(navigator, "clipboard");
	});

	it("offers no copy and focuses the close button for a code already expired", () => {
		renderPanel(vi.fn(), () => ISSUED_AT + PAIRING_CODE_TTL_MS + 1);
		expect(screen.queryByRole("button", { name: "Chép mã" })).toBeNull();
		expect(screen.getByRole("button", { name: "Đóng" })).toHaveFocus();
	});
});
