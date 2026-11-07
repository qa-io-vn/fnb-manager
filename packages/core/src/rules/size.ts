export const DEFAULT_SIZE_LABELS: readonly string[] = [
	"S",
	"M",
	"L",
	"XL",
	"XXL",
];

export interface ParsedSize {
	baseName: string;
	sizeLabel: string | undefined;
}

const trailingParenthesis =
	/^(?<base>.*?\S)\s*\(\s*(?<token>[^()]*?)\s*\)\s*$/u;

export function parseSizeSuffix(
	name: string,
	sizeLabels: readonly string[] = DEFAULT_SIZE_LABELS,
): ParsedSize {
	const unchanged: ParsedSize = { baseName: name, sizeLabel: undefined };
	const groups = trailingParenthesis.exec(name)?.groups;
	const baseName = groups?.base;
	const token = groups?.token;
	if (baseName === undefined || token === undefined || token === "") {
		return unchanged;
	}
	const normalisedToken = token.toUpperCase();
	const label = sizeLabels.find(
		(candidate) => candidate.toUpperCase() === normalisedToken,
	);
	return label === undefined
		? unchanged
		: { baseName, sizeLabel: label.toUpperCase() };
}
