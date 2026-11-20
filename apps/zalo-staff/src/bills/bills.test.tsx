// Test design (ISTQB): component tests of the staff-mode screens on the demo world and on fake clients.
// - State transition: Ghi hóa đơn form -> result (awaiting_customer with its deadline / confirmed / queued) -> again;
//   a counter claim waiting -> answered; a queued bill -> decided; an audit -> failed; a reward verified -> confirmed
//   -> voided.
// - Decision table role x action: Hoàn tác, Duyệt hóa đơn, Hủy ưu đãi and the home entries for staff, manager, owner.
// - Decision table refusal -> text: every refusal the database documents (and an unknown one) has its own text.
// - Security: the blind answer never shows the customer's total, and no full phone number is ever rendered.
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	BILL_REFUSALS,
	type BillRefusal,
	type BillsClient,
	CLAIM_REFUSALS,
	type ClaimRefusal,
	CONFIRM_REFUSALS,
} from "../loyalty/bills-contract";
import {
	createDemoBillsClient,
	DEMO_BILL_CODES,
	DEMO_BILLS,
	DEMO_CLAIM_TOTALS,
} from "../loyalty/bills-demo";
import { DEMO_CODES, DEMO_DISCOUNT_NAME } from "../loyalty/demo";
import { LOYALTY_PATHS } from "../loyalty/env";
import {
	fakeScanTools,
	NOON,
	primaryActions,
	renderLoyalty,
	STORE_1,
	screenReady,
} from "../test/loyalty-harness";
import { claimRefusalKey } from "./parts";
import { billCatalogs } from "./texts";

const FULL_PHONES = /0900001234|0900005678|0900003333|0900004444|0900000000/;
const vi_ = billCatalogs.vi;

beforeEach(() => {
	vi.useFakeTimers({ toFake: ["Date"] });
	vi.setSystemTime(NOON);
});

afterEach(() => {
	vi.useRealTimers();
});

async function billsReady(): Promise<HTMLElement> {
	const body = await screenReady("bills-body");
	await waitFor(() => expect(body).toHaveAttribute("data-status", "ready"));
	return body;
}

function fill(testId: string, value: string) {
	fireEvent.change(screen.getByTestId(testId), { target: { value } });
}

function refusing(refusal: BillRefusal | null): BillsClient {
	const demo = createDemoBillsClient({ storeMode: "staff", role: "staff" });
	return {
		...demo,
		async submit() {
			return {
				outcome: "refused",
				refusal,
				retryAt: refusal === "locked" ? NOON.toISOString() : null,
			};
		},
	};
}

describe("Ghi hóa đơn", () => {
	it("records a scanned bill that waits for the customer, with its deadline and a masked member", async () => {
		const scan = fakeScanTools([
			{
				kind: "content",
				content: `fnb-member:1:Q1:${DEMO_BILL_CODES.member[0]}`,
			},
		]);
		renderLoyalty({ path: LOYALTY_PATHS.bills, storeMode: "staff", scan });
		await billsReady();
		expect(primaryActions().map((element) => element.textContent)).toEqual([
			"Ghi hóa đơn",
		]);
		fireEvent.click(screen.getByTestId("scan"));
		expect(await screen.findByTestId("bill-scanned")).toHaveTextContent(
			"Đã quét mã thành viên của khách.",
		);
		expect(screen.getByTestId("bill-code")).toHaveValue(
			DEMO_BILL_CODES.member[0],
		);
		fill("bill-no", "HD-0040");
		fill("bill-total", "185.000");
		expect(screen.getByTestId("bill-total-read")).toHaveTextContent(
			/^Số tiền: 185\.000\s₫$/,
		);
		fireEvent.click(screen.getByRole("button", { name: "Ghi hóa đơn" }));
		const result = await screen.findByTestId("bill-result");
		expect(result).toHaveAttribute("data-state", "awaiting_customer");
		expect(within(result).getByTestId("bill-confirm-by")).toHaveTextContent(
			"Khách xác nhận trước 12:00 ngày 20/11/2026",
		);
		expect(within(result).getByTestId("bill-member")).toHaveTextContent(
			"Khách •••• ••• 234",
		);
		expect(within(result).getByTestId("bill-earn")).toHaveTextContent(
			"+1 dấu · +18 điểm",
		);
		await waitFor(() =>
			expect(
				screen
					.getAllByTestId("recent-bill")
					.map((row) => row.getAttribute("data-bill-no")),
			).toContain("HD-0040"),
		);
		expect(document.body.textContent).not.toMatch(FULL_PHONES);
		fireEvent.click(screen.getByRole("button", { name: "Ghi hóa đơn khác" }));
		expect(await screen.findByTestId("bill-no")).toHaveValue("");
	});

	it("checks each field before any call and says what is wrong", async () => {
		renderLoyalty({ path: LOYALTY_PATHS.bills, storeMode: "staff" });
		await billsReady();
		fill("bill-total", "0");
		fireEvent.click(screen.getByRole("button", { name: "Ghi hóa đơn" }));
		expect(screen.getByTestId("bill-problem-code")).toHaveTextContent(
			"Hãy quét hoặc nhập mã thành viên của khách.",
		);
		expect(screen.getByTestId("bill-problem-billNo")).toHaveTextContent(
			"Hãy nhập số hóa đơn.",
		);
		expect(screen.getByTestId("bill-problem-total")).toHaveTextContent(
			"Tổng tiền phải lớn hơn 0.",
		);
		expect(screen.getByTestId("bill-code")).toHaveFocus();
	});

	it("queues a total above the approval threshold and confirms at once at level 0", async () => {
		renderLoyalty({
			path: LOYALTY_PATHS.bills,
			storeMode: "staff",
			requiredLevel: 0,
		});
		await billsReady();
		fill("bill-code", DEMO_BILL_CODES.member[0]);
		fill("bill-no", "HD-0050");
		fill("bill-total", "1.250.000");
		fireEvent.click(screen.getByRole("button", { name: "Ghi hóa đơn" }));
		expect(await screen.findByTestId("bill-result")).toHaveAttribute(
			"data-state",
			"queued",
		);
		expect(screen.getByTestId("bill-result")).toHaveTextContent(
			"Chờ quản lý duyệt",
		);
		fireEvent.click(screen.getByRole("button", { name: "Ghi hóa đơn khác" }));
		fill("bill-code", DEMO_BILL_CODES.member[1]);
		fill("bill-no", "HD-0051");
		fill("bill-total", "85000");
		fireEvent.click(screen.getByRole("button", { name: "Ghi hóa đơn" }));
		await waitFor(() =>
			expect(screen.getByTestId("bill-result")).toHaveAttribute(
				"data-state",
				"confirmed",
			),
		);
		expect(screen.queryByTestId("bill-confirm-by")).toBeNull();
	});

	it.each([...BILL_REFUSALS, null])(
		"shows its own Vietnamese text for the refusal %s",
		async (refusal) => {
			renderLoyalty({
				path: LOYALTY_PATHS.bills,
				storeMode: "staff",
				bills: refusing(refusal),
			});
			await billsReady();
			fill("bill-code", "246810");
			fill("bill-no", "HD-1");
			fill("bill-total", "50000");
			fireEvent.click(screen.getByRole("button", { name: "Ghi hóa đơn" }));
			const alert = await screen.findByTestId("bill-refused");
			expect(alert).toHaveAttribute("data-refusal", refusal ?? "other");
			const expected =
				refusal === "locked"
					? vi_["bills.refusal.locked"]?.replace("{time}", "12:00")
					: vi_[`bills.refusal.${refusal ?? "other"}`];
			expect(expected).toBeTruthy();
			expect(alert).toHaveTextContent(expected ?? "");
		},
	);

	it("gives every refusal a different text", () => {
		const texts = [...BILL_REFUSALS, "other"].map(
			(key) => vi_[`bills.refusal.${key}`],
		);
		expect(new Set(texts).size).toBe(texts.length);
	});

	it("explains a POS-synced store and points back to Ghi nhận khách", async () => {
		renderLoyalty({ path: LOYALTY_PATHS.bills });
		await billsReady();
		expect(screen.getByTestId("bills-pos-sync")).toHaveTextContent(
			"Cửa hàng này cộng dấu và điểm theo hóa đơn đồng bộ từ máy POS",
		);
		expect(screen.queryByTestId("bill-code")).toBeNull();
		fireEvent.click(screen.getByRole("button", { name: "Ghi nhận khách" }));
		expect(
			await screen.findByTestId("checkin-entry", {}, { timeout: 4000 }),
		).toBeInTheDocument();
	});
});

describe("role x action: who may reverse, review and void", () => {
	it.each([
		["staff", false],
		["manager", true],
		["owner", true],
	] as const)("%s: Hoàn tác shown %s", async (role, shown) => {
		renderLoyalty({ path: LOYALTY_PATHS.bills, role, storeMode: "staff" });
		await billsReady();
		const rows = screen.getAllByTestId("recent-bill");
		const reverse = screen.queryAllByRole("button", { name: /^Hoàn tác/ });
		expect(reverse.length > 0).toBe(shown);
		if (role === "staff")
			expect(
				rows.map((row) => row.getAttribute("data-bill-no")).sort(),
			).toEqual([DEMO_BILLS.ownDisagreement, DEMO_BILLS.mine].sort());
		expect(document.body.textContent).not.toMatch(FULL_PHONES);
	});

	it("lets a manager reverse a bill inside the window with a reason, not one past it", async () => {
		renderLoyalty({
			path: LOYALTY_PATHS.bills,
			role: "manager",
			storeMode: "staff",
		});
		await billsReady();
		const old = screen
			.getAllByTestId("recent-bill")
			.find((row) => row.getAttribute("data-bill-no") === DEMO_BILLS.old);
		expect(
			old && within(old).queryByRole("button", { name: /Hoàn tác/ }),
		).toBeNull();
		fireEvent.click(
			screen.getByRole("button", {
				name: `Hoàn tác hóa đơn ${DEMO_BILLS.mine}`,
			}),
		);
		fireEvent.click(screen.getByRole("button", { name: "Xác nhận hoàn tác" }));
		expect(screen.getByTestId("bill-reverse-reason-problem")).toHaveTextContent(
			"Hãy ghi lý do.",
		);
		fill("bill-reverse-reason", "Ghi nhầm khách");
		fireEvent.click(screen.getByRole("button", { name: "Xác nhận hoàn tác" }));
		expect(await screen.findByTestId("result-modal")).toHaveTextContent(
			"Đã hoàn tác hóa đơn",
		);
		await waitFor(() => {
			const row = screen
				.getAllByTestId("recent-bill")
				.find((each) => each.getAttribute("data-bill-no") === DEMO_BILLS.mine);
			expect(row).toHaveAttribute("data-state", "reversed");
		});
	});

	it.each([
		["staff", false],
		["manager", true],
		["owner", true],
	] as const)("%s: Duyệt hóa đơn open %s", async (role, open) => {
		renderLoyalty({ path: LOYALTY_PATHS.billQueue, role, storeMode: "staff" });
		await screenReady("bill-queue");
		if (open) {
			const body = await screen.findByTestId("bill-queue-body");
			await waitFor(() => expect(body).toHaveAttribute("data-status", "ready"));
			expect(screen.getAllByTestId("queued-bill")).toHaveLength(2);
		} else {
			expect(
				await screen.findByTestId("bill-queue-refused", {}, { timeout: 4000 }),
			).toHaveTextContent("Chỉ chủ và quản lý cửa hàng duyệt hóa đơn.");
			expect(screen.queryByTestId("queued-bill")).toBeNull();
		}
	});
});

describe("Mã quầy", () => {
	it("shows the counter QR and answers a claim blind, never showing the customer's total", async () => {
		renderLoyalty({ path: LOYALTY_PATHS.counter, storeMode: "staff" });
		const qr = await screen.findByTestId("counter-qr", {}, { timeout: 4000 });
		expect(qr.getAttribute("data-payload")).toMatch(
			/^fnb-counter:1:Q1:[A-HJ-NP-Z2-9]{12}$/,
		);
		expect(qr.querySelector("path")?.getAttribute("d")).toMatch(/^M\d/);
		expect(screen.getByTestId("counter-refresh")).toHaveTextContent(
			"Mã tự làm mới lúc 12:00",
		);
		const claims = await screen.findAllByTestId("counter-claim");
		expect(claims).toHaveLength(2);
		const customerTotal = DEMO_CLAIM_TOTALS[DEMO_BILLS.claimHoa] ?? 0;
		const shown = /65[.,\s]?000/;
		expect(customerTotal).toBe(65_000);
		expect(document.body.textContent).not.toMatch(shown);
		expect(document.body.textContent).not.toMatch(/240[.,\s]?000/);
		expect(claims[0]).toHaveTextContent("Chị Hoa · •••• ••• 678");
		fireEvent.click(
			screen.getByRole("button", {
				name: `Nhập tổng tiền cho hóa đơn ${DEMO_BILLS.claimHoa}`,
			}),
		);
		const form = screen.getByTestId("claim-form");
		expect(form).toHaveTextContent(
			"Số khách đã nhập không hiển thị để hai bên đối chiếu độc lập.",
		);
		expect(document.body.textContent).not.toMatch(shown);
		expect((screen.getByTestId("claim-total") as HTMLInputElement).value).toBe(
			"",
		);
		expect(primaryActions().map((element) => element.textContent)).toEqual([
			"Xác nhận",
		]);
		fill("claim-total", "65000");
		fireEvent.click(screen.getByRole("button", { name: "Xác nhận" }));
		expect(await screen.findByTestId("result-modal")).toHaveTextContent(
			"Đã cộng cho khách",
		);
		await waitFor(() =>
			expect(screen.getAllByTestId("counter-claim")).toHaveLength(1),
		);
		expect(document.body.textContent).not.toMatch(FULL_PHONES);
	});

	it("rejects a claim with a reason and queues a disagreeing total", async () => {
		renderLoyalty({ path: LOYALTY_PATHS.counter, storeMode: "staff" });
		await screen.findAllByTestId("counter-claim", {}, { timeout: 4000 });
		fireEvent.click(
			screen.getByRole("button", {
				name: `Từ chối hóa đơn ${DEMO_BILLS.claimMinh}`,
			}),
		);
		fireEvent.click(screen.getByRole("button", { name: "Từ chối hóa đơn" }));
		expect(screen.getByTestId("claim-reason-problem")).toBeInTheDocument();
		fill("claim-reason", "Không có hóa đơn này");
		fireEvent.click(screen.getByRole("button", { name: "Từ chối hóa đơn" }));
		expect(await screen.findByTestId("result-modal")).toHaveTextContent(
			"Đã từ chối hóa đơn",
		);
		await waitFor(() =>
			expect(screen.getAllByTestId("counter-claim")).toHaveLength(1),
		);
		fireEvent.click(
			screen.getByRole("button", {
				name: `Nhập tổng tiền cho hóa đơn ${DEMO_BILLS.claimHoa}`,
			}),
		);
		fill("claim-total", "60.000");
		fireEvent.click(screen.getByRole("button", { name: "Xác nhận" }));
		await waitFor(() =>
			expect(screen.getByTestId("result-modal")).toHaveTextContent(
				"Đã chuyển quản lý duyệt",
			),
		);
	});

	it("says when the store has no self claims", async () => {
		renderLoyalty({ path: LOYALTY_PATHS.counter });
		expect(
			await screen.findByTestId("counter-refused", {}, { timeout: 4000 }),
		).toHaveTextContent(
			"Cửa hàng chưa bật cho khách tự gửi hóa đơn bằng mã quầy.",
		);
		expect(screen.queryByTestId("counter-qr")).toBeNull();
		expect(screen.queryByTestId("counter-claims")).toBeNull();
	});

	it.each([...CLAIM_REFUSALS, null])(
		"maps the claim refusal %s to a text",
		(refusal: ClaimRefusal | null) => {
			const text = vi_[claimRefusalKey(refusal)];
			expect(text).toBeTruthy();
		},
	);
});

describe("Duyệt hóa đơn", () => {
	async function queueReady() {
		const body = await screenReady("bill-queue-body");
		await waitFor(() => expect(body).toHaveAttribute("data-status", "ready"));
	}

	function card(testId: string, billNo: string): HTMLElement {
		const found = screen
			.getAllByTestId(testId)
			.find((each) => each.getAttribute("data-bill-no") === billNo);
		if (found === undefined) throw new Error(`no ${billNo}`);
		return found;
	}

	it("shows both readings, refuses a manager's own bill and approves another", async () => {
		renderLoyalty({
			path: LOYALTY_PATHS.billQueue,
			role: "manager",
			storeMode: "staff",
		});
		await queueReady();
		const own = card("queued-bill", DEMO_BILLS.ownDisagreement);
		expect(within(own).getByTestId("staff-total")).toHaveTextContent(
			/Nhân viên nhập: 150\.000\s₫/,
		);
		expect(within(own).getByTestId("customer-total")).toHaveTextContent(
			/Khách nhập: 105\.000\s₫/,
		);
		expect(within(own).getByTestId("queued-own")).toBeInTheDocument();
		const over = card("queued-bill", DEMO_BILLS.overApproval);
		expect(within(over).getByTestId("customer-total")).toHaveTextContent(
			"Khách nhập: chưa nhập",
		);
		fireEvent.click(
			within(own).getByRole("button", { name: /^Xử lý hóa đơn/ }),
		);
		fill("bill-decide-reason", "Đã xem hóa đơn");
		fireEvent.click(screen.getByRole("button", { name: "Duyệt" }));
		expect(await screen.findByTestId("bill-decide-refused")).toHaveTextContent(
			"Quản lý không được tự duyệt hóa đơn mình đã ghi.",
		);
		fireEvent.click(screen.getByRole("button", { name: "Thôi" }));
		fireEvent.click(
			within(card("queued-bill", DEMO_BILLS.overApproval)).getByRole("button", {
				name: /^Xử lý hóa đơn/,
			}),
		);
		fill("bill-decide-reason", "Đã đối chiếu hóa đơn giấy");
		fireEvent.click(screen.getByRole("button", { name: "Duyệt" }));
		expect(await screen.findByTestId("result-modal")).toHaveTextContent(
			"Đã duyệt hóa đơn",
		);
		await waitFor(() =>
			expect(screen.getAllByTestId("queued-bill")).toHaveLength(1),
		);
		expect(document.body.textContent).not.toMatch(FULL_PHONES);
	});

	it("needs a note to fail an audit, then fails it", async () => {
		renderLoyalty({
			path: LOYALTY_PATHS.billQueue,
			role: "manager",
			storeMode: "staff",
		});
		await queueReady();
		fireEvent.click(
			screen.getByRole("button", {
				name: `Kiểm tra hóa đơn ${DEMO_BILLS.audited}`,
			}),
		);
		fireEvent.click(screen.getByRole("button", { name: "Không đạt" }));
		expect(screen.getByTestId("audit-note-problem")).toHaveTextContent(
			"Hãy ghi lý do.",
		);
		fill("audit-note", "Tổng tiền trên hóa đơn giấy khác");
		fireEvent.click(screen.getByRole("button", { name: "Không đạt" }));
		expect(await screen.findByTestId("result-modal")).toHaveTextContent(
			"Đã ghi kết quả: không đạt. Hóa đơn đã được hoàn tác.",
		);
		await waitFor(() => expect(screen.queryByTestId("bill-audit")).toBeNull());
	});
});

describe("Kiểm tra ưu đãi in staff mode", () => {
	async function verify(code: string) {
		const field = await screen.findByTestId(
			"redeem-code",
			{},
			{ timeout: 4000 },
		);
		fireEvent.change(field, { target: { value: code } });
		fireEvent.click(screen.getByRole("button", { name: "Kiểm tra" }));
		return screen.findByTestId("redeem-result");
	}

	it("confirms the reward at once, names the POS discount, and lets a manager void it", async () => {
		renderLoyalty({
			path: LOYALTY_PATHS.redeem,
			role: "manager",
			storeMode: "staff",
		});
		await verify(DEMO_CODES.posReward);
		const confirm = await screen.findByRole("button", {
			name: "Xác nhận đã dùng",
		});
		expect(primaryActions().map((element) => element.textContent)).toEqual([
			"Xác nhận đã dùng",
		]);
		expect(screen.getByTestId("redeem-result")).toHaveTextContent(
			"Khi khách dùng ưu đãi, bấm Xác nhận đã dùng",
		);
		fireEvent.click(confirm);
		const confirmed = await screen.findByTestId("redeem-confirmed");
		expect(
			within(confirmed).getByTestId("redeem-confirmed-discount"),
		).toHaveTextContent(DEMO_DISCOUNT_NAME);
		expect(
			within(confirmed).getByTestId("redeem-void-until"),
		).toHaveTextContent("Quản lý có thể hủy ưu đãi đến 20:00 ngày 19/11/2026.");
		expect(screen.getByTestId("redeem-state")).toHaveTextContent("Đã xác nhận");
		fireEvent.click(screen.getByRole("button", { name: "Hủy ưu đãi" }));
		fill("redeem-void-reason", "Khách đổi ý, không dùng");
		fireEvent.click(screen.getByRole("button", { name: "Xác nhận hủy" }));
		expect(await screen.findByTestId("redeem-voided")).toHaveTextContent(
			"Đã hủy ưu đãi. Dấu hoặc điểm đã trả lại cho khách.",
		);
	});

	it("hides Hủy ưu đãi from staff", async () => {
		renderLoyalty({ path: LOYALTY_PATHS.redeem, storeMode: "staff" });
		await verify(DEMO_CODES.posReward);
		fireEvent.click(
			await screen.findByRole("button", { name: "Xác nhận đã dùng" }),
		);
		await screen.findByTestId("redeem-confirmed");
		expect(screen.queryByRole("button", { name: "Hủy ưu đãi" })).toBeNull();
	});

	it("refuses the staff member who recorded today's bill for this customer", async () => {
		renderLoyalty({ path: LOYALTY_PATHS.redeem, storeMode: "staff" });
		await verify(DEMO_CODES.voucherReward);
		fireEvent.click(
			await screen.findByRole("button", { name: "Xác nhận đã dùng" }),
		);
		expect(
			await screen.findByTestId("redeem-confirm-refused"),
		).toHaveTextContent(
			"Người ghi hóa đơn cho khách hôm nay không được tự xác nhận ưu đãi.",
		);
	});

	it("keeps the POS-synced flow without a confirm button", async () => {
		renderLoyalty({ path: LOYALTY_PATHS.redeem });
		await verify(DEMO_CODES.posReward);
		expect(
			screen.queryByRole("button", { name: "Xác nhận đã dùng" }),
		).toBeNull();
		expect(primaryActions().map((element) => element.textContent)).toEqual([
			"Kiểm tra mã khác",
		]);
	});

	it("has a text for every confirmation refusal", () => {
		for (const refusal of [...CONFIRM_REFUSALS, "other"])
			expect(vi_[`redeem.staff.refusal.${refusal}`]).toBeTruthy();
		expect(vi_["redeem.staff.refusal.same_staff"]).toMatch(
			/^Người ghi hóa đơn cho khách hôm nay không được tự xác nhận ưu đãi/,
		);
	});
});

describe("Ghi nhận khách at a staff-mode store", () => {
	it("says the store records bills by hand and opens Ghi hóa đơn", async () => {
		renderLoyalty({ path: LOYALTY_PATHS.checkIn, storeMode: "staff" });
		const field = await screen.findByTestId(
			"checkin-entry",
			{},
			{ timeout: 4000 },
		);
		fireEvent.change(field, { target: { value: "0900001234" } });
		fireEvent.click(screen.getByRole("button", { name: "Ghi nhận" }));
		const problem = await screen.findByTestId("checkin-problem");
		expect(problem).toHaveAttribute("data-refusal", "staff_mode");
		expect(problem).toHaveTextContent(
			"Cửa hàng này ghi hóa đơn tay thay cho máy POS.",
		);
		fireEvent.click(screen.getByTestId("checkin-to-bills"));
		await billsReady();
		expect(screen.getByTestId("bill-code")).toBeInTheDocument();
	});
});

describe("the home card", () => {
	async function card() {
		const found = await screen.findByTestId(
			"home-loyalty",
			{},
			{ timeout: 4000 },
		);
		return found;
	}

	it.each([
		["staff", false],
		["manager", true],
		["owner", true],
	] as const)(
		"in staff mode, %s: Ghi hóa đơn first, Mã quầy, review %s",
		async (role, review) => {
			renderLoyalty({
				path: LOYALTY_PATHS.bills,
				role,
				storeMode: "staff",
				withHome: true,
				storeId: STORE_1,
			});
			const home = await card();
			await waitFor(() =>
				expect(primaryActions().map((element) => element.textContent)).toEqual([
					"Ghi hóa đơn",
				]),
			);
			expect(
				within(home).getByRole("button", { name: "Mã quầy" }),
			).toBeInTheDocument();
			if (review)
				expect(
					await within(home).findByTestId("home-bill-queue-count"),
				).toHaveTextContent("3 việc cần duyệt");
			else expect(within(home).queryByTestId("home-bill-queue")).toBeNull();
			expect(
				within(home).queryByRole("button", { name: "Ghi nhận khách" }),
			).toBeNull();
		},
	);

	it("keeps the POS-synced card without the staff-mode entries", async () => {
		renderLoyalty({
			path: LOYALTY_PATHS.bills,
			role: "manager",
			withHome: true,
			storeId: STORE_1,
		});
		const home = await card();
		await new Promise((resolve) => setTimeout(resolve, 20));
		expect(primaryActions().map((element) => element.textContent)).toEqual([
			"Ghi nhận khách",
		]);
		expect(within(home).queryByRole("button", { name: "Mã quầy" })).toBeNull();
		expect(within(home).queryByTestId("home-bill-queue")).toBeNull();
	});
});
