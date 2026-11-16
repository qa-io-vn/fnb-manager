import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useId, useMemo, useState } from "react";
import { Button } from "../../components/ui/button";
import { cn } from "../../components/ui/cn";
import { type MessageKey, useT } from "../../i18n";
import { type IsoDate, todayIn } from "../../lib/business-dates";
import type { Formatters } from "../../lib/format";
import { useFormatters } from "../../state/formatters";
import { useReadyTenantScope } from "../../state/tenant-scope";
import type { SettingsAccess } from "../access";
import { controlClass, Field } from "../forms/field";
import {
	SaveBar,
	type SaveBarStatus,
	UNAVAILABLE_CLASS,
} from "../forms/save-bar";
import {
	RetrySave,
	type SaveOutcome,
	saveOutcomeOf,
	saveStatusOf,
} from "../forms/save-outcome";
import {
	settingsQueryKey,
	useItemCosts,
	useItems,
	useItemTypes,
	useMembership,
	useStoreProfiles,
} from "../queries";
import { ReadOnlyNotice } from "../read-only-notice";
import { SectionLoadState, useSectionLoad } from "../section-load";
import type {
	ItemEntry,
	ItemTypeEntry,
	Membership,
	SettingsSource,
	SettingsWriteCode,
	StoreProfile,
} from "../source";
import { useSettingsAccess } from "../use-settings-access";
import { useSettingsMutation } from "../use-settings-mutation";
import { type CostImportContext, costImportContextOf } from "./cost-import";
import { CostImportPanel } from "./cost-import-panel";
import { CostRow, type CostRowContext } from "./cost-row";
import {
	COST_PAGE_SIZE,
	type CostDraft,
	type CostItem,
	type CostScope,
	costItemsOf,
	readCostEdits,
	readCostText,
	searchCostItems,
	withoutCost,
	withoutSaved,
	withSavedCosts,
} from "./costs";
import type {
	ItemCostChange,
	ItemCostRow,
	ManualSettingsSource,
} from "./source";
import { type ItemSales, useItemSales } from "./use-item-sales";

const ALL_STORES = "all";

interface ScopeStore {
	readonly id: string;
	readonly name: string;
	readonly code: string | null;
	readonly timeZone: string;
	readonly posAccountId: string;
}

export function storeCodesOf(
	stores: readonly ScopeStore[],
	profiles: readonly StoreProfile[] | undefined,
): ScopeStore[] {
	if (profiles === undefined) return [...stores];
	const codes = new Map(
		profiles.map((profile) => [profile.storeId, profile.code]),
	);
	return stores.map((store) => ({
		...store,
		code: codes.has(store.id) ? (codes.get(store.id) ?? null) : store.code,
	}));
}

export function defaultCostScope(
	membership: Membership | null | undefined,
	stores: readonly ScopeStore[],
): CostScope {
	const limited = membership?.storeIds ?? null;
	if (
		limited === null ||
		(membership?.role !== "owner" && membership?.role !== "manager")
	) {
		return null;
	}
	return stores.find((store) => limited.includes(store.id))?.id ?? null;
}

interface DeleteTarget {
	readonly row: ItemCostRow;
	readonly itemLabel: string;
}

type DeleteOutcome =
	| { readonly kind: "idle" }
	| { readonly kind: "deleted"; readonly target: DeleteTarget }
	| {
			readonly kind: "refused";
			readonly messageKey: MessageKey;
			readonly canRetry: boolean;
	  };

export function deleteErrorKey(code: SettingsWriteCode): MessageKey {
	if (code === "forbidden")
		return "settings.manual.costs.deleteError.forbidden";
	if (code === "network") return "settings.manual.costs.deleteError.network";
	return "settings.manual.costs.deleteError.other";
}

export function shownCostItems(
	items: readonly CostItem[],
	found: readonly CostItem[],
	limit: number,
	unsaved: ReadonlySet<string>,
): CostItem[] {
	const paged = new Set(
		found.slice(0, limit).map((item) => item.itemExternalId),
	);
	return items.filter(
		(item) =>
			paged.has(item.itemExternalId) || unsaved.has(item.itemExternalId),
	);
}

interface ImportSave {
	readonly saving: boolean;
	readonly outcome: SaveOutcome;
	readonly onSave: (changes: readonly ItemCostChange[]) => Promise<boolean>;
	readonly onReset: () => void;
}

interface CostsFormProps {
	readonly storeId: CostScope;
	readonly importContext: CostImportContext;
	readonly importing: ImportSave;
	readonly stores: readonly ScopeStore[];
	readonly onScopeChange: (storeId: CostScope) => void;
	readonly items: readonly CostItem[];
	readonly sales: ItemSales;
	readonly rows: readonly ItemCostRow[];
	readonly today: IsoDate;
	readonly timeZone: string;
	readonly access: SettingsAccess;
	readonly formatters: Formatters;
	readonly currencyCode: string;
	readonly saving: boolean;
	readonly outcome: SaveOutcome;
	readonly onSave: (changes: readonly ItemCostChange[]) => Promise<boolean>;
	readonly onRetry: () => Promise<boolean>;
	readonly onEdit: () => void;
	readonly deleting: boolean;
	readonly deleteOutcome: DeleteOutcome;
	readonly onDelete: (target: DeleteTarget) => void;
	readonly onRetryDelete: () => void;
}

function ScopeSelect({
	storeId,
	stores,
	locked,
	onChange,
}: {
	readonly storeId: CostScope;
	readonly stores: readonly ScopeStore[];
	readonly locked: boolean;
	readonly onChange: (storeId: CostScope) => void;
}) {
	const t = useT();
	const id = useId();
	const hint = locked
		? t("settings.manual.costs.scope.locked")
		: t(
				storeId === null
					? "settings.manual.costs.scope.hintAll"
					: "settings.manual.costs.scope.hintStore",
			);
	return (
		<Field
			id={`${id}-scope`}
			label={t("settings.manual.costs.scope.label")}
			hint={hint}
		>
			{(control) => (
				<select
					id={control.id}
					aria-describedby={control["aria-describedby"]}
					value={storeId ?? ALL_STORES}
					disabled={locked}
					onChange={(event) =>
						onChange(
							event.target.value === ALL_STORES ? null : event.target.value,
						)
					}
					className={cn(controlClass, "sm:max-w-80")}
					data-testid="cost-scope"
				>
					<option value={ALL_STORES}>
						{t("settings.manual.costs.scope.all")}
					</option>
					{stores.map((store) => (
						<option key={store.id} value={store.id}>
							{store.name}
						</option>
					))}
				</select>
			)}
		</Field>
	);
}

function SearchField({
	value,
	onChange,
}: {
	readonly value: string;
	readonly onChange: (value: string) => void;
}) {
	const t = useT();
	return (
		<Field
			id="costs-search-input"
			label={t("settings.manual.costs.search.label")}
			hint={t("settings.manual.costs.search.hint")}
		>
			{(control) => (
				<input
					id={control.id}
					aria-describedby={control["aria-describedby"]}
					type="search"
					value={value}
					onChange={(event) => onChange(event.target.value)}
					autoComplete="off"
					className={cn(controlClass, "sm:max-w-96")}
					data-testid="costs-search"
				/>
			)}
		</Field>
	);
}

function saveBarStatusOf(
	t: ReturnType<typeof useT>,
	outcome: SaveOutcome,
	pendingCount: number,
	invalid: boolean,
): SaveBarStatus | null {
	if (invalid && outcome.kind !== "refused") {
		return { tone: "info", text: t("settings.saveBar.invalid") };
	}
	return saveStatusOf(t, outcome, pendingCount);
}

function DeleteStatus({
	outcome,
	formatters,
	busy,
	onRetry,
}: {
	readonly outcome: DeleteOutcome;
	readonly formatters: Formatters;
	readonly busy: boolean;
	readonly onRetry: () => void;
}) {
	const t = useT();
	const text =
		outcome.kind === "deleted"
			? t("settings.manual.costs.deleted", {
					date: formatters.date(outcome.target.row.effectiveFrom),
					item: outcome.target.itemLabel,
				})
			: outcome.kind === "refused"
				? t(outcome.messageKey)
				: "";
	return (
		<div className="flex flex-wrap items-center gap-2">
			<p
				role="status"
				className={cn(
					"text-sm",
					outcome.kind === "refused" ? "text-negative" : "text-ink-muted",
				)}
				data-testid="costs-delete-status"
			>
				{text}
			</p>
			{outcome.kind === "refused" && outcome.canRetry ? (
				<Button
					tone="secondary"
					size="compact"
					aria-disabled={busy || undefined}
					onClick={busy ? undefined : onRetry}
					className={UNAVAILABLE_CLASS}
					data-testid="costs-delete-retry"
				>
					{t("app.retry")}
				</Button>
			) : null}
		</div>
	);
}

function CostsForm({
	storeId,
	importContext,
	importing,
	stores,
	onScopeChange,
	items,
	sales,
	rows,
	today,
	timeZone,
	access,
	formatters,
	currencyCode,
	saving,
	outcome,
	onSave,
	onRetry,
	onEdit,
	deleting,
	deleteOutcome,
	onDelete,
	onRetryDelete,
}: CostsFormProps) {
	const t = useT();
	const listId = useId();
	const [draft, setDraft] = useState<CostDraft>({});
	const [importOpen, setImportOpen] = useState(false);
	const [query, setQuery] = useState("");
	const [limit, setLimit] = useState(COST_PAGE_SIZE);
	const reading = readCostEdits(draft, {
		storeId,
		rows,
		today,
		readCost: (text) => readCostText(text, formatters, currencyCode),
	});
	const found = useMemo(() => searchCostItems(items, query), [items, query]);
	const shown = shownCostItems(items, found, limit, reading.unsaved);
	const paged = Math.min(limit, found.length);
	const context: CostRowContext = {
		storeId,
		rows,
		today,
		canWrite: access.canWrite,
		busy: saving || deleting || importing.saving,
		formatters,
		currencyCode,
		timeZone,
		onEdit: (itemExternalId, edit) => {
			if (saving) return;
			setDraft((previous) => ({ ...previous, [itemExternalId]: edit }));
			onEdit();
		},
		onDelete: (row, itemLabel) => onDelete({ row, itemLabel }),
	};
	const save = (changes: readonly ItemCostChange[]) =>
		onSave(changes).then((saved) => {
			if (saved) setDraft((previous) => withoutSaved(previous, changes));
		});
	return (
		<div
			className="space-y-4"
			data-testid="costs-form"
			data-sales={sales.status}
		>
			<p className="text-sm text-ink-muted">
				{t("settings.manual.costs.intro")}
			</p>
			<ScopeSelect
				storeId={storeId}
				stores={stores}
				locked={reading.pendingCount > 0 || importOpen}
				onChange={onScopeChange}
			/>
			<ReadOnlyNotice
				access={access}
				messages={{
					role: "settings.manual.readOnly.role",
					...(storeId === null
						? { scope: "settings.manual.costs.readOnly.scope" }
						: {}),
				}}
			/>
			<CostImportPanel
				storeId={storeId}
				storeCode={
					stores.find((candidate) => candidate.id === storeId)?.code ?? null
				}
				items={items}
				rows={rows}
				today={today}
				context={importContext}
				canWrite={access.canWrite}
				formatters={formatters}
				storeName={(id) =>
					stores.find((candidate) => candidate.id === id)?.name ?? id
				}
				saving={importing.saving}
				busy={importing.saving || saving || deleting}
				outcome={importing.outcome}
				onSave={importing.onSave}
				onReset={importing.onReset}
				onOpenChange={setImportOpen}
			/>
			<SearchField value={query} onChange={setQuery} />
			{sales.status === "loading" ? (
				<p
					role="status"
					className="text-sm text-ink-muted"
					data-testid="costs-sales-loading"
				>
					{t("settings.manual.costs.salesLoading")}
				</p>
			) : (
				<section
					aria-labelledby={`${listId}-title`}
					className="space-y-2 rounded-xl border border-line bg-surface-raised px-4 py-3"
					data-testid="costs-list"
				>
					<h3 id={`${listId}-title`} className="text-base font-semibold">
						{t("settings.manual.costs.list.label")}
					</h3>
					{sales.status === "failed" ? (
						<div
							role="alert"
							className="space-y-2 text-sm"
							data-testid="costs-sales-failed"
						>
							<p>{t("settings.manual.costs.salesFailed")}</p>
							{sales.canRetry ? (
								<Button tone="secondary" size="compact" onClick={sales.retry}>
									{t("app.retry")}
								</Button>
							) : null}
						</div>
					) : null}
					<p
						role="status"
						className="text-sm text-ink-muted"
						data-testid="costs-list-status"
					>
						{items.length === 0
							? t("settings.manual.costs.empty")
							: found.length === 0
								? t("settings.manual.costs.search.none")
								: t("settings.manual.costs.list.status", {
										shown: formatters.count(paged),
										count: formatters.count(found.length),
									})}
					</p>
					{shown.length > paged ? (
						<p
							className="text-sm text-ink-muted"
							data-testid="costs-unsaved-kept"
						>
							{t("settings.manual.costs.unsavedKept", {
								count: formatters.count(shown.length - paged),
							})}
						</p>
					) : null}
					<ul data-testid="cost-rows">
						{shown.map((item) => (
							<CostRow
								key={item.itemExternalId}
								item={item}
								edit={draft[item.itemExternalId]}
								issues={reading.issues.get(item.itemExternalId)}
								context={context}
							/>
						))}
					</ul>
					{found.length > paged ? (
						<Button
							tone="secondary"
							size="compact"
							onClick={() => setLimit((current) => current + COST_PAGE_SIZE)}
							data-testid="costs-more"
						>
							{t("settings.manual.costs.more", {
								count: formatters.count(
									Math.min(COST_PAGE_SIZE, found.length - paged),
								),
							})}
						</Button>
					) : null}
				</section>
			)}
			{access.canWrite ? (
				<>
					<DeleteStatus
						outcome={deleteOutcome}
						formatters={formatters}
						busy={saving || deleting}
						onRetry={onRetryDelete}
					/>
					<SaveBar
						label={t("settings.manual.costs.saveBar")}
						pendingCount={reading.pendingCount}
						canSave={!reading.invalid}
						saving={saving}
						onSave={() => void save(reading.changes)}
						onCancel={() => {
							setDraft({});
							onEdit();
						}}
						status={saveBarStatusOf(
							t,
							outcome,
							reading.pendingCount,
							reading.invalid,
						)}
					/>
					<RetrySave
						outcome={outcome}
						saving={saving}
						onRetry={() => {
							const changes = reading.changes;
							void onRetry().then((saved) => {
								if (saved) {
									setDraft((previous) => withoutSaved(previous, changes));
								}
							});
						}}
					/>
				</>
			) : null}
		</div>
	);
}

function useCostItems(
	entries: readonly ItemEntry[] | undefined,
	itemTypes: readonly ItemTypeEntry[] | undefined,
	sales: ItemSales,
	rows: readonly ItemCostRow[] | undefined,
	storeId: CostScope,
	posAccountId: string | null,
): CostItem[] {
	return useMemo(
		() =>
			costItemsOf({
				entries: entries ?? [],
				itemTypes: itemTypes ?? [],
				sales: sales.sales,
				posAccountIds: posAccountId === null ? null : new Set([posAccountId]),
				costedItemIds: (rows ?? [])
					.filter((row) => row.storeId === storeId)
					.map((row) => row.itemExternalId),
			}),
		[entries, itemTypes, sales.sales, rows, storeId, posAccountId],
	);
}

export function CostsTab() {
	const { tenant, stores: scopeStores } = useReadyTenantScope();
	const formatters = useFormatters(tenant);
	const membership = useMembership();
	const profiles = useStoreProfiles();
	const stores = useMemo(
		() => storeCodesOf(scopeStores, profiles.data),
		[scopeStores, profiles.data],
	);
	const costs = useItemCosts();
	const entries = useItems();
	const itemTypes = useItemTypes();
	const load = useSectionLoad([costs, entries, itemTypes]);
	const [chosen, setChosen] = useState<{ storeId: CostScope } | null>(null);
	const storeId =
		chosen === null
			? defaultCostScope(membership.data, stores)
			: chosen.storeId;
	const store =
		storeId === null
			? null
			: (stores.find((candidate) => candidate.id === storeId) ?? null);
	const timeZone = store?.timeZone ?? tenant.timeZone;
	const today = todayIn(timeZone, new Date());
	const membershipKnown = membership.status !== "pending";
	const scopeStoreIds = useMemo(() => {
		if (!membershipKnown) return [];
		return store === null ? stores.map((each) => each.id) : [store.id];
	}, [membershipKnown, store, stores]);
	const sales = useItemSales(scopeStoreIds);
	const access = useSettingsAccess("manualData", storeId);
	const items = useCostItems(
		entries.data,
		itemTypes.data,
		sales,
		costs.data,
		storeId,
		store?.posAccountId ?? null,
	);
	const queryClient = useQueryClient();
	const writeCosts = useCallback(
		async (
			source: SettingsSource,
			tenantId: string,
			changes: readonly ItemCostChange[],
			manual: ManualSettingsSource,
		) => {
			const saved = await manual.saveItemCosts(tenantId, changes);
			queryClient.setQueryData<ItemCostRow[]>(
				settingsQueryKey(source.kind, tenantId, "itemCosts"),
				(previous) => withSavedCosts(previous, saved),
			);
		},
		[queryClient],
	);
	const removeCost = useCallback(
		async (
			source: SettingsSource,
			tenantId: string,
			target: DeleteTarget,
			manual: ManualSettingsSource,
		) => {
			await manual.deleteItemCost(tenantId, target.row.id);
			queryClient.setQueryData<ItemCostRow[]>(
				settingsQueryKey(source.kind, tenantId, "itemCosts"),
				(previous) => withoutCost(previous, target.row.id),
			);
		},
		[queryClient],
	);
	const saving = useSettingsMutation(writeCosts);
	const importing = useSettingsMutation(writeCosts);
	const deleting = useSettingsMutation(removeCost);
	const importContext = useMemo(
		() =>
			costImportContextOf({
				scope: storeId,
				stores,
				membership: membership.data,
				entries: entries.data ?? [],
				sales: sales.sales,
				rows: costs.data ?? [],
				today,
				fractionDigits: formatters.moneyFractionDigits,
			}),
		[
			storeId,
			stores,
			membership.data,
			entries.data,
			sales.sales,
			costs.data,
			today,
			formatters.moneyFractionDigits,
		],
	);
	const [deleted, setDeleted] = useState<DeleteTarget | null>(null);
	if (
		!membershipKnown ||
		costs.data === undefined ||
		entries.data === undefined ||
		itemTypes.data === undefined
	) {
		return <SectionLoadState load={load} failedTestId="costs-load-failed" />;
	}
	const outcome = saveOutcomeOf(saving);
	const deleteOutcome: DeleteOutcome =
		deleting.errorCode !== null
			? {
					kind: "refused",
					messageKey: deleteErrorKey(deleting.errorCode),
					canRetry: deleting.canRetry,
				}
			: deleted !== null && deleting.saved
				? { kind: "deleted", target: deleted }
				: { kind: "idle" };
	return (
		<CostsForm
			key={storeId ?? ALL_STORES}
			storeId={storeId}
			importContext={importContext}
			importing={{
				saving: importing.saving,
				outcome: saveOutcomeOf(importing),
				onSave: importing.save,
				onReset: importing.reset,
			}}
			stores={stores}
			onScopeChange={(next) => {
				setChosen({ storeId: next });
				saving.reset();
				importing.reset();
				deleting.reset();
			}}
			items={items}
			sales={sales}
			rows={costs.data}
			today={today}
			timeZone={timeZone}
			access={access}
			formatters={formatters}
			currencyCode={tenant.currencyCode}
			saving={saving.saving}
			outcome={outcome}
			onSave={saving.save}
			onRetry={saving.retry}
			onEdit={() => {
				if (outcome.kind !== "idle" && !saving.saving) saving.reset();
			}}
			deleting={deleting.saving}
			deleteOutcome={deleteOutcome}
			onDelete={(target) => {
				setDeleted(target);
				void deleting.save(target);
			}}
			onRetryDelete={() => void deleting.retry()}
		/>
	);
}
