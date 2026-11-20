import { describe, expect, it } from "vitest";
import billsEn from "../bills/i18n/en.json";
import billsVi from "../bills/i18n/vi.json";
import { billCatalogs } from "../bills/texts";
import { catalogs } from "../i18n/catalog";
import {
	AUDIT_REFUSALS,
	AUDIT_RESULTS,
	BILL_DECISIONS,
	BILL_REFUSALS,
	BILL_STATES,
	CLAIM_STATES,
	CONFIRM_REFUSALS,
	COUNTER_REFUSALS,
	DECIDE_REFUSALS,
	QUEUE_REASONS,
	REVERSAL_REASONS,
	REVERSE_REFUSALS,
	SUBMIT_STATES,
	VOID_REFUSALS,
} from "./bills-contract";
import {
	CHECKIN_REFUSALS,
	QUEUE_KINDS,
	QUEUE_OUTCOMES,
	REDEMPTION_REFUSALS,
	REQUEST_KINDS,
	REQUEST_STATES,
	VISIT_PATHS,
	VISIT_STATES,
} from "./contract";
import loyaltyEn from "./i18n/en.json";
import loyaltyVi from "./i18n/vi.json";

const sources = import.meta.glob(
	[
		"./*.{ts,tsx}",
		"../check-in/*.tsx",
		"../redemption/*.tsx",
		"../member-lookup/*.tsx",
		"../approvals/*.{ts,tsx}",
		"../bills/*.{ts,tsx}",
		"../app.tsx",
		"!./*.test.{ts,tsx}",
		"!../**/*.test.{ts,tsx}",
	],
	{ query: "?raw", import: "default", eager: true },
) as Record<string, string>;

const LITERAL_KEY =
	/(?:\bt\(|(?:titleKey|refusedKey|unreadableKey|invalidKey)=)\s*"([a-z][\w.]*)"/g;

const LOYALTY_KEY =
	/"((?:loyalty|checkin|redeem|lookup|request|requests|queue|bills|counter|billQueue)\.[\w.]+)"/g;

function literalKeys(): string[] {
	const keys = new Set<string>();
	for (const text of Object.values(sources))
		for (const pattern of [LITERAL_KEY, LOYALTY_KEY])
			for (const match of text.matchAll(pattern))
				if (match[1] !== undefined) keys.add(match[1]);
	return [...keys].sort();
}

function dynamicKeys(): string[] {
	return [
		...[...CHECKIN_REFUSALS, "other"].map((key) => `checkin.refusal.${key}`),
		...["matched", "queued"].map((key) => `checkin.result.${key}`),
		...[...REDEMPTION_REFUSALS, "other"].map((key) => `redeem.refusal.${key}`),
		...[...REDEMPTION_REFUSALS, "other"]
			.filter((key) => key !== "used")
			.map((key) => `redeem.refusal.${key}Body`),
		...["pos_discount", "voucher_code"].flatMap((key) => [
			`redeem.instruction.${key}`,
			`redeem.pendingBody.${key}`,
		]),
		...VISIT_STATES.map((key) => `loyalty.state.${key}`),
		...VISIT_PATHS.map((key) => `lookup.path.${key}`),
		...["suspended", "closed"].map((key) => `lookup.status.${key}`),
		...REQUEST_KINDS.map((key) => `request.title.${key}`),
		...["number", "zero", "large"].map((key) => `request.problem.${key}`),
		...REQUEST_STATES.map((key) => `requests.state.${key}`),
		...QUEUE_KINDS.map((key) => `queue.kind.${key}`),
		...QUEUE_OUTCOMES.map((key) => `queue.done.${key}`),
		...staffModeKeys(),
	];
}

// The keys the staff-mode bill screens build from a state or a refusal (decision table: every answer has a text).
function staffModeKeys(): string[] {
	const withOther = (list: readonly string[]) => [...list, "other"];
	return [
		...BILL_STATES.map((key) => `bills.state.${key}`),
		...REVERSAL_REASONS.map((key) => `bills.reversal.${key}`),
		...withOther(BILL_REFUSALS).map((key) => `bills.refusal.${key}`),
		...SUBMIT_STATES.flatMap((key) => [
			`bills.result.${key}`,
			`bills.result.${key}Body`,
		]),
		...["code.empty", "code.format", "billNo.empty", "billNo.format"].map(
			(key) => `bills.problem.${key}`,
		),
		...["empty", "format", "zero", "large"].map(
			(key) => `bills.problem.total.${key}`,
		),
		...withOther(REVERSE_REFUSALS).map((key) => `bills.reverseRefusal.${key}`),
		...["empty", "long"].map((key) => `bills.reasonProblem.${key}`),
		...withOther([...COUNTER_REFUSALS, "already_answered", "expired"]).map(
			(key) => `counter.refusal.${key}`,
		),
		...CLAIM_STATES.map((key) => `counter.done.${key}`),
		...QUEUE_REASONS.map((key) => `billQueue.reason.${key}`),
		...[...BILL_DECISIONS, ...AUDIT_RESULTS].map(
			(key) => `billQueue.done.${key}`,
		),
		...withOther(DECIDE_REFUSALS).map((key) => `billQueue.refusal.${key}`),
		...withOther(AUDIT_REFUSALS).map((key) => `billQueue.auditRefusal.${key}`),
		...withOther(CONFIRM_REFUSALS).map((key) => `redeem.staff.refusal.${key}`),
		...withOther(VOID_REFUSALS).map((key) => `redeem.staff.voidRefusal.${key}`),
	];
}

describe("the loyalty texts", () => {
	it("cover every key the loyalty screens use, in both languages", () => {
		const used = literalKeys();
		expect(used.length).toBeGreaterThan(100);
		const wanted = [...used, ...dynamicKeys()];
		// the till screens read the app catalogue with the bill texts on top (BillTexts in LoyaltyRoute)
		expect(wanted.filter((key) => billCatalogs.vi[key] === undefined)).toEqual(
			[],
		);
		expect(wanted.filter((key) => billCatalogs.en[key] === undefined)).toEqual(
			[],
		);
	});

	it("keep the texts of the home card in the first-load catalogue", () => {
		const card = Object.entries(sources).find(([path]) =>
			path.endsWith("/home-card.tsx"),
		)?.[1];
		expect(card).toBeDefined();
		const keys = [...(card ?? "").matchAll(LOYALTY_KEY)].map(
			(match) => match[1] ?? "",
		);
		expect(keys.length).toBeGreaterThan(5);
		expect(keys.filter((key) => catalogs.vi[key] === undefined)).toEqual([]);
		expect(keys.filter((key) => catalogs.en[key] === undefined)).toEqual([]);
	});

	it("keep the loyalty catalogue to keys the screens use", () => {
		const wanted = new Set([...literalKeys(), ...dynamicKeys()]);
		expect(Object.keys(loyaltyVi).filter((key) => !wanted.has(key))).toEqual(
			[],
		);
		expect(Object.keys(loyaltyEn).sort()).toEqual(
			Object.keys(loyaltyVi).sort(),
		);
		expect(Object.keys(billsVi).filter((key) => !wanted.has(key))).toEqual([]);
		expect(Object.keys(billsEn).sort()).toEqual(Object.keys(billsVi).sort());
		expect(
			Object.keys(billsVi).filter(
				(key) => loyaltyVi[key as never] !== undefined,
			),
		).toEqual([]);
	});

	it("say a reused code is used, and never write a phone or a link", () => {
		expect(catalogs.vi["redeem.refusal.used"]).toBe("Mã đã được sử dụng");
		expect(catalogs.vi["loyalty.state.pending"]).toBe("Đang chờ xác nhận");
		for (const message of [
			...Object.values(loyaltyVi),
			...Object.values(loyaltyEn),
			...Object.values(billsVi),
			...Object.values(billsEn),
		]) {
			expect(message).not.toMatch(/\d{9,}|https?:|www\./);
		}
	});
});
