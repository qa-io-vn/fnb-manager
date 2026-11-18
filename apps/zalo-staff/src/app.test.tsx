import config from "virtual:mini-app-config";
import {
	createStandInSessionClient,
	fromZmpNativeStorage,
	STAND_IN_REJECTED_CODE,
	type StandInScenario,
} from "@fnb/zalo-mini";
import { MAX_TABS, MiniApp, shellProblems } from "@fnb/zalo-mini/react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { getAccessToken, nativeStorage } from "zmp-sdk";
import { routes, standInMember, tabs } from "./app";
import { catalogs } from "./i18n/catalog";

function renderApp(scenario: StandInScenario, language: "vi" | "en" = "vi") {
	nativeStorage.clear();
	const sessionClient = createStandInSessionClient({
		settings: { scenario, delayMs: 0 },
		member: standInMember,
		storage: fromZmpNativeStorage(nativeStorage),
		getAccessToken: () => getAccessToken(),
	});
	return render(
		<MiniApp
			language={language}
			catalogs={catalogs}
			sessionClient={sessionClient}
			routes={routes}
			tabs={tabs}
			standInHeader={config.app}
		/>,
	);
}

describe("staff Mini App shell", () => {
	it("shows Đang kết nối… first, then the member's name, role and stores", async () => {
		renderApp("bound");
		expect(screen.getByRole("status")).toHaveTextContent("Đang kết nối…");
		expect(
			await screen.findByRole("heading", { name: "Xin chào, Thành viên thử" }),
		).toBeInTheDocument();
		expect(screen.getByTestId("member-role")).toHaveTextContent("Quản lý");
		const stores = within(screen.getByTestId("member-stores"));
		expect(
			stores.getAllByRole("listitem").map((item) => item.textContent),
		).toEqual(["Cửa hàng Mẫu 1", "Cửa hàng Mẫu 2"]);
	});

	it("shows the unpaired instructions, refuses a wrong code and links with a good one", async () => {
		renderApp("unpaired");
		expect(
			await screen.findByRole("heading", {
				name: "Tài khoản chưa được liên kết",
			}),
		).toBeInTheDocument();
		const input = screen.getByLabelText("Mã liên kết");
		const link = screen.getByRole("button", { name: "Liên kết" });
		expect(link).toBeDisabled();
		fireEvent.change(input, { target: { value: STAND_IN_REJECTED_CODE } });
		fireEvent.click(link);
		expect(await screen.findByRole("alert")).toHaveTextContent(
			"Mã không đúng hoặc đã hết hiệu lực",
		);
		fireEvent.change(input, { target: { value: "12a3456" } });
		expect(input).toHaveValue("123456");
		fireEvent.click(screen.getByRole("button", { name: "Liên kết" }));
		expect(
			await screen.findByRole("heading", { name: "Xin chào, Thành viên thử" }),
		).toBeInTheDocument();
	});

	it("offers one retry action when the connection fails", async () => {
		renderApp("failed");
		expect(
			await screen.findByRole("heading", { name: "Chưa kết nối được" }),
		).toBeInTheDocument();
		expect(screen.getAllByRole("button", { name: "Thử lại" })).toHaveLength(1);
	});

	it("opens the first of at most four tabs and shows a plain state on the others", async () => {
		renderApp("bound");
		const navigation = screen.getByRole("navigation", {
			name: "Điều hướng chính",
		});
		const buttons = within(navigation).getAllByRole("button");
		expect(buttons.map((button) => button.textContent?.trim())).toEqual([
			"Trang chủ",
			"Ca làm",
			"Thông báo",
			"Cá nhân",
		]);
		expect(buttons.length).toBeLessThanOrEqual(MAX_TABS);
		expect(
			await screen.findByRole("heading", { name: "Xin chào, Thành viên thử" }),
		).toBeInTheDocument();
		fireEvent.click(buttons[1] as HTMLElement);
		expect(await screen.findByTestId("plain-state")).toHaveTextContent(
			"Chưa có nội dung ở mục này.",
		);
	});

	it("speaks English when Zalo is set to English", async () => {
		renderApp("bound", "en");
		expect(screen.getByRole("status")).toHaveTextContent("Connecting…");
		expect(
			await screen.findByRole("heading", { name: "Hello, Thành viên thử" }),
		).toBeInTheDocument();
		expect(screen.getByTestId("stand-in-header")).toHaveTextContent(
			config.app.headerTitle.en,
		);
	});

	it("keeps the routes and tabs within the design rules", () => {
		expect(shellProblems(routes, tabs)).toEqual([]);
	});
});
