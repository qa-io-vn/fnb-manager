export type Redactor = (text: string) => string;

const MAX_ERROR_LENGTH = 500;
const REDACTED = "***";

interface RedactionRule {
	pattern: RegExp;
	replacement: string;
}

const GENERIC_RULES: readonly RedactionRule[] = [
	{
		pattern: /(postgres(?:ql)?:\/\/)[^@\s/]+@/gi,
		replacement: `$1${REDACTED}@`,
	},
	{
		pattern:
			/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}(?:\.[A-Za-z0-9_-]+)?/g,
		replacement: REDACTED,
	},
	{
		pattern: /\bsb_(?:secret|publishable)_[A-Za-z0-9_-]{6,}/g,
		replacement: REDACTED,
	},
	{ pattern: /\b[0-9a-f]{32}\b/gi, replacement: REDACTED },
	{
		pattern:
			/\b(password|passwd|pwd|token|secret|apikey|api_key|access_token)(["']?\s*[:=]\s*["']?)[^"'\s,&}]+/gi,
		replacement: `$1$2${REDACTED}`,
	},
];

export function createRedactor(secrets: readonly string[] = []): Redactor {
	const literals = [
		...new Set(secrets.filter((secret) => secret.length >= 4)),
	].sort((left, right) => right.length - left.length);
	return (text) => {
		let result = text;
		for (const literal of literals) {
			result = result.split(literal).join(REDACTED);
		}
		for (const rule of GENERIC_RULES) {
			result = result.replace(rule.pattern, rule.replacement);
		}
		return result;
	};
}

export function describeError(error: unknown): string {
	if (error instanceof Error) {
		const name = error.name && error.name !== "Error" ? `${error.name}: ` : "";
		return `${name}${error.message}`;
	}
	return String(error);
}

export function safeErrorMessage(error: unknown, redact: Redactor): string {
	const message = redact(describeError(error));
	return message.length > MAX_ERROR_LENGTH
		? `${message.slice(0, MAX_ERROR_LENGTH - 1)}…`
		: message;
}
