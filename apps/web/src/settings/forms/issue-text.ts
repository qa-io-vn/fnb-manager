import type { MessageParams, Translate } from "../../i18n";
import { VALIDATION_MESSAGE_KEYS, type ValidationIssue } from "../validation";

export type BoundFormatter = (bound: number | string) => string;

export function numericBound(
	format: (value: number) => string,
): BoundFormatter {
	return (bound) => (typeof bound === "number" ? format(bound) : bound);
}

export function dateBound(format: (isoDate: string) => string): BoundFormatter {
	return (bound) => (typeof bound === "string" ? format(bound) : String(bound));
}

export function issueText(
	t: Translate,
	issue: ValidationIssue | null,
	formatBound: BoundFormatter = String,
): string | null {
	if (issue === null) return null;
	const params: MessageParams = {};
	if (issue.min !== undefined) params.min = formatBound(issue.min);
	if (issue.max !== undefined) params.max = formatBound(issue.max);
	if (issue.digits !== undefined) params.digits = issue.digits;
	return t(VALIDATION_MESSAGE_KEYS[issue.key], params);
}
