import { act, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderCustomerApp, setSearch } from "../test/render-app";
import { codeStatus, secondsUntil } from "./member-code";
import { qrPath } from "./qr";

const START = Date.UTC(2026, 10, 19, 3, 0, 0);

async function advance(ms: number) {
	await act(async () => {
		await vi.advanceTimersByTimeAsync(ms);
	});
}

async function openCode() {
	await screen.findByRole("heading", { name: "Cửa hàng Mẫu 1" });
	fireEvent.click(
		screen.getByRole("button", { name: "Mã thành viên tại cửa hàng này" }),
	);
	return screen.findByTestId("member-code");
}

beforeEach(() => {
	vi.useFakeTimers({ shouldAdvanceTime: true, now: START });
});

afterEach(() => {
	vi.useRealTimers();
	setSearch("");
});

describe("the member code model", () => {
	it("is fresh for 60 seconds, then refreshing, then expired at 2 minutes", () => {
		const code = {
			code: "123456",
			qrPayload: "x",
			storeCode: "mau-1",
			storeName: "Cửa hàng Mẫu 1",
			issuedAt: 0,
			refreshAt: 60_000,
			expiresAt: 120_000,
		};
		expect(codeStatus(code, 59_999)).toBe("fresh");
		expect(codeStatus(code, 60_000)).toBe("refreshing");
		expect(codeStatus(code, 120_000)).toBe("expired");
		expect(secondsUntil(60_000, 0)).toBe(60);
		expect(secondsUntil(60_000, 59_001)).toBe(1);
		expect(secondsUntil(60_000, 61_000)).toBe(0);
	});

	it("draws a square QR code of the payload", () => {
		const { size, path } = qrPath("fnb-member:1:mau-1:123456");
		expect(size).toBeGreaterThanOrEqual(25);
		expect(path.startsWith("M")).toBe(true);
	});
});

describe("the member code screen", () => {
	it("binds the code to the linked store and refreshes it every 60 seconds", async () => {
		renderCustomerApp({
			settings: { member: true },
			search: "?store=mau-1&src=qr",
		});
		const first = (await openCode()).textContent ?? "";
		expect(first).toMatch(/^\d{6}$/);
		expect(screen.getByTestId("code-store")).toHaveTextContent(
			"Cửa hàng Mẫu 1",
		);
		expect(screen.getByTestId("member-qr").getAttribute("data-payload")).toBe(
			`fnb-member:1:mau-1:${first}`,
		);
		expect(screen.getByTestId("code-countdown")).toHaveTextContent(
			"Mã đổi sau 60 giây",
		);
		expect(screen.getByTestId("code-valid-until")).toHaveTextContent(
			"Dùng được đến 10:02:00",
		);
		await advance(30_000);
		expect(screen.getByTestId("code-countdown")).toHaveTextContent(
			"Mã đổi sau 30 giây",
		);
		await advance(30_500);
		expect(screen.getByTestId("member-code").textContent).not.toBe(first);
		expect(screen.getByTestId("code-valid-until")).toHaveTextContent(
			"Dùng được đến 10:03:00",
		);
	});

	it("shows the expiry when the code cannot be refreshed, and gets a new one on request", async () => {
		const app = renderCustomerApp({
			settings: { member: true },
			search: "?store=mau-1",
		});
		const first = (await openCode()).textContent ?? "";
		app.world.setOffline(true);
		await advance(61_000);
		expect(screen.getByTestId("member-code")).toHaveTextContent(first);
		expect(screen.getByRole("alert")).toHaveTextContent("Mất kết nối mạng");
		await advance(60_000);
		expect(screen.getByTestId("code-expired")).toHaveTextContent(
			"Mã đã hết hạn.",
		);
		app.world.setOffline(false);
		fireEvent.click(screen.getByRole("button", { name: "Lấy mã mới" }));
		await advance(10);
		expect(screen.queryByTestId("code-expired")).not.toBeInTheDocument();
		expect(screen.getByTestId("code-countdown")).toHaveTextContent(
			"Mã đổi sau 60 giây",
		);
	});

	it("asks for the store when there is no link", async () => {
		renderCustomerApp({ settings: { member: true } });
		await screen.findByRole("heading", { name: "Thành viên Quán Mẫu Một" });
		fireEvent.click(screen.getByRole("button", { name: "Xem thẻ thành viên" }));
		fireEvent.click(
			await screen.findByRole("button", { name: "Mã thành viên" }),
		);
		expect(await screen.findByTestId("code-pick-first")).toBeInTheDocument();
		fireEvent.change(screen.getByTestId("code-store-picker"), {
			target: { value: "mau-2" },
		});
		expect(await screen.findByTestId("code-store")).toHaveTextContent(
			"Cửa hàng Mẫu 2",
		);
	});
});
