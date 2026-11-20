import config from "virtual:mini-app-config";
import { bootMiniApp, preloadLazyScreens } from "@fnb/zalo-mini/react";
import { EntryGate, routes, standInMemberFrom, tabs } from "./app";
import { catalogs } from "./i18n/catalog";
import "./styles.css";

bootMiniApp({
	config,
	catalogs,
	routes,
	tabs,
	standInMember: standInMemberFrom(window.location.search),
	onboarding: true,
	gate: EntryGate,
});

preloadLazyScreens();
