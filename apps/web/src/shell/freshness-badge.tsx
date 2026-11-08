import { useQuery } from "@tanstack/react-query";
import type { RowSource, TenantRow } from "../data/row-source";
import { useT } from "../i18n";
import { todayIn } from "../lib/business-dates";
import { useFormatters } from "../state/formatters";

export function FreshnessBadge({
	source,
	tenant,
}: {
	source: RowSource;
	tenant: TenantRow;
}) {
	const t = useT();
	const formatters = useFormatters(tenant);
	const freshness = useQuery({
		queryKey: [source.kind, "freshness", tenant.id],
		queryFn: () => source.freshness(tenant.id),
		refetchInterval: 5 * 60_000,
	});
	const text = (() => {
		const data = freshness.data;
		if (!data) return freshness.isError ? t("badge.unknown") : t("app.loading");
		if (data.kind === "sample") return t("badge.sample");
		if (data.kind === "never") return t("badge.neverSynced");
		const now = new Date();
		const time = formatters.time(data.finishedAt);
		const finishedOn = todayIn(tenant.timeZone, data.finishedAt);
		return finishedOn === todayIn(tenant.timeZone, now)
			? t("badge.updatedAt", { time })
			: t("badge.updatedAtOn", { time, date: formatters.date(finishedOn) });
	})();
	return (
		<span
			className="inline-flex items-center gap-1 rounded-full bg-surface-sunken px-2.5 py-1 text-xs font-medium text-ink-muted"
			data-testid="freshness-badge"
		>
			<span aria-hidden="true" className="size-1.5 rounded-full bg-accent" />
			{text}
		</span>
	);
}
