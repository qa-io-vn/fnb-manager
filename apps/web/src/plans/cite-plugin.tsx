import { type DataPack, type PackUnit, resolveCell } from "@fnb/datapack";
import type { ReactNode } from "react";
import Markdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { useT } from "../i18n";
import type { Formatters } from "../lib/format";
import { formatKpiChange, formatKpiValue, isFraction } from "./display";

export const PLAN_ELEMENTS = [
	"h2",
	"h3",
	"h4",
	"p",
	"ul",
	"ol",
	"li",
	"strong",
	"em",
	"table",
	"thead",
	"tbody",
	"tr",
	"th",
	"td",
	"blockquote",
	"code",
	"pre",
	"hr",
	"br",
	"cite",
] as const;

const CITATION = /\[\[([^[\]\n]{1,200})\]\]/g;
export const CITE_REF_ATTRIBUTE = "data-plan-ref";

interface MdNode {
	type: string;
	value?: string;
	children?: MdNode[];
	data?: Record<string, unknown>;
}

function citeNode(ref: string): MdNode {
	return {
		type: "planCite",
		data: {
			hName: "cite",
			hProperties: { [CITE_REF_ATTRIBUTE]: ref },
		},
		children: [{ type: "text", value: ref }],
	};
}

export function splitCitations(value: string): MdNode[] {
	const parts: MdNode[] = [];
	let last = 0;
	for (const match of value.matchAll(CITATION)) {
		const index = match.index ?? 0;
		if (index > last)
			parts.push({ type: "text", value: value.slice(last, index) });
		parts.push(citeNode((match[1] ?? "").trim()));
		last = index + match[0].length;
	}
	if (last < value.length)
		parts.push({ type: "text", value: value.slice(last) });
	return parts;
}

function walk(node: MdNode): void {
	if (node.children === undefined) return;
	const next: MdNode[] = [];
	for (const child of node.children) {
		if (child.type === "text" && child.value !== undefined) {
			next.push(...splitCitations(child.value));
		} else {
			walk(child);
			next.push(child);
		}
	}
	node.children = next;
}

export function remarkPlanCitations() {
	return (tree: unknown) => {
		walk(tree as MdNode);
	};
}

export function planBody(content: string): string {
	const lines = content.split("\n");
	if (lines[0] !== "---") return content;
	const end = lines.indexOf("---", 1);
	return end === -1 ? content : lines.slice(end + 1).join("\n");
}

export interface CitationView {
	readonly ref: string;
	readonly table: string;
	readonly row: string;
	readonly column: string;
	readonly text: string | null;
	readonly title: string | null;
}

function metricOfRow(row: string): string {
	const slash = row.lastIndexOf("/");
	return slash === -1 ? row : row.slice(slash + 1);
}

export function formatCell(
	formatters: Formatters,
	unit: PackUnit,
	row: string,
	cell: unknown,
): string | null {
	if (cell === null || cell === undefined) return null;
	if (typeof cell !== "number") return String(cell);
	switch (unit) {
		case "money":
			return formatters.moneyExact(cell);
		case "money_thousands":
			return formatters.moneyExact(cell * 1000);
		case "count":
			return formatters.count(cell);
		case "fraction":
			return formatters.percentExact(cell);
		case "rel_change":
			return formatters.signedPercent(cell);
		case "pp_change":
			return formatters.points(cell);
		case "metric":
			return formatKpiValue(formatters, metricOfRow(row), cell);
		case "metric_change":
			return isFraction(metricOfRow(row))
				? formatters.points(cell)
				: formatters.signedPercent(cell);
		default:
			return formatters.decimal(cell);
	}
}

export function citationView(
	pack: DataPack,
	formatters: Formatters,
	ref: string,
): CitationView {
	const [table = "", row = "", column = ""] = ref
		.split(":")
		.map((part) => part.trim());
	const resolved = resolveCell(pack, table, row, column);
	if (resolved === null) {
		return { ref, table, row, column, text: null, title: null };
	}
	return {
		ref,
		table,
		row: resolved.row,
		column,
		text: formatCell(formatters, resolved.unit, resolved.row, resolved.cell),
		title: pack.tables[table]?.title ?? table,
	};
}

export { formatKpiChange };

function CiteChip({
	pack,
	formatters,
	reference,
}: {
	pack: DataPack;
	formatters: Formatters;
	reference: string;
}) {
	const t = useT();
	const view = citationView(pack, formatters, reference);
	const unresolved = view.title === null;
	const label = unresolved
		? t("plans.detail.citeMissing", { ref: reference })
		: t("plans.detail.citeTitle", {
				table: view.title ?? view.table,
				row: view.row,
				column: view.column,
			});
	return (
		<cite
			className={
				unresolved
					? "rounded border-2 border-negative px-1 not-italic"
					: "rounded bg-surface-sunken px-1 not-italic"
			}
			title={label}
			aria-label={`${view.text ?? reference}, ${label}`}
			data-testid="plan-cite"
			data-ref={reference}
			data-resolved={unresolved ? "false" : "true"}
		>
			{view.text ?? reference}
		</cite>
	);
}

export function PlanMarkdown({
	content,
	pack,
	formatters,
}: {
	content: string;
	pack: DataPack;
	formatters: Formatters;
}): ReactNode {
	const components: Components = {
		cite: (props) => {
			const reference = (props as Record<string, unknown>)[CITE_REF_ATTRIBUTE];
			if (typeof reference !== "string") return <>{props.children}</>;
			return (
				<CiteChip pack={pack} formatters={formatters} reference={reference} />
			);
		},
	};
	return (
		<div className="plan-body space-y-3 break-words" data-testid="plan-body">
			<Markdown
				remarkPlugins={[remarkGfm, remarkPlanCitations]}
				skipHtml
				allowedElements={[...PLAN_ELEMENTS]}
				unwrapDisallowed
				components={components}
			>
				{planBody(content)}
			</Markdown>
		</div>
	);
}
