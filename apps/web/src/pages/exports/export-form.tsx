import type { IsoDate } from "@fnb/reports";
import { useId } from "react";
import { Button } from "../../components/ui/button";
import { fieldVariants } from "../../components/ui/field";
import { TextLink } from "../../components/ui/text-link";
import type { StoreRow } from "../../data/row-source";
import { megabytes } from "../../exports/estimate";
import {
	EXPORT_TABLES,
	type ExportFormat,
	type ExportTableId,
	type MonthKey,
	type PlanError,
} from "../../exports/plan";
import { useT } from "../../i18n";
import type { CsvDialect } from "../../lib/csv";
import type { Formatters } from "../../lib/format";
import { tallyText } from "./export-result";
import type { ExportPhase } from "./export-tab";
import { countsText, monthLabel, tableLabel } from "./labels";
import { CSV_SETTING_PATH } from "./paths";

export interface ExportFormValues {
	readonly storeIds: readonly string[];
	readonly firstMonth: MonthKey;
	readonly lastMonth: MonthKey;
	readonly tables: readonly ExportTableId[];
	readonly format: ExportFormat;
	readonly personal: boolean;
}

export interface ExportFormProps {
	readonly values: ExportFormValues;
	readonly onChange: (values: ExportFormValues) => void;
	readonly stores: readonly StoreRow[];
	readonly monthOptions: readonly MonthKey[];
	readonly latestAsOf: IsoDate | null;
	readonly personalAllowed: boolean;
	readonly dialect: CsvDialect;
	readonly planError: PlanError | null;
	readonly disabled: boolean;
	readonly canSubmit: boolean;
	readonly phase: ExportPhase;
	readonly tally: number;
	readonly formatters: Formatters;
	readonly onEstimate: () => void;
	readonly onExport: () => void;
	readonly onConfirm: () => void;
	readonly onCancelConfirm: () => void;
}

export const CHECK_ROW =
	"flex min-h-11 items-center gap-3 rounded-lg px-2 hover:bg-surface-sunken";
export const CHECKBOX = "size-5 shrink-0 accent-accent";
export const FIELDSET =
	"space-y-1 rounded-xl border border-line bg-surface-raised p-4";
export const LEGEND = "px-1 font-semibold";

function toggled<T>(list: readonly T[], item: T, on: boolean): T[] {
	return on
		? [...list.filter((entry) => entry !== item), item]
		: list.filter((entry) => entry !== item);
}

function EstimatePanel({
	phase,
	formatters,
	onConfirm,
	onCancelConfirm,
}: Pick<
	ExportFormProps,
	"phase" | "formatters" | "onConfirm" | "onCancelConfirm"
>) {
	const t = useT();
	if (phase.kind === "estimating") {
		return <p role="status">{t("exports.estimate.loading")}</p>;
	}
	if (phase.kind === "failed") {
		return (
			<p role="alert" className="text-negative" data-testid="exports-failed">
				{phase.during === "estimate"
					? t("exports.error.estimateFailed")
					: t("exports.error.failed")}
			</p>
		);
	}
	if (phase.kind === "stopped") {
		return (
			<p role="status" data-testid="exports-stopped">
				{t("exports.stopped")}
			</p>
		);
	}
	if (phase.kind !== "estimated" && phase.kind !== "confirm") return null;
	const { estimate } = phase;
	return (
		<div
			className="space-y-2 rounded-xl border border-line bg-surface-raised p-4"
			data-testid="exports-estimate"
		>
			<p
				role="status"
				className="font-medium"
				data-testid="exports-estimate-summary"
			>
				{t("exports.estimate.summary", {
					megabytes: formatters.decimal(megabytes(estimate.bytes)),
				})}
			</p>
			<ul className="space-y-1 text-sm text-ink-muted">
				{estimate.rows.map((row) => (
					<li key={`${row.month}|${row.storeId}`}>
						{t("exports.estimate.row", {
							month: monthLabel(t, row.month),
							store: row.label,
							counts: countsText(
								t,
								formatters,
								Object.fromEntries(
									Object.entries(row.rows).filter(([, count]) => count > 0),
								),
							),
						})}
					</li>
				))}
				{estimate.dailySummaryRows > 0 ? (
					<li>
						{t("exports.estimate.dailyRows", {
							count: formatters.count(estimate.dailySummaryRows),
						})}
					</li>
				) : null}
			</ul>
			{phase.kind === "confirm" ? (
				<div
					className="space-y-3 rounded-lg border border-warning bg-warning-soft p-3"
					data-testid="exports-confirm"
				>
					<p role="alert">{t("exports.estimate.confirm")}</p>
					<div className="flex flex-wrap gap-2">
						<Button onClick={onConfirm}>
							{t("exports.estimate.confirmYes")}
						</Button>
						<Button tone="secondary" onClick={onCancelConfirm}>
							{t("exports.estimate.confirmNo")}
						</Button>
					</div>
				</div>
			) : null}
		</div>
	);
}

export function ExportForm(props: ExportFormProps) {
	const t = useT();
	const id = useId();
	const { values, onChange, formatters, disabled } = props;
	const set = (patch: Partial<ExportFormValues>) =>
		onChange({ ...values, ...patch });
	const firstId = `${id}-first`;
	const lastId = `${id}-last`;
	const monthsHintId = `${id}-months-hint`;
	const personalHintId = `${id}-personal-hint`;
	const storesHintId = `${id}-stores-hint`;
	const errorId = `${id}-error`;
	return (
		<form
			aria-label={t("exports.form.label")}
			className="space-y-4"
			data-testid="export-form"
			onSubmit={(event) => {
				event.preventDefault();
				if (props.canSubmit) props.onExport();
			}}
		>
			<fieldset className={FIELDSET} aria-describedby={storesHintId}>
				<legend className={LEGEND}>{t("exports.form.stores")}</legend>
				<p id={storesHintId} className="px-1 text-sm text-ink-muted">
					{t("exports.form.storesHint")}
				</p>
				{props.stores.map((store) => (
					<label key={store.id} className={CHECK_ROW}>
						<input
							type="checkbox"
							className={CHECKBOX}
							checked={values.storeIds.includes(store.id)}
							disabled={disabled}
							onChange={(event) =>
								set({
									storeIds: toggled(
										values.storeIds,
										store.id,
										event.target.checked,
									),
								})
							}
							data-store-id={store.id}
						/>
						<span className="min-w-0 break-words">{store.name}</span>
					</label>
				))}
			</fieldset>
			<div className={`${FIELDSET} grid gap-3 sm:grid-cols-2`}>
				<div className="flex flex-col gap-1">
					<label htmlFor={firstId} className="text-sm font-medium">
						{t("exports.form.firstMonth")}
					</label>
					<select
						id={firstId}
						className={fieldVariants({ kind: "control" })}
						value={values.firstMonth}
						disabled={disabled || props.monthOptions.length === 0}
						aria-describedby={monthsHintId}
						onChange={(event) => set({ firstMonth: event.target.value })}
						data-testid="export-first-month"
					>
						{props.monthOptions.map((month) => (
							<option key={month} value={month}>
								{monthLabel(t, month)}
							</option>
						))}
					</select>
				</div>
				<div className="flex flex-col gap-1">
					<label htmlFor={lastId} className="text-sm font-medium">
						{t("exports.form.lastMonth")}
					</label>
					<select
						id={lastId}
						className={fieldVariants({ kind: "control" })}
						value={values.lastMonth}
						disabled={disabled || props.monthOptions.length === 0}
						aria-describedby={monthsHintId}
						onChange={(event) => set({ lastMonth: event.target.value })}
						data-testid="export-last-month"
					>
						{props.monthOptions.map((month) => (
							<option key={month} value={month}>
								{monthLabel(t, month)}
							</option>
						))}
					</select>
				</div>
				<p id={monthsHintId} className="text-sm text-ink-muted sm:col-span-2">
					{t("exports.form.monthsHint", {
						date:
							props.latestAsOf === null
								? ""
								: formatters.date(props.latestAsOf),
					})}
				</p>
			</div>
			<fieldset className={FIELDSET}>
				<legend className={LEGEND}>{t("exports.form.tables")}</legend>
				{EXPORT_TABLES.map((table) => (
					<label key={table} className={CHECK_ROW}>
						<input
							type="checkbox"
							className={CHECKBOX}
							checked={values.tables.includes(table)}
							disabled={disabled}
							onChange={(event) =>
								set({
									tables: toggled(values.tables, table, event.target.checked),
								})
							}
							data-table={table}
						/>
						<span>{tableLabel(t, table)}</span>
					</label>
				))}
			</fieldset>
			<fieldset className={FIELDSET}>
				<legend className={LEGEND}>{t("exports.form.format")}</legend>
				<label className={CHECK_ROW}>
					<input
						type="radio"
						name={`${id}-format`}
						className={CHECKBOX}
						checked={values.format === "csv"}
						disabled={disabled}
						onChange={() => set({ format: "csv" })}
					/>
					<span>
						{t("exports.form.csv", {
							dialect: t(`exports.dialect.${props.dialect}`),
						})}
					</span>
				</label>
				<label className={CHECK_ROW}>
					<input
						type="radio"
						name={`${id}-format`}
						className={CHECKBOX}
						checked={values.format === "json"}
						disabled={disabled}
						onChange={() => set({ format: "json" })}
					/>
					<span>{t("exports.form.json")}</span>
				</label>
				<TextLink to={CSV_SETTING_PATH} className="px-2 text-sm">
					{t("exports.form.dialectLink")}
				</TextLink>
			</fieldset>
			{props.personalAllowed ? (
				<div className={FIELDSET} data-testid="export-personal">
					<label className={CHECK_ROW}>
						<input
							type="checkbox"
							className={CHECKBOX}
							checked={values.personal}
							disabled={disabled}
							aria-describedby={personalHintId}
							onChange={(event) => set({ personal: event.target.checked })}
						/>
						<span className="font-medium">{t("exports.form.personal")}</span>
					</label>
					<p id={personalHintId} className="px-2 text-sm text-ink-muted">
						{t("exports.form.personalHint")}
					</p>
				</div>
			) : null}
			{props.planError === null ? null : (
				<p
					id={errorId}
					role="alert"
					className="font-medium text-negative"
					data-testid="export-plan-error"
				>
					{t(`exports.error.${props.planError}`)}
				</p>
			)}
			<div className="flex flex-wrap gap-2">
				<Button
					tone="secondary"
					disabled={!props.canSubmit}
					onClick={props.onEstimate}
					aria-describedby={props.planError === null ? undefined : errorId}
				>
					{t("exports.form.estimate")}
				</Button>
				<Button
					type="submit"
					disabled={!props.canSubmit}
					aria-describedby={props.planError === null ? undefined : errorId}
				>
					{t("exports.form.export")}
				</Button>
			</div>
			<EstimatePanel
				phase={props.phase}
				formatters={formatters}
				onConfirm={props.onConfirm}
				onCancelConfirm={props.onCancelConfirm}
			/>
			{props.tally > 0 ? (
				<p className="text-sm text-ink-muted" data-testid="exports-tally">
					{tallyText(t, formatters, props.tally)}
				</p>
			) : null}
		</form>
	);
}
