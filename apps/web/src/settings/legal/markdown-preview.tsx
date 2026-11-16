import { createElement, type ReactNode } from "react";
import {
	headingLevelsOf,
	type MarkdownBlock,
	type MarkdownInline,
	markdownBlocksOf,
} from "./markdown";

const HEADING_CLASSES: Readonly<Record<number, string>> = {
	1: "text-2xl font-semibold",
	2: "text-xl font-semibold",
	3: "text-lg font-semibold",
	4: "text-base font-semibold",
	5: "text-base font-semibold",
	6: "text-sm font-semibold",
};

function Inlines({ inlines }: { readonly inlines: readonly MarkdownInline[] }) {
	return inlines.map((inline) => {
		const key = `${inline.at}-${inline.kind}`;
		switch (inline.kind) {
			case "strong":
				return <strong key={key}>{inline.text}</strong>;
			case "emphasis":
				return <em key={key}>{inline.text}</em>;
			case "code":
				return (
					<code
						key={key}
						className="rounded bg-surface-sunken px-1 font-mono text-sm"
					>
						{inline.text}
					</code>
				);
			case "link":
				return inline.href === null ? (
					<span key={key}>{inline.text}</span>
				) : (
					<a
						key={key}
						href={inline.href}
						target="_blank"
						rel="noreferrer"
						className="text-accent underline underline-offset-2"
					>
						{inline.text}
					</a>
				);
			default:
				return <span key={key}>{inline.text}</span>;
		}
	});
}

function Block({
	block,
	headingLevel,
}: {
	readonly block: MarkdownBlock;
	readonly headingLevel: number;
}): ReactNode {
	if (block.kind === "heading") {
		return createElement(
			`h${headingLevel}`,
			{ className: HEADING_CLASSES[headingLevel] },
			<Inlines inlines={block.inlines} />,
		);
	}
	if (block.kind === "paragraph") {
		return (
			<p className="break-words">
				<Inlines inlines={block.inlines} />
			</p>
		);
	}
	const items = block.items.map((item) => (
		<li key={item.line}>
			<Inlines inlines={item.inlines} />
		</li>
	));
	return block.ordered ? (
		<ol start={block.start} className="list-decimal space-y-1 ps-6">
			{items}
		</ol>
	) : (
		<ul className="list-disc space-y-1 ps-6">{items}</ul>
	);
}

export interface MarkdownPreviewProps {
	readonly markdown: string;
	readonly headingBase: number;
	readonly emptyText: string;
	readonly id?: string;
	readonly label: string;
	readonly testId?: string;
}

export function MarkdownPreview({
	markdown,
	headingBase,
	emptyText,
	id,
	label,
	testId = "legal-preview",
}: MarkdownPreviewProps) {
	const blocks = markdownBlocksOf(markdown);
	const levels = headingLevelsOf(blocks, headingBase);
	return (
		<section
			id={id}
			aria-label={label}
			className="min-w-0 space-y-3 rounded-lg border border-line bg-surface p-3 break-words"
			data-testid={testId}
		>
			{blocks.length === 0 ? (
				<p className="text-ink-muted">{emptyText}</p>
			) : (
				blocks.map((block) => (
					<Block
						key={block.line}
						block={block}
						headingLevel={
							block.kind === "heading"
								? (levels.get(block.level) ?? headingBase)
								: headingBase
						}
					/>
				))
			)}
		</section>
	);
}
