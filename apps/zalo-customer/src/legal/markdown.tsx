import type { ReactNode } from "react";

type Block =
	| { readonly id: number; readonly kind: "heading"; readonly text: string }
	| { readonly id: number; readonly kind: "paragraph"; readonly text: string }
	| {
			readonly id: number;
			readonly kind: "list";
			readonly items: readonly { readonly id: number; readonly text: string }[];
	  };

const HEADING = /^#{1,6}\s+(.*)$/;
const ITEM = /^\s*(?:[-*+]|\d+[.)])\s+(.*)$/;
const INLINE = /(\*\*[^*]+\*\*|__[^_]+__|\[[^\]]*\]\([^)]*\)|`[^`]+`)/g;

export function markdownBlocks(markdown: string): Block[] {
	const blocks: Block[] = [];
	let next = 0;
	let paragraph: string[] = [];
	let items: { id: number; text: string }[] | null = null;
	const flush = () => {
		if (paragraph.length > 0) {
			blocks.push({
				id: next++,
				kind: "paragraph",
				text: paragraph.join("\n"),
			});
			paragraph = [];
		}
		if (items !== null) {
			blocks.push({ id: next++, kind: "list", items });
			items = null;
		}
	};
	for (const raw of markdown.replace(/\r\n?/g, "\n").split("\n")) {
		const line = raw.trimEnd();
		if (line.trim() === "") {
			flush();
			continue;
		}
		const heading = HEADING.exec(line);
		if (heading) {
			flush();
			blocks.push({ id: next++, kind: "heading", text: heading[1] ?? "" });
			continue;
		}
		const item = ITEM.exec(line);
		if (item) {
			if (paragraph.length > 0) flush();
			items = items ?? [];
			items.push({ id: next++, text: item[1] ?? "" });
			continue;
		}
		if (items !== null) flush();
		paragraph.push(line.trim());
	}
	flush();
	return blocks;
}

export function inlineText(text: string): ReactNode[] {
	const parts: ReactNode[] = [];
	let offset = 0;
	for (const match of text.matchAll(INLINE)) {
		const token = match[0];
		const at = match.index ?? 0;
		if (at > offset) parts.push(text.slice(offset, at));
		if (token.startsWith("**") || token.startsWith("__")) {
			parts.push(<strong key={at}>{token.slice(2, -2)}</strong>);
		} else if (token.startsWith("[")) {
			parts.push(token.slice(1, token.indexOf("]")));
		} else {
			parts.push(token.slice(1, -1));
		}
		offset = at + token.length;
	}
	if (offset < text.length) parts.push(text.slice(offset));
	return parts;
}

export function MarkdownText({ markdown }: { readonly markdown: string }) {
	return (
		<div
			className="flex flex-col gap-3 text-base text-ink"
			data-testid="markdown"
		>
			{markdownBlocks(markdown).map((block) => {
				if (block.kind === "heading") {
					return (
						<h3 key={block.id} className="pt-1 text-base font-semibold">
							{inlineText(block.text)}
						</h3>
					);
				}
				if (block.kind === "list") {
					return (
						<ul key={block.id} className="flex list-disc flex-col gap-1 pl-5">
							{block.items.map((item) => (
								<li key={item.id}>{inlineText(item.text)}</li>
							))}
						</ul>
					);
				}
				return (
					<p key={block.id} className="whitespace-pre-line">
						{inlineText(block.text)}
					</p>
				);
			})}
		</div>
	);
}
