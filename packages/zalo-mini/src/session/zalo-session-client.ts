import type { NativeStorage } from "../storage/native-storage";
import {
	createSessionStore,
	isSessionFresh,
	readStoredSession,
} from "./session-store";
import {
	LEGAL_DOCUMENT_KINDS,
	type LegalDocument,
	type NoticeAcceptance,
	type PublishedTexts,
	type SessionClient,
	type SessionState,
	type StaffNotice,
	type StoredSession,
	UNPAIRED_REASONS,
	type UnpairedReason,
} from "./types";

export type SessionAnswer =
	| {
			readonly status: "unpaired";
			readonly notice?: StaffNotice;
			readonly reason?: UnpairedReason;
			readonly retryAfterSeconds?: number;
			readonly contact?: string;
	  }
	| {
			readonly status: "notice-required";
			readonly notice: StaffNotice | null;
			readonly contact?: string;
	  }
	| { readonly status: "bound"; readonly session: StoredSession };

export const BINDING_CODE_PATTERN = /^\d{6}$/;
export const PAIRING_CODE_PATTERN = BINDING_CODE_PATTERN;
export const NOTICE_VERSION_PATTERN = /^[a-z0-9][a-z0-9.-]{0,39}$/;
export const CONTACT_MAX_LENGTH = 1000;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function readStaffNotice(value: unknown): StaffNotice | null {
	if (!isRecord(value)) return null;
	const { version, title, body_markdown, published_at } = value;
	if (typeof version !== "string" || !NOTICE_VERSION_PATTERN.test(version))
		return null;
	if (typeof title !== "string" || title.trim() === "") return null;
	if (typeof body_markdown !== "string") return null;
	if (typeof published_at !== "string" || published_at === "") return null;
	return {
		version,
		title,
		bodyMarkdown: body_markdown,
		publishedAt: published_at,
	};
}

function readContact(value: unknown): string | undefined | null {
	if (value === undefined || value === null) return undefined;
	if (typeof value !== "string") return null;
	const contact = value.trim();
	if ([...contact].length > CONTACT_MAX_LENGTH) return null;
	return contact === "" ? undefined : contact;
}

export function readLegalDocument(value: unknown): LegalDocument | null {
	if (!isRecord(value)) return null;
	const { kind, language, version, title, body_markdown, published_at } = value;
	const known = LEGAL_DOCUMENT_KINDS.find((name) => name === kind);
	if (known === undefined) return null;
	if (language !== "vi" && language !== "en") return null;
	if (typeof version !== "string" || !NOTICE_VERSION_PATTERN.test(version))
		return null;
	if (typeof title !== "string" || title.trim() === "") return null;
	if (typeof body_markdown !== "string") return null;
	if (typeof published_at !== "string" || published_at === "") return null;
	return {
		kind: known,
		language,
		version,
		title,
		bodyMarkdown: body_markdown,
		publishedAt: published_at,
	};
}

export function parseTextsAnswer(value: unknown): PublishedTexts | null {
	if (!isRecord(value) || value.status !== "texts") return null;
	if (!Array.isArray(value.documents)) return null;
	const documents: LegalDocument[] = [];
	for (const row of value.documents) {
		if (
			isRecord(row) &&
			!LEGAL_DOCUMENT_KINDS.some((name) => name === row.kind)
		)
			continue;
		const document = readLegalDocument(row);
		if (document === null) return null;
		documents.push(document);
	}
	const contact = readContact(value.contact);
	if (contact === null) return null;
	return { documents, contact: contact ?? null };
}

function readUnpaired(value: Record<string, unknown>): SessionAnswer | null {
	const notice =
		value.notice === undefined ? undefined : readStaffNotice(value.notice);
	if (notice === null) return null;
	const contact = readContact(value.contact);
	if (contact === null) return null;
	const reason = UNPAIRED_REASONS.find((name) => name === value.reason);
	if (value.reason !== undefined && reason === undefined) return null;
	const retryAfter = value.retry_after;
	if (
		retryAfter !== undefined &&
		(typeof retryAfter !== "number" ||
			!Number.isInteger(retryAfter) ||
			retryAfter < 0)
	)
		return null;
	return {
		status: "unpaired",
		...(notice === undefined ? {} : { notice }),
		...(reason === undefined ? {} : { reason }),
		...(retryAfter === undefined ? {} : { retryAfterSeconds: retryAfter }),
		...(contact === undefined ? {} : { contact }),
	};
}

export function parseSessionAnswer(value: unknown): SessionAnswer | null {
	if (!isRecord(value)) return null;
	if (value.status === "unpaired") return readUnpaired(value);
	if (value.status === "notice_required") {
		const contact = readContact(value.contact);
		if (contact === null) return null;
		const withContact = contact === undefined ? {} : { contact };
		if (value.notice === undefined || value.notice === null)
			return { status: "notice-required", notice: null, ...withContact };
		const notice = readStaffNotice(value.notice);
		return notice
			? { status: "notice-required", notice, ...withContact }
			: null;
	}
	if (value.status !== "bound" || !isRecord(value.member)) return null;
	const session = readStoredSession({
		accessToken: value.access_token,
		refreshToken: value.refresh_token,
		expiresAt: value.expires_at,
		member: {
			displayName: value.member.display_name,
			role: value.member.role,
			stores: value.member.stores,
			...(value.member.tenant_id === undefined
				? {}
				: { tenantId: value.member.tenant_id }),
		},
	});
	return session ? { status: "bound", session } : null;
}

export interface ZaloSessionClientOptions {
	readonly endpoint: string;
	readonly brandKey: string;
	readonly publishableKey: string;
	readonly storage: NativeStorage;
	readonly getAccessToken: () => Promise<string>;
	readonly fetch?: typeof fetch;
	readonly now?: () => number;
	readonly onboarding?: boolean;
}

interface SessionStep {
	readonly bindingCode?: string;
	readonly pairingCode?: string;
	readonly acceptance?: NoticeAcceptance;
}

function stepBody(step: SessionStep): Record<string, unknown> {
	return {
		...(step.bindingCode === undefined
			? {}
			: { binding_code: step.bindingCode }),
		...(step.pairingCode === undefined
			? {}
			: { pairing_code: step.pairingCode }),
		...(step.acceptance === undefined
			? {}
			: {
					notice: {
						version: step.acceptance.version,
						shown_at: new Date(step.acceptance.shownAt).toISOString(),
					},
				}),
	};
}

function acceptable(acceptance: NoticeAcceptance): boolean {
	return (
		NOTICE_VERSION_PATTERN.test(acceptance.version) &&
		Number.isFinite(acceptance.shownAt)
	);
}

export function createZaloSessionClient(
	options: ZaloSessionClientOptions,
): SessionClient {
	const store = createSessionStore(options.storage);
	const now = options.now ?? Date.now;
	const send = options.fetch ?? ((input, init) => fetch(input, init));

	async function mint(step: SessionStep): Promise<SessionState> {
		let zaloAccessToken: string;
		try {
			zaloAccessToken = await options.getAccessToken();
		} catch {
			return { status: "failed", reason: "zalo" };
		}
		let response: Response;
		try {
			response = await send(options.endpoint, {
				method: "POST",
				headers: {
					"content-type": "application/json",
					apikey: options.publishableKey,
				},
				body: JSON.stringify({
					access_token: zaloAccessToken,
					brand: options.brandKey,
					...stepBody(step),
				}),
			});
		} catch {
			return { status: "failed", reason: "network" };
		}
		let answer: SessionAnswer | null = null;
		if (response.ok) {
			try {
				answer = parseSessionAnswer(await response.json());
			} catch {
				answer = null;
			}
		}
		if (!answer) {
			store.clear();
			return { status: "failed", reason: "refused" };
		}
		if (answer.status === "unpaired") {
			store.clear();
			const codeSent =
				step.bindingCode !== undefined || step.pairingCode !== undefined;
			return {
				status: "unpaired",
				codeRejected:
					codeSent &&
					(answer.reason === undefined || answer.reason === "code_refused"),
				...(answer.notice === undefined ? {} : { notice: answer.notice }),
				...(answer.reason === undefined ? {} : { reason: answer.reason }),
				...(answer.retryAfterSeconds === undefined
					? {}
					: { retryAfterSeconds: answer.retryAfterSeconds }),
				...(answer.contact === undefined ? {} : { contact: answer.contact }),
			};
		}
		if (answer.status === "notice-required") {
			store.clear();
			return answer;
		}
		store.write(answer.session);
		return { status: "signed-in", session: answer.session };
	}

	let connecting: Promise<SessionState> | null = null;
	let started = options.onboarding !== true;

	async function connect(): Promise<SessionState> {
		const stored = store.read();
		if (stored && isSessionFresh(stored, now())) {
			return { status: "signed-in", session: stored };
		}
		if (stored === null && !started) return { status: "new" };
		if (connecting === null) {
			connecting = mint({}).finally(() => {
				connecting = null;
			});
		}
		return connecting;
	}

	return {
		connect,
		async start() {
			started = true;
			return connect();
		},
		async texts() {
			try {
				const response = await send(options.endpoint, {
					method: "POST",
					headers: {
						"content-type": "application/json",
						apikey: options.publishableKey,
					},
					body: JSON.stringify({ brand: options.brandKey, texts: true }),
				});
				if (!response.ok) {
					await response.body?.cancel();
					return null;
				}
				return parseTextsAnswer(await response.json());
			} catch {
				return null;
			}
		},
		async bind(code) {
			if (!BINDING_CODE_PATTERN.test(code)) {
				return { status: "unpaired", codeRejected: true };
			}
			return mint({ bindingCode: code });
		},
		async pair(code, acceptance) {
			if (!PAIRING_CODE_PATTERN.test(code)) {
				return {
					status: "unpaired",
					codeRejected: true,
					reason: "code_refused",
				};
			}
			if (!acceptable(acceptance)) {
				return { status: "failed", reason: "refused" };
			}
			return mint({ pairingCode: code, acceptance });
		},
		async acceptNotice(acceptance) {
			if (!acceptable(acceptance)) {
				return { status: "failed", reason: "refused" };
			}
			return mint({ acceptance });
		},
		forget() {
			store.clear();
		},
	};
}
