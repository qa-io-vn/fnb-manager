import type { MemberRole } from "@fnb/zalo-mini";
import { canManage } from "../shift/model";
import {
	type AdjustLimits,
	type CheckinEntry,
	MAX_ADJUSTMENT,
	MAX_REASON_LENGTH,
	MAX_REDEMPTION_CODE_LENGTH,
	MEMBER_CODE_LENGTH,
	maskedText,
	type QueueItem,
} from "./contract";

export const PHONE_LENGTH = 10;
export const ENTRY_MAX_DIGITS = 11;
export const DISPUTE_OVERDUE_MS = 48 * 3600_000;
export const MEMBER_PAYLOAD = /^fnb-member:\d+:[^:\s]+:(\d{6})(?::\S*)?$/;
export const REDEEM_PAYLOAD = /^fnb-redeem:\d+:(\S{1,64})$/;

const VIETNAMESE_MOBILE = /^0(3[2-9]|5[25689]|7[06-9]|8[1-9]|9\d)\d{7}$/;
const CODE_DIGITS = new RegExp(`^\\d{${MEMBER_CODE_LENGTH}}$`);
const REDEMPTION_CODE = /^[^\s\p{Cc}]+$/u;

export function canUseTill(role: MemberRole): boolean {
	return role === "owner" || role === "manager" || role === "staff";
}

export function canManageQueue(role: MemberRole): boolean {
	return canManage(role);
}

export function entryDigits(text: string): string {
	return text.replace(/\D/g, "").slice(0, ENTRY_MAX_DIGITS);
}

export function nationalPhone(text: string): string | null {
	let digits = text.replace(/[\s().-]/g, "");
	if (digits.startsWith("+84")) digits = `0${digits.slice(3)}`;
	else if (digits.startsWith("0084")) digits = `0${digits.slice(4)}`;
	else if (/^84\d{9}$/.test(digits)) digits = `0${digits.slice(2)}`;
	return VIETNAMESE_MOBILE.test(digits) ? digits : null;
}

export function maskPhone(phone: string): string {
	const digits = phone.replace(/\D/g, "");
	return digits.length < 3 ? "•••" : `•••• ••• ${digits.slice(-3)}`;
}

export function shownPhone(masked: string): string {
	return maskedText(masked);
}

export type EntryProblem = "empty" | "phone" | "format";

export type ReadEntry =
	| { readonly ok: true; readonly entry: CheckinEntry }
	| { readonly ok: false; readonly problem: EntryProblem };

export function readEntry(text: string): ReadEntry {
	const trimmed = text.trim();
	if (trimmed === "") return { ok: false, problem: "empty" };
	const digits = trimmed.replace(/[\s().-]/g, "");
	if (CODE_DIGITS.test(digits))
		return { ok: true, entry: { kind: "code", code: digits, payload: null } };
	if (/^(\+?84|0)/.test(digits)) {
		const phone = nationalPhone(digits);
		return phone === null
			? { ok: false, problem: "phone" }
			: { ok: true, entry: { kind: "phone", phone } };
	}
	return { ok: false, problem: "format" };
}

export type ScanPurpose = "member" | "redemption";

export type ScannedCode =
	| {
			readonly ok: true;
			readonly code: string;
			readonly payload: string | null;
	  }
	| { readonly ok: false };

export function readScannedMember(content: string): ScannedCode {
	const value = content.trim();
	if (CODE_DIGITS.test(value)) return { ok: true, code: value, payload: null };
	const match = MEMBER_PAYLOAD.exec(value);
	return match?.[1] === undefined
		? { ok: false }
		: { ok: true, code: match[1], payload: value };
}

export function redemptionCode(text: string): string | null {
	const value = text.trim();
	if (value === "" || value.length > MAX_REDEMPTION_CODE_LENGTH) return null;
	return REDEMPTION_CODE.test(value) ? value : null;
}

export function readScannedRedemption(content: string): ScannedCode {
	const value = content.trim();
	if (MEMBER_PAYLOAD.test(value)) return { ok: false };
	const match = REDEEM_PAYLOAD.exec(value);
	const code = redemptionCode(match?.[1] ?? value);
	return code === null ? { ok: false } : { ok: true, code, payload: value };
}

export function isOverdue(item: QueueItem, now: Date): boolean {
	return (
		item.kind === "dispute" &&
		now.getTime() - Date.parse(item.createdAt) >= DISPUTE_OVERDUE_MS
	);
}

export function sortQueue(items: readonly QueueItem[], now: Date): QueueItem[] {
	return [...items].sort((a, b) => {
		const overdue = Number(isOverdue(b, now)) - Number(isOverdue(a, now));
		if (overdue !== 0) return overdue;
		const time = Date.parse(a.createdAt) - Date.parse(b.createdAt);
		return time !== 0 ? time : a.id.localeCompare(b.id);
	});
}

export function overdueCount(items: readonly QueueItem[], now: Date): number {
	return items.filter((item) => isOverdue(item, now)).length;
}

export type ReasonProblem = "empty" | "long";

export function reasonProblem(reason: string): ReasonProblem | null {
	const trimmed = reason.trim();
	if (trimmed === "") return "empty";
	return trimmed.length > MAX_REASON_LENGTH ? "long" : null;
}

export type AmountProblem = "number" | "zero" | "large";

export function readAdjustment(text: string): number | null {
	const value = text.trim().replace(/^\+/, "").replace(/^[−–]/, "-");
	if (value === "") return 0;
	return /^-?\d{1,4}$/.test(value) ? Number(value) : null;
}

export function amountProblem(
	stamps: number | null,
	points: number | null,
	required: boolean,
): AmountProblem | null {
	if (stamps === null || points === null) return "number";
	if (Math.abs(stamps) > MAX_ADJUSTMENT || Math.abs(points) > MAX_ADJUSTMENT)
		return "large";
	return required && stamps === 0 && points === 0 ? "zero" : null;
}

export function needsManager(
	role: MemberRole,
	stamps: number,
	points: number,
	limits: AdjustLimits | null,
): boolean {
	if (canManage(role)) return false;
	if (limits === null) return true;
	return Math.abs(stamps) > limits.stamps || Math.abs(points) > limits.points;
}

export function isoDayIn(instant: Date, timeZone: string): string {
	return new Intl.DateTimeFormat("en-CA", {
		timeZone,
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
	}).format(instant);
}

export function signed(value: number): string {
	if (value > 0) return `+${value}`;
	if (value < 0) return `−${Math.abs(value)}`;
	return "0";
}
