import { cleanDisplayName, toInternationalPhone } from "../graph.js";
import { keywordAction, type OaMenuAction } from "./menu.js";

export const FORM_EVENT = "user_submit_info";
export const TEXT_EVENT = "user_send_text";
export const KEYWORD_MAX_LENGTH = 32;

export type CustomerInput =
	| { readonly kind: "none" }
	| { readonly kind: "keyword"; readonly action: OaMenuAction }
	| {
			readonly kind: "form";
			readonly phone: string | null;
			readonly name: string | null;
	  };

const NONE: CustomerInput = { kind: "none" };

function recordOf(value: unknown): Readonly<Record<string, unknown>> | null {
	return value !== null && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null;
}

export function formPhone(value: unknown): string | null {
	if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) {
		return toInternationalPhone(String(value));
	}
	if (typeof value !== "string" || value.length > 32) {
		return null;
	}
	return toInternationalPhone(value.trim());
}

export function submittedInfo(
	body: Readonly<Record<string, unknown>>,
): CustomerInput {
	const info = recordOf(body.info);
	if (info === null) {
		return { kind: "form", phone: null, name: null };
	}
	return {
		kind: "form",
		phone: formPhone(info.phone),
		name: cleanDisplayName(info.name),
	};
}

export function sentKeyword(
	body: Readonly<Record<string, unknown>>,
): CustomerInput {
	const text = recordOf(body.message)?.text;
	if (typeof text !== "string" || text.length > KEYWORD_MAX_LENGTH) {
		return NONE;
	}
	const action = keywordAction(text);
	return action === null ? NONE : { kind: "keyword", action };
}

export function customerInput(
	eventName: string,
	body: Readonly<Record<string, unknown>>,
): CustomerInput {
	if (eventName === FORM_EVENT) {
		return submittedInfo(body);
	}
	if (eventName === TEXT_EVENT) {
		return sentKeyword(body);
	}
	return NONE;
}

export function inputParameter(input: CustomerInput): Record<string, unknown> {
	switch (input.kind) {
		case "none":
			return { kind: "none" };
		case "keyword":
			return { kind: "keyword", action: input.action };
		case "form":
			return { kind: "form", phone: input.phone, name: input.name };
	}
}
