import type { Menu, OrderingState } from "@fnb/zalo-mini/ordering";
import { kitButton, useI18n } from "@fnb/zalo-mini/react";
import { useState } from "react";
import { deviceScan } from "../counter/scan";
import { addDays, isoDateIn, shownDate, weekdayOf } from "../data/dates";
import { spansText } from "../home/model";
import { closedKind } from "./order-view";
import { useOrdering } from "./ordering-data";
import {
	CalendarIcon,
	ClockIcon,
	clock,
	Notice,
	Problem,
	ScanIcon,
	WifiOffIcon,
} from "./parts";

// The states the ordering screens share: the shop closed (C15), offline without anything to show (C16), the table
// context and its problems, and the scan of a table's code.

function dayWord(t: (key: string) => string, iso: string, now: number): string {
	const day = isoDateIn(Date.parse(iso));
	const today = isoDateIn(now);
	if (day === today) return t("closed.dayToday");
	if (day === addDays(today, 1)) return t("closed.dayTomorrow");
	return shownDate(day);
}

/**
 * C15: the shop is closed now (or today, or has no hours); no character on a state about hours. A store that books a
 * takeaway for its next opening (D7, C17) says so in the body and offers "Hẹn lấy món sáng mai" first (onPreorder);
 * without it the screen is as it was.
 */
export function ClosedState({
	menu,
	preOrder = false,
	onPreorder = null,
}: {
	readonly menu: Menu;
	/** the store books a takeaway for its next opening: the body says so */
	readonly preOrder?: boolean;
	/** "Hẹn lấy món sáng mai": shown when given */
	readonly onPreorder?: (() => void) | null;
}) {
	const { t } = useI18n();
	const ordering = menu.ordering;
	const now = Date.now();
	const spans = menu.store.openingHours[weekdayOf(isoDateIn(now))] ?? [];
	const opensTomorrow =
		ordering.opensAt !== null &&
		isoDateIn(Date.parse(ordering.opensAt)) === addDays(isoDateIn(now), 1);
	return (
		<section
			className="flex flex-col items-center gap-3 rounded-card bg-surface-raised px-5 py-6 text-center shadow-card"
			data-testid="ordering-closed"
			data-reason={ordering.reason ?? ""}
			data-preorder={preOrder}
		>
			<h2 className="text-xl font-bold text-ink">
				{ordering.reason === "hours_unknown"
					? t("closed.unknown")
					: t("closed.title")}
			</h2>
			{ordering.reason === "closed_today" && ordering.closureReason !== null ? (
				<p className="text-body text-ink">
					{t("closed.today", { reason: ordering.closureReason })}
				</p>
			) : null}
			<p className="text-body text-ink" data-testid="closed-body">
				{preOrder && !opensTomorrow
					? t("closed.bodyPreorderLater")
					: spans.length > 0
						? t(preOrder ? "closed.bodyPreorder" : "closed.body", {
								hours: spansText(spans),
							})
						: preOrder
							? t("closed.bodyPreorderLater")
							: t("closed.bodyNoHours")}
			</p>
			{ordering.opensAt === null ? null : (
				<p
					className="flex items-center gap-2 rounded-card-2xl bg-surface-sunken px-4 py-3 text-body font-bold text-ink"
					data-testid="closed-reopen"
				>
					<span className="text-highlight">
						<ClockIcon />
					</span>
					{t("closed.reopen", {
						time: clock(ordering.opensAt),
						day: dayWord(t, ordering.opensAt, now),
					})}
				</p>
			)}
			{onPreorder === null ? null : (
				<button
					type="button"
					className={`${kitButton.primary} w-full`}
					onClick={onPreorder}
					data-testid="closed-preorder"
				>
					<CalendarIcon />
					{t(opensTomorrow ? "closed.preorder" : "closed.preorderLater")}
				</button>
			)}
		</section>
	);
}

/** A hold that is not the closed screen: paused, no staff online, busy, ordering off. */
export function OrderingHeld({
	ordering,
}: {
	readonly ordering: OrderingState;
}) {
	const { t } = useI18n();
	const kind = closedKind(ordering);
	if (kind === null || kind === "closed") return null;
	return (
		<Notice testId="ordering-paused" data={{ reason: ordering.reason ?? "" }}>
			{t(`order.reason.${ordering.reason ?? "ordering_off"}`)}
		</Notice>
	);
}

/** C16: offline with nothing cached to show. */
export function OfflineState({
	hasCart,
	onRetry,
}: {
	readonly hasCart: boolean;
	readonly onRetry: () => void;
}) {
	const { t } = useI18n();
	return (
		<section
			className="flex flex-col items-center gap-3 px-4 py-8 text-center"
			data-testid="offline-screen"
			data-has-cart={hasCart}
		>
			<span
				aria-hidden="true"
				className="flex size-24 items-center justify-center rounded-full bg-surface-sunken text-ink"
			>
				<WifiOffIcon />
			</span>
			<h2 className="text-xl font-bold text-ink">{t("offline.title")}</h2>
			<p className="max-w-xs text-body text-ink">
				{t(hasCart ? "offline.bodyCart" : "offline.body")}
			</p>
			<button
				type="button"
				className={`${kitButton.primary} w-full`}
				onClick={onRetry}
				data-testid="offline-retry"
			>
				{t("customer.retry")}
			</button>
		</section>
	);
}

/** Scans a table's code with Zalo's camera (a stand-in in the browser) and sets the table the server names. */
export function useTableScan(): {
	readonly scan: () => void;
	readonly problem: string | null;
} {
	const { scanTable } = useOrdering();
	const [problem, setProblem] = useState<string | null>(null);
	const scan = () => {
		setProblem(null);
		void deviceScan()().then((result) => {
			if (result.kind === "content") {
				if (!scanTable(result.content)) setProblem("ordering.scanNotTable");
			} else if (result.kind === "refused") {
				setProblem("ordering.scanFailed");
			}
		});
	};
	return { scan, problem };
}

/** The table the orders go to, as the server named it, or why there is none; a takeaway says so instead (C17). */
export function TableContextNote() {
	const { t } = useI18n();
	const { table, retryTable, fulfilment } = useOrdering();
	const { scan, problem } = useTableScan();
	if (fulfilment === "takeaway")
		return (
			<p
				className="inline-flex items-center gap-2 self-start rounded-full bg-neutral-soft px-3 py-1.5 text-body font-bold text-ink"
				data-testid="takeaway-banner"
			>
				{t("ordering.takeawayBanner")}
			</p>
		);
	if (table?.state === "ok")
		return (
			<p
				className="inline-flex items-center gap-2 self-start rounded-full bg-neutral-soft px-3 py-1.5 text-body font-bold text-ink"
				data-testid="table-banner"
			>
				{table.area === null
					? t("ordering.tableBanner", { table: table.label })
					: t("ordering.tableBanner", {
							table: t("ordering.tableArea", {
								table: table.label,
								area: table.area,
							}),
						})}
			</p>
		);
	if (table?.state === "checking")
		return (
			<p
				role="status"
				className="text-body text-ink"
				data-testid="table-checking"
			>
				{t("ordering.tableChecking")}
			</p>
		);
	if (table?.state === "refused")
		return (
			<Problem testId="table-refused" data={{ refusal: table.refusal }}>
				{t(
					table.refusal === "rate_limited"
						? "ordering.tableLimited"
						: "ordering.tableRefused",
				)}
				<button
					type="button"
					className={`${kitButton.secondary} mt-3 w-full`}
					onClick={scan}
				>
					<ScanIcon />
					{t("ordering.tileScan")}
				</button>
			</Problem>
		);
	if (table?.state === "failed")
		return (
			<Problem testId="table-failed">
				{t("ordering.tableFailed")}
				<button
					type="button"
					className={`${kitButton.secondary} mt-3 w-full`}
					onClick={retryTable}
				>
					{t("customer.retry")}
				</button>
			</Problem>
		);
	return (
		<div className="flex flex-col gap-2">
			<Notice testId="no-table">{t("ordering.noTable")}</Notice>
			<button
				type="button"
				className={`${kitButton.secondary} w-full`}
				onClick={scan}
				data-testid="scan-table"
			>
				<ScanIcon />
				{t("ordering.tileScan")}
			</button>
			{problem === null ? null : (
				<p
					role="alert"
					className="text-body text-ink"
					data-testid="scan-problem"
				>
					{t(problem)}
				</p>
			)}
		</div>
	);
}
