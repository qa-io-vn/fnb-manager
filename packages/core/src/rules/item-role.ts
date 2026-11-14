export type SuggestedItemRole = "drink" | "topping" | "snack" | "food";
export type ModifierFamily = "sugar" | "ice" | "other";

interface Term<Label extends string> {
	readonly label: Label;
	readonly text: string;
	readonly pattern: RegExp;
}

const WHOLE_WORD_MAX_LENGTH = 4;
const NOT_ALPHANUMERIC_BEFORE = "(?<![\\p{L}\\p{N}])";
const NOT_ALPHANUMERIC_AFTER = "(?![\\p{L}\\p{N}])";

function normalised(text: string): string {
	return text.normalize("NFC").toLocaleLowerCase("vi").trim();
}

function escaped(text: string): string {
	return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function termsOf<Label extends string>(
	label: Label,
	texts: readonly string[],
): Term<Label>[] {
	return texts.map((raw) => {
		const text = normalised(raw);
		const body = escaped(text);
		const source =
			[...text].length <= WHOLE_WORD_MAX_LENGTH
				? `${NOT_ALPHANUMERIC_BEFORE}${body}${NOT_ALPHANUMERIC_AFTER}`
				: body;
		return { label, text, pattern: new RegExp(source, "u") };
	});
}

interface Match<Label extends string> {
	readonly label: Label;
	readonly index: number;
	readonly length: number;
}

function earliestLongest<Label extends string>(
	name: string,
	terms: readonly Term<Label>[],
): Label | null {
	const text = normalised(name);
	let best: Match<Label> | null = null;
	for (const term of terms) {
		const found = term.pattern.exec(text);
		if (found === null) continue;
		const candidate = {
			label: term.label,
			index: found.index,
			length: term.text.length,
		};
		if (
			best === null ||
			candidate.index < best.index ||
			(candidate.index === best.index && candidate.length > best.length)
		) {
			best = candidate;
		}
	}
	return best?.label ?? null;
}

export const ROLE_SUGGESTION_TERMS: Readonly<
	Record<SuggestedItemRole, readonly string[]>
> = {
	drink: [
		"trà",
		"cà phê",
		"cafe",
		"coffee",
		"sữa",
		"nước",
		"sinh tố",
		"đá xay",
		"soda",
		"matcha",
		"cacao",
		"latte",
	],
	topping: [
		"topping",
		"trân châu",
		"thạch",
		"pudding",
		"kem cheese",
		"kem muối",
	],
	snack: ["hướng dương", "hạt", "snack", "bánh", "khô"],
	food: ["cơm", "mì", "bún", "phở", "xôi", "bánh mì"],
};

const roleTerms = (
	Object.entries(ROLE_SUGGESTION_TERMS) as [
		SuggestedItemRole,
		readonly string[],
	][]
).flatMap(([role, texts]) => termsOf(role, texts));

const modifierTerms = [
	...termsOf("sugar" as const, ["đường", "ngọt", "sugar"]),
	...termsOf("ice" as const, ["đá", "ice"]),
];

export function suggestRole(itemTypeName: string): SuggestedItemRole | null {
	return earliestLongest(itemTypeName, roleTerms);
}

export function classifyModifier(name: string): ModifierFamily {
	return earliestLongest(name, modifierTerms) ?? "other";
}
