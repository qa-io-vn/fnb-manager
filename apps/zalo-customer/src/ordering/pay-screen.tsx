import { RestError } from "@fnb/zalo-mini";
import {
	isOnlineMethod,
	newIdempotencyKey,
	type OnlinePaymentMethod,
	type Order,
	PAYMENT_POLL_MS,
	type PaymentAttempt,
	PaymentError,
	START_REFUSALS,
} from "@fnb/zalo-mini/ordering";
import { kitButton, PriceText, useI18n } from "@fnb/zalo-mini/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { useNow } from "../data/use-now";
import { Loading } from "../ui";
import { CounterSwitch } from "./counter-switch";
import { useOrdering } from "./ordering-data";
import { clock, FlowBack, Panel, Problem } from "./parts";
import { isStandInPort } from "./payment-port";
import {
	type PayView,
	payStepView,
	type SdkHint,
	type StartPhase,
	serverPayment,
} from "./payment-step";
import { StandInCheckoutSheet } from "./stand-in-sheet";
import { pickupPassed, pickupWords } from "./takeaway";
import { TransferPanel } from "./transfer-panel";

// The payment step of an online order (C05 → pay; native-till.md 6, online-ordering.md 6.2). It opens (or resumes) an
// attempt with checkout-order under one idempotency key, hands the wallet's signed parameters to Zalo's Checkout SDK
// and links Zalo's order id, or shows the transfer's QR (Zalo's popup first, inside Zalo). Then it only reads the
// order every 3 seconds: the order screen comes when the server accepted the order after the gateway or the bank
// reported the money, the result screen (C11) when the attempt failed, the customer left, or the time ran out. What
// the SDK says changes the words, never the state: a client that claims success still waits for the server.

/** A payment attempt handed over by the result screen's "Thử lại", for this order only. */
export function attemptFrom(
	state: unknown,
	orderId: string,
): PaymentAttempt | null {
	if (typeof state !== "object" || state === null) return null;
	const attempt = (state as { readonly attempt?: PaymentAttempt }).attempt;
	return attempt !== undefined &&
		attempt !== null &&
		attempt.orderId === orderId
		? attempt
		: null;
}

/** A signal aborted when the screen really goes (not by StrictMode's second mount in development). */
function useLeaving(): AbortSignal {
	const controller = useRef(new AbortController());
	const mounted = useRef(false);
	useEffect(() => {
		mounted.current = true;
		return () => {
			mounted.current = false;
			queueMicrotask(() => {
				if (!mounted.current) controller.current.abort();
			});
		};
	}, []);
	return controller.current.signal;
}

export function PayScreen() {
	const { t } = useI18n();
	const navigate = useNavigate();
	const location = useLocation();
	const { id = "" } = useParams();
	const { client, payments, checkout } = useOrdering();
	const leaving = useLeaving();
	const now = useNow(5000);
	const given = attemptFrom(location.state, id);
	const [order, setOrder] = useState<Order | null>(null);
	const [missing, setMissing] = useState(false);
	const [attempt, setAttempt] = useState<PaymentAttempt | null>(given);
	const [start, setStart] = useState<StartPhase>(
		given === null ? "starting" : "started",
	);
	const [refusal, setRefusal] = useState<string | null>(null);
	const [networkError, setNetworkError] = useState(false);
	const [sdk, setSdk] = useState<SdkHint>("none");
	const key = useRef(newIdempotencyKey());
	const requested = useRef(given !== null);
	const opened = useRef<string | null>(null);

	const reload = useCallback(() => {
		if (client === null || id === "") return;
		client.order(id).then(
			(answer) => {
				if (answer.state === "ok") setOrder(answer.order);
				else setMissing(true);
			},
			(error: unknown) => {
				// an id that is not an order's is an unknown order; a lost answer is asked again by the poll
				if (!(error instanceof RestError)) setMissing(true);
			},
		);
	}, [client, id]);

	const method: OnlinePaymentMethod =
		attempt?.method ??
		(order !== null && isOnlineMethod(order.paymentMethod)
			? order.paymentMethod
			: "zalo_checkout");
	const server =
		order === null ? null : serverPayment(order, attempt?.id ?? null);
	const view: PayView = payStepView({ method, server, start, sdk });
	const done = view.kind === "order" || view.kind === "result";

	useEffect(() => {
		reload();
	}, [reload]);
	useEffect(() => {
		if (done || missing) return;
		const timer = setInterval(reload, PAYMENT_POLL_MS);
		return () => clearInterval(timer);
	}, [done, missing, reload]);

	// the attempt: opened once the order is known to wait for its payment, under this screen's key
	useEffect(() => {
		if (
			requested.current ||
			payments === null ||
			order === null ||
			serverPayment(order) !== "pending" ||
			!isOnlineMethod(order.paymentMethod)
		)
			return;
		requested.current = true;
		setStart("starting");
		payments
			.start({
				orderId: order.id,
				method: order.paymentMethod,
				idempotencyKey: key.current,
			})
			.then(
				(answer) => {
					if (answer.state === "pending") {
						setAttempt(answer.payment);
						setStart("started");
						return;
					}
					setRefusal(answer.refusal);
					setStart("refused");
					reload();
				},
				(error: unknown) => {
					setNetworkError(error instanceof PaymentError && error.retryable);
					setStart("error");
				},
			);
	}, [payments, order, reload]);

	// Zalo's side of the attempt, once per attempt: the wallet's sheet or the transfer's popup
	useEffect(() => {
		if (
			attempt === null ||
			start !== "started" ||
			opened.current === attempt.id ||
			done
		)
			return;
		opened.current = attempt.id;
		const link = (platformOrderId: string | null) => {
			if (platformOrderId === null || payments === null) return;
			// lets the server ask Zalo again about a lost notification; the screen does not wait for it
			payments
				.link({
					orderId: attempt.orderId,
					paymentId: attempt.id,
					platformOrderId,
				})
				.catch(() => undefined);
		};
		void (async () => {
			if (attempt.checkout !== null) {
				const open = await checkout.openWallet(
					attempt.orderId,
					attempt.checkout,
				);
				if (open.kind !== "opened") {
					setSdk(open.kind === "failed" ? "failed" : "unavailable");
					return;
				}
				setSdk("opened");
				link(open.platformOrderId);
				const hint = await checkout.walletResult(open.platformOrderId, leaving);
				if (leaving.aborted) return;
				setSdk(
					hint === "paid" ? "claimed" : hint === "unknown" ? "opened" : hint,
				);
				return;
			}
			if (attempt.qr === null) return;
			const open = await checkout.openTransfer(attempt.orderId, attempt.qr);
			if (open.kind === "unavailable") {
				setSdk("unavailable");
				return;
			}
			link(open.platformOrderId);
			setSdk(open.kind === "paid" ? "claimed" : "closed");
		})();
	}, [attempt, start, done, checkout, payments, leaving]);

	// the step ends: the order screen once the server accepted the order, the result screen otherwise
	const leaveTo =
		view.kind === "order"
			? "order"
			: view.kind === "result"
				? (view.hint ?? "server")
				: null;
	useEffect(() => {
		if (leaveTo === null) return;
		if (leaveTo === "order") navigate(`/don/${id}`, { replace: true });
		else
			navigate(`/thanh-toan/${id}`, {
				replace: true,
				state: { hint: leaveTo === "server" ? null : leaveTo },
			});
	}, [leaveTo, id, navigate]);

	const again = () => {
		requested.current = false;
		setNetworkError(false);
		setRefusal(null);
		setStart("starting");
		reload();
	};

	if (missing)
		return (
			<section className="flex flex-col gap-4 px-4 py-5">
				<FlowBack />
				<p className="text-body text-ink">{t("order.missing")}</p>
			</section>
		);
	return (
		<section
			className="flex flex-col gap-4 px-4 py-5"
			data-testid="pay-step"
			data-view={view.kind}
			data-method={method}
		>
			<FlowBack to={`/don/${id}`} />
			<h1 className="text-xl font-bold text-ink">
				{t(`paystep.title.${method}`)}
			</h1>
			{order === null ? null : (
				<Panel testId="pay-summary">
					<div className="flex items-center justify-between gap-3">
						<span className="text-[13px] text-ink-muted">
							{t("paystep.amount")}
						</span>
						<PriceText amount={order.total} size="lead" testId="pay-amount" />
					</div>
					{order.paymentDueAt === null ? null : (
						<p className="text-[13px] text-ink" data-testid="pay-held">
							{t("paystep.heldUntil", { time: clock(order.paymentDueAt) })}
						</p>
					)}
					{order.type === "takeaway" && order.pickupAt !== null ? (
						<p className="text-[13px] text-ink" data-testid="pay-pickup">
							{t("paystep.pickupAt", {
								when: pickupWords(t, order.pickupAt, now),
							})}
						</p>
					) : null}
				</Panel>
			)}
			{order !== null && pickupPassed(order, now) && !done ? (
				<Problem testId="pay-pickup-passed">
					<span className="block">{t("paystep.pickupPassed")}</span>
					<button
						type="button"
						className={`${kitButton.secondary} mt-3 w-full`}
						onClick={() => navigate(`/gio-lay/${order.id}`)}
						data-testid="pay-pickup-choose"
					>
						{t("paystep.pickupChoose")}
					</button>
				</Problem>
			) : null}
			{view.kind === "starting" || done ? (
				<Loading label={t("paystep.starting")} />
			) : view.kind === "waiting" ? (
				<p
					role="status"
					className="text-body text-ink"
					data-testid="pay-waiting"
					data-note={view.note}
				>
					{t(`paystep.${view.note}`)}
				</p>
			) : view.kind === "transfer" && attempt?.qr ? (
				<TransferPanel
					qr={attempt.qr}
					expiresAt={attempt.expiresAt}
					mode={attempt.mode}
					claimed={view.claimed}
				/>
			) : view.kind === "refused" ? (
				<Problem testId="pay-refused" data={{ refusal: refusal ?? "unknown" }}>
					{t(
						refusal !== null &&
							(START_REFUSALS as readonly string[]).includes(refusal) &&
							refusal !== "unknown_order" &&
							refusal !== "not_payable"
							? `pay.refusal.${refusal}`
							: "pay.refusal.other",
					)}
				</Problem>
			) : view.kind === "error" ? (
				<Problem testId="pay-error" data={{ network: String(networkError) }}>
					<span className="block">
						{t(networkError ? "pay.error.network" : "pay.error.other")}
					</span>
					<button
						type="button"
						className={`${kitButton.secondary} mt-3 w-full`}
						onClick={again}
						data-testid="pay-again"
					>
						{t("pay.retry")}
					</button>
				</Problem>
			) : null}
			{order !== null &&
			(view.kind === "transfer" ||
				view.kind === "refused" ||
				view.kind === "error") ? (
				<CounterSwitch order={order} onOrder={setOrder} />
			) : null}
			<button
				type="button"
				className={`${kitButton.quiet} self-center`}
				onClick={() => navigate(`/don/${id}`)}
				data-testid="pay-to-order"
			>
				{t("pay.toOrder")}
			</button>
			{isStandInPort(checkout) ? (
				<StandInCheckoutSheet port={checkout} />
			) : null}
		</section>
	);
}
