import { Navigate } from "react-router-dom";
import { useAppMode } from "../app-mode/app-mode";
import { useT } from "../i18n";
import { AppShell } from "../shell/app-shell";
import { useSession } from "./session";

export function ProtectedShell() {
	const t = useT();
	const { mode } = useAppMode();
	const { status, recovering } = useSession();
	if (mode === "demo") return <AppShell />;
	if (status === "loading") {
		return (
			<main className="p-6 text-center">
				<p role="status">{t("app.loading")}</p>
			</main>
		);
	}
	if (status === "signed-out") return <Navigate to="/dang-nhap" replace />;
	if (recovering) return <Navigate to="/mat-khau-moi" replace />;
	return <AppShell />;
}
