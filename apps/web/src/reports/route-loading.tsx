import { useT } from "../i18n";
import { StatusMessage } from "../shell/scope-status";

export function ReportRouteLoading() {
	const t = useT();
	return (
		<StatusMessage>
			<p role="status">{t("app.loading")}</p>
		</StatusMessage>
	);
}
