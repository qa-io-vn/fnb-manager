import {
	type SessionState,
	STAND_IN_NEW_NOTICE,
	STAND_IN_NOTICE,
} from "@fnb/zalo-mini";
import { describe, expect, it } from "vitest";
import {
	codeFrom,
	type EntryUi,
	entryReducer,
	entryScreen,
	initialEntryUi,
	type MemberCheck,
	waitText,
} from "./model";

const AT = Date.UTC(2026, 10, 18, 5, 0, 0);
const done: MemberCheck = { status: "done", check: null };
const acceptance = { version: STAND_IN_NOTICE.version, shownAt: AT };
const unpaired: SessionState = {
	status: "unpaired",
	codeRejected: false,
	notice: STAND_IN_NOTICE,
	contact: "Hỏi quản lý tại quầy.",
};
const signedIn: SessionState = {
	status: "signed-in",
	session: {
		accessToken: "session-a",
		refreshToken: "",
		expiresAt: AT / 1000 + 3600,
		member: {
			displayName: "Nhân viên thử",
			role: "staff",
			stores: [],
			tenantId: "tenant-1",
		},
	},
};

function run(ui: EntryUi, ...events: Parameters<typeof entryReducer>[1][]) {
	return events.reduce(entryReducer, ui);
}

describe("the staff app's entry states", () => {
	it("new: onboarding before any Zalo identity call", () => {
		expect(entryScreen({ status: "new" }, initialEntryUi, done)).toEqual({
			kind: "onboarding",
		});
		expect(
			entryScreen({ status: "connecting" }, initialEntryUi, done).kind,
		).toBe("connecting");
		expect(
			entryScreen({ status: "failed", reason: "network" }, initialEntryUi, done)
				.kind,
		).toBe("failed");
	});

	it("notice: the published notice first, and no pairing without one", () => {
		expect(entryScreen(unpaired, initialEntryUi, done)).toEqual({
			kind: "notice",
			notice: STAND_IN_NOTICE,
			updated: false,
			via: "pairing",
		});
		expect(
			entryScreen(
				{ status: "unpaired", codeRejected: false },
				initialEntryUi,
				done,
			).kind,
		).toBe("no-notice");
	});

	it("pairing: after the person agrees, with the notice they agreed to", () => {
		const ui = run(initialEntryUi, { type: "accept", acceptance });
		expect(ui).toMatchObject({ step: "pairing", accepted: acceptance });
		expect(entryScreen(unpaired, ui, done)).toEqual({
			kind: "pairing",
			notice: STAND_IN_NOTICE,
			refused: false,
			waitUntil: null,
		});
		expect(
			entryScreen(
				{ ...unpaired, codeRejected: true, reason: "code_refused" },
				ui,
				done,
			),
		).toMatchObject({ kind: "pairing", refused: true });
	});

	it("refused: the contact instructions, and back to the notice on request", () => {
		const declined = run(initialEntryUi, { type: "decline" });
		expect(entryScreen(unpaired, declined, done)).toEqual({
			kind: "refused",
			contact: "Hỏi quản lý tại quầy.",
		});
		expect(
			entryScreen(
				{ status: "unpaired", codeRejected: false, notice: STAND_IN_NOTICE },
				declined,
				done,
			),
		).toEqual({ kind: "refused", contact: null });
		expect(
			entryScreen(unpaired, run(declined, { type: "review" }), done).kind,
		).toBe("notice");
	});

	it("paired: the app with a result once the code is accepted", () => {
		const pairing = run(
			initialEntryUi,
			{ type: "accept", acceptance },
			{ type: "code", code: "12a3456" },
			{ type: "submit", kind: "pair" },
		);
		expect(pairing.code).toBe("123456");
		const paired = run(pairing, { type: "answer", state: signedIn, at: AT });
		expect(paired).toEqual({ ...initialEntryUi, result: "paired" });
		expect(entryScreen(signedIn, paired, done)).toEqual({ kind: "app" });
		expect(run(paired, { type: "resultShown" }).result).toBeNull();
	});

	it("notice outdated while pairing: the new notice again, the code kept", () => {
		const pairing = run(
			initialEntryUi,
			{ type: "accept", acceptance },
			{ type: "code", code: "123456" },
			{ type: "submit", kind: "pair" },
		);
		const outdated: SessionState = {
			status: "unpaired",
			codeRejected: false,
			reason: "notice_outdated",
			notice: STAND_IN_NEW_NOTICE,
		};
		const ui = run(pairing, { type: "answer", state: outdated, at: AT });
		expect(ui).toMatchObject({
			step: "notice",
			accepted: null,
			code: "123456",
			noticeUpdated: true,
		});
		expect(entryScreen(outdated, ui, done)).toEqual({
			kind: "notice",
			notice: STAND_IN_NEW_NOTICE,
			updated: true,
			via: "pairing",
		});
		const again = run(ui, {
			type: "accept",
			acceptance: { version: STAND_IN_NEW_NOTICE.version, shownAt: AT },
		});
		expect(entryScreen(outdated, again, done).kind).toBe("pairing");
	});

	it("notice outdated after pairing: asked by zalo-session or by the member check", () => {
		expect(
			entryScreen(
				{ status: "notice-required", notice: STAND_IN_NEW_NOTICE },
				initialEntryUi,
				done,
			),
		).toEqual({
			kind: "notice",
			notice: STAND_IN_NEW_NOTICE,
			updated: false,
			via: "session",
		});
		expect(
			entryScreen(signedIn, initialEntryUi, { status: "checking" }).kind,
		).toBe("connecting");
		expect(
			entryScreen(signedIn, initialEntryUi, {
				status: "done",
				check: { consent: "outdated", notice: STAND_IN_NEW_NOTICE },
			}),
		).toEqual({
			kind: "notice",
			notice: STAND_IN_NEW_NOTICE,
			updated: true,
			via: "member",
		});
		for (const consent of ["current", "not_required"] as const) {
			expect(
				entryScreen(signedIn, initialEntryUi, {
					status: "done",
					check: { consent, notice: STAND_IN_NOTICE },
				}).kind,
			).toBe("app");
		}
		expect(
			run(
				initialEntryUi,
				{ type: "decline" },
				{ type: "result", result: "accepted" },
			),
		).toEqual({ ...initialEntryUi, result: "accepted" });
	});

	it("waiting after attempts: the wait from the answer, cleared by the next answer", () => {
		const pairing = run(initialEntryUi, { type: "accept", acceptance });
		const waiting = run(pairing, {
			type: "answer",
			state: {
				status: "unpaired",
				codeRejected: false,
				reason: "wait",
				retryAfterSeconds: 900,
				notice: STAND_IN_NOTICE,
			},
			at: AT,
		});
		expect(waiting.waitUntil).toBe(AT + 900_000);
		expect(waitText(900_000)).toBe("15:00");
		expect(waitText(61_001)).toBe("01:02");
		expect(waitText(-5)).toBe("00:00");
		expect(
			run(waiting, {
				type: "answer",
				state: { ...unpaired, codeRejected: true, reason: "code_refused" },
				at: AT,
			}).waitUntil,
		).toBeNull();
	});

	it("withdrawn: back to the start with a result", () => {
		const ui = run(
			initialEntryUi,
			{ type: "accept", acceptance },
			{ type: "result", result: "withdrawn" },
		);
		expect(ui).toEqual({ ...initialEntryUi, result: "withdrawn" });
		expect(codeFrom(" 98 76 54 32 ")).toBe("987654");
	});
});
