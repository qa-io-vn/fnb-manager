import config from "virtual:mini-app-config";
import { shellProblems } from "@fnb/zalo-mini/react";
import { fireEvent, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { routes, tabs } from "./app";
import { renderCustomerApp } from "./test/render-app";

describe("customer Mini App shell", () => {
	it("opens on the home tab of three, within the design rules", async () => {
		renderCustomerApp();
		expect(await screen.findByTestId("loading")).toHaveTextContent("Đang tải…");
		expect(
			await screen.findByRole("heading", { name: "Thành viên Quán Mẫu Một" }),
		).toBeInTheDocument();
		const navigation = screen.getByRole("navigation");
		expect(
			within(navigation)
				.getAllByText(/Trang chủ|Thẻ thành viên|Tài khoản/)
				.map((node) => node.textContent),
		).toEqual(["Trang chủ", "Thẻ thành viên", "Tài khoản"]);
		expect(tabs.map((tab) => tab.path)).toEqual([
			"/",
			"/the-thanh-vien",
			"/tai-khoan",
		]);
		expect(shellProblems(routes, tabs)).toEqual([]);
	});

	it("asks a visitor to join on the card tab, without any permission call", async () => {
		renderCustomerApp();
		await screen.findByRole("heading", { name: "Thành viên Quán Mẫu Một" });
		fireEvent.click(screen.getByText("Thẻ thành viên"));
		expect(
			await screen.findByRole("heading", { name: "Bạn chưa là thành viên" }),
		).toBeInTheDocument();
		const { mockSdkCalls } = await import("@fnb/zalo-mini/testing/mock-sdk");
		expect(mockSdkCalls().map((call) => call.api)).toEqual(["getAccessToken"]);
	});

	it("shows a lost connection with one retry", async () => {
		renderCustomerApp({ settings: { sessionFailure: true } });
		expect(await screen.findByRole("alert")).toHaveTextContent(
			"Mất kết nối mạng",
		);
		expect(screen.getByRole("button", { name: "Thử lại" })).toBeInTheDocument();
	});

	it("speaks English when Zalo does", async () => {
		renderCustomerApp({ language: "en" });
		expect(
			await screen.findByRole("button", { name: "Become a member" }),
		).toBeInTheDocument();
		expect(screen.getAllByText("Ask at the counter").length).toBeGreaterThan(0);
	});

	it("builds its configuration for the customer app", () => {
		expect(config.kind).toBe("customer");
		expect(config.app.title.length).toBeGreaterThanOrEqual(3);
	});
});
