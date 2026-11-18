import config from "virtual:mini-app-config";
import {
	createRestClient,
	type DataEndpoint,
	type LegalDocument,
	type NoticeAcceptance,
	REST_NETWORK_FAILURE,
	RestError,
	readLegalDocument,
	readStaffNotice,
	STAND_IN_LEGAL_DOCUMENTS,
	STAND_IN_NEW_NOTICE,
	STAND_IN_NOTICE,
	type StoredSession,
} from "@fnb/zalo-mini";
import { getAccessToken } from "zmp-sdk";
import { CONSENT_STATES, type ConsentState, type NoticeCheck } from "./model";

export const ZALO_PHONE_PATH = "/functions/v1/zalo-phone";
export const STAND_IN_PHONE_HINT = "…789";

export interface StaffAccount {
	noticeCheck(): Promise<NoticeCheck>;
	acceptNotice(acceptance: NoticeAcceptance): Promise<void>;
	withdraw(): Promise<void>;
	linkPhone(phoneToken: string): Promise<string | null>;
	legalDocuments(): Promise<readonly LegalDocument[] | null>;
}

export type StaffAccountFactory = (
	endpoint: DataEndpoint,
	session: StoredSession,
) => StaffAccount;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export const PHONE_HINT_MAX_LENGTH = 16;

function phoneHintOf(value: unknown): { readonly phoneHint?: string } {
	return typeof value === "string" &&
		value.trim() !== "" &&
		[...value].length <= PHONE_HINT_MAX_LENGTH
		? { phoneHint: value }
		: {};
}

export function readNoticeCheck(value: unknown): NoticeCheck | null {
	if (!isRecord(value)) return null;
	const consent = CONSENT_STATES.find((name) => name === value.consent);
	if (consent === undefined) return null;
	const hint = phoneHintOf(value.phone_hint);
	if (value.notice === null || value.notice === undefined) {
		return { consent, notice: null, ...hint };
	}
	const notice = readStaffNotice(value.notice);
	return notice === null ? null : { consent, notice, ...hint };
}

export interface RestStaffAccountOptions {
	readonly url: string;
	readonly publishableKey: string;
	readonly session: StoredSession;
	readonly brand: string;
	readonly getZaloAccessToken: () => Promise<string>;
	readonly fetch?: typeof fetch;
}

export function createRestStaffAccount(
	options: RestStaffAccountOptions,
): StaffAccount {
	const send = options.fetch ?? ((input, init) => fetch(input, init));
	const rest = createRestClient({
		url: options.url,
		publishableKey: options.publishableKey,
		accessToken: options.session.accessToken,
		...(options.fetch === undefined ? {} : { fetch: options.fetch }),
	});
	const tenantId = options.session.member.tenantId ?? "";

	function tenant(): string {
		if (tenantId === "") throw new RestError(REST_NETWORK_FAILURE);
		return tenantId;
	}

	async function decodePhone(phoneToken: string): Promise<string> {
		const zaloAccessToken = await options.getZaloAccessToken();
		let response: Response;
		try {
			response = await send(
				`${options.url.replace(/\/+$/, "")}${ZALO_PHONE_PATH}`,
				{
					method: "POST",
					headers: {
						"content-type": "application/json",
						apikey: options.publishableKey,
						Authorization: `Bearer ${options.session.accessToken}`,
					},
					body: JSON.stringify({
						brand: options.brand,
						access_token: zaloAccessToken,
						phone_token: phoneToken,
					}),
				},
			);
		} catch {
			throw new RestError(REST_NETWORK_FAILURE);
		}
		if (!response.ok) {
			await response.body?.cancel();
			throw new RestError(response.status);
		}
		const body: unknown = await response.json().catch(() => null);
		const phone = isRecord(body) ? body.phone_number : null;
		if (typeof phone !== "string" || phone === "") {
			throw new RestError(REST_NETWORK_FAILURE);
		}
		return phone;
	}

	return {
		async noticeCheck() {
			const check = readNoticeCheck(
				await rest.rpc("my_staff_notice", { p_tenant_id: tenant() }),
			);
			if (check === null) throw new RestError(REST_NETWORK_FAILURE);
			return check;
		},
		async acceptNotice(acceptance) {
			await rest.rpc("accept_staff_notice", {
				p_tenant_id: tenant(),
				p_notice_version: acceptance.version,
				p_notice_shown_at: new Date(acceptance.shownAt).toISOString(),
			});
		},
		async withdraw() {
			await rest.rpc("withdraw_staff_ops_consent", { p_tenant_id: tenant() });
		},
		async linkPhone(phoneToken) {
			const id = tenant();
			const phone = await decodePhone(phoneToken);
			const hint = await rest.rpc("link_my_phone", {
				p_tenant_id: id,
				p_phone: phone,
			});
			return typeof hint === "string" ? hint : null;
		},
		async legalDocuments() {
			const rows = await rest.select("legal_documents", {
				select: "kind,language,version,title,body_markdown,published_at",
				tenant_id: `eq.${tenant()}`,
				status: "eq.published",
				kind: "in.(privacy_notice,mini_app_terms)",
				order: "kind.asc,language.asc",
			});
			return rows.flatMap((row) => {
				const document = readLegalDocument(row);
				return document === null ? [] : [document];
			});
		},
	};
}

export interface StandInAccountSettings {
	readonly consent: ConsentState;
	readonly delayMs: number;
}

const MAX_STAND_IN_DELAY_MS = 10_000;

export function standInAccountSettingsFrom(
	search: string,
): StandInAccountSettings {
	const params = new URLSearchParams(search);
	const consent = CONSENT_STATES.find((name) => name === params.get("consent"));
	const delay = Number(params.get("dataDelay") ?? "0");
	return {
		consent:
			consent ?? (params.get("role") === "owner" ? "not_required" : "current"),
		delayMs:
			Number.isInteger(delay) && delay > 0
				? Math.min(delay, MAX_STAND_IN_DELAY_MS)
				: 0,
	};
}

export function createStandInStaffAccount(
	settings: StandInAccountSettings,
): StaffAccount {
	let consent = settings.consent;
	let phoneLinked = false;
	const pause = () =>
		settings.delayMs > 0
			? new Promise<void>((resolve) => setTimeout(resolve, settings.delayMs))
			: Promise.resolve();
	return {
		async noticeCheck() {
			await pause();
			return {
				consent,
				notice:
					consent === "outdated" || consent === "missing"
						? STAND_IN_NEW_NOTICE
						: STAND_IN_NOTICE,
				...(phoneLinked ? { phoneHint: STAND_IN_PHONE_HINT } : {}),
			};
		},
		async acceptNotice() {
			await pause();
			consent = "current";
		},
		async withdraw() {
			await pause();
			consent = "missing";
		},
		async linkPhone() {
			await pause();
			phoneLinked = true;
			return STAND_IN_PHONE_HINT;
		},
		async legalDocuments() {
			await pause();
			return STAND_IN_LEGAL_DOCUMENTS;
		},
	};
}

export function staffAccountFor(
	endpoint: DataEndpoint,
	session: StoredSession,
): StaffAccount {
	if (endpoint.kind === "stand-in") {
		return createStandInStaffAccount(
			standInAccountSettingsFrom(window.location.search),
		);
	}
	return createRestStaffAccount({
		url: endpoint.url,
		publishableKey: endpoint.publishableKey,
		session,
		brand: config.brand,
		getZaloAccessToken: () => getAccessToken(),
	});
}

export function sessionRefused(error: unknown): boolean {
	return (
		error instanceof RestError && (error.status === 401 || error.status === 403)
	);
}
