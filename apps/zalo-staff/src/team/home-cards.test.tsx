import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DEMO_STORE_1, DEMO_TITLES } from "../team/demo";
import { renderTeam, screenReady } from "../test/team-harness";
import { TeamHomeNotices, TeamHomeRequests } from "./home-cards";

function renderHome(role: "staff" | "manager" | "owner" = "staff") {
	return renderTeam({
		path: "/",
		role,
		home: (sourceFor) => (
			<>
				<TeamHomeNotices storeId={DEMO_STORE_1} sourceFor={sourceFor} />
				<TeamHomeRequests storeId={DEMO_STORE_1} sourceFor={sourceFor} />
			</>
		),
	});
}

describe("the home cards of phase 15", () => {
	it("show the pinned notice and the unread count, and open the notice", async () => {
		renderHome();
		const notices = await screenReady("home-notices");
		const pinned = within(notices).getAllByTestId("home-pinned");
		expect(pinned).toHaveLength(1);
		expect(pinned[0]).toHaveTextContent(DEMO_TITLES.pinned);
		expect(pinned[0]?.dataset.unread).toBe("true");
		expect(within(notices).getByTestId("home-unread-count")).toHaveTextContent(
			"Bạn có 2 thông báo chưa đọc.",
		);
		fireEvent.click(
			within(notices).getByRole("button", {
				name: new RegExp(DEMO_TITLES.pinned),
			}),
		);
		const detail = await screenReady("notice-detail");
		expect(within(detail).getByRole("heading", { level: 1 })).toHaveTextContent(
			DEMO_TITLES.pinned,
		);
		fireEvent.click(within(detail).getByRole("button", { name: "Đã đọc" }));
		await screen.findByTestId("notice-read-at");
	});

	it("give staff Gửi yêu cầu and Yêu cầu của tôi but no approval queue", async () => {
		renderHome();
		const requests = await screenReady("home-requests");
		expect(within(requests).queryByTestId("home-approvals")).toBeNull();
		fireEvent.click(
			within(requests).getByRole("button", { name: "Yêu cầu của tôi" }),
		);
		await screenReady("own-requests");
	});

	it("give managers the pending count and the way to the queue", async () => {
		renderHome("manager");
		const requests = await screenReady("home-requests");
		await waitFor(() =>
			expect(
				within(requests).getByTestId("home-pending-count"),
			).toHaveTextContent("3 yêu cầu chờ duyệt"),
		);
		fireEvent.click(
			within(requests).getByRole("button", { name: "Mở hàng chờ duyệt" }),
		);
		await screenReady("approval-list");
	});

	it("start Gửi yêu cầu at the store of the home", async () => {
		renderHome("owner");
		const requests = await screenReady("home-requests");
		fireEvent.click(
			within(requests).getByRole("button", { name: "Gửi yêu cầu" }),
		);
		await screenReady("ask-kinds");
		expect(screen.getByTestId("ask-store")).toHaveValue(DEMO_STORE_1);
	});
});
