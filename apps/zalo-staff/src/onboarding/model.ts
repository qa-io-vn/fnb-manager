import type {
	NoticeAcceptance,
	SessionState,
	StaffNotice,
} from "@fnb/zalo-mini";

export const CONSENT_STATES = [
	"current",
	"outdated",
	"missing",
	"not_required",
] as const;

export type ConsentState = (typeof CONSENT_STATES)[number];

export interface NoticeCheck {
	readonly consent: ConsentState;
	readonly notice: StaffNotice | null;
}

export type MemberCheck =
	| { readonly status: "checking" }
	| { readonly status: "done"; readonly check: NoticeCheck | null };

export type EntryResult = "paired" | "accepted" | "phone-linked" | "withdrawn";

export const RESULT_KEYS: Readonly<Record<EntryResult, string>> = {
	paired: "entry.result.paired",
	accepted: "entry.result.accepted",
	"phone-linked": "entry.result.phoneLinked",
	withdrawn: "entry.result.withdrawn",
};

export type EntryStep = "notice" | "pairing" | "refused";

export interface EntryUi {
	readonly step: EntryStep;
	readonly accepted: NoticeAcceptance | null;
	readonly code: string;
	readonly noticeUpdated: boolean;
	readonly waitUntil: number | null;
	readonly pending: "pair" | "accept" | null;
	readonly result: EntryResult | null;
}

export const initialEntryUi: EntryUi = {
	step: "notice",
	accepted: null,
	code: "",
	noticeUpdated: false,
	waitUntil: null,
	pending: null,
	result: null,
};

export type EntryEvent =
	| { readonly type: "accept"; readonly acceptance: NoticeAcceptance }
	| { readonly type: "decline" }
	| { readonly type: "review" }
	| { readonly type: "code"; readonly code: string }
	| { readonly type: "submit"; readonly kind: "pair" | "accept" }
	| {
			readonly type: "answer";
			readonly state: SessionState;
			readonly at: number;
	  }
	| { readonly type: "result"; readonly result: EntryResult }
	| { readonly type: "resultShown" };

export const PAIRING_CODE_LENGTH = 6;

export function codeFrom(text: string): string {
	return text.replace(/\D/g, "").slice(0, PAIRING_CODE_LENGTH);
}

function answered(ui: EntryUi, state: SessionState, at: number): EntryUi {
	if (state.status === "connecting") return ui;
	const settled = { ...ui, pending: null };
	if (state.status === "signed-in") {
		if (ui.pending === null) return settled;
		return {
			...initialEntryUi,
			result: ui.pending === "pair" ? "paired" : "accepted",
		};
	}
	if (state.status === "unpaired" && state.reason === "notice_outdated") {
		return {
			...settled,
			step: "notice",
			accepted: null,
			noticeUpdated: true,
			waitUntil: null,
		};
	}
	if (state.status === "unpaired" && state.reason === "wait") {
		return {
			...settled,
			waitUntil: at + (state.retryAfterSeconds ?? 0) * 1000,
		};
	}
	if (state.status === "unpaired") return { ...settled, waitUntil: null };
	return settled;
}

export function entryReducer(ui: EntryUi, event: EntryEvent): EntryUi {
	switch (event.type) {
		case "accept":
			return {
				...ui,
				step: "pairing",
				accepted: event.acceptance,
				noticeUpdated: false,
			};
		case "decline":
			return { ...ui, step: "refused" };
		case "review":
			return { ...ui, step: "notice" };
		case "code":
			return { ...ui, code: codeFrom(event.code) };
		case "submit":
			return { ...ui, pending: event.kind };
		case "answer":
			return answered(ui, event.state, event.at);
		case "result":
			return event.result === "withdrawn" || event.result === "accepted"
				? { ...initialEntryUi, result: event.result }
				: { ...ui, result: event.result };
		case "resultShown":
			return { ...ui, result: null };
	}
}

export type NoticeVia = "pairing" | "session" | "member";

export type EntryScreen =
	| { readonly kind: "onboarding" }
	| { readonly kind: "connecting" }
	| { readonly kind: "failed" }
	| { readonly kind: "no-notice" }
	| {
			readonly kind: "notice";
			readonly notice: StaffNotice;
			readonly updated: boolean;
			readonly via: NoticeVia;
	  }
	| {
			readonly kind: "pairing";
			readonly notice: StaffNotice;
			readonly refused: boolean;
			readonly waitUntil: number | null;
	  }
	| { readonly kind: "refused"; readonly contact: string | null }
	| { readonly kind: "app" };

export function needsNotice(check: NoticeCheck | null): check is NoticeCheck & {
	readonly notice: StaffNotice;
} {
	return (
		check !== null &&
		check.notice !== null &&
		(check.consent === "outdated" || check.consent === "missing")
	);
}

export function entryScreen(
	state: SessionState,
	ui: EntryUi,
	member: MemberCheck,
): EntryScreen {
	switch (state.status) {
		case "new":
			return { kind: "onboarding" };
		case "connecting":
			return { kind: "connecting" };
		case "failed":
			return { kind: "failed" };
		case "unpaired": {
			const notice = state.notice;
			if (notice === undefined) return { kind: "no-notice" };
			if (ui.step === "refused")
				return { kind: "refused", contact: state.contact ?? null };
			if (ui.step === "pairing" && ui.accepted?.version === notice.version) {
				return {
					kind: "pairing",
					notice,
					refused: state.codeRejected,
					waitUntil: ui.waitUntil,
				};
			}
			return {
				kind: "notice",
				notice,
				updated: ui.noticeUpdated,
				via: "pairing",
			};
		}
		case "notice-required": {
			if (state.notice === null) return { kind: "no-notice" };
			if (ui.step === "refused")
				return { kind: "refused", contact: state.contact ?? null };
			return {
				kind: "notice",
				notice: state.notice,
				updated: false,
				via: "session",
			};
		}
		case "signed-in": {
			if (member.status === "checking") return { kind: "connecting" };
			if (!needsNotice(member.check)) return { kind: "app" };
			if (ui.step === "refused") return { kind: "refused", contact: null };
			return {
				kind: "notice",
				notice: member.check.notice,
				updated: member.check.consent === "outdated",
				via: "member",
			};
		}
	}
}

export function waitText(remainingMs: number): string {
	const seconds = Math.max(0, Math.ceil(remainingMs / 1000));
	const minutes = Math.floor(seconds / 60);
	return `${String(minutes).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}
