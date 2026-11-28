import { MAX_CART_LINES, MAX_LINE_QUANTITY } from "@fnb/zalo-mini/ordering";
import { useI18n } from "@fnb/zalo-mini/react";
import { useEffect, useRef } from "react";
import type { ReorderReport } from "./reorder";

// What "Đặt lại" could not do as the order had it (design spec C14 `orders-reorder-partial`): the lines left out, the
// lines that did not fit, the quantities brought to the limit, the notes not copied and the choices still to make,
// each naming its lines. The names are the order's and the menu's text, written as text, never as markup. The focus
// moves to it, so a screen reader reads it where the customer lands.

export function ReorderReportNotice({
	report,
}: {
	readonly report: ReorderReport;
}) {
	const { t } = useI18n();
	const ref = useRef<HTMLDivElement>(null);
	useEffect(() => {
		ref.current?.focus();
	}, []);
	const parts: { readonly kind: string; readonly text: string }[] = [];
	if (report.leftOut.length > 0)
		parts.push({
			kind: "unavailable",
			text: t("orders.reorderPartial", {
				count: report.leftOut.length,
				names: report.leftOut.join(", "),
			}),
		});
	if (report.full.length > 0)
		parts.push({
			kind: "full",
			text: t("orders.reorderFull", {
				max: MAX_CART_LINES,
				names: report.full.join(", "),
			}),
		});
	if (report.capped.length > 0)
		parts.push({
			kind: "capped",
			text: t("orders.reorderCapped", {
				max: MAX_LINE_QUANTITY,
				names: report.capped.join(", "),
			}),
		});
	if (report.notesDropped.length > 0)
		parts.push({
			kind: "note",
			text: t("orders.reorderNoteDropped", {
				names: report.notesDropped.join(", "),
			}),
		});
	if (report.toChoose.length > 0)
		parts.push({
			kind: "choose",
			text: t("orders.reorderChoose", {
				names: report.toChoose.join(", "),
			}),
		});
	return (
		<div
			ref={ref}
			role="status"
			tabIndex={-1}
			data-testid="orders-reorder-partial"
			className="flex flex-col gap-1 rounded-card bg-warning-soft px-4 py-3 text-body text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
		>
			{parts.map((part) => (
				<p key={part.kind} data-kind={part.kind} className="break-words">
					{part.text}
				</p>
			))}
		</div>
	);
}
