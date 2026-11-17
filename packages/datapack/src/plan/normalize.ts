export interface NormalizedPlanText {
	readonly text: string;
	readonly preamble: boolean;
}

interface Fence {
	readonly marker: string;
	readonly info: string;
}

interface FrontMatterBlock {
	readonly kind: "dashes" | "fence";
	readonly start: number;
	readonly end: number;
}

const FENCE_LINE = /^ {0,3}(`{3,}|~{3,})[ \t]*([^\s`]*)[ \t]*$/;
const WRAPPER_INFOS: ReadonlySet<string> = new Set(["", "markdown", "md"]);
const FRONT_MATTER_INFOS: ReadonlySet<string> = new Set(["fnb-plan", "json"]);
const PLAN_FORMAT_KEY = /"format"\s*:\s*"fnb-plan\/1"/;

function fenceOf(line: string): Fence | null {
	const match = FENCE_LINE.exec(line);
	if (match === null) return null;
	return { marker: match[1] ?? "", info: (match[2] ?? "").toLowerCase() };
}

function isClosingFence(line: string, opening: Fence): boolean {
	const fence = fenceOf(line);
	return (
		fence !== null &&
		fence.info === "" &&
		fence.marker[0] === opening.marker[0] &&
		fence.marker.length >= opening.marker.length
	);
}

function wrapperFence(line: string | undefined): Fence | null {
	if (line === undefined) return null;
	const fence = fenceOf(line);
	return fence !== null && WRAPPER_INFOS.has(fence.info) ? fence : null;
}

function isBlank(line: string): boolean {
	return line.trim() === "";
}

function firstNonBlank(lines: readonly string[]): number {
	return lines.findIndex((line) => !isBlank(line));
}

function lastNonBlank(lines: readonly string[]): number {
	for (let index = lines.length - 1; index >= 0; index -= 1) {
		if (!isBlank(lines[index] ?? "")) return index;
	}
	return -1;
}

function closingFenceAfter(
	lines: readonly string[],
	start: number,
	opening: Fence,
): number {
	for (let index = start + 1; index < lines.length; index += 1) {
		if (isClosingFence(lines[index] ?? "", opening)) return index;
	}
	return -1;
}

function dashesAfter(lines: readonly string[], start: number): number {
	for (let index = start + 1; index < lines.length; index += 1) {
		if (lines[index] === "---") return index;
	}
	return -1;
}

function frontMatterBlock(lines: readonly string[]): FrontMatterBlock | null {
	for (let index = 0; index < lines.length; index += 1) {
		const line = lines[index] ?? "";
		if (line === "---") {
			const end = dashesAfter(lines, index);
			if (end !== -1) {
				const inside = lines.slice(index + 1, end);
				const first = inside[firstNonBlank(inside)] ?? "";
				if (index === 0 || first.trimStart().startsWith("{")) {
					return { kind: "dashes", start: index, end };
				}
			}
			continue;
		}
		const fence = fenceOf(line);
		if (fence !== null && FRONT_MATTER_INFOS.has(fence.info)) {
			const end = closingFenceAfter(lines, index, fence);
			if (
				end !== -1 &&
				PLAN_FORMAT_KEY.test(lines.slice(index + 1, end).join("\n"))
			) {
				return { kind: "fence", start: index, end };
			}
		}
	}
	return null;
}

function withoutWrapper(lines: readonly string[]): string[] | null {
	const first = firstNonBlank(lines);
	const last = lastNonBlank(lines);
	if (first === -1 || last <= first) return null;
	const opening = wrapperFence(lines[first]);
	if (opening === null || !isClosingFence(lines[last] ?? "", opening)) {
		return null;
	}
	return lines.slice(first + 1, last);
}

function trimBlankEdges(lines: readonly string[]): string[] {
	const first = firstNonBlank(lines);
	if (first === -1) return [];
	return lines.slice(first, lastNonBlank(lines) + 1);
}

export function normalizePlan(text: string): NormalizedPlanText {
	const unmarked = text.startsWith("\uFEFF") ? text.slice(1) : text;
	const composed = unmarked.replace(/\r\n?/g, "\n").normalize("NFC");
	let lines = composed.split("\n").map((line) => line.replace(/[ \t]+$/, ""));
	const unwrapped = withoutWrapper(lines);
	if (unwrapped !== null) lines = unwrapped;
	let preamble = false;
	const block = frontMatterBlock(lines);
	if (block !== null) {
		let before = lines.slice(0, block.start);
		let rest = lines.slice(block.start);
		const lastBefore = lastNonBlank(before);
		const opening =
			unwrapped === null && lastBefore !== -1
				? wrapperFence(before[lastBefore])
				: null;
		if (opening !== null) {
			const close = closingFenceAfter(rest, block.end - block.start, opening);
			if (close !== -1)
				rest = [...rest.slice(0, close), ...rest.slice(close + 1)];
			before = before.slice(0, lastBefore);
		}
		preamble = before.some((line) => !isBlank(line));
		if (block.kind === "fence") {
			rest[0] = "---";
			rest[block.end - block.start] = "---";
		}
		lines = rest;
	}
	return { text: `${trimBlankEdges(lines).join("\n")}\n`, preamble };
}

export function normalizePlanText(text: string): string {
	return normalizePlan(text).text;
}
