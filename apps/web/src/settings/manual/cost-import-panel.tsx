import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Button } from "../../components/ui/button";
import { cn } from "../../components/ui/cn";
import { type MessageKey, type Translate, useT } from "../../i18n";
import type { IsoDate } from "../../lib/business-dates";
import { downloadTextFile } from "../../lib/csv";
import type { DateOrder } from "../../lib/csv-parse";
import type { Formatters } from "../../lib/format";
import { useCsvDialect } from "../../state/csv-dialect";
import { UNAVAILABLE_CLASS } from "../forms/save-bar";
import type { SaveOutcome } from "../forms/save-outcome";
import {
	COST_IMPORT_MAX_BYTES,
	COST_IMPORT_MAX_ROWS,
	type CostFile,
	type CostFileProblem,
	type CostImportContext,
	type CostImportIssue,
	type CostImportOutcome,
	type CostImportPreview,
	type CostImportRow,
	costImportPreview,
	costTemplateCsv,
	costTemplateFileName,
	DEFAULT_DATE_ORDER,
	isProblemOutcome,
	readCostFile,
	shownImportRows,
} from "./cost-import";
import { costItemLabel } from "./cost-row";
import type { CostItem, CostScope } from "./costs";
import type { ItemCostChange, ItemCostRow } from "./source";

export const IMPORT_PAGE_SIZE = 100;

const DATE_ORDERS: readonly DateOrder[] = ["dmy", "mdy"];

const DATE_ORDER_KEYS: Readonly<Record<DateOrder, MessageKey>> = {
	dmy: "settings.manual.import.dateOrder.dmy",
	mdy: "settings.manual.import.dateOrder.mdy",
};

const ISSUE_KEYS: Readonly<Record<CostImportIssue["key"], MessageKey>> = {
	itemNotListed: "settings.manual.import.issue.itemNotListed",
	costRequired: "settings.manual.import.issue.costRequired",
	costNotAmount: "settings.manual.import.issue.costNotAmount",
	costWholeDong: "settings.manual.import.wholeDong",
	costDecimals: "settings.manual.import.issue.costDecimals",
	costAtLeast: "settings.manual.import.issue.costAtLeast",
	costAtMost: "settings.manual.import.issue.costAtMost",
	dateBlank: "settings.manual.import.issue.dateBlank",
	dateBlankInherited: "settings.manual.import.issue.dateBlankInherited",
	dateUnreadable: "settings.manual.import.issue.dateUnreadable",
	dateOtherOrder: "settings.manual.import.issue.dateOtherOrder",
	dateRange: "settings.manual.import.issue.dateRange",
};

const OUTCOME_TONES: Readonly<Record<CostImportOutcome, string>> = {
	ok: "text-positive",
	cost_above_price: "text-warning",
	unchanged: "text-ink-muted",
	duplicate_in_file: "text-ink-muted",
	unknown_item: "text-negative",
	unknown_store: "text-negative",
	ambiguous_store: "text-negative",
	out_of_scope: "text-negative",
	invalid_cost: "text-negative",
	invalid_date: "text-negative",
};

interface ChosenFile {
	readonly serial: number;
	readonly name: string;
	readonly read: CostFile;
}

export interface CostImportPanelProps {
	readonly storeId: CostScope;
	readonly storeCode: string | null;
	readonly items: readonly CostItem[];
	readonly rows: readonly ItemCostRow[];
	readonly today: IsoDate;
	readonly context: CostImportContext;
	readonly canWrite: boolean;
	readonly formatters: Formatters;
	readonly storeName: (storeId: string) => string;
	readonly saving: boolean;
	readonly busy: boolean;
	readonly outcome: SaveOutcome;
	readonly onSave: (changes: readonly ItemCostChange[]) => Promise<boolean>;
	readonly onReset: () => void;
	readonly onOpenChange: (open: boolean) => void;
}

function issueText(
	t: Translate,
	issue: CostImportIssue,
	formatters: Formatters,
): string {
	switch (issue.key) {
		case "costAtLeast":
			return t(ISSUE_KEYS[issue.key], {
				min: formatters.moneyExact(issue.min),
			});
		case "costAtMost":
			return t(ISSUE_KEYS[issue.key], {
				max: formatters.moneyExact(issue.max),
			});
		case "costDecimals":
			return t(ISSUE_KEYS[issue.key], { digits: issue.digits });
		case "dateRange":
			return t(ISSUE_KEYS[issue.key], {
				min: formatters.date(issue.min),
				max: formatters.date(issue.max),
			});
		default:
			return t(ISSUE_KEYS[issue.key]);
	}
}

function storeLabelOf(
	t: Translate,
	row: CostImportRow,
	storeName: (storeId: string) => string,
): string {
	if (row.storeId === null) return t("settings.manual.costs.scope.all");
	if (row.storeId !== undefined) return storeName(row.storeId);
	return t("settings.manual.import.row.storeCode", { code: row.storeCode });
}

export function outcomeText(
	t: Translate,
	row: CostImportRow,
	formatters: Formatters,
	storeName: (storeId: string) => string,
): string {
	switch (row.outcome) {
		case "ok":
			return t("settings.manual.import.outcome.ok");
		case "cost_above_price":
			return t("settings.manual.import.outcome.costAbovePrice", {
				price: formatters.moneyExact(row.listPrice ?? 0),
			});
		case "unchanged":
			return t("settings.manual.import.outcome.unchanged");
		case "duplicate_in_file":
			return t("settings.manual.import.outcome.duplicate", {
				line: formatters.count(row.usedLine ?? row.line),
			});
		case "unknown_item":
			if (row.issue?.key === "itemNotListed") {
				return t("settings.manual.import.issue.itemNotListed", {
					code: row.itemExternalId,
					store: storeLabelOf(t, row, storeName),
				});
			}
			return t(
				row.itemExternalId === ""
					? "settings.manual.import.outcome.noItemCode"
					: "settings.manual.import.outcome.unknownItem",
				{ code: row.itemExternalId },
			);
		case "unknown_store":
			return t("settings.manual.import.outcome.unknownStore", {
				code: row.storeCode,
			});
		case "ambiguous_store":
			return t("settings.manual.import.outcome.ambiguousStore", {
				code: row.storeCode,
			});
		case "out_of_scope":
			return t("settings.manual.import.outcome.outOfScope", {
				store: storeLabelOf(t, row, storeName),
			});
		case "invalid_cost":
		case "invalid_date":
			return row.issue === null
				? t("settings.manual.import.issue.costNotAmount")
				: issueText(t, row.issue, formatters);
	}
}

function valuesOf(
	t: Translate,
	row: CostImportRow,
	formatters: Formatters,
	storeName: (storeId: string) => string,
): string {
	const cost =
		row.costAmount !== null
			? formatters.moneyExact(row.costAmount)
			: row.costText === ""
				? t("settings.manual.import.row.noCost")
				: t("settings.manual.import.row.costAsWritten", { text: row.costText });
	const date =
		row.effectiveFrom !== null
			? t("settings.manual.import.row.from", {
					date: formatters.date(row.effectiveFrom),
				})
			: row.dateText === ""
				? t("settings.manual.import.row.noDate")
				: t("settings.manual.import.row.dateAsWritten", { text: row.dateText });
	return [storeLabelOf(t, row, storeName), cost, date].join(" · ");
}

function itemLabelOf(t: Translate, row: CostImportRow): string {
	if (row.item !== null) return costItemLabel(t, row.item);
	if (row.fileItemName !== "") return row.fileItemName;
	return row.itemExternalId;
}

function problemText(
	t: Translate,
	problem: CostFileProblem,
	formatters: Formatters,
): string {
	switch (problem.kind) {
		case "oversized":
			return t("settings.manual.import.file.oversized", {
				size: formatters.count(COST_IMPORT_MAX_BYTES / 1024 / 1024),
			});
		case "unreadable":
			return t(
				problem.error === "unterminatedQuote"
					? "settings.manual.import.file.unterminatedQuote"
					: "settings.manual.import.file.textAfterQuote",
				{ line: formatters.count(problem.line) },
			);
		case "missingColumns":
			return t("settings.manual.import.file.missingColumns", {
				columns: problem.columns.join(", "),
			});
		case "noRows":
			return t("settings.manual.import.file.noRows");
	}
}

function ImportRowItem({
	row,
	formatters,
	storeName,
}: {
	readonly row: CostImportRow;
	readonly formatters: Formatters;
	readonly storeName: (storeId: string) => string;
}) {
	const t = useT();
	return (
		<li
			className="space-y-0.5 border-b border-line py-2 text-sm last:border-b-0"
			data-testid="cost-import-row"
			data-line={row.line}
			data-item={row.itemExternalId}
			data-outcome={row.outcome}
		>
			<p className="font-medium">
				{[
					t("settings.manual.import.row.line", {
						line: formatters.count(row.line),
					}),
					itemLabelOf(t, row),
				].join(" · ")}
			</p>
			<p className="text-ink-muted" data-testid="cost-import-row-values">
				{valuesOf(t, row, formatters, storeName)}
			</p>
			<p
				className={cn("font-medium", OUTCOME_TONES[row.outcome])}
				data-testid="cost-import-row-outcome"
			>
				{outcomeText(t, row, formatters, storeName)}
			</p>
			{row.replacesLines.length > 0 ? (
				<p className="text-ink-muted" data-testid="cost-import-row-replaces">
					{t("settings.manual.import.row.replaces", {
						lines: row.replacesLines
							.map((line) => formatters.count(line))
							.join(", "),
					})}
				</p>
			) : null}
		</li>
	);
}

function DateOrderChoice({
	order,
	onChange,
}: {
	readonly order: DateOrder;
	readonly onChange: (order: DateOrder) => void;
}) {
	const t = useT();
	const id = useId();
	return (
		<fieldset
			aria-describedby={`${id}-hint`}
			className="space-y-2"
			data-testid="cost-import-date-order"
		>
			<legend className="text-sm font-medium">
				{t("settings.manual.import.dateOrder.legend")}
			</legend>
			<p id={`${id}-hint`} className="text-sm text-ink-muted">
				{t("settings.manual.import.dateOrder.hint")}
			</p>
			{DATE_ORDERS.map((each) => (
				<label
					key={each}
					className="flex min-h-11 items-center gap-3 rounded-lg border border-line px-3 py-2 has-checked:border-accent"
				>
					<input
						type="radio"
						name={`${id}-date-order`}
						className="size-6 shrink-0 accent-accent"
						checked={order === each}
						onChange={() => onChange(each)}
						data-testid={`cost-import-order-${each}`}
					/>
					<span>{t(DATE_ORDER_KEYS[each])}</span>
				</label>
			))}
		</fieldset>
	);
}

function SummaryLine({
	messageKey,
	count,
	formatters,
	testId,
	scopeName,
}: {
	readonly messageKey: MessageKey;
	readonly count: number;
	readonly formatters: Formatters;
	readonly testId: string;
	readonly scopeName: string;
}) {
	const t = useT();
	return (
		<li data-testid={testId}>
			{t(messageKey, { count: formatters.count(count), scope: scopeName })}
		</li>
	);
}

function ImportSummary({
	preview,
	formatters,
	scopeName,
}: {
	readonly preview: CostImportPreview;
	readonly formatters: Formatters;
	readonly scopeName: string;
}) {
	const { counts } = preview;
	const problems = Object.entries(counts)
		.filter(([outcome]) => isProblemOutcome(outcome as CostImportOutcome))
		.reduce((total, [, count]) => total + count, 0);
	const lines: readonly {
		readonly key: MessageKey;
		readonly count: number;
		readonly testId: string;
		readonly always?: boolean;
	}[] = [
		{
			key: "settings.manual.import.summary.save",
			count: preview.changes.length,
			testId: "cost-import-summary-save",
			always: true,
		},
		{
			key: "settings.manual.import.summary.abovePrice",
			count: counts.cost_above_price,
			testId: "cost-import-summary-above-price",
		},
		{
			key: "settings.manual.import.summary.unchanged",
			count: counts.unchanged,
			testId: "cost-import-summary-unchanged",
		},
		{
			key: "settings.manual.import.summary.problems",
			count: problems,
			testId: "cost-import-summary-problems",
		},
		{
			key: "settings.manual.import.summary.duplicates",
			count: counts.duplicate_in_file,
			testId: "cost-import-summary-duplicates",
		},
		{
			key: "settings.manual.import.summary.blank",
			count: preview.blankCount,
			testId: "cost-import-summary-blank",
		},
		{
			key: "settings.manual.import.summary.blankCode",
			count: preview.blankCodeCount,
			testId: "cost-import-summary-blank-code",
		},
	];
	return (
		<ul
			className="list-disc space-y-1 ps-5 text-sm"
			data-testid="cost-import-summary"
		>
			{lines
				.filter((line) => line.always === true || line.count > 0)
				.map((line) => (
					<SummaryLine
						key={line.testId}
						messageKey={line.key}
						count={line.count}
						formatters={formatters}
						testId={line.testId}
						scopeName={scopeName}
					/>
				))}
		</ul>
	);
}

function SaveRefusal({ outcome }: { readonly outcome: SaveOutcome }) {
	const t = useT();
	if (outcome.kind !== "refused") return null;
	return (
		<div
			role="alert"
			className="space-y-1 text-sm text-negative"
			data-testid="cost-import-refused"
		>
			<p>{t(outcome.messageKey)}</p>
			<p>
				{t(
					outcome.canRetry
						? "settings.manual.import.nothingSaved"
						: "settings.manual.import.nothingSavedFix",
				)}
			</p>
		</div>
	);
}

function ImportPreview({
	fileName,
	preview,
	order,
	onOrderChange,
	formatters,
	storeName,
	scopeName,
	saving,
	busy,
	outcome,
	onSave,
	onCancel,
}: {
	readonly fileName: string;
	readonly preview: CostImportPreview;
	readonly order: DateOrder;
	readonly onOrderChange: (order: DateOrder) => void;
	readonly formatters: Formatters;
	readonly storeName: (storeId: string) => string;
	readonly scopeName: string;
	readonly saving: boolean;
	readonly busy: boolean;
	readonly outcome: SaveOutcome;
	readonly onSave: () => void;
	readonly onCancel: () => void;
}) {
	const t = useT();
	const id = useId();
	const heading = useRef<HTMLHeadingElement>(null);
	const [limit, setLimit] = useState(IMPORT_PAGE_SIZE);
	useEffect(() => {
		heading.current?.focus();
	}, []);
	const shown = shownImportRows(preview.rows);
	const count = preview.changes.length;
	const refusedForGood = outcome.kind === "refused" && !outcome.canRetry;
	const canSave = count > 0 && !preview.tooMany && !busy && !refusedForGood;
	return (
		<section
			aria-labelledby={`${id}-title`}
			className="space-y-3 rounded-lg border border-line bg-surface-raised p-3"
			data-testid="cost-import-preview"
		>
			<h4
				id={`${id}-title`}
				ref={heading}
				tabIndex={-1}
				className="font-medium"
				data-testid="cost-import-preview-title"
			>
				{t("settings.manual.import.previewTitle", { file: fileName })}
			</h4>
			{preview.dates.needsChoice ? (
				<DateOrderChoice order={order} onChange={onOrderChange} />
			) : null}
			{preview.dates.detected === "conflict" ? (
				<p className="text-sm" data-testid="cost-import-date-conflict">
					{t("settings.manual.import.dateOrder.conflict", {
						order: t(DATE_ORDER_KEYS[preview.dates.used]),
					})}
				</p>
			) : null}
			<ImportSummary
				preview={preview}
				formatters={formatters}
				scopeName={scopeName}
			/>
			{shown.length > 0 ? (
				<ol data-testid="cost-import-rows">
					{shown.slice(0, limit).map((row) => (
						<ImportRowItem
							key={row.line}
							row={row}
							formatters={formatters}
							storeName={storeName}
						/>
					))}
				</ol>
			) : null}
			{shown.length > limit ? (
				<Button
					tone="secondary"
					size="compact"
					onClick={() => setLimit((current) => current + IMPORT_PAGE_SIZE)}
					data-testid="cost-import-more"
				>
					{t("settings.manual.import.more", {
						count: formatters.count(
							Math.min(IMPORT_PAGE_SIZE, shown.length - limit),
						),
					})}
				</Button>
			) : null}
			{preview.tooMany ? (
				<p
					role="alert"
					className="text-sm text-negative"
					data-testid="cost-import-too-many"
				>
					{t("settings.manual.import.tooMany", {
						count: formatters.count(count),
						max: formatters.count(COST_IMPORT_MAX_ROWS),
					})}
				</p>
			) : count === 0 ? (
				<p className="text-sm" data-testid="cost-import-nothing">
					{t("settings.manual.import.nothing")}
				</p>
			) : (
				<p className="text-sm text-ink-muted">
					{t("settings.manual.import.allOrNothing")}
				</p>
			)}
			<SaveRefusal outcome={outcome} />
			<div className="flex flex-wrap items-center gap-2">
				<Button
					tone="secondary"
					size="compact"
					aria-disabled={busy || undefined}
					onClick={busy ? undefined : onCancel}
					className={UNAVAILABLE_CLASS}
					data-testid="cost-import-cancel"
				>
					{t("settings.manual.import.cancel")}
				</Button>
				<Button
					size="compact"
					aria-disabled={!canSave || undefined}
					aria-busy={saving || undefined}
					onClick={canSave ? onSave : undefined}
					className={UNAVAILABLE_CLASS}
					data-testid="cost-import-save"
				>
					{saving
						? t("settings.saving")
						: t("settings.manual.import.save", {
								count: formatters.count(count),
							})}
				</Button>
			</div>
		</section>
	);
}

export function CostImportPanel({
	storeId,
	storeCode,
	items,
	rows,
	today,
	context,
	canWrite,
	formatters,
	storeName,
	saving,
	busy,
	outcome,
	onSave,
	onReset,
	onOpenChange,
}: CostImportPanelProps) {
	const t = useT();
	const id = useId();
	const dialect = useCsvDialect();
	const input = useRef<HTMLInputElement>(null);
	const importButton = useRef<HTMLButtonElement>(null);
	const [chosen, setChosen] = useState<ChosenFile | null>(null);
	const [order, setOrder] = useState<DateOrder>(DEFAULT_DATE_ORDER);
	const [saved, setSaved] = useState<{
		readonly count: number;
		readonly name: string;
	} | null>(null);
	const lines = chosen?.read.ok ? chosen.read.lines : null;
	const preview = useMemo(
		() => (lines === null ? null : costImportPreview(lines, order, context)),
		[lines, order, context],
	);

	const close = () => {
		setChosen(null);
		onOpenChange(false);
		importButton.current?.focus();
	};

	const choose = async (file: File | undefined) => {
		if (file === undefined) return;
		onReset();
		setSaved(null);
		setOrder(DEFAULT_DATE_ORDER);
		const read: CostFile =
			file.size > COST_IMPORT_MAX_BYTES
				? { ok: false, problem: { kind: "oversized" } }
				: readCostFile(await file.text());
		setChosen((previous) => ({
			serial: (previous?.serial ?? 0) + 1,
			name: file.name,
			read,
		}));
		onOpenChange(read.ok);
	};

	const save = () => {
		if (chosen === null || preview === null) return;
		const changes = preview.changes;
		const name = chosen.name;
		void onSave(changes).then((ok) => {
			if (!ok) return;
			setSaved({ count: changes.length, name });
			close();
		});
	};

	const download = () =>
		downloadTextFile(
			costTemplateFileName(storeId, storeCode, today),
			costTemplateCsv({ items, storeId, storeCode, rows, today }, dialect),
			"text/csv;charset=utf-8",
		);

	return (
		<section
			aria-labelledby={`${id}-title`}
			className="space-y-3 break-words rounded-xl border border-line bg-surface-raised px-4 py-3"
			data-testid="costs-csv"
		>
			<h3 id={`${id}-title`} className="text-base font-semibold">
				{t("settings.manual.import.title")}
			</h3>
			<p className="text-sm text-ink-muted">
				{t(
					canWrite
						? "settings.manual.import.intro"
						: "settings.manual.import.introReadOnly",
				)}
			</p>
			<div className="flex flex-wrap items-center gap-2">
				<Button
					tone="secondary"
					size="compact"
					onClick={download}
					data-testid="costs-template"
				>
					{t("settings.manual.import.template")}
				</Button>
				{canWrite ? (
					<>
						<Button
							ref={importButton}
							tone="secondary"
							size="compact"
							aria-disabled={busy || undefined}
							onClick={busy ? undefined : () => input.current?.click()}
							className={UNAVAILABLE_CLASS}
							data-testid="costs-import"
						>
							{t("settings.manual.import.choose")}
						</Button>
						<input
							ref={input}
							type="file"
							accept=".csv,text/csv"
							tabIndex={-1}
							aria-label={t("settings.manual.import.fileLabel")}
							className="hidden"
							onChange={(event) => {
								const file = event.target.files?.[0];
								event.target.value = "";
								void choose(file);
							}}
							data-testid="costs-import-file"
						/>
					</>
				) : null}
			</div>
			{saved !== null ? (
				<p
					role="status"
					className="text-sm text-positive"
					data-testid="cost-import-saved"
				>
					{t("settings.manual.import.saved", {
						count: formatters.count(saved.count),
						file: saved.name,
					})}
				</p>
			) : null}
			{chosen !== null && !chosen.read.ok ? (
				<div
					role="alert"
					className="space-y-2 text-sm"
					data-testid="cost-import-problem"
				>
					<p className="text-negative">
						{problemText(t, chosen.read.problem, formatters)}
					</p>
					<Button tone="secondary" size="compact" onClick={close}>
						{t("settings.manual.import.cancel")}
					</Button>
				</div>
			) : null}
			{chosen !== null && preview !== null ? (
				<ImportPreview
					key={chosen.serial}
					fileName={chosen.name}
					preview={preview}
					order={order}
					onOrderChange={(next) => {
						onReset();
						setOrder(next);
					}}
					formatters={formatters}
					storeName={storeName}
					scopeName={
						storeId === null
							? t("settings.manual.costs.scope.all")
							: storeName(storeId)
					}
					saving={saving}
					busy={busy}
					outcome={outcome}
					onSave={save}
					onCancel={() => {
						onReset();
						close();
					}}
				/>
			) : null}
		</section>
	);
}
