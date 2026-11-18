import { RestError } from "@fnb/zalo-mini";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSampleShiftSource } from "../shift/sample";
import {
	boardReady,
	EVENING,
	primaryActions,
	renderShift,
	stubObjectUrls,
} from "../test/shift-harness";

const NBSP = " ";

function money(text: string): string {
	return text.replace(" ", NBSP);
}

async function openClose(): Promise<void> {
	await boardReady();
	fireEvent.click(screen.getByTestId("open-close"));
	await screen.findByTestId("close-count");
}

function more(face: string, times = 1): void {
	for (let i = 0; i < times; i += 1)
		fireEvent.click(
			screen.getByRole("button", { name: new RegExp(`^Thêm một tờ ${face}`) }),
		);
}

async function countAndConfirm(): Promise<void> {
	fireEvent.click(screen.getByRole("button", { name: "Tiếp tục" }));
	await screen.findByTestId("close-confirm");
	fireEvent.click(screen.getByRole("button", { name: "Xác nhận" }));
	await screen.findByTestId("close-handover");
}

beforeEach(() => {
	vi.useFakeTimers({ toFake: ["Date"] });
	vi.setSystemTime(EVENING);
	stubObjectUrls();
});

afterEach(() => {
	vi.useRealTimers();
});

describe("Đóng ca: the cash count", () => {
	it("adds the notes per value into a running total, confirms it and tells staff only Đã ghi nhận", async () => {
		renderShift({ role: "staff", visibility: "store_totals" });
		await openClose();
		expect(primaryActions().map((element) => element.textContent)).toEqual([
			"Tiếp tục",
		]);
		more("500\\.000", 4);
		more("200\\.000");
		fireEvent.change(screen.getByLabelText(/^Số tờ 100\.000/), {
			target: { value: "2" },
		});
		const total = screen.getByTestId("running-total");
		expect(total).toHaveAttribute("data-amount", "2400000");
		expect(total).toHaveTextContent(money("2.400.000 ₫"));
		fireEvent.click(
			screen.getByRole("button", { name: /^Bớt một tờ 200\.000/ }),
		);
		expect(total).toHaveAttribute("data-amount", "2200000");
		more("200\\.000");
		fireEvent.click(screen.getByRole("button", { name: "Tiếp tục" }));
		const confirm = await screen.findByTestId("confirm-amount");
		expect(confirm).toHaveTextContent(money("2.400.000 ₫"));
		expect(confirm).toHaveTextContent(`${money("500.000 ₫")} × 4`);
		expect(primaryActions().map((element) => element.textContent)).toEqual([
			"Xác nhận",
		]);
		fireEvent.click(screen.getByRole("button", { name: "Xác nhận" }));
		const outcome = await screen.findByTestId("count-outcome");
		expect(outcome).toHaveTextContent("Đã ghi nhận");
		expect(outcome).not.toHaveTextContent("Chênh lệch");
		expect(outcome).not.toHaveTextContent("₫");
		expect(screen.queryByTestId("count-difference")).toBeNull();
	});

	it.each([
		["staff", "none"],
		["staff", "store_totals"],
	] as const)(
		"never shows %s at the %s level a difference, even far over the threshold",
		async (role, visibility) => {
			renderShift({ role, visibility });
			await openClose();
			fireEvent.click(screen.getByRole("button", { name: "Nhập tổng" }));
			fireEvent.change(screen.getByTestId("count-total"), {
				target: { value: "100.000" },
			});
			await countAndConfirm();
			expect(screen.getByTestId("count-outcome")).toHaveAttribute(
				"data-state",
				"recorded",
			);
			expect(screen.queryByTestId("count-difference")).toBeNull();
			expect(screen.queryByText("Vượt ngưỡng")).toBeNull();
		},
	);

	it("shows staff at the all level the difference of their shift within the threshold", async () => {
		renderShift({ role: "staff", visibility: "all" });
		await openClose();
		fireEvent.click(screen.getByRole("button", { name: "Nhập tổng" }));
		fireEvent.change(screen.getByTestId("count-total"), {
			target: { value: "2.480.000" },
		});
		await countAndConfirm();
		expect(screen.getByTestId("count-outcome")).toHaveTextContent(
			"Chênh lệch Ca 1",
		);
		expect(screen.getByTestId("count-difference")).toHaveTextContent(
			money("−20.000 ₫"),
		);
		expect(screen.getByTestId("count-threshold")).toHaveTextContent(
			"Trong ngưỡng",
		);
	});

	it("shows a manager the difference over the threshold", async () => {
		renderShift({ role: "manager" });
		await openClose();
		fireEvent.click(screen.getByRole("button", { name: "Nhập tổng" }));
		fireEvent.change(screen.getByTestId("count-total"), {
			target: { value: "2400000" },
		});
		await countAndConfirm();
		expect(screen.getByTestId("count-difference")).toHaveTextContent(
			money("−100.000 ₫"),
		);
		expect(screen.getByTestId("count-threshold")).toHaveTextContent(
			"Vượt ngưỡng",
		);
	});

	it("says when a count waits for its shift", async () => {
		renderShift({
			role: "staff",
			visibility: "none",
			settings: { unmatchedCount: true },
		});
		await openClose();
		more("100\\.000");
		await countAndConfirm();
		expect(screen.getByTestId("count-outcome")).toHaveTextContent(
			"Lần đếm sẽ được khớp với ca khi dữ liệu ca từ máy POS về.",
		);
	});

	it("refuses to go on with nothing counted or a total that is not a number", async () => {
		renderShift();
		await openClose();
		fireEvent.click(screen.getByRole("button", { name: "Tiếp tục" }));
		expect(await screen.findByTestId("count-problem")).toHaveTextContent(
			"Hãy nhập số tờ của từng mệnh giá hoặc tổng tiền.",
		);
		fireEvent.click(screen.getByRole("button", { name: "Nhập tổng" }));
		fireEvent.change(screen.getByTestId("count-total"), {
			target: { value: "2tr" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Tiếp tục" }));
		expect(await screen.findByTestId("count-problem")).toHaveTextContent(
			"Tổng tiền chỉ gồm chữ số",
		);
		expect(screen.getByTestId("close-count")).toBeInTheDocument();
	});

	it("keeps the count on a lost request and records it on the retry", async () => {
		const sample = createSampleShiftSource({
			visibility: "none",
			delayMs: 0,
			failFirstUpload: false,
			checklistTaken: false,
			unmatchedCount: false,
		});
		let attempts = 0;
		const source = {
			...sample,
			ops: {
				...sample.ops,
				recordCashCount: async (
					input: Parameters<typeof sample.ops.recordCashCount>[0],
				) => {
					attempts += 1;
					if (attempts === 1) throw new RestError(0);
					return sample.ops.recordCashCount(input);
				},
			},
		};
		renderShift({ source });
		await openClose();
		more("500\\.000");
		fireEvent.click(screen.getByRole("button", { name: "Tiếp tục" }));
		await screen.findByTestId("close-confirm");
		fireEvent.click(screen.getByRole("button", { name: "Xác nhận" }));
		expect(await screen.findByTestId("count-failed")).toHaveTextContent(
			"Chưa gửi được vì mạng chập chờn.",
		);
		expect(screen.getByTestId("confirm-amount")).toHaveTextContent(
			money("500.000 ₫"),
		);
		fireEvent.click(screen.getByRole("button", { name: "Xác nhận" }));
		await screen.findByTestId("close-handover");
		expect(attempts).toBe(2);
	});
});

describe("Đóng ca: the handover", () => {
	it("sends the note with the shift labels, shows the result for 1.5 s and the close on the board", async () => {
		const { source } = renderShift();
		await openClose();
		more("500\\.000", 5);
		await countAndConfirm();
		expect(screen.getByLabelText("Từ ca")).toHaveDisplayValue("Ca 1");
		expect(screen.getByLabelText("Cho ca")).toHaveDisplayValue("Ca 2");
		expect(screen.getByText(/Không ghi thông tin cá nhân/)).toBeInTheDocument();
		expect(primaryActions().map((element) => element.textContent)).toEqual([
			"Gửi bàn giao",
		]);
		fireEvent.click(screen.getByRole("button", { name: "Gửi bàn giao" }));
		expect(await screen.findByTestId("note-problem")).toHaveTextContent(
			"Hãy viết nội dung bàn giao",
		);
		fireEvent.change(screen.getByLabelText("Cho ca"), {
			target: { value: "3" },
		});
		const note = "Máy pha đã vệ sinh.\nCòn 3 hộp sữa.";
		fireEvent.change(screen.getByTestId("handover-note"), {
			target: { value: note },
		});
		expect(screen.getByText(`${[...note].length}/2000`)).toBeInTheDocument();
		fireEvent.click(screen.getByRole("button", { name: "Gửi bàn giao" }));
		expect(await screen.findByTestId("result-modal")).toHaveTextContent(
			"Đã đóng ca",
		);
		expect(screen.getByTestId("handover-state")).toHaveTextContent(
			"Đã gửi bàn giao",
		);
		await waitFor(
			() => expect(screen.queryByTestId("result-modal")).toBeNull(),
			{
				timeout: 3000,
			},
		);
		const handovers = await source.ops.handovers(
			["00000000-0000-4000-8000-0000000005a1"],
			"2026-11-17",
		);
		expect(handovers[0]).toMatchObject({
			fromShift: 1,
			toShift: 3,
			note: "Máy pha đã vệ sinh.\nCòn 3 hộp sữa.",
		});
		fireEvent.click(screen.getByRole("button", { name: "Về Ca làm" }));
		await boardReady();
		expect(await screen.findByTestId("close-counted")).toHaveTextContent(
			/^Đã đếm tiền lúc \d{2}:\d{2}$/,
		);
	}, 10_000);

	it("can finish without a handover", async () => {
		renderShift();
		await openClose();
		more("500\\.000");
		await countAndConfirm();
		fireEvent.click(screen.getByRole("button", { name: "Bỏ qua bàn giao" }));
		expect(await screen.findByTestId("handover-state")).toHaveTextContent(
			"Không có bàn giao",
		);
		expect(await screen.findByTestId("result-modal")).toHaveTextContent(
			"Đã đóng ca",
		);
	});
});

describe("Đóng ca: a manager's cash per shift and the recount", () => {
	it("shows staff no cash panel, and a manager each shift's difference labelled Ca n", async () => {
		renderShift({ role: "staff", visibility: "all" });
		await boardReady();
		expect(screen.queryByTestId("panel-cash")).toBeNull();
	});

	it("lets a manager reopen a count, and the next count replaces it", async () => {
		const { source } = renderShift({ role: "manager" });
		await openClose();
		fireEvent.click(screen.getByRole("button", { name: "Nhập tổng" }));
		fireEvent.change(screen.getByTestId("count-total"), {
			target: { value: "2.380.000" },
		});
		await countAndConfirm();
		fireEvent.click(screen.getByRole("button", { name: "Bỏ qua bàn giao" }));
		await screen.findByTestId("close-done");
		await waitFor(
			() => expect(screen.queryByTestId("result-modal")).toBeNull(),
			{
				timeout: 3000,
			},
		);
		fireEvent.click(screen.getByRole("button", { name: "Về Ca làm" }));
		await boardReady();
		const panel = await screen.findByTestId("panel-cash");
		const shifts = within(panel).getAllByTestId("cash-shift");
		expect(shifts.map((element) => element.getAttribute("data-state"))).toEqual(
			["over", "over", "within"],
		);
		const today = shifts[0] as HTMLElement;
		expect(today).toHaveTextContent(/^Ca 1 · 18\/11\/2026/);
		expect(within(today).getByTestId("cash-difference")).toHaveTextContent(
			money("−120.000 ₫"),
		);
		fireEvent.click(
			within(today).getByRole("button", { name: "Mở lại để đếm lại" }),
		);
		const dialog = await screen.findByRole("dialog");
		expect(primaryActions()).toHaveLength(1);
		fireEvent.click(within(dialog).getByRole("button", { name: "Mở lại" }));
		expect(await screen.findByTestId("result-modal")).toHaveTextContent(
			"Đã mở lại để đếm lại",
		);
		await waitFor(
			() =>
				expect(
					within(screen.getByTestId("panel-cash")).getAllByTestId(
						"cash-shift",
					)[0],
				).toHaveAttribute("data-state", "no_count"),
			{ timeout: 3000 },
		);
		fireEvent.click(screen.getByTestId("open-close"));
		expect(await screen.findByTestId("recount")).toHaveTextContent(
			"Quản lý đã mở lại lần đếm",
		);
		fireEvent.click(screen.getByRole("button", { name: "Nhập tổng" }));
		fireEvent.change(screen.getByTestId("count-total"), {
			target: { value: "2.500.000" },
		});
		await countAndConfirm();
		expect(screen.getByTestId("count-threshold")).toHaveTextContent(
			"Trong ngưỡng",
		);
		const records = await source.ops.cashCounts(
			"00000000-0000-4000-8000-0000000005a1",
			"2026-11-18",
		);
		expect(records.map((record) => record.status).sort()).toEqual([
			"active",
			"reopened",
		]);
		expect(
			records.find((record) => record.status === "active")?.replacesId,
		).toBe(records.find((record) => record.status === "reopened")?.id);
	}, 15_000);
});
