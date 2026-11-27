import { useI18n } from "@fnb/zalo-mini/i18n";
import {
	COUNTER_PAYMENT_POLL_MS,
	newIdempotencyKey,
	type PaymentAttempt,
	PaymentError,
} from "@fnb/zalo-mini/ordering";
import { PriceText } from "@fnb/zalo-mini/ui-kit";
import { useEffect, useRef, useState } from "react";
import { counterPaymentClient } from "../lib/payments";
import { useSession } from "../lib/session";
import { button, PlainNote } from "../ui/kit";
import { QrCode } from "../ui/qr";
import { orderDetail } from "./api";
import type { Order } from "./types";

// The VietQR tab of "Thu tiền" (Q01): checkout-order opens the counter's attempt for this counter order (`for:
// "counter"`, one idempotency key per code shown), the tablet shows the QR, the amount, the bank, the account and the
// reference with the time the code holds, and reads the order every 2 seconds. Only when the server says the order is
// paid (the bank reported the exact amount) it shows "Đã nhận tiền" and hands the order back. Closing the dialog leaves
// the attempt to expire; nothing here records a payment.

/** How long "Đã nhận tiền" stays before the dialog hands the paid order back. */
export const PAID_HOLD_MS = 1200;

type Phase =
	| { readonly kind: "starting" }
	| { readonly kind: "ready"; readonly attempt: PaymentAttempt }
	| { readonly kind: "paid"; readonly order: Order }
	| { readonly kind: "refused"; readonly refusal: string }
	| { readonly kind: "error"; readonly network: boolean };

const WORDED = new Set([
	"order_cancelled",
	"not_payable",
	"too_many_attempts",
	"not_awaiting_payment",
	"method_differs",
]);

function left(until: string, now: number): string {
	const seconds = Math.max(0, Math.floor((Date.parse(until) - now) / 1000));
	return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

export function VietQrPanel({
	order,
	onPaid,
	onUnavailable,
}: {
	readonly order: Order;
	readonly onPaid: (order: Order) => void;
	/** the store has no VietQR provider (provider_off): the tab goes */
	readonly onUnavailable: () => void;
}) {
	const { t } = useI18n();
	const { client, environment } = useSession();
	// the session's client and the function: read through refs, so only a new key, a retry or another order starts again
	const backend = useRef({
		client,
		payments: counterPaymentClient(environment, client),
	});
	if (backend.current.client !== client)
		backend.current = {
			client,
			payments: counterPaymentClient(environment, client),
		};
	const [phase, setPhase] = useState<Phase>({ kind: "starting" });
	// a new code gets a new key; a retry after a lost answer keeps the key, so it is the same attempt
	const [key, setKey] = useState(newIdempotencyKey);
	const [tries, setTries] = useState(0);
	const [now, setNow] = useState(() => Date.now());
	const paidHandled = useRef(false);
	const unavailable = useRef(onUnavailable);
	unavailable.current = onUnavailable;
	const paid = useRef(onPaid);
	paid.current = onPaid;

	useEffect(() => {
		void tries;
		let live = true;
		const { client, payments } = backend.current;
		setPhase({ kind: "starting" });
		payments
			.start({
				orderId: order.id,
				method: "vietqr",
				idempotencyKey: key,
				forCounter: true,
			})
			.then(
				async (answer) => {
					if (!live) return;
					if (answer.state === "pending") {
						setPhase({ kind: "ready", attempt: answer.payment });
						return;
					}
					if (answer.refusal === "provider_off") {
						unavailable.current();
						return;
					}
					if (answer.refusal === "already_paid") {
						const fresh = await orderDetail(client, order.id).catch(() => null);
						if (live && fresh !== null && fresh.payment_status === "paid") {
							setPhase({ kind: "paid", order: fresh });
							return;
						}
					}
					if (live) setPhase({ kind: "refused", refusal: answer.refusal });
				},
				(error: unknown) => {
					if (live)
						setPhase({
							kind: "error",
							network: error instanceof PaymentError && error.retryable,
						});
				},
			);
		return () => {
			live = false;
		};
	}, [order.id, key, tries]);

	// the order, every 2 seconds while the code is shown: only the server says paid
	const waiting = phase.kind === "ready";
	useEffect(() => {
		if (!waiting) return;
		let live = true;
		const timer = setInterval(() => {
			setNow(Date.now());
			orderDetail(backend.current.client, order.id).then(
				(fresh) => {
					if (!live) return;
					if (fresh.payment_status === "paid")
						setPhase({ kind: "paid", order: fresh });
					else if (fresh.status === "cancelled")
						setPhase({ kind: "refused", refusal: "order_cancelled" });
				},
				() => undefined,
			);
		}, COUNTER_PAYMENT_POLL_MS);
		const clock = setInterval(() => setNow(Date.now()), 1000);
		return () => {
			live = false;
			clearInterval(timer);
			clearInterval(clock);
		};
	}, [waiting, order.id]);

	useEffect(() => {
		if (phase.kind !== "paid" || paidHandled.current) return;
		paidHandled.current = true;
		const done = phase.order;
		const timer = setTimeout(() => paid.current(done), PAID_HOLD_MS);
		return () => clearTimeout(timer);
	}, [phase]);

	if (phase.kind === "starting")
		return (
			<p className="py-6 text-center text-ink-muted" role="status">
				{t("pay.qr.starting")}
			</p>
		);
	if (phase.kind === "paid")
		return (
			<div
				className="flex flex-col items-center gap-2 rounded-card-xl bg-positive-soft p-6 text-center"
				role="status"
				data-testid="vietqr-paid"
			>
				<p className="text-2xl font-extrabold">{t("pay.qr.paid")}</p>
				<PriceText amount={phase.order.total} size="lead" tone="ink" />
			</div>
		);
	if (phase.kind === "refused")
		return (
			<PlainNote tone="negative" testId="vietqr-refused">
				{t(
					WORDED.has(phase.refusal)
						? `pay.qr.refusal.${phase.refusal}`
						: "pay.qr.refusal.other",
				)}
			</PlainNote>
		);
	if (phase.kind === "error")
		return (
			<div className="flex flex-col gap-3">
				<PlainNote tone="negative" testId="vietqr-error">
					{t(phase.network ? "common.network" : "common.failed")}
				</PlainNote>
				<button
					type="button"
					className={button.secondary}
					onClick={() => setTries((count) => count + 1)}
					data-testid="vietqr-retry"
				>
					{t("pay.qr.retry")}
				</button>
			</div>
		);
	const { attempt } = phase;
	const qr = attempt.qr;
	if (qr === null) return null;
	const expired = Date.parse(attempt.expiresAt) <= now;
	return (
		<div
			className="flex flex-col gap-4 sm:flex-row sm:items-start"
			data-testid="vietqr"
			data-reference={attempt.reference}
		>
			<div className="flex flex-col items-center gap-2">
				<div className={expired ? "opacity-30" : undefined}>
					<QrCode
						payload={qr.payload}
						label={t("pay.qr.label")}
						size={240}
						testId="vietqr-code"
					/>
				</div>
				<p
					className="font-bold"
					data-testid="vietqr-countdown"
					data-expired={expired}
				>
					{expired
						? t("pay.qr.expired")
						: t("pay.qr.left", { time: left(attempt.expiresAt, now) })}
				</p>
				{expired ? (
					<button
						type="button"
						className={button.secondary}
						onClick={() => setKey(newIdempotencyKey())}
						data-testid="vietqr-new"
					>
						{t("pay.qr.new")}
					</button>
				) : null}
			</div>
			<div className="flex min-w-0 flex-1 flex-col gap-3">
				<p
					className="text-body font-bold"
					role="status"
					aria-live="polite"
					data-testid="vietqr-waiting"
				>
					{t("pay.qr.waiting")}
				</p>
				<dl className="flex flex-col gap-3">
					<div>
						<dt className="text-sm text-ink-muted">{t("pay.qr.amount")}</dt>
						<dd>
							<PriceText
								amount={qr.amount}
								size="lead"
								tone="ink"
								testId="vietqr-amount"
							/>
						</dd>
					</div>
					<div>
						<dt className="text-sm text-ink-muted">{t("pay.qr.reference")}</dt>
						<dd
							className="text-2xl font-extrabold tracking-wider break-all"
							data-testid="vietqr-reference"
						>
							{qr.reference}
						</dd>
					</div>
					<div>
						<dt className="text-sm text-ink-muted">{t("pay.qr.bank")}</dt>
						<dd className="font-bold">{qr.bankName}</dd>
					</div>
					<div>
						<dt className="text-sm text-ink-muted">{t("pay.qr.account")}</dt>
						<dd className="font-bold" data-testid="vietqr-account">
							{qr.accountNumber} · {qr.accountName}
						</dd>
					</div>
				</dl>
				{attempt.mode === "sandbox" ? (
					<p className="text-sm text-ink-muted" data-testid="vietqr-sandbox">
						{t("pay.qr.sandbox")}
					</p>
				) : null}
			</div>
		</div>
	);
}
