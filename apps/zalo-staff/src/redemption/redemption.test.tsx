import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LoyaltyClient, RedemptionAnswer } from "../loyalty/contract";
import {
	DEMO_CODES,
	DEMO_DISCOUNT_NAME,
	DEMO_OTHER_STORE_NAME,
	DEMO_VOUCHER_CODE,
} from "../loyalty/demo";
import { LOYALTY_PATHS } from "../loyalty/env";
import {
	fakeScanTools,
	NOON,
	primaryActions,
	renderLoyalty,
	STORE_1,
} from "../test/loyalty-harness";

async function codeField(): Promise<HTMLInputElement> {
	return (await screen.findByTestId(
		"redeem-code",
		{},
		{ timeout: 4000 },
	)) as HTMLInputElement;
}

function check(code: string) {
	fireEvent.change(screen.getByTestId("redeem-code"), {
		target: { value: code },
	});
	fireEvent.click(screen.getByRole("button", { name: "Kiểm tra" }));
}

function answering(answer: RedemptionAnswer): LoyaltyClient & {
	readonly calls: unknown[];
} {
	const calls: unknown[] = [];
	const unused = () => Promise.reject(new Error("not used"));
	return {
		calls,
		async verifyRedemption(storeId, code) {
			calls.push({ storeId, code });
			return answer;
		},
		recordCheckin: unused,
		lookupMember: unused,
		request: unused,
		queue: unused,
		act: unused,
		myRequests: unused,
	};
}

beforeEach(() => {
	vi.useFakeTimers({ toFake: ["Date"] });
	vi.setSystemTime(NOON);
});

afterEach(() => {
	vi.useRealTimers();
});

describe("Kiểm tra ưu đãi: the instruction per rail", () => {
	it("tells the cashier which POS discount to choose and keeps the redemption pending", async () => {
		renderLoyalty({ path: LOYALTY_PATHS.redeem });
		await codeField();
		expect(primaryActions().map((element) => element.textContent)).toEqual([
			"Kiểm tra",
		]);
		check(DEMO_CODES.posReward);
		expect(await screen.findByTestId("result-modal")).toHaveTextContent(
			"Mã hợp lệ",
		);
		const instruction = await screen.findByTestId("redeem-instruction");
		expect(instruction).toHaveAttribute("data-kind", "pos_discount");
		expect(instruction).toHaveTextContent(
			"Trên máy POS, ở bước thanh toán, chọn chiết khấu có tên:",
		);
		expect(within(instruction).getByTestId("redeem-apply")).toHaveTextContent(
			DEMO_DISCOUNT_NAME,
		);
		expect(screen.getByTestId("redeem-reward")).toHaveTextContent(
			"Tặng 1 ly cà phê sữa",
		);
		expect(screen.getByTestId("redeem-state")).toHaveTextContent(
			"Đang chờ xác nhận",
		);
		expect(
			screen.getByText(
				"Ưu đãi được xác nhận khi hóa đơn có chiết khấu này đồng bộ về.",
			),
		).toBeInTheDocument();
		expect(screen.getByText("Giữ cho khách đến 12:30")).toBeInTheDocument();
		expect(screen.getByTestId("redeem-member")).toHaveTextContent(
			"Khách •••• ••• 234",
		);
		await waitFor(
			() => expect(screen.queryByTestId("result-modal")).toBeNull(),
			{ timeout: 3000 },
		);
		expect(primaryActions().map((element) => element.textContent)).toEqual([
			"Kiểm tra mã khác",
		]);
	});

	it("gives the CRM voucher code to type on the total screen, with the minimum bill", async () => {
		renderLoyalty({ path: LOYALTY_PATHS.redeem });
		await codeField();
		check(DEMO_CODES.voucherReward);
		const instruction = await screen.findByTestId("redeem-instruction");
		expect(instruction).toHaveAttribute("data-kind", "voucher_code");
		expect(instruction).toHaveTextContent(
			"Trên máy POS, ở màn hình tổng tiền, nhập mã voucher:",
		);
		expect(within(instruction).getByTestId("redeem-apply")).toHaveTextContent(
			DEMO_VOUCHER_CODE,
		);
		expect(screen.getByTestId("redeem-min-bill")).toHaveTextContent(
			/^Áp dụng cho hóa đơn từ 50\.000\s₫\.$/,
		);
	});

	it("sends the store and the code as typed, for a callback rail too", async () => {
		const client = answering({
			outcome: "accepted",
			redemptionId: "00000000-0000-4000-8000-00000000b001",
			rewardName: "Giảm 15.000 ₫",
			rail: "crm_callback",
			instruction: { kind: "voucher_code", voucherCode: "CB-7781" },
			minBillAmount: null,
			holdUntil: null,
			confirmBy: null,
			phoneMasked: null,
		});
		renderLoyalty({ path: LOYALTY_PATHS.redeem, client });
		await codeField();
		check(" cb-7781 ");
		expect(await screen.findByTestId("redeem-apply")).toHaveTextContent(
			"CB-7781",
		);
		expect(client.calls).toEqual([{ storeId: STORE_1, code: "cb-7781" }]);
		expect(screen.queryByTestId("redeem-member")).toBeNull();
		expect(screen.queryByTestId("redeem-min-bill")).toBeNull();
	});
});

describe("Kiểm tra ưu đãi: refusals", () => {
	it("refuses a code checked twice as used, with the store and time and never the customer", async () => {
		renderLoyalty({ path: LOYALTY_PATHS.redeem });
		await codeField();
		check(DEMO_CODES.posReward);
		await screen.findByTestId("redeem-result");
		await waitFor(
			() => expect(screen.queryByTestId("result-modal")).toBeNull(),
			{ timeout: 3000 },
		);
		fireEvent.click(screen.getByRole("button", { name: "Kiểm tra mã khác" }));
		await codeField();
		check(DEMO_CODES.posReward);
		const refused = await screen.findByTestId("redeem-refused");
		expect(refused).toHaveAttribute("data-refusal", "used");
		expect(refused).toHaveTextContent("Mã đã được sử dụng");
		expect(refused).toHaveTextContent(
			"Đã dùng lúc 12:00 ngày 19/11/2026 tại Cửa hàng Mẫu 1.",
		);
		expect(refused).toHaveTextContent("Không áp dụng ưu đãi cho hóa đơn này.");
		expect(refused.textContent).not.toMatch(/•|234|Khách/);
		expect(screen.queryByTestId("redeem-instruction")).toBeNull();
	}, 10_000);

	it("names the store and time of a code used elsewhere earlier", async () => {
		renderLoyalty({ path: LOYALTY_PATHS.redeem });
		await codeField();
		check(DEMO_CODES.used);
		const refused = await screen.findByTestId("redeem-refused");
		expect(refused).toHaveTextContent(
			`Đã dùng lúc 09:15 ngày 19/11/2026 tại ${DEMO_OTHER_STORE_NAME}.`,
		);
	});

	it("refuses an expired, unknown, other-store or returned code with its own message", async () => {
		renderLoyalty({ path: LOYALTY_PATHS.redeem });
		await codeField();
		const cases: readonly [string, string, string][] = [
			[DEMO_CODES.expiredReward, "expired", "Mã đã hết hạn"],
			["ZZ0000", "unknown", "Không tìm thấy mã này"],
			[
				DEMO_CODES.otherStoreReward,
				"wrong_store",
				"Mã không dùng được ở cửa hàng này",
			],
			[DEMO_CODES.releasedReward, "released", "Ưu đãi đã được hoàn lại"],
		];
		for (const [code, refusal, message] of cases) {
			check(code);
			await waitFor(() =>
				expect(screen.getByTestId("redeem-refused")).toHaveAttribute(
					"data-refusal",
					refusal,
				),
			);
			expect(screen.getByTestId("redeem-refused")).toHaveTextContent(message);
		}
	});

	it("asks for a code without spaces before calling", async () => {
		const client = answering({
			outcome: "refused",
			refusal: "unknown",
			textKey: null,
			usedAt: null,
			usedStoreName: null,
			expiredAt: null,
		});
		renderLoyalty({ path: LOYALTY_PATHS.redeem, client });
		await codeField();
		fireEvent.click(screen.getByRole("button", { name: "Kiểm tra" }));
		expect(await screen.findByRole("alert")).toHaveTextContent(
			"Hãy nhập mã ưu đãi, không có khoảng trắng.",
		);
		expect(client.calls).toEqual([]);
	});
});

describe("Kiểm tra ưu đãi: scanning", () => {
	it("checks a scanned reward code, and falls back to typing when the scan is refused", async () => {
		const scan = fakeScanTools([
			{ kind: "refused" },
			{ kind: "content", content: `fnb-redeem:1:${DEMO_CODES.voucherReward}` },
		]);
		renderLoyalty({ path: LOYALTY_PATHS.redeem, scan });
		const field = await codeField();
		const button = screen.getByRole("button", { name: "Quét mã ưu đãi" });
		fireEvent.click(button);
		expect(await screen.findByTestId("scan-refused")).toHaveTextContent(
			"Bạn chưa cho phép quét mã. Hãy nhập mã ưu đãi",
		);
		expect(document.activeElement).toBe(field);
		fireEvent.click(button);
		expect(await screen.findByTestId("redeem-apply")).toHaveTextContent(
			DEMO_VOUCHER_CODE,
		);
		expect(scan.calls).toEqual(["redemption", "redemption"]);
	});

	it("does not take a member code for a reward code", async () => {
		const scan = fakeScanTools([
			{ kind: "content", content: `fnb-member:1:q1:${DEMO_CODES.live}` },
		]);
		renderLoyalty({ path: LOYALTY_PATHS.redeem, scan });
		await codeField();
		fireEvent.click(screen.getByRole("button", { name: "Quét mã ưu đãi" }));
		expect(await screen.findByTestId("scan-unreadable")).toHaveTextContent(
			"Mã vừa quét không phải mã ưu đãi.",
		);
	});
});
