import { useI18n } from "@fnb/zalo-mini/i18n";
import { PriceText } from "@fnb/zalo-mini/ui-kit";
import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { differenceOf } from "../lib/cash";
import { RpcError } from "../lib/rpc";
import { useSession } from "../lib/session";
import { clockOf, dayAndClock } from "../lib/time";
import { Dialog } from "../ui/dialog";
import { AlertIcon, CheckIcon } from "../ui/icons";
import { button, Loading, PlainNote } from "../ui/kit";
import {
	drawerLines,
	mayReadReconciliation,
	outsideLines,
	type ReconciliationLine,
	type Shift,
	type ShiftReconciliation,
	shiftReconciliation,
} from "./api";

// Q02 "Đối chiếu" (native-till.md 18.4): the drawer's breakdown after the count (opening cash, cash sales, cash
// refunds, paid-outs, what it should hold, what was counted, the difference) and what is not in the drawer (card,
// card refunds, VietQR, the Zalo wallet). The count stays blind: a screen asks for the person's own shift only once it
// is counted (mayReadReconciliation), so no expected figure is fetched before; owners and managers open another
// person's shift from Quản lý → Ca làm. Every figure is the server's; nothing is computed here.

type T = (key: string, params?: Record<string, string | number>) => string;

/** What a screen knows of the shift whose breakdown it asks for. */
export type ReconciledShift = Pick<Shift, "id" | "status" | "version"> &
	Partial<Pick<Shift, "user_id">>;

const LABEL: Readonly<Record<ReconciliationLine["key"], string>> = {
	opening: "shift.openingCash",
	cashSales: "shift.recon.cashSales",
	cashRefunds: "shift.recon.cashRefunds",
	paidOuts: "shift.recon.paidOuts",
	card: "shift.recon.card",
	cardRefunds: "shift.recon.cardRefunds",
	vietqr: "shift.recon.vietqr",
	zaloCheckout: "shift.recon.zaloCheckout",
};

const MOVES_DRAWER: ReadonlySet<ReconciliationLine["key"]> = new Set([
	"cashSales",
	"cashRefunds",
	"paidOuts",
]);

function Line({
	line,
	t,
}: {
	readonly line: ReconciliationLine;
	readonly t: T;
}) {
	return (
		<div
			className="flex items-baseline justify-between gap-3"
			data-testid={`recon-${line.key}`}
		>
			<dt className="text-ink-muted">
				{line.count === null
					? t(LABEL[line.key])
					: t(LABEL[line.key], { count: line.count })}
			</dt>
			<dd className="font-bold tabular-nums">
				{/* the drawer's movements carry their sign; what is outside it reads as an amount, a refund as a minus */}
				<PriceText
					amount={line.amount}
					kind={
						MOVES_DRAWER.has(line.key) || line.amount < 0 ? "delta" : "price"
					}
					tone="ink"
				/>
			</dd>
		</div>
	);
}

/** The difference in words and a sign (never colour alone), as the design's box under the count. */
function DifferenceStatus({
	value,
	t,
}: {
	readonly value: ShiftReconciliation;
	readonly t: T;
}) {
	const difference = differenceOf(value.cash_difference ?? 0);
	const matched = difference.kind === "matched";
	return (
		<div
			role="status"
			className={`flex items-center gap-3 rounded-card-xl p-4 text-ink ${matched ? "bg-positive-soft" : "bg-negative-soft"}`}
			data-testid="cash-difference"
			data-kind={difference.kind}
		>
			{matched ? <CheckIcon /> : <AlertIcon />}
			<div className="min-w-0 flex-1">
				<p className="text-lg font-extrabold">
					{t(matched ? "shift.matched" : `shift.${difference.kind}`)}
				</p>
				<p className="text-sm">{t(`shift.recon.${difference.kind}Lead`)}</p>
			</div>
			<PriceText
				amount={value.cash_difference ?? 0}
				kind="delta"
				size="lead"
				tone="ink"
			/>
		</div>
	);
}

/** The two cards of "Đối chiếu": the drawer, then what is not in it. */
export function ReconciliationView({
	value,
}: {
	readonly value: ShiftReconciliation;
}) {
	const { t } = useI18n();
	return (
		<div
			className="@container"
			data-testid="reconciliation-view"
			data-counted={value.counted}
		>
			<div className="grid gap-4 @2xl:grid-cols-2">
				<section
					className="flex flex-col gap-3 rounded-card-xl border-card border-line bg-surface-raised p-4"
					aria-labelledby="recon-drawer-title"
				>
					<h3 id="recon-drawer-title" className="text-lg font-extrabold">
						{t("shift.recon.title")}
					</h3>
					{value.counted ? null : (
						<p className="text-sm text-ink-muted" data-testid="recon-so-far">
							{t("shift.recon.soFar", { time: clockOf(value.until) })}
						</p>
					)}
					<dl className="flex flex-col gap-2">
						{drawerLines(value).map((line) => (
							<Line key={line.key} line={line} t={t} />
						))}
					</dl>
					<dl className="flex flex-col gap-2 border-t border-line pt-3 text-lg">
						<div className="flex items-baseline justify-between gap-3">
							<dt className="font-extrabold">
								{value.counted
									? t("shift.expected")
									: t("shift.recon.expectedSoFar")}
							</dt>
							<dd className="font-extrabold tabular-nums">
								<PriceText
									amount={value.expected_cash}
									tone="ink"
									testId="recon-expected"
								/>
							</dd>
						</div>
						<div className="flex items-baseline justify-between gap-3">
							<dt className="font-extrabold">{t("shift.counted")}</dt>
							<dd className="font-extrabold tabular-nums">
								{value.counted_cash === null ? (
									<span className="text-base text-ink-muted">
										{t("shift.recon.notCounted")}
									</span>
								) : (
									<PriceText
										amount={value.counted_cash}
										tone="ink"
										testId="recon-counted"
									/>
								)}
							</dd>
						</div>
					</dl>
					{value.counted && value.cash_difference !== null ? (
						<DifferenceStatus value={value} t={t} />
					) : null}
				</section>
				<section
					className="flex flex-col gap-3 self-start rounded-card-xl border-card border-line bg-surface-raised p-4"
					aria-labelledby="recon-outside-title"
					data-testid="recon-outside"
				>
					<h3
						id="recon-outside-title"
						className="text-sm font-extrabold tracking-wide text-ink-muted uppercase"
					>
						{t("shift.recon.notInDrawer")}
					</h3>
					<dl className="flex flex-col gap-2">
						{outsideLines(value).map((line) => (
							<Line key={line.key} line={line} t={t} />
						))}
					</dl>
					<p className="text-sm text-ink-muted">
						{t("shift.recon.notInDrawerNote")}
					</p>
				</section>
			</div>
		</div>
	);
}

/** The reconciliation of a shift, asked only where mayReadReconciliation allows it (never before the person's count). */
export function useReconciliation(
	shift: ReconciledShift | null,
	userId: string | null,
) {
	const { client } = useSession();
	const allowed = shift !== null && mayReadReconciliation(shift, userId);
	return useQuery({
		// a recount or a confirmation moves the shift's version: the breakdown is asked again
		queryKey: [
			"shift-reconciliation",
			shift?.id ?? "",
			shift?.status ?? "",
			shift?.version ?? 0,
		],
		queryFn: () => shiftReconciliation(client, shift?.id ?? ""),
		enabled: allowed,
	});
}

/** The breakdown of a shift with its loading, refusal and failure states. */
export function ReconciliationPanel({
	shift,
	userId,
	fallback = null,
}: {
	readonly shift: ReconciledShift;
	readonly userId: string | null;
	/** what shows while the breakdown loads or could not load (the counted shift's own difference) */
	readonly fallback?: ReactNode;
}) {
	const { t } = useI18n();
	const answer = useReconciliation(shift, userId);
	if (!mayReadReconciliation(shift, userId))
		return (
			<PlainNote testId="recon-count-first">
				{t("shift.recon.countRequired")}
			</PlainNote>
		);
	if (answer.data === undefined) {
		if (answer.error === null)
			return fallback ?? <Loading label={t("app.loading")} />;
		const error = answer.error;
		return (
			<div className="flex flex-col gap-3">
				{fallback}
				<div
					className="flex flex-wrap items-center gap-3"
					data-testid="recon-failed"
				>
					<PlainNote tone="negative">
						{t(
							error instanceof RpcError && error.network
								? "common.network"
								: error instanceof RpcError && error.forbidden
									? "common.forbidden"
									: "shift.recon.failed",
						)}
					</PlainNote>
					<button
						type="button"
						className={button.secondary}
						onClick={() => void answer.refetch()}
					>
						{t("shift.recon.retry")}
					</button>
				</div>
			</div>
		);
	}
	if (answer.data.state !== "ok")
		return (
			<PlainNote testId="recon-count-first">
				{t("shift.recon.countRequired")}
			</PlainNote>
		);
	return <ReconciliationView value={answer.data.reconciliation} />;
}

/** "Đối chiếu" of a shift in a dialog: a past shift of one's own, or another person's from Quản lý → Ca làm. */
export function ReconciliationDialog({
	shift,
	userId,
	name,
	onClose,
}: {
	readonly shift: Shift;
	readonly userId: string | null;
	/** the person's name on a manager's screen; none for one's own */
	readonly name?: string | null;
	readonly onClose: () => void;
}) {
	const { t } = useI18n();
	const when = `${dayAndClock(shift.clock_in_at)}${shift.clock_out_at === null ? "" : `–${clockOf(shift.clock_out_at)}`}`;
	return (
		<Dialog
			title={
				name === undefined || name === null
					? t("shift.recon.dialogTitle", { when })
					: t("shift.recon.dialogTitleOf", { name, when })
			}
			onClose={onClose}
			closeLabel={t("common.close")}
			size="lg"
			testId="reconciliation-dialog"
		>
			<ReconciliationPanel shift={shift} userId={userId} />
		</Dialog>
	);
}
