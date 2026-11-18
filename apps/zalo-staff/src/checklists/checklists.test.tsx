import { RestError } from "@fnb/zalo-mini";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSampleShiftSource } from "../shift/sample";
import {
	AFTERNOON,
	boardReady,
	EVENING,
	fakePhotoTools,
	MORNING,
	primaryActions,
	renderShift,
	stubObjectUrls,
} from "../test/shift-harness";
import { startOnce } from "./checklist-run";

const STORE = "00000000-0000-4000-8000-0000000005a1";

function cards(): HTMLElement[] {
	return screen.getAllByTestId("checklist-card");
}

function card(title: string): HTMLElement {
	const found = cards().find((element) =>
		within(element).queryByRole("heading", { name: title }),
	);
	if (found === undefined) throw new Error(`no card ${title}`);
	return found;
}

async function openRun(
	title: string,
	action = "Bắt đầu",
): Promise<HTMLElement> {
	await boardReady();
	fireEvent.click(
		within(card(title)).getByRole("button", { name: `${action}: ${title}` }),
	);
	const state = await screen.findByTestId("checklist-run-state");
	return state;
}

function items(): HTMLElement[] {
	return screen.getAllByTestId("checklist-item");
}

function itemNamed(label: string): HTMLElement {
	const found = items().find((element) => within(element).queryByText(label));
	if (found === undefined) throw new Error(`no item ${label}`);
	return found;
}

beforeEach(() => {
	vi.useFakeTimers({ toFake: ["Date"] });
	vi.setSystemTime(MORNING);
	stubObjectUrls();
});

afterEach(() => {
	vi.useRealTimers();
});

describe("Ca làm: the checklists due", () => {
	it("puts the checklist of the current shift phase first, as the one primary action", async () => {
		renderShift();
		const board = await boardReady();
		expect(board).toHaveAttribute("data-phase", "opening");
		expect(screen.getByTestId("shift-phase")).toHaveTextContent(
			"Bây giờ: Mở ca",
		);
		const titles = cards().map(
			(element) => within(element).getByRole("heading").textContent,
		);
		expect(titles).toEqual(["Mở ca", "Vệ sinh giữa ca", "Đóng ca"]);
		expect(within(card("Mở ca")).getByText("Đến giờ")).toBeInTheDocument();
		expect(
			within(card("Mở ca")).getByText("4 việc · 2 cần ảnh"),
		).toBeInTheDocument();
		expect(primaryActions()).toHaveLength(1);
		expect(primaryActions()[0]).toHaveAccessibleName("Bắt đầu: Mở ca");
	});

	it("follows the store's opening hours through the day", async () => {
		vi.setSystemTime(AFTERNOON);
		renderShift();
		expect(await boardReady()).toHaveAttribute("data-phase", "midshift");
		expect(cards()[0]).toHaveTextContent("Vệ sinh giữa ca");
	});

	it("makes Đóng ca the primary action once the phase's checklist is done", async () => {
		vi.setSystemTime(EVENING);
		const source = createSampleShiftSource({
			visibility: "all",
			delayMs: 0,
			failFirstUpload: false,
			checklistTaken: false,
			unmatchedCount: false,
		});
		const closing = (await source.ops.dueChecklists(STORE)).find(
			(checklist) => checklist.shiftPhase === "closing",
		);
		const run = await source.ops.startChecklistRun(
			closing?.templateId ?? "",
			STORE,
		);
		await source.ops.finishChecklistRun(run.runId);
		renderShift({ source });
		await boardReady();
		expect(primaryActions()[0]).toHaveTextContent("Đóng ca");
		expect(primaryActions()).toHaveLength(1);
		expect(
			within(card("Đóng ca")).getByTestId("checklist-state"),
		).toHaveTextContent(/^Đã xong lúc \d{2}:\d{2}$/);
	});
});

describe("Ca làm: running a checklist", () => {
	it("needs the photo before a photo item is done, uploads the resized photo and counts the progress", async () => {
		const { source, tools } = renderShift();
		const state = await openRun("Mở ca");
		expect(state).toHaveAttribute("data-access", "edit");
		expect(state).toHaveAttribute("data-version", "1");
		expect(screen.getByTestId("checklist-progress")).toHaveTextContent(
			"Đã xong 0/4 việc",
		);
		const counter = itemNamed("Lau quầy, bàn ghế khu khách");
		fireEvent.click(within(counter).getByRole("checkbox"));
		expect(await within(counter).findByTestId("item-block")).toHaveTextContent(
			"Cần chụp ảnh trước khi đánh dấu đã làm.",
		);
		expect(within(counter).getByRole("checkbox")).not.toBeChecked();
		expect(
			within(counter).getByText(/Máy ảnh chỉ mở khi bạn chạm Chụp ảnh/),
		).toBeInTheDocument();
		expect(tools.taken).toBe(0);
		fireEvent.click(within(counter).getByRole("button", { name: "Chụp ảnh" }));
		await waitFor(() =>
			expect(within(counter).getByRole("checkbox")).toBeChecked(),
		);
		expect(tools.taken).toBe(1);
		expect(tools.resized).toBe(1);
		const preview = within(counter).getByTestId("photo-preview");
		expect(preview).toHaveAttribute("data-width", "1280");
		expect(Number(preview.getAttribute("data-bytes"))).toBeLessThanOrEqual(
			1_000_000,
		);
		expect(within(counter).getByText("Đã có ảnh")).toBeInTheDocument();
		expect(screen.getByTestId("checklist-progress")).toHaveTextContent(
			"Đã xong 1/4 việc",
		);
		const run = (await source.ops.dueChecklists(STORE))[0]?.run;
		const saved = await source.ops.checklistRun(run?.id ?? "");
		expect(saved?.items[1]?.photoPath).toMatch(/\/run\/.+\/p-1\.jpg$/);
	});

	it("needs a valid number before a number item is done", async () => {
		renderShift();
		await openRun("Mở ca");
		const fridge = itemNamed("Nhiệt độ tủ mát");
		fireEvent.click(within(fridge).getByRole("checkbox"));
		expect(await within(fridge).findByTestId("item-block")).toHaveTextContent(
			"Cần nhập số đo",
		);
		const input = within(fridge).getByLabelText("Số đo (°C)");
		fireEvent.change(input, { target: { value: "bốn" } });
		fireEvent.click(within(fridge).getByRole("checkbox"));
		expect(await within(fridge).findByTestId("item-block")).toHaveTextContent(
			"Số đo chưa đúng",
		);
		fireEvent.change(input, { target: { value: "4,5" } });
		fireEvent.click(within(fridge).getByRole("checkbox"));
		await waitFor(() =>
			expect(within(fridge).getByRole("checkbox")).toBeChecked(),
		);
		expect(within(fridge).queryByTestId("item-block")).toBeNull();
	});

	it("keeps the app usable when the camera is refused: the item stays open with a hint", async () => {
		renderShift({ tools: fakePhotoTools([{ kind: "refused" }]) });
		await openRun("Mở ca");
		const counter = itemNamed("Lau quầy, bàn ghế khu khách");
		fireEvent.click(within(counter).getByRole("button", { name: "Chụp ảnh" }));
		expect(
			await within(counter).findByTestId("camera-refused"),
		).toHaveTextContent("Bạn chưa cho phép dùng máy ảnh nên mục này vẫn để mở");
		expect(within(counter).getByRole("checkbox")).not.toBeChecked();
		const machine = itemNamed("Bật máy pha cà phê và kiểm tra áp suất");
		fireEvent.click(within(machine).getByRole("checkbox"));
		await waitFor(() =>
			expect(within(machine).getByRole("checkbox")).toBeChecked(),
		);
		expect(
			within(counter).getByRole("button", { name: "Chụp ảnh" }),
		).toBeEnabled();
		expect(screen.getByRole("button", { name: "Hoàn thành" })).toBeEnabled();
	});

	it("shows a failed upload with a retry that sends the same photo again", async () => {
		const { tools } = renderShift({ settings: { failFirstUpload: true } });
		await openRun("Mở ca");
		const counter = itemNamed("Lau quầy, bàn ghế khu khách");
		fireEvent.click(within(counter).getByRole("button", { name: "Chụp ảnh" }));
		expect(
			await within(counter).findByTestId("upload-failed"),
		).toHaveTextContent(
			"Ảnh chưa tải lên được. Chưa gửi được vì mạng chập chờn.",
		);
		fireEvent.click(within(counter).getByRole("button", { name: "Thử lại" }));
		await waitFor(() =>
			expect(within(counter).getByRole("checkbox")).toBeChecked(),
		);
		expect(tools.taken).toBe(1);
		expect(within(counter).queryByTestId("upload-failed")).toBeNull();
	});

	it("asks before finishing with items left, records the finish and is read-only afterwards", async () => {
		renderShift();
		await openRun("Mở ca");
		fireEvent.click(
			within(itemNamed("Bật máy pha cà phê và kiểm tra áp suất")).getByRole(
				"checkbox",
			),
		);
		await waitFor(() =>
			expect(screen.getByTestId("checklist-progress")).toHaveTextContent("1/4"),
		);
		expect(primaryActions()).toHaveLength(1);
		fireEvent.click(screen.getByRole("button", { name: "Hoàn thành" }));
		const dialog = await screen.findByRole("dialog");
		expect(dialog).toHaveTextContent("Còn 3 việc chưa đánh dấu.");
		expect(primaryActions()).toHaveLength(1);
		fireEvent.click(
			within(dialog).getByRole("button", { name: "Vẫn hoàn thành" }),
		);
		expect(await screen.findByTestId("result-modal")).toHaveTextContent(
			"Đã hoàn thành danh sách",
		);
		await boardReady();
		expect(
			within(card("Mở ca")).getByTestId("checklist-state"),
		).toHaveTextContent(/^Đã xong lúc \d{2}:\d{2}$/);
		fireEvent.click(
			within(card("Mở ca")).getByRole("button", { name: "Xem: Mở ca" }),
		);
		const state = await screen.findByTestId("checklist-run-state");
		expect(state).toHaveAttribute("data-status", "finished");
		expect(state).toHaveAttribute("data-access", "finished");
		expect(screen.getByTestId("run-finished")).toHaveTextContent(
			"chỉ xem được",
		);
		for (const box of screen.getAllByRole("checkbox"))
			expect(box).toBeDisabled();
		expect(screen.queryByRole("button", { name: "Chụp ảnh" })).toBeNull();
		expect(screen.queryByRole("button", { name: "Hoàn thành" })).toBeNull();
		expect(primaryActions().map((element) => element.textContent)).toEqual([
			"Về Ca làm",
		]);
	}, 10_000);

	it("reads the checklist's current version at the next run, without a new build", async () => {
		const { source } = renderShift();
		await openRun("Mở ca");
		fireEvent.click(screen.getByRole("button", { name: "Hoàn thành" }));
		fireEvent.click(
			within(await screen.findByRole("dialog")).getByRole("button", {
				name: "Vẫn hoàn thành",
			}),
		);
		await screen.findByTestId("result-modal");
		await boardReady();
		source.reviseTemplate("opening", [
			{ label: "Kiểm tra máy POS" },
			{ label: "Chụp ảnh tủ bánh", requiresPhoto: true },
		]);
		fireEvent.click(
			within(card("Mở ca")).getByRole("button", { name: "Làm lượt mới" }),
		);
		const state = await screen.findByTestId("checklist-run-state");
		expect(state).toHaveAttribute("data-version", "2");
		expect(
			items().map((element) => element.querySelector("p")?.textContent),
		).toEqual(["Kiểm tra máy POS", "Chụp ảnh tủ bánh"]);
	}, 10_000);
});

describe("Ca làm: refusals when starting", () => {
	it("shows someone else's open run read-only, and the refusal of a start", async () => {
		renderShift({ settings: { checklistTaken: true } });
		await boardReady();
		expect(
			within(card("Mở ca")).getByTestId("checklist-state"),
		).toHaveTextContent("Người khác đang làm");
		expect(primaryActions()[0]).toHaveTextContent("Đóng ca");
		fireEvent.click(
			within(card("Mở ca")).getByRole("button", { name: "Xem: Mở ca" }),
		);
		const state = await screen.findByTestId("checklist-run-state");
		expect(state).toHaveAttribute("data-access", "other");
		expect(screen.getByTestId("run-other")).toHaveTextContent(
			"Người khác đang làm danh sách này",
		);
		for (const box of screen.getAllByRole("checkbox"))
			expect(box).toBeDisabled();
	});

	it.each([
		[new RestError(409, "23505"), "Hôm nay người khác đang làm danh sách này."],
		[new RestError(500, "55000"), "Danh sách này đã ngừng dùng."],
		[
			new RestError(403, "42501"),
			"Bạn không có quyền làm việc này ở cửa hàng này.",
		],
		[new RestError(0), "Chưa gửi được vì mạng chập chờn."],
	])("names the refusal %s", async (error, message) => {
		const sample = createSampleShiftSource({
			visibility: "all",
			delayMs: 0,
			failFirstUpload: false,
			checklistTaken: false,
			unmatchedCount: false,
		});
		const source = {
			...sample,
			ops: {
				...sample.ops,
				startChecklistRun: async () => {
					throw error;
				},
			},
		};
		renderShift({ source });
		await boardReady();
		fireEvent.click(
			within(card("Mở ca")).getByRole("button", { name: "Bắt đầu: Mở ca" }),
		);
		expect(await screen.findByTestId("run-failed")).toHaveTextContent(message);
		expect(primaryActions()).toHaveLength(1);
	});
});

describe("Ca làm: taps and starts that overlap", () => {
	it("keeps a tap on the checkbox that comes while the number is still saving", async () => {
		renderShift({ settings: { delayMs: 150 } });
		await openRun("Mở ca");
		const fridge = itemNamed("Nhiệt độ tủ mát");
		const input = within(fridge).getByLabelText("Số đo (°C)");
		fireEvent.change(input, { target: { value: "5" } });
		fireEvent.blur(input);
		const box = within(fridge).getByRole("checkbox");
		expect(box).toBeEnabled();
		fireEvent.click(box);
		await waitFor(
			() => expect(within(fridge).getByRole("checkbox")).toBeChecked(),
			{
				timeout: 3000,
			},
		);
		expect(screen.getByTestId("checklist-progress")).toHaveTextContent(
			"Đã xong 1/4 việc",
		);
	});

	it("shares one start between overlapping requests and retries once after a race", async () => {
		const sample = createSampleShiftSource({
			visibility: "all",
			delayMs: 20,
			failFirstUpload: false,
			checklistTaken: false,
			unmatchedCount: false,
		});
		const [first] = await sample.ops.dueChecklists(STORE);
		let calls = 0;
		const counting = {
			...sample.ops,
			startChecklistRun: (templateId: string, storeId: string) => {
				calls += 1;
				return sample.ops.startChecklistRun(templateId, storeId);
			},
		};
		const [a, b] = await Promise.all([
			startOnce(counting, first?.templateId ?? "", STORE),
			startOnce(counting, first?.templateId ?? "", STORE),
		]);
		expect(calls).toBe(1);
		expect(a.runId).toBe(b.runId);
		let attempts = 0;
		const racing = {
			...sample.ops,
			startChecklistRun: (templateId: string, storeId: string) => {
				attempts += 1;
				return attempts === 1
					? Promise.reject(new RestError(409, "23505"))
					: sample.ops.startChecklistRun(templateId, storeId);
			},
		};
		expect(
			(await startOnce(racing, first?.templateId ?? "", STORE)).runId,
		).toBe(a.runId);
		expect(attempts).toBe(2);
	});
});
