import { Button } from "../../components/ui/button";
import { useT } from "../../i18n";
import type { Formatters } from "../../lib/format";

export function PackProgressView({
	done,
	total,
	formatters,
	onStop,
}: {
	done: number;
	total: number;
	formatters: Formatters;
	onStop: () => void;
}) {
	const t = useT();
	const line =
		total === 0
			? t("exports.pack.progress.preparing")
			: t("exports.pack.progress.calls", {
					done: formatters.count(done),
					total: formatters.count(total),
				});
	return (
		<div
			className="space-y-3 rounded-xl border border-line bg-surface-raised p-4"
			data-testid="pack-progress"
		>
			<progress
				className="h-2 w-full accent-accent"
				max={Math.max(total, 1)}
				value={done}
				aria-label={t("exports.pack.progress.label")}
			/>
			<p
				role="status"
				aria-live="polite"
				className="font-medium"
				data-testid="pack-progress-line"
			>
				{line}
			</p>
			<Button tone="secondary" onClick={onStop} data-testid="pack-stop">
				{t("exports.progress.stop")}
			</Button>
		</div>
	);
}
