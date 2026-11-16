import { useId, useState } from "react";
import { Button } from "../../components/ui/button";
import { type MessageKey, type Translate, useT } from "../../i18n";
import type { IsoDate } from "../../lib/business-dates";
import type { Formatters } from "../../lib/format";
import { AuditLine } from "../forms/audit-line";
import { DateField } from "../forms/date-field";
import { dateBound, issueText, numericBound } from "../forms/issue-text";
import { MoneyField } from "../forms/money-field";
import { UNAVAILABLE_CLASS } from "../forms/save-bar";
import {
	type CostEdit,
	type CostFieldIssues,
	type CostItem,
	type CostScope,
	costHistoryOf,
	costShareOf,
	currentCostOf,
	type DateHint,
	type DateHintKind,
	dateHintOf,
	editedDateOf,
	sizeShownOf,
} from "./costs";
import type { ItemCostRow } from "./source";

const DATE_HINT_KEYS: Readonly<
	Record<
		DateHintKind,
		{ readonly open: MessageKey; readonly until: MessageKey }
	>
> = {
	wholeHistory: {
		open: "settings.manual.costs.date.wholeHistory",
		until: "settings.manual.costs.date.wholeHistoryUntil",
	},
	keepsEarlier: {
		open: "settings.manual.costs.date.keepsEarlier",
		until: "settings.manual.costs.date.keepsEarlierUntil",
	},
	keepsShared: {
		open: "settings.manual.costs.date.keepsShared",
		until: "settings.manual.costs.date.keepsSharedUntil",
	},
	replacesShared: {
		open: "settings.manual.costs.date.replacesShared",
		until: "settings.manual.costs.date.replacesSharedUntil",
	},
	replaces: {
		open: "settings.manual.costs.date.replaces",
		until: "settings.manual.costs.date.replaces",
	},
	fromDate: {
		open: "settings.manual.costs.date.fromDate",
		until: "settings.manual.costs.date.fromDateUntil",
	},
};

export function dateHintText(
	t: Translate,
	hint: DateHint,
	formatters: Formatters,
): string {
	const keys = DATE_HINT_KEYS[hint.kind];
	return hint.until === null
		? t(keys.open)
		: t(keys.until, { date: formatters.date(hint.until) });
}

export function costItemLabel(
	t: Translate,
	item: Pick<CostItem, "name" | "sizeLabel">,
): string {
	const size = sizeShownOf(item);
	return size === null
		? item.name
		: t("settings.manual.costs.item.withSize", { name: item.name, size });
}

function factsOf(t: Translate, item: CostItem, formatters: Formatters): string {
	const parts = [
		item.category ?? t("settings.manual.costs.item.noCategory"),
		item.listPrice === null
			? t("settings.manual.costs.item.noPrice")
			: t("settings.manual.costs.item.price", {
					price: formatters.moneyExact(item.listPrice),
				}),
	];
	if (item.soldAmount !== null) {
		parts.push(
			t("settings.manual.costs.item.sold", {
				amount: formatters.moneyCompact(item.soldAmount),
			}),
		);
	}
	return parts.join(" · ");
}

export interface CostRowContext {
	readonly storeId: CostScope;
	readonly rows: readonly ItemCostRow[];
	readonly today: IsoDate;
	readonly canWrite: boolean;
	readonly busy: boolean;
	readonly formatters: Formatters;
	readonly currencyCode: string;
	readonly timeZone: string;
	readonly onEdit: (itemExternalId: string, edit: CostEdit) => void;
	readonly onDelete: (row: ItemCostRow, itemLabel: string) => void;
}

function CurrentCost({
	item,
	context,
}: {
	readonly item: CostItem;
	readonly context: CostRowContext;
}) {
	const t = useT();
	const { formatters } = context;
	const current = currentCostOf(
		context.rows,
		context.storeId,
		item.itemExternalId,
		context.today,
	);
	if (current === null) {
		return (
			<p className="text-sm" data-testid="cost-current">
				{t("settings.manual.costs.current.none")}
			</p>
		);
	}
	const { row } = current;
	const share = costShareOf(row.costAmount, item.listPrice);
	const text = t(
		current.inherited
			? "settings.manual.costs.current.inherited"
			: "settings.manual.costs.current.own",
		{
			cost: formatters.moneyExact(row.costAmount),
			date: formatters.date(row.effectiveFrom),
		},
	);
	return (
		<>
			<p
				className="text-sm"
				data-testid="cost-current"
				data-inherited={current.inherited ? "true" : undefined}
			>
				{share === null
					? text
					: `${text} · ${t("settings.manual.costs.current.share", {
							share: formatters.percent(share),
						})}`}
			</p>
			{row.audit === null ? null : (
				<AuditLine
					entry={row.audit}
					formatters={formatters}
					timeZone={context.timeZone}
				/>
			)}
		</>
	);
}

function CostHistoryList({
	label,
	scopeRows,
	inForceId,
	context,
}: {
	readonly label: string;
	readonly scopeRows: readonly ItemCostRow[];
	readonly inForceId: string | null;
	readonly context: CostRowContext;
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
				data-testid="cost-history-toggle"
			>
				{t("settings.manual.costs.history.toggle", {
					count: formatters.count(scopeRows.length),
				})}
			</Button>
			<ul
				id={listId}
				hidden={!open}
				aria-label={t("settings.manual.costs.history.label", { item: label })}
				className="space-y-2 rounded-lg border border-line bg-surface-sunken p-3"
				data-testid="cost-history"
			>
				{[...scopeRows].reverse().map((row) => {
					const date = formatters.date(row.effectiveFrom);
					const rowText = t("settings.manual.costs.history.row", {
						date,
						cost: formatters.moneyExact(row.costAmount),
					});
					return (
						<li
							key={row.id}
							className="flex flex-wrap items-center justify-between gap-2"
							data-testid="cost-history-row"
							data-date={row.effectiveFrom}
						>
							<div className="min-w-0 text-sm">
								<p>
									{row.id === inForceId
										? `${rowText} · ${t("settings.manual.costs.history.inForce")}`
										: rowText}
								</p>
								{row.audit === null ? null : (
									<AuditLine
										entry={row.audit}
										formatters={formatters}
										timeZone={context.timeZone}
									/>
								)}
							</div>
							{context.canWrite ? (
								<Button
									tone="secondary"
									size="compact"
									aria-label={t("settings.manual.costs.history.deleteLabel", {
										date,
										item: label,
									})}
									aria-disabled={context.busy || undefined}
									onClick={
										context.busy
											? undefined
											: () => context.onDelete(row, label)
									}
									className={UNAVAILABLE_CLASS}
									data-testid="cost-delete"
								>
									{t("settings.manual.costs.history.delete")}
								</Button>
							) : null}
						</li>
					);
				})}
			</ul>
		</div>
	);
}

export function CostRow({
	item,
	edit,
	issues,
	context,
}: {
	readonly item: CostItem;
	readonly edit: CostEdit | undefined;
	readonly issues: CostFieldIssues | undefined;
	readonly context: CostRowContext;
}) {
	const t = useT();
	const id = useId();
	const headingId = `${id}-item`;
	const { formatters } = context;
	const label = costItemLabel(t, item);
	const history = costHistoryOf(
		context.rows,
		context.storeId,
		item.itemExternalId,
	);
	const scopeRows = history.own;
	const date = editedDateOf(edit, history, context.today);
	const current = currentCostOf(
		context.rows,
		context.storeId,
		item.itemExternalId,
		context.today,
	);
	const inForceId =
		current === null || current.inherited ? null : current.row.id;
	const change = (next: Partial<CostEdit>) =>
		context.onEdit(item.itemExternalId, {
			cost: next.cost ?? edit?.cost ?? "",
			date: next.date ?? edit?.date ?? null,
		});
	return (
		<li
			className="space-y-2 border-b border-line py-3 last:border-b-0"
			data-testid="cost-row"
			data-item={item.itemExternalId}
		>
			<h4 id={headingId} className="font-medium" data-testid="cost-item">
				{label}
			</h4>
			<p className="text-sm text-ink-muted" data-testid="cost-facts">
				{factsOf(t, item, formatters)}
			</p>
			<CurrentCost item={item} context={context} />
			{context.canWrite ? (
				<fieldset
					aria-labelledby={headingId}
					className="grid gap-3 sm:grid-cols-2"
				>
					<MoneyField
						id={`${id}-cost`}
						testId="cost-amount"
						label={t("settings.manual.costs.new.label")}
						error={issueText(
							t,
							issues?.cost ?? null,
							numericBound(formatters.moneyExact),
						)}
						value={edit?.cost ?? ""}
						onChange={(cost) => change({ cost })}
						formatters={formatters}
						currencyCode={context.currencyCode}
					/>
					<DateField
						id={`${id}-date`}
						testId="cost-date"
						label={t("settings.manual.costs.date.label")}
						hint={dateHintText(
							t,
							dateHintOf(history, date, context.today),
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
			{scopeRows.length === 0 ? null : (
				<CostHistoryList
					label={label}
					scopeRows={scopeRows}
					inForceId={inForceId}
					context={context}
				/>
			)}
		</li>
	);
}
