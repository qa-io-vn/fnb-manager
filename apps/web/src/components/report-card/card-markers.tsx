import { useT } from "../../i18n";
import type { VerificationMarker } from "./types";

export function CardMarkers({
	provisional,
	verification,
}: {
	provisional: boolean;
	verification: VerificationMarker;
}) {
	const t = useT();
	if (!provisional && verification === "verified") return null;
	return (
		<ul className="flex flex-wrap gap-1.5" aria-label={t("reportCard.markers")}>
			{provisional ? (
				<li className="rounded border border-warning px-1.5 py-0.5 text-xs font-medium text-warning">
					{t("reportCard.provisional")}
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
