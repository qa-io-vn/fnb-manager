import { type MessageKey, VI_MESSAGES } from "../messages/vi.js";

const PLACEHOLDER = /\{([^{}\n]+)\}/g;

export type TemplateValues = Readonly<Record<string, string | number>>;

export class TemplateError extends Error {
	readonly code: string;

	constructor(code: string, message: string) {
		super(message);
		this.name = "TemplateError";
		this.code = code;
	}
}

export function placeholdersOf(template: string): string[] {
	return [
		...new Set(
			[...template.matchAll(PLACEHOLDER)].map((match) => match[1] ?? ""),
		),
	];
}

export function fillTemplate(template: string, values: TemplateValues): string {
	const missing = placeholdersOf(template).filter(
		(name) => !Object.hasOwn(values, name),
	);
	if (missing.length > 0) {
		throw new TemplateError(
			"template_placeholder_missing",
			`template placeholder not supplied: ${missing.join(", ")}`,
		);
	}
	return template
		.replace(PLACEHOLDER, (_match, name: string) => String(values[name]))
		.normalize("NFC");
}

export function message(key: MessageKey, values: TemplateValues = {}): string {
	return fillTemplate(VI_MESSAGES[key], values);
}
