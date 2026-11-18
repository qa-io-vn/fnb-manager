import type { NativeStorage } from "../storage/native-storage";
import type {
	LegalDocument,
	MemberProfile,
	SessionClient,
	StaffNotice,
} from "./types";
import { createZaloSessionClient } from "./zalo-session-client";

export const STAND_IN_SCENARIOS = [
	"bound",
	"unpaired",
	"notice",
	"failed",
] as const;

export type StandInScenario = (typeof STAND_IN_SCENARIOS)[number];

export const STAND_IN_REJECTED_CODE = "000000";
export const STAND_IN_WAIT_CODE = "999999";
export const STAND_IN_WAIT_SECONDS = 900;
export const STAND_IN_NOTICE: StaffNotice = {
	version: "stand-in-notice-1",
	title: "Thông báo cho nhân viên (bản thử)",
	bodyMarkdown: "Văn bản giữ chỗ của bản thử, không phải văn bản pháp lý.",
	publishedAt: "2026-11-01T00:00:00+00:00",
};
export const STAND_IN_NEW_NOTICE: StaffNotice = {
	version: "stand-in-notice-2",
	title: "Thông báo cho nhân viên (bản thử, phiên bản mới)",
	bodyMarkdown:
		"Phiên bản mới của văn bản giữ chỗ, không phải văn bản pháp lý.",
	publishedAt: "2026-11-02T00:00:00+00:00",
};
export const STAND_IN_CONTACT =
	"Văn bản liên hệ giữ chỗ của bản thử: hãy hỏi quản lý cửa hàng tại quầy.";

const STAND_IN_PUBLISHED_AT = "2026-11-01T00:00:00+00:00";
const STAND_IN_BODY_VI =
	"Văn bản giữ chỗ của bản thử, không phải văn bản pháp lý.";
const STAND_IN_BODY_EN = "Placeholder text of the stand-in, not a legal text.";

export const STAND_IN_LEGAL_DOCUMENTS: readonly LegalDocument[] = [
	{
		kind: "privacy_notice",
		language: "vi",
		version: "stand-in-privacy-1",
		title: "Chính sách quyền riêng tư (bản thử)",
		bodyMarkdown: STAND_IN_BODY_VI,
		publishedAt: STAND_IN_PUBLISHED_AT,
	},
	{
		kind: "privacy_notice",
		language: "en",
		version: "stand-in-privacy-1",
		title: "Privacy notice (stand-in)",
		bodyMarkdown: STAND_IN_BODY_EN,
		publishedAt: STAND_IN_PUBLISHED_AT,
	},
	{
		kind: "mini_app_terms",
		language: "vi",
		version: "stand-in-terms-1",
		title: "Điều khoản sử dụng (bản thử)",
		bodyMarkdown: STAND_IN_BODY_VI,
		publishedAt: STAND_IN_PUBLISHED_AT,
	},
	{
		kind: "mini_app_terms",
		language: "en",
		version: "stand-in-terms-1",
		title: "Terms of use (stand-in)",
		bodyMarkdown: STAND_IN_BODY_EN,
		publishedAt: STAND_IN_PUBLISHED_AT,
	},
];

export interface StandInSettings {
	readonly scenario: StandInScenario;
	readonly delayMs: number;
	readonly noticeChange?: boolean;
}

const MAX_STAND_IN_DELAY_MS = 10_000;
const STAND_IN_SESSION_SECONDS = 3600;

export function standInSettingsFrom(search: string): StandInSettings {
	const params = new URLSearchParams(search);
	const requested = params.get("session") ?? "";
	const scenario = STAND_IN_SCENARIOS.find((name) => name === requested);
	const delay = Number(params.get("delay") ?? "0");
	const delayMs =
		Number.isInteger(delay) && delay > 0
			? Math.min(delay, MAX_STAND_IN_DELAY_MS)
			: 0;
	return {
		scenario: scenario ?? "bound",
		delayMs,
		...(params.get("notice") === "changed" ? { noticeChange: true } : {}),
	};
}

export interface StandInSessionOptions {
	readonly settings: StandInSettings;
	readonly member: MemberProfile;
	readonly storage: NativeStorage;
	readonly getAccessToken: () => Promise<string>;
	readonly now?: () => number;
	readonly onboarding?: boolean;
}

interface StandInRequest {
	readonly texts: boolean;
	readonly bindingCode: string | null;
	readonly pairingCode: string | null;
	readonly noticeVersion: string | null;
}

function wait(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function textField(record: object, key: string): string | null {
	const value = (record as Record<string, unknown>)[key];
	return typeof value === "string" ? value : null;
}

function requestOf(init: RequestInit | undefined): StandInRequest {
	const body: unknown =
		typeof init?.body === "string" ? JSON.parse(init.body) : null;
	if (typeof body !== "object" || body === null) {
		return {
			texts: false,
			bindingCode: null,
			pairingCode: null,
			noticeVersion: null,
		};
	}
	const notice = (body as Record<string, unknown>).notice;
	return {
		texts: (body as Record<string, unknown>).texts === true,
		bindingCode: textField(body, "binding_code"),
		pairingCode: textField(body, "pairing_code"),
		noticeVersion:
			typeof notice === "object" && notice !== null
				? textField(notice, "version")
				: null,
	};
}

function noticeAnswer(notice: StaffNotice): Record<string, unknown> {
	return {
		version: notice.version,
		title: notice.title,
		body_markdown: notice.bodyMarkdown,
		published_at: notice.publishedAt,
	};
}

const textsAnswer = {
	status: "texts",
	documents: STAND_IN_LEGAL_DOCUMENTS.map((document) => ({
		kind: document.kind,
		language: document.language,
		version: document.version,
		title: document.title,
		body_markdown: document.bodyMarkdown,
		published_at: document.publishedAt,
	})),
	contact: STAND_IN_CONTACT,
};

export function createStandInSessionClient(
	options: StandInSessionOptions,
): SessionClient {
	const now = options.now ?? Date.now;
	const scenario = options.settings.scenario;
	let bound = scenario === "bound" || scenario === "notice";
	let noticeAccepted = scenario !== "notice";
	let notice = STAND_IN_NOTICE;
	let noticeChangePending = options.settings.noticeChange === true;

	function unpaired(
		reason?: string,
		retryAfter?: number,
	): Record<string, unknown> {
		return {
			status: "unpaired",
			...(reason === undefined ? {} : { reason }),
			...(retryAfter === undefined ? {} : { retry_after: retryAfter }),
			notice: noticeAnswer(notice),
			contact: STAND_IN_CONTACT,
		};
	}

	function boundAnswer(): Record<string, unknown> {
		return {
			status: "bound",
			access_token: "stand-in-session",
			refresh_token: "stand-in-refresh",
			expires_at: Math.floor(now() / 1000) + STAND_IN_SESSION_SECONDS,
			member: {
				display_name: options.member.displayName,
				role: options.member.role,
				stores: options.member.stores,
				...(options.member.tenantId === undefined
					? {}
					: { tenant_id: options.member.tenantId }),
			},
		};
	}

	function answerTo(request: StandInRequest): Record<string, unknown> {
		if (request.texts) return textsAnswer;
		const accepted = request.noticeVersion === notice.version;
		if (bound) {
			if (!noticeAccepted && !accepted) {
				return {
					status: "notice_required",
					notice: noticeAnswer(notice),
					contact: STAND_IN_CONTACT,
				};
			}
			noticeAccepted = true;
			return boundAnswer();
		}
		if (request.pairingCode !== null) {
			if (accepted && noticeChangePending) {
				noticeChangePending = false;
				notice = STAND_IN_NEW_NOTICE;
				return unpaired("notice_outdated");
			}
			if (!accepted) return unpaired("notice_outdated");
			if (request.pairingCode === STAND_IN_WAIT_CODE)
				return unpaired("wait", STAND_IN_WAIT_SECONDS);
			if (request.pairingCode === STAND_IN_REJECTED_CODE)
				return unpaired("code_refused");
			bound = true;
			noticeAccepted = true;
			return boundAnswer();
		}
		if (
			request.bindingCode !== null &&
			request.bindingCode !== STAND_IN_REJECTED_CODE
		) {
			bound = true;
			return boundAnswer();
		}
		return unpaired();
	}

	const standInFetch: typeof fetch = async (_input, init) => {
		if (options.settings.delayMs > 0) await wait(options.settings.delayMs);
		if (scenario === "failed") {
			throw new TypeError("stand-in network failure");
		}
		return new Response(JSON.stringify(answerTo(requestOf(init))), {
			status: 200,
			headers: { "content-type": "application/json" },
		});
	};
	const client = createZaloSessionClient({
		endpoint: "stand-in:zalo-session",
		brandKey: "stand-in",
		publishableKey: "stand-in",
		storage: options.storage,
		getAccessToken: options.getAccessToken,
		fetch: standInFetch,
		now,
		onboarding: options.onboarding === true && scenario === "unpaired",
	});
	return {
		...client,
		forget() {
			bound = false;
			noticeAccepted = false;
			client.forget();
		},
	};
}
