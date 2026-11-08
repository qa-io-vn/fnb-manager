import { useT } from "../../i18n";
import type { MetricDefinition } from "../../metrics/registry";

export function MetricExplainer({
	metrics,
}: {
	metrics: readonly MetricDefinition[];
}) {
	const t = useT();
	return (
		<details className="group rounded-lg border border-line px-3">
			<summary className="min-h-11 cursor-pointer py-3 text-sm font-medium text-ink">
				{t("reportCard.explain")}
			</summary>
			<div className="space-y-3 pb-3 text-sm">
				{metrics.map((metric) => (
					<dl key={metric.id} className="space-y-1">
						<dt className="font-semibold">{t(metric.labelKey)}</dt>
						<dd>
							<span className="text-ink-muted">
								{t("reportCard.formula")}:{" "}
							</span>
							{t(metric.formulaKey)}
						</dd>
						<dd>
							<span className="text-ink-muted">{t("reportCard.grain")}: </span>
							{t(metric.grainKey)}
						</dd>
						<dd>
							<span className="text-ink-muted">
								{t("reportCard.convention")}:{" "}
							</span>
							{t(metric.conventionKey)}
						</dd>
						{metric.missingKey ? (
							<dd>
								<span className="text-ink-muted">
									{t("reportCard.missing")}:{" "}
								</span>
								{t(metric.missingKey)}
							</dd>
						) : null}
					</dl>
				))}
			</div>
		</details>
	);
}
