import type {
	CashCountReceipt,
	CashCountRecord,
	CashCountRow,
} from "@fnb/zalo-mini";

export const VND_DENOMINATIONS: readonly number[] = [
	500_000, 200_000, 100_000, 50_000, 20_000, 10_000, 5_000, 2_000, 1_000, 500,
];
export const MAX_PIECES = 100_000;
export const MAX_AMOUNT = 999_999_999_999;
export const MAX_COUNT_NOTE = 500;
export const MAX_HANDOVER_NOTE = 2000;
export const SHIFT_NUMBERS: readonly number[] = Array.from(
	{ length: 12 },
	(_, index) => index + 1,
);

export type Pieces = Readonly<Record<string, number>>;

export function denominationsFor(currencyCode: string): readonly number[] {
	return currencyCode.toUpperCase() === "VND" ? VND_DENOMINATIONS : [];
}

export function readPieces(text: string): number | null {
	const digits = text.replace(/\D/g, "");
	if (digits === "") return 0;
	const value = Number(digits);
	return Number.isSafeInteger(value) && value <= MAX_PIECES ? value : null;
}

export function readAmount(text: string): number | null {
	const digits = text.replace(/[\s.,]/g, "");
	if (digits === "" || !/^\d+$/.test(digits)) return null;
	const value = Number(digits);
	return Number.isSafeInteger(value) && value <= MAX_AMOUNT ? value : null;
}

export function piecesTotal(pieces: Pieces): number {
	return Object.entries(pieces).reduce(
		(total, [face, count]) => total + Number(face) * count,
		0,
	);
}

export function denominationsPayload(
	pieces: Pieces,
): Readonly<Record<string, number>> | null {
	const entries = Object.entries(pieces).filter(([, count]) => count > 0);
	return entries.length === 0 ? null : Object.fromEntries(entries);
}

export type CountMode = "pieces" | "total";

export interface CountDraft {
	readonly mode: CountMode;
	readonly pieces: Pieces;
	readonly totalText: string;
	readonly note: string;
}

export type CountProblem = "empty" | "invalid" | "note" | null;

export function draftAmount(draft: CountDraft): number | null {
	return draft.mode === "pieces"
		? piecesTotal(draft.pieces)
		: readAmount(draft.totalText);
}

export function countProblem(draft: CountDraft): CountProblem {
	if (draft.note.trim().length > MAX_COUNT_NOTE) return "note";
	if (draft.mode === "pieces") {
		return piecesTotal(draft.pieces) > 0 ? null : "empty";
	}
	if (draft.totalText.trim() === "") return "empty";
	return readAmount(draft.totalText) === null ? "invalid" : null;
}

export type CountOutcome =
	| { readonly kind: "recorded"; readonly matched: boolean }
	| { readonly kind: "unmatched" }
	| {
			readonly kind: "difference";
			readonly over: boolean;
			readonly variance: number;
			readonly shiftNumber: number | null;
	  }
	| { readonly kind: "no-reference"; readonly shiftNumber: number | null };

export function countOutcome(
	receipt: CashCountReceipt,
	row: CashCountRow | null,
	showsDifference: boolean,
): CountOutcome {
	if (!showsDifference || row === null)
		return { kind: "recorded", matched: receipt.matched };
	switch (row.state) {
		case "unmatched":
			return { kind: "unmatched" };
		case "no_reference":
			return { kind: "no-reference", shiftNumber: row.shiftNumber };
		case "over":
		case "within":
			return row.variance === null
				? { kind: "recorded", matched: receipt.matched }
				: {
						kind: "difference",
						over: row.state === "over",
						variance: row.variance,
						shiftNumber: row.shiftNumber,
					};
		default:
			return { kind: "recorded", matched: receipt.matched };
	}
}

export function pendingRecount(
	records: readonly CashCountRecord[],
): CashCountRecord | null {
	const replaced = new Set(
		records.flatMap((record) =>
			record.replacesId === null ? [] : [record.replacesId],
		),
	);
	return (
		records.find(
			(record) => record.status === "reopened" && !replaced.has(record.id),
		) ?? null
	);
}

export type NoteProblem = "empty" | "long" | "control" | null;

const TAB = 9;
const LINE_FEED = 10;
const CARRIAGE_RETURN = 13;
const SPACE = 32;
const DELETE = 127;

export function hasControlCharacters(text: string, lines: boolean): boolean {
	for (const char of text) {
		const code = char.charCodeAt(0);
		const allowed =
			code === TAB ||
			(lines && (code === LINE_FEED || code === CARRIAGE_RETURN));
		if ((code < SPACE && !allowed) || code === DELETE) return true;
	}
	return false;
}

export function noteProblem(note: string, max: number): NoteProblem {
	const trimmed = note.trim();
	if (trimmed === "") return "empty";
	if ([...trimmed].length > max) return "long";
	return hasControlCharacters(trimmed, true) ? "control" : null;
}

export function nextShifts(shiftNumber: number | null): {
	readonly from: number;
	readonly to: number;
} {
	const from =
		shiftNumber !== null && shiftNumber >= 1 && shiftNumber <= 12
			? shiftNumber
			: 1;
	return { from, to: from === 12 ? 1 : from + 1 };
}

export function signedMoney(
	value: number,
	format: (value: number) => string,
): string {
	if (value === 0) return format(0);
	return value > 0 ? `+${format(value)}` : `−${format(Math.abs(value))}`;
}
