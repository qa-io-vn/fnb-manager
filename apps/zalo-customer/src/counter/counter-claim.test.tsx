// Test design for the counter claim ("Quét mã tại quầy") and its entry points on the receipt claim screen:
// - equivalence partitioning of what the camera answers: a counter QR, another code (member code, voucher, link),
//   a refused camera, a cancelled scan;
// - state transitions: scan -> form -> result -> scan again, and form -> rescan;
// - decision table of the server's refusals to texts (every known refusal has a Vietnamese text, an unknown one
//   reads as other), with the stale and replayed code offering a new scan;
// - error guessing: the stand-in camera's address switches;
// - security: a scan that is not a counter QR is never sent, and no staff total or phone digits are rendered.
import {
	COUNTER_CLAIM_REFUSALS,
	type CounterClaimResult,
} from "@fnb/zalo-mini/loyalty";
import { fireEvent, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { counterRefusalKey, readScan, rescanAfter } from "../bills/model";
import {
	DEMO_COUNTER_QR,
	DEMO_LIVE_COUNTER_QRS,
	DEMO_STALE_COUNTER_QR,
} from "../demo/fixtures";
import { appCatalogs } from "../i18n/catalog";
import { renderCustomerApp, setSearch } from "../test/render-app";
import { CounterClaimView } from "./counter-claim";
import { type Scan, type ScanResult, standInScan } from "./scan";

afterEach(() => setSearch(""));

function scanning(...answers: ScanResult[]): {
	readonly scan: Scan;
	readonly count: () => number;
} {
	let calls = 0;
	return {
		scan: async () => {
			const answer = answers[Math.min(calls, answers.length - 1)];
			calls += 1;
			return answer ?? { kind: "cancelled" };
		},
		count: () => calls,
	};
}

const content = (text: string): ScanResult => ({
	kind: "content",
	content: text,
});

function renderCounter(scan: Scan, settings = { staffMode: true }) {
	return renderCustomerApp({
		settings: { member: true, ...settings },
		routes: [{ path: "/", element: <CounterClaimView scan={scan} /> }],
	});
}

async function scanOnce() {
	fireEvent.click(await screen.findByTestId("counter-scan-button"));
}

async function send(billNo: string, total: string) {
	const form = await screen.findByTestId("counter-form");
	fireEvent.change(within(form).getByTestId("counter-bill-no"), {
		target: { value: billNo },
	});
	fireEvent.change(within(form).getByTestId("counter-total"), {
		target: { value: total },
	});
	fireEvent.click(within(form).getByRole("button", { name: "Gửi hóa đơn" }));
	return screen.findByTestId("counter-result");
}

describe("the counter claim's rules", () => {
	it("read only a counter QR from a scan", () => {
		expect(readScan(` ${DEMO_COUNTER_QR} `)).toEqual({
			kind: "counter",
			qr: { payload: DEMO_COUNTER_QR, storeCode: "mau-1" },
		});
		for (const other of [
			"fnb-member:1:mau-1:123456",
			"fnb-redeem:1:K7M2Q9TX",
			"https://zalo.me/s/123",
			"",
		]) {
			expect(readScan(other)).toEqual({ kind: "not-counter" });
		}
	});

	it("word every refusal, an unknown one as other, and offer a new scan for a bad code only", () => {
		const vi: Record<string, string> = appCatalogs.vi;
		for (const refusal of COUNTER_CLAIM_REFUSALS)
			expect(vi[counterRefusalKey(refusal)], refusal).toBeTruthy();
		expect(counterRefusalKey("staff_shift_cap")).toBe("counter.refusal.other");
		const refused = (refusal: string): CounterClaimResult => ({
			state: "refused",
			refusal,
			billId: null,
			evidenceLevel: null,
			stampsEarned: null,
			pointsEarned: null,
			expiresAt: null,
			retryAt: null,
		});
		expect(
			COUNTER_CLAIM_REFUSALS.filter((refusal) => rescanAfter(refused(refusal))),
		).toEqual(["code_unknown", "wrong_store", "code_expired", "code_used"]);
	});

	it("drive the stand-in camera from the address", async () => {
		expect(await standInScan("?scan=refused")()).toEqual({ kind: "refused" });
		expect(await standInScan("?scan=cancel")()).toEqual({ kind: "cancelled" });
		expect(
			await standInScan(`?scanCode=${encodeURIComponent("abc")}`)(),
		).toEqual({ kind: "content", content: "abc" });
		expect(await standInScan("")()).toEqual({
			kind: "content",
			content: DEMO_COUNTER_QR,
		});
	});
});

describe("claiming with the counter QR", () => {
	it("scans, names the store, checks the fields and confirms a small bill at once", async () => {
		const { scan } = scanning(content(DEMO_COUNTER_QR));
		renderCounter(scan);
		await scanOnce();
		const form = await screen.findByTestId("counter-form");
		expect(within(form).getByTestId("counter-store")).toHaveTextContent(
			"Đã quét mã tại quầy của Cửa hàng Mẫu 1",
		);
		fireEvent.click(within(form).getByRole("button", { name: "Gửi hóa đơn" }));
		expect(within(form).getByText("Hãy nhập số hóa đơn.")).toBeInTheDocument();
		expect(
			within(form).getByText("Hãy nhập tổng tiền bạn đã trả."),
		).toBeInTheDocument();
		const result = await send("HD0600", "45000");
		expect(result).toHaveAttribute("data-state", "confirmed");
		expect(result).toHaveTextContent("Đã cộng điểm");
		expect(within(result).getByTestId("counter-earned")).toHaveTextContent(
			"+1 dấu · +45 điểm",
		);
	});

	it("leaves a larger bill to the staff with the deadline", async () => {
		const { scan } = scanning(content(DEMO_COUNTER_QR));
		renderCounter(scan);
		await scanOnce();
		const result = await send("HD0601", "150000");
		expect(result).toHaveAttribute("data-state", "awaiting_staff");
		expect(within(result).getByTestId("counter-result-body")).toHaveTextContent(
			/^Nhân viên sẽ đối chiếu hóa đơn HD0601 trước \d\d:\d\d \d\d\/\d\d\/\d{4}\. Điểm được cộng khi khớp\.$/,
		);
	});

	it("refuses a replayed code and an expired one, each with a new scan offered", async () => {
		const { scan } = scanning(
			content(DEMO_COUNTER_QR),
			content(DEMO_COUNTER_QR),
			content(DEMO_STALE_COUNTER_QR),
		);
		renderCounter(scan);
		await scanOnce();
		await send("HD0602", "45000");
		fireEvent.click(screen.getByRole("button", { name: "Quét mã khác" }));
		await scanOnce();
		const replayed = await send("HD0603", "45000");
		expect(replayed).toHaveAttribute("data-refusal", "code_used");
		expect(replayed).toHaveTextContent(
			"Bạn đã dùng mã này rồi. Mỗi mã chỉ dùng được một lần, hãy quét mã mới.",
		);
		fireEvent.click(within(replayed).getByRole("button", { name: "Quét lại" }));
		await scanOnce();
		const stale = await send("HD0604", "45000");
		expect(stale).toHaveAttribute("data-refusal", "code_expired");
		expect(stale).toHaveTextContent(
			"Mã tại quầy đã hết hạn. Hãy quét mã mới trên màn hình của nhân viên.",
		);
	});

	it("never sends a code that is not a counter QR, and says what to scan", async () => {
		const { scan, count } = scanning(
			content("fnb-member:1:mau-1:123456"),
			content(DEMO_LIVE_COUNTER_QRS[1] ?? ""),
		);
		renderCounter(scan);
		await scanOnce();
		expect(await screen.findByTestId("counter-notice")).toHaveTextContent(
			"Đây không phải mã tại quầy. Hãy quét mã QR trên màn hình của nhân viên thu ngân.",
		);
		expect(screen.queryByTestId("counter-form")).toBeNull();
		expect(count()).toBe(1);
		await scanOnce();
		expect(await screen.findByTestId("counter-form")).toBeInTheDocument();
	});

	it("asks for the camera when it is refused, and stays quiet when the scan is cancelled", async () => {
		const { scan } = scanning({ kind: "cancelled" }, { kind: "refused" });
		renderCounter(scan);
		await scanOnce();
		expect(await screen.findByTestId("counter-scan-button")).toBeEnabled();
		expect(screen.queryByTestId("counter-notice")).toBeNull();
		await scanOnce();
		expect(await screen.findByTestId("counter-notice")).toHaveTextContent(
			"Hãy cho phép Zalo dùng camera để quét mã tại quầy.",
		);
	});

	it("says the store does not take counter codes when it runs on POS sync", async () => {
		const { scan } = scanning(content(DEMO_COUNTER_QR));
		renderCounter(scan, { staffMode: false });
		await scanOnce();
		const result = await send("HD0605", "45000");
		expect(result).toHaveAttribute("data-refusal", "not_available");
		expect(result).toHaveTextContent(
			"Cửa hàng này chưa nhận điểm bằng mã tại quầy.",
		);
		expect(document.body.textContent).not.toMatch(/789/);
	});
});

describe("the receipt claim at a staff-mode store", () => {
	async function openClaim() {
		await screen.findByRole("heading", { name: /Cửa hàng Mẫu/ });
		fireEvent.click(
			screen.getByRole("button", { name: "Nhận điểm từ hóa đơn" }),
		);
		return screen.findByTestId("claim-form");
	}

	it("points to the counter QR before sending, and after a staff_mode refusal", async () => {
		renderCustomerApp({
			settings: { member: true, staffMode: true },
			search: "?store=mau-1",
		});
		const form = await openClaim();
		expect(screen.getByTestId("claim-counter-entry")).toHaveTextContent(
			"Mua ở cửa hàng có mã QR tại quầy? Quét mã đó để nhận điểm.",
		);
		expect(within(form).getByTestId("claim-staff-store")).toHaveTextContent(
			"Cửa hàng này ghi nhận điểm qua nhân viên.",
		);
		fireEvent.change(within(form).getByTestId("claim-store"), {
			target: { value: "mau-2" },
		});
		expect(within(form).queryByTestId("claim-staff-store")).toBeNull();
		fireEvent.change(within(form).getByTestId("claim-store"), {
			target: { value: "mau-1" },
		});
		fireEvent.change(within(form).getByTestId("claim-receipt"), {
			target: { value: "1001" },
		});
		fireEvent.change(within(form).getByTestId("claim-amount"), {
			target: { value: "85000" },
		});
		fireEvent.click(within(form).getByRole("button", { name: "Gửi hóa đơn" }));
		const result = await screen.findByTestId("claim-result");
		expect(result).toHaveAttribute("data-state", "rejected");
		expect(result).toHaveTextContent(
			"Cửa hàng này ghi nhận điểm qua nhân viên, không qua hóa đơn bạn gửi. Hãy quét mã tại quầy để nhận điểm.",
		);
		fireEvent.click(
			within(result).getByRole("button", { name: "Quét mã tại quầy" }),
		);
		expect(await screen.findByTestId("counter-claim")).toBeInTheDocument();
	});

	it("shows no counter entry when no store takes counter codes", async () => {
		renderCustomerApp({ settings: { member: true }, search: "?store=mau-1" });
		await openClaim();
		expect(screen.queryByTestId("claim-counter-entry")).toBeNull();
		expect(screen.queryByTestId("claim-staff-store")).toBeNull();
	});
});
