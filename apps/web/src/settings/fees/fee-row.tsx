import { useId, useState } from "react";
import { Button } from "../../components/ui/button";
import { type MessageKey, type Translate, useT } from "../../i18n";
import type { IsoDate } from "../../lib/business-dates";
import type { Formatters } from "../../lib/format";
import { AuditLine } from "../forms/audit-line";
import { DateField } from "../forms/date-field";
import { dateBound, issueText, numericBound } from "../forms/issue-text";
import { MoneyField } from "../forms/money-field";
import { formatPercentBound, PercentField } from "../forms/percent-field";
import type { FeeRateRow } from "../source";
import {
	currentRateOf,
	editedRateDateOf,
	type FeeEdit,
	type FeeFieldIssues,
	type FeeMethod,
	type FeeScope,
	type RateDateHint,
	type RateDateHintKind,
	rateDateHintOf,
	rateHistoryOf,
} from "./fees";

const DATE_HINT_KEYS: Readonly<
	Record<
		RateDateHintKind,
		{ readonly open: MessageKey; readonly until: MessageKey }
	>
> = {
	wholeHistory: {
		open: "settings.fees.date.wholeHistory",
		until: "settings.fees.date.wholeHistoryUntil",
	},
	keepsEarlier: {
		open: "settings.fees.date.keepsEarlier",
		until: "settings.fees.date.keepsEarlierUntil",
	},
	keepsShared: {
		open: "settings.fees.date.keepsShared",
		until: "settings.fees.date.keepsSharedUntil",
	},
	replacesShared: {
		open: "settings.fees.date.replacesShared",
		until: "settings.fees.date.replacesSharedUntil",
	},
	replaces: {
		open: "settings.fees.date.replaces",
		until: "settings.fees.date.replaces",
	},
	fromDate: {
		open: "settings.fees.date.fromDate",
		until: "settings.fees.date.fromDateUntil",
	},
};

export function rateDateHintText(
	t: Translate,
	hint: RateDateHint,
	formatters: Formatters,
): string {
	const keys = DATE_HINT_KEYS[hint.kind];
	return hint.until === null
		? t(keys.open)
		: t(keys.until, { date: formatters.date(hint.until) });
}

export function rateText(
	t: Translate,
	row: Pick<FeeRateRow, "feePct" | "fixedFeeAmount">,
	formatters: Formatters,
): string {
	const percent = formatPercentBound(row.feePct, formatters.locale);
	return row.fixedFeeAmount === 0
		? percent
		: t("settings.fees.rate.withFixed", {
				percent,
				fixed: formatters.moneyExact(row.fixedFeeAmount),
			});
}

function FieldName({
	text,
	method,
}: {
	readonly text: string;
	readonly method: string;
}) {
	const t = useT();
	return (
		<>
			{text}{" "}
			<span className="sr-only">
				{t("settings.fees.forMethod", { method })}
			</span>
		</>
	);
}

export interface FeeRowContext {
	readonly scope: FeeScope;
	readonly rows: readonly FeeRateRow[];
	readonly today: IsoDate;
	readonly canWrite: boolean;
	readonly formatters: Formatters;
	readonly currencyCode: string;
	readonly timeZone: string;
	readonly onEdit: (methodId: string, edit: FeeEdit) => void;
}

function RateHistoryList({
	method,
	scopeRows,
	inForceId,
	context,
}: {
	readonly method: FeeMethod;
	readonly scopeRows: readonly FeeRateRow[];
	readonly inForceId: string | null;
	readonly context: FeeRowContext;
}) {
	const t = useT();
	const listId = useId();
	const [open, setOpen] = useState(false);
	const { formatters } = context;
	return (
		<div className="space-y-2">
			<Button
				tone="secondary"
				size="compact"
				aria-expanded={open}
				aria-controls={listId}
				onClick={() => setOpen((shown) => !shown)}
				data-testid="fee-history-toggle"
			>
				{t("settings.fees.history.toggle", {
					count: formatters.count(scopeRows.length),
				})}
			</Button>
			<ul
				id={listId}
				hidden={!open}
				aria-label={t("settings.fees.history.label", { method: method.name })}
				className="space-y-2 rounded-lg border border-line bg-surface-sunken p-3"
				data-testid="fee-history"
			>
				{[...scopeRows].reverse().map((row) => {
					const rowText = t("settings.fees.history.row", {
						date: formatters.date(row.effectiveFrom),
						rate: rateText(t, row, formatters),
					});
					return (
						<li
							key={row.id}
							className="text-sm"
							data-testid="fee-history-row"
							data-date={row.effectiveFrom}
						>
							<p>
								{row.id === inForceId
									? `${rowText} · ${t("settings.fees.history.inForce")}`
									: rowText}
							</p>
							{row.audit === null ? null : (
								<AuditLine
									entry={row.audit}
									formatters={formatters}
									timeZone={context.timeZone}
								/>
							)}
						</li>
					);
				})}
			</ul>
		</div>
	);
}

export function FeeRow({
	method,
	edit,
	issues,
	context,
}: {
	readonly method: FeeMethod;
	readonly edit: FeeEdit | undefined;
	readonly issues: FeeFieldIssues | undefined;
	readonly context: FeeRowContext;
}) {
	const t = useT();
	const id = useId();
	const headingId = `${id}-method`;
	const { formatters } = context;
	const history = rateHistoryOf(context.rows, context.scope, method.externalId);
	const current = currentRateOf(history, context.today);
	const date = editedRateDateOf(edit, history, context.today);
	const inForceId =
		current === null || current.inherited ? null : current.row.id;
	const change = (next: Partial<FeeEdit>) =>
		context.onEdit(method.externalId, {
			percent: next.percent ?? edit?.percent ?? "",
			fixed: next.fixed ?? edit?.fixed ?? "",
			date: next.date ?? edit?.date ?? null,
		});
	return (
		<li
			className="space-y-2 border-b border-line py-3 last:border-b-0"
			data-testid="fee-row"
			data-method={method.externalId}
		>
			<h4 id={headingId} className="font-medium" data-testid="fee-method">
				{method.name}
			</h4>
			<p
				className="text-sm"
				data-testid="fee-current"
				data-inherited={current?.inherited ? "true" : undefined}
			>
				{current === null
					? t("settings.fees.current.none")
					: t(
							current.inherited
								? "settings.fees.current.inherited"
								: "settings.fees.current.own",
							{
								rate: rateText(t, current.row, formatters),
								date: formatters.date(current.row.effectiveFrom),
							},
						)}
			</p>
			{current?.row.audit ? (
				<AuditLine
					entry={current.row.audit}
					formatters={formatters}
					timeZone={context.timeZone}
				/>
			) : null}
			{context.canWrite ? (
				<fieldset
					aria-labelledby={headingId}
					className="grid gap-3 sm:grid-cols-3"
				>
					<PercentField
						id={`${id}-percent`}
						testId="fee-percent"
						label={
							<FieldName
								text={t("settings.fees.percent.label")}
								method={method.name}
							/>
						}
						hint={t("settings.fees.percent.hint")}
						error={issueText(t, issues?.percent ?? null, (bound) =>
							typeof bound === "number"
								? formatPercentBound(bound, formatters.locale)
								: bound,
						)}
						value={edit?.percent ?? ""}
						onChange={(percent) => change({ percent })}
						locale={formatters.locale}
					/>
					<MoneyField
						id={`${id}-fixed`}
						testId="fee-fixed"
						label={
							<FieldName
								text={t("settings.fees.fixed.label")}
								method={method.name}
							/>
						}
						hint={t("settings.fees.fixed.hint")}
						error={issueText(
							t,
							issues?.fixed ?? null,
							numericBound(formatters.moneyExact),
						)}
						value={edit?.fixed ?? ""}
						onChange={(fixed) => change({ fixed })}
						formatters={formatters}
						currencyCode={context.currencyCode}
					/>
					<DateField
						id={`${id}-date`}
						testId="fee-date"
						label={
							<FieldName
								text={t("settings.fees.date.label")}
								method={method.name}
							/>
						}
						hint={rateDateHintText(
							t,
							rateDateHintOf(history, date, context.today),
							formatters,
						)}
						error={issueText(
							t,
							issues?.date ?? null,
							dateBound(formatters.date),
						)}
						today={context.today}
						value={date}
						onChange={(text) => change({ date: text })}
					/>
				</fieldset>
			) : null}
			{history.own.length === 0 ? null : (
				<RateHistoryList
					method={method}
					scopeRows={history.own}
					inForceId={inForceId}
					context={context}
				/>
			)}
		</li>
	);
}
