import config from "virtual:counter-config";
import { brandThemeCss } from "@fnb/zalo-mini/app-config";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app";
import { counterEnvironment } from "./env";
import { keepScreenOn } from "./lib/wake-lock";
import "./styles.css";

if (config.theme !== null) {
	const style = document.createElement("style");
	style.id = "fnb-brand-theme";
	style.textContent = brandThemeCss(config.theme);
	document.head.append(style);
}

const environment = counterEnvironment(import.meta.env, config.brand);
const root = document.getElementById("root");
if (root !== null) {
	createRoot(root).render(
		<StrictMode>
			<App environment={environment} />
		</StrictMode>,
	);
}

keepScreenOn();

if (import.meta.env.PROD && "serviceWorker" in navigator) {
	window.addEventListener("load", () => {
		navigator.serviceWorker.register("/sw.js").catch(() => undefined);
	});
}
