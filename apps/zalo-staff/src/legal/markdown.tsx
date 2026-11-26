import type { ReactNode } from "react";

type Block =
	| {
			readonly id: number;
			readonly kind: "heading";
			readonly depth: number;
			readonly text: string;
	  }
	| { readonly id: number; readonly kind: "paragraph"; readonly text: string }
	| {
			readonly id: number;
			readonly kind: "list";
			readonly ordered: boolean;
			readonly items: readonly { readonly id: number; readonly text: string }[];
	  };

const HEADING = /^(#{1,6})\s+(.*)$/;
const BULLET = /^\s*[-*+]\s+(.*)$/;
const NUMBERED = /^\s*\d+[.)]\s+(.*)$/;
const INLINE = /(\*\*[^*]+\*\*|__[^_]+__|\[[^\]]*\]\([^)]*\)|`[^`]+`)/g;

export function markdownBlocks(markdown: string): Block[] {
	const blocks: Block[] = [];
	let next = 0;
	let paragraph: string[] = [];
	let list: {
		ordered: boolean;
		items: { id: number; text: string }[];
	} | null = null;
	const flushParagraph = () => {
		if (paragraph.length > 0) {
			blocks.push({
				id: next++,
				kind: "paragraph",
				text: paragraph.join("\n"),
			});
			paragraph = [];
		}
	};
	const flushList = () => {
		if (list !== null) {
			blocks.push({ id: next++, kind: "list", ...list });
			list = null;
		}
	};
	for (const raw of markdown.replace(/\r\n?/g, "\n").split("\n")) {
		const line = raw.trimEnd();
		if (line.trim() === "") {
			flushParagraph();
			flushList();
			continue;
		}
		const heading = HEADING.exec(line);
		if (heading) {
			flushParagraph();
			flushList();
			blocks.push({
				id: next++,
				kind: "heading",
				depth: heading[1]?.length ?? 1,
				text: heading[2] ?? "",
			});
			continue;
		}
		const bullet = BULLET.exec(line);
		const numbered = bullet ? null : NUMBERED.exec(line);
		const item = bullet ?? numbered;
		if (item) {
			flushParagraph();
			const ordered = numbered !== null;
			if (list !== null && list.ordered !== ordered) flushList();
			if (list === null) list = { ordered, items: [] };
			list.items.push({ id: next++, text: item[1] ?? "" });
			continue;
		}
		flushList();
		paragraph.push(line.trim());
	}
	flushParagraph();
	flushList();
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

const HEADING_TAGS = ["h2", "h3", "h4", "h5", "h6"] as const;

export function MarkdownText({
	markdown,
	headingLevel = 2,
}: {
	readonly markdown: string;
	readonly headingLevel?: 2 | 3;
}) {
	return (
		<div
			className="flex flex-col gap-3 text-body text-ink"
			data-testid="markdown"
		>
			{markdownBlocks(markdown).map((block) => {
				if (block.kind === "heading") {
					const Tag =
						HEADING_TAGS[
							Math.min(
								block.depth - 1 + headingLevel - 2,
								HEADING_TAGS.length - 1,
							)
						] ?? "h6";
					return (
						<Tag key={block.id} className="pt-1 text-body font-semibold">
							{inlineText(block.text)}
						</Tag>
					);
				}
				if (block.kind === "list") {
					const List = block.ordered ? "ol" : "ul";
					return (
						<List
							key={block.id}
							className={`flex flex-col gap-1 pl-5 ${block.ordered ? "list-decimal" : "list-disc"}`}
						>
							{block.items.map((item) => (
								<li key={item.id}>{inlineText(item.text)}</li>
							))}
						</List>
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
