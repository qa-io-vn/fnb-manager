import { asOfDate, type IsoDate } from "@fnb/reports";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAppMode } from "../../app-mode/app-mode";
import { useSession } from "../../auth/session";
import { TextLink } from "../../components/ui/text-link";
import type { StoreRow, TenantRow } from "../../data/row-source";
import {
	addToMonthlyTally,
	deviceMonth,
	type ExportEstimate,
	estimateExport,
	readMonthlyTally,
	storeMonthKey,
} from "../../exports/estimate";
import {
	EXPORT_TABLES,
	type ExportPlan,
	type ExportRequest,
	type ExportStore,
	monthOptions,
	type PlanError,
	planExport,
} from "../../exports/plan";
import {
	createSupabaseExportReader,
	type ExportReader,
	isAbortError,
} from "../../exports/reader";
import {
	type ExportProgress,
	type ExportResult,
	runExport,
} from "../../exports/run";
import type { ControlTotals } from "../../exports/totals";
import { useT } from "../../i18n";
import type { CsvDialect } from "../../lib/csv";
import { useCsvDialect } from "../../state/csv-dialect";
import { useFormatters } from "../../state/formatters";
import { useReadyTenantScope } from "../../state/tenant-scope";
import { ExportForm, type ExportFormValues } from "./export-form";
import {
	ExportProgressView,
	type ProgressState,
	progressAfter,
} from "./export-progress";
import { ExportResultView } from "./export-result";
import { PACK_TAB_PATH } from "./paths";

export type ExportPhase =
	| { readonly kind: "idle" }
	| { readonly kind: "estimating"; readonly thenExport: boolean }
	| {
			readonly kind: "estimated";
			readonly key: string;
			readonly estimate: ExportEstimate;
	  }
	| {
			readonly kind: "confirm";
			readonly key: string;
			readonly estimate: ExportEstimate;
	  }
	| { readonly kind: "running"; readonly progress: ProgressState }
	| {
			readonly kind: "done";
			readonly result: ExportResult;
			readonly url: string;
			readonly tally: number;
	  }
	| { readonly kind: "stopped" }
	| { readonly kind: "failed"; readonly during: "estimate" | "export" };

export function storeAsOf(store: StoreRow, now: Date): IsoDate {
	return asOfDate(
		[
			{
				timeZone: store.timeZone,
				businessDayStartMinutes: store.businessDayStartMinutes,
			},
		],
		now,
	);
}

export function defaultMonth(options: readonly string[]): string {
	return options.at(-2) ?? options.at(-1) ?? "";
}

function previewLabel(index: number): string {
	return `S${index + 1}`;
}

export function exportRequestOf(
	values: ExportFormValues,
	stores: readonly StoreRow[],
	labels: ReadonlyMap<string, string> | null,
	now: Date,
	dialect: CsvDialect,
): ExportRequest {
	const chosen = stores.filter((store) => values.storeIds.includes(store.id));
	const exportStores: ExportStore[] = chosen.map((store, index) => ({
		id: store.id,
		label: labels?.get(store.id) ?? previewLabel(index),
		name: store.name,
		timeZone: store.timeZone,
		businessDayStartMinutes: store.businessDayStartMinutes,
		asOf: storeAsOf(store, now),
	}));
	return {
		stores: exportStores,
		firstMonth: values.firstMonth,
		lastMonth: values.lastMonth,
		tables: EXPORT_TABLES.filter((table) => values.tables.includes(table)),
		format: values.format,
		dialect,
		personal: values.personal,
	};
}

async function estimateFor(
	plan: ExportPlan,
	reader: ExportReader,
): Promise<ExportEstimate> {
	const totals = new Map<string, ControlTotals>();
	for (const month of plan.months) {
		for (const storeMonth of month.storeMonths) {
			const received = await reader.controlTotals({
				storeId: storeMonth.store.id,
				from: storeMonth.from,
				to: storeMonth.to,
			});
			totals.set(
				storeMonthKey(month.month, storeMonth.store.id),
				received.value,
			);
		}
	}
	return estimateExport(plan, totals);
}

export interface ExportWorkflowProps {
	readonly reader: ExportReader;
	readonly tenant: TenantRow;
	readonly stores: readonly StoreRow[];
	readonly defaultStoreIds: readonly string[];
	readonly personalAllowed: boolean;
	readonly dialect: CsvDialect;
	readonly now?: Date;
}

export function ExportWorkflow({
	reader,
	tenant,
	stores,
	defaultStoreIds,
	personalAllowed,
	dialect,
	now: fixedNow,
}: ExportWorkflowProps) {
	const t = useT();
	const formatters = useFormatters(tenant);
	const [now] = useState(() => fixedNow ?? new Date());
	const [values, setValues] = useState<ExportFormValues>(() => ({
		storeIds: [...defaultStoreIds],
		firstMonth: "",
		lastMonth: "",
		tables: [...EXPORT_TABLES],
		format: "csv",
		personal: false,
	}));
	const [phase, setPhase] = useState<ExportPhase>({ kind: "idle" });
	const controller = useRef<AbortController | null>(null);
	const allStoreIds = useMemo(() => stores.map((store) => store.id), [stores]);
	const chosenStores = useMemo(
		() => stores.filter((store) => values.storeIds.includes(store.id)),
		[stores, values.storeIds],
	);
	const latestAsOf = useMemo(() => {
		const dates = (chosenStores.length > 0 ? chosenStores : stores).map(
			(store) => storeAsOf(store, now),
		);
		return [...dates].sort().at(-1) ?? null;
	}, [chosenStores, stores, now]);
	const labels = useQuery({
		queryKey: ["exports", "labels", tenant.id, allStoreIds.join(",")],
		queryFn: async () =>
			new Map(
				(await reader.storeLabels(allStoreIds)).map((row) => [
					row.storeId,
					row.label,
				]),
			),
		enabled: allStoreIds.length > 0,
		staleTime: Number.POSITIVE_INFINITY,
	});
	const historyIds = values.storeIds.length > 0 ? values.storeIds : allStoreIds;
	const history = useQuery({
		queryKey: [
			"exports",
			"history",
			tenant.id,
			[...historyIds].sort().join(","),
			latestAsOf,
		],
		queryFn: () =>
			latestAsOf === null
				? Promise.resolve(null)
				: reader.historyStart(historyIds, latestAsOf),
		enabled: latestAsOf !== null && historyIds.length > 0,
		staleTime: Number.POSITIVE_INFINITY,
	});
	const options = useMemo(
		() =>
			latestAsOf === null || history.status !== "success"
				? []
				: monthOptions(history.data, latestAsOf),
		[latestAsOf, history.status, history.data],
	);
	useEffect(() => {
		if (options.length === 0) return;
		setValues((current) => {
			const fallback = defaultMonth(options);
			const firstMonth = options.includes(current.firstMonth)
				? current.firstMonth
				: fallback;
			const lastMonth = options.includes(current.lastMonth)
				? current.lastMonth
				: fallback;
			return firstMonth === current.firstMonth &&
				lastMonth === current.lastMonth
				? current
				: { ...current, firstMonth, lastMonth };
		});
	}, [options]);
	useEffect(
		() => () => {
			controller.current?.abort();
		},
		[],
	);
	useEffect(() => {
		if (phase.kind !== "done") return;
		const url = phase.url;
		return () => URL.revokeObjectURL(url);
	}, [phase]);

	const request = useMemo(
		() => exportRequestOf(values, stores, labels.data ?? null, now, dialect),
		[values, stores, labels.data, now, dialect],
	);
	const planned = useMemo(() => planExport(request), [request]);
	const formKey = useMemo(() => JSON.stringify(request), [request]);
	const ready = labels.status === "success" && options.length > 0;
	const planError: PlanError | null = planned.ok ? null : planned.error;

	const changeValues = useCallback((next: ExportFormValues) => {
		setValues(next);
		setPhase((current) =>
			current.kind === "estimated" ||
			current.kind === "confirm" ||
			current.kind === "failed" ||
			current.kind === "stopped"
				? { kind: "idle" }
				: current,
		);
	}, []);

	const start = useCallback(
		async (plan: ExportPlan, estimate: ExportEstimate | null) => {
			const abort = new AbortController();
			controller.current = abort;
			setPhase({ kind: "running", progress: { lines: [], done: [] } });
			try {
				const result = await runExport(plan, reader, {
					signal: abort.signal,
					estimatedBytes: estimate?.bytes ?? null,
					onProgress: (event: ExportProgress) =>
						setPhase((current) =>
							current.kind === "running"
								? {
										kind: "running",
										progress: progressAfter(current.progress, event),
									}
								: current,
						),
				});
				const tally = addToMonthlyTally(
					deviceMonth(new Date()),
					result.receivedBytes,
				);
				setValues((current) => ({ ...current, personal: false }));
				setPhase({
					kind: "done",
					result,
					url: URL.createObjectURL(result.archive),
					tally,
				});
			} catch (error) {
				setPhase(
					isAbortError(error)
						? { kind: "stopped" }
						: { kind: "failed", during: "export" },
				);
			} finally {
				if (controller.current === abort) controller.current = null;
			}
		},
		[reader],
	);

	const estimate = useCallback(
		async (thenExport: boolean) => {
			if (!planned.ok || !ready) return;
			const plan = planned.plan;
			const key = formKey;
			if (
				(phase.kind === "estimated" || phase.kind === "confirm") &&
				phase.key === key
			) {
				if (!thenExport) return;
				if (phase.estimate.needsConfirmation && phase.kind !== "confirm") {
					setPhase({ kind: "confirm", key, estimate: phase.estimate });
					return;
				}
				await start(plan, phase.estimate);
				return;
			}
			setPhase({ kind: "estimating", thenExport });
			let result: ExportEstimate;
			try {
				result = await estimateFor(plan, reader);
			} catch {
				setPhase({ kind: "failed", during: "estimate" });
				return;
			}
			if (!thenExport) {
				setPhase({ kind: "estimated", key, estimate: result });
			} else if (result.needsConfirmation) {
				setPhase({ kind: "confirm", key, estimate: result });
			} else {
				await start(plan, result);
			}
		},
		[planned, ready, formKey, phase, reader, start],
	);

	const confirm = useCallback(async () => {
		if (phase.kind !== "confirm" || !planned.ok) return;
		await start(planned.plan, phase.estimate);
	}, [phase, planned, start]);

	const busy = phase.kind === "estimating" || phase.kind === "running";
	const tally = readMonthlyTally(deviceMonth(new Date()));

	if (phase.kind === "running") {
		return (
			<ExportProgressView
				progress={phase.progress}
				formatters={formatters}
				onStop={() => controller.current?.abort()}
			/>
		);
	}
	if (phase.kind === "done") {
		return (
			<ExportResultView
				result={phase.result}
				url={phase.url}
				tally={phase.tally}
				formatters={formatters}
				onAgain={() => setPhase({ kind: "idle" })}
			/>
		);
	}
	return (
		<div className="space-y-4">
			<p className="text-ink-muted">{t("exports.intro")}</p>
			{labels.status === "error" || history.status === "error" ? (
				<p role="alert" data-testid="exports-load-failed">
					{t("exports.error.failed")}
				</p>
			) : null}
			{!ready && labels.status !== "error" && history.status !== "error" ? (
				<p role="status">{t("exports.loading")}</p>
			) : null}
			<ExportForm
				values={values}
				onChange={changeValues}
				stores={stores}
				monthOptions={options}
				latestAsOf={latestAsOf}
				personalAllowed={personalAllowed}
				dialect={dialect}
				planError={ready ? planError : null}
				disabled={!ready || busy}
				canSubmit={ready && planned.ok && !busy}
				phase={phase}
				tally={tally}
				formatters={formatters}
				onEstimate={() => void estimate(false)}
				onExport={() => void estimate(true)}
				onConfirm={() => void confirm()}
				onCancelConfirm={() =>
					phase.kind === "confirm"
						? setPhase({
								kind: "estimated",
								key: phase.key,
								estimate: phase.estimate,
							})
						: undefined
				}
			/>
		</div>
	);
}

function DemoNotice() {
	const t = useT();
	return (
		<div
			className="space-y-2 rounded-xl border border-line bg-surface-raised p-5"
			data-testid="exports-demo-notice"
		>
			<p>{t("exports.demo.notice")}</p>
			<TextLink to={PACK_TAB_PATH}>{t("exports.demo.packLink")}</TextLink>
		</div>
	);
}

function LiveExport({ personalAllowed }: { personalAllowed: boolean }) {
	const t = useT();
	const { client } = useSession();
	const scope = useReadyTenantScope();
	const dialect = useCsvDialect();
	const reader = useMemo(
		() => (client ? createSupabaseExportReader(client) : null),
		[client],
	);
	if (reader === null) return <p role="status">{t("exports.loading")}</p>;
	return (
		<ExportWorkflow
			key={scope.tenant.id}
			reader={reader}
			tenant={scope.tenant}
			stores={scope.stores}
			defaultStoreIds={scope.selectedStores.map((store) => store.id)}
			personalAllowed={personalAllowed}
			dialect={dialect}
		/>
	);
}

export function ExportTab({ personalAllowed }: { personalAllowed: boolean }) {
	const { mode } = useAppMode();
	if (mode === "demo") return <DemoNotice />;
	return <LiveExport personalAllowed={personalAllowed} />;
}
