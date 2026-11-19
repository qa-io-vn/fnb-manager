import { act, fireEvent, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { renderCustomerApp, setSearch } from "../test/render-app";

function goOnline(online: boolean): void {
	Object.defineProperty(window.navigator, "onLine", {
		configurable: true,
		get: () => online,
	});
	act(() => {
		window.dispatchEvent(new Event(online ? "online" : "offline"));
	});
}

afterEach(() => {
	goOnline(true);
	setSearch("");
});

describe("offline and empty states", () => {
	it("says the phone is offline and reloads a failed screen when the connection is back", async () => {
		const app = renderCustomerApp({ settings: { member: true } });
		await screen.findByRole("heading", { name: "Thành viên Quán Mẫu Một" });
		expect(screen.queryByTestId("offline")).not.toBeInTheDocument();
		app.world.setOffline(true);
		goOnline(false);
		expect(screen.getByTestId("offline")).toHaveTextContent(
			"Bạn đang ngoại tuyến.",
		);
		fireEvent.click(screen.getByText("Thẻ thành viên"));
		expect(await screen.findByRole("alert")).toHaveTextContent(
			"Mất kết nối mạng",
		);
		app.world.setOffline(false);
		goOnline(true);
		expect(await screen.findByTestId("member-card")).toBeInTheDocument();
		expect(screen.queryByTestId("offline")).not.toBeInTheDocument();
	});

	it("loads the home again when the connection is back", async () => {
		const app = renderCustomerApp();
		app.world.setOffline(true);
		expect(await screen.findByRole("alert")).toHaveTextContent(
			"Mất kết nối mạng",
		);
		app.world.setOffline(false);
		goOnline(true);
		expect(
			await screen.findByRole("heading", { name: "Thành viên Quán Mẫu Một" }),
		).toBeInTheDocument();
	});

	it("says when no store takes members yet, on the home and on every store picker", async () => {
		renderCustomerApp({ settings: { member: true, stores: false } });
		await screen.findByRole("heading", { name: "Thành viên Quán Mẫu Một" });
		expect(screen.getByTestId("no-stores")).toHaveTextContent(
			"Chưa có cửa hàng nào nhận thành viên.",
		);
		expect(screen.queryByTestId("store-list")).not.toBeInTheDocument();
		fireEvent.click(screen.getByText("Thẻ thành viên"));
		fireEvent.click(
			await screen.findByRole("button", { name: "Mã thành viên" }),
		);
		const code = within(await screen.findByTestId("member-code-screen"));
		expect(code.getByTestId("no-stores")).toBeInTheDocument();
		expect(code.queryByRole("combobox")).not.toBeInTheDocument();
		fireEvent.click(code.getByRole("button", { name: "Quay lại" }));
		fireEvent.click(
			await screen.findByRole("button", { name: "Nhận điểm từ hóa đơn" }),
		);
		const claim = within(await screen.findByTestId("claim"));
		expect(claim.getByTestId("no-stores")).toBeInTheDocument();
		expect(claim.queryByRole("button", { name: "Gửi hóa đơn" })).toBeNull();
		fireEvent.click(claim.getByRole("button", { name: "Quay lại" }));
		fireEvent.click(await screen.findByRole("button", { name: "Đổi quà" }));
		const rewards = within(await screen.findByTestId("rewards-screen"));
		expect(rewards.getByTestId("no-stores")).toBeInTheDocument();
	});
});
