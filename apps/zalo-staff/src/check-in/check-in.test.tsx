import { RestError } from "@fnb/zalo-mini";
import {
	cleanup,
	fireEvent,
	screen,
	waitFor,
	within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { nativeStorage } from "zmp-sdk";
import type {
	CheckinAnswer,
	CheckinRefusal,
	LoyaltyClient,
} from "../loyalty/contract";
import { DEMO_CODES } from "../loyalty/demo";
import { LOYALTY_PATHS } from "../loyalty/env";
import {
	DEMO_PHONES,
	fakeScanTools,
	NOON,
	primaryActions,
	renderLoyalty,
	STORE_1,
} from "../test/loyalty-harness";

async function entry(): Promise<HTMLInputElement> {
	return (await screen.findByTestId(
		"checkin-entry",
		{},
		{ timeout: 4000 },
	)) as HTMLInputElement;
}

function type(value: string) {
	fireEvent.change(screen.getByTestId("checkin-entry"), { target: { value } });
}

function record() {
	fireEvent.click(screen.getByRole("button", { name: "Ghi nhận" }));
}

function fakeClient(answer: CheckinAnswer | Error): LoyaltyClient & {
	readonly calls: unknown[];
} {
	const calls: unknown[] = [];
	const unused = () => Promise.reject(new Error("not used"));
	return {
		calls,
		async recordCheckin(input) {
			calls.push(input);
			if (answer instanceof Error) throw answer;
			return answer;
		},
		verifyRedemption: unused,
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

describe("Ghi nhận khách: the phone path", () => {
	it("checks a Vietnamese mobile number before any call, with one primary action", async () => {
		const client = fakeClient({
			outcome: "refused",
			refusal: null,
			textKey: null,
		});
		renderLoyalty({ path: LOYALTY_PATHS.checkIn, client });
		await entry();
		expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
			"Ghi nhận khách",
		);
		expect(primaryActions().map((element) => element.textContent)).toEqual([
			"Ghi nhận",
		]);
		record();
		expect(await screen.findByTestId("checkin-problem")).toHaveTextContent(
			"Hãy nhập số điện thoại hoặc mã thành viên của khách.",
		);
		type("0123456789");
		record();
		expect(screen.getByTestId("checkin-problem")).toHaveTextContent(
			"Số điện thoại chưa đúng. Số di động Việt Nam gồm 10 chữ số",
		);
		type("09000");
		record();
		expect(screen.getByTestId("checkin-problem")).toHaveTextContent(
			"Số điện thoại chưa đúng",
		);
		type("12345");
		record();
		expect(screen.getByTestId("checkin-problem")).toHaveTextContent(
			"mã thành viên đúng 6 số",
		);
		expect(client.calls).toEqual([]);
		type("09a00-00 1234");
		expect(screen.getByTestId("checkin-entry")).toHaveValue("0900001234");
	});

	it("records a member by phone and shows đang chờ xác nhận with the expected time, then clears the phone", async () => {
		const written = vi.spyOn(nativeStorage, "setItem");
		renderLoyalty({ path: LOYALTY_PATHS.checkIn });
		await entry();
		type(DEMO_PHONES.member);
		record();
		expect(
			screen.getByRole("button", { name: "Đang ghi nhận…" }),
		).toHaveAttribute("aria-busy", "true");
		expect(await screen.findByTestId("result-modal")).toHaveTextContent(
			"Đã ghi nhận khách",
		);
		const result = await screen.findByTestId("checkin-result");
		expect(result).toHaveAttribute("data-state", "pending");
		expect(screen.getByTestId("checkin-state")).toHaveTextContent(
			"Đang chờ xác nhận",
		);
		expect(screen.getByTestId("checkin-confirm-by")).toHaveTextContent(
			"Dự kiến xác nhận trước 12:10",
		);
		expect(screen.getByTestId("checkin-member")).toHaveTextContent(
			"Khách •••• ••• 234",
		);
		expect(document.body.textContent).not.toContain(DEMO_PHONES.member);
		expect(written).toHaveBeenCalled();
		expect(JSON.stringify(written.mock.calls)).not.toContain("900001234");
		await waitFor(
			() => expect(screen.queryByTestId("result-modal")).toBeNull(),
			{ timeout: 3000 },
		);
		expect(primaryActions().map((element) => element.textContent)).toEqual([
			"Ghi nhận khách khác",
		]);
		fireEvent.click(
			screen.getByRole("button", { name: "Ghi nhận khách khác" }),
		);
		expect(await entry()).toHaveValue("");
	});

	it("tells each refusal apart: not a member, a staff phone, the daily cap and a suspended card", async () => {
		renderLoyalty({ path: LOYALTY_PATHS.checkIn });
		await entry();
		const cases: readonly [string, string][] = [
			["0900009876", "Số này chưa là thành viên"],
			[DEMO_PHONES.staff, "Số điện thoại của nhân viên không được tích"],
			[DEMO_PHONES.capped, "Hôm nay khách đã tích đủ số hóa đơn tối đa"],
			[DEMO_PHONES.suspended, "Thẻ thành viên này đang tạm khóa"],
		];
		for (const [phone, message] of cases) {
			type(phone);
			record();
			await waitFor(() =>
				expect(screen.getByTestId("checkin-problem")).toHaveTextContent(
					message,
				),
			);
			expect(screen.getByTestId("checkin-entry")).toHaveValue(phone);
		}
		expect(screen.queryByTestId("checkin-result")).toBeNull();
	});

	it("words the database's other refusals and keeps the general message for an unknown one", async () => {
		const cases: readonly [CheckinRefusal | null, string][] = [
			["already_recorded", "Khách này vừa được ghi nhận ở cửa hàng này."],
			["no_programme", "Chương trình thành viên đang tạm dừng"],
			["below_minimum", "Hóa đơn chưa đạt mức tối thiểu"],
			["excluded_source", "Đơn từ kênh bán này không được tích"],
			["programme_inactive", "nằm ngoài thời gian của chương trình"],
			["membership_inactive", "Thẻ thành viên này đang tạm khóa"],
			[null, "Chưa ghi nhận được khách. Hãy thử lại."],
		];
		for (const [refusal, message] of cases) {
			cleanup();
			renderLoyalty({
				path: LOYALTY_PATHS.checkIn,
				client: fakeClient({ outcome: "refused", refusal, textKey: null }),
			});
			await entry();
			type(DEMO_PHONES.member);
			record();
			await waitFor(() =>
				expect(screen.getByTestId("checkin-problem")).toHaveTextContent(
					message,
				),
			);
		}
	});

	it("sends the store and the national phone, and shows a matched or queued answer as such", async () => {
		const client = fakeClient({
			outcome: "recorded",
			checkinId: "00000000-0000-4000-8000-00000000c0de",
			state: "matched",
			recordedAt: NOON.toISOString(),
			confirmBy: null,
			member: {
				membershipId: null,
				phoneMasked: "•••• ••• 678",
				displayName: null,
				stamps: 8,
				stampsPerCard: 8,
				points: 340,
			},
		});
		renderLoyalty({ path: LOYALTY_PATHS.checkIn, client });
		await entry();
		type("84900005678");
		record();
		expect(await screen.findByTestId("checkin-result")).toHaveAttribute(
			"data-state",
			"matched",
		);
		expect(client.calls).toEqual([
			{ storeId: STORE_1, entry: { kind: "phone", phone: DEMO_PHONES.second } },
		]);
		expect(screen.getByTestId("checkin-state")).toHaveTextContent(
			"Đã xác nhận",
		);
		expect(
			screen.getByText("Đã khớp với hóa đơn và cộng cho khách."),
		).toBeInTheDocument();
		expect(screen.queryByTestId("checkin-confirm-by")).toBeNull();
	});

	it("keeps the entry and says so when the connection drops", async () => {
		renderLoyalty({
			path: LOYALTY_PATHS.checkIn,
			client: fakeClient(new RestError(0)),
		});
		await entry();
		type(DEMO_PHONES.member);
		record();
		expect(await screen.findByTestId("loyalty-error")).toHaveTextContent(
			"Chưa gửi được vì mạng chập chờn",
		);
		expect(screen.getByTestId("checkin-entry")).toHaveValue(DEMO_PHONES.member);
	});
});

describe("Ghi nhận khách: the member code", () => {
	it("records a typed 6-digit code once, then refuses it as already recorded", async () => {
		renderLoyalty({ path: LOYALTY_PATHS.checkIn });
		await entry();
		type(DEMO_CODES.live);
		record();
		expect(await screen.findByTestId("checkin-result")).toHaveAttribute(
			"data-state",
			"pending",
		);
		await waitFor(
			() => expect(screen.queryByTestId("result-modal")).toBeNull(),
			{ timeout: 3000 },
		);
		fireEvent.click(
			screen.getByRole("button", { name: "Ghi nhận khách khác" }),
		);
		await entry();
		type(DEMO_CODES.live);
		record();
		expect(await screen.findByTestId("checkin-problem")).toHaveAttribute(
			"data-refusal",
			"code_used",
		);
	}, 10_000);

	it("refuses an expired code and a code made for another store", async () => {
		renderLoyalty({ path: LOYALTY_PATHS.checkIn });
		await entry();
		type(DEMO_CODES.expired);
		record();
		expect(await screen.findByTestId("checkin-problem")).toHaveTextContent(
			"Mã đã hết hạn. Mã chỉ dùng được trong 2 phút",
		);
		type(DEMO_CODES.otherStore);
		record();
		await waitFor(() =>
			expect(screen.getByTestId("checkin-problem")).toHaveTextContent(
				"Mã này được tạo cho cửa hàng khác",
			),
		);
		type("000001");
		record();
		await waitFor(() =>
			expect(screen.getByTestId("checkin-problem")).toHaveAttribute(
				"data-refusal",
				"code_unknown",
			),
		);
	});

	it("records a scanned member code in one tap", async () => {
		const scan = fakeScanTools([
			{ kind: "content", content: `fnb-member:1:q1:${DEMO_CODES.live}:sig` },
		]);
		renderLoyalty({ path: LOYALTY_PATHS.checkIn, scan });
		await entry();
		fireEvent.click(screen.getByRole("button", { name: "Quét mã thành viên" }));
		expect(await screen.findByTestId("checkin-result")).toHaveAttribute(
			"data-state",
			"pending",
		);
		expect(scan.calls).toEqual(["member"]);
		expect(screen.getByTestId("checkin-member")).toHaveTextContent(
			"Khách •••• ••• 234",
		);
	});

	it("falls back to typing the code when the scan permission is refused", async () => {
		const scan = fakeScanTools([{ kind: "refused" }]);
		renderLoyalty({ path: LOYALTY_PATHS.checkIn, scan });
		const input = await entry();
		fireEvent.click(screen.getByRole("button", { name: "Quét mã thành viên" }));
		expect(await screen.findByTestId("scan-refused")).toHaveTextContent(
			"Bạn chưa cho phép quét mã. Hãy nhập mã 6 số",
		);
		expect(document.activeElement).toBe(input);
		type(DEMO_CODES.live);
		record();
		expect(await screen.findByTestId("checkin-result")).toBeInTheDocument();
	});

	it("says a scanned code that is not a member code cannot be read, and a cancelled scan changes nothing", async () => {
		const scan = fakeScanTools([
			{ kind: "content", content: "https://example.com/not-a-code" },
			{ kind: "cancelled" },
		]);
		renderLoyalty({ path: LOYALTY_PATHS.checkIn, scan });
		await entry();
		const button = screen.getByRole("button", { name: "Quét mã thành viên" });
		fireEvent.click(button);
		expect(await screen.findByTestId("scan-unreadable")).toHaveTextContent(
			"Mã vừa quét không phải mã thành viên.",
		);
		fireEvent.click(button);
		await waitFor(() =>
			expect(screen.queryByTestId("scan-unreadable")).toBeNull(),
		);
		expect(screen.queryByTestId("checkin-result")).toBeNull();
		expect(scan.calls).toHaveLength(2);
	});
});

describe("Ghi nhận khách: from the result", () => {
	it("opens the member lookup of the recorded member and the reward check", async () => {
		renderLoyalty({ path: LOYALTY_PATHS.checkIn });
		await entry();
		type(DEMO_PHONES.member);
		record();
		const result = await screen.findByTestId("checkin-result");
		fireEvent.click(
			within(result).getByRole("button", { name: "Tra cứu thành viên" }),
		);
		const card = await screen.findByTestId(
			"member-card",
			{},
			{ timeout: 4000 },
		);
		expect(within(card).getByTestId("member-phone")).toHaveTextContent(
			"•••• ••• 234",
		);
		const visits = screen.getAllByTestId("visit");
		expect(visits[0]).toHaveAttribute("data-state", "pending");
		expect(visits[0]).toHaveTextContent("Số điện thoại trên hóa đơn");
	});
});
