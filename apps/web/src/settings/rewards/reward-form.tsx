import { formatLegalBasis } from "@fnb/core";
import { type ReactNode, useId, useMemo, useState } from "react";
import { Button } from "../../components/ui/button";
import { cn } from "../../components/ui/cn";
import { type MessageKey, type Translate, useLanguage, useT } from "../../i18n";
import { AuditLine } from "../forms/audit-line";
import { DateField } from "../forms/date-field";
import { controlClass, Field } from "../forms/field";
import { IntegerField } from "../forms/integer-field";
import {
	type BoundFormatter,
	issueText,
	numericBound,
} from "../forms/issue-text";
import { MoneyField } from "../forms/money-field";
import { formatPercentBound, PercentField } from "../forms/percent-field";
import { SaveBar, type SaveBarStatus } from "../forms/save-bar";
import { SelectField } from "../forms/select-field";
import type { SettingsWriteCode } from "../source";
import { WRITE_ERROR_KEYS } from "../use-settings-mutation";
import {
	EXCLUDED_ITEMS_MAX,
	PRICE_KINDS,
	REWARD_DESCRIPTION_MAX,
	REWARD_ITEMS_MAX,
	REWARD_KIND_KEYS,
	REWARD_LIMITS,
	type RewardCap,
	type RewardFormat,
	type RewardIssue,
	type RewardRole,
	type RewardTexts,
	readRewardDraft,
	rewardTextsOf,
	sendsBackToDraft,
	slugOfName,
} from "./reward-fields";
import {
	RAIL_KEYS,
	type RewardStore,
	readinessOf,
	type StoreReadiness,
} from "./reward-rails";
import {
	REWARD_KINDS,
	type RewardChange,
	type RewardField,
	type RewardRails,
	type RewardRecord,
	type RewardRefusal,
} from "./source";

export interface RewardItemOption {
	readonly externalId: string;
	readonly name: string;
	readonly sizeLabel: string | null;
}

export interface RewardProgrammeOption {
	readonly id: string;
	readonly label: string;
}

export type RewardOutcome =
	| { readonly kind: "idle" }
	| { readonly kind: "saved" }
	| {
			readonly kind: "refused";
			readonly code: SettingsWriteCode;
			readonly field: RewardField | null;
			readonly refusal: RewardRefusal | null;
	  };

export interface RewardFormProps {
	readonly saved: RewardRecord | null;
	readonly defaultProgrammeId: string;
	readonly programmes: readonly RewardProgrammeOption[];
	readonly stores: readonly RewardStore[];
	readonly items: readonly RewardItemOption[];
	readonly rails: RewardRails | null;
	readonly canWrite: boolean;
	readonly role: RewardRole;
	readonly format: RewardFormat;
	readonly timeZone: string;
	readonly saving: boolean;
	readonly outcome: RewardOutcome;
	readonly onSave: (change: RewardChange) => void;
	readonly onEdit: () => void;
	readonly onCancelNew?: () => void;
}

export function rewardFieldId(field: RewardField): string {
	return `reward-${field}`;
}

export const REFUSAL_KEYS: Readonly<Record<RewardRefusal, MessageKey>> = {
	cap: "settings.rewards.refusal.cap",
	amountCap: "settings.rewards.refusal.amountCap",
	minBillRequired: "settings.rewards.error.minBillRequired",
	itemId: "settings.rewards.error.itemId",
	itemOverlap: "settings.rewards.error.itemOverlap",
	retiredFinal: "settings.rewards.refusal.retiredFinal",
	ownerApproves: "settings.rewards.refusal.ownerApproves",
	noRail: "settings.rewards.refusal.noRail",
	noMapping: "settings.rewards.refusal.noMapping",
	keepsMapping: "settings.rewards.refusal.keepsMapping",
	duplicateKey: "settings.rewards.error.duplicateKey",
	storeScope: "settings.rewards.refusal.storeScope",
	value: "settings.rewards.refusal.value",
};

export function refusalKeyOf(outcome: RewardOutcome): MessageKey | null {
	if (outcome.kind !== "refused") return null;
	if (outcome.refusal !== null) return REFUSAL_KEYS[outcome.refusal];
	return WRITE_ERROR_KEYS[outcome.code];
}

export function capText(
	cap: RewardCap,
	language: "vi" | "en",
	locale: string,
): { cap: string; basis: string } {
	return {
		cap: formatPercentBound(cap.rate * 100, locale, {
			min: 0,
			max: 100,
			fractionDigits: 0,
		}),
		basis: formatLegalBasis(cap.basis, language),
	};
}

export function rewardIssueText(
	t: Translate,
	issue: RewardIssue | null,
	options: {
		readonly language: "vi" | "en";
		readonly locale: string;
		readonly money: (value: number) => string;
		readonly bound?: BoundFormatter;
	},
): string | null {
	if (issue === null) return null;
	if (issue.kind === "value") return issueText(t, issue.issue, options.bound);
	if (issue.kind === "rule") return t(issue.key);
	const params = capText(issue.cap, options.language, options.locale);
	return t(issue.key, {
		...params,
		max: issue.maxAmount === null ? "" : options.money(issue.maxAmount),
	});
}

function itemLabel(item: RewardItemOption): string {
	return item.sizeLabel === null
		? `${item.name} (${item.externalId})`
		: `${item.name} ${item.sizeLabel} (${item.externalId})`;
}

function chosenLabel(
	id: string,
	items: readonly RewardItemOption[],
): { readonly text: string; readonly known: boolean } {
	const item = items.find((entry) => entry.externalId === id);
	return item === undefined
		? { text: id, known: false }
		: { text: itemLabel(item), known: true };
}

export function resolveItem(
	text: string,
	items: readonly RewardItemOption[],
): string | null {
	const trimmed = text.trim();
	if (trimmed === "") return null;
	const exact =
		items.find((item) => item.externalId === trimmed) ??
		items.find((item) => itemLabel(item) === trimmed);
	if (exact !== undefined) return exact.externalId;
	const lowered = trimmed.toLocaleLowerCase("vi");
	const byName = items.filter(
		(item) => item.name.toLocaleLowerCase("vi") === lowered,
	);
	const [only] = byName;
	if (byName.length === 1 && only !== undefined) return only.externalId;
	return trimmed;
}

function ItemListField({
	field,
	label,
	hint,
	error,
	readOnly,
	items,
	value,
	onChange,
	onBlur,
}: {
	readonly field: RewardField;
	readonly label: string;
	readonly hint: string;
	readonly error: string | null;
	readonly readOnly: boolean;
	readonly items: readonly RewardItemOption[];
	readonly value: readonly string[];
	readonly onChange: (next: readonly string[]) => void;
	readonly onBlur: () => void;
}) {
	const t = useT();
	const [query, setQuery] = useState("");
	const listId = `${useId()}-items`;
	const id = rewardFieldId(field);
	const add = () => {
		const resolved = resolveItem(query, items);
		if (resolved === null) return;
		if (!value.includes(resolved)) onChange([...value, resolved]);
		setQuery("");
	};
	const chosen = value.map((entry) => ({
		id: entry,
		...chosenLabel(entry, items),
	}));
	return (
		<Field id={id} label={label} hint={hint} error={error} readOnly={readOnly}>
			{(control) => (
				<div className="space-y-2" data-testid={id}>
					{readOnly ? (
						<input
							{...control}
							type="text"
							value={
								chosen.length === 0
									? t("settings.rewards.items.none")
									: chosen.map((entry) => entry.text).join(", ")
							}
							className={controlClass}
						/>
					) : (
						<>
							{chosen.length === 0 ? null : (
								<ul className="flex flex-wrap gap-2" aria-label={label}>
									{chosen.map((entry) => (
										<li
											key={entry.id}
											className="flex min-h-11 items-center gap-2 rounded-lg border border-line bg-surface-sunken pl-3"
											data-testid="reward-item-chip"
											data-known={entry.known ? "true" : "false"}
										>
											<span className="text-sm">
												{entry.text}
												{entry.known
													? null
													: ` · ${t("settings.rewards.items.unknown")}`}
											</span>
											<button
												type="button"
												className="min-h-11 min-w-11 rounded-lg px-2 text-sm text-ink-muted hover:bg-surface-raised"
												aria-label={t("settings.rewards.items.remove", {
													item: entry.text,
												})}
												onClick={() =>
													onChange(value.filter((other) => other !== entry.id))
												}
											>
												×
											</button>
										</li>
									))}
								</ul>
							)}
							<div className="flex min-w-0 gap-2">
								<input
									{...control}
									type="text"
									list={listId}
									autoComplete="off"
									value={query}
									placeholder={t("settings.rewards.items.placeholder")}
									onChange={(event) => setQuery(event.target.value)}
									onKeyDown={(event) => {
										if (event.key === "Enter") {
											event.preventDefault();
											add();
										}
									}}
									onBlur={onBlur}
									className={controlClass}
								/>
								<Button
									tone="secondary"
									size="compact"
									onClick={add}
									disabled={query.trim() === ""}
									aria-label={t("settings.rewards.items.addTo", {
										list: label,
									})}
								>
									{t("settings.rewards.items.add")}
								</Button>
							</div>
							<datalist id={listId}>
								{items.map((item) => (
									<option key={item.externalId} value={itemLabel(item)} />
								))}
							</datalist>
						</>
					)}
				</div>
			)}
		</Field>
	);
}

function StoreScopeField({
	stores,
	texts,
	error,
	readOnly,
	onChange,
}: {
	readonly stores: readonly RewardStore[];
	readonly texts: RewardTexts;
	readonly error: string | null;
	readonly readOnly: boolean;
	readonly onChange: (change: Partial<RewardTexts>) => void;
}) {
	const t = useT();
	const id = rewardFieldId("storeIds");
	if (readOnly) {
		const names = texts.allStores
			? t("settings.rewards.stores.all")
			: texts.storeIds
					.map(
						(storeId) =>
							stores.find((store) => store.id === storeId)?.name ?? storeId,
					)
					.join(", ");
		return (
			<Field
				id={id}
				label={t("settings.rewards.stores.label")}
				error={error}
				readOnly
			>
				{(control) => (
					<input
						{...control}
						type="text"
						value={names}
						className={controlClass}
						data-testid={id}
					/>
				)}
			</Field>
		);
	}
	return (
		<fieldset
			className="min-w-0 space-y-2"
			aria-describedby={error === null ? undefined : `${id}-error`}
			data-testid={id}
		>
			<legend className="text-sm font-medium">
				{t("settings.rewards.stores.label")}
			</legend>
			<div className="flex flex-wrap gap-x-4 gap-y-1">
				<label className="flex min-h-11 items-center gap-2 text-sm">
					<input
						type="radio"
						name={`${id}-scope`}
						checked={texts.allStores}
						onChange={() => onChange({ allStores: true })}
					/>
					{t("settings.rewards.stores.all")}
				</label>
				<label className="flex min-h-11 items-center gap-2 text-sm">
					<input
						type="radio"
						name={`${id}-scope`}
						checked={!texts.allStores}
						onChange={() => onChange({ allStores: false })}
					/>
					{t("settings.rewards.stores.some")}
				</label>
			</div>
			{texts.allStores ? null : (
				<ul className="grid gap-1 sm:grid-cols-2">
					{stores.map((store) => (
						<li key={store.id}>
							<label className="flex min-h-11 items-center gap-2 text-sm">
								<input
									type="checkbox"
									checked={texts.storeIds.includes(store.id)}
									onChange={(event) =>
										onChange({
											storeIds: event.target.checked
												? [...texts.storeIds, store.id]
												: texts.storeIds.filter((other) => other !== store.id),
										})
									}
								/>
								{store.name}
							</label>
						</li>
					))}
				</ul>
			)}
			{error === null ? null : (
				<p
					id={`${id}-error`}
					className="text-sm text-negative"
					data-testid="settings-field-error"
				>
					{error}
				</p>
			)}
		</fieldset>
	);
}

function mappingText(t: Translate, row: StoreReadiness): string {
	const mapping = row.mapping;
	if (mapping === null) return "";
	if (mapping.posDiscountName !== null) {
		return t("settings.rewards.rails.discountName", {
			name: mapping.posDiscountName,
		});
	}
	if (mapping.posFreeItemExternalId !== null) {
		return t("settings.rewards.rails.freeItem", {
			item: mapping.posFreeItemExternalId,
		});
	}
	return t("settings.rewards.rails.crmProgramme", {
		programme: mapping.crmProgrammeExternalId ?? "",
	});
}

export function RailReadiness({
	rows,
	testId = "reward-rails",
}: {
	readonly rows: readonly StoreReadiness[] | null;
	readonly testId?: string;
}) {
	const t = useT();
	if (rows === null) {
		return (
			<p role="status" className="text-sm text-ink-muted">
				{t("app.loading")}
			</p>
		);
	}
	const missing = rows.filter((row) => row.gap !== null).length;
	return (
		<div className="space-y-2" data-testid={testId}>
			<p
				role="note"
				className={cn(
					"rounded-lg border px-3 py-2 text-sm",
					missing === 0
						? "border-line bg-surface-sunken"
						: "border-warning bg-warning-soft",
				)}
				data-testid="reward-rails-summary"
				data-ready={missing === 0 ? "true" : "false"}
			>
				{rows.length === 0
					? t("settings.rewards.rails.noStores")
					: missing === 0
						? t("settings.rewards.rails.ready")
						: t("settings.rewards.rails.notReady", { count: missing })}
			</p>
			<ul className="space-y-1">
				{rows.map((row) => (
					<li
						key={row.storeId}
						className="flex flex-col gap-0.5 rounded-lg border border-line px-3 py-2 text-sm sm:flex-row sm:items-baseline sm:gap-3"
						data-testid="reward-rail-store"
						data-store={row.storeId}
						data-gap={row.gap ?? "none"}
					>
						<span className="font-medium">{row.name}</span>
						<span>
							{row.rail === null
								? t("settings.rewards.rails.noRail")
								: t(RAIL_KEYS[row.rail.rail])}
						</span>
						<span className={row.gap === null ? "text-ink-muted" : ""}>
							{row.gap === "noMapping"
								? t("settings.rewards.rails.noMapping")
								: row.gap === null
									? mappingText(t, row)
									: null}
						</span>
					</li>
				))}
			</ul>
		</div>
	);
}

function TextInput({
	field,
	label,
	hint,
	error,
	readOnly,
	value,
	onChange,
	onBlur,
	multiline = false,
}: {
	readonly field: RewardField;
	readonly label: string;
	readonly hint?: string;
	readonly error: string | null;
	readonly readOnly: boolean;
	readonly value: string;
	readonly onChange: (text: string) => void;
	readonly onBlur: () => void;
	readonly multiline?: boolean;
}) {
	return (
		<Field
			id={rewardFieldId(field)}
			label={label}
			hint={hint ?? null}
			error={error}
			readOnly={readOnly}
		>
			{(control) =>
				multiline ? (
					<textarea
						{...control}
						rows={3}
						value={value}
						onChange={(event) => onChange(event.target.value)}
						onBlur={onBlur}
						className={cn(controlClass, "py-2")}
						data-testid={rewardFieldId(field)}
					/>
				) : (
					<input
						{...control}
						type="text"
						autoComplete="off"
						value={value}
						onChange={(event) => onChange(event.target.value)}
						onBlur={onBlur}
						className={controlClass}
						data-testid={rewardFieldId(field)}
					/>
				)
			}
		</Field>
	);
}

const ALL_FIELDS: readonly RewardField[] = [
	"programmeId",
	"name",
	"rewardKey",
	"description",
	"rewardKind",
	"rewardPercent",
	"rewardAmount",
	"rewardItemExternalIds",
	"excludedItemExternalIds",
	"costStamps",
	"costPoints",
	"minBillAmount",
	"validFrom",
	"validUntil",
	"validDays",
	"holdHours",
	"perMemberLimit",
	"storeIds",
];

const CROSS_FIELD: ReadonlySet<RewardField> = new Set([
	"rewardPercent",
	"rewardAmount",
	"minBillAmount",
	"costStamps",
	"validUntil",
	"excludedItemExternalIds",
	"rewardItemExternalIds",
	"storeIds",
]);

const NO_TOUCH: ReadonlySet<RewardField> = new Set();

function statusOf(
	t: Translate,
	outcome: RewardOutcome,
	pending: number,
	showsIssue: boolean,
): SaveBarStatus | null {
	const refusal = refusalKeyOf(outcome);
	if (refusal !== null) return { tone: "error", text: t(refusal) };
	if (showsIssue) return { tone: "info", text: t("settings.saveBar.invalid") };
	if (outcome.kind === "saved" && pending === 0) {
		return { tone: "success", text: t("settings.saved") };
	}
	return null;
}

function Group({
	id,
	title,
	children,
}: {
	readonly id: string;
	readonly title: string;
	readonly children: ReactNode;
}) {
	return (
		<fieldset
			className="min-w-0 space-y-3 rounded-xl border border-line bg-surface-raised p-4"
			data-testid={`reward-group-${id}`}
		>
			<legend className="px-1 text-base font-semibold">{title}</legend>
			{children}
		</fieldset>
	);
}

export function RewardForm({
	saved,
	defaultProgrammeId,
	programmes,
	stores,
	items,
	rails,
	canWrite,
	role,
	format,
	timeZone,
	saving,
	outcome,
	onSave,
	onEdit,
	onCancelNew,
}: RewardFormProps) {
	const t = useT();
	const { language } = useLanguage();
	const { formatters } = format;
	const savedTexts = useMemo(
		() => rewardTextsOf(saved, format, defaultProgrammeId),
		[saved, format, defaultProgrammeId],
	);
	const savedKey = JSON.stringify(savedTexts);
	const [syncedKey, setSyncedKey] = useState(savedKey);
	const [texts, setTexts] = useState<RewardTexts>(savedTexts);
	const [touched, setTouched] = useState<ReadonlySet<RewardField>>(NO_TOUCH);
	const [keyEdited, setKeyEdited] = useState(saved !== null);
	if (syncedKey !== savedKey) {
		setSyncedKey(savedKey);
		setTexts(savedTexts);
		setTouched(NO_TOUCH);
		setKeyEdited(saved !== null);
	}
	const draft = readRewardDraft(saved, savedTexts, texts, format);
	const changed = new Set(draft.changed);
	const shows = (field: RewardField): boolean => {
		const issue = draft.issues[field];
		if (issue === undefined) return false;
		return (
			touched.has(field) ||
			changed.has(field) ||
			issue.kind === "cap" ||
			(issue.kind === "rule" && CROSS_FIELD.has(field) && changed.size > 0)
		);
	};
	const refusedField =
		outcome.kind === "refused" &&
		outcome.field !== null &&
		outcome.field !== "status"
			? outcome.field
			: null;
	const boundOf = (field: RewardField): BoundFormatter => {
		if (field === "rewardAmount" || field === "minBillAmount") {
			return numericBound(formatters.moneyExact);
		}
		if (field === "rewardPercent") {
			return numericBound((value) =>
				formatPercentBound(
					value,
					formatters.locale,
					REWARD_LIMITS.rewardPercent,
				),
			);
		}
		if (field === "validFrom" || field === "validUntil") {
			return (bound) =>
				typeof bound === "string" ? formatters.date(bound) : String(bound);
		}
		return numericBound(formatters.count);
	};
	const issueOf = (field: RewardField): string | null => {
		if (!canWrite) return null;
		if (shows(field)) {
			return rewardIssueText(t, draft.issues[field] ?? null, {
				language,
				locale: formatters.locale,
				money: formatters.moneyExact,
				bound: boundOf(field),
			});
		}
		if (refusedField === field && outcome.kind === "refused") {
			const key = refusalKeyOf(outcome);
			return key === null ? null : t(key);
		}
		return null;
	};
	const touch = (field: RewardField) =>
		setTouched((current) => new Set(current).add(field));
	const update = (change: Partial<RewardTexts>) => {
		setTexts((current) => ({ ...current, ...change }));
		onEdit();
	};
	const readOnly = !canWrite || saving;
	const isNew = saved === null;
	const pending = isNew
		? Math.max(draft.changed.length, 1)
		: draft.changed.length;
	const showsIssue = ALL_FIELDS.some(shows);
	const kind = texts.rewardKind;
	const capHint =
		draft.cap === null
			? null
			: t(
					kind === "amount_off"
						? "settings.rewards.cap.amountHint"
						: "settings.rewards.cap.percentHint",
					capText(draft.cap, language, formatters.locale),
				);
	const backToDraft = sendsBackToDraft(saved, draft.termsChanged, role);
	const scopeIds = texts.allStores ? null : texts.storeIds;
	const readiness =
		rails === null
			? null
			: readinessOf(scopeIds, texts.rewardKey, stores, rails);
	return (
		<div
			className="space-y-6"
			data-testid="reward-form"
			data-new={isNew ? "true" : "false"}
		>
			<Group id="reward" title={t("settings.rewards.group.reward")}>
				<div className="grid gap-4 sm:grid-cols-2">
					<TextInput
						field="name"
						label={t("settings.rewards.name.label")}
						hint={t("settings.rewards.name.hint")}
						error={issueOf("name")}
						readOnly={readOnly}
						value={texts.name}
						onChange={(name) =>
							update(
								keyEdited ? { name } : { name, rewardKey: slugOfName(name) },
							)
						}
						onBlur={() => touch("name")}
					/>
					<TextInput
						field="rewardKey"
						label={t("settings.rewards.key.label")}
						hint={t("settings.rewards.key.hint")}
						error={issueOf("rewardKey")}
						readOnly={readOnly}
						value={texts.rewardKey}
						onChange={(rewardKey) => {
							setKeyEdited(true);
							update({ rewardKey });
						}}
						onBlur={() => touch("rewardKey")}
					/>
					{programmes.length > 1 || texts.programmeId === "" ? (
						<SelectField<string>
							id={rewardFieldId("programmeId")}
							testId={rewardFieldId("programmeId")}
							label={t("settings.rewards.programme.label")}
							error={issueOf("programmeId")}
							readOnly={readOnly}
							value={texts.programmeId}
							options={programmes.map((programme) => ({
								value: programme.id,
								label: programme.label,
							}))}
							onChange={(programmeId) => update({ programmeId })}
						/>
					) : null}
				</div>
				<TextInput
					field="description"
					label={t("settings.rewards.description.label")}
					hint={t("settings.rewards.description.hint", {
						max: formatters.count(REWARD_DESCRIPTION_MAX),
					})}
					error={issueOf("description")}
					readOnly={readOnly}
					value={texts.description}
					onChange={(description) => update({ description })}
					onBlur={() => touch("description")}
					multiline
				/>
			</Group>
			<Group id="terms" title={t("settings.rewards.group.terms")}>
				<SelectField
					id={rewardFieldId("rewardKind")}
					testId={rewardFieldId("rewardKind")}
					label={t("settings.rewards.kind.label")}
					hint={`${t(REWARD_KIND_KEYS[kind].hint)} ${t("settings.rewards.kind.noCash")}`}
					error={issueOf("rewardKind")}
					readOnly={readOnly}
					value={kind}
					options={REWARD_KINDS.map((option) => ({
						value: option,
						label: t(REWARD_KIND_KEYS[option].label),
					}))}
					onChange={(rewardKind) => update({ rewardKind })}
				/>
				{PRICE_KINDS.has(kind) ? (
					<div className="grid gap-4 sm:grid-cols-2">
						{kind === "percent_off" ? (
							<PercentField
								id={rewardFieldId("rewardPercent")}
								testId={rewardFieldId("rewardPercent")}
								label={t("settings.rewards.percent.label")}
								hint={capHint}
								error={issueOf("rewardPercent")}
								readOnly={readOnly}
								value={texts.rewardPercent}
								locale={formatters.locale}
								limit={REWARD_LIMITS.rewardPercent}
								onChange={(rewardPercent) => update({ rewardPercent })}
								onBlur={() => touch("rewardPercent")}
							/>
						) : (
							<MoneyField
								id={rewardFieldId("rewardAmount")}
								testId={rewardFieldId("rewardAmount")}
								label={t("settings.rewards.amount.label")}
								hint={capHint}
								error={issueOf("rewardAmount")}
								readOnly={readOnly}
								value={texts.rewardAmount}
								formatters={formatters}
								currencyCode={format.currencyCode}
								onChange={(rewardAmount) => update({ rewardAmount })}
								onBlur={() => touch("rewardAmount")}
							/>
						)}
					</div>
				) : (
					<p className="text-sm text-ink-muted" data-testid="reward-gift-note">
						{t("settings.rewards.cap.gift")}
					</p>
				)}
				<ItemListField
					field="rewardItemExternalIds"
					label={t(
						kind === "free_item"
							? "settings.rewards.items.given"
							: "settings.rewards.items.discounted",
					)}
					hint={t(
						kind === "free_item"
							? "settings.rewards.items.givenHint"
							: "settings.rewards.items.discountedHint",
						{ max: formatters.count(REWARD_ITEMS_MAX) },
					)}
					error={issueOf("rewardItemExternalIds")}
					readOnly={readOnly}
					items={items}
					value={texts.rewardItems}
					onChange={(rewardItems) => update({ rewardItems })}
					onBlur={() => touch("rewardItemExternalIds")}
				/>
				<ItemListField
					field="excludedItemExternalIds"
					label={t("settings.rewards.items.excluded")}
					hint={t("settings.rewards.items.excludedHint", {
						max: formatters.count(EXCLUDED_ITEMS_MAX),
					})}
					error={issueOf("excludedItemExternalIds")}
					readOnly={readOnly}
					items={items}
					value={texts.excludedItems}
					onChange={(excludedItems) => update({ excludedItems })}
					onBlur={() => touch("excludedItemExternalIds")}
				/>
			</Group>
			<Group id="cost" title={t("settings.rewards.group.cost")}>
				<div className="grid gap-4 sm:grid-cols-3">
					<IntegerField
						id={rewardFieldId("costStamps")}
						testId={rewardFieldId("costStamps")}
						label={t("settings.rewards.costStamps.label")}
						hint={t("settings.rewards.cost.hint")}
						error={issueOf("costStamps")}
						readOnly={readOnly}
						value={texts.costStamps}
						locale={formatters.locale}
						unit={t("settings.rewards.unit.stamps")}
						onChange={(costStamps) => update({ costStamps })}
						onBlur={() => touch("costStamps")}
					/>
					<IntegerField
						id={rewardFieldId("costPoints")}
						testId={rewardFieldId("costPoints")}
						label={t("settings.rewards.costPoints.label")}
						error={issueOf("costPoints")}
						readOnly={readOnly}
						value={texts.costPoints}
						locale={formatters.locale}
						unit={t("settings.rewards.unit.points")}
						onChange={(costPoints) => update({ costPoints })}
						onBlur={() => touch("costPoints")}
					/>
					<MoneyField
						id={rewardFieldId("minBillAmount")}
						testId={rewardFieldId("minBillAmount")}
						label={t("settings.rewards.minBill.label")}
						hint={t(
							kind === "amount_off"
								? "settings.rewards.minBill.amountHint"
								: "settings.rewards.minBill.hint",
						)}
						error={issueOf("minBillAmount")}
						readOnly={readOnly}
						value={texts.minBillAmount}
						formatters={formatters}
						currencyCode={format.currencyCode}
						onChange={(minBillAmount) => update({ minBillAmount })}
						onBlur={() => touch("minBillAmount")}
					/>
				</div>
			</Group>
			<Group id="validity" title={t("settings.rewards.group.validity")}>
				<div className="grid gap-4 sm:grid-cols-2">
					<DateField
						id={rewardFieldId("validFrom")}
						testId={rewardFieldId("validFrom")}
						label={t("settings.rewards.validFrom.label")}
						hint={t("settings.rewards.validFrom.hint")}
						error={issueOf("validFrom")}
						readOnly={readOnly}
						value={texts.validFrom}
						today={format.today}
						onChange={(validFrom) => update({ validFrom })}
						onBlur={() => touch("validFrom")}
					/>
					<DateField
						id={rewardFieldId("validUntil")}
						testId={rewardFieldId("validUntil")}
						label={t("settings.rewards.validUntil.label")}
						hint={t("settings.rewards.validUntil.hint")}
						error={issueOf("validUntil")}
						readOnly={readOnly}
						value={texts.validUntil}
						today={format.today}
						onChange={(validUntil) => update({ validUntil })}
						onBlur={() => touch("validUntil")}
					/>
					<IntegerField
						id={rewardFieldId("validDays")}
						testId={rewardFieldId("validDays")}
						label={t("settings.rewards.validDays.label")}
						hint={t("settings.rewards.validDays.hint")}
						error={issueOf("validDays")}
						readOnly={readOnly}
						value={texts.validDays}
						locale={formatters.locale}
						unit={t("settings.rewards.unit.days")}
						onChange={(validDays) => update({ validDays })}
						onBlur={() => touch("validDays")}
					/>
					<IntegerField
						id={rewardFieldId("holdHours")}
						testId={rewardFieldId("holdHours")}
						label={t("settings.rewards.holdHours.label")}
						hint={t("settings.rewards.holdHours.hint")}
						error={issueOf("holdHours")}
						readOnly={readOnly}
						value={texts.holdHours}
						locale={formatters.locale}
						unit={t("settings.rewards.unit.hours")}
						onChange={(holdHours) => update({ holdHours })}
						onBlur={() => touch("holdHours")}
					/>
					<IntegerField
						id={rewardFieldId("perMemberLimit")}
						testId={rewardFieldId("perMemberLimit")}
						label={t("settings.rewards.perMemberLimit.label")}
						hint={t("settings.rewards.perMemberLimit.hint")}
						error={issueOf("perMemberLimit")}
						readOnly={readOnly}
						value={texts.perMemberLimit}
						locale={formatters.locale}
						unit={t("settings.rewards.unit.times")}
						onChange={(perMemberLimit) => update({ perMemberLimit })}
						onBlur={() => touch("perMemberLimit")}
					/>
				</div>
			</Group>
			<Group id="stores" title={t("settings.rewards.group.stores")}>
				<StoreScopeField
					stores={stores}
					texts={texts}
					error={issueOf("storeIds")}
					readOnly={readOnly}
					onChange={(change) => {
						touch("storeIds");
						update(change);
					}}
				/>
				<p className="text-sm text-ink-muted">
					{t("settings.rewards.rails.intro")}
				</p>
				<RailReadiness rows={readiness} />
			</Group>
			{backToDraft ? (
				<p
					role="note"
					className="rounded-lg border border-warning bg-warning-soft px-3 py-2 text-sm"
					data-testid="reward-back-to-draft"
				>
					{t("settings.rewards.backToDraft")}
				</p>
			) : null}
			{saved === null ? null : (
				<AuditLine
					entry={saved.audit}
					formatters={formatters}
					timeZone={timeZone}
				/>
			)}
			{canWrite ? (
				<SaveBar
					pendingCount={pending}
					canSave={draft.change !== null}
					saving={saving}
					onSave={() => {
						setTouched(new Set(ALL_FIELDS));
						if (draft.change !== null) onSave(draft.change);
					}}
					onCancel={() => {
						setTexts(savedTexts);
						setTouched(NO_TOUCH);
						setKeyEdited(saved !== null);
						onEdit();
						if (isNew) onCancelNew?.();
					}}
					status={statusOf(t, outcome, draft.changed.length, showsIssue)}
				/>
			) : null}
		</div>
	);
}
