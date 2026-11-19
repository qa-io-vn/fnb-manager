import config from "virtual:mini-app-config";
import {
	STAND_IN_NOTICE,
	STAND_IN_REJECTED_CODE,
	type StandInScenario,
} from "@fnb/zalo-mini";
import { MAX_TABS, shellProblems } from "@fnb/zalo-mini/react";
import { fireEvent, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { routes, standInMember, standInMemberFrom, tabs } from "./app";
import { renderStaffApp } from "./test/render-app";

function renderApp(scenario: StandInScenario, language: "vi" | "en" = "vi") {
	return renderStaffApp({ scenario, language });
}

describe("staff Mini App shell", () => {
	it("shows Đang kết nối… first, then the member's name, role and stores on the home", async () => {
		renderApp("bound");
		expect(screen.getByRole("status")).toHaveTextContent("Đang kết nối…");
		expect(
			await screen.findByRole("heading", { name: "Xin chào, Thành viên thử" }),
		).toBeInTheDocument();
		expect(screen.getByTestId("member-role")).toHaveTextContent("Quản lý");
		const picker = await screen.findByLabelText("Cửa hàng");
		expect(
			within(picker)
				.getAllByRole("option")
				.map((option) => option.textContent),
		).toEqual(["Cửa hàng Mẫu 1", "Cửa hàng Mẫu 2"]);
		expect(screen.getByTestId("home-freshness")).toHaveTextContent(
			/^Cập nhật lúc \d{2}:\d{2}$/,
		);
	});

	it("shows an unpaired person only the entry screens until a good code pairs them", async () => {
		renderApp("unpaired");
		fireEvent.click(await screen.findByRole("button", { name: "Tiếp tục" }));
		expect(
			await screen.findByRole("heading", {
				level: 1,
				name: STAND_IN_NOTICE.title,
			}),
		).toBeInTheDocument();
		expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
		fireEvent.click(screen.getByRole("button", { name: "Đồng ý" }));
		const input = await screen.findByLabelText("Mã ghép nối");
		const pair = screen.getByRole("button", { name: "Ghép nối" });
		expect(pair).toBeDisabled();
		fireEvent.change(input, { target: { value: STAND_IN_REJECTED_CODE } });
		fireEvent.click(pair);
		expect(await screen.findByRole("alert")).toHaveTextContent(
			"Mã không đúng hoặc đã hết hạn",
		);
		expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
		fireEvent.change(input, { target: { value: "12a3456" } });
		expect(input).toHaveValue("123456");
		fireEvent.click(screen.getByRole("button", { name: "Ghép nối" }));
		expect(
			await screen.findByRole("heading", { name: "Xin chào, Thành viên thử" }),
		).toBeInTheDocument();
		expect(screen.getByRole("navigation")).toBeInTheDocument();
	});

	it("offers one retry action when the connection fails", async () => {
		renderApp("failed");
		expect(
			await screen.findByRole("heading", { name: "Chưa kết nối được" }),
		).toBeInTheDocument();
		expect(screen.getAllByRole("button", { name: "Thử lại" })).toHaveLength(1);
	});

	it("opens the first of at most four tabs, the shift's tasks under Ca làm and a plain state under Thông báo", async () => {
		renderApp("bound");
		const navigation = await screen.findByRole("navigation", {
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
		expect(await screen.findByTestId("shift-board")).toBeInTheDocument();
		expect(
			screen.getByRole("heading", { level: 1, name: "Ca làm" }),
		).toBeInTheDocument();
		fireEvent.click(buttons[2] as HTMLElement);
		expect(await screen.findByTestId("plain-state")).toHaveTextContent(
			"Chưa có nội dung ở mục này.",
		);
	});

	it("shows the checklist due and the shift close on the home, each opening Ca làm", async () => {
		renderApp("bound");
		const checklist = await screen.findByTestId("home-card-checklist");
		expect(await screen.findByTestId("home-card-close")).toHaveTextContent(
			"Chưa đếm tiền hôm nay.",
		);
		const open = within(checklist).getByRole("button");
		const opensRun = open.textContent === "Mở danh sách";
		fireEvent.click(open);
		expect(
			await screen.findByTestId(opensRun ? "checklist-run" : "shift-board"),
		).toBeInTheDocument();
		fireEvent.click(
			within(
				screen.getByRole("navigation", { name: "Điều hướng chính" }),
			).getByRole("button", { name: "Trang chủ" }),
		);
		const close = await screen.findByTestId("home-card-close");
		fireEvent.click(within(close).getByRole("button", { name: "Đóng ca" }));
		expect(await screen.findByTestId("close-count")).toBeInTheDocument();
	});

	it("puts Ghi nhận khách on the home as its one primary action, opening the tool at the selected store", async () => {
		renderApp("bound");
		const card = await screen.findByTestId("home-loyalty");
		const picker = await screen.findByLabelText("Cửa hàng");
		fireEvent.change(picker, {
			target: { value: "00000000-0000-4000-8000-0000000005a2" },
		});
		const primary = [
			...document.querySelectorAll<HTMLElement>("[data-action=primary]"),
		];
		expect(primary.map((element) => element.textContent)).toEqual([
			"Ghi nhận khách",
		]);
		expect(within(card).getByTestId("home-loyalty-queue")).toBeInTheDocument();
		fireEvent.click(
			within(screen.getByTestId("home-loyalty")).getByRole("button", {
				name: "Ghi nhận khách",
			}),
		);
		expect(
			await screen.findByTestId("checkin-entry", {}, { timeout: 4000 }),
		).toBeInTheDocument();
		expect(
			screen.getByRole("heading", { level: 1, name: "Ghi nhận khách" }),
		).toBeInTheDocument();
		expect(screen.getByTestId("loyalty-store-picker")).toHaveValue(
			"00000000-0000-4000-8000-0000000005a2",
		);
		expect(
			within(
				screen.getByRole("navigation", { name: "Điều hướng chính" }),
			).getAllByRole("button"),
		).toHaveLength(4);
		fireEvent.click(screen.getByRole("button", { name: "Quay lại" }));
		expect(await screen.findByTestId("home-loyalty")).toBeInTheDocument();
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

	it("lets the stand-in address choose the member's role, with one store for staff", () => {
		expect(standInMemberFrom("")).toEqual(standInMember);
		expect(standInMemberFrom("?role=viewer")).toEqual(standInMember);
		expect(standInMemberFrom("?role=owner")).toEqual({
			...standInMember,
			role: "owner",
		});
		expect(standInMemberFrom("?role=staff&revenue=none")).toEqual({
			...standInMember,
			role: "staff",
			stores: ["Cửa hàng Mẫu 1"],
		});
	});
});
