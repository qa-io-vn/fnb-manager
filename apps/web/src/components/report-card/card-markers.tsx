import { useT } from "../../i18n";
import type { VerificationMarker } from "./types";

export function CardMarkers({
	provisional,
	verification,
	stale = false,
	busy = false,
}: {
	provisional: boolean;
	verification: VerificationMarker;
	stale?: boolean;
	busy?: boolean;
}) {
	const t = useT();
	if (!provisional && !stale && !busy && verification === "verified") {
		return null;
	}
	return (
		<ul className="flex flex-wrap gap-1.5" aria-label={t("reportCard.markers")}>
			{busy ? (
				<li
					className="rounded border border-line px-1.5 py-0.5 text-xs font-medium text-ink-muted"
					data-testid="busy-marker"
				>
					{t("app.loading")}
				</li>
			) : null}
			{provisional ? (
				<li className="rounded border border-warning px-1.5 py-0.5 text-xs font-medium text-warning">
					{t("reportCard.provisional")}
				</li>
			) : null}
			{stale ? (
				<li
					className="rounded border border-warning px-1.5 py-0.5 text-xs font-medium text-warning"
					data-testid="stale-marker"
				>
					{t("report.marker.stale")}
				</li>
			) : null}
			{verification === "unverified" ? (
				<li className="rounded border border-warning px-1.5 py-0.5 text-xs font-medium text-warning">
					{t("reportCard.unverified")}
				</li>
			) : null}
			{verification === "sample" ? (
				<li className="rounded border border-line px-1.5 py-0.5 text-xs font-medium text-ink-muted">
					{t("badge.sample")}
				</li>
			) : null}
		</ul>
	);
}
