import { RestError } from "@fnb/zalo-mini";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LoyaltyClient, QueueAction } from "../loyalty/contract";
import { LOYALTY_PATHS } from "../loyalty/env";
import {
	NOON,
	primaryActions,
	renderLoyalty,
	STORE_1,
} from "../test/loyalty-harness";

async function list(): Promise<HTMLElement> {
	return screen.findByTestId("queue-list", {}, { timeout: 4000 });
}

function cards(): HTMLElement[] {
	return screen.getAllByTestId("queue-card");
}

function card(kind: string): HTMLElement {
	const found = cards().find(
		(element) => element.getAttribute("data-kind") === kind,
	);
	if (found === undefined) throw new Error(`no ${kind} card`);
	return found;
}

async function openCard(kind: string): Promise<HTMLElement> {
	fireEvent.click(within(card(kind)).getByRole("button", { name: /^Xử lý/ }));
	return screen.findByTestId("queue-item");
}

function reason(text: string) {
	fireEvent.change(screen.getByTestId("queue-reason"), {
		target: { value: text },
	});
}

function confirm() {
	fireEvent.click(screen.getByRole("button", { name: "Xác nhận" }));
}

function spyOnAct(client: LoyaltyClient): QueueAction[] {
	const actions: QueueAction[] = [];
	const act = client.act.bind(client);
	(client as { act: LoyaltyClient["act"] }).act = (action) => {
		actions.push(action);
		return act(action);
	};
	return actions;
}

beforeEach(() => {
	vi.useFakeTimers({ toFake: ["Date"] });
	vi.setSystemTime(NOON);
});

afterEach(() => {
	vi.useRealTimers();
});

describe("Hàng chờ thành viên for a manager", () => {
	it("lists the overdue dispute first with its flag, each item with a masked phone", async () => {
		renderLoyalty({ path: LOYALTY_PATHS.queue, role: "manager" });
		await list();
		expect(cards().map((element) => element.getAttribute("data-kind"))).toEqual(
			["dispute", "adjustment", "match"],
		);
		const dispute = card("dispute");
		expect(dispute).toHaveAttribute("data-overdue", "true");
		expect(within(dispute).getByTestId("queue-overdue")).toHaveTextContent(
			"Quá 48 giờ (50 giờ)",
		);
		expect(dispute).toHaveTextContent("Khách •••• ••• 678");
		expect(dispute).toHaveTextContent("+1 dấu · +8 điểm");
		expect(dispute).toHaveTextContent(
			"Nhân viên thử gửi lúc 10:00 ngày 17/11/2026",
		);
		expect(
			within(card("adjustment")).queryByTestId("queue-overdue"),
		).toBeNull();
		expect(primaryActions()).toHaveLength(1);
		expect(
			within(dispute).getByRole("button", { name: /^Xử lý/ }),
		).toHaveAttribute("data-action", "primary");
		for (const element of cards())
			expect(element.textContent).not.toMatch(/0900\d{6}/);
	});

	it("resolves an unclear invoice by picking it, with the manager's reason", async () => {
		const harness = renderLoyalty({
			path: LOYALTY_PATHS.queue,
			role: "manager",
		});
		await list();
		const actions = spyOnAct(harness.source().client);
		const item = await openCard("match");
		expect(item).toHaveTextContent(
			"Lượt ghi nhận lúc 11:20 khớp với nhiều hóa đơn",
		);
		const choices = screen.getByTestId("queue-choices");
		expect(
			within(choices)
				.getAllByRole("radio")
				.map((radio) =>
					radio.closest("label")?.textContent?.replace(/\s/g, " "),
				),
		).toEqual([
			"HD-0012 · 11:18 · 85.000 ₫",
			"HD-0013 · 11:21 · 85.000 ₫",
			"Không hóa đơn nào",
		]);
		confirm();
		expect(await screen.findByTestId("queue-problem-choice")).toHaveTextContent(
			"Hãy chọn một lựa chọn.",
		);
		expect(screen.getByTestId("queue-problem-reason")).toHaveTextContent(
			"Hãy ghi lý do.",
		);
		expect(actions).toEqual([]);
		fireEvent.click(within(choices).getByRole("radio", { name: /HD-0013/ }));
		reason("Giờ in hóa đơn khớp với lúc ghi nhận.");
		confirm();
		expect(await screen.findByTestId("result-modal")).toHaveTextContent(
			"Đã chọn hóa đơn",
		);
		expect(actions).toEqual([
			{
				kind: "match",
				itemId: "00000000-0000-4000-8000-0000d05a1001",
				invoiceId: "00000000-0000-4000-8000-0000f05a1013",
				reason: "Giờ in hóa đơn khớp với lúc ghi nhận.",
			},
		]);
		await waitFor(
			() =>
				expect(
					screen
						.getAllByTestId("queue-card")
						.map((element) => element.getAttribute("data-kind")),
				).toEqual(["dispute", "adjustment"]),
			{ timeout: 3500 },
		);
	});

	it("accepts a dispute with an adjustment and refuses an adjustment request, each with a reason", async () => {
		const harness = renderLoyalty({ path: LOYALTY_PATHS.queue, role: "owner" });
		await list();
		const actions = spyOnAct(harness.source().client);
		await openCard("dispute");
		fireEvent.click(
			screen.getByRole("radio", { name: "Chấp nhận và điều chỉnh" }),
		);
		expect(screen.getByTestId("queue-stamps")).toHaveValue("1");
		expect(screen.getByTestId("queue-points")).toHaveValue("8");
		reason("Đã đối chiếu hóa đơn trên máy POS.");
		confirm();
		expect(await screen.findByTestId("result-modal")).toHaveTextContent(
			"Đã duyệt",
		);
		await waitFor(() => expect(cards()).toHaveLength(2), { timeout: 3500 });
		await openCard("adjustment");
		fireEvent.click(screen.getByRole("radio", { name: "Từ chối" }));
		expect(screen.queryByTestId("queue-stamps")).toBeNull();
		reason("Không có hóa đơn nào lúc trưa.");
		confirm();
		expect(await screen.findByTestId("result-modal")).toHaveTextContent(
			"Đã từ chối",
		);
		expect(
			actions.map((action) => action.kind === "decide" && action.decision),
		).toEqual(["approved", "refused"]);
		expect(actions[0]).toMatchObject({ stamps: 1, points: 8 });
		expect(actions[1]).toMatchObject({ stamps: 0, points: 0 });
	}, 12_000);

	it("says an item already settled elsewhere is closed", async () => {
		const unused = () => Promise.reject(new Error("not used"));
		const client: LoyaltyClient = {
			async queue() {
				return [
					{
						id: "00000000-0000-4000-8000-00000000d009",
						kind: "adjustment",
						storeId: STORE_1,
						createdAt: NOON.toISOString(),
						phoneMasked: "•••• ••• 111",
						requestedBy: null,
						reason: "Thử.",
						stamps: 1,
						points: 0,
						match: null,
					},
				];
			},
			async act() {
				throw new RestError(400, "22023");
			},
			recordCheckin: unused,
			verifyRedemption: unused,
			lookupMember: unused,
			request: unused,
			myRequests: unused,
		};
		renderLoyalty({ path: LOYALTY_PATHS.queue, role: "manager", client });
		await list();
		await openCard("adjustment");
		fireEvent.click(screen.getByRole("radio", { name: "Duyệt" }));
		reason("Đúng.");
		confirm();
		expect(await screen.findByTestId("queue-closed")).toHaveTextContent(
			"Việc này đã được xử lý trước đó",
		);
	});
});

describe("Hàng chờ thành viên for staff", () => {
	it("refuses staff, who never read the queue", async () => {
		const harness = renderLoyalty({ path: LOYALTY_PATHS.queue, role: "staff" });
		expect(
			await screen.findByTestId("queue-refused", {}, { timeout: 4000 }),
		).toHaveTextContent("Chỉ chủ và quản lý cửa hàng xử lý hàng chờ này.");
		expect(screen.queryByTestId("queue-list")).toBeNull();
		await expect(harness.source().client.queue(STORE_1)).rejects.toMatchObject({
			code: "42501",
		});
	});

	it("shows staff the outcome of their own requests with the manager's reason", async () => {
		renderLoyalty({ path: LOYALTY_PATHS.requests, role: "staff" });
		const mine = await screen.findByTestId(
			"my-requests-list",
			{},
			{ timeout: 4000 },
		);
		const requests = within(mine).getAllByTestId("my-request");
		expect(
			requests.map((element) => element.getAttribute("data-state")),
		).toEqual(["approved", "refused"]);
		expect(requests[0]).toHaveTextContent("Đã duyệt");
		expect(requests[1]).toHaveTextContent("Bị từ chối");
		expect(
			within(requests[1] as HTMLElement).getByTestId("decision-reason"),
		).toHaveTextContent("Lý do: Hóa đơn đó đã được tích ở cửa hàng khác.");
		expect(mine.textContent).not.toMatch(/0900\d{6}/);
	});

	it("lists a request staff just sent as waiting for a manager", async () => {
		const harness = renderLoyalty({
			path: LOYALTY_PATHS.requests,
			role: "staff",
		});
		await screen.findByTestId("my-requests-list", {}, { timeout: 4000 });
		const receipt = await harness.source().client.request({
			kind: "dispute",
			storeId: STORE_1,
			membershipId: "00000000-0000-4000-8000-c00000000001",
			reason: "Khách báo thiếu dấu hôm qua.",
			stamps: 1,
			points: 0,
		});
		expect(receipt.state).toBe("pending");
		const requests = await harness.source().client.myRequests();
		expect(requests[0]).toMatchObject({
			kind: "dispute",
			state: "pending",
			phoneMasked: "•••• ••• 234",
		});
	});
});

describe("the home's member card", () => {
	it("shows a manager the open queue with the overdue count, and staff no queue", async () => {
		renderLoyalty({
			path: LOYALTY_PATHS.queue,
			role: "manager",
			withHome: true,
		});
		const home = await screen.findByTestId(
			"home-loyalty",
			{},
			{ timeout: 4000 },
		);
		expect(
			within(home)
				.getAllByRole("button")
				.filter((button) => button.getAttribute("data-action") === "primary")
				.map((button) => button.textContent),
		).toEqual(["Ghi nhận khách"]);
		expect(
			await within(home).findByTestId("home-loyalty-queue-count"),
		).toHaveTextContent("3 việc cần xử lý");
		expect(
			within(home).getByTestId("home-loyalty-queue-overdue"),
		).toHaveTextContent("1 khiếu nại quá 48 giờ");
		fireEvent.click(within(home).getByRole("button", { name: "Mở hàng chờ" }));
		expect(await list()).toBeInTheDocument();
	});

	it("gives staff the three tools and their requests, without the queue", async () => {
		renderLoyalty({
			path: LOYALTY_PATHS.checkIn,
			role: "staff",
			withHome: true,
		});
		const home = await screen.findByTestId(
			"home-loyalty",
			{},
			{ timeout: 4000 },
		);
		expect(within(home).queryByTestId("home-loyalty-queue")).toBeNull();
		expect(
			within(home)
				.getAllByRole("button")
				.map((button) => button.textContent),
		).toEqual([
			"Ghi nhận khách",
			"Kiểm tra ưu đãi",
			"Tra cứu thành viên",
			"Yêu cầu của tôi",
		]);
		fireEvent.click(
			within(home).getByRole("button", { name: "Ghi nhận khách" }),
		);
		expect(
			await screen.findByTestId("checkin-entry", {}, { timeout: 4000 }),
		).toBeInTheDocument();
	});
});
