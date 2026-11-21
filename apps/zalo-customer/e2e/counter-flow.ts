import { randomBytes } from "node:crypto";
import { watchMiniAppPage } from "@fnb/zalo-mini/testing/design-checks";
import {
	callRpc,
	type RpcCredentials,
	type RpcReply,
} from "@fnb/zalo-mini/testing/network-scan";
import { type Browser, expect, type Page } from "@playwright/test";
import { openTab } from "./customer-checks";
import type { Ready } from "./local-loop";
import {
	type LoyaltyFixture,
	SIM_BRAND,
	SIM_TENANT,
	type SyntheticStaff,
} from "./loyalty-fixture";

// The steps the counter-claim and manager-queue live specs share (ADR-043 and ADR-044): both Mini Apps on loyalty-sim,
// the counter functions called as a session, and the staff app's screens "Mã quầy" and "Duyệt hóa đơn".

export const STORE = "sim-1";
export const POS_STORE = "sim-2";

export function billNo(): string {
	return `IT${randomBytes(3).toString("hex").toUpperCase()}`;
}

export function staffLoopArgs(staff: SyntheticStaff, port: string): string[] {
	return [
		"--tenant",
		SIM_TENANT,
		"--brand",
		SIM_BRAND,
		"--member",
		staff.email,
		"--mock-user",
		staff.mockUser,
		"--mock-name",
		staff.mockName,
		"--port",
		port,
	];
}

/** The staff app on its own phone-sized context, signed in: the home card of the staff-mode store is on screen. */
export async function openStaffHome(
	browser: Browser,
	page: Page,
	ready: Ready,
	contexts: { close(): Promise<void> }[],
): Promise<Page> {
	const context = await browser.newContext({
		viewport: page.viewportSize(),
		isMobile: true,
		hasTouch: true,
		locale: "vi-VN",
		timezoneId: "Asia/Ho_Chi_Minh",
	});
	contexts.push(context);
	const desk = await context.newPage();
	await watchMiniAppPage(desk);
	await desk.goto(ready.appUrl);
	await desk.getByRole("button", { name: "Tiếp tục" }).click();
	await expect(desk.getByTestId("home-loyalty")).toBeVisible();
	return desk;
}

/** Home -> Mã quầy: the counter QR of the store and the customers waiting for a staff member. */
export async function openCounter(desk: Page): Promise<string> {
	await desk
		.getByTestId("home-loyalty")
		.getByRole("button", { name: "Mã quầy" })
		.click();
	const qr = desk.getByTestId("counter-qr");
	await expect(qr).toBeVisible();
	const payload = await qr.getAttribute("data-payload");
	if (payload === null) throw new Error("the counter QR carries no payload");
	return payload;
}

/** The customer's app with the stand-in camera set to read `query` (`scanCode=...`, `scan=refused`, `scan=cancel`). */
export async function setStandInCamera(
	page: Page,
	query: string,
): Promise<void> {
	await page.evaluate((search) => {
		window.history.replaceState(
			null,
			"",
			search === "" ? window.location.pathname : `?${search}`,
		);
	}, query);
}

/** Home -> Nhận điểm từ hóa đơn -> Quét mã tại quầy: the scan step of the counter claim. */
export async function openCounterScan(page: Page): Promise<void> {
	// a screen opened from Trang chủ stays on top of that tab: leave through another tab first
	await openTab(page, "Thẻ thành viên");
	await openTab(page, "Trang chủ");
	await page.getByRole("button", { name: "Nhận điểm từ hóa đơn" }).click();
	await page
		.getByTestId("claim-counter-entry")
		.getByRole("button", { name: "Quét mã tại quầy" })
		.click();
	await expect(page.getByTestId("counter-scan")).toBeVisible();
}

export async function scanAndSend(
	page: Page,
	no: string,
	total: number,
): Promise<void> {
	await page.getByTestId("counter-scan-button").click();
	const form = page.getByTestId("counter-form");
	await expect(form).toBeVisible();
	await form.getByTestId("counter-bill-no").fill(no);
	await form.getByTestId("counter-total").fill(String(total));
	await form.getByRole("button", { name: "Gửi hóa đơn" }).click();
}

export interface Reply {
	readonly status: number;
	readonly code: string | null;
	readonly body: Record<string, unknown>;
}

function shaped(reply: RpcReply): Reply {
	return {
		status: reply.status,
		code: reply.code,
		body:
			typeof reply.body === "object" && reply.body !== null
				? (reply.body as Record<string, unknown>)
				: {},
	};
}

export async function submitClaim(
	session: RpcCredentials,
	qr: string,
	no: string,
	total: number,
): Promise<Reply> {
	return shaped(
		await callRpc(session, "customer_submit_counter_claim", {
			p_qr: qr,
			p_bill_no: no,
			p_total: total,
		}),
	);
}

export async function answerClaim(
	session: RpcCredentials,
	billId: string,
	answer: { readonly total: number } | { readonly reject: string },
): Promise<Reply> {
	return shaped(
		await callRpc(session, "staff_answer_counter_claim", {
			p_bill_id: billId,
			p_total: "total" in answer ? answer.total : null,
			p_reject_reason: "reject" in answer ? answer.reject : null,
		}),
	);
}

export async function decide(
	session: RpcCredentials,
	billId: string,
	decision: string | null,
	reason: string | null,
): Promise<Reply> {
	return shaped(
		await callRpc(session, "staff_decide_bill", {
			p_bill_id: billId,
			p_decision: decision,
			p_reason: reason,
		}),
	);
}

/** the id of the bill a claim reply names */
export function billOf(reply: Reply): string {
	const id = reply.body.bill_id;
	if (typeof id !== "string") throw new Error("the claim made no bill");
	return id;
}

export async function stampsOnCard(
	page: Page,
	fixture: LoyaltyFixture,
	expectedStamps: number,
): Promise<void> {
	await openTab(page, "Trang chủ");
	await openTab(page, "Thẻ thành viên");
	await expect(page.getByTestId("stamp-count")).toHaveText(
		`${fixture.tenant.welcomeStamps + expectedStamps}/${fixture.tenant.stampsPerCard} dấu`,
	);
}
