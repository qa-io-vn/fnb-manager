import { RestError } from "@fnb/zalo-mini";
import {
	isOnlineMethod,
	newIdempotencyKey,
	type Order,
	PAYMENT_POLL_MS,
	PaymentError,
	START_REFUSALS,
} from "@fnb/zalo-mini/ordering";
import { kitButton, PriceText, useI18n } from "@fnb/zalo-mini/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { Loading } from "../ui";
import { CounterSwitch } from "./counter-switch";
import { ONLINE_PAYMENT_ENABLED } from "./flag";
import { useOrdering } from "./ordering-data";
import { clock, FlowBack, Panel, Problem } from "./parts";
import {
	canRetry,
	type ResultHint,
	type ResultState,
	resultState,
} from "./payment-step";

// C11 Thanh toán chưa hoàn tất (design spec 6.2; online-ordering.md 6.6): the result of an online payment that did not
// complete, read from the order the server holds and asked again every 3 seconds while it waits: failed, no method
// chosen, still waiting for the result, expired when its window passed, cancelled. The payment step's hint (what
// Zalo's SDK said) only picks the words while the order still waits. "Thử lại" opens the attempt again (the pending
// one resumes; after a failure a new one starts, three at most) and goes back to the payment step; "Trả tại quầy"
// replaces a table order with the same order paid at the counter. No character on a payment problem; nothing here
// blames the customer.

export function hintFrom(state: unknown): ResultHint | null {
	if (typeof state !== "object" || state === null) return null;
	const hint = (state as { readonly hint?: unknown }).hint;
	return hint === "failed" || hint === "left" || hint === "unavailable"
		? hint
		: null;
}

type Retry =
	| { readonly state: "idle" }
	| { readonly state: "busy" }
	| { readonly state: "refused"; readonly refusal: string }
	| { readonly state: "error"; readonly network: boolean };

function bodyKey(state: ResultState, order: Order): string {
	switch (state) {
		case "failed":
		case "left": {
			// a takeaway is prepaid: its failed payment offers no "Trả tại quầy" (C17)
			const kind =
				state === "failed" && order.type === "takeaway"
					? "failedTakeaway"
					: state;
			return order.paymentDueAt === null
				? `pay.body.${kind}NoTime`
				: `pay.body.${kind}`;
		}
		case "expired":
			return order.paymentStatus === "unpaid"
				? "pay.body.expired"
				: "pay.body.expiredRefund";
		case "cancelled":
			return "pay.failed.body";
		default:
			return "pay.body.unknown";
	}
}

function refusalKey(refusal: string): string {
	return (START_REFUSALS as readonly string[]).includes(refusal) &&
		refusal !== "unknown_order" &&
		refusal !== "not_payable"
		? `pay.refusal.${refusal}`
		: "pay.refusal.other";
}

export function PaymentScreen() {
	const { t } = useI18n();
	const navigate = useNavigate();
	const location = useLocation();
	const { id } = useParams();
	const { client, payments } = useOrdering();
	const hint = hintFrom(location.state);
	const [order, setOrder] = useState<Order | null | "missing">(null);
	const [retry, setRetry] = useState<Retry>({ state: "idle" });
	const key = useRef(newIdempotencyKey());
	const titleRef = useRef<HTMLHeadingElement>(null);
	const reload = useCallback(() => {
		if (client === null || id === undefined) return;
		client.order(id).then(
			(answer) => setOrder(answer.state === "ok" ? answer.order : "missing"),
			(error: unknown) => {
				// a lost answer keeps what is shown; an id that is not an order's is an unknown order
				if (!(error instanceof RestError)) setOrder("missing");
				else setOrder((shown) => shown ?? "missing");
			},
		);
	}, [client, id]);
	useEffect(() => {
		reload();
	}, [reload]);
	const state =
		order === null || order === "missing" ? null : resultState(order, hint);
	const waiting =
		order !== null &&
		order !== "missing" &&
		order.status === "awaiting_payment";
	useEffect(() => {
		if (!waiting) return;
		const timer = setInterval(reload, PAYMENT_POLL_MS);
		return () => clearInterval(timer);
	}, [waiting, reload]);
	useEffect(() => {
		if (state === "accepted" && order !== null && order !== "missing")
			navigate(`/don/${order.id}`, { replace: true });
		else if (state !== null) titleRef.current?.focus();
	}, [state, order, navigate]);
	if (order === null) return <Loading />;
	if (order === "missing" || state === null || state === "accepted")
		return (
			<section className="flex flex-col gap-4 px-4 py-5">
				<FlowBack />
				<p className="text-body text-ink">{t("order.missing")}</p>
			</section>
		);
	const online = isOnlineMethod(order.paymentMethod);
	const retryable = ONLINE_PAYMENT_ENABLED && online && canRetry(order);
	const tryAgain = () => {
		if (payments === null || !isOnlineMethod(order.paymentMethod)) return;
		setRetry({ state: "busy" });
		payments
			.start({
				orderId: order.id,
				method: order.paymentMethod,
				idempotencyKey: key.current,
			})
			.then(
				(answer) => {
					if (answer.state === "pending") {
						navigate(`/tra-tien/${order.id}`, {
							replace: true,
							state: { attempt: answer.payment },
						});
						return;
					}
					setRetry({ state: "refused", refusal: answer.refusal });
					reload();
				},
				(error: unknown) =>
					setRetry({
						state: "error",
						network: error instanceof PaymentError && error.retryable,
					}),
			);
	};
	return (
		<section
			className="flex flex-col items-center gap-4 px-4 py-6 text-center"
			data-testid="payment-result"
			data-state={state}
		>
			<span
				aria-hidden="true"
				className={`flex size-18 items-center justify-center rounded-full text-2xl font-bold ${state === "unknown" ? "bg-neutral-soft text-ink" : "bg-negative-soft text-negative"}`}
			>
				{state === "unknown" ? "…" : "!"}
			</span>
			<h1
				ref={titleRef}
				tabIndex={-1}
				className="text-[22px] font-bold text-ink"
			>
				{t(`pay.title.${state}`)}
			</h1>
			<p role="alert" className="text-body text-ink" data-testid="payment-body">
				{t(bodyKey(state, order), {
					time: order.paymentDueAt === null ? "" : clock(order.paymentDueAt),
				})}
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
			{retry.state === "refused" || retry.state === "error" ? (
				<div className="w-full text-left">
					<Problem
						testId="payment-retry-problem"
						data={{
							refusal:
								retry.state === "refused"
									? retry.refusal
									: retry.network
										? "network"
										: "unknown",
						}}
					>
						{retry.state === "refused"
							? t(refusalKey(retry.refusal))
							: t(retry.network ? "pay.error.network" : "pay.error.other")}
					</Problem>
				</div>
			) : null}
			{online && canRetry(order) ? (
				<>
					<button
						type="button"
						className={`${kitButton.primary} w-full`}
						disabled={!retryable || retry.state === "busy"}
						aria-busy={retry.state === "busy"}
						aria-describedby={retryable ? undefined : "payment-retry-note"}
						onClick={tryAgain}
						data-testid="payment-retry"
					>
						{t("pay.retry")}
					</button>
					{retryable ? null : (
						<p id="payment-retry-note" className="text-[13px] text-ink">
							{t("pay.retryNotReady")}
						</p>
					)}
				</>
			) : null}
			<CounterSwitch
				order={order}
				onOrder={(cancelled) => setOrder(cancelled)}
			/>
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
