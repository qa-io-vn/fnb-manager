import type { ReactNode } from "react";
import { Button } from "../components/ui/button";
import { useT } from "../i18n";
import { useTenantScope } from "../state/tenant-scope";

export function StatusMessage({ children }: { children: ReactNode }) {
	return (
		<div className="mx-auto max-w-xl rounded-xl border border-line bg-surface-raised p-6 text-center">
			{children}
		</div>
	);
}

export function ScopeGate({ children }: { children: ReactNode }) {
	const t = useT();
	const scope = useTenantScope();
	if (scope.status === "loading") {
		return (
			<StatusMessage>
				<p role="status">{t("app.loading")}</p>
			</StatusMessage>
		);
	}
	if (scope.status === "failed") {
		return (
			<StatusMessage>
				<p role="alert" className="mb-3">
					{t("app.error")}
				</p>
				<Button type="button" onClick={scope.retry}>
					{t("app.retry")}
				</Button>
			</StatusMessage>
		);
	}
	if (scope.status === "no-membership") {
		return (
			<StatusMessage>
				<p>{t("shell.noMembership")}</p>
			</StatusMessage>
		);
	}
	return <>{children}</>;
}
