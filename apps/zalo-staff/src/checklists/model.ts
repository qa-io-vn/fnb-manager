import type {
	ChecklistAnswer,
	ChecklistItem,
	ChecklistRun,
} from "@fnb/zalo-mini";

export type NumberInput =
	| { readonly kind: "empty" }
	| { readonly kind: "value"; readonly value: number }
	| { readonly kind: "invalid" };

const NUMBER = /^-?\d{1,9}([.,]\d{1,3})?$/;

export function readNumberInput(text: string): NumberInput {
	const trimmed = text.trim();
	if (trimmed === "") return { kind: "empty" };
	if (!NUMBER.test(trimmed)) return { kind: "invalid" };
	return { kind: "value", value: Number(trimmed.replace(",", ".")) };
}

export function numberText(value: number | null): string {
	return value === null ? "" : String(value).replace(".", ",");
}

export type DoneBlock = "photo" | "number" | "number-invalid" | null;

export function doneBlock(
	item: Pick<ChecklistItem, "requiresPhoto" | "numberUnit">,
	photoPath: string | null,
	number: NumberInput,
): DoneBlock {
	if (item.requiresPhoto && photoPath === null) return "photo";
	if (item.numberUnit !== null) {
		if (number.kind === "invalid") return "number-invalid";
		if (number.kind === "empty") return "number";
	}
	return null;
}

export function numberValueOf(
	item: Pick<ChecklistItem, "numberUnit">,
	number: NumberInput,
): number | null {
	return item.numberUnit !== null && number.kind === "value"
		? number.value
		: null;
}

export interface Progress {
	readonly done: number;
	readonly total: number;
	readonly percent: number;
}

export function runProgress(run: Pick<ChecklistRun, "items">): Progress {
	const total = run.items.length;
	const done = run.items.filter((item) => item.done).length;
	return {
		done,
		total,
		percent: total === 0 ? 0 : Math.round((done / total) * 100),
	};
}

export function withAnswer(
	run: ChecklistRun,
	answer: ChecklistAnswer,
): ChecklistRun {
	const items = run.items.map((item) =>
		item.answerId === answer.answerId
			? {
					...item,
					done: answer.done,
					numberValue: answer.numberValue,
					photoPath: answer.photoPath,
					photoRemoved: answer.photoRemoved,
					answeredBy: answer.answeredBy,
					answeredAt: answer.answeredAt,
				}
			: item,
	);
	return {
		...run,
		items,
		itemsDone: items.filter((item) => item.done).length,
	};
}

export type RunAccess = "edit" | "finished" | "other";

export function runAccess(
	run: Pick<ChecklistRun, "status" | "startedBy">,
	memberId: string | null,
): RunAccess {
	if (run.status === "finished") return "finished";
	return run.startedBy === null || run.startedBy === memberId
		? "edit"
		: "other";
}

export function canSeePhotos(
	run: Pick<ChecklistRun, "startedBy">,
	memberId: string | null,
	manager: boolean,
): boolean {
	return manager || (memberId !== null && run.startedBy === memberId);
}
