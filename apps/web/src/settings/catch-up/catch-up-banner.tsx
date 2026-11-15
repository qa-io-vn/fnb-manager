import { Button } from "../../components/ui/button";
import { type MessageKey, useT } from "../../i18n";
import { todayIn } from "../../lib/business-dates";
import type { Formatters } from "../../lib/format";
import { useFormatters } from "../../state/formatters";
import { useReadyTenantScope } from "../../state/tenant-scope";
import type { CatchUpProblem } from "./catch-up-context";
import { useAnalyticsCatchUp } from "./use-analytics-catch-up";

const PROBLEM_KEYS: Readonly<Partial<Record<CatchUpProblem, MessageKey>>> = {
	network: "settings.catchUp.failed.network",
	forbidden: "settings.catchUp.failed.forbidden",
	stalled: "settings.catchUp.failed.stalled",
};

const OTHER_PROBLEM_KEY: MessageKey = "settings.catchUp.failed.other";

const UNAVAILABLE_CLASS =
	"aria-disabled:cursor-not-allowed aria-disabled:opacity-60";

export function CatchUpBanner({
	formatters,
	timeZone,
}: {
	readonly formatters: Formatters;
	readonly timeZone: string;
}) {
	const t = useT();
	const { status, pendingDays, running, problem, completed, start, dismiss } =
		useAnalyticsCatchUp();
	const waiting = pendingDays > 0;
	const finished = completed && !running && !waiting;
	if (
		status === null ||
		!(waiting || running || finished || problem !== null)
	) {
		return null;
	}
	const changed =
		status.inputsChangedAt === null ? null : new Date(status.inputsChangedAt);
	const days = formatters.count(pendingDays);
	const summary = finished
		? null
		: !waiting
			? t("settings.catchUp.finishing")
			: changed === null
				? t("settings.catchUp.pending", { days })
				: t("settings.catchUp.pendingSince", {
						days,
						date: formatters.date(todayIn(timeZone, changed)),
						time: formatters.time(changed),
					});
	const outcome = running
		? t("settings.catchUp.running")
		: finished
			? t("settings.catchUp.done")
			: problem === null
				? ""
				: t(PROBLEM_KEYS[problem] ?? OTHER_PROBLEM_KEY);
	const action = finished
		? { label: t("settings.catchUp.dismiss"), run: dismiss }
		: status.canRefresh
			? {
					label:
						problem === null || running
							? t("settings.catchUp.start")
							: t("settings.catchUp.retry"),
					run: start,
				}
			: null;
	return (
		<section
			aria-label={t("settings.catchUp.label")}
			className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-warning bg-warning-soft px-3 py-2 text-sm print:hidden"
			data-testid="catch-up-banner"
			data-pending-days={pendingDays}
		>
			<div className="min-w-0 flex-1 basis-56">
				{summary === null ? null : <p>{summary}</p>}
				<p role="status" data-testid="catch-up-status">
					{outcome}
				</p>
				{status.canRefresh || finished ? null : (
					<p>{t("settings.catchUp.waitForOwner")}</p>
				)}
			</div>
			{action === null ? null : (
				<Button
					size="compact"
					aria-disabled={running || undefined}
					aria-busy={running || undefined}
					onClick={running ? undefined : action.run}
					className={UNAVAILABLE_CLASS}
					data-testid="catch-up-action"
				>
					{action.label}
				</Button>
			)}
		</section>
	);
}

export function TenantCatchUpBanner() {
	const { tenant } = useReadyTenantScope();
	const formatters = useFormatters(tenant);
	return <CatchUpBanner formatters={formatters} timeZone={tenant.timeZone} />;
}
