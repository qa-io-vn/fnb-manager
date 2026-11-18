import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SAMPLE_MEMBER_ID } from "../shift/sample";
import {
	boardReady,
	fakePhotoTools,
	MORNING,
	primaryActions,
	renderShift,
	stubObjectUrls,
} from "../test/shift-harness";

const STORE = "00000000-0000-4000-8000-0000000005a1";
const DESCRIPTION = "Tủ đông kêu to và chảy nước dưới đáy.";

async function openReport(name: "Báo sự cố" | "Báo hết hàng") {
	await boardReady();
	fireEvent.click(screen.getByRole("button", { name }));
	return screen.findByTestId("report-form");
}

function incidentCards(): HTMLElement[] {
	return within(screen.getByTestId("panel-reports")).queryAllByTestId(
		"incident",
	);
}

beforeEach(() => {
	vi.useFakeTimers({ toFake: ["Date"] });
	vi.setSystemTime(MORNING);
	stubObjectUrls();
});

afterEach(() => {
	vi.useRealTimers();
	vi.restoreAllMocks();
});

describe("Báo sự cố and Báo hết hàng", () => {
	it("reminds not to write personal details, needs a description and sends the report", async () => {
		const logged: unknown[] = [];
		for (const level of ["log", "info", "warn", "error", "debug"] as const)
			vi.spyOn(console, level).mockImplementation((...args) =>
				logged.push(args),
			);
		const { source } = renderShift();
		await openReport("Báo sự cố");
		expect(screen.getByTestId("privacy-reminder")).toHaveTextContent(
			"Không ghi thông tin cá nhân như số điện thoại, số giấy tờ",
		);
		expect(screen.getByLabelText("Loại")).toHaveDisplayValue("Thiết bị");
		expect(screen.queryByLabelText("Món hoặc nguyên liệu đã hết")).toBeNull();
		expect(primaryActions().map((element) => element.textContent)).toEqual([
			"Gửi báo cáo",
		]);
		fireEvent.click(screen.getByRole("button", { name: "Gửi báo cáo" }));
		expect(
			await screen.findByText("Hãy viết vài dòng mô tả."),
		).toBeInTheDocument();
		fireEvent.change(screen.getByTestId("report-description"), {
			target: { value: DESCRIPTION },
		});
		fireEvent.click(screen.getByRole("button", { name: "Gửi báo cáo" }));
		expect(await screen.findByTestId("result-modal")).toHaveTextContent(
			"Đã gửi báo cáo",
		);
		await boardReady();
		const mine = (await source.ops.incidents([STORE])).find(
			(incident) => incident.createdBy === SAMPLE_MEMBER_ID,
		);
		expect(mine).toMatchObject({
			kind: "incident",
			categoryKey: "thiet_bi",
			description: DESCRIPTION,
			status: "open",
			photoPaths: [],
		});
		const card = incidentCards().find((element) =>
			within(element).queryByText(DESCRIPTION),
		);
		expect(card).toBeDefined();
		expect(
			within(card as HTMLElement).getByText("Của bạn"),
		).toBeInTheDocument();
		expect(within(card as HTMLElement).getByText("Mới")).toBeInTheDocument();
		expect(JSON.stringify(logged)).not.toContain("Tủ đông");
	}, 10_000);

	it("needs the item of a stock-out and attaches its photo after the report exists", async () => {
		const { source, tools } = renderShift();
		await openReport("Báo hết hàng");
		expect(screen.getByLabelText("Loại")).toHaveDisplayValue("Khác");
		fireEvent.change(screen.getByTestId("report-description"), {
			target: { value: "Hết từ trưa." },
		});
		fireEvent.click(screen.getByRole("button", { name: "Gửi báo cáo" }));
		expect(
			await screen.findByText("Hãy ghi món hoặc nguyên liệu đã hết."),
		).toBeInTheDocument();
		fireEvent.change(screen.getByTestId("report-item"), {
			target: { value: "Trân châu đen" },
		});
		expect(screen.getByText("Ảnh (không bắt buộc, 0/3)")).toBeInTheDocument();
		fireEvent.click(screen.getByRole("button", { name: "Thêm ảnh" }));
		expect(await screen.findByTestId("photo-preview")).toBeInTheDocument();
		expect(screen.getByText("Ảnh (không bắt buộc, 1/3)")).toBeInTheDocument();
		expect(tools.taken).toBe(1);
		fireEvent.click(screen.getByRole("button", { name: "Gửi báo cáo" }));
		expect(await screen.findByTestId("result-modal")).toHaveTextContent(
			"Đã gửi báo cáo",
		);
		const mine = (await source.ops.incidents([STORE])).find(
			(incident) => incident.createdBy === SAMPLE_MEMBER_ID,
		);
		expect(mine).toMatchObject({
			kind: "stock_out",
			categoryKey: "khac",
			itemLabel: "Trân châu đen",
		});
		expect(mine?.photoPaths).toHaveLength(1);
		expect(mine?.photoPaths[0]).toMatch(
			new RegExp(`/${STORE}/incident/${mine?.id}/p-1\\.jpg$`),
		);
	}, 10_000);

	it("still sends a report without a photo when the camera is refused", async () => {
		renderShift({ tools: fakePhotoTools([{ kind: "refused" }]) });
		await openReport("Báo sự cố");
		fireEvent.click(screen.getByRole("button", { name: "Thêm ảnh" }));
		expect(await screen.findByTestId("camera-refused")).toHaveTextContent(
			"Bạn vẫn gửi được báo cáo không kèm ảnh.",
		);
		fireEvent.change(screen.getByTestId("report-description"), {
			target: { value: DESCRIPTION },
		});
		fireEvent.click(screen.getByRole("button", { name: "Gửi báo cáo" }));
		expect(await screen.findByTestId("result-modal")).toHaveTextContent(
			"Đã gửi báo cáo",
		);
	});

	it("keeps the sent report when its photo fails, and uploads the photo on the retry", async () => {
		const { source } = renderShift({ settings: { failFirstUpload: true } });
		await openReport("Báo sự cố");
		fireEvent.change(screen.getByTestId("report-description"), {
			target: { value: DESCRIPTION },
		});
		fireEvent.click(screen.getByRole("button", { name: "Thêm ảnh" }));
		await screen.findByTestId("photo-preview");
		fireEvent.click(screen.getByRole("button", { name: "Gửi báo cáo" }));
		expect(await screen.findByTestId("report-photo-alert")).toHaveTextContent(
			"Báo cáo đã gửi, nhưng ảnh chưa tải lên được.",
		);
		expect(primaryActions().map((element) => element.textContent)).toEqual([
			"Tải ảnh lại",
		]);
		const before = (await source.ops.incidents([STORE])).filter(
			(incident) => incident.createdBy === SAMPLE_MEMBER_ID,
		);
		expect(before).toHaveLength(1);
		expect(before[0]?.photoPaths).toEqual([]);
		fireEvent.click(screen.getByRole("button", { name: "Tải ảnh lại" }));
		expect(await screen.findByTestId("result-modal")).toHaveTextContent(
			"Đã gửi báo cáo",
		);
		const after = (await source.ops.incidents([STORE])).filter(
			(incident) => incident.createdBy === SAMPLE_MEMBER_ID,
		);
		expect(after).toHaveLength(1);
		expect(after[0]?.photoPaths).toHaveLength(1);
	});
});

describe("acknowledgement in the app", () => {
	it("gives staff no Đã xem or Đã xử lý", async () => {
		renderShift({ role: "staff" });
		await boardReady();
		expect(incidentCards()).toHaveLength(2);
		expect(screen.queryByRole("button", { name: "Đã xem" })).toBeNull();
		expect(screen.queryByRole("button", { name: "Đã xử lý" })).toBeNull();
		expect(screen.getByTestId("handover")).toHaveTextContent("Chưa xem");
	});

	it("lets a manager mark a report seen, then resolved, which takes it off the list", async () => {
		renderShift({ role: "manager" });
		await boardReady();
		const open = incidentCards().find(
			(element) => element.getAttribute("data-state") === "open",
		);
		expect(open).toBeDefined();
		fireEvent.click(
			within(open as HTMLElement).getByRole("button", { name: "Đã xem" }),
		);
		expect(await screen.findByTestId("result-modal")).toHaveTextContent(
			"Đã xem báo cáo",
		);
		await waitFor(
			() =>
				expect(
					incidentCards().filter(
						(element) => element.getAttribute("data-state") === "seen",
					),
				).toHaveLength(2),
			{ timeout: 3000 },
		);
		const seen = incidentCards()[0] as HTMLElement;
		expect(within(seen).queryByRole("button", { name: "Đã xem" })).toBeNull();
		fireEvent.click(within(seen).getByRole("button", { name: "Đã xử lý" }));
		expect(await screen.findByTestId("result-modal")).toHaveTextContent(
			"Đã đánh dấu đã xử lý",
		);
		await waitFor(() => expect(incidentCards()).toHaveLength(1), {
			timeout: 3000,
		});
	}, 10_000);

	it("keeps a manager's own new report for another manager", async () => {
		const { source } = renderShift({ role: "manager" });
		await source.ops.reportIncident({
			storeId: STORE,
			kind: "incident",
			categoryKey: "ve_sinh",
			description: "Sàn khu bếp trơn.",
			itemLabel: null,
		});
		await boardReady();
		const own = incidentCards().find((element) =>
			within(element).queryByText("Sàn khu bếp trơn."),
		);
		expect(own).toBeDefined();
		expect(within(own as HTMLElement).queryByRole("button")).toBeNull();
		expect(own).toHaveTextContent("một quản lý khác cần xem trước");
	});

	it("lets a manager mark someone else's handover seen", async () => {
		renderShift({ role: "manager" });
		await boardReady();
		const handover = screen.getByTestId("handover");
		expect(handover).toHaveTextContent("Ca 1 → Ca 2");
		fireEvent.click(within(handover).getByRole("button", { name: "Đã xem" }));
		expect(await screen.findByTestId("result-modal")).toHaveTextContent(
			"Đã xem bàn giao",
		);
		await waitFor(
			() =>
				expect(screen.getByTestId("handover")).toHaveAttribute(
					"data-state",
					"seen",
				),
			{ timeout: 3000 },
		);
		expect(
			within(screen.getByTestId("handover")).queryByRole("button"),
		).toBeNull();
	});
});
