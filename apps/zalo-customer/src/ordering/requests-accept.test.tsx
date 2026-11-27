import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { renderOrderingApp } from "../test/render-ordering";
import { acceptRefusalKey } from "./requests-screen";

// Component integration of "Đồng ý giờ mới" on the customer's requests (native-till.md 18.2, design spec C17's
// booking list: "Quán đề xuất {time}" with "Đồng ý giờ mới" and "Hủy"), on the demo world:
// - state transitions (use case): new → proposed → (the customer accepts) confirmed at the time proposed: the card
//   reads "Đã nhận", "Giờ hẹn: <the new time>", that the customer accepted, and the accept and decline buttons go;
// - one request id per attempt: a double tap is one acceptance; a lost answer and a second tap send the same id and
//   are one acceptance (a new id would be refused not_allowed, so the test tells them apart);
// - the refusals worded (equivalence partitions): proposal_expired once the time passed, not_allowed when the store
//   confirmed meanwhile (the card then reads the new state), the others by their key, an unknown one generally;
// - security (error guessing): the store's message with markup is shown as text.

const TABLE = "?store=mau-1&src=table&t=demo-table-12";

async function openRequests(): Promise<HTMLElement> {
	fireEvent.click(
		within(screen.getByRole("navigation")).getByText("Tôi", { exact: true }),
	);
	await screen.findAllByTestId("account-row");
	fireEvent.click(
		screen
			.getAllByTestId("account-row")
			.find(
				(row) => row.getAttribute("data-row") === "requests",
			) as HTMLElement,
	);
	return await screen.findByTestId("my-request");
}

describe("the customer accepts the time proposed", () => {
	it("confirms the booking at the new time (new → proposed → confirmed)", async () => {
		const { till } = renderOrderingApp({ search: TABLE });
		await screen.findByTestId("ordering-menu");
		till.addRequest();
		till.proposeRequest();
		const card = await openRequests();
		expect(within(card).getByTestId("my-request-proposed")).toHaveTextContent(
			"Hợp giờ này thì bạn bấm Đồng ý giờ mới",
		);
		const accept = within(card).getByTestId("my-request-accept");
		expect(accept).toHaveTextContent("Đồng ý giờ mới");
		fireEvent.click(accept);
		expect(await screen.findByTestId("my-requests-done")).toHaveTextContent(
			/Đã đồng ý giờ mới\. Quán giữ chỗ cho bạn lúc 19:30/,
		);
		await waitFor(() =>
			expect(screen.getByTestId("my-request-status")).toHaveTextContent(
				"Đã nhận",
			),
		);
		const confirmed = screen.getByTestId("my-request");
		expect(within(confirmed).getByTestId("my-request-asked")).toHaveTextContent(
			/^Giờ hẹn: 19:30/,
		);
		expect(
			within(confirmed).getByTestId("my-request-accepted"),
		).toHaveTextContent("Bạn đã đồng ý giờ quán đề xuất.");
		expect(within(confirmed).queryByTestId("my-request-accept")).toBeNull();
		expect(within(confirmed).queryByTestId("my-request-proposed")).toBeNull();
		// a confirmed booking can still be cancelled
		expect(
			within(confirmed).getByTestId("my-request-cancel"),
		).toHaveTextContent("Hủy yêu cầu");
		expect(till.requestStatus()).toBe("confirmed");
		expect(till.acceptances()).toBe(1);
	});

	it("makes one acceptance of a double tap", async () => {
		const { till } = renderOrderingApp({
			search: TABLE,
			settings: { answerDelayMs: 300 },
		});
		await screen.findByTestId("ordering-menu");
		till.addRequest();
		till.proposeRequest();
		const card = await openRequests();
		const accept = within(card).getByTestId("my-request-accept");
		fireEvent.click(accept);
		fireEvent.click(accept);
		expect(accept).toBeDisabled();
		await screen.findByTestId("my-requests-done");
		expect(till.acceptances()).toBe(1);
		expect(screen.queryByTestId("my-requests-problem")).toBeNull();
	});

	it("sends the same id again after a lost answer: one acceptance, no refusal", async () => {
		const { till } = renderOrderingApp({
			search: TABLE,
			settings: { network: "lost-once" },
		});
		await screen.findByTestId("ordering-menu");
		till.addRequest();
		till.proposeRequest();
		const card = await openRequests();
		fireEvent.click(within(card).getByTestId("my-request-accept"));
		expect(await screen.findByTestId("my-requests-problem")).toHaveTextContent(
			"Chưa gửi được. Kiểm tra mạng rồi bấm lại, quán chỉ ghi nhận một lần.",
		);
		// the change was committed and its answer lost
		expect(till.requestStatus()).toBe("confirmed");
		const again = within(screen.getByTestId("my-request")).getByTestId(
			"my-request-accept",
		);
		fireEvent.click(again);
		expect(await screen.findByTestId("my-requests-done")).toHaveTextContent(
			"Đã đồng ý giờ mới",
		);
		expect(screen.queryByTestId("my-requests-problem")).toBeNull();
		expect(till.acceptances()).toBe(1);
	});
});

describe("the refusals are worded", () => {
	it("proposal_expired once the time proposed has passed", async () => {
		let clock = Date.now();
		const { till } = renderOrderingApp({ search: TABLE, now: () => clock });
		await screen.findByTestId("ordering-menu");
		till.addRequest();
		till.proposeRequest();
		const card = await openRequests();
		clock += 3 * 24 * 3_600_000;
		fireEvent.click(within(card).getByTestId("my-request-accept"));
		expect(await screen.findByTestId("my-requests-problem")).toHaveTextContent(
			"Giờ quán đề xuất đã qua nên không đồng ý được nữa.",
		);
		expect(till.requestStatus()).toBe("proposed");
		expect(till.acceptances()).toBe(0);
	});

	it("not_allowed when the store confirmed meanwhile, then the card reads its new state", async () => {
		const { till } = renderOrderingApp({ search: TABLE });
		await screen.findByTestId("ordering-menu");
		till.addRequest();
		till.proposeRequest();
		const card = await openRequests();
		till.confirmRequest();
		fireEvent.click(within(card).getByTestId("my-request-accept"));
		expect(await screen.findByTestId("my-requests-problem")).toHaveTextContent(
			"Yêu cầu này không còn chờ bạn trả lời.",
		);
		await waitFor(() =>
			expect(screen.getByTestId("my-request-status")).toHaveTextContent(
				"Đã nhận",
			),
		);
		expect(screen.queryByTestId("my-request-accepted")).toBeNull();
		expect(till.acceptances()).toBe(0);
	});

	it("names each refusal by its key and any other generally", () => {
		expect(acceptRefusalKey("proposal_expired")).toBe(
			"myRequests.acceptRefusal.proposal_expired",
		);
		expect(acceptRefusalKey("not_allowed")).toBe(
			"myRequests.acceptRefusal.not_allowed",
		);
		expect(acceptRefusalKey("unknown_request")).toBe(
			"myRequests.acceptRefusal.unknown_request",
		);
		expect(acceptRefusalKey("request_conflict")).toBe(
			"myRequests.acceptRefusal.request_conflict",
		);
		expect(acceptRefusalKey("rate_limited")).toBe(
			"myRequests.acceptRefusal.other",
		);
	});
});

describe("the store's message (security)", () => {
	it("is shown as text, never as markup", async () => {
		const { till } = renderOrderingApp({ search: TABLE });
		await screen.findByTestId("ordering-menu");
		till.addRequest();
		till.proposeRequest(undefined, '<img src=x onerror="alert(1)">');
		const card = await openRequests();
		const proposed = within(card).getByTestId("my-request-proposed");
		expect(proposed).toHaveTextContent('<img src=x onerror="alert(1)">');
		expect(proposed.querySelector("img")).toBeNull();
	});
});
