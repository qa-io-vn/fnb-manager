import type { NewRequest, RequestType } from "./source";
import { REQUEST_TYPES } from "./source";

export const CONTACT_MAX = 200;
export const NOTES_MAX = 1000;
export const NAME_MAX = 120;

export type RequestIssue =
	| "type"
	| "contactEmpty"
	| "contactTooLong"
	| "notesTooLong"
	| "control";

function hasControl(text: string): boolean {
	return [...text].some((char) => {
		const code = char.codePointAt(0) ?? 0;
		return code < 32 || code === 127;
	});
}

export interface RequestDraft {
	readonly requestType: string;
	readonly contact: string;
	readonly usesProcessor: boolean;
	readonly notes: string;
	readonly subjectId: string | null;
}

export interface RequestCheck {
	readonly issues: readonly RequestIssue[];
	readonly value: NewRequest | null;
}

export function isRequestType(value: string): value is RequestType {
	return (REQUEST_TYPES as readonly string[]).includes(value);
}

export function checkRequest(draft: RequestDraft): RequestCheck {
	const issues: RequestIssue[] = [];
	const contact = draft.contact.trim();
	const notes = draft.notes.trim();
	if (!isRequestType(draft.requestType)) issues.push("type");
	if (contact === "") issues.push("contactEmpty");
	else if (contact.length > CONTACT_MAX) issues.push("contactTooLong");
	if (notes.length > NOTES_MAX) issues.push("notesTooLong");
	if (hasControl(contact)) issues.push("control");
	if (issues.length > 0 || !isRequestType(draft.requestType)) {
		return { issues, value: null };
	}
	return {
		issues,
		value: {
			requestType: draft.requestType,
			subjectId: draft.subjectId,
			contact,
			usesProcessor: draft.usesProcessor,
			notes: notes === "" ? null : notes,
		},
	};
}

export type NameIssue = "empty" | "tooLong" | "control";

export function checkName(raw: string): NameIssue | null {
	const name = raw.trim();
	if (name === "") return "empty";
	if (name.length > NAME_MAX) return "tooLong";
	if (hasControl(name)) return "control";
	return null;
}
