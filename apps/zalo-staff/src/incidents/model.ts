import type {
	Handover,
	Incident,
	IncidentCategory,
	IncidentKind,
} from "@fnb/zalo-mini";
import { hasControlCharacters } from "../shift-close/model";

export const MAX_DESCRIPTION = 1000;
export const MAX_ITEM = 120;
export const STOCK_OUT_CATEGORY = "khac";

export interface ReportDraft {
	readonly kind: IncidentKind;
	readonly categoryKey: string;
	readonly description: string;
	readonly itemLabel: string;
}

export type ReportProblem =
	| "category"
	| "description-empty"
	| "description-long"
	| "description-control"
	| "item-empty"
	| "item-long"
	| "item-control";

function length(text: string): number {
	return [...text.trim()].length;
}

export function reportProblems(
	draft: ReportDraft,
	categories: readonly IncidentCategory[],
): ReportProblem[] {
	const problems: ReportProblem[] = [];
	if (
		!categories.some(
			(category) => category.active && category.key === draft.categoryKey,
		)
	) {
		problems.push("category");
	}
	if (draft.kind === "stock_out") {
		const item = draft.itemLabel.trim();
		if (item === "") problems.push("item-empty");
		else if (length(item) > MAX_ITEM) problems.push("item-long");
		else if (hasControlCharacters(item, false)) problems.push("item-control");
	}
	const description = draft.description.trim();
	if (description === "") problems.push("description-empty");
	else if (length(description) > MAX_DESCRIPTION)
		problems.push("description-long");
	else if (hasControlCharacters(description, true))
		problems.push("description-control");
	return problems;
}

export function activeCategories(
	categories: readonly IncidentCategory[],
): IncidentCategory[] {
	return categories.filter((category) => category.active);
}

export function defaultCategory(
	kind: IncidentKind,
	categories: readonly IncidentCategory[],
): string {
	const active = activeCategories(categories);
	if (kind === "stock_out") {
		const other = active.find(
			(category) => category.key === STOCK_OUT_CATEGORY,
		);
		if (other !== undefined) return other.key;
	}
	return active[0]?.key ?? "";
}

export function categoryLabel(
	categories: readonly IncidentCategory[],
	key: string,
): string {
	return categories.find((category) => category.key === key)?.label ?? key;
}

export interface IncidentActions {
	readonly acknowledge: boolean;
	readonly resolve: boolean;
	readonly waitingForAnother: boolean;
}

export function incidentActions(
	incident: Pick<Incident, "status" | "createdBy">,
	memberId: string | null,
	manager: boolean,
): IncidentActions {
	const own = memberId !== null && incident.createdBy === memberId;
	if (!manager || incident.status === "resolved") {
		return { acknowledge: false, resolve: false, waitingForAnother: false };
	}
	if (incident.status === "open") {
		return own
			? { acknowledge: false, resolve: false, waitingForAnother: true }
			: { acknowledge: true, resolve: true, waitingForAnother: false };
	}
	return { acknowledge: false, resolve: true, waitingForAnother: false };
}

export function canAcknowledgeHandover(
	handover: Pick<Handover, "acknowledgedAt" | "createdBy">,
	memberId: string | null,
	manager: boolean,
): boolean {
	return (
		manager &&
		handover.acknowledgedAt === null &&
		!(memberId !== null && handover.createdBy === memberId)
	);
}
