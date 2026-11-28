import { RestError } from "@fnb/zalo-mini";
import { ORDER_POLL_MS, type Order } from "@fnb/zalo-mini/ordering";
import { kitButton, Popup, PriceText, useI18n } from "@fnb/zalo-mini/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useCustomerData } from "../data/customer-data";
import { useNow } from "../data/use-now";
import { Failed, Loading } from "../ui";
import { ONLINE_PAYMENT_ENABLED } from "./flag";
import { InvoiceEntryCard } from "./invoice-entry";
import {
	callWaiting,
	canCancel,
	etaMinutes,
	isLate,
	isTerminal,
	orderStage,
	readyLine,
	timelineSteps,
} from "./order-view";
import { useOrdering } from "./ordering-data";
import { BellIcon, CheckIcon, clock, Notice, Panel, Problem } from "./parts";
import { pickupWords } from "./takeaway";

// C06 Đơn của bạn (design spec 6.2): the order's state from the server, asked every 3 seconds while the screen is on
// show and the order is not finished, the timeline with the time of each step, the lines and the total, "Gọi nhân
// viên" for a table order (once every two minutes) and "Gọi thêm" for a new order at the same table. Another
// customer's order answers as an unknown one, and the screen says only that it was not found.

type OrderLoad =
	| { readonly status: "loading" }
	| { readonly status: "ready"; readonly order: Order }
	| { readonly status: "missing" }
	| { readonly status: "failed" };

type CallState =
	| { readonly state: "idle" }
	| { readonly state: "sending" }
	| { readonly state: "sent"; readonly at: string }
	| { readonly state: "refused"; readonly key: string };

function useOrder(id: string | undefined): {
	readonly load: OrderLoad;
	readonly reload: () => void;
	readonly replace: (order: Order) => void;
} {
	const { client } = useOrdering();
	const { recover } = useCustomerData();
	const [load, setLoad] = useState<OrderLoad>({ status: "loading" });
	const generation = useRef(0);
	const reload = useCallback(() => {
		if (client === null || id === undefined) return;
		generation.current += 1;
		const current = generation.current;
		client.order(id).then(
			(answer) => {
				if (generation.current !== current) return;
				setLoad(
					answer.state === "ok"
						? { status: "ready", order: answer.order }
						: { status: "missing" },
				);
			},
			(error: unknown) => {
				if (generation.current !== current) return;
				if (error instanceof Error && !(error instanceof RestError)) {
					// an id that is not an order's (a hand-made link): the same as an unknown order
					setLoad({ status: "missing" });
					return;
				}
				recover(error);
				setLoad((previous) =>
					previous.status === "ready" ? previous : { status: "failed" },
				);
			},
		);
	}, [client, id, recover]);
	useEffect(() => {
		reload();
	}, [reload]);
	const finished = load.status === "ready" && isTerminal(load.order);
	useEffect(() => {
		if (load.status !== "ready" || finished) return;
		const timer = setInterval(reload, ORDER_POLL_MS);
		return () => clearInterval(timer);
	}, [load.status, finished, reload]);
	const replace = useCallback(
		(order: Order) => setLoad({ status: "ready", order }),
		[],
	);
	return { load, reload, replace };
}

function StatusCard({
	order,
	now,
}: {
	readonly order: Order;
	readonly now: number;
}) {
	const { t } = useI18n();
	const stage = orderStage(order);
	const number = order.displayNo ?? "";
	const eta = etaMinutes(order, now);
	const ready = readyLine(order, now);
	const headline =
		stage === "serving"
			? order.tableLabel === null
				? t("order.stage.serving_noTable")
				: t("order.stage.serving", { table: order.tableLabel })
			: stage === "ready"
				? t("order.stage.ready", { number })
				: t(`order.stage.${stage}`);
	return (
		<Panel testId="order-status">
			{number === "" ? null : (
				<p
					className="text-xs font-bold tracking-[0.12em] text-highlight uppercase"
					data-testid="order-number"
				>
					{t("order.kicker", { number })}
				</p>
			)}
			<h1
				aria-live="polite"
				className="text-[19px] font-bold leading-snug text-ink"
				data-testid="order-headline"
			>
				{headline}
			</h1>
			{order.type === "takeaway" ? (
				<p
					className="text-[15px] font-bold text-ink"
					data-testid="order-pickup"
					data-at={order.pickupAt ?? ""}
				>
					{order.pickupAt === null
						? t("order.pickupSoon")
						: t("order.pickupAt", {
								when: pickupWords(t, order.pickupAt, now),
							})}
				</p>
			) : null}
			{order.scheduled && order.startAt !== null ? (
				<p className="text-[13px] text-ink" data-testid="order-pickup-start">
					{t("order.pickupStart", { time: clock(order.startAt) })}
				</p>
			) : null}
			{stage === "pay_at_counter" ? (
				<p className="text-[13px] text-ink">{t("order.line.pay_at_counter")}</p>
			) : stage === "preparing" && order.paymentStatus === "unpaid" ? (
				<p className="text-[13px] text-ink" data-testid="order-unpaid">
					{t("order.line.unpaid")}
				</p>
			) : (stage === "accepted" || stage === "preparing") &&
				ready !== null &&
				eta !== null ? (
				<p
					className="text-[13px] text-ink"
					data-testid="order-eta"
					data-ready={ready.kind}
				>
					{ready.kind === "at"
						? t("order.line.readyAt", {
								time: clock(ready.at),
								minutes: eta,
							})
						: t("order.line.readySoon")}
				</p>
			) : stage === "completed" ? (
				<p className="text-[15px] text-ink" data-testid="order-thanks">
					{t("order.thanks")}
				</p>
			) : stage === "cancelled" ? (
				<div className="flex flex-col gap-1" data-testid="order-cancelled">
					{order.cancelReason === null ? null : (
						<p className="text-[13px] text-ink">
							{t(
								[
									"customer_cancelled",
									"payment_timeout",
									"item_unavailable",
									"store_busy",
									"closing_soon",
								].includes(order.cancelReason)
									? `order.cancelReason.${order.cancelReason}`
									: "order.cancelReason.other",
							)}
						</p>
					)}
					<p className="text-[13px] text-ink">
						{t(
							order.paymentStatus === "unpaid"
								? "order.cancelled.notCharged"
								: "order.cancelled.refund",
						)}
					</p>
				</div>
			) : (
				<p className="text-[13px] text-ink-muted">
					{t("order.line.updated", {
						time: clock(
							order.timeline[order.timeline.length - 1]?.at ?? order.placedAt,
						),
					})}
				</p>
			)}
		</Panel>
	);
}

function Steps({ order }: { readonly order: Order }) {
	const { t } = useI18n();
	const steps = timelineSteps(order);
	return (
		<Panel testId="order-steps-card">
			<h2 className="sr-only">{t("order.steps")}</h2>
			<ol className="flex flex-col gap-3" data-testid="order-steps">
				{steps.map((step) => {
					const label =
						step.key === "serving"
							? order.tableLabel === null
								? t("order.step.serving_noTable")
								: t("order.step.serving", { table: order.tableLabel })
							: t(`order.step.${step.key}`);
					return (
						<li
							key={step.key}
							className="flex items-start gap-3"
							data-testid="order-step"
							data-step={step.key}
							data-state={step.state}
							aria-current={step.state === "current" ? "step" : undefined}
						>
							<span
								aria-hidden="true"
								className={`flex size-7 shrink-0 items-center justify-center rounded-full border-2 ${step.state === "done" ? "border-positive bg-positive text-surface-raised" : step.state === "current" ? "border-accent bg-surface-raised" : "border-line-strong bg-surface-raised"}`}
							>
								{step.state === "done" ? <CheckIcon /> : null}
							</span>
							<span className="flex flex-col">
								<span
									className={`text-[15px] ${step.state === "todo" ? "text-ink-muted" : "font-bold text-ink"}`}
								>
									{label}
								</span>
								{step.at === null ? null : (
									<span className="text-[13px] text-ink-muted">
										{clock(step.at)}
									</span>
								)}
							</span>
						</li>
					);
				})}
			</ol>
		</Panel>
	);
}

function Lines({ order }: { readonly order: Order }) {
	const { t } = useI18n();
	return (
		<Panel testId="order-lines">
			<h2 className="sr-only">{t("order.lines")}</h2>
			<ul className="flex flex-col gap-2">
				{order.lines.map((line) => (
					<li
						key={line.lineNo}
						className="flex items-start justify-between gap-3"
						data-testid="order-line"
					>
						<span className="min-w-0 text-body text-ink">
							{line.itemName}
							{line.sizeLabel === null ? "" : ` (${line.sizeLabel})`}{" "}
							{t("order.lineQuantity", { qty: line.quantity })}
							{line.options.length === 0 ? null : (
								<span className="block text-[13px] text-ink-muted">
									{line.options.map((option) => option.name).join(" · ")}
								</span>
							)}
							{line.note === null ? null : (
								<span
									className="block text-[13px] text-ink break-words"
									data-testid="order-line-note"
								>
									{line.note}
								</span>
							)}
						</span>
						<PriceText amount={line.lineTotal} tone="ink" />
					</li>
				))}
			</ul>
			<div className="flex items-center justify-between border-t border-line pt-3">
				<span className="text-[15px] font-bold text-ink">
					{t("order.total")}
				</span>
				<PriceText amount={order.total} size="list" testId="order-total" />
			</div>
		</Panel>
	);
}

function Actions({
	order,
	now,
}: {
	readonly order: Order;
	readonly now: number;
}) {
	const { t } = useI18n();
	const navigate = useNavigate();
	const { client, table, store } = useOrdering();
	const [call, setCall] = useState<CallState>({ state: "idle" });
	const token =
		table?.state === "ok" && table.store === store ? table.token : null;
	const waiting =
		call.state === "sent" && callWaiting(Date.parse(call.at), now);
	const callStaff = () => {
		if (client === null || store === null) return;
		if (token === null) {
			setCall({ state: "refused", key: "order.call.noTable" });
			return;
		}
		setCall({ state: "sending" });
		client.callStaff(store, token).then(
			(answer) =>
				setCall(
					answer.state === "calling"
						? { state: "sent", at: answer.calledAt }
						: {
								state: "refused",
								key:
									answer.refusal === "rate_limited"
										? "order.call.tooSoon"
										: "order.call.noTable",
							},
				),
			() => setCall({ state: "refused", key: "order.call.failed" }),
		);
	};
	const tableOrder = order.type === "table";
	return (
		<div className="flex flex-col gap-2">
			{call.state === "sent" ? (
				<p
					role="status"
					className="text-body text-ink"
					data-testid="order-call-sent"
				>
					{t("order.callSent")}
				</p>
			) : call.state === "refused" ? (
				<p
					role="alert"
					className="text-body text-ink"
					data-testid="order-call-refused"
				>
					{t(call.key)}
				</p>
			) : null}
			<div className="flex gap-2">
				{tableOrder &&
				order.status !== "completed" &&
				order.status !== "cancelled" ? (
					<button
						type="button"
						className={`${kitButton.secondary} flex-1`}
						onClick={callStaff}
						disabled={call.state === "sending" || waiting}
						data-testid="order-call"
						data-state={
							waiting ? "wait" : call.state === "sent" ? "sent" : "idle"
						}
					>
						<BellIcon />
						{waiting && call.state === "sent"
							? t("order.callWait", { time: clock(call.at) })
							: t("order.call")}
					</button>
				) : null}
				<button
					type="button"
					className={`${kitButton.primary} flex-1`}
					onClick={() => navigate("/thuc-don")}
					data-testid="order-again"
				>
					{t("order.again")}
				</button>
			</div>
		</div>
	);
}

function CancelControl({
	order,
	onCancelled,
}: {
	readonly order: Order;
	readonly onCancelled: (order: Order) => void;
}) {
	const { t } = useI18n();
	const { client, reloadOrders } = useOrdering();
	const [asking, setAsking] = useState(false);
	const [refusal, setRefusal] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);
	if (!canCancel(order) && refusal === null) return null;
	const cancel = () => {
		if (client === null) return;
		setBusy(true);
		client.cancelOrder(order.id).then(
			(answer) => {
				setBusy(false);
				setAsking(false);
				if (answer.state === "cancelled") {
					onCancelled(answer.order);
					reloadOrders();
				} else {
					setRefusal(answer.refusal);
				}
			},
			() => {
				setBusy(false);
				setRefusal("network");
			},
		);
	};
	return (
		<>
			{refusal === null ? null : (
				<Problem testId="order-cancel-refused">
					{refusal === "network"
						? t("customer.error.network")
						: t(
								refusal === "contact_store"
									? "order.cancelRefused.contact_store"
									: "order.cancelRefused.not_allowed",
							)}
				</Problem>
			)}
			{canCancel(order) ? (
				<button
					type="button"
					className={`${kitButton.quiet} self-start`}
					onClick={() => setAsking(true)}
					data-testid="order-cancel"
				>
					{t("order.cancel")}
				</button>
			) : null}
			{asking ? (
				<Popup
					title={t("order.cancelConfirm", { number: order.displayNo ?? "" })}
					onClose={() => setAsking(false)}
					testId="order-cancel-confirm"
				>
					<div className="flex flex-col gap-3">
						<p className="text-body text-ink">{t("order.cancelBody")}</p>
						<button
							type="button"
							className={`${kitButton.danger} w-full`}
							onClick={cancel}
							disabled={busy}
							aria-busy={busy}
							data-testid="order-cancel-yes"
						>
							{t("order.cancel")}
						</button>
						<button
							type="button"
							className={`${kitButton.secondary} w-full`}
							onClick={() => setAsking(false)}
						>
							{t("order.cancelKeep")}
						</button>
					</div>
				</Popup>
			) : null}
		</>
	);
}

export function OrderScreen() {
	const { t } = useI18n();
	const navigate = useNavigate();
	const { id } = useParams();
	const { load, reload, replace } = useOrder(id);
	const now = useNow(1000);
	if (load.status === "loading") return <Loading />;
	if (load.status === "failed")
		return <Failed failure="network" onRetry={reload} />;
	if (load.status === "missing")
		return (
			<section
				className="flex flex-col gap-4 px-4 py-5"
				data-testid="order-missing"
			>
				<Problem testId="order-missing-note">{t("order.missing")}</Problem>
				<button
					type="button"
					className={`${kitButton.primary} w-full`}
					onClick={() => navigate("/don-hang")}
				>
					{t("order.toOrders")}
				</button>
			</section>
		);
	const order = load.order;
	return (
		<section
			className="flex flex-col gap-4 px-4 py-5"
			data-testid="order"
			data-status={order.status}
			data-payment={order.paymentStatus}
		>
			<StatusCard order={order} now={now} />
			{order.status === "awaiting_payment" && ONLINE_PAYMENT_ENABLED ? (
				<button
					type="button"
					className={`${kitButton.primary} w-full`}
					onClick={() => navigate(`/tra-tien/${order.id}`)}
					data-testid="order-pay"
				>
					{t("order.payNow")}
				</button>
			) : null}
			{isLate(order, now) ? (
				<Notice testId="order-late">{t("order.late")}</Notice>
			) : null}
			<CancelControl order={order} onCancelled={replace} />
			<Steps order={order} />
			<Lines order={order} />
			<InvoiceEntryCard order={order} />
			<Actions order={order} now={now} />
		</section>
	);
}
