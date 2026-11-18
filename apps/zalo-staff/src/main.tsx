import config from "virtual:mini-app-config";
import { bootMiniApp } from "@fnb/zalo-mini/react";
import { routes, standInMember, tabs } from "./app";
import { catalogs } from "./i18n/catalog";
import "./styles.css";

bootMiniApp({ config, catalogs, routes, tabs, standInMember });
