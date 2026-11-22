import { useT } from "../../i18n";
import { LoadState, Note, NotifySection } from "./common";
import type { NotifyOverview } from "./source";
import { ageParts } from "./words";

export function quotaHigh(overview: NotifyOverview): boolean {
	return overview.zaloBotMonth >= overview.zaloBotQuota * 0.8;
}

/**
 * The owner's notice of ADR-045: with no destination that is enabled and active or failing, no alert is sent, the
 * data-subject deadline reminders among them, although their episodes stay open. Only an owner who sees every
 * destination is told; a store-limited login sees a part of them and cannot tell.
 */
export function noWorkingDestination(overview: NotifyOverview): boolean {
	return (
		overview.role === "owner" &&
		!overview.storeLimited &&
		!overview.destinations.some(
			(row) =>
				row.enabled && (row.status === "active" || row.status === "failing"),
		)
	);
}

export function StatusSection({
	overview,
	failed,
	onRetry,
	now,
}: {
	overview: NotifyOverview | undefined;
	failed: boolean;
	onRetry: () => void;
	now: number;
}) {
	const t = useT();
	return (
		<NotifySection
			id="notify-status"
			titleKey="settings.notify.status.title"
			testId="notify-status"
		>
			{overview === undefined ? (
				<LoadState
					failed={failed}
					onRetry={onRetry}
					testId="notify-status-failed"
				/>
			) : (
				<div className="space-y-2 text-sm">
					{overview.scheduleEnabled ? (
						<p data-testid="notify-schedule" data-enabled="true">
							{t("settings.notify.status.scheduleOn")}
						</p>
					) : (
						<Note testId="notify-schedule" tone="warning">
							{t("settings.notify.status.scheduleOff")}
						</Note>
					)}
					{noWorkingDestination(overview) ? (
						<Note tone="warning" testId="notify-no-destination">
							{t("settings.notify.status.noDestination")}
						</Note>
					) : null}
					<p data-testid="notify-last-tick">
						{(() => {
							const age = ageParts(overview.lastTickAt, now);
							return age === null
								? t("settings.notify.status.noTick")
								: t("settings.notify.status.lastTick", {
										age: t(age.key, { count: age.count }),
									});
						})()}
					</p>
					<p data-testid="notify-counts">
						{t("settings.notify.status.counts", {
							held: overview.held24h,
							uncertain: overview.uncertain24h,
							failed: overview.failed24h,
						})}
					</p>
					<p data-testid="notify-quota">
						{t("settings.notify.status.quota", {
							count: overview.zaloBotMonth,
							quota: overview.zaloBotQuota,
						})}
					</p>
					{quotaHigh(overview) ? (
						<Note tone="warning" testId="notify-quota-high">
							{t("settings.notify.status.quotaHigh")}
						</Note>
					) : null}
					{overview.dispatcherSecrets.length > 0 ? (
						<p data-testid="notify-secrets" className="break-words">
							{t("settings.notify.status.secrets", {
								names: overview.dispatcherSecrets.join(", "),
							})}
						</p>
					) : null}
				</div>
			)}
		</NotifySection>
	);
}
