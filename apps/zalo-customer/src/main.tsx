import config from "virtual:mini-app-config";
import { bootCustomerMiniApp, preloadLazyScreens } from "@fnb/zalo-mini/react";
import { aboveTabs, CustomerGate, routes, tabs } from "./app";
import { demoSessionClient } from "./data/source";
import { catalogs } from "./i18n/catalog";
import "./styles.css";

// VITE_ORDERING=on (tester builds only, ADR-058) boots the ordering shell instead; a build without the flag drops
// this branch and never holds the ordering screens (the build refuses one that does).
if (import.meta.env.VITE_ORDERING === "on") {
	void import("./ordering/ordering-app").then((ordering) => {
		bootCustomerMiniApp({
			config,
			catalogs: ordering.orderingCatalogs,
			routes: ordering.orderingRoutes,
			tabs: ordering.orderingTabs,
			standIn: demoSessionClient,
			gate: ordering.OrderingGate,
			aboveTabs: ordering.orderingAboveTabs,
		});
		preloadLazyScreens();
	});
} else {
	bootCustomerMiniApp({
		config,
		catalogs,
		routes,
		tabs,
		standIn: demoSessionClient,
		gate: CustomerGate,
		...(aboveTabs === null ? {} : { aboveTabs }),
	});

	preloadLazyScreens();
}
