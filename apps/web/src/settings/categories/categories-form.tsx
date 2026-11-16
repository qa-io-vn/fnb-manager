import { type ReactNode, useId, useMemo, useState } from "react";
import { Button } from "../../components/ui/button";
import { cn } from "../../components/ui/cn";
import { useT } from "../../i18n";
import type { Formatters } from "../../lib/format";
import { AuditLine } from "../forms/audit-line";
import { useSyncedDraft } from "../forms/draft";
import { controlClass, Field } from "../forms/field";
import { SaveBar } from "../forms/save-bar";
import {
	RetrySave,
	type SaveOutcome,
	saveStatusOf,
} from "../forms/save-outcome";
import type {
	CategoryOverrideChange,
	ItemEntry,
	ItemTypeEntry,
} from "../source";
import {
	type AccountTypes,
	type CategoryDraft,
	categoryChangesOf,
	itemKeyOf,
	overriddenItems,
	posCategoryOf,
	savedCategoryDraftOf,
	searchItems,
	sizeToShow,
	typesByAccount,
	uncategorisedEntries,
	withSoldItems,
} from "./categories";
import type { UncategorisedSales } from "./use-uncategorised-sales";

export interface CategoriesFormProps {
	readonly entries: readonly ItemEntry[];
	readonly itemTypes: readonly ItemTypeEntry[];
	readonly sales: UncategorisedSales;
	readonly formatters: Formatters;
	readonly timeZone: string;
	readonly canWrite: boolean;
	readonly saving: boolean;
	readonly outcome: SaveOutcome;
	readonly onSave: (changes: readonly CategoryOverrideChange[]) => void;
	readonly onRetry: () => void;
	readonly onEdit: () => void;
}

const FOLLOW_POS = "";

interface TypeOption {
	readonly value: string;
	readonly label: string;
}

function accountNamesOf(
	entries: readonly ItemEntry[],
	itemTypes: readonly ItemTypeEntry[],
): ReadonlyMap<string, string> | null {
	const accounts = new Set(entries.map((entry) => entry.posAccountId));
	if (accounts.size < 2) return null;
	return new Map(
		itemTypes.map((type) => [type.posAccountId, type.posAccountName]),
	);
}

interface RowContext {
	readonly types: AccountTypes;
	readonly accountNames: ReadonlyMap<string, string> | null;
	readonly formatters: Formatters;
	readonly timeZone: string;
	readonly readOnly: boolean;
	readonly draft: CategoryDraft;
	readonly onChange: (entry: ItemEntry, chosen: string | null) => void;
}

function useTypeOptions(
	entry: ItemEntry,
	types: AccountTypes,
	chosen: string | null,
): TypeOption[] {
	const t = useT();
	const accountTypes = types.get(entry.posAccountId) ?? [];
	const options: TypeOption[] = [
		{ value: FOLLOW_POS, label: t("settings.mapping.followPos") },
		...accountTypes.map((type) => ({
			value: type.itemTypeExternalId,
			label: type.name,
		})),
	];
	if (
		chosen !== null &&
		!accountTypes.some((type) => type.itemTypeExternalId === chosen)
	) {
		options.push({
			value: chosen,
			label: t("settings.mapping.categories.typeGone", { type: chosen }),
		});
	}
	return options;
}

function useHintOf(
	entry: ItemEntry,
	types: AccountTypes,
	accountNames: ReadonlyMap<string, string> | null,
): string {
	const t = useT();
	const pos = posCategoryOf(entry, types);
	const posText =
		pos.kind === "known"
			? pos.type.name
			: pos.kind === "missing"
				? t("settings.mapping.categories.posNone")
				: t("settings.mapping.categories.posUnknown", {
						type: pos.itemTypeExternalId,
					});
	const parts = [t("settings.mapping.categories.onPos", { type: posText })];
	const accountName = accountNames?.get(entry.posAccountId);
	if (accountName !== undefined) parts.push(accountName);
	if (!entry.inCatalogue) {
		parts.push(t("settings.mapping.categories.notInCatalogue"));
	} else if (!entry.active) {
		parts.push(t("settings.mapping.categories.inactive"));
	}
	return parts.join(" · ");
}

function CategoryRow({
	entry,
	context,
}: {
	readonly entry: ItemEntry;
	readonly context: RowContext;
}) {
	const t = useT();
	const controlId = useId();
	const chosen = context.draft[itemKeyOf(entry)] ?? null;
	const options = useTypeOptions(entry, context.types, chosen);
	const hint = useHintOf(entry, context.types, context.accountNames);
	const size = sizeToShow(entry);
	const label =
		size === null
			? entry.name
			: t("settings.mapping.categories.withSize", { name: entry.name, size });
	const value = chosen ?? FOLLOW_POS;
	return (
		<li
			className="border-b border-line py-3 last:border-b-0"
			data-testid="category-row"
			data-item={entry.itemExternalId}
			data-account={entry.posAccountId}
		>
			<Field
				id={controlId}
				label={label}
				hint={hint}
				readOnly={context.readOnly}
			>
				{(control) =>
					context.readOnly ? (
						<input
							{...control}
							type="text"
							value={
								options.find((option) => option.value === value)?.label ?? ""
							}
							className={cn(controlClass, "sm:max-w-72")}
							data-testid="category-select"
						/>
					) : (
						<select
							id={control.id}
							aria-describedby={control["aria-describedby"]}
							value={value}
							onChange={(event) => {
								const next = event.target.value;
								context.onChange(entry, next === FOLLOW_POS ? null : next);
							}}
							className={cn(controlClass, "sm:max-w-72")}
							data-testid="category-select"
						>
							{options.map((option) => (
								<option key={option.value} value={option.value}>
									{option.label}
								</option>
							))}
						</select>
					)
				}
			</Field>
			{entry.audit === null ? null : (
				<AuditLine
					entry={entry.audit}
					formatters={context.formatters}
					timeZone={context.timeZone}
				/>
			)}
		</li>
	);
}

function CategoryList({
	entries,
	list,
	context,
}: {
	readonly entries: readonly ItemEntry[];
	readonly list: string;
	readonly context: RowContext;
}) {
	return (
		<ul data-testid={`categories-${list}-list`}>
			{entries.map((entry) => (
				<CategoryRow key={itemKeyOf(entry)} entry={entry} context={context} />
			))}
		</ul>
	);
}

function CategorySection({
	list,
	title,
	hint,
	children,
}: {
	readonly list: string;
	readonly title: string;
	readonly hint?: string;
	readonly children: ReactNode;
}) {
	const headingId = useId();
	return (
		<section
			aria-labelledby={headingId}
			className="space-y-2 rounded-xl border border-line bg-surface-raised px-4 py-3"
			data-testid={`categories-${list}`}
		>
			<h3 id={headingId} className="text-base font-semibold">
				{title}
			</h3>
			{hint === undefined ? null : (
				<p className="text-sm text-ink-muted">{hint}</p>
			)}
			{children}
		</section>
	);
}

function SearchSection({
	entries,
	types,
	firstKeys,
	formatters,
	context,
}: {
	readonly entries: readonly ItemEntry[];
	readonly types: AccountTypes;
	readonly firstKeys: ReadonlySet<string>;
	readonly formatters: Formatters;
	readonly context: RowContext;
}) {
	const t = useT();
	const [query, setQuery] = useState("");
	const result = useMemo(
		() => searchItems(entries, types, query, firstKeys),
		[entries, types, query, firstKeys],
	);
	const searching = query.trim() !== "";
	const statusText = !searching
		? ""
		: result.total === 0
			? t("settings.mapping.categories.search.none")
			: result.total > result.items.length
				? t("settings.mapping.categories.search.more", {
						shown: formatters.count(result.items.length),
						count: formatters.count(result.total),
					})
				: t("settings.mapping.categories.search.found", {
						count: formatters.count(result.total),
					});
	return (
		<CategorySection
			list="search"
			title={t("settings.mapping.categories.search.title")}
		>
			<Field
				id="categories-search-input"
				label={t("settings.mapping.categories.search.label")}
				hint={t("settings.mapping.categories.search.hint", {
					count: formatters.count(entries.length),
				})}
			>
				{(control) => (
					<input
						id={control.id}
						aria-describedby={control["aria-describedby"]}
						type="search"
						value={query}
						onChange={(event) => setQuery(event.target.value)}
						autoComplete="off"
						className={cn(controlClass, "sm:max-w-96")}
						data-testid="categories-search"
					/>
				)}
			</Field>
			<p
				role="status"
				className="text-sm text-ink-muted"
				data-testid="categories-search-status"
			>
				{statusText}
			</p>
			{result.items.length === 0 ? null : (
				<CategoryList entries={result.items} list="search" context={context} />
			)}
		</CategorySection>
	);
}

function UncategorisedSection({
	sales,
	uncategorised,
	formatters,
	context,
}: {
	readonly sales: UncategorisedSales;
	readonly uncategorised: readonly ItemEntry[];
	readonly formatters: Formatters;
	readonly context: RowContext;
}) {
	const t = useT();
	const title =
		sales.status === "ready"
			? t("settings.mapping.categories.uncategorised.title", {
					count: formatters.count(uncategorised.length),
				})
			: t("settings.mapping.categories.uncategorised.label");
	return (
		<CategorySection
			list="uncategorised"
			title={title}
			hint={t("settings.mapping.categories.uncategorised.hint")}
		>
			{sales.status === "loading" ? (
				<p
					role="status"
					className="text-sm text-ink-muted"
					data-testid="categories-uncategorised-loading"
				>
					{t("app.loading")}
				</p>
			) : sales.status === "failed" ? (
				<div
					role="alert"
					className="space-y-2 text-sm"
					data-testid="categories-uncategorised-failed"
				>
					<p>{t("settings.mapping.categories.uncategorised.failed")}</p>
					{sales.canRetry ? (
						<Button tone="secondary" size="compact" onClick={sales.retry}>
							{t("app.retry")}
						</Button>
					) : null}
				</div>
			) : uncategorised.length === 0 ? (
				<p
					className="text-sm text-ink-muted"
					data-testid="categories-uncategorised-none"
				>
					{t("settings.mapping.categories.uncategorised.none")}
				</p>
			) : (
				<CategoryList
					entries={uncategorised}
					list="uncategorised"
					context={context}
				/>
			)}
		</CategorySection>
	);
}

export function CategoriesForm({
	entries,
	itemTypes,
	sales,
	formatters,
	timeZone,
	canWrite,
	saving,
	outcome,
	onSave,
	onRetry,
	onEdit,
}: CategoriesFormProps) {
	const t = useT();
	const allEntries = useMemo(
		() => withSoldItems(entries, sales.items),
		[entries, sales.items],
	);
	const saved = useMemo(() => savedCategoryDraftOf(allEntries), [allEntries]);
	const [draft, setDraft] = useSyncedDraft(saved);
	const types = useMemo(() => typesByAccount(itemTypes), [itemTypes]);
	const uncategorised = useMemo(
		() => uncategorisedEntries(sales.items, entries),
		[sales.items, entries],
	);
	const firstKeys = useMemo(
		() => new Set(uncategorised.map(itemKeyOf)),
		[uncategorised],
	);
	const overridden = useMemo(() => overriddenItems(allEntries), [allEntries]);
	const changes = categoryChangesOf(allEntries, draft);
	const edit = (next: CategoryDraft) => {
		setDraft(next);
		onEdit();
	};
	const context: RowContext = {
		types,
		accountNames: accountNamesOf(allEntries, itemTypes),
		formatters,
		timeZone,
		readOnly: !canWrite,
		draft,
		onChange: (entry, chosen) => {
			if (!saving) edit({ ...draft, [itemKeyOf(entry)]: chosen });
		},
	};
	if (allEntries.length === 0) {
		return (
			<p className="text-ink-muted" data-testid="categories-empty">
				{t("settings.mapping.categories.empty")}
			</p>
		);
	}
	return (
		<div className="space-y-4" data-testid="categories-form">
			<p className="text-sm text-ink-muted">
				{t("settings.mapping.categories.intro")}
			</p>
			<UncategorisedSection
				sales={sales}
				uncategorised={uncategorised}
				formatters={formatters}
				context={context}
			/>
			{overridden.length === 0 ? null : (
				<CategorySection
					list="overridden"
					title={t("settings.mapping.categories.overridden.title", {
						count: formatters.count(overridden.length),
					})}
					hint={t("settings.mapping.categories.overridden.hint")}
				>
					<CategoryList
						entries={overridden}
						list="overridden"
						context={context}
					/>
				</CategorySection>
			)}
			<SearchSection
				entries={allEntries}
				types={types}
				firstKeys={firstKeys}
				formatters={formatters}
				context={context}
			/>
			{canWrite ? (
				<>
					<SaveBar
						pendingCount={changes.length}
						canSave
						saving={saving}
						onSave={() => onSave(changes)}
						onCancel={() => edit(saved)}
						status={saveStatusOf(t, outcome, changes.length)}
					/>
					<RetrySave outcome={outcome} saving={saving} onRetry={onRetry} />
				</>
			) : null}
		</div>
	);
}
