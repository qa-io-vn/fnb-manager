import { Outlet } from "react-router-dom";
import { useT } from "../i18n";
import { TenantScopeProvider } from "../state/tenant-scope";
import { BottomNavigation, SideRail } from "./navigation";
import { ScopeGate } from "./scope-status";
import { TopBar } from "./top-bar";

export function AppShell() {
	const t = useT();
	return (
		<TenantScopeProvider>
			<div className="min-h-dvh lg:pl-52 print:min-h-0 print:pl-0">
				<button
					type="button"
					onClick={() => document.getElementById("main")?.focus()}
					className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-2 focus:z-50 focus:rounded focus:bg-surface-raised focus:px-3 focus:py-2"
				>
					{t("app.skipToContent")}
				</button>
				<TopBar />
				<SideRail />
				<main
					id="main"
					tabIndex={-1}
					className="mx-auto max-w-6xl px-4 pt-4 pb-24 outline-none lg:pb-10 print:max-w-none print:px-0 print:pb-0"
				>
					<ScopeGate>
						<Outlet />
					</ScopeGate>
				</main>
				<BottomNavigation />
			</div>
		</TenantScopeProvider>
	);
}
