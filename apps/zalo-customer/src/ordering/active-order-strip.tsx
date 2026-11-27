import { useI18n } from "@fnb/zalo-mini/react";
import { useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { cartCount } from "./cart";
import { openOrders } from "./order-view";
import { useOrdering } from "./ordering-data";

// The active-order strip above the tabs (design spec 6.1): while an order is open it reads "Đơn #012 · Đang pha ·
// Xem" on every tab route and opens C06. It hides on the order's own screen, and on the menu while the basket bar
// shows (at most two bars at the bottom). It asks for the orders again every 20 seconds while one is open.

const STRIP_REFRESH_MS = 20_000;

function statusKey(status: string, paymentStatus: string): string {
	if (status === "accepted" && paymentStatus === "unpaid")
		return "strip.status.pay_at_counter";
	return `strip.status.${status}`;
}

export function ActiveOrderStrip() {
	const { t } = useI18n();
	const navigate = useNavigate();
	const location = useLocation();
	const { orders, reloadOrders, cart, store } = useOrdering();
	const open = orders.status === "ready" ? openOrders(orders.data.orders) : [];
	const latest = open[0] ?? null;
	useEffect(() => {
		if (latest === null) return;
		const timer = setInterval(reloadOrders, STRIP_REFRESH_MS);
		return () => clearInterval(timer);
	}, [latest, reloadOrders]);
	// a tab is opened again: the strip reads the orders again
	useEffect(() => {
		void location.pathname;
		reloadOrders();
	}, [location.pathname, reloadOrders]);
	if (latest === null) return null;
	if (location.pathname.startsWith("/don/")) return null;
	if (
		location.pathname === "/thuc-don" &&
		cart.store === store &&
		cartCount(cart) > 0
	)
		return null;
	const status = t(statusKey(latest.status, latest.paymentStatus));
	return (
		<div className="border-t border-line bg-surface-raised px-3 py-1.5">
			<button
				type="button"
				onClick={() => navigate(`/don/${latest.id}`)}
				className="flex min-h-11 w-full items-center justify-between gap-2 rounded-control bg-neutral-soft px-3 text-left text-[15px] text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
				data-testid="active-order-strip"
				data-order-id={latest.id}
				aria-label={t("strip.label", {
					number: latest.displayNo ?? "",
					status,
				})}
			>
				<span className="truncate">
					<span className="font-bold">{latest.displayNo ?? ""}</span> · {status}
				</span>
				<span className="font-bold text-ink">{t("strip.open")} ›</span>
			</button>
		</div>
	);
}
