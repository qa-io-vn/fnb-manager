import type { MessageKind } from "../channels/types.js";

const ESCAPES: Readonly<Record<string, string>> = {
	"&": "&amp;",
	"<": "&lt;",
	">": "&gt;",
	'"': "&quot;",
	"'": "&#39;",
};

export const PREHEADER_FILLER = "&zwnj;&nbsp;".repeat(120);

const PREHEADER_STYLE =
	"display:none;max-height:0;max-width:0;overflow:hidden;opacity:0;mso-hide:all;font-size:1px;line-height:1px;color:transparent";

const PREHEADER_LINES: Readonly<Partial<Record<MessageKind, number>>> = {
	digest: 2,
	digest_correction: 2,
};

export function escapeHtml(text: string): string {
	return text.replace(
		/[&<>"']/g,
		(character) => ESCAPES[character] ?? character,
	);
}

export function emailPreheader(kind: MessageKind | null, text: string): string {
	const count = (kind === null ? undefined : PREHEADER_LINES[kind]) ?? 1;
	return text
		.normalize("NFC")
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => line !== "")
		.slice(0, count)
		.join(" · ");
}

function preheaderBlock(preheader: string | null): string {
	if (preheader === null || preheader.trim() === "") {
		return "";
	}
	return `<div style="${PREHEADER_STYLE}">${escapeHtml(preheader.normalize("NFC").trim())}${PREHEADER_FILLER}</div>`;
}

export function htmlFromText(
	text: string,
	preheader: string | null = null,
): string {
	const paragraphs = text
		.normalize("NFC")
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => line !== "")
		.map((line) => `<p>${escapeHtml(line)}</p>`)
		.join("");
	return `<!doctype html><html lang="vi"><head><meta charset="utf-8"></head><body>${preheaderBlock(preheader)}${paragraphs}</body></html>`;
}

export function emailHtml(kind: MessageKind | null, text: string): string {
	return htmlFromText(text, emailPreheader(kind, text));
}
