import type { ReportSettings } from "@fnb/reports";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { Button } from "../../components/ui/button";
import { useT } from "../../i18n";
import { settingsQueryKey, useReportSettings } from "../../settings/queries";
import { ReadOnlyNotice } from "../../settings/read-only-notice";
import { useSettingsSourceState } from "../../settings/settings-source-context";
import type {
	ReportSettingsState,
	SettingsSource,
} from "../../settings/source";
import { DeviceCsvChoice } from "../../settings/thresholds/device-csv-choice";
import { stateAfterSave } from "../../settings/thresholds/fields";
import {
	ThresholdsForm,
	type ThresholdsOutcome,
} from "../../settings/thresholds/thresholds-form";
import { useSettingsAccess } from "../../settings/use-settings-access";
import { useSettingsMutation } from "../../settings/use-settings-mutation";
import { useFormatters } from "../../state/formatters";
import { useReadyTenantScope } from "../../state/tenant-scope";

function ThresholdsSection() {
	const t = useT();
	const { tenant } = useReadyTenantScope();
	const formatters = useFormatters(tenant);
	const access = useSettingsAccess("thresholds");
	const sourceState = useSettingsSourceState();
	const settings = useReportSettings();
	const queryClient = useQueryClient();
	const writeThresholds = useCallback(
		async (
			source: SettingsSource,
			tenantId: string,
			changes: Partial<ReportSettings>,
		) => {
			await source.saveReportSettings(tenantId, changes);
			queryClient.setQueryData<ReportSettingsState>(
				settingsQueryKey(source.kind, tenantId, "reportSettings"),
				(previous) =>
					previous === undefined
						? previous
						: stateAfterSave(previous, changes, new Date().toISOString()),
			);
		},
		[queryClient],
	);
	const { save, saving, saved, errorCode, errorConstraint, reset } =
		useSettingsMutation(writeThresholds);
	const loadFailed =
		sourceState.status === "failed" || settings.status === "error";
	if (settings.data === undefined && loadFailed) {
		return (
			<div
				role="alert"
				className="space-y-2"
				data-testid="thresholds-load-failed"
			>
				<p>{t("app.error")}</p>
				{sourceState.status === "failed" ? null : (
					<Button
						tone="secondary"
						size="compact"
						onClick={() => void settings.refetch()}
					>
						{t("app.retry")}
					</Button>
				)}
			</div>
		);
	}
	if (settings.data === undefined) {
		return <p role="status">{t("app.loading")}</p>;
	}
	const outcome: ThresholdsOutcome =
		errorCode !== null
			? { kind: "refused", code: errorCode, constraint: errorConstraint }
			: saved
				? { kind: "saved" }
				: { kind: "idle" };
	return (
		<>
			<ReadOnlyNotice access={access} />
			<ThresholdsForm
				saved={settings.data}
				canWrite={access.canWrite}
				formatters={formatters}
				currencyCode={tenant.currencyCode}
				timeZone={tenant.timeZone}
				saving={saving}
				outcome={outcome}
				onSave={(changes) => void save(changes)}
				onEdit={() => {
					if (outcome.kind !== "idle" && !saving) reset();
				}}
			/>
		</>
	);
}

export default function BaoCaoPage() {
	const t = useT();
	const { tenant } = useReadyTenantScope();
	return (
		<div className="space-y-6" data-testid="thresholds-page">
			<p className="text-sm text-ink-muted" data-testid="thresholds-note">
				{t("settings.thresholds.note")}
			</p>
			<ThresholdsSection key={tenant.id} />
			<DeviceCsvChoice />
		</div>
	);
}
