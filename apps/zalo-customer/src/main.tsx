import config from "virtual:mini-app-config";
import { bootCustomerMiniApp, preloadLazyScreens } from "@fnb/zalo-mini/react";
import {
	aboveTabs,
	CustomerGate,
	demoSessionClient,
	routes,
	tabs,
} from "./app";
import { catalogs } from "./i18n/catalog";
import "./styles.css";

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
