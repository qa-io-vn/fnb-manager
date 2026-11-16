const LENGTH = 100_000;

export const PATHOLOGICAL_MARKDOWN: readonly (readonly [string, string])[] = [
	["a heading with a long run of spaces", `# a${" ".repeat(LENGTH)}b`],
	[
		"a heading with spaces before a line separator",
		`# a${" ".repeat(LENGTH)}\u2028b`,
	],
	["a heading closed by a long run of hashes", `# a ${"#".repeat(LENGTH)}`],
	["a line of hashes", "#".repeat(LENGTH)],
	["repeated link openings", "[a](".repeat(LENGTH / 4)],
	["an unclosed link text", `[${"a".repeat(LENGTH)}`],
	["repeated link closings", "](".repeat(LENGTH / 2)],
	["an unclosed bold run", `**${"a".repeat(LENGTH)}`],
	["repeated unclosed italics", "*a ".repeat(LENGTH / 3)],
	["an unclosed italic before many words", `*a${" b".repeat(LENGTH / 2)}`],
	["underscores between letters", "_a".repeat(LENGTH / 2)],
	["an unclosed code span", `\`${"a".repeat(LENGTH)}`],
	["a list marker before a long run of spaces", `- ${" ".repeat(LENGTH)}x`],
	["a number before a long run of spaces", `1.${" ".repeat(LENGTH)}x`],
	["a long run of digits", `${"1".repeat(LENGTH)}. x`],
];

export const MARKUP_HEAVY_MARKDOWN: readonly (readonly [string, string])[] = [
	["repeated half-closed bold", "**a*".repeat(LENGTH / 4)],
	["every marker mixed", "**[`_*(".repeat(LENGTH / 7)],
];
