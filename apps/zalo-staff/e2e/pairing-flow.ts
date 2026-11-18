import { checkMiniAppScreen } from "@fnb/zalo-mini/testing/design-checks";
import { expect, type Page } from "@playwright/test";
import {
	checkEntryScreen,
	expectFeedbackWithin,
	expectResultModalClosed,
	watchResultModal,
} from "./entry-checks";
import {
	checkHome,
	expectHomeFor,
	homeSummary,
	watchDataRequests,
} from "./home-check";
import type { PairingFixture } from "./pairing-fixture";

const SESSION_PATH = "/functions/v1/zalo-session";
const CONTACT_FALLBACK =
	"Nếu có câu hỏi, hãy hỏi trực tiếp quản lý cửa hàng của bạn.";

export interface PairingRun {
	readonly sessionCallsBeforeContinue: number;
	readonly answers: readonly string[];
	readonly feedbackMs: number;
	readonly resultModalMs: number;
	readonly home: string;
}

function heading(page: Page, name: string) {
	return page.getByRole("heading", { level: 1, name, exact: true });
}

function otherCode(code: string): string {
	return String((Number(code) + 1) % 1_000_000).padStart(6, "0");
}

interface Answer {
	readonly label: string;
	readonly tenantId: string;
}

async function sessionAnswer(
	page: Page,
	act: () => Promise<void>,
): Promise<Answer> {
	const response = page.waitForResponse(
		(candidate) =>
			candidate.url().endsWith(SESSION_PATH) &&
			candidate.request().method() === "POST",
	);
	await act();
	const answer = await response;
	expect(answer.status()).toBe(200);
	const body = (await answer.json()) as Record<string, unknown>;
	const member = body.member as Record<string, unknown> | undefined;
	return {
		label: `${String(body.status)}${body.reason === undefined ? "" : `:${String(body.reason)}`}`,
		tenantId: typeof member?.tenant_id === "string" ? member.tenant_id : "",
	};
}

export async function pairOnTheLocalStack(
	page: Page,
	fixture: PairingFixture,
	entryUrl: string,
	appUrl: string,
): Promise<PairingRun> {
	const answers: string[] = [];
	let sessionCalls = 0;
	page.on("request", (request) => {
		if (request.url().endsWith(SESSION_PATH)) sessionCalls += 1;
	});
	const dataHeaders = watchDataRequests(page);

	await page.goto(entryUrl);
	await expect(heading(page, "Ứng dụng nội bộ cho nhân viên")).toBeVisible();
	await expect(page.getByTestId("entry")).toContainText(fixture.appTitle);
	await expect(page.getByRole("navigation")).toHaveCount(0);
	await checkEntryScreen(page);
	const sessionCallsBeforeContinue = sessionCalls;

	answers.push(
		(
			await sessionAnswer(page, () =>
				page.getByRole("button", { name: "Tiếp tục" }).click(),
			)
		).label,
	);
	await expect(heading(page, fixture.notice.title)).toBeVisible();
	await expect(page.getByTestId("staff-notice")).toContainText(
		"Văn bản kiểm thử của bộ kiểm thử",
	);
	await checkEntryScreen(page);

	await page.getByRole("button", { name: "Từ chối" }).click();
	await expect(heading(page, "Bạn đã từ chối")).toBeVisible();
	await expect(page.getByTestId("refusal-contact")).toHaveText(
		CONTACT_FALLBACK,
	);
	await checkEntryScreen(page);
	await page.getByRole("button", { name: "Xem lại thông báo" }).click();
	await expect(heading(page, fixture.notice.title)).toBeVisible();

	await page.getByRole("button", { name: "Đồng ý" }).click();
	await expect(heading(page, "Nhập mã ghép nối")).toBeVisible();
	await checkEntryScreen(page);
	const code = await fixture.issueCode();
	const input = page.getByLabel("Mã ghép nối");
	await input.fill(otherCode(code));
	answers.push(
		(
			await sessionAnswer(page, () =>
				page.getByRole("button", { name: "Ghép nối" }).click(),
			)
		).label,
	);
	await expect(page.getByRole("alert")).toHaveText(
		"Mã không đúng hoặc đã hết hạn. Hãy kiểm tra lại hoặc nhờ quản lý cấp mã mới.",
	);
	await checkEntryScreen(page);

	const newNotice = await fixture.publishNewNotice();
	await input.fill(code);
	answers.push(
		(
			await sessionAnswer(page, () =>
				page.getByRole("button", { name: "Ghép nối" }).click(),
			)
		).label,
	);
	await expect(heading(page, newNotice.title)).toBeVisible();
	await expect(page.getByTestId("notice-hint")).toHaveText(
		"Thông báo cho nhân viên vừa có phiên bản mới. Hãy đọc lại trước khi đồng ý.",
	);
	await checkEntryScreen(page);
	await page.getByRole("button", { name: "Đồng ý" }).click();
	await expect(page.getByLabel("Mã ghép nối")).toHaveValue(code);

	await watchResultModal(page);
	let feedbackMs = 0;
	const pairedAnswer = await sessionAnswer(page, async () => {
		feedbackMs = await expectFeedbackWithin(page, () =>
			page.getByRole("button", { name: "Ghép nối" }).click(),
		);
	});
	answers.push(pairedAnswer.label);
	await expect(page.getByTestId("result-modal")).toContainText(
		"Ghép nối thành công",
	);
	const resultModalMs = await expectResultModalClosed(page);

	await expect(
		page.getByRole("heading", { name: `Xin chào, ${fixture.mockName}` }),
	).toBeVisible();
	await expect(page.getByTestId("member-role")).toHaveText("Nhân viên");
	const paired = await fixture.state(newNotice.version);
	expect(paired).toEqual({
		rosterActive: true,
		identityPaired: true,
		staffMember: true,
		memberStores: 1,
		consentNamesNotice: true,
		consentEvidenceKeys:
			"accepted_at,method,notice_channel,notice_shown_at,notice_version",
		revokedConsents: 0,
		liveCodes: 0,
	});
	const home = await checkHome(
		page,
		appUrl,
		await dataHeaders(),
		pairedAnswer.tenantId,
	);
	expectHomeFor("staff", 1, home);
	await checkMiniAppScreen(page);

	await page
		.getByRole("navigation", { name: "Điều hướng chính" })
		.getByRole("button", { name: "Cá nhân" })
		.click();
	await expect(page.getByTestId("profile")).toBeVisible();
	await checkEntryScreen(page);
	for (const [button, title] of [
		["Quyền riêng tư", fixture.privacy.title],
		["Điều khoản sử dụng", fixture.terms.title],
	] as const) {
		await page.getByRole("button", { name: button }).click();
		const dialog = page.getByRole("dialog", { name: title });
		await expect(dialog).toBeVisible();
		await expect(dialog).toContainText("Văn bản kiểm thử");
		await checkMiniAppScreen(page);
		await dialog.getByRole("button", { name: "Đóng" }).click();
		await expect(dialog).toHaveCount(0);
	}

	await page.getByRole("button", { name: "Rút lại đồng ý" }).click();
	const confirm = page.getByRole("dialog", { name: "Rút lại đồng ý?" });
	await checkEntryScreen(page);
	answers.push(
		(
			await sessionAnswer(page, () =>
				confirm.getByRole("button", { name: "Rút lại đồng ý" }).click(),
			)
		).label,
	);
	await expect(page.getByTestId("result-modal")).toContainText(
		"Đã rút lại đồng ý",
	);
	await expect(heading(page, newNotice.title)).toBeVisible();
	await expect(page.getByRole("navigation")).toHaveCount(0);
	await checkEntryScreen(page);
	const withdrawn = await fixture.state(newNotice.version);
	expect(withdrawn).toMatchObject({
		identityPaired: false,
		consentNamesNotice: false,
		revokedConsents: 1,
	});

	return {
		sessionCallsBeforeContinue,
		answers,
		feedbackMs: Math.round(feedbackMs),
		resultModalMs: Math.round(resultModalMs),
		home: homeSummary(home),
	};
}

export function pairingSummary(run: PairingRun): string {
	return [
		`zalo-session calls before Tiếp tục ${run.sessionCallsBeforeContinue}`,
		`answers ${run.answers.join(" → ")}`,
		`loading feedback ${run.feedbackMs} ms`,
		`result modal ${run.resultModalMs} ms`,
		run.home,
	].join("; ");
}
