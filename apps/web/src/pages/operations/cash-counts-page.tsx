import { useEffect, useId, useRef, useState } from "react";
import { ReportCard } from "../../components/report-card/report-card";
import { Button } from "../../components/ui/button";
import { cn } from "../../components/ui/cn";
import { type Translate, useT } from "../../i18n";
import type { Formatters } from "../../lib/format";
import { metricRegistry } from "../../metrics/registry";
import {
	cashSummary,
	isOverLimit,
	reopenableCounts,
} from "../../operations/cash";
import {
	operationsCsvName,
	shiftLabel,
	storeNameOf,
} from "../../operations/labels";
import { LoadFailed, PlainCard } from "../../operations/operations-ui";
import { useActors, useCashCounts } from "../../operations/queries";
import type { CashCountRow } from "../../operations/source";
import { cashTable } from "../../operations/tables";
import { useOperationsAction } from "../../operations/use-operations-action";
import type { OperationsLocation } from "../../operations/use-operations-location";
import { UNAVAILABLE_CLASS } from "../../settings/forms/save-bar";
import { SelectField } from "../../settings/forms/select-field";
import { WRITE_ERROR_KEYS } from "../../settings/use-settings-mutation";
import { useFormatters } from "../../state/formatters";
import { useReadyTenantScope } from "../../state/tenant-scope";
import { OperationsLayout } from "./operations-layout";

function countLabel(
	t: Translate,
	formatters: Formatters,
	row: CashCountRow,
	stores: readonly { readonly id: string; readonly name: string }[],
): string {
	return t("operations.reopen.option", {
		shift: shiftLabel(t, row.shiftNumber),
		date: formatters.date(row.businessDate),
		store: storeNameOf(stores, row.storeId),
		amount:
			row.countedAmount === null
				? ""
				: formatters.moneyExact(row.countedAmount),
	});
}

function ReopenSection({
	rows,
	stores,
}: {
	readonly rows: readonly CashCountRow[];
	readonly stores: readonly { readonly id: string; readonly name: string }[];
}) {
	const t = useT();
	const ids = useId();
	const { tenant } = useReadyTenantScope();
	const formatters = useFormatters(tenant);
	const counts = reopenableCounts(rows);
	const [chosen, setChosen] = useState<string>("");
	const [confirming, setConfirming] = useState(false);
	const [last, setLast] = useState<CashCountRow | null>(null);
	const confirmRef = useRef<HTMLButtonElement | null>(null);
	const openerRef = useRef<HTMLButtonElement | null>(null);
	const action = useOperationsAction<string>((source, id) =>
		source.reopenCashCount(id),
	);
	const selected =
		counts.find((row) => row.cashCountId === chosen) ?? counts[0] ?? null;
	useEffect(() => {
		if (confirming) confirmRef.current?.focus();
	}, [confirming]);
	const status =
		last === null
			? null
			: action.running
				? { tone: "text-ink-muted", text: t("settings.saving") }
				: action.errorCode !== null
					? {
							tone: "text-negative",
							text: t(
								action.errorCode === "forbidden"
									? "operations.reopen.error.forbidden"
									: WRITE_ERROR_KEYS[action.errorCode],
							),
						}
					: action.done
						? {
								tone: "text-positive",
								text: t("operations.reopen.done", {
									shift: shiftLabel(t, last.shiftNumber),
									date: formatters.date(last.businessDate),
								}),
							}
						: null;
	const confirm = () => {
		if (selected?.cashCountId == null) return;
		setConfirming(false);
		setLast(selected);
		void action.run(selected.cashCountId);
		window.requestAnimationFrame(() => openerRef.current?.focus());
	};
	return (
		<section
			aria-labelledby={`${ids}-heading`}
			className="space-y-3 rounded-xl border border-line bg-surface-raised p-4 print:hidden"
			data-testid="cash-reopen"
		>
			<h2 id={`${ids}-heading`} className="text-base font-semibold">
				{t("operations.reopen.title")}
			</h2>
			<p className="text-sm text-ink-muted">{t("operations.reopen.hint")}</p>
			{counts.length === 0 ? (
				<p className="text-sm" data-testid="cash-reopen-none">
					{t("operations.reopen.none")}
				</p>
			) : (
				<>
					<SelectField<string>
						id={`${ids}-count`}
						testId="cash-reopen-choice"
						label={t("operations.reopen.choose")}
						value={selected?.cashCountId ?? ""}
						options={counts.map((row) => ({
							value: row.cashCountId ?? "",
							label: countLabel(t, formatters, row, stores),
						}))}
						onChange={(value) => {
							setChosen(value);
							setConfirming(false);
						}}
					/>
					<Button
						ref={openerRef}
						tone="secondary"
						size="compact"
						aria-disabled={action.running || confirming || undefined}
						onClick={() => {
							if (action.running || confirming) return;
							action.reset();
							setLast(null);
							setConfirming(true);
						}}
						className={UNAVAILABLE_CLASS}
						data-testid="cash-reopen-open"
					>
						{t("operations.reopen.action")}
					</Button>
				</>
			)}
			{confirming && selected !== null ? (
				<fieldset
					className="min-w-0 rounded-lg border border-warning bg-warning-soft p-3"
					data-testid="cash-reopen-confirm"
					onKeyDown={(event) => {
						if (event.key === "Escape") setConfirming(false);
					}}
				>
					<legend className="float-left w-full text-sm">
						{t("operations.reopen.confirm", {
							shift: shiftLabel(t, selected.shiftNumber),
							date: formatters.date(selected.businessDate),
							store: storeNameOf(stores, selected.storeId),
						})}
					</legend>
					<div className="clear-left flex flex-wrap gap-2 pt-2">
						<Button
							ref={confirmRef}
							size="compact"
							onClick={confirm}
							data-testid="cash-reopen-yes"
						>
							{t("operations.reopen.yes")}
						</Button>
						<Button
							tone="secondary"
							size="compact"
							onClick={() => setConfirming(false)}
							data-testid="cash-reopen-no"
						>
							{t("operations.reopen.back")}
						</Button>
					</div>
				</fieldset>
			) : null}
			<div className="flex flex-wrap items-center gap-2">
				<p
					role="status"
					className={cn("text-sm", status?.tone ?? null)}
					data-testid="cash-reopen-status"
				>
					{status?.text ?? ""}
				</p>
				{action.canRetry ? (
					<Button
						tone="secondary"
						size="compact"
						onClick={() => void action.retry()}
						data-testid="cash-reopen-retry"
					>
						{t("app.retry")}
					</Button>
				) : null}
			</div>
		</section>
	);
}

function CashBody({ location }: { readonly location: OperationsLocation }) {
	const t = useT();
	const { tenant } = useReadyTenantScope();
	const formatters = useFormatters(tenant);
	const storeIds = location.stores.map((store) => store.id);
	const { from, to } = location.range;
	const counts = useCashCounts(storeIds, from, to);
	const actors = useActors();
	const title = t("operations.cash.title");
	if (counts.status === "error") {
		return (
			<PlainCard title={title} testId="operations-cash-card" state="error">
				<LoadFailed
					onRetry={() => void counts.refetch()}
					overLimit={isOverLimit(counts.error)}
				/>
			</PlainCard>
		);
	}
	if (counts.data === undefined) {
		return (
			<PlainCard title={title} testId="operations-cash-card" state="loading">
				<p role="status" className="text-sm text-ink-muted">
					{t("app.loading")}
				</p>
			</PlainCard>
		);
	}
	const summary = cashSummary(counts.data);
	const sentence =
		counts.data.length === 0
			? t("operations.cash.none")
			: [
					t("operations.cash.sentence", {
						counted: formatters.count(summary.counted),
						closed: formatters.count(summary.closed),
						over: formatters.count(summary.over),
						missing: formatters.count(summary.missing),
					}),
					summary.unmatched === 0
						? null
						: t("operations.cash.unmatched", {
								count: formatters.count(summary.unmatched),
							}),
				]
					.filter((part) => part !== null)
					.join(" ");
	return (
		<div className="space-y-4">
			<div className="grid items-start gap-3" data-testid="report-cards">
				<ReportCard
					title={title}
					metric={metricRegistry.cash_count_flags}
					relatedMetrics={[metricRegistry.shifts_without_count]}
					headline={{
						value: counts.data.length === 0 ? null : summary.over,
						kind: "count",
						caption: t("operations.cash.caption", {
							counted: formatters.count(summary.counted),
							closed: formatters.count(summary.closed),
						}),
					}}
					chips={[]}
					sentence={sentence}
					notice={{ tone: "info", text: t("operations.cash.reference") }}
					table={cashTable(counts.data, {
						t,
						formatters,
						stores: location.stores,
						actors: actors.data,
						timeZone: tenant.timeZone,
					})}
					csvFileName={operationsCsvName("van-hanh", "ket-tien", from, to)}
					verification="verified"
					formatters={formatters}
					testId="operations-cash-card"
				/>
			</div>
			<ReopenSection rows={counts.data} stores={location.stores} />
		</div>
	);
}

export function CashCountsPage() {
	return (
		<OperationsLayout page="ket-tien">
			{(location) => <CashBody location={location} />}
		</OperationsLayout>
	);
}
