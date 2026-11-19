import {
	lastDaysWindow,
	SHIFT_THEME_RANGE_DAYS,
	type ThemeContext,
} from "@fnb/reports";
import type { ReactNode } from "react";
import {
	ReportCard,
	type ReportCardProps,
} from "../components/report-card/report-card";
import type { TableSpec } from "../components/report-card/types";
import { type Translate, useT } from "../i18n";
import type { Formatters } from "../lib/format";
import { metricRegistry } from "../metrics/registry";
import { staffPageAccess } from "../settings/access";
import {
	useChecklistTemplates,
	useMembership,
	useStoreProfiles,
} from "../settings/queries";
import { useFormatters } from "../state/formatters";
import { useReadyTenantScope } from "../state/tenant-scope";
import { cashSummary, isOverLimit, shiftsWithoutCount } from "./cash";
import {
	type ComplianceRow,
	complianceRows,
	complianceSummary,
} from "./compliance";
import {
	moment,
	operationsCsvName,
	PHASE_LABEL_KEYS,
	shiftLabel,
	storeNameOf,
} from "./labels";
import { operationsHref } from "./operations-route";
import { LoadFailed, PlainCard } from "./operations-ui";
import {
	useActors,
	useCashCounts,
	useChecklistRuns,
	useOperationsSource,
} from "./queries";
import type { CashCountRow } from "./source";
import { cashTable, type TableContext } from "./tables";

export const OPERATIONS_CARD_IDS = {
	cash: "operations-card-cash-counts",
	missingCounts: "operations-card-missing-counts",
	missingChecklists: "operations-card-missing-checklists",
} as const;

interface Window {
	readonly from: string;
	readonly to: string;
	readonly days: number;
	readonly clipped: boolean;
}

function windowOf(context: ThemeContext): Window {
	const window = lastDaysWindow(context.range, SHIFT_THEME_RANGE_DAYS);
	return { ...window, clipped: window.days < context.range.days };
}

function linkRange(context: ThemeContext, window: Window) {
	return {
		...context.range,
		preset: "custom" as const,
		from: window.from,
		to: window.to,
	};
}

type Gate =
	| { readonly kind: "ready" }
	| { readonly kind: "plain"; readonly text: string }
	| { readonly kind: "loading" };

function useGate(): Gate {
	const t = useT();
	const operations = useOperationsSource();
	const membership = useMembership();
	if (operations.status === "unavailable") {
		return { kind: "plain", text: t("operations.theme.demo") };
	}
	if (membership.status === "error") {
		return { kind: "plain", text: t("operations.theme.role") };
	}
	if (operations.status !== "ready" || membership.status !== "success") {
		return { kind: "loading" };
	}
	return staffPageAccess(membership.data).canWrite
		? { kind: "ready" }
		: { kind: "plain", text: t("operations.theme.role") };
}

function GatedCard({
	title,
	testId,
	children,
}: {
	readonly title: string;
	readonly testId: string;
	readonly children: () => ReactNode;
}) {
	const t = useT();
	const gate = useGate();
	if (gate.kind === "plain") {
		return (
			<PlainCard title={title} testId={testId} state="plain">
				<p role="note" className="text-sm" data-testid="card-plain">
					{gate.text}
				</p>
			</PlainCard>
		);
	}
	if (gate.kind === "loading") {
		return (
			<PlainCard title={title} testId={testId} state="loading">
				<p role="status" className="text-sm text-ink-muted">
					{t("app.loading")}
				</p>
			</PlainCard>
		);
	}
	return <>{children()}</>;
}

function subtitleOf(t: Translate, formatters: Formatters, window: Window) {
	return window.clipped
		? {
				subtitle: t("operations.theme.window", {
					days: formatters.count(window.days),
				}),
			}
		: {};
}

function tableContext(
	t: Translate,
	formatters: Formatters,
	context: ThemeContext,
	timeZone: string,
	actors: TableContext["actors"],
): TableContext {
	return { t, formatters, stores: context.stores, actors, timeZone };
}

function CashCountCardBody({ context }: { readonly context: ThemeContext }) {
	const t = useT();
	const { tenant } = useReadyTenantScope();
	const formatters = useFormatters(tenant);
	const window = windowOf(context);
	const storeIds = context.stores.map((store) => store.id);
	const counts = useCashCounts(storeIds, window.from, window.to);
	const actors = useActors();
	const title = t("operations.theme.cash.title");
	const testId = OPERATIONS_CARD_IDS.cash;
	if (counts.status === "error") {
		return (
			<PlainCard title={title} testId={testId} state="error">
				<LoadFailed
					onRetry={() => void counts.refetch()}
					overLimit={isOverLimit(counts.error)}
				/>
			</PlainCard>
		);
	}
	if (counts.data === undefined) {
		return (
			<PlainCard title={title} testId={testId} state="loading">
				<p role="status" className="text-sm text-ink-muted">
					{t("app.loading")}
				</p>
			</PlainCard>
		);
	}
	const summary = cashSummary(counts.data);
	const shifts = counts.data.filter((row) => row.shiftId !== null);
	const props: ReportCardProps = {
		title,
		...subtitleOf(t, formatters, window),
		metric: metricRegistry.cash_count_flags,
		relatedMetrics: [metricRegistry.shifts_without_count],
		headline: {
			value: shifts.length === 0 ? null : summary.over,
			kind: "count",
			caption: t("operations.cash.caption", {
				counted: formatters.count(summary.counted),
				closed: formatters.count(summary.closed),
			}),
		},
		chips: [],
		sentence:
			counts.data.length === 0
				? t("operations.cash.none")
				: t("operations.cash.sentence", {
						counted: formatters.count(summary.counted),
						closed: formatters.count(summary.closed),
						over: formatters.count(summary.over),
						missing: formatters.count(summary.missing),
					}),
		notice: {
			tone: "info",
			text: t("operations.cash.reference"),
			action: {
				label: t("operations.theme.cashLink"),
				to: operationsHref("ket-tien", linkRange(context, window)),
			},
		},
		table: {
			...cashTable(
				counts.data,
				tableContext(t, formatters, context, tenant.timeZone, actors.data),
			),
			previewRows: 10,
		},
		csvFileName: operationsCsvName(
			"ca-ket-tien",
			"dem-ket",
			window.from,
			window.to,
		),
		verification: "verified",
		formatters,
		testId,
	};
	return <ReportCard {...props} />;
}

export function CashCountThemeCard({
	context,
}: {
	readonly context: ThemeContext;
}) {
	const t = useT();
	return (
		<GatedCard
			title={t("operations.theme.cash.title")}
			testId={OPERATIONS_CARD_IDS.cash}
		>
			{() => <CashCountCardBody context={context} />}
		</GatedCard>
	);
}

function missingCountsTable(
	t: Translate,
	formatters: Formatters,
	rows: readonly CashCountRow[],
	context: ThemeContext,
	timeZone: string,
): TableSpec {
	const multiStore = context.stores.length > 1;
	return {
		caption: t("operations.theme.missingCounts.title"),
		columns: [
			{ key: "date", label: t("operations.column.date"), kind: "date" },
			...(multiStore
				? [
						{
							key: "store",
							label: t("operations.column.store"),
							kind: "text" as const,
						},
					]
				: []),
			{ key: "shift", label: t("operations.column.shift"), kind: "text" },
			{ key: "closed", label: t("operations.column.closed"), kind: "text" },
			{ key: "drawer", label: t("operations.column.drawer"), kind: "money" },
		],
		rows: rows.map((row, index) => ({
			id: row.shiftId ?? `shift-${index + 1}`,
			cells: {
				date: row.businessDate,
				store: storeNameOf(context.stores, row.storeId),
				shift: shiftLabel(t, row.shiftNumber),
				closed: moment(formatters, row.closedAt, timeZone),
				drawer: row.drawerAmount,
			},
		})),
	};
}

function MissingCountsCardBody({
	context,
}: {
	readonly context: ThemeContext;
}) {
	const t = useT();
	const { tenant } = useReadyTenantScope();
	const formatters = useFormatters(tenant);
	const window = windowOf(context);
	const storeIds = context.stores.map((store) => store.id);
	const counts = useCashCounts(storeIds, window.from, window.to);
	const title = t("operations.theme.missingCounts.title");
	const testId = OPERATIONS_CARD_IDS.missingCounts;
	if (counts.status === "error") {
		return (
			<PlainCard title={title} testId={testId} state="error">
				<LoadFailed
					onRetry={() => void counts.refetch()}
					overLimit={isOverLimit(counts.error)}
				/>
			</PlainCard>
		);
	}
	if (counts.data === undefined) {
		return (
			<PlainCard title={title} testId={testId} state="loading">
				<p role="status" className="text-sm text-ink-muted">
					{t("app.loading")}
				</p>
			</PlainCard>
		);
	}
	const summary = cashSummary(counts.data);
	const missing = shiftsWithoutCount(counts.data);
	return (
		<ReportCard
			title={title}
			{...subtitleOf(t, formatters, window)}
			metric={metricRegistry.shifts_without_count}
			headline={{
				value: summary.closed === 0 ? null : missing.length,
				kind: "count",
			}}
			chips={[]}
			sentence={
				summary.closed === 0
					? t("operations.cash.none")
					: missing.length === 0
						? t("operations.theme.missingCounts.none")
						: t("operations.theme.missingCounts.sentence", {
								missing: formatters.count(missing.length),
								closed: formatters.count(summary.closed),
							})
			}
			notice={{
				tone: missing.length === 0 ? "info" : "warning",
				text: t("metric.shifts_without_count.convention"),
				action: {
					label: t("operations.theme.cashLink"),
					to: operationsHref("ket-tien", linkRange(context, window)),
				},
			}}
			table={{
				...missingCountsTable(t, formatters, missing, context, tenant.timeZone),
				previewRows: 10,
			}}
			csvFileName={operationsCsvName(
				"chat-luong",
				"ca-chua-dem",
				window.from,
				window.to,
			)}
			verification="verified"
			formatters={formatters}
			testId={testId}
		/>
	);
}

export function MissingCountsThemeCard({
	context,
}: {
	readonly context: ThemeContext;
}) {
	const t = useT();
	return (
		<GatedCard
			title={t("operations.theme.missingCounts.title")}
			testId={OPERATIONS_CARD_IDS.missingCounts}
		>
			{() => <MissingCountsCardBody context={context} />}
		</GatedCard>
	);
}

function missingChecklistsTable(
	t: Translate,
	rows: readonly ComplianceRow[],
	context: ThemeContext,
): TableSpec {
	const multiStore = context.stores.length > 1;
	return {
		caption: t("operations.theme.missingChecklists.title"),
		columns: [
			{ key: "date", label: t("operations.column.date"), kind: "date" },
			...(multiStore
				? [
						{
							key: "store",
							label: t("operations.column.store"),
							kind: "text" as const,
						},
					]
				: []),
			{ key: "phase", label: t("operations.column.phase"), kind: "text" },
			{
				key: "checklist",
				label: t("operations.column.checklist"),
				kind: "text",
			},
		],
		rows: rows.map((row) => ({
			id: row.key,
			cells: {
				date: row.businessDate,
				store: storeNameOf(context.stores, row.storeId),
				phase: t(PHASE_LABEL_KEYS[row.phase]),
				checklist: row.title,
			},
		})),
	};
}

function MissingChecklistsCardBody({
	context,
}: {
	readonly context: ThemeContext;
}) {
	const t = useT();
	const { tenant } = useReadyTenantScope();
	const formatters = useFormatters(tenant);
	const window = windowOf(context);
	const storeIds = context.stores.map((store) => store.id);
	const templates = useChecklistTemplates();
	const profiles = useStoreProfiles();
	const runs = useChecklistRuns(storeIds, window.from, window.to);
	const title = t("operations.theme.missingChecklists.title");
	const testId = OPERATIONS_CARD_IDS.missingChecklists;
	if (
		templates.status === "error" ||
		profiles.status === "error" ||
		runs.status === "error"
	) {
		return (
			<PlainCard title={title} testId={testId} state="error">
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
			<PlainCard title={title} testId={testId} state="loading">
				<p role="status" className="text-sm text-ink-muted">
					{t("app.loading")}
				</p>
			</PlainCard>
		);
	}
	const rows = complianceRows({
		stores: context.stores.map((store) => ({
			...store,
			openingHours:
				profiles.data.find((profile) => profile.storeId === store.id)
					?.openingHours ?? null,
		})),
		templates: templates.data,
		runs: runs.data,
		from: window.from,
		to: window.to,
		now: new Date(),
	});
	const summary = complianceSummary(rows);
	const missing = rows.filter((row) => row.status === "missing");
	return (
		<ReportCard
			title={title}
			{...subtitleOf(t, formatters, window)}
			metric={metricRegistry.checklists_missing}
			relatedMetrics={[metricRegistry.checklist_compliance]}
			headline={{
				value: summary.decided === 0 ? null : summary.missing,
				kind: "count",
			}}
			chips={[]}
			sentence={
				summary.decided === 0
					? t("operations.checklist.none")
					: summary.missing === 0
						? t("operations.theme.missingChecklists.none")
						: t("operations.theme.missingChecklists.sentence", {
								missing: formatters.count(summary.missing),
								decided: formatters.count(summary.decided),
							})
			}
			notice={{
				tone: summary.missing === 0 ? "info" : "warning",
				text: t("operations.checklist.rule"),
				action: {
					label: t("operations.theme.checklistLink"),
					to: operationsHref("checklist", linkRange(context, window)),
				},
			}}
			table={{
				...missingChecklistsTable(t, missing, context),
				previewRows: 10,
			}}
			csvFileName={operationsCsvName(
				"chat-luong",
				"checklist-bi-bo",
				window.from,
				window.to,
			)}
			verification="verified"
			formatters={formatters}
			testId={testId}
		/>
	);
}

export function MissingChecklistsThemeCard({
	context,
}: {
	readonly context: ThemeContext;
}) {
	const t = useT();
	return (
		<GatedCard
			title={t("operations.theme.missingChecklists.title")}
			testId={OPERATIONS_CARD_IDS.missingChecklists}
		>
			{() => <MissingChecklistsCardBody context={context} />}
		</GatedCard>
	);
}
