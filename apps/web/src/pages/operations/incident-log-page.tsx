import { useId, useState } from "react";
import { ReportCard } from "../../components/report-card/report-card";
import { Button } from "../../components/ui/button";
import { cn } from "../../components/ui/cn";
import { type MessageKey, type Translate, useT } from "../../i18n";
import type { Formatters } from "../../lib/format";
import { metricRegistry } from "../../metrics/registry";
import {
	actorName,
	LOG_KIND_KEYS,
	moment,
	operationsCsvName,
	STATUS_KEYS,
	storeNameOf,
} from "../../operations/labels";
import {
	categoryLabel,
	filteredEntries,
	LOG_KINDS,
	type LogEntry,
	logEntries,
	logFiltersOf,
	logSummary,
} from "../../operations/log";
import {
	LoadFailed,
	PhotoThumbnail,
	PlainCard,
} from "../../operations/operations-ui";
import {
	useActors,
	useHandovers,
	useIncidentCategories,
	useIncidents,
} from "../../operations/queries";
import {
	type Actors,
	type IncidentCategory,
	REPORT_STATUSES,
} from "../../operations/source";
import { logTable, logText } from "../../operations/tables";
import { useOperationsAction } from "../../operations/use-operations-action";
import type { OperationsLocation } from "../../operations/use-operations-location";
import { UNAVAILABLE_CLASS } from "../../settings/forms/save-bar";
import { SelectField } from "../../settings/forms/select-field";
import type { SettingsWriteCode } from "../../settings/source";
import { WRITE_ERROR_KEYS } from "../../settings/use-settings-mutation";
import { useFormatters } from "../../state/formatters";
import { useReadyTenantScope } from "../../state/tenant-scope";
import { OperationsLayout } from "./operations-layout";

const ALL = "all";

type EntryAction = "acknowledge" | "resolve";

interface ActionArgs {
	readonly entry: LogEntry;
	readonly action: EntryAction;
}

function actionErrorKey(code: SettingsWriteCode): MessageKey {
	return code === "forbidden"
		? "operations.action.error.forbidden"
		: WRITE_ERROR_KEYS[code];
}

function Filters({
	location,
	categories,
}: {
	readonly location: OperationsLocation;
	readonly categories: readonly IncidentCategory[] | undefined;
}) {
	const t = useT();
	const ids = useId();
	const filters = logFiltersOf(location.filters, categories);
	const update = (name: "kind" | "category" | "status", value: string) =>
		location.updateFilters({ [name]: value === ALL ? undefined : value });
	return (
		<fieldset
			className="grid min-w-0 gap-3 rounded-xl border border-line bg-surface-raised p-4 sm:grid-cols-3 print:hidden"
			data-testid="log-filters"
		>
			<legend className="float-left w-full text-base font-semibold sm:col-span-3">
				{t("operations.filter.legend")}
			</legend>
			<p className="clear-left text-xs text-ink-muted sm:col-span-3">
				{t("operations.filter.storeHint")}
			</p>
			<SelectField<string>
				id={`${ids}-kind`}
				testId="log-filter-kind"
				label={t("operations.filter.kind")}
				value={filters.kind ?? ALL}
				options={[
					{ value: ALL, label: t("operations.filter.all") },
					...LOG_KINDS.map((kind) => ({
						value: kind,
						label: t(LOG_KIND_KEYS[kind]),
					})),
				]}
				onChange={(value) => update("kind", value)}
			/>
			<SelectField<string>
				id={`${ids}-category`}
				testId="log-filter-category"
				label={t("operations.filter.category")}
				value={filters.category ?? ALL}
				options={[
					{ value: ALL, label: t("operations.filter.all") },
					...(categories ?? []).map((category) => ({
						value: category.key,
						label: category.label,
					})),
				]}
				onChange={(value) => update("category", value)}
			/>
			<SelectField<string>
				id={`${ids}-status`}
				testId="log-filter-status"
				label={t("operations.filter.status")}
				value={filters.status ?? ALL}
				options={[
					{ value: ALL, label: t("operations.filter.all") },
					...REPORT_STATUSES.map((status) => ({
						value: status,
						label: t(STATUS_KEYS[status]),
					})),
				]}
				onChange={(value) => update("status", value)}
			/>
		</fieldset>
	);
}

function entryHeading(
	t: Translate,
	formatters: Formatters,
	entry: LogEntry,
	stores: readonly { readonly id: string; readonly name: string }[],
	timeZone: string,
) {
	return {
		kind: t(LOG_KIND_KEYS[entry.kind]),
		store: storeNameOf(stores, entry.storeId),
		time: moment(formatters, entry.at, timeZone) ?? "",
	};
}

function ActionEntry({
	entry,
	stores,
	categories,
	actors,
	busy,
	onAction,
}: {
	readonly entry: LogEntry;
	readonly stores: readonly { readonly id: string; readonly name: string }[];
	readonly categories: readonly IncidentCategory[] | undefined;
	readonly actors: Actors | undefined;
	readonly busy: boolean;
	readonly onAction: (action: EntryAction) => void;
}) {
	const t = useT();
	const ids = useId();
	const { tenant } = useReadyTenantScope();
	const formatters = useFormatters(tenant);
	const [photos, setPhotos] = useState(false);
	const heading = entryHeading(t, formatters, entry, stores, tenant.timeZone);
	const category = categoryLabel(categories, entry.categoryKey);
	const reporter = actorName(t, actors, entry.reportedBy);
	return (
		<li
			className="space-y-2 py-3"
			data-testid="log-entry"
			data-kind={entry.kind}
			data-status={entry.status}
		>
			<p className="font-medium">{t("operations.action.entry", heading)}</p>
			<p className="text-sm text-ink-muted">
				{[category, t(STATUS_KEYS[entry.status]), reporter]
					.filter((part) => part !== null)
					.join(" · ")}
			</p>
			<p
				className="whitespace-pre-line break-words text-sm"
				data-testid="log-text"
			>
				{logText(t, entry)}
			</p>
			{entry.itemLabel === null ? null : (
				<p className="text-sm">
					{t("operations.column.item")}: {entry.itemLabel}
				</p>
			)}
			<div className="flex flex-wrap gap-2">
				{entry.status === "open" ? (
					<Button
						size="compact"
						aria-label={t("operations.action.acknowledgeLabel", heading)}
						aria-disabled={busy || undefined}
						onClick={busy ? undefined : () => onAction("acknowledge")}
						className={UNAVAILABLE_CLASS}
						data-testid="log-acknowledge"
					>
						{t("operations.action.acknowledge")}
					</Button>
				) : null}
				{entry.kind !== "handover" && entry.status !== "resolved" ? (
					<Button
						tone="secondary"
						size="compact"
						aria-label={t("operations.action.resolveLabel", heading)}
						aria-disabled={busy || undefined}
						onClick={busy ? undefined : () => onAction("resolve")}
						className={UNAVAILABLE_CLASS}
						data-testid="log-resolve"
					>
						{t("operations.action.resolve")}
					</Button>
				) : null}
				{entry.photoPaths.length > 0 && !entry.photosRemoved ? (
					<Button
						tone="secondary"
						size="compact"
						aria-expanded={photos}
						aria-controls={`${ids}-photos`}
						aria-label={
							photos ? undefined : t("operations.action.photosLabel", heading)
						}
						onClick={() => setPhotos(!photos)}
						data-testid="log-photos"
					>
						{photos
							? t("operations.action.hidePhotos")
							: t("operations.action.photos", {
									count: entry.photoPaths.length,
								})}
					</Button>
				) : null}
			</div>
			{entry.photosRemoved ? (
				<p className="text-sm text-ink-muted">
					{t("operations.photo.removed")}
				</p>
			) : null}
			<div id={`${ids}-photos`} className="flex flex-wrap gap-2">
				{photos && entry.photoBucket !== null
					? entry.photoPaths.map((path, index) => (
							<PhotoThumbnail
								key={path}
								bucket={entry.photoBucket ?? ""}
								path={path}
								alt={`${t("operations.action.entry", heading)} (${index + 1})`}
							/>
						))
					: null}
			</div>
		</li>
	);
}

function ActionList({
	entries,
	stores,
	categories,
	actors,
}: {
	readonly entries: readonly LogEntry[];
	readonly stores: readonly { readonly id: string; readonly name: string }[];
	readonly categories: readonly IncidentCategory[] | undefined;
	readonly actors: Actors | undefined;
}) {
	const t = useT();
	const ids = useId();
	const [last, setLast] = useState<EntryAction | null>(null);
	const action = useOperationsAction<ActionArgs>((source, args) => {
		if (args.entry.kind === "handover") {
			return source.acknowledgeHandover(args.entry.id);
		}
		return args.action === "resolve"
			? source.resolveIncident(args.entry.id)
			: source.acknowledgeIncident(args.entry.id);
	});
	const waiting = entries.filter(
		(entry) =>
			entry.status === "open" ||
			(entry.kind !== "handover" && entry.status === "seen"),
	);
	const status =
		last === null
			? null
			: action.running
				? { tone: "text-ink-muted", text: t("settings.saving") }
				: action.errorCode !== null
					? { tone: "text-negative", text: t(actionErrorKey(action.errorCode)) }
					: action.done
						? {
								tone: "text-positive",
								text: t(
									last === "resolve"
										? "operations.action.done.resolved"
										: "operations.action.done.acknowledged",
								),
							}
						: null;
	return (
		<section
			aria-labelledby={`${ids}-heading`}
			className="space-y-2 rounded-xl border border-line bg-surface-raised p-4 print:hidden"
			data-testid="log-actions"
		>
			<h2 id={`${ids}-heading`} className="text-base font-semibold">
				{t("operations.log.actions")}
			</h2>
			<div className="flex flex-wrap items-center gap-2">
				<p
					role="status"
					className={cn("text-sm", status?.tone ?? null)}
					data-testid="log-action-status"
				>
					{status?.text ?? ""}
				</p>
				{action.canRetry ? (
					<Button
						tone="secondary"
						size="compact"
						onClick={() => void action.retry()}
						data-testid="log-action-retry"
					>
						{t("app.retry")}
					</Button>
				) : null}
			</div>
			{waiting.length === 0 ? (
				<p className="text-sm" data-testid="log-actions-none">
					{t("operations.log.actionsNone")}
				</p>
			) : (
				<ul className="divide-y divide-line">
					{waiting.map((entry) => (
						<ActionEntry
							key={entry.key}
							entry={entry}
							stores={stores}
							categories={categories}
							actors={actors}
							busy={action.running}
							onAction={(kind) => {
								setLast(kind);
								void action.run({ entry, action: kind });
							}}
						/>
					))}
				</ul>
			)}
		</section>
	);
}

function LogBody({ location }: { readonly location: OperationsLocation }) {
	const t = useT();
	const { tenant } = useReadyTenantScope();
	const formatters = useFormatters(tenant);
	const storeIds = location.stores.map((store) => store.id);
	const { from, to } = location.range;
	const incidents = useIncidents(storeIds, from, to);
	const handovers = useHandovers(storeIds, from, to);
	const categories = useIncidentCategories();
	const actors = useActors();
	const title = t("operations.log.title");
	const filtersView = (
		<Filters location={location} categories={categories.data} />
	);
	if (incidents.status === "error" || handovers.status === "error") {
		return (
			<div className="space-y-4">
				{filtersView}
				<PlainCard title={title} testId="operations-log-card" state="error">
					<LoadFailed
						onRetry={() => {
							if (incidents.status === "error") void incidents.refetch();
							if (handovers.status === "error") void handovers.refetch();
						}}
					/>
				</PlainCard>
			</div>
		);
	}
	if (incidents.data === undefined || handovers.data === undefined) {
		return (
			<div className="space-y-4">
				{filtersView}
				<PlainCard title={title} testId="operations-log-card" state="loading">
					<p role="status" className="text-sm text-ink-muted">
						{t("app.loading")}
					</p>
				</PlainCard>
			</div>
		);
	}
	const entries = filteredEntries(
		logEntries(incidents.data, handovers.data),
		logFiltersOf(location.filters, categories.data),
	);
	const summary = logSummary(entries);
	const sentence =
		summary.total === 0
			? t("operations.log.none")
			: t("operations.log.sentence", {
					total: formatters.count(summary.total),
					incidents: formatters.count(summary.incidents),
					stockOuts: formatters.count(summary.stockOuts),
					handovers: formatters.count(summary.handovers),
					open: formatters.count(summary.open),
					seen: formatters.count(summary.seen),
					resolved: formatters.count(summary.resolved),
				});
	return (
		<div className="space-y-4">
			{filtersView}
			<div className="grid items-start gap-3" data-testid="report-cards">
				<ReportCard
					title={title}
					metric={metricRegistry.open_reports}
					headline={{
						value: summary.open,
						kind: "count",
						caption: t("operations.log.caption", {
							open: formatters.count(summary.open),
						}),
					}}
					chips={[]}
					sentence={sentence}
					notice={{ tone: "info", text: t("operations.log.privacy") }}
					table={logTable(entries, categories.data, {
						t,
						formatters,
						stores: location.stores,
						actors: actors.data,
						timeZone: tenant.timeZone,
					})}
					csvFileName={operationsCsvName("van-hanh", "su-co", from, to)}
					verification="verified"
					formatters={formatters}
					testId="operations-log-card"
				/>
			</div>
			<ActionList
				entries={entries}
				stores={location.stores}
				categories={categories.data}
				actors={actors.data}
			/>
		</div>
	);
}

export function IncidentLogPage() {
	return (
		<OperationsLayout page="su-co">
			{(location) => <LogBody location={location} />}
		</OperationsLayout>
	);
}
