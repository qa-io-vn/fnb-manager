import { ReportCard } from "../../components/report-card/report-card";
import { useT } from "../../i18n";
import { metricRegistry } from "../../metrics/registry";
import {
	type ComplianceStore,
	complianceRows,
	complianceSummary,
} from "../../operations/compliance";
import { operationsCsvName } from "../../operations/labels";
import { LoadFailed, PlainCard } from "../../operations/operations-ui";
import { useActors, useChecklistRuns } from "../../operations/queries";
import { RunDetails } from "../../operations/run-details";
import { complianceTable } from "../../operations/tables";
import type { OperationsLocation } from "../../operations/use-operations-location";
import {
	useChecklistTemplates,
	useStoreProfiles,
} from "../../settings/queries";
import { useFormatters } from "../../state/formatters";
import { useReadyTenantScope } from "../../state/tenant-scope";
import { OperationsLayout } from "./operations-layout";

function ComplianceBody({
	location,
}: {
	readonly location: OperationsLocation;
}) {
	const t = useT();
	const { tenant } = useReadyTenantScope();
	const formatters = useFormatters(tenant);
	const storeIds = location.stores.map((store) => store.id);
	const { from, to } = location.range;
	const templates = useChecklistTemplates();
	const profiles = useStoreProfiles();
	const runs = useChecklistRuns(storeIds, from, to);
	const actors = useActors();
	const title = t("operations.checklist.title");
	if (
		templates.status === "error" ||
		profiles.status === "error" ||
		runs.status === "error"
	) {
		return (
			<PlainCard title={title} testId="operations-checklist-card" state="error">
				<LoadFailed
					onRetry={() => {
						for (const read of [templates, profiles, runs]) {
							if (read.status === "error") void read.refetch();
						}
					}}
				/>
			</PlainCard>
		);
	}
	if (
		templates.data === undefined ||
		profiles.data === undefined ||
		runs.data === undefined
	) {
		return (
			<PlainCard
				title={title}
				testId="operations-checklist-card"
				state="loading"
			>
				<p role="status" className="text-sm text-ink-muted">
					{t("app.loading")}
				</p>
			</PlainCard>
		);
	}
	const stores: ComplianceStore[] = location.stores.map((store) => ({
		id: store.id,
		name: store.name,
		timeZone: store.timeZone,
		businessDayStartMinutes: store.businessDayStartMinutes,
		openingHours:
			profiles.data.find((profile) => profile.storeId === store.id)
				?.openingHours ?? null,
	}));
	const rows = complianceRows({
		stores,
		templates: templates.data,
		runs: runs.data,
		from,
		to,
		now: new Date(),
	});
	const summary = complianceSummary(rows);
	const hasTemplates = templates.data.some(
		(template) =>
			template.storeId === null || storeIds.includes(template.storeId),
	);
	const sentence =
		summary.decided === 0
			? t("operations.checklist.none")
			: t("operations.checklist.sentence", {
					done: formatters.count(summary.done),
					late: formatters.count(summary.late),
					missing: formatters.count(summary.missing),
					decided: formatters.count(summary.decided),
				});
	const pending =
		summary.inProgress + summary.due === 0
			? ""
			: ` ${t("operations.checklist.pending", {
					inProgress: formatters.count(summary.inProgress),
					due: formatters.count(summary.due),
				})}`;
	const context = {
		t,
		formatters,
		stores: location.stores,
		actors: actors.data,
		timeZone: tenant.timeZone,
	};
	return (
		<div className="space-y-4">
			<div className="grid items-start gap-3" data-testid="report-cards">
				<ReportCard
					title={title}
					metric={metricRegistry.checklist_compliance}
					relatedMetrics={[metricRegistry.checklists_missing]}
					headline={{
						value: summary.rate,
						kind: "percent",
						caption: t("operations.checklist.caption", {
							decided: formatters.count(summary.decided),
						}),
					}}
					chips={[]}
					sentence={`${sentence}${pending}`}
					notice={
						hasTemplates
							? { tone: "info", text: t("operations.checklist.rule") }
							: {
									tone: "info",
									text: t("operations.checklist.noTemplates"),
									action: {
										label: t("operations.checklist.settingsLink"),
										to: "/cai-dat/checklist",
									},
								}
					}
					table={complianceTable(rows, context)}
					csvFileName={operationsCsvName("van-hanh", "checklist", from, to)}
					verification="verified"
					formatters={formatters}
					testId="operations-checklist-card"
				/>
			</div>
			<RunDetails
				runs={runs.data}
				stores={location.stores}
				context={{
					formatters,
					actors: actors.data,
					timeZone: tenant.timeZone,
				}}
			/>
		</div>
	);
}

export function ChecklistCompliancePage() {
	return (
		<OperationsLayout page="checklist">
			{(location) => <ComplianceBody location={location} />}
		</OperationsLayout>
	);
}
