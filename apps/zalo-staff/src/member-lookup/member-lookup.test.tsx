import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LookupAnswer, LoyaltyClient } from "../loyalty/contract";
import { LOYALTY_PATHS } from "../loyalty/env";
import {
	DEMO_PHONES,
	NOON,
	primaryActions,
	renderLoyalty,
	STORE_1,
} from "../test/loyalty-harness";

async function phoneField(): Promise<HTMLInputElement> {
	return (await screen.findByTestId(
		"lookup-phone",
		{},
		{ timeout: 4000 },
	)) as HTMLInputElement;
}

function lookUp(phone: string) {
	fireEvent.change(screen.getByTestId("lookup-phone"), {
		target: { value: phone },
	});
	fireEvent.click(screen.getByRole("button", { name: "Tra cứu" }));
}

async function openForm(name: "Báo khiếu nại" | "Điều chỉnh") {
	fireEvent.click(await screen.findByRole("button", { name }));
	return screen.findByTestId("request-form");
}

function setField(testId: string, value: string) {
	fireEvent.change(screen.getByTestId(testId), { target: { value } });
}

beforeEach(() => {
	vi.useFakeTimers({ toFake: ["Date"] });
	vi.setSystemTime(NOON);
});

afterEach(() => {
	vi.useRealTimers();
});

describe("Tra cứu thành viên", () => {
	it("shows a masked card with stamps, points and tier, and today's visits at this store", async () => {
		renderLoyalty({ path: LOYALTY_PATHS.lookup });
		await phoneField();
		lookUp(DEMO_PHONES.member);
		const card = await screen.findByTestId("member-card");
		expect(within(card).getByTestId("member-phone")).toHaveTextContent(
			"•••• ••• 234",
		);
		expect(within(card).getByTestId("member-stamps")).toHaveTextContent("5/8");
		expect(within(card).getByTestId("member-points")).toHaveTextContent("120");
		expect(within(card).getByTestId("member-tier")).toHaveTextContent(
			"Hạng Bạc",
		);
		expect(card).toHaveTextContent("Thành viên từ 02/09/2026");
		expect(
			screen.getByRole("heading", { name: "Hôm nay tại Cửa hàng Mẫu 1" }),
		).toBeInTheDocument();
		const visits = screen.getAllByTestId("visit");
		expect(visits).toHaveLength(1);
		expect(visits[0]).toHaveTextContent("08:40 · Mã thành viên");
		expect(visits[0]).toHaveTextContent("+1 dấu · +6 điểm · Hóa đơn HD-0007");
		expect(visits[0]).toHaveTextContent("Đã xác nhận");
		expect(document.body.textContent).not.toContain("0900001234");
		expect(primaryActions().map((element) => element.textContent)).toEqual([
			"Tra cứu số khác",
		]);
		fireEvent.click(screen.getByRole("button", { name: "Tra cứu số khác" }));
		expect(await phoneField()).toHaveValue("");
	});

	it("masks a full phone even when the answer carries one", async () => {
		const answer: LookupAnswer = {
			found: true,
			card: {
				membershipId: "00000000-0000-4000-8000-0000000c0009",
				phoneMasked: "0900007777",
				displayName: null,
				memberSince: null,
				status: "suspended",
				tierName: null,
				stamps: 1,
				stampsPerCard: 8,
				stampsPending: 1,
				points: 10,
				pointsPending: 0,
			},
			storeName: null,
			today: [],
			limits: null,
		};
		const unused = () => Promise.reject(new Error("not used"));
		const calls: unknown[] = [];
		const client: LoyaltyClient = {
			async lookupMember(storeId, query) {
				calls.push({ storeId, query });
				return answer;
			},
			recordCheckin: unused,
			verifyRedemption: unused,
			request: unused,
			queue: unused,
			act: unused,
			myRequests: unused,
		};
		renderLoyalty({ path: LOYALTY_PATHS.lookup, client });
		await phoneField();
		lookUp("0900007777");
		const card = await screen.findByTestId("member-card");
		expect(calls).toEqual([
			{ storeId: STORE_1, query: { kind: "phone", phone: "0900007777" } },
		]);
		expect(within(card).getByTestId("member-phone")).toHaveTextContent(
			"•••• ••• 777",
		);
		expect(document.body.textContent).not.toContain("0900007777");
		expect(within(card).getByTestId("member-status")).toHaveTextContent(
			"Đang tạm khóa",
		);
		expect(card).toHaveTextContent("+1 đang chờ xác nhận");
		expect(screen.getByTestId("visits-none")).toHaveTextContent(
			"Hôm nay khách chưa có lượt mua nào ở cửa hàng này.",
		);
		expect(screen.queryByRole("button", { name: "Điều chỉnh" })).toBeNull();
	});

	it("says a phone is not a member and checks the phone first", async () => {
		renderLoyalty({ path: LOYALTY_PATHS.lookup });
		await phoneField();
		lookUp("0901");
		expect(await screen.findByRole("alert")).toHaveTextContent(
			"Số điện thoại chưa đúng",
		);
		lookUp("0900009876");
		expect(await screen.findByTestId("lookup-not-found")).toHaveTextContent(
			"Số này chưa là thành viên của chương trình.",
		);
		lookUp(DEMO_PHONES.staff);
		await waitFor(() =>
			expect(screen.getByTestId("lookup-not-found")).toBeInTheDocument(),
		);
	});

	it("writes a staff adjustment within the threshold at once and shows it today", async () => {
		renderLoyalty({ path: LOYALTY_PATHS.lookup });
		await phoneField();
		lookUp(DEMO_PHONES.member);
		const form = await openForm("Điều chỉnh");
		expect(form).toHaveTextContent(
			"Điều chỉnh đến 2 dấu và 20 điểm được ghi ngay; lớn hơn thì chờ quản lý duyệt.",
		);
		expect(screen.getByTestId("privacy-reminder")).toHaveTextContent(
			"Không ghi thông tin cá nhân",
		);
		fireEvent.click(screen.getByRole("button", { name: "Gửi" }));
		expect(
			await screen.findByTestId("request-reason-problem"),
		).toHaveTextContent("Hãy ghi lý do.");
		setField("request-reason", "Khách mua 1 ly lúc máy POS mất mạng.");
		expect(screen.queryByTestId("request-needs-manager")).toBeNull();
		fireEvent.click(screen.getByRole("button", { name: "Gửi" }));
		expect(await screen.findByTestId("result-modal")).toHaveTextContent(
			"Đã điều chỉnh",
		);
		await waitFor(
			() =>
				expect(screen.getByTestId("member-stamps")).toHaveTextContent("6/8"),
			{ timeout: 3500 },
		);
		expect(
			screen
				.getAllByTestId("visit")
				.some((visit) => visit.textContent?.includes("Điều chỉnh")),
		).toBe(true);
	});

	it("sends an adjustment above the threshold to a manager", async () => {
		renderLoyalty({ path: LOYALTY_PATHS.lookup });
		await phoneField();
		lookUp(DEMO_PHONES.second);
		await openForm("Điều chỉnh");
		const more = screen.getByRole("button", {
			name: "Thêm 1: Dấu (+ cộng, − trừ)",
		});
		fireEvent.click(more);
		fireEvent.click(more);
		expect(screen.getByTestId("request-stamps")).toHaveValue("3");
		expect(screen.getByTestId("request-needs-manager")).toHaveTextContent(
			"Vượt ngưỡng nên sẽ chờ quản lý duyệt.",
		);
		setField("request-reason", "Máy POS lỗi, khách mua 3 ly.");
		fireEvent.click(screen.getByRole("button", { name: "Gửi" }));
		expect(await screen.findByTestId("result-modal")).toHaveTextContent(
			"Đã gửi quản lý duyệt",
		);
	});

	it("needs a number to adjust and records a dispute for the manager", async () => {
		renderLoyalty({ path: LOYALTY_PATHS.lookup });
		await phoneField();
		lookUp(DEMO_PHONES.member);
		await openForm("Điều chỉnh");
		setField("request-stamps", "0");
		setField("request-reason", "Thử.");
		fireEvent.click(screen.getByRole("button", { name: "Gửi" }));
		expect(
			await screen.findByTestId("request-amount-problem"),
		).toHaveTextContent("Hãy nhập số dấu hoặc số điểm cần điều chỉnh.");
		setField("request-points", "1-5");
		fireEvent.click(screen.getByRole("button", { name: "Gửi" }));
		await waitFor(() =>
			expect(screen.getByTestId("request-amount-problem")).toHaveTextContent(
				"Hãy nhập số nguyên",
			),
		);
		fireEvent.click(screen.getByRole("button", { name: "Quay lại" }));
		await openForm("Báo khiếu nại");
		expect(screen.getByTestId("request-stamps")).toHaveValue("0");
		setField(
			"request-reason",
			"Khách báo hóa đơn sáng nay chưa được tích dấu.",
		);
		fireEvent.click(screen.getByRole("button", { name: "Gửi" }));
		expect(await screen.findByTestId("result-modal")).toHaveTextContent(
			"Đã gửi khiếu nại cho quản lý",
		);
	});

	it("opens straight on a member chosen on the check-in result", async () => {
		renderLoyalty({
			path: LOYALTY_PATHS.lookup,
			membershipId: "00000000-0000-4000-8000-c00000000002",
		});
		const card = await screen.findByTestId(
			"member-card",
			{},
			{ timeout: 4000 },
		);
		expect(within(card).getByTestId("member-phone")).toHaveTextContent(
			"•••• ••• 678",
		);
		expect(within(card).getByTestId("member-tier")).toHaveTextContent(
			"Hạng Vàng",
		);
	});
});
