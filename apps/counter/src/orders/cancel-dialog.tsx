import { formatVnd } from "@fnb/zalo-mini/format";
import { useI18n } from "@fnb/zalo-mini/i18n";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { RpcError } from "../lib/rpc";
import { isManager, useMember, useSession } from "../lib/session";
import { useShift } from "../shift/shift-context";
import { Dialog } from "../ui/dialog";
import { LockIcon, TrashIcon } from "../ui/icons";
import { button, field, PlainNote } from "../ui/kit";
import {
	act,
	CANCEL_REASONS,
	type CancelReason,
	cancelReasonCode,
	refund,
	refundable,
} from "./api";
import type { Order } from "./types";

/**
 * Q03: cancel an order before it is made, with a reason; when it was paid at the counter, the whole amount goes back
 * in the same step (staff settle the due refund in full; a part is for managers, after completion). Every step is
 * written to the order's log with who, when, why and how much.
 */
export function CancelDialog({
	order,
	onClose,
	onDone,
}: {
	readonly order: Order;
	readonly onClose: () => void;
	readonly onDone: (order: Order, message: string) => void;
}) {
	const { t } = useI18n();
	const { client } = useSession();
	const { member } = useMember();
	// the decision is made on the order as it was when the dialog opened: a change elsewhere meanwhile is a conflict
	const [seen] = useState(order);
	const [reason, setReason] = useState<CancelReason | null>(null);
	const [text, setText] = useState("");
	const [busy, setBusy] = useState(false);
	const [message, setMessage] = useState<string | null>(null);
	const due = refundable(order);
	const code = reason === null ? null : cancelReasonCode(reason, text);
	const submit = async () => {
		if (code === null || reason === null) return;
		setBusy(true);
		setMessage(null);
		try {
			const answer = await act(client, seen, "cancel", code);
			if (answer.state === "conflict") {
				onDone(answer.order, t("order.conflict"));
				return;
			}
			if (answer.state !== "ok") {
				setMessage(t(`order.refusal.${answer.refusal ?? "failed"}`));
				return;
			}
			if (due > 0 && answer.order.payment_status === "refund_pending") {
				const words =
					reason === "other" ? text.trim() : t(`cancel.reason.${reason}`);
				const refunded = await refund(
					client,
					order.id,
					due,
					[...words].slice(0, 200).join(""),
				);
				if (refunded.state === "refused") {
					onDone(
						answer.order,
						t("cancel.cancelledRefundOpen", { amount: formatVnd(due) }),
					);
					return;
				}
				onDone(
					refunded.order,
					t("cancel.cancelledRefunded", { amount: formatVnd(due) }),
				);
				return;
			}
			onDone(answer.order, t("cancel.cancelled"));
		} catch (error) {
			setMessage(
				t(
					error instanceof RpcError && error.network
						? "common.network"
						: "common.failed",
				),
			);
		} finally {
			setBusy(false);
		}
	};
	return (
		<Dialog
			title={t("cancel.title", { order: order.display_no ?? "" })}
			onClose={onClose}
			closeLabel={t("common.close")}
			busy={busy}
			testId="cancel-dialog"
			footer={
				<>
					<button
						type="button"
						className={button.secondary}
						onClick={onClose}
						disabled={busy}
					>
						{t("common.back")}
					</button>
					<button
						type="button"
						className={button.destructive}
						disabled={code === null || busy}
						onClick={() => void submit()}
						data-testid="cancel-submit"
					>
						<TrashIcon />
						{due > 0
							? t("cancel.confirmRefund", { amount: formatVnd(due) })
							: t("cancel.confirm")}
					</button>
				</>
			}
		>
			<div className="flex flex-col gap-4">
				<fieldset className="flex flex-col gap-1">
					<legend className="pb-2 font-extrabold">
						{t("cancel.reasonLegend")}
					</legend>
					{CANCEL_REASONS.map((value) => (
						<label
							key={value}
							className="flex min-h-12 items-center gap-3 rounded-card-xl px-2 hover:bg-surface-sunken"
						>
							<input
								type="radio"
								name="cancel-reason"
								className="size-6"
								checked={reason === value}
								onChange={() => setReason(value)}
								data-testid={`cancel-reason-${value}`}
							/>
							<span className="font-semibold">
								{t(`cancel.reason.${value}`)}
							</span>
						</label>
					))}
				</fieldset>
				{reason === "other" ? (
					<label className="flex flex-col gap-1">
						<span className="font-bold">{t("cancel.otherLabel")}</span>
						<input
							className={field}
							maxLength={120}
							value={text}
							onChange={(event) => setText(event.target.value)}
							data-testid="cancel-other"
						/>
						<span className="text-sm text-ink-muted">
							{t("cancel.otherHint")}
						</span>
					</label>
				) : null}
				{due > 0 ? (
					<section className="flex flex-col gap-2 rounded-card-xl border-card border-line p-4">
						<h3 className="font-extrabold">{t("cancel.refundTitle")}</h3>
						<p className="font-bold">
							{t("cancel.refundAll", { amount: formatVnd(due) })}
						</p>
						<p className="flex items-center gap-2 text-sm text-ink-muted">
							<LockIcon size={18} />
							{isManager(member)
								? t("cancel.partialAfter")
								: t("cancel.partialManager")}
						</p>
					</section>
				) : null}
				<p className="text-sm text-ink-muted">
					{t("cancel.audit", { name: member.display_name })}
				</p>
				{message === null ? null : (
					<PlainNote tone="negative">{message}</PlainNote>
				)}
			</div>
		</Dialog>
	);
}

/**
 * A refund by an owner or manager (a completed order, a part), or the due refund of a cancelled paid order. A refund
 * settled in cash needs the person's open shift at the order's store (counter_refund's shift_required, native-till.md
 * 18.3): the refusal is worded with "Vào ca", as the payment dialog does, and the shift is read again. The submit stays
 * open, so a refund after clocking in on another device is one tap; the server decides again.
 */
export function RefundDialog({
	order,
	onClose,
	onDone,
}: {
	readonly order: Order;
	readonly onClose: () => void;
	readonly onDone: (order: Order, message: string) => void;
}) {
	const { t } = useI18n();
	const { client } = useSession();
	const { refresh } = useShift();
	const navigate = useNavigate();
	const max = refundable(order);
	const [amount, setAmount] = useState(String(max));
	const [reason, setReason] = useState("");
	const [busy, setBusy] = useState(false);
	const [message, setMessage] = useState<string | null>(null);
	const [shiftRefused, setShiftRefused] = useState(false);
	const goToShift = () => {
		onClose();
		navigate("/ca");
	};
	const value = /^\d{1,9}$/.test(amount.replace(/[.\s]/g, ""))
		? Number(amount.replace(/[.\s]/g, ""))
		: null;
	const valid =
		value !== null && value >= 1 && value <= max && reason.trim().length >= 1;
	const submit = async () => {
		if (value === null) return;
		setBusy(true);
		setMessage(null);
		setShiftRefused(false);
		try {
			const answer = await refund(client, order.id, value, reason.trim());
			if (answer.state === "refused" && answer.refusal === "shift_required") {
				// a cash refund off shift: nothing was refunded; the way forward is to clock in at this counter
				setShiftRefused(true);
				void refresh();
				return;
			}
			if (answer.state === "refused") {
				setMessage(
					answer.refusal === "amount_over_refundable"
						? t("refund.over", { amount: formatVnd(answer.refundable ?? 0) })
						: t(`refund.refusal.${answer.refusal ?? "failed"}`),
				);
				return;
			}
			onDone(
				answer.order,
				t(answer.state === "pending" ? "refund.pending" : "refund.done", {
					amount: formatVnd(value),
				}),
			);
		} catch (error) {
			setMessage(
				t(
					error instanceof RpcError && error.network
						? "common.network"
						: "common.failed",
				),
			);
		} finally {
			setBusy(false);
		}
	};
	return (
		<Dialog
			title={t("refund.title", { order: order.display_no ?? "" })}
			onClose={onClose}
			closeLabel={t("common.close")}
			busy={busy}
			testId="refund-dialog"
			footer={
				<button
					type="button"
					className={button.destructive}
					disabled={!valid || busy}
					onClick={() => void submit()}
					data-testid="refund-submit"
				>
					{t("refund.confirm", { amount: formatVnd(value ?? 0) })}
				</button>
			}
		>
			<div className="flex flex-col gap-3">
				<p className="text-body">
					{t("refund.max", { amount: formatVnd(max) })}
				</p>
				<label className="flex flex-col gap-1">
					<span className="font-bold">{t("refund.amount")}</span>
					<input
						className={field}
						inputMode="numeric"
						value={amount}
						onChange={(event) => setAmount(event.target.value)}
						data-testid="refund-amount"
					/>
				</label>
				<label className="flex flex-col gap-1">
					<span className="font-bold">{t("refund.reason")}</span>
					<input
						className={field}
						maxLength={200}
						value={reason}
						onChange={(event) => setReason(event.target.value)}
						data-testid="refund-reason"
					/>
				</label>
				{shiftRefused ? (
					<div
						className="flex flex-wrap items-center gap-3 rounded-card-xl bg-warning-soft px-4 py-3"
						role="alert"
						data-testid="refund-need-shift"
					>
						<p className="min-w-0 flex-1 text-body text-ink">
							{t("refund.refusal.shift_required")}
						</p>
						<button
							type="button"
							className={button.secondary}
							onClick={goToShift}
							data-testid="refund-go-shift"
						>
							{t("pay.goToShift")}
						</button>
					</div>
				) : null}
				{message === null ? null : (
					<PlainNote tone="negative">{message}</PlainNote>
				)}
			</div>
		</Dialog>
	);
}
