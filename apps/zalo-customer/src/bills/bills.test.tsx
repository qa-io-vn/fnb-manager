// Test design for the "Xác nhận hóa đơn" card (blind confirmation of a staff-recorded bill) and the home prompt:
// - equivalence partitioning of the typed total (the staff total, another total, empty, zero) and of the answers;
// - state transitions: waiting -> confirmed | queued | reversed, with the dispute's own ask -> back -> ask -> yes;
// - boundary value: a confirmation sent one millisecond after the deadline is refused as too late;
// - every refusal and answer maps to a catalogue text (decision table of state x refusal);
// - security: the staff total is never rendered, neither before nor after an answer.
import { BILL_REFUSALS } from "@fnb/zalo-mini/loyalty";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { DEMO_BILL_RULES, DEMO_STAFF_BILLS } from "../demo/fixtures";
import { appCatalogs } from "../i18n/catalog";
import { renderCustomerApp, setSearch } from "../test/render-app";
import { billOutcome, totalProblem, typedTotal } from "./model";

afterEach(() => setSearch(""));

const [BILL] = DEMO_STAFF_BILLS;
if (BILL === undefined) throw new Error("the demo needs a staff bill");
const STAFF_TOTAL_SHOWN = /85[.,\s]?000/;

async function openWallet() {
	await screen.findByRole("heading", { name: "Thành viên Quán Mẫu Một" });
	fireEvent.click(screen.getByText("Thẻ thành viên"));
	return screen.findByTestId("bills-to-confirm");
}

function typeTotal(card: HTMLElement, total: string) {
	fireEvent.change(within(card).getByTestId("bill-total"), {
		target: { value: total },
	});
}

describe("the blind total's rules", () => {
	it("take a whole number of đồng from 1 to 100,000,000 (boundary values)", () => {
		expect(typedTotal("1")).toBe(1);
		expect(typedTotal("100000000")).toBe(100_000_000);
		expect(typedTotal("100000001")).toBeNull();
		expect(typedTotal("0")).toBeNull();
		expect(typedTotal("")).toBeNull();
		expect(typedTotal("12.5")).toBeNull();
		expect(totalProblem("")).toBe("bill.problem.totalMissing");
		expect(totalProblem("0")).toBe("bill.problem.totalInvalid");
		expect(totalProblem("85000")).toBeNull();
	});

	it("word every answer and every refusal, an unknown one as other (decision table)", () => {
		const vi: Record<string, string> = appCatalogs.vi;
		const outcomes = [
			billOutcome({ state: "confirmed", refusal: null, evidenceLevel: 2 }),
			billOutcome({ state: "queued", refusal: null, evidenceLevel: 0 }),
			billOutcome({
				state: "awaiting_customer",
				refusal: null,
				evidenceLevel: 1,
			}),
			billOutcome({ state: "reversed", refusal: null }),
			...BILL_REFUSALS.map((refusal) =>
				billOutcome({ state: "refused", refusal, evidenceLevel: null }),
			),
		];
		expect(outcomes.map((outcome) => outcome.tone)).toEqual([
			"positive",
			"pending",
			"pending",
			"neutral",
			"negative",
			"negative",
			"negative",
		]);
		for (const outcome of outcomes) expect(vi[outcome.key]).toBeTruthy();
		expect(
			billOutcome({ state: "refused", refusal: "newer", evidenceLevel: null })
				.key,
		).toBe("bill.refusal.other");
	});
});

describe("confirming a bill on the wallet", () => {
	it("lists the bill without the staff total and confirms the right total at once", async () => {
		renderCustomerApp({ settings: { member: true, bills: 1 } });
		const card = await openWallet();
		const bill = within(card).getByTestId("bill-to-confirm");
		expect(bill).toHaveTextContent(`Hóa đơn ${BILL.billNo}`);
		expect(bill).toHaveTextContent("Cửa hàng Mẫu 1");
		expect(within(bill).getByTestId("bill-deadline")).toHaveTextContent(
			/^Xác nhận trước \d\d:\d\d \d\d\/\d\d\/\d{4}$/,
		);
		expect(within(bill).getByTestId("bill-total")).toHaveValue("");
		expect(document.body.textContent).not.toMatch(STAFF_TOTAL_SHOWN);
		expect(within(bill).getByTestId("bill-total")).toHaveAccessibleDescription(
			"Nhập đúng số tiền in trên hóa đơn. Mỗi hóa đơn chỉ trả lời được một lần.",
		);
		fireEvent.click(within(bill).getByTestId("bill-confirm"));
		expect(
			within(bill).getByText("Hãy nhập tổng tiền bạn đã trả."),
		).toBeInTheDocument();
		typeTotal(bill, "85000");
		expect(within(bill).getByTestId("bill-total")).toHaveValue("85.000");
		fireEvent.click(within(bill).getByTestId("bill-confirm"));
		const result = await within(card).findByTestId("bill-result");
		expect(result).toHaveAttribute("data-outcome", "bill.result.confirmed");
		expect(result).toHaveTextContent(
			`Đã xác nhận hóa đơn ${BILL.billNo}. Điểm đã được cộng vào thẻ.`,
		);
		expect(within(card).queryByTestId("bill-to-confirm")).toBeNull();
		await screen.findByText("Số lần mua: 3");
		const [latest] = screen.getAllByTestId("history-item");
		expect(latest).toHaveAttribute("data-state", "confirmed");
		expect(latest).toHaveTextContent("Qua hóa đơn nhân viên ghi nhận");
	});

	it("sends a different total to a manager without saying the store's total", async () => {
		renderCustomerApp({ settings: { member: true, bills: 1 } });
		const card = await openWallet();
		typeTotal(card, String(BILL.staffTotal + DEMO_BILL_RULES.tolerance + 1));
		fireEvent.click(within(card).getByTestId("bill-confirm"));
		const result = await within(card).findByTestId("bill-result");
		expect(result).toHaveAttribute("data-outcome", "bill.result.queued");
		expect(result).toHaveTextContent("Quản lý cửa hàng sẽ kiểm tra");
		expect(document.body.textContent).not.toMatch(STAFF_TOTAL_SHOWN);
	});

	it("asks before a dispute, can go back, and reverses the bill on yes", async () => {
		renderCustomerApp({ settings: { member: true, bills: 1 } });
		const card = await openWallet();
		fireEvent.click(within(card).getByTestId("bill-dispute"));
		const ask = within(card).getByTestId("bill-dispute-ask");
		expect(ask).toHaveTextContent(
			`Hóa đơn ${BILL.billNo} không phải của bạn? Điểm của hóa đơn này sẽ bị hủy`,
		);
		fireEvent.click(within(ask).getByRole("button", { name: "Quay lại" }));
		expect(within(card).getByTestId("bill-total")).toBeInTheDocument();
		fireEvent.click(within(card).getByTestId("bill-dispute"));
		fireEvent.click(
			within(card).getByRole("button", { name: "Đúng, không phải của tôi" }),
		);
		const result = await within(card).findByTestId("bill-result");
		expect(result).toHaveAttribute("data-outcome", "bill.result.reversed");
		expect(result).toHaveTextContent("Điểm của hóa đơn này đã được hủy");
		await waitFor(() =>
			expect(screen.getAllByTestId("history-item")[0]).toHaveAttribute(
				"data-state",
				"reversed",
			),
		);
	});

	it("says too late for a confirmation sent at the deadline itself (boundary value)", async () => {
		let clock = Date.now();
		renderCustomerApp({
			settings: { member: true, bills: 1 },
			now: () => clock,
		});
		const card = await openWallet();
		clock +=
			DEMO_BILL_RULES.unconfirmedHours * 3_600_000 - BILL.minutesAgo * 60_000;
		typeTotal(card, String(BILL.staffTotal));
		fireEvent.click(within(card).getByTestId("bill-confirm"));
		const result = await within(card).findByTestId("bill-result");
		expect(result).toHaveAttribute("data-outcome", "bill.refusal.too_late");
		expect(result).toHaveTextContent(
			`Đã quá hạn xác nhận hóa đơn ${BILL.billNo}.`,
		);
	});

	it("shows no card when nothing waits", async () => {
		renderCustomerApp({ settings: { member: true, staffMode: true } });
		await screen.findByRole("heading", { name: "Thành viên Quán Mẫu Một" });
		fireEvent.click(screen.getByText("Thẻ thành viên"));
		await screen.findByTestId("member-card");
		expect(screen.queryByTestId("bills-to-confirm")).toBeNull();
	});
});

describe("the home prompt", () => {
	it("counts the bills to confirm and opens the wallet", async () => {
		renderCustomerApp({ settings: { member: true, bills: 2 } });
		const prompt = await screen.findByTestId("bills-prompt");
		expect(prompt).toHaveTextContent("Bạn có 2 hóa đơn cần xác nhận.");
		fireEvent.click(
			within(prompt).getByRole("button", { name: "Xác nhận hóa đơn" }),
		);
		expect(await screen.findAllByTestId("bill-to-confirm")).toHaveLength(2);
	});

	it("stays away at a brand whose stores all run on POS sync", async () => {
		renderCustomerApp({ settings: { member: true } });
		await screen.findByTestId("member-badge");
		expect(screen.queryByTestId("bills-prompt")).toBeNull();
	});
});
