import type { Order } from "@fnb/zalo-mini/ordering";
import { kitButton, PriceText, useI18n } from "@fnb/zalo-mini/react";
import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Loading } from "../ui";
import { useOrdering } from "./ordering-data";
import { FlowBack, Panel } from "./parts";

// C11 Thanh toán thất bại (design spec 6.2; online payment, plan 31): the result of an online payment that did not
// complete, read from the order the server holds: failed, cancelled, unknown while it still waits, expired when its
// window passed. No character on a payment problem. "Thử lại" stays disabled until online payment exists; until
// then no order reaches this screen from the app, and the order screen is where every order is followed.

export type PaymentState =
	| "failed"
	| "cancelled"
	| "unknown"
	| "expired"
	| "paid";

export function paymentState(order: Order): PaymentState {
	if (order.paymentStatus !== "unpaid") return "paid";
	if (order.status === "cancelled")
		return order.cancelReason === "payment_timeout" ? "expired" : "cancelled";
	const attempts = order.money?.payments ?? [];
	const last = attempts[attempts.length - 1];
	if (last?.status === "failed") return "failed";
	return order.status === "awaiting_payment" ? "unknown" : "paid";
}

export function PaymentScreen() {
	const { t } = useI18n();
	const navigate = useNavigate();
	const { id } = useParams();
	const { client } = useOrdering();
	const [order, setOrder] = useState<Order | null | "missing">(null);
	const titleRef = useRef<HTMLHeadingElement>(null);
	useEffect(() => {
		if (client === null || id === undefined) return;
		client.order(id).then(
			(answer) => setOrder(answer.state === "ok" ? answer.order : "missing"),
			() => setOrder("missing"),
		);
	}, [client, id]);
	const state =
		order === null || order === "missing" ? null : paymentState(order);
	useEffect(() => {
		if (state === "paid" && order !== null && order !== "missing")
			navigate(`/don/${order.id}`, { replace: true });
		else if (state !== null) titleRef.current?.focus();
	}, [state, order, navigate]);
	if (order === null) return <Loading />;
	if (order === "missing" || state === null || state === "paid")
		return (
			<section className="flex flex-col gap-4 px-4 py-5">
				<FlowBack />
				<p className="text-body text-ink">{t("order.missing")}</p>
			</section>
		);
	return (
		<section
			className="flex flex-col items-center gap-4 px-4 py-6 text-center"
			data-testid="payment-result"
			data-state={state}
		>
			<span
				aria-hidden="true"
				className="flex size-18 items-center justify-center rounded-full bg-negative-soft text-2xl font-bold text-negative"
			>
				!
			</span>
			<h1
				ref={titleRef}
				tabIndex={-1}
				className="text-[22px] font-bold text-ink"
			>
				{t("pay.failed.title")}
			</h1>
			<p role="alert" className="text-body text-ink">
				{state === "expired"
					? t("pay.expired")
					: state === "unknown"
						? t("pay.unknown")
						: t("pay.failed.body")}
			</p>
			<Panel testId="payment-detail" className="w-full text-left">
				<dl className="flex flex-col gap-2">
					<div className="flex justify-between gap-3">
						<dt className="text-[13px] text-ink-muted">
							{t("pay.detail.order")}
						</dt>
						<dd className="text-[15px] text-ink">
							{[order.displayNo, order.tableLabel]
								.filter((part) => part !== null)
								.join(" · ")}
						</dd>
					</div>
					<div className="flex justify-between gap-3">
						<dt className="text-[13px] text-ink-muted">
							{t("pay.detail.amount")}
						</dt>
						<dd>
							<PriceText amount={order.total} tone="ink" />
						</dd>
					</div>
					<div className="flex justify-between gap-3">
						<dt className="text-[13px] text-ink-muted">
							{t("pay.detail.method")}
						</dt>
						<dd className="text-[15px] text-ink">
							{t(`pay.method.${order.paymentMethod}`)}
						</dd>
					</div>
					<div className="flex justify-between gap-3">
						<dt className="text-[13px] text-ink-muted">
							{t("pay.detail.reason")}
						</dt>
						<dd className="text-[15px] text-ink">{t(`pay.reason.${state}`)}</dd>
					</div>
				</dl>
			</Panel>
			<button
				type="button"
				className={`${kitButton.primary} w-full`}
				disabled
				data-testid="payment-retry"
				aria-describedby="payment-retry-note"
			>
				{t("pay.retry")}
			</button>
			<p id="payment-retry-note" className="text-[13px] text-ink">
				{t("pay.retryNotReady")}
			</p>
			<button
				type="button"
				className={`${kitButton.secondary} w-full`}
				onClick={() => navigate(`/don/${order.id}`)}
				data-testid="payment-to-order"
			>
				{t("pay.toOrder")}
			</button>
		</section>
	);
}
