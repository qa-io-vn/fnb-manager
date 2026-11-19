import { REFUSAL, RestError } from "@fnb/zalo-mini";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TEAM_PATHS } from "../team/env";
import { primaryActions, renderTeam, screenReady } from "../test/team-harness";
import { refusalProblem } from "./approval-queue";
import {
	decideArgs,
	readKinds,
	readOwnRequests,
	readQueue,
	sortQueue,
	submitArgs,
} from "./contract";
import { requestProblems } from "./send-request";

async function modalClosed(): Promise<void> {
	await waitFor(() => expect(screen.queryByTestId("result-modal")).toBeNull(), {
		timeout: 3000,
	});
}

describe("the request answers", () => {
	it("read the kinds, the member's requests and the queue, and send trimmed text", () => {
		expect(
			readKinds([
				{ key: "mua_hang", label: "Mua hàng", sort_order: 10, active: true },
				{ key: "cu", label: "Cũ", sort_order: 20, active: false },
			]),
		).toEqual([{ key: "mua_hang", label: "Mua hàng" }]);
		expect(
			readOwnRequests([
				{
					request_id: "r1",
					tenant_id: "t",
					store_id: "s1",
					kind_key: "khac",
					kind_label: null,
					details: "Chi tiết",
					status: "refused",
					requested_at: "2026-11-18T01:00:00+00:00",
					decided_by: "m",
					decided_at: "2026-11-18T02:00:00+00:00",
					refusal_reason: "Thiếu ảnh",
				},
			]),
		).toEqual([
			{
				id: "r1",
				storeId: "s1",
				kindKey: "khac",
				kindLabel: null,
				details: "Chi tiết",
				status: "refused",
				requestedAt: "2026-11-18T01:00:00+00:00",
				decidedAt: "2026-11-18T02:00:00+00:00",
				refusalReason: "Thiếu ảnh",
			},
		]);
		const queue = readQueue([
			{
				request_id: "b",
				tenant_id: "t",
				store_id: "s1",
				kind_key: "khac",
				kind_label: "Khác",
				details: "Sau",
				requested_by: "u",
				requester_name: null,
				requested_at: "2026-11-18T03:00:00+00:00",
			},
			{
				request_id: "a",
				tenant_id: "t",
				store_id: "s1",
				kind_key: "khac",
				kind_label: "Khác",
				details: "Trước",
				requested_by: "u",
				requester_name: "An",
				requested_at: "2026-11-18T01:00:00+00:00",
			},
		]);
		expect(sortQueue(queue).map((request) => request.id)).toEqual(["a", "b"]);
		expect(
			submitArgs({ storeId: "s1", kindKey: "khac", details: "  Xin nghỉ  " }),
		).toEqual({ p_store_id: "s1", p_kind_key: "khac", p_details: "Xin nghỉ" });
		expect(decideArgs("r", { decision: "approved" })).toEqual({
			p_request_id: "r",
			p_decision: "approved",
		});
		expect(decideArgs("r", { decision: "refused", reason: " Thiếu " })).toEqual(
			{ p_request_id: "r", p_decision: "refused", p_reason: "Thiếu" },
		);
		expect(requestProblems(null, " ")).toEqual(["kind", "empty"]);
		expect(requestProblems("khac", "x".repeat(1001))).toEqual(["long"]);
		expect(refusalProblem("  ")).toBe("empty");
		expect(refusalProblem("x".repeat(501))).toBe("long");
		expect(refusalProblem("Thiếu ảnh")).toBeNull();
	});
});

describe("Gửi yêu cầu and Yêu cầu của tôi", () => {
	it("checks the kind and details, sends the request and shows it waiting", async () => {
		const harness = renderTeam({ path: TEAM_PATHS.sendRequest });
		await screenReady("ask-kinds");
		const submit = vi.spyOn(harness.source().client, "submit");
		expect(primaryActions()).toHaveLength(1);
		fireEvent.click(screen.getByRole("button", { name: "Gửi" }));
		expect(screen.getByTestId("ask-problem-kind")).toHaveTextContent(
			"Hãy chọn loại yêu cầu.",
		);
		expect(screen.getByTestId("ask-problem-empty")).toBeInTheDocument();
		expect(submit).not.toHaveBeenCalled();
		fireEvent.click(
			screen.getByRole("radio", { name: "Mua hàng cho cửa hàng" }),
		);
		fireEvent.change(screen.getByTestId("ask-details"), {
			target: { value: "Mua 3 cuộn giấy in hóa đơn." },
		});
		fireEvent.click(screen.getByRole("button", { name: "Gửi" }));
		expect(await screen.findByTestId("result-modal")).toHaveTextContent(
			"Đã gửi yêu cầu cho quản lý",
		);
		expect(submit).toHaveBeenCalledWith({
			storeId: "00000000-0000-4000-8000-0000000005a1",
			kindKey: "mua_hang",
			details: "Mua 3 cuộn giấy in hóa đơn.",
		});
		await modalClosed();
		const list = await screenReady("own-requests");
		const first = within(list).getAllByTestId("own-request")[0] as HTMLElement;
		expect(first.dataset.status).toBe("pending");
		expect(first).toHaveTextContent("Mua 3 cuộn giấy in hóa đơn.");
		expect(within(first).getByTestId("request-status")).toHaveTextContent(
			"Chờ duyệt",
		);
	});

	it("shows each request's state and the reason of a refusal", async () => {
		renderTeam({ path: TEAM_PATHS.myRequests });
		const list = await screenReady("own-requests");
		const items = within(list).getAllByTestId("own-request");
		expect(items.map((item) => item.dataset.status)).toEqual([
			"approved",
			"refused",
		]);
		expect(
			within(items[0] as HTMLElement).queryByTestId("refusal-reason"),
		).toBeNull();
		expect(
			within(items[1] as HTMLElement).getByTestId("refusal-reason"),
		).toHaveTextContent("Lý do từ chối: Cần ghi rõ giờ và số hóa đơn.");
		expect(
			within(items[1] as HTMLElement).getByTestId("decided-at"),
		).toHaveTextContent(/^Từ chối lúc \d{2}:\d{2} ngày/);
		expect(primaryActions()).toHaveLength(1);
		fireEvent.click(screen.getByRole("button", { name: "Gửi yêu cầu" }));
		await screenReady("ask-kinds");
	});

	it("says when the kind is no longer active", async () => {
		const harness = renderTeam({ path: TEAM_PATHS.sendRequest });
		await screenReady("ask-kinds");
		vi.spyOn(harness.source().client, "submit").mockRejectedValueOnce(
			new RestError(400, REFUSAL.invalid),
		);
		fireEvent.click(screen.getByRole("radio", { name: "Khác" }));
		fireEvent.change(screen.getByTestId("ask-details"), {
			target: { value: "Xin thêm khăn lau." },
		});
		fireEvent.click(screen.getByRole("button", { name: "Gửi" }));
		expect(await screen.findByTestId("ask-failed")).toHaveTextContent(
			"Loại yêu cầu này không còn dùng.",
		);
	});
});

describe("the approval queue", () => {
	it("is for managers only", async () => {
		const harness = renderTeam({ path: TEAM_PATHS.approvals });
		expect(await screen.findByTestId("approvals-refused")).toBeInTheDocument();
		const queue = vi.spyOn(harness.source().client, "queue");
		expect(queue).not.toHaveBeenCalled();
		expect(primaryActions()).toHaveLength(1);
	});

	it("lists the oldest first and approves with a result modal that closes", async () => {
		const harness = renderTeam({ path: TEAM_PATHS.approvals, role: "manager" });
		const list = await screenReady("approval-list");
		const decide = vi.spyOn(harness.source().client, "decide");
		const cards = within(list).getAllByTestId("approval-card");
		expect(cards).toHaveLength(3);
		expect(cards[0]).toHaveTextContent("Xin đổi ca chiều thứ Sáu");
		expect(cards[2]).toHaveTextContent("Mua 5 kg đá viên");
		expect(primaryActions()).toHaveLength(1);
		fireEvent.click(
			screen.getByRole("button", {
				name: "Xem và duyệt: Khác của Nhân viên Mẫu Bình",
			}),
		);
		await screenReady("approval-detail");
		expect(primaryActions()).toHaveLength(1);
		fireEvent.click(screen.getByRole("button", { name: "Duyệt" }));
		expect(await screen.findByTestId("result-modal")).toHaveTextContent(
			"Đã duyệt yêu cầu",
		);
		expect(decide).toHaveBeenCalledWith(expect.any(String), {
			decision: "approved",
		});
		await modalClosed();
		await waitFor(() =>
			expect(screen.getAllByTestId("approval-card")).toHaveLength(2),
		);
	});

	it("refuses only with a reason", async () => {
		const harness = renderTeam({ path: TEAM_PATHS.approvals, role: "owner" });
		await screenReady("approval-list");
		const decide = vi.spyOn(harness.source().client, "decide");
		fireEvent.click(
			screen.getByRole("button", {
				name: "Xem và duyệt: Mua hàng cho cửa hàng của Nhân viên Mẫu An",
			}),
		);
		await screenReady("approval-detail");
		fireEvent.click(screen.getByRole("button", { name: "Từ chối" }));
		expect(primaryActions()).toHaveLength(1);
		fireEvent.click(screen.getByRole("button", { name: "Từ chối yêu cầu" }));
		expect(screen.getByTestId("refusal-problem")).toHaveTextContent(
			"Hãy ghi lý do từ chối.",
		);
		expect(decide).not.toHaveBeenCalled();
		fireEvent.change(screen.getByTestId("refusal-input"), {
			target: { value: "Máy làm đá đã sửa xong." },
		});
		fireEvent.click(screen.getByRole("button", { name: "Từ chối yêu cầu" }));
		expect(await screen.findByTestId("result-modal")).toHaveTextContent(
			"Đã từ chối yêu cầu",
		);
		expect(decide).toHaveBeenCalledWith(expect.any(String), {
			decision: "refused",
			reason: "Máy làm đá đã sửa xong.",
		});
		await modalClosed();
		await waitFor(() =>
			expect(screen.getAllByTestId("approval-card")).toHaveLength(2),
		);
	});

	it("tells the manager when another manager decided first", async () => {
		const harness = renderTeam({ path: TEAM_PATHS.approvals, role: "manager" });
		await screenReady("approval-list");
		vi.spyOn(harness.source().client, "decide").mockRejectedValueOnce(
			new RestError(400, REFUSAL.state),
		);
		fireEvent.click(
			screen.getAllByRole("button", {
				name: /^Xem và duyệt/,
			})[0] as HTMLElement,
		);
		await screenReady("approval-detail");
		fireEvent.click(screen.getByRole("button", { name: "Duyệt" }));
		expect(await screen.findByTestId("approval-failed")).toHaveTextContent(
			"Yêu cầu này đã được quản lý khác xử lý.",
		);
		expect(primaryActions()).toHaveLength(1);
		fireEvent.click(
			screen.getByRole("button", { name: "Về danh sách chờ duyệt" }),
		);
		await screenReady("approval-list");
	});

	it("shows a store-limited manager the requests of their store only", async () => {
		renderTeam({
			path: TEAM_PATHS.approvals,
			role: "manager",
			stores: ["Cửa hàng Mẫu 2"],
		});
		const list = await screenReady("approval-list");
		const cards = within(list).getAllByTestId("approval-card");
		expect(cards).toHaveLength(1);
		expect(cards[0]).toHaveTextContent("Nhân viên Mẫu Chi");
	});
});
