import { useI18n } from "@fnb/zalo-mini/i18n";
import { ChipGroup, PriceText, StatusPill } from "@fnb/zalo-mini/ui-kit";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { differenceOf, parseAmount } from "../lib/cash";
import { RpcError } from "../lib/rpc";
import { useMember, useSession } from "../lib/session";
import { useStore } from "../lib/store";
import {
	addDays,
	clockOf,
	dayAndClock,
	monthOf,
	vietnamDate,
} from "../lib/time";
import {
	closeForgottenShift,
	confirmShift,
	DIFFERENCE_REASON_LABEL,
	dayReconciliation,
	managerShifts,
	mayReadReconciliation,
	type Shift,
	workedDays,
} from "../shift/api";
import { ReconciliationDialog } from "../shift/reconciliation";
import { Dialog } from "../ui/dialog";
import { button, card, field, Loading, PageTitle, PlainNote } from "../ui/kit";
import { useToast } from "../ui/toast";
import { PaymentExceptionsLine } from "./payment-exceptions-page";

export const DIFFERENCE_REASONS = [
	"wrongChange",
	"forgotOrder",
	"pettyCash",
	"unknown",
] as const;

/** The manager's reason chip that matches the counting person's reason (Q02), to start the confirmation from it. */
export function managerReasonOf(
	shift: Pick<Shift, "difference_reason">,
): (typeof DIFFERENCE_REASONS)[number] | "" {
	switch (shift.difference_reason) {
		case "wrong_change":
			return "wrongChange";
		case "unrecorded_order":
			return "forgotOrder";
		case "petty_cash":
			return "pettyCash";
		case "unknown":
			return "unknown";
		default:
			return "";
	}
}

/** The note of a confirmation: the reason in words, then the manager's note, at most 200 characters. */
export function confirmationNote(reasonText: string, note: string): string {
	const text =
		note.trim() === "" ? reasonText : `${reasonText} · ${note.trim()}`;
	return [...text].slice(0, 200).join("");
}

function ConfirmDialog({
	shift,
	onClose,
}: {
	readonly shift: Shift;
	readonly onClose: () => void;
}) {
	const { t } = useI18n();
	const { client } = useSession();
	const { show } = useToast();
	const queries = useQueryClient();
	const [reason, setReason] = useState<string>(() => managerReasonOf(shift));
	const [note, setNote] = useState("");
	const [busy, setBusy] = useState(false);
	const [message, setMessage] = useState<string | null>(null);
	const difference = differenceOf(shift.cash_difference ?? 0);
	const cashierReason =
		shift.difference_reason === null || shift.difference_reason === undefined
			? null
			: shift.difference_reason;
	const ready =
		reason !== "" && (reason !== "unknown" || note.trim().length >= 5);
	const submit = async () => {
		setBusy(true);
		try {
			const answer = await confirmShift(
				client,
				shift.id,
				confirmationNote(t(`shift.reason.${reason}`), note),
			);
			if (answer.state === "closed") {
				show(t("managerShifts.confirmed"));
				await queries.invalidateQueries({ queryKey: ["manager-shifts"] });
				onClose();
			} else {
				setMessage(t(`managerShifts.refusal.${answer.refusal ?? "failed"}`));
			}
		} catch (error) {
			setMessage(
				t(
					error instanceof RpcError && error.forbidden
						? "common.forbidden"
						: "common.failed",
				),
			);
		} finally {
			setBusy(false);
		}
	};
	return (
		<Dialog
			title={t("managerShifts.confirmTitle", { name: shift.name ?? "" })}
			onClose={onClose}
			closeLabel={t("common.close")}
			busy={busy}
			testId="confirm-shift"
			footer={
				<>
					<button
						type="button"
						className={button.secondary}
						onClick={onClose}
						disabled={busy}
					>
						{t("common.cancel")}
					</button>
					<button
						type="button"
						className={button.primary}
						onClick={() => void submit()}
						disabled={!ready || busy}
						data-testid="confirm-shift-submit"
					>
						{t("managerShifts.confirm")}
					</button>
				</>
			}
		>
			<div className="flex flex-col gap-4">
				<p className="text-lg font-extrabold" role="status">
					{difference.kind === "matched"
						? t("shift.matched")
						: t(`shift.${difference.kind}`)}{" "}
					{difference.kind === "matched" ? null : (
						<PriceText amount={difference.amount} tone="ink" />
					)}
				</p>
				<p className="text-body">
					{t("shift.expected")}{" "}
					<PriceText amount={shift.expected_cash ?? 0} tone="ink" /> ·{" "}
					{t("shift.counted")}{" "}
					<PriceText amount={shift.counted_cash ?? 0} tone="ink" />
				</p>
				<p
					className="rounded-card-xl bg-surface-sunken p-3 text-body"
					data-testid="cashier-reason-shown"
				>
					<span className="font-bold">{t("managerShifts.cashierReason")}</span>{" "}
					{cashierReason === null
						? t("managerShifts.noCashierReason")
						: `${t(DIFFERENCE_REASON_LABEL[cashierReason])}${shift.difference_note === null || shift.difference_note === undefined ? "" : ` · ${shift.difference_note}`}`}
				</p>
				<ChipGroup
					label={t("managerShifts.reason")}
					chips={DIFFERENCE_REASONS.map((key) => ({
						key,
						label: t(`shift.reason.${key}`),
					}))}
					selected={reason}
					onSelect={setReason}
					testId="difference-reason"
				/>
				<label className="flex flex-col gap-1">
					<span className="font-bold">{t("managerShifts.note")}</span>
					<textarea
						className={`${field} min-h-24 py-2`}
						maxLength={150}
						value={note}
						onChange={(event) => setNote(event.target.value)}
						data-testid="confirm-note"
					/>
				</label>
				{message === null ? null : (
					<PlainNote tone="negative">{message}</PlainNote>
				)}
			</div>
		</Dialog>
	);
}

function CloseDialog({
	shift,
	onClose,
}: {
	readonly shift: Shift;
	readonly onClose: () => void;
}) {
	const { t } = useI18n();
	const { client } = useSession();
	const queries = useQueryClient();
	const [time, setTime] = useState("");
	const [amount, setAmount] = useState("");
	const [note, setNote] = useState("");
	const [message, setMessage] = useState<string | null>(null);
	const counted = parseAmount(amount);
	const at = time === "" ? null : new Date(`${time}:00+07:00`);
	const ready =
		at !== null &&
		!Number.isNaN(at.getTime()) &&
		counted !== null &&
		note.trim() !== "";
	const submit = async () => {
		if (!ready || at === null || counted === null) return;
		try {
			const answer = await closeForgottenShift(
				client,
				shift.id,
				at.toISOString(),
				counted,
				note.trim(),
			);
			if (answer.state === "closed") {
				await queries.invalidateQueries({ queryKey: ["manager-shifts"] });
				onClose();
			} else {
				setMessage(t(`managerShifts.refusal.${answer.refusal ?? "failed"}`));
			}
		} catch {
			setMessage(t("common.failed"));
		}
	};
	return (
		<Dialog
			title={t("managerShifts.closeTitle", { name: shift.name ?? "" })}
			onClose={onClose}
			closeLabel={t("common.close")}
			footer={
				<button
					type="button"
					className={button.primary}
					disabled={!ready}
					onClick={() => void submit()}
				>
					{t("managerShifts.close")}
				</button>
			}
		>
			<div className="flex flex-col gap-3">
				<p className="text-body text-ink-muted">
					{t("managerShifts.closeLead", {
						time: dayAndClock(shift.clock_in_at),
					})}
				</p>
				<label className="flex flex-col gap-1">
					<span className="font-bold">{t("managerShifts.clockOutAt")}</span>
					<input
						type="datetime-local"
						className={field}
						value={time}
						onChange={(event) => setTime(event.target.value)}
					/>
				</label>
				<label className="flex flex-col gap-1">
					<span className="font-bold">{t("shift.counted")}</span>
					<input
						className={field}
						inputMode="numeric"
						value={amount}
						onChange={(event) => setAmount(event.target.value)}
					/>
				</label>
				<label className="flex flex-col gap-1">
					<span className="font-bold">{t("managerShifts.note")}</span>
					<input
						className={field}
						maxLength={200}
						value={note}
						onChange={(event) => setNote(event.target.value)}
					/>
				</label>
				{message === null ? null : (
					<PlainNote tone="negative">{message}</PlainNote>
				)}
			</div>
		</Dialog>
	);
}

function ShiftRow({
	shift,
	onConfirm,
	onClose,
	onReconcile,
}: {
	readonly shift: Shift;
	readonly onConfirm: () => void;
	readonly onClose: () => void;
	readonly onReconcile: () => void;
}) {
	const { t } = useI18n();
	const { userId } = useMember();
	const own = shift.user_id === userId;
	// another person's shift at any time (an open one: the figures so far); one's own only once counted (blind count)
	const reconcilable = mayReadReconciliation(shift, userId);
	const difference = differenceOf(shift.cash_difference ?? 0);
	return (
		<li
			className="flex flex-wrap items-center gap-3 py-3"
			data-testid="shift-row"
			data-status={shift.status}
		>
			<div className="min-w-48 flex-1">
				<p className="font-extrabold">
					{shift.name ?? t("managerShifts.someone")}
				</p>
				<p className="text-sm text-ink-muted">
					{dayAndClock(shift.clock_in_at)} →{" "}
					{shift.clock_out_at === null ? "…" : clockOf(shift.clock_out_at)}
					{shift.hours === null
						? ""
						: ` · ${t("shift.hours", { hours: shift.hours })}`}
				</p>
			</div>
			{shift.status === "open" ? null : (
				<span className="text-sm">
					{difference.kind === "matched"
						? t("shift.matched")
						: t(`shift.${difference.kind}`)}{" "}
					{difference.kind === "matched" ? null : (
						<PriceText amount={difference.amount} tone="ink" />
					)}
				</span>
			)}
			<StatusPill
				tone={
					shift.status === "closed"
						? "neutral"
						: shift.status === "open"
							? "positive"
							: "warning"
				}
			>
				{t(`shift.status.${shift.status}`)}
			</StatusPill>
			{shift.status === "awaiting_confirmation" ? (
				own ? (
					<span className="text-sm text-ink-muted">
						{t("managerShifts.ownShift")}
					</span>
				) : (
					<button
						type="button"
						className={button.primary}
						onClick={onConfirm}
						data-testid="confirm-shift-open"
					>
						{t("managerShifts.confirm")}
					</button>
				)
			) : null}
			{shift.status === "open" && !own ? (
				<button type="button" className={button.secondary} onClick={onClose}>
					{t("managerShifts.close")}
				</button>
			) : null}
			{reconcilable ? (
				<button
					type="button"
					className={button.secondary}
					onClick={onReconcile}
					aria-label={t("shift.recon.openLabelOf", {
						name: shift.name ?? t("managerShifts.someone"),
						when: dayAndClock(shift.clock_in_at),
					})}
					data-testid="shift-reconciliation-open"
				>
					{t("shift.recon.open")}
				</button>
			) : null}
		</li>
	);
}

function Reconciliation({ date }: { readonly date: string }) {
	const { t } = useI18n();
	const { client } = useSession();
	const { store } = useStore();
	const day = useQuery({
		queryKey: ["manager-shifts", "reconciliation", store.id, date],
		queryFn: () => dayReconciliation(client, store.id, date),
	});
	if (day.data === undefined) return <Loading label={t("app.loading")} />;
	const value = day.data;
	const line = (label: string, amount: number, testId?: string) => (
		<p className="flex justify-between gap-3">
			<span>{label}</span>
			<PriceText
				amount={Math.abs(amount)}
				kind={amount < 0 ? "delta" : "price"}
				tone="ink"
				{...(testId === undefined ? {} : { testId })}
			/>
		</p>
	);
	return (
		<section
			className={`${card} flex flex-col gap-2 p-5`}
			data-testid="reconciliation"
		>
			<div className="flex items-center gap-3">
				<h2 className="flex-1 text-lg font-extrabold">
					{t("managerShifts.reconciliation")}
				</h2>
				<StatusPill
					tone={value.matched ? "positive" : "warning"}
					testId="reconciliation-status"
				>
					{value.matched
						? t("managerShifts.matched")
						: t("managerShifts.notMatched")}
				</StatusPill>
			</div>
			{line(
				t("managerShifts.revenue"),
				value.revenue,
				"reconciliation-revenue",
			)}
			{line(t("managerShifts.online"), value.online_confirmed)}
			{line(t("managerShifts.card"), value.card)}
			{line(
				t("managerShifts.cashCounted"),
				value.cash.counted,
				"reconciliation-cash",
			)}
			{line(t("managerShifts.cashExpected"), value.cash.expected)}
			{value.shifts_open + value.shifts_awaiting_confirmation > 0 ? (
				<PlainNote tone="warning">
					{t("managerShifts.shiftsPending", {
						open: value.shifts_open,
						awaiting: value.shifts_awaiting_confirmation,
					})}
				</PlainNote>
			) : null}
			{value.difference !== 0 ? (
				<p className="font-bold">
					{t("managerShifts.difference")}{" "}
					<PriceText amount={value.difference} kind="delta" tone="ink" />
				</p>
			) : null}
			<PaymentExceptionsLine />
		</section>
	);
}

function WorkedDaysCard({ month }: { readonly month: string }) {
	const { t } = useI18n();
	const { client } = useSession();
	const { store } = useStore();
	const days = useQuery({
		queryKey: ["manager-shifts", "worked-days", store.id, month],
		queryFn: () => workedDays(client, store.id, month),
	});
	if (days.data === undefined) return <Loading label={t("app.loading")} />;
	return (
		<section
			className={`${card} flex flex-col gap-2 p-5`}
			data-testid="worked-days-table"
		>
			<h2 className="text-lg font-extrabold">
				{t("managerShifts.workedDays", { month: days.data.month })}
			</h2>
			{days.data.people.length === 0 ? (
				<PlainNote>{t("managerShifts.noShifts")}</PlainNote>
			) : (
				<table className="w-full text-left">
					<thead className="text-sm text-ink-muted">
						<tr>
							<th className="py-1 font-semibold">
								{t("managerShifts.person")}
							</th>
							<th className="py-1 text-right font-semibold">
								{t("managerShifts.hoursHead")}
							</th>
							<th className="py-1 text-right font-semibold">
								{t("managerShifts.daysHead", {
									standard: days.data.standard_days,
								})}
							</th>
						</tr>
					</thead>
					<tbody>
						{days.data.people.map((person) => (
							<tr
								key={person.user_id}
								className="border-t border-line"
								data-testid="worked-days-row"
							>
								<td className="py-2 font-bold">
									{person.name ?? t("managerShifts.someone")}
								</td>
								<td className="py-2 text-right tabular-nums">{person.hours}</td>
								<td className="py-2 text-right font-extrabold tabular-nums">
									{person.worked_days}
								</td>
							</tr>
						))}
					</tbody>
				</table>
			)}
		</section>
	);
}

/** Quản lý → Ca làm: differences to confirm, forgotten clock-outs, the week's shifts, worked days and the day's check. */
export function ManagerShiftsPage() {
	const { t } = useI18n();
	const { client } = useSession();
	const { store } = useStore();
	const [date, setDate] = useState(() => vietnamDate(Date.now()));
	const { userId } = useMember();
	const [confirming, setConfirming] = useState<Shift | null>(null);
	const [closing, setClosing] = useState<Shift | null>(null);
	const [reconciling, setReconciling] = useState<Shift | null>(null);
	const shifts = useQuery({
		queryKey: ["manager-shifts", "list", store.id, date],
		queryFn: () => managerShifts(client, store.id, addDays(date, -6), date),
		refetchInterval: 15_000,
	});
	const list = shifts.data?.shifts ?? [];
	const ordered = [...list].sort(
		(a, b) =>
			Number(b.status === "awaiting_confirmation") -
				Number(a.status === "awaiting_confirmation") ||
			b.clock_in_at.localeCompare(a.clock_in_at),
	);
	return (
		<div className="mx-auto flex max-w-5xl flex-col gap-4">
			<PageTitle
				aside={
					<input
						type="date"
						className={`${field} w-auto`}
						value={date}
						aria-label={t("managerShifts.date")}
						onChange={(event) =>
							event.target.value !== "" && setDate(event.target.value)
						}
					/>
				}
			>
				{t("managerShifts.title")}
			</PageTitle>
			{shifts.data === undefined ? (
				<Loading label={t("app.loading")} />
			) : (
				<section className={`${card} p-5`}>
					<h2 className="text-lg font-extrabold">
						{t("managerShifts.list")}{" "}
						{shifts.data.awaiting_confirmation > 0 ? (
							<StatusPill tone="warning">
								{t("managerShifts.awaitingCount", {
									count: shifts.data.awaiting_confirmation,
								})}
							</StatusPill>
						) : null}
					</h2>
					{ordered.length === 0 ? (
						<PlainNote>{t("managerShifts.noShifts")}</PlainNote>
					) : (
						<ul className="divide-y divide-line">
							{ordered.map((shift) => (
								<ShiftRow
									key={shift.id}
									shift={shift}
									onConfirm={() => setConfirming(shift)}
									onClose={() => setClosing(shift)}
									onReconcile={() => setReconciling(shift)}
								/>
							))}
						</ul>
					)}
				</section>
			)}
			<div className="grid gap-4 lg:grid-cols-2">
				<Reconciliation date={date} />
				<WorkedDaysCard month={monthOf(date)} />
			</div>
			{confirming === null ? null : (
				<ConfirmDialog shift={confirming} onClose={() => setConfirming(null)} />
			)}
			{closing === null ? null : (
				<CloseDialog shift={closing} onClose={() => setClosing(null)} />
			)}
			{reconciling === null ? null : (
				<ReconciliationDialog
					shift={reconciling}
					userId={userId}
					name={reconciling.name ?? t("managerShifts.someone")}
					onClose={() => setReconciling(null)}
				/>
			)}
		</div>
	);
}
