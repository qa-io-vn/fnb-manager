import { fireEvent, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { addDays, claimDates, isoDateIn } from "../data/dates";
import { renderCustomerApp, setSearch } from "../test/render-app";
import {
	claimInput,
	claimProblems,
	cleanAmount,
	cleanReceiptNo,
	groupedAmount,
} from "./model";

afterEach(() => setSearch(""));

const TODAY = "2026-11-19";
const DATES = claimDates(Date.parse("2026-11-19T10:00:00+07:00"), 72);

describe("the claim form's rules", () => {
	it("offers the dates of the claim window, newest first", () => {
		expect(DATES).toEqual([
			"2026-11-19",
			"2026-11-18",
			"2026-11-17",
			"2026-11-16",
		]);
		expect(claimDates(Date.parse("2026-11-19T10:00:00+07:00"), 24)).toEqual([
			"2026-11-19",
			"2026-11-18",
		]);
	});

	it("needs a store, a receipt number, a positive amount and a date in the window", () => {
		const empty = {
			store: null,
			receiptNo: "",
			amount: "",
			businessDate: TODAY,
		};
		expect(claimProblems(empty, DATES)).toEqual({
			store: "claim.problem.store",
			receiptNo: "claim.problem.receiptMissing",
			amount: "claim.problem.amountMissing",
		});
		expect(
			claimProblems(
				{
					store: "mau-1",
					receiptNo: "A 12",
					amount: "0",
					businessDate: "2026-11-15",
				},
				DATES,
			),
		).toEqual({
			receiptNo: "claim.problem.receiptInvalid",
			amount: "claim.problem.amountInvalid",
			businessDate: "claim.problem.date",
		});
		expect(
			claimInput(
				{
					store: "mau-1",
					receiptNo: "A-1001",
					amount: "85000",
					businessDate: "2026-11-17",
				},
				DATES,
			),
		).toEqual({
			store: "mau-1",
			receiptNo: "A-1001",
			amount: 85_000,
			businessDate: "2026-11-17",
		});
	});

	it("cleans what is typed", () => {
		expect(cleanReceiptNo(" a-10 01 ")).toBe("a-1001");
		expect(cleanReceiptNo("#".repeat(50))).toHaveLength(40);
		expect(cleanAmount("085.000đ")).toBe("85000");
		expect(cleanAmount("1234567890123")).toBe("123456789");
		expect(groupedAmount("1234567")).toBe("1.234.567");
	});
});

async function openForm() {
	await screen.findByRole("heading", { name: /Cửa hàng Mẫu/ });
	fireEvent.click(screen.getByRole("button", { name: "Nhận điểm từ hóa đơn" }));
	return screen.findByTestId("claim-form");
}

describe("claiming a receipt", () => {
	it("shows the problems only after a first try, then sends a pending claim", async () => {
		renderCustomerApp({ settings: { member: true }, search: "?store=mau-1" });
		const form = await openForm();
		expect(within(form).getByTestId("claim-store")).toHaveValue("mau-1");
		expect(within(form).getByTestId("claim-date")).toHaveValue(
			isoDateIn(Date.now()),
		);
		expect(within(form).getByTestId("claims-left")).toHaveTextContent(
			"Hôm nay bạn còn 3 lần gửi hóa đơn.",
		);
		expect(
			within(form).queryByText("Hãy nhập số hóa đơn."),
		).not.toBeInTheDocument();
		fireEvent.click(within(form).getByRole("button", { name: "Gửi hóa đơn" }));
		expect(within(form).getByText("Hãy nhập số hóa đơn.")).toBeInTheDocument();
		expect(within(form).getByText("Hãy nhập tổng tiền.")).toBeInTheDocument();
		fireEvent.change(within(form).getByTestId("claim-receipt"), {
			target: { value: "5555" },
		});
		fireEvent.change(within(form).getByTestId("claim-amount"), {
			target: { value: "64000" },
		});
		expect(within(form).getByTestId("claim-amount")).toHaveValue("64.000");
		fireEvent.click(within(form).getByRole("button", { name: "Gửi hóa đơn" }));
		const result = await screen.findByTestId("claim-result");
		expect(result).toHaveAttribute("data-state", "pending");
		expect(within(result).getByText("Đang chờ xác nhận")).toBeInTheDocument();
		expect(screen.getByTestId("claims-left-after")).toHaveTextContent(
			"Hôm nay bạn còn 2 lần gửi hóa đơn.",
		);
		fireEvent.click(screen.getByRole("button", { name: "Xem thẻ thành viên" }));
		const claim = await screen.findByTestId("claim-item");
		expect(claim).toHaveAttribute("data-state", "pending");
		expect(claim).toHaveTextContent("Hóa đơn 5555");
		expect(claim).toHaveTextContent("Đang chờ xác nhận");
	});

	it("credits a receipt that matches a synced invoice and refuses it a second time with the reason", async () => {
		renderCustomerApp({ settings: { member: true }, search: "?store=mau-1" });
		const form = await openForm();
		fireEvent.change(within(form).getByTestId("claim-receipt"), {
			target: { value: "1001" },
		});
		fireEvent.change(within(form).getByTestId("claim-amount"), {
			target: { value: "85000" },
		});
		fireEvent.click(within(form).getByRole("button", { name: "Gửi hóa đơn" }));
		expect(await screen.findByTestId("claim-result")).toHaveAttribute(
			"data-state",
			"matched",
		);
		fireEvent.click(screen.getByRole("button", { name: "Gửi hóa đơn khác" }));
		const again = await screen.findByTestId("claim-form");
		fireEvent.change(within(again).getByTestId("claim-receipt"), {
			target: { value: "1001" },
		});
		fireEvent.change(within(again).getByTestId("claim-amount"), {
			target: { value: "85000" },
		});
		fireEvent.click(within(again).getByRole("button", { name: "Gửi hóa đơn" }));
		const refused = await screen.findByTestId("claim-result");
		expect(refused).toHaveAttribute("data-state", "rejected");
		expect(refused).toHaveTextContent("Hóa đơn này đã được gửi trước đó.");
	});

	it("uses the last claim of the day and offers no other", async () => {
		renderCustomerApp({
			settings: { member: true, claimsUsed: 2 },
			search: "?store=mau-2",
		});
		const form = await openForm();
		expect(within(form).getByTestId("claims-left")).toHaveTextContent(
			"Hôm nay bạn còn 1 lần gửi hóa đơn.",
		);
		fireEvent.change(within(form).getByTestId("claim-receipt"), {
			target: { value: "7777" },
		});
		fireEvent.change(within(form).getByTestId("claim-amount"), {
			target: { value: "30000" },
		});
		fireEvent.change(within(form).getByTestId("claim-date"), {
			target: { value: addDays(isoDateIn(Date.now()), -1) },
		});
		fireEvent.click(within(form).getByRole("button", { name: "Gửi hóa đơn" }));
		expect(await screen.findByTestId("claim-result")).toHaveAttribute(
			"data-state",
			"pending",
		);
		expect(screen.getByTestId("claims-left-after")).toHaveTextContent(
			"Hôm nay bạn đã gửi đủ số hóa đơn cho phép.",
		);
		expect(
			screen.queryByRole("button", { name: "Gửi hóa đơn khác" }),
		).not.toBeInTheDocument();
	});

	it("disables sending once the day's claims are used", async () => {
		renderCustomerApp({
			settings: { member: true, claimsUsed: 3 },
			search: "?store=mau-1",
		});
		const form = await openForm();
		expect(within(form).getByTestId("claims-left")).toHaveTextContent(
			"Hôm nay bạn đã gửi đủ số hóa đơn cho phép.",
		);
		expect(
			within(form).getByRole("button", { name: "Gửi hóa đơn" }),
		).toBeDisabled();
	});
});
