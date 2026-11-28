import { RestError } from "@fnb/zalo-mini";
import type {
	Menu,
	Order,
	OrderSummary,
	OrderType,
} from "@fnb/zalo-mini/ordering";
import {
	ChipGroup,
	kitButton,
	Popup,
	PriceText,
	StatusPill,
	type StatusPillTone,
	useI18n,
} from "@fnb/zalo-mini/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useCustomerData } from "../data/customer-data";
import { isoDateIn, shownDate } from "../data/dates";
import { useNow } from "../data/use-now";
import { Failed, Loading } from "../ui";
import { cartCount } from "./cart";
import { readyLine } from "./order-view";
import { useOrdering } from "./ordering-data";
import { ChevronRight, clock, Problem } from "./parts";
import {
	planReorder,
	type ReorderMode,
	type ReorderPlan,
	type ReorderReport,
	reportIsEmpty,
	reportOf,
	sameStore,
} from "./reorder";
import { ReorderReportNotice } from "./reorder-report";

// C14 Đơn đã đặt (design spec 6.2), reached from Tôi → Lịch sử đơn: the customer's orders, newest first, 20 a page,
// filtered by how they were served; each card opens C06 and offers "Đặt lại" (GA-073): the order's lines are read
// again (customer_order, the customer's own only) and made into a basket from the menu the store the app orders from
// answers now (customer_menu, read again for it), never with the order's prices. A basket that holds items asks first whether to replace it or add to it;
// an order of another store is refused in words. With something in the basket the customer lands on it (C04), told
// what could not be added; with nothing, the card says so.

type Filter = "all" | OrderType;

type Reorder =
	| { readonly state: "idle" }
	| { readonly state: "loading"; readonly orderId: string }
	| {
			readonly state: "problem";
			readonly orderId: string;
			readonly message: string;
	  }
	| {
			readonly state: "nothing";
			readonly orderId: string;
			readonly report: ReorderReport;
	  }
	| {
			readonly state: "ask";
			readonly orderId: string;
			readonly plan: ReorderPlan;
	  };

const IDLE: Reorder = { state: "idle" };

function statusOf(order: OrderSummary): {
	readonly key: string;
	readonly tone: StatusPillTone;
} {
	if (order.status === "cancelled")
		return order.paymentStatus === "refunded"
			? { key: "orders.state.refunded", tone: "negative" }
			: { key: "orders.state.cancelled", tone: "negative" };
	if (order.status === "completed")
		return { key: "orders.state.completed", tone: "positive" };
	if (order.status === "accepted" && order.paymentStatus === "unpaid")
		return { key: "orders.state.unpaid", tone: "warning" };
	return { key: `orders.state.${order.status}`, tone: "badge" };
}

function OrderCard({
	order,
	now,
	reorder,
	onReorder,
}: {
	readonly order: OrderSummary;
	readonly now: number;
	/** the state of "Đặt lại" when it concerns this order */
	readonly reorder: Reorder;
	readonly onReorder: (order: OrderSummary) => void;
}) {
	const { t } = useI18n();
	const navigate = useNavigate();
	const day = isoDateIn(Date.parse(order.placedAt));
	const date =
		day === isoDateIn(Date.now()) ? t("orders.today") : shownDate(day);
	// the date in the names carries the time, so two orders of one day are told apart
	const named = `${date} ${clock(order.placedAt)}`;
	const status = statusOf(order);
	const ready = readyLine(order, now);
	const busy = reorder.state === "loading";
	return (
		<li>
			<article
				aria-label={t("orders.card", { date: named, status: t(status.key) })}
				className="flex flex-col gap-2 rounded-card-2xl border-card border-line/60 bg-surface-raised p-4"
			>
				<button
					type="button"
					onClick={() => navigate(`/don/${order.id}`)}
					className="flex w-full items-center gap-3 rounded-card-xl text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
					data-testid="order-row"
					data-status={order.status}
					data-payment={order.paymentStatus}
					data-type={order.type}
					data-order-id={order.id}
				>
					<span className="flex min-w-0 flex-1 flex-col gap-1">
						<span className="flex items-center justify-between gap-2">
							<span className="text-[13px] text-ink-muted">
								{order.type === "table" && order.tableLabel !== null
									? t("orders.metaTable", { date, table: order.tableLabel })
									: order.pickupAt !== null
										? t("orders.metaTakeawayAt", {
												date,
												time: clock(order.pickupAt),
											})
										: t("orders.metaTakeaway", { date })}
							</span>
							<StatusPill tone={status.tone}>{t(status.key)}</StatusPill>
						</span>
						<span className="text-[15px] font-bold text-ink">
							{order.displayNo ?? ""} ·{" "}
							{t("orders.items", { count: order.items })}
						</span>
						{ready === null ? null : (
							<span
								className="text-[13px] text-ink"
								data-testid="order-row-ready"
								data-ready={ready.kind}
							>
								{ready.kind === "at"
									? t("orders.readyAt", { time: clock(ready.at) })
									: t("order.line.readySoon")}
							</span>
						)}
						<PriceText
							amount={order.total}
							size="list"
							testId="order-row-total"
						/>
					</span>
					<ChevronRight />
				</button>
				<div className="flex justify-end">
					{/* "+ Đặt lại": a pill drawn 36 tall with a 1.5 px accent edge, in a 44 target */}
					{/* not disabled while the order is read: the focus stays on it, and a second tap is ignored */}
					<button
						type="button"
						onClick={() => {
							if (!busy) onReorder(order);
						}}
						aria-busy={busy}
						aria-label={t("orders.reorderNamed", { date: named })}
						className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-control focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
						data-testid="order-row-reorder"
					>
						<span className="inline-flex h-9 items-center gap-1 rounded-control border-[1.5px] border-accent bg-surface-raised px-4 text-[15px] font-bold text-highlight">
							<span aria-hidden="true">+</span>
							{t("orders.reorder")}
						</span>
					</button>
				</div>
				{reorder.state === "problem" ? (
					<Problem testId="order-row-reorder-problem">
						{reorder.message}
					</Problem>
				) : null}
				{reorder.state === "nothing" ? (
					<ReorderReportNotice report={reorder.report} />
				) : null}
			</article>
		</li>
	);
}

export function OrdersScreen() {
	const { t } = useI18n();
	const navigate = useNavigate();
	const ordering = useOrdering();
	const { client, orders, reloadOrders, store, cart } = ordering;
	const { recover } = useCustomerData();
	const [filter, setFilter] = useState<Filter>("all");
	const [more, setMore] = useState<readonly OrderSummary[]>([]);
	const [next, setNext] = useState<string | null | undefined>(undefined);
	const [loadingMore, setLoadingMore] = useState(false);
	const [reorder, setReorder] = useState<Reorder>(IDLE);
	// the basket and the menu as they are when an order's answer comes back, not as they were at the tap
	const latest = useRef(ordering);
	latest.current = ordering;
	// an answer that comes back after the customer left the screen changes nothing
	const onScreen = useRef(true);
	useEffect(() => {
		onScreen.current = true;
		return () => {
			onScreen.current = false;
		};
	}, []);
	const now = useNow(30_000);
	useEffect(() => {
		reloadOrders();
	}, [reloadOrders]);
	const loadMore = useCallback(() => {
		const before =
			next === undefined
				? orders.status === "ready"
					? orders.data.nextBefore
					: null
				: next;
		if (client === null || before === null) return;
		setLoadingMore(true);
		client.orders(before).then(
			(page) => {
				setLoadingMore(false);
				setMore((known) => [...known, ...page.orders]);
				setNext(page.nextBefore);
			},
			(error: unknown) => {
				setLoadingMore(false);
				recover(error);
			},
		);
	}, [client, next, orders, recover]);

	const finish = useCallback(
		(orderId: string, plan: ReorderPlan, mode: ReorderMode) => {
			const report = latest.current.reorder(plan, mode);
			if (report === null) {
				setReorder({
					state: "problem",
					orderId,
					message: t("orders.reorderNoMenu"),
				});
				return;
			}
			setReorder(IDLE);
			navigate("/gio-hang", {
				state: reportIsEmpty(report) ? null : { reorder: report },
			});
		},
		[navigate, t],
	);

	const startReorder = useCallback(
		(summary: OrderSummary) => {
			if (client === null) return;
			const problem = (message: string) => {
				if (onScreen.current)
					setReorder({ state: "problem", orderId: summary.id, message });
			};
			if (store === null) {
				problem(t("orders.reorderNoMenu"));
				return;
			}
			setReorder({ state: "loading", orderId: summary.id });
			const planWith = (order: Order) => (menu: Menu) => {
				if (!onScreen.current) return;
				// a menu changed since the app read it: the app reads it again, so the basket checks against the same
				const known = latest.current.menu;
				if (
					known.status !== "ready" ||
					known.data.menuVersion !== menu.menuVersion
				)
					latest.current.reloadMenu();
				if (!sameStore(summary, menu)) {
					problem(
						t("orders.reorderOtherStore", {
							store: summary.storeName,
							current: menu.store.name,
						}),
					);
					return;
				}
				const plan = planReorder(order, menu);
				if (plan.lines.length === 0) {
					setReorder({
						state: "nothing",
						orderId: summary.id,
						report: reportOf(plan),
					});
					return;
				}
				const current = latest.current;
				if (
					current.cart.store === current.store &&
					current.cart.lines.length > 0
				) {
					setReorder({ state: "ask", orderId: summary.id, plan });
					return;
				}
				finish(summary.id, plan, "replace");
			};
			client.order(summary.id).then(
				(answer) => {
					if (answer.state !== "ok") {
						problem(t("order.missing"));
						return;
					}
					// the menu as the store answers it at this moment (what is sold, at what price), not the last one read
					client
						.menu(store, null)
						.then(planWith(answer.order), (error: unknown) => {
							recover(error);
							problem(t("orders.reorderNoMenu"));
						});
				},
				(error: unknown) => {
					if (error instanceof Error && !(error instanceof RestError)) {
						// an id that is not an order's: the same as an unknown order
						problem(t("order.missing"));
						return;
					}
					recover(error);
					problem(t("orders.reorderFailed"));
				},
			);
		},
		[client, store, t, recover, finish],
	);

	if (orders.status === "loading") return <Loading />;
	if (orders.status === "failed")
		return <Failed failure={orders.failure} onRetry={reloadOrders} />;
	const all = [...orders.data.orders, ...more];
	const shown = all.filter(
		(order) => filter === "all" || order.type === filter,
	);
	const hasMore = (next === undefined ? orders.data.nextBefore : next) !== null;
	return (
		<section className="flex flex-col gap-3 py-4" data-testid="orders">
			<h1 className="px-4 text-xl font-bold text-ink">{t("orders.title")}</h1>
			<ChipGroup
				label={t("orders.filters")}
				chips={(["all", "table", "takeaway"] as const).map((key) => ({
					key,
					label: t(`orders.filter.${key}`),
				}))}
				selected={filter}
				onSelect={(key) => setFilter(key as Filter)}
				testId="orders-filter"
			/>
			{shown.length === 0 ? (
				<div
					className="flex flex-col items-center gap-3 px-4 py-8 text-center"
					data-testid="orders-empty"
				>
					<h2 className="text-xl font-bold text-ink">
						{t("orders.empty.title")}
					</h2>
					<p className="text-body text-ink-muted">{t("orders.empty.body")}</p>
					<button
						type="button"
						className={`${kitButton.primary} w-full`}
						onClick={() => navigate("/thuc-don")}
					>
						{t("order.toMenu")}
					</button>
				</div>
			) : (
				<ul className="flex flex-col gap-2 px-4">
					{shown.map((order) => (
						<OrderCard
							key={order.id}
							order={order}
							now={now}
							reorder={
								reorder.state !== "idle" && reorder.orderId === order.id
									? reorder
									: IDLE
							}
							onReorder={startReorder}
						/>
					))}
				</ul>
			)}
			{hasMore ? (
				<button
					type="button"
					className={`${kitButton.secondary} mx-4`}
					onClick={loadMore}
					disabled={loadingMore}
					data-testid="orders-more"
				>
					{t("orders.more")}
				</button>
			) : null}
			{reorder.state === "ask" ? (
				<Popup
					title={t("orders.reorderAsk.title")}
					onClose={() => setReorder(IDLE)}
					testId="orders-reorder-ask"
				>
					<div className="flex flex-col gap-3">
						<p className="text-body text-ink">
							{t("orders.reorderAsk.body", { count: cartCount(cart) })}
						</p>
						<button
							type="button"
							className={`${kitButton.primary} w-full`}
							onClick={() => finish(reorder.orderId, reorder.plan, "add")}
							data-testid="orders-reorder-add"
						>
							{t("orders.reorderAsk.add")}
						</button>
						<button
							type="button"
							className={`${kitButton.secondary} w-full`}
							onClick={() => finish(reorder.orderId, reorder.plan, "replace")}
							data-testid="orders-reorder-replace"
						>
							{t("orders.reorderAsk.replace")}
						</button>
					</div>
				</Popup>
			) : null}
		</section>
	);
}
