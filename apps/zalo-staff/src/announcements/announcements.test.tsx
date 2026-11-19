import { REFUSAL, RestError } from "@fnb/zalo-mini";
import {
	act,
	fireEvent,
	screen,
	waitFor,
	within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEMO_LINK_TEXT, DEMO_TITLES, demoId } from "../team/demo";
import { TEAM_PATHS } from "../team/env";
import { primaryActions, renderTeam, screenReady } from "../test/team-harness";

afterEach(() => {
	vi.useRealTimers();
});

function cards(): HTMLElement[] {
	return screen.getAllByTestId("notice-card");
}

async function openNotice(title: string): Promise<HTMLElement> {
	fireEvent.click(
		await screen.findByRole("button", { name: new RegExp(title) }),
	);
	return screenReady("notice-detail");
}

describe("the Thông báo tab for staff", () => {
	it("lists the pinned notice first and marks the unread ones", async () => {
		renderTeam({ path: TEAM_PATHS.notices });
		await screenReady("notices-list");
		const list = cards();
		expect(list.map((card) => card.dataset.pinned)).toEqual([
			"true",
			"false",
			"false",
		]);
		expect(list[0]).toHaveTextContent(DEMO_TITLES.pinned);
		expect(
			within(list[0] as HTMLElement).getByTestId("notice-pinned"),
		).toHaveTextContent("Đã ghim");
		expect(list.map((card) => card.dataset.unread)).toEqual([
			"true",
			"true",
			"false",
		]);
		expect(list[2]).toHaveTextContent(DEMO_TITLES.read);
		expect(screen.queryByRole("button", { name: "Soạn thông báo" })).toBeNull();
		expect(primaryActions()).toHaveLength(0);
	});

	it("records Đã đọc from the detail, its one primary action, and drops the marker", async () => {
		const harness = renderTeam({ path: TEAM_PATHS.notices });
		await screenReady("notices-list");
		const detail = await openNotice(DEMO_TITLES.unread);
		expect(primaryActions()).toHaveLength(1);
		expect(primaryActions()[0]).toHaveTextContent("Đã đọc");
		expect(within(detail).queryByTestId("notice-read-rate")).toBeNull();
		fireEvent.click(within(detail).getByRole("button", { name: "Đã đọc" }));
		expect(await screen.findByTestId("notice-read-at")).toHaveTextContent(
			/^Đã đọc lúc \d{2}:\d{2} ngày \d{2}\/\d{2}\/\d{4}$/,
		);
		expect(primaryActions()).toHaveLength(0);
		const id = harness.demo().announcementIds()[1] as string;
		expect(harness.demo().readOf(id)).not.toBeNull();
		fireEvent.click(screen.getByRole("button", { name: "Quay lại" }));
		await screenReady("notices-list");
		const card = cards().find((candidate) => candidate.dataset.id === id);
		expect(card?.dataset.unread).toBe("false");
	});

	it("shows the body as plain text, so a web address is never a link", async () => {
		renderTeam({ path: TEAM_PATHS.notices });
		await screenReady("notices-list");
		const detail = await openNotice(DEMO_TITLES.pinned);
		const body = within(detail).getByTestId("notice-body");
		expect(body).toHaveTextContent(DEMO_LINK_TEXT);
		expect(body.textContent).toContain("\n");
		expect(document.querySelectorAll("a")).toHaveLength(0);
		expect(within(detail).getByTestId("notice-pinned-until")).toHaveTextContent(
			/^Ghim đến \d{2}:\d{2} ngày/,
		);
	});

	it("opens the notice a home card asked for", async () => {
		renderTeam({
			path: TEAM_PATHS.notices,
			open: { announcementId: demoId("e", 2) },
		});
		const detail = await screenReady("notice-detail");
		expect(within(detail).getByRole("heading", { level: 1 })).toHaveTextContent(
			DEMO_TITLES.unread,
		);
		fireEvent.click(screen.getByRole("button", { name: "Quay lại" }));
		await screenReady("notices-list");
	});

	it("says so when the notice asked for is gone", async () => {
		renderTeam({
			path: TEAM_PATHS.notices,
			open: { announcementId: demoId("e", 99) },
		});
		expect(await screen.findByTestId("notice-missing")).toHaveTextContent(
			"Thông báo này không còn hiển thị.",
		);
		expect(primaryActions()).toHaveLength(1);
	});

	it("keeps the notice unread and says why when the receipt fails", async () => {
		const failing = renderTeam({
			path: TEAM_PATHS.notices,
		});
		await screenReady("notices-list");
		const client = failing.source().client;
		vi.spyOn(client, "markRead").mockRejectedValueOnce(new RestError(0));
		const detail = await openNotice(DEMO_TITLES.unread);
		fireEvent.click(within(detail).getByRole("button", { name: "Đã đọc" }));
		expect(await screen.findByTestId("notice-read-failed")).toHaveTextContent(
			"Chưa gửi được vì mạng chập chờn",
		);
		expect(
			within(detail).getByRole("button", { name: "Đã đọc" }),
		).toBeEnabled();
	});
});

describe("the Thông báo tab for managers", () => {
	it("shows the read rate and who has not read yet, only for the manager's own stores", async () => {
		renderTeam({
			path: TEAM_PATHS.notices,
			role: "manager",
			stores: ["Cửa hàng Mẫu 1"],
		});
		await screenReady("notices-list");
		await openNotice(DEMO_TITLES.pinned);
		const rate = await screen.findByTestId("notice-rate-value");
		expect(rate).toHaveTextContent("1/3 người đã đọc (33 %)");
		expect(screen.getByTestId("notice-rate-early")).toHaveTextContent(
			"1 người đọc trong 24 giờ đầu",
		);
		const unread = screen
			.getAllByTestId("unread-reader")
			.map((row) => row.textContent);
		expect(unread).toHaveLength(2);
		expect(unread.join(" ")).toContain("Nhân viên Mẫu Bình");
		expect(unread.join(" ")).not.toContain("Nhân viên Mẫu Chi");
		expect(unread.join(" ")).not.toContain("Nhân viên Mẫu Dũng");
	});

	it("counts every store for a manager of both", async () => {
		renderTeam({ path: TEAM_PATHS.notices, role: "owner" });
		await screenReady("notices-list");
		await openNotice(DEMO_TITLES.pinned);
		expect(await screen.findByTestId("notice-rate-value")).toHaveTextContent(
			"2/5 người đã đọc (40 %)",
		);
	});

	it("does not ask the author to mark their own notice read", async () => {
		renderTeam({ path: TEAM_PATHS.notices, role: "manager" });
		await screenReady("notices-list");
		const detail = await openNotice(DEMO_TITLES.own);
		expect(within(detail).getByTestId("notice-own")).toBeInTheDocument();
		expect(within(detail).queryByRole("button", { name: "Đã đọc" })).toBeNull();
		expect(await screen.findByTestId("notice-rate-value")).toHaveTextContent(
			"1/3 người đã đọc (33 %)",
		);
	});

	it("checks a draft, publishes it to the chosen stores with a pin and lists it first", async () => {
		const harness = renderTeam({ path: TEAM_PATHS.notices, role: "manager" });
		await screenReady("notices-list");
		const publish = vi.spyOn(harness.source().client, "publish");
		fireEvent.click(screen.getByRole("button", { name: "Soạn thông báo" }));
		await screenReady("notice-compose");
		expect(primaryActions()).toHaveLength(1);
		fireEvent.click(screen.getByRole("button", { name: "Đăng thông báo" }));
		expect(screen.getByTestId("notice-problem-title")).toHaveTextContent(
			"Hãy nhập tiêu đề.",
		);
		expect(screen.getByTestId("notice-problem-body")).toHaveTextContent(
			"Hãy nhập nội dung.",
		);
		expect(publish).not.toHaveBeenCalled();
		fireEvent.change(screen.getByTestId("notice-title"), {
			target: { value: "Đổi mật khẩu Wi-Fi" },
		});
		fireEvent.change(screen.getByTestId("notice-text"), {
			target: { value: "Mật khẩu mới dán ở quầy.\nKhông đọc cho khách." },
		});
		fireEvent.click(screen.getByRole("checkbox", { name: "Cửa hàng Mẫu 2" }));
		fireEvent.change(screen.getByTestId("notice-pin"), {
			target: { value: "7" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Đăng thông báo" }));
		const modal = await screen.findByTestId("result-modal");
		expect(modal).toHaveTextContent("Đã đăng cho 3 người");
		const [tenantId, draft] = publish.mock.calls[0] ?? [];
		expect(tenantId).toBe("00000000-0000-4000-8000-0000000000a0");
		expect(draft?.storeIds).toEqual(["00000000-0000-4000-8000-0000000005a1"]);
		expect(draft?.pinnedUntil).not.toBeNull();
		await waitFor(
			() => expect(screen.queryByTestId("result-modal")).toBeNull(),
			{
				timeout: 3000,
			},
		);
		await screenReady("notices-list");
		await waitFor(() =>
			expect(cards()[0]).toHaveTextContent("Đổi mật khẩu Wi-Fi"),
		);
		expect(cards()[0]?.dataset.pinned).toBe("true");
	});

	it("says a manager may publish only to stores they manage", async () => {
		const harness = renderTeam({ path: TEAM_PATHS.notices, role: "manager" });
		await screenReady("notices-list");
		vi.spyOn(harness.source().client, "publish").mockRejectedValueOnce(
			new RestError(403, REFUSAL.notAllowed),
		);
		fireEvent.click(screen.getByRole("button", { name: "Soạn thông báo" }));
		await screenReady("notice-compose");
		fireEvent.change(screen.getByTestId("notice-title"), {
			target: { value: "Họp" },
		});
		fireEvent.change(screen.getByTestId("notice-text"), {
			target: { value: "Họp lúc 8 giờ." },
		});
		await act(async () => {
			fireEvent.click(screen.getByRole("button", { name: "Đăng thông báo" }));
		});
		expect(
			await screen.findByTestId("notice-publish-failed"),
		).toHaveTextContent("Bạn chỉ đăng được cho cửa hàng mình quản lý.");
	});
});
