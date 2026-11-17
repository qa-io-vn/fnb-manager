export type PathSegment = string | number;

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

export function pathText(segments: readonly PathSegment[]): string | null {
	if (segments.length === 0) return null;
	return segments
		.map((segment, index) => {
			if (typeof segment === "number") return `[${segment}]`;
			if (IDENTIFIER.test(segment)) {
				return index === 0 ? segment : `.${segment}`;
			}
			return `["${segment.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"]`;
		})
		.join("");
}
