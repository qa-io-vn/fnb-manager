import type { OrderSummary, OrderType } from "@fnb/zalo-mini/ordering";
import {
	ChipGroup,
	kitButton,
	PriceText,
	StatusPill,
	type StatusPillTone,
	useI18n,
} from "@fnb/zalo-mini/react";
import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useCustomerData } from "../data/customer-data";
import { isoDateIn, shownDate } from "../data/dates";
import { Failed, Loading } from "../ui";
import { useOrdering } from "./ordering-data";
import { ChevronRight } from "./parts";

// C14 Đơn đã đặt (design spec 6.2), reached from Tôi → Lịch sử đơn: the customer's orders, newest first, 20 a page,
// filtered by how they were served; each opens C06. "Đặt lại" is the owner's phase 2 and is not here.

type Filter = "all" | OrderType;

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

function OrderCard({ order }: { readonly order: OrderSummary }) {
	const { t } = useI18n();
	const navigate = useNavigate();
	const day = isoDateIn(Date.parse(order.placedAt));
	const date =
		day === isoDateIn(Date.now()) ? t("orders.today") : shownDate(day);
	const status = statusOf(order);
	return (
		<li>
			<button
				type="button"
				onClick={() => navigate(`/don/${order.id}`)}
				className="flex w-full items-center gap-3 rounded-card-2xl border-card border-line/60 bg-surface-raised p-4 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
				data-testid="order-row"
				data-status={order.status}
				data-order-id={order.id}
			>
				<span className="flex min-w-0 flex-1 flex-col gap-1">
					<span className="flex items-center justify-between gap-2">
						<span className="text-[13px] text-ink-muted">
							{order.type === "table" && order.tableLabel !== null
								? t("orders.metaTable", { date, table: order.tableLabel })
								: t("orders.metaTakeaway", { date })}
						</span>
						<StatusPill tone={status.tone}>{t(status.key)}</StatusPill>
					</span>
					<span className="text-[15px] font-bold text-ink">
						{order.displayNo ?? ""} ·{" "}
						{t("orders.items", { count: order.items })}
					</span>
					<PriceText
						amount={order.total}
						size="list"
						testId="order-row-total"
					/>
				</span>
				<ChevronRight />
			</button>
		</li>
	);
}

export function OrdersScreen() {
	const { t } = useI18n();
	const navigate = useNavigate();
	const { client, orders, reloadOrders } = useOrdering();
	const { recover } = useCustomerData();
	const [filter, setFilter] = useState<Filter>("all");
	const [more, setMore] = useState<readonly OrderSummary[]>([]);
	const [next, setNext] = useState<string | null | undefined>(undefined);
	const [loadingMore, setLoadingMore] = useState(false);
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
						<OrderCard key={order.id} order={order} />
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
		</section>
	);
}
