import type { MiniAppRoute, MiniAppTab } from "@fnb/zalo-mini/react";
import type { ReactNode } from "react";
import { CustomerDataProvider } from "../data/customer-data";
import { OfflineNotice } from "../data/offline";
import { StoreLinkProvider } from "../data/store-link";
import { AccountIcon, HomeIcon } from "../icons";
import { lazyScreen } from "../lazy";
import { ActiveOrderStrip } from "./active-order-strip";
import { OrderingHomeScreen } from "./home-screen";
import { OrderingProvider } from "./ordering-data";
import { MenuIcon, StarIcon } from "./parts";
import { tableLinkFromEvent } from "./table-link";

// The shell of the ordering build (VITE_ORDERING=on; design spec 6.1): four tabs, Trang chủ · Thực đơn · Tích điểm ·
// Tôi, the ordering routes (flow routes hide the tabs), the loyalty routes that stay reachable, the table link opening
// the menu, and the active-order strip above the tabs. The build without the flag never loads this module.

const MenuScreen = lazyScreen(
	() => import("./menu-screen"),
	(m) => m.MenuScreen,
);
const ItemScreen = lazyScreen(
	() => import("./item-screen"),
	(m) => m.ItemScreen,
);
const CartScreen = lazyScreen(
	() => import("./cart-screen"),
	(m) => m.CartScreen,
);
const CheckoutScreen = lazyScreen(
	() => import("./checkout-screen"),
	(m) => m.CheckoutScreen,
);
const OrderScreen = lazyScreen(
	() => import("./order-screen"),
	(m) => m.OrderScreen,
);
const OrdersScreen = lazyScreen(
	() => import("./orders-screen"),
	(m) => m.OrdersScreen,
);
const PaymentScreen = lazyScreen(
	() => import("./payment-screen"),
	(m) => m.PaymentScreen,
);
const StampCardScreen = lazyScreen(
	() => import("./stamp-card-screen"),
	(m) => m.StampCardScreen,
);
const AccountScreen = lazyScreen(
	() => import("./account-screen"),
	(m) => m.OrderingAccountScreen,
);
const DataPolicyScreen = lazyScreen(
	() => import("./data-policy-screen"),
	(m) => m.DataPolicyScreen,
);
const MemberCodeScreen = lazyScreen(
	() => import("./member-code-screen"),
	(m) => m.OrderingMemberCodeScreen,
);
const WalletScreen = lazyScreen(
	() => import("../wallet/wallet-screen"),
	(m) => m.WalletScreen,
);
const StoreScreen = lazyScreen(
	() => import("../home/store-screen"),
	(m) => m.StoreScreen,
);
const JoinFlow = lazyScreen(
	() => import("../join/join-flow"),
	(m) => m.JoinFlow,
);
const ClaimScreen = lazyScreen(
	() => import("../claim/claim-form"),
	(m) => m.ClaimScreen,
);
const CounterClaimScreen = lazyScreen(
	() => import("../counter/counter-claim"),
	(m) => m.CounterClaimScreen,
);
const RewardsScreen = lazyScreen(
	() => import("../wallet/vouchers"),
	(m) => m.RewardsScreen,
);
const VouchersScreen = lazyScreen(
	() => import("../wallet/vouchers"),
	(m) => m.VouchersScreen,
);
const VoucherScreen = lazyScreen(
	() => import("../wallet/vouchers"),
	(m) => m.VoucherScreen,
);

// a screen pushed over the tabs shows no tab active, so every tab (Trang chủ too) opens its screen from it
export const orderingRoutes: readonly MiniAppRoute[] = [
	{ path: "/", element: <OrderingHomeScreen /> },
	{ path: "/thuc-don", element: <MenuScreen /> },
	{ path: "/the-thanh-vien", element: <StampCardScreen /> },
	{ path: "/tai-khoan", element: <AccountScreen /> },
	{ path: "/mon/:id", chrome: "flow", element: <ItemScreen /> },
	{ path: "/gio-hang", chrome: "flow", element: <CartScreen /> },
	{ path: "/dat-mon", chrome: "flow", element: <CheckoutScreen /> },
	{ path: "/don/:id", activeTab: null, element: <OrderScreen /> },
	{ path: "/don-hang", activeTab: null, element: <OrdersScreen /> },
	{ path: "/thanh-toan/:id", chrome: "flow", element: <PaymentScreen /> },
	{ path: "/du-lieu", chrome: "flow", element: <DataPolicyScreen /> },
	{ path: "/ma-thanh-vien", activeTab: null, element: <MemberCodeScreen /> },
	{ path: "/the-thanh-vien/diem", activeTab: null, element: <WalletScreen /> },
	// the loyalty routes the ordering build keeps as they are (the store page, joining, claims, rewards, vouchers)
	{ path: "/cua-hang/:code", activeTab: null, element: <StoreScreen /> },
	{ path: "/tham-gia", activeTab: null, element: <JoinFlow /> },
	{ path: "/nhan-diem", activeTab: null, element: <ClaimScreen /> },
	{ path: "/quet-ma-quay", activeTab: null, element: <CounterClaimScreen /> },
	{ path: "/doi-qua", activeTab: null, element: <RewardsScreen /> },
	{ path: "/vi-voucher", activeTab: null, element: <VouchersScreen /> },
	{ path: "/voucher/:id", activeTab: null, element: <VoucherScreen /> },
];

export const orderingTabs: readonly MiniAppTab[] = [
	{ path: "/", labelKey: "tab.home", icon: <HomeIcon /> },
	{ path: "/thuc-don", labelKey: "tab.menu", icon: <MenuIcon /> },
	{ path: "/the-thanh-vien", labelKey: "tab.stamps", icon: <StarIcon /> },
	{ path: "/tai-khoan", labelKey: "tab.me", icon: <AccountIcon /> },
];

/** A table's QR opens the menu of its table; any other store link opens the store page as before. */
function pathForLink(_link: unknown, data: unknown): string | null {
	return tableLinkFromEvent(data) === null ? null : "/thuc-don";
}

export function OrderingGate({ children }: { readonly children: ReactNode }) {
	return (
		<CustomerDataProvider>
			<StoreLinkProvider pathFor={pathForLink}>
				<OrderingProvider>
					<OfflineNotice />
					{children}
				</OrderingProvider>
			</StoreLinkProvider>
		</CustomerDataProvider>
	);
}

export const orderingAboveTabs: ReactNode = <ActiveOrderStrip />;

export { orderingCatalogs } from "./i18n/catalog";
