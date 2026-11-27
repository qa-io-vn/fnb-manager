import type { DataExport, JsonValue } from "@fnb/zalo-mini/ordering";
import { useI18n } from "@fnb/zalo-mini/react";
import type { ReactNode } from "react";
import { isoDateIn, shownDate } from "../data/dates";
import { clock, Panel } from "./parts";

// C19 "Tải bản sao dữ liệu" (native-till.md 16.6): the copy of everything held about the login, shown in the app as it
// came, section by section. A Mini App cannot freely write a file (zmp-sdk's downloadFile needs a permission granted
// to the app and takes an https file; the share sheet would send the data to a chat, an outbound action the review
// rules hold back), so the copy is read on the screen and copied as one JSON text. Every value is written as text
// (React escapes it); nothing of the answer is ever markup.

/** The sections the database answers, in words; another key is shown as it is. */
export const EXPORT_SECTIONS = [
	"login",
	"customer",
	"memberships",
	"consents",
	"stamp_card",
	"orders",
	"attached_orders",
	"requests",
	"staff_calls",
	"order_blocks",
	"deletion_request",
	"not_kept",
	"counts",
] as const;

/** The whole copy as one indented JSON text, for the clipboard. */
export function exportText(data: DataExport): string {
	return JSON.stringify(data.raw, null, 2);
}

/** A value of the copy as plain text where it is a single value; null and empty as a dash. */
export function plainValue(value: JsonValue): string | null {
	if (value === null || value === "") return "—";
	if (typeof value === "string") return value;
	if (typeof value === "number") return String(value);
	if (typeof value === "boolean") return value ? "✓" : "✗";
	return null;
}

function Value({
	value,
	depth,
}: {
	readonly value: JsonValue;
	readonly depth: number;
}): ReactNode {
	const { t } = useI18n();
	const plain = plainValue(value);
	if (plain !== null)
		return <span className="break-words whitespace-pre-wrap">{plain}</span>;
	if (Array.isArray(value)) {
		if (value.length === 0)
			return <span className="text-ink-muted">{t("dataExport.empty")}</span>;
		return (
			<ol className="flex list-decimal flex-col gap-2 pl-5">
				{value.map((entry, index) => (
					// the copy is read only and in the answer's order, so the position is its key
					// biome-ignore lint/suspicious/noArrayIndexKey: a read-only list in a fixed order
					<li key={index}>
						<Value value={entry} depth={depth + 1} />
					</li>
				))}
			</ol>
		);
	}
	const entries = Object.entries(value as Record<string, JsonValue>);
	if (entries.length === 0)
		return <span className="text-ink-muted">{t("dataExport.empty")}</span>;
	return (
		<dl
			className={`grid grid-cols-[minmax(0,auto)_minmax(0,1fr)] gap-x-3 gap-y-1 ${depth > 0 ? "rounded-tile bg-surface-sunken p-2" : ""}`}
		>
			{entries.map(([key, entry]) => (
				<div key={key} className="contents">
					<dt className="font-mono text-[12px] text-ink-muted break-all">
						{key}
					</dt>
					<dd className="min-w-0 text-[13px] text-ink">
						<Value value={entry} depth={depth + 1} />
					</dd>
				</div>
			))}
		</dl>
	);
}

export function ExportView({ data }: { readonly data: DataExport }) {
	const { t } = useI18n();
	return (
		<div className="flex flex-col gap-3" data-testid="data-export-view">
			<p className="text-[13px] text-ink-muted" data-testid="data-export-time">
				{t("dataExport.generated", {
					time: `${clock(data.generatedAt)} ${shownDate(isoDateIn(Date.parse(data.generatedAt)))}`,
				})}
			</p>
			{data.sections.map((section) => (
				<Panel key={section.key} testId="data-export-section">
					<h3 className="text-[15px] font-bold text-ink" data-key={section.key}>
						{(EXPORT_SECTIONS as readonly string[]).includes(section.key)
							? t(`dataExport.section.${section.key}`)
							: section.key}
					</h3>
					<Value value={section.value} depth={0} />
				</Panel>
			))}
		</div>
	);
}
