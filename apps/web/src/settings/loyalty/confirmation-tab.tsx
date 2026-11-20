import { type ReactNode, useCallback, useId, useMemo, useState } from "react";
import { Button } from "../../components/ui/button";
import { TextLink } from "../../components/ui/text-link";
import { type MessageKey, useT } from "../../i18n";
import type { Formatters } from "../../lib/format";
import {
	CONFIRMATION_MODES,
	type ConfirmationMode,
	EVIDENCE_LEVELS,
	type EvidenceLevel,
	type LoyaltySource,
	type LoyaltyStoreSettings,
	type LoyaltyStoreSettingsChange,
	SILENCE_OUTCOMES,
	type SilenceOutcome,
} from "../../loyalty/source";
import { useFormatters } from "../../state/formatters";
import { useReadyTenantScope } from "../../state/tenant-scope";
import type { SettingsAccess } from "../access";
import { AuditLine } from "../forms/audit-line";
import { IntegerField } from "../forms/integer-field";
import {
	type BoundFormatter,
	issueText,
	numericBound,
} from "../forms/issue-text";
import { MoneyField } from "../forms/money-field";
import { formatPercentBound, PercentField } from "../forms/percent-field";
import { SaveBar } from "../forms/save-bar";
import {
	RetrySave,
	type SaveOutcome,
	saveOutcomeOf,
	saveStatusOf,
} from "../forms/save-outcome";
import { SelectField } from "../forms/select-field";
import { useLoyaltyStoreSettings } from "../queries";
import { ReadOnlyNotice } from "../read-only-notice";
import { SectionLoadState, useSectionLoad } from "../section-load";
import { useSettingsSourceState } from "../settings-source-context";
import { SettingsWriteError } from "../source";
import { useSettingsAccess } from "../use-settings-access";
import { useSettingsMutation } from "../use-settings-mutation";
import {
	AUDIT_PERCENT_LIMIT,
	CONFIRMATION_MODE_KEYS,
	type ConfirmationDraft,
	changeOf,
	type DraftFormat,
	draftOf,
	EVIDENCE_LEVEL_KEYS,
	hasDraftIssues,
	KNOB_SPECS,
	type KnobSpec,
	type NumericKnob,
	readDraft,
	SILENCE_OUTCOME_KEYS,
} from "./confirmation-fields";

export const CONFIRMATION_READ_ONLY_MESSAGES = {
	ownerOnly: "settings.loyalty.confirmation.readOnly.ownerOnly",
	scope: "settings.loyalty.confirmation.readOnly.scope",
} as const satisfies Readonly<Record<string, MessageKey>>;

const EVIDENCE_KNOBS: readonly NumericKnob[] = [
	"maxBillAmount",
	"billManagerApprovalAbove",
	"billAmountTolerance",
	"billUnconfirmedHours",
];

const CAP_KNOBS: readonly NumericKnob[] = [
	"billStaffShiftCap",
	"staffAmountPerDay",
	"storeEarnsPerDay",
	"staffRedemptionsPerDay",
];

const ADVANCED_KNOBS: readonly NumericKnob[] = KNOB_SPECS.filter(
	(spec) => spec.group === "advanced",
).map((spec) => spec.knob);

function specOf(knob: NumericKnob): KnobSpec {
	const found = KNOB_SPECS.find((spec) => spec.knob === knob);
	if (found === undefined) throw new Error(`unknown knob ${knob}`);
	return found;
}

function knobFieldId(knob: NumericKnob): string {
	return `loyalty-confirmation-${knob}`;
}

/** How many controls differ from the saved row. */
export function pendingCountOf(
	saved: ConfirmationDraft,
	draft: ConfirmationDraft,
): number {
	let count = 0;
	for (const key of [
		"confirmation",
		"billEvidenceRequiredLevel",
		"billSilenceOutcome",
		"selfClaim",
		"shadowReconcile",
	] as const) {
		if (saved[key] !== draft[key]) count += 1;
	}
	for (const spec of KNOB_SPECS) {
		if (saved.texts[spec.knob] !== draft.texts[spec.knob]) count += 1;
	}
	return count;
}

function useLoyaltySource(): LoyaltySource | null {
	const state = useSettingsSourceState();
	return state.status === "ready" ? (state.loyalty ?? null) : null;
}

function ModeComparison() {
	const t = useT();
	const ids = useId();
	const card = (mode: ConfirmationMode) => (
		<div
			className="min-w-0 space-y-2 rounded-lg border border-line bg-surface-raised p-3"
			data-testid="loyalty-confirmation-compare"
			data-mode={mode}
		>
			<h5 className="font-semibold">
				{t(
					mode === "pos_sync"
						? "settings.loyalty.confirmation.compare.pos_sync.title"
						: "settings.loyalty.confirmation.compare.staff.title",
				)}
			</h5>
			<ul className="list-disc space-y-1 ps-5 text-sm">
				<li>
					{t(
						mode === "pos_sync"
							? "settings.loyalty.confirmation.compare.pos_sync.pro"
							: "settings.loyalty.confirmation.compare.staff.pro",
					)}
				</li>
				<li>
					{t(
						mode === "pos_sync"
							? "settings.loyalty.confirmation.compare.pos_sync.con"
							: "settings.loyalty.confirmation.compare.staff.con",
					)}
				</li>
			</ul>
		</div>
	);
	return (
		<section aria-labelledby={`${ids}-compare`} className="space-y-2">
			<h4 id={`${ids}-compare`} className="text-base font-semibold">
				{t("settings.loyalty.confirmation.compare.label")}
			</h4>
			<div className="grid gap-3 md:grid-cols-2">
				{card("pos_sync")}
				{card("staff")}
			</div>
			<p className="text-sm text-ink-muted">
				{t("settings.loyalty.confirmation.compare.note")}
			</p>
		</section>
	);
}

function boundFormatterOf(
	spec: KnobSpec,
	formatters: Formatters,
): BoundFormatter {
	if (spec.kind === "money") return numericBound(formatters.moneyExact);
	if (spec.kind === "percent") {
		return numericBound((value) =>
			formatPercentBound(value, formatters.locale, AUDIT_PERCENT_LIMIT),
		);
	}
	return numericBound(formatters.count);
}

function KnobInput({
	spec,
	format,
	text,
	error,
	readOnly,
	onChange,
}: {
	readonly spec: KnobSpec;
	readonly format: DraftFormat;
	readonly text: string;
	readonly error: string | null;
	readonly readOnly: boolean;
	readonly onChange: (text: string) => void;
}) {
	const t = useT();
	const shared = {
		id: knobFieldId(spec.knob),
		testId: knobFieldId(spec.knob),
		label: t(spec.labelKey),
		hint: t(spec.hintKey),
		error,
		readOnly,
		value: text,
		onChange,
	};
	if (spec.kind === "money") {
		return (
			<MoneyField
				{...shared}
				formatters={format.formatters}
				currencyCode={format.currencyCode}
			/>
		);
	}
	if (spec.kind === "percent") {
		return (
			<PercentField
				{...shared}
				locale={format.formatters.locale}
				limit={AUDIT_PERCENT_LIMIT}
			/>
		);
	}
	return (
		<IntegerField
			{...shared}
			locale={format.formatters.locale}
			{...(spec.unitKey === null ? {} : { unit: t(spec.unitKey) })}
		/>
	);
}

function Toggle({
	id,
	label,
	hint,
	checked,
	readOnly,
	onChange,
}: {
	readonly id: string;
	readonly label: string;
	readonly hint: string;
	readonly checked: boolean;
	readonly readOnly: boolean;
	readonly onChange: (checked: boolean) => void;
}) {
	return (
		<div className="flex min-w-0 flex-col gap-1">
			<label className="flex min-h-11 items-center gap-2 text-sm font-medium">
				<input
					id={id}
					type="checkbox"
					checked={checked}
					disabled={readOnly}
					aria-describedby={`${id}-hint`}
					onChange={(event) => onChange(event.target.checked)}
					className="size-5 shrink-0 accent-accent"
					data-testid={id}
				/>
				<span>{label}</span>
			</label>
			<p id={`${id}-hint`} className="text-xs text-ink-muted">
				{hint}
			</p>
		</div>
	);
}

export interface StoreFormProps {
	readonly saved: LoyaltyStoreSettings;
	readonly storeName: string;
	readonly canWrite: boolean;
	readonly format: DraftFormat;
	readonly timeZone: string;
	readonly saving: boolean;
	readonly outcome: SaveOutcome;
	readonly onSave: (change: LoyaltyStoreSettingsChange) => void;
	readonly onRetry: () => void;
	readonly onEdit: () => void;
}

export function StoreConfirmationForm({
	saved,
	storeName,
	canWrite,
	format,
	timeZone,
	saving,
	outcome,
	onSave,
	onRetry,
	onEdit,
}: StoreFormProps) {
	const t = useT();
	const ids = useId();
	const savedDraft = useMemo(
		() => draftOf(saved, format.formatters),
		[saved, format.formatters],
	);
	const [draft, setDraft] = useState<ConfirmationDraft>(savedDraft);
	const [showAll, setShowAll] = useState(false);
	const reading = readDraft(draft, format);
	const pending = pendingCountOf(savedDraft, draft);
	const readOnly = !canWrite;
	const update = (next: Partial<ConfirmationDraft>) => {
		setDraft((previous) => ({ ...previous, ...next }));
		onEdit();
	};
	const setText = (knob: NumericKnob, text: string) =>
		update({ texts: { ...draft.texts, [knob]: text } });
	const errorOf = (knob: NumericKnob): string | null => {
		const issue = reading.issues[knob];
		if (issue === undefined) return null;
		if (!showAll && draft.texts[knob] === savedDraft.texts[knob]) return null;
		return issueText(
			t,
			issue,
			boundFormatterOf(specOf(knob), format.formatters),
		);
	};
	const knob = (name: NumericKnob) => (
		<KnobInput
			key={name}
			spec={specOf(name)}
			format={format}
			text={draft.texts[name]}
			error={errorOf(name)}
			readOnly={readOnly}
			onChange={(text) => setText(name, text)}
		/>
	);
	const switching = draft.confirmation !== saved.confirmation;
	return (
		<div
			className="min-w-0 space-y-4 rounded-xl border border-line bg-surface-raised p-4"
			data-testid="loyalty-confirmation-form"
			data-store={saved.storeId}
		>
			<h4 className="text-base font-semibold">
				{t("settings.loyalty.confirmation.formTitle", { store: storeName })}
			</h4>
			<fieldset className="space-y-2" aria-describedby={`${ids}-mode-note`}>
				<legend className="text-sm font-medium">
					{t("settings.loyalty.confirmation.mode.legend")}
				</legend>
				<div className="grid gap-2 md:grid-cols-2">
					{CONFIRMATION_MODES.map((mode) => (
						<label
							key={mode}
							className="flex min-h-11 items-start gap-2 rounded-lg border border-line p-3 has-[:checked]:border-accent"
						>
							<input
								type="radio"
								name={`${ids}-mode`}
								value={mode}
								checked={draft.confirmation === mode}
								disabled={readOnly}
								onChange={() => update({ confirmation: mode })}
								className="mt-1 size-5 shrink-0 accent-accent"
								data-testid={`loyalty-confirmation-mode-${mode}`}
							/>
							<span className="min-w-0">
								<span className="block font-medium">
									{t(CONFIRMATION_MODE_KEYS[mode])}
								</span>
								<span className="block text-xs text-ink-muted">
									{t(
										mode === "pos_sync"
											? "settings.loyalty.confirmation.mode.pos_sync.hint"
											: "settings.loyalty.confirmation.mode.staff.hint",
									)}
								</span>
							</span>
						</label>
					))}
				</div>
				<p
					id={`${ids}-mode-note`}
					className="text-sm"
					data-testid="loyalty-confirmation-switch"
				>
					{switching
						? t(
								draft.confirmation === "staff"
									? "settings.loyalty.confirmation.switch.toStaff"
									: "settings.loyalty.confirmation.switch.toPosSync",
							)
						: draft.confirmation === "pos_sync"
							? t("settings.loyalty.confirmation.knobsNote")
							: ""}
				</p>
			</fieldset>
			<fieldset className="space-y-3">
				<legend className="text-sm font-semibold">
					{t("settings.loyalty.confirmation.group.evidence")}
				</legend>
				<div className="grid gap-3 md:grid-cols-2">
					<SelectField<`${EvidenceLevel}`>
						id={`${ids}-level`}
						testId="loyalty-confirmation-level"
						label={t("settings.loyalty.confirmation.level.label")}
						hint={t("settings.loyalty.confirmation.level.hint")}
						readOnly={readOnly}
						value={`${draft.billEvidenceRequiredLevel}`}
						options={EVIDENCE_LEVELS.map((level) => ({
							value: `${level}`,
							label: t(EVIDENCE_LEVEL_KEYS[level]),
						}))}
						onChange={(value) =>
							update({
								billEvidenceRequiredLevel: Number(value) as EvidenceLevel,
							})
						}
					/>
					<SelectField<SilenceOutcome>
						id={`${ids}-silence`}
						testId="loyalty-confirmation-silence"
						label={t("settings.loyalty.confirmation.silence.label")}
						hint={t("settings.loyalty.confirmation.silence.hint")}
						readOnly={readOnly}
						value={draft.billSilenceOutcome}
						options={SILENCE_OUTCOMES.map((value) => ({
							value,
							label: t(SILENCE_OUTCOME_KEYS[value]),
						}))}
						onChange={(billSilenceOutcome) => update({ billSilenceOutcome })}
					/>
					{EVIDENCE_KNOBS.map(knob)}
				</div>
			</fieldset>
			<fieldset className="space-y-3">
				<legend className="text-sm font-semibold">
					{t("settings.loyalty.confirmation.group.caps")}
				</legend>
				<div className="grid gap-3 md:grid-cols-2">{CAP_KNOBS.map(knob)}</div>
			</fieldset>
			<details
				className="rounded-lg border border-line p-3"
				data-testid="loyalty-confirmation-advanced"
			>
				<summary className="flex min-h-11 cursor-pointer items-center text-sm font-semibold">
					{t("settings.loyalty.confirmation.group.advanced")}
				</summary>
				<p className="mb-3 text-xs text-ink-muted">
					{t("settings.loyalty.confirmation.group.advanced.hint")}
				</p>
				<div className="grid gap-3 md:grid-cols-2">
					{ADVANCED_KNOBS.map(knob)}
					<Toggle
						id="loyalty-confirmation-self-claim"
						label={t("settings.loyalty.confirmation.selfClaim")}
						hint={t("settings.loyalty.confirmation.selfClaim.hint")}
						checked={draft.selfClaim}
						readOnly={readOnly}
						onChange={(selfClaim) => update({ selfClaim })}
					/>
					<Toggle
						id="loyalty-confirmation-shadow"
						label={t("settings.loyalty.confirmation.shadowReconcile")}
						hint={t("settings.loyalty.confirmation.shadowReconcile.hint")}
						checked={draft.shadowReconcile}
						readOnly={readOnly}
						onChange={(shadowReconcile) => update({ shadowReconcile })}
					/>
				</div>
			</details>
			<AuditLine
				entry={{ changedAt: saved.updatedAt, author: { kind: "unknown" } }}
				formatters={format.formatters}
				timeZone={timeZone}
			/>
			{canWrite ? (
				<>
					<SaveBar
						pendingCount={pending}
						canSave={!hasDraftIssues(reading)}
						saving={saving}
						onSave={() => {
							setShowAll(true);
							if (hasDraftIssues(reading)) return;
							const change = changeOf(saved, reading.values);
							if (Object.keys(change).length > 0) onSave(change);
						}}
						onCancel={() => {
							setDraft(savedDraft);
							setShowAll(false);
							onEdit();
						}}
						status={saveStatusOf(t, outcome, pending)}
					/>
					<RetrySave outcome={outcome} saving={saving} onRetry={onRetry} />
				</>
			) : null}
		</div>
	);
}

function ModeBadge({ mode }: { readonly mode: ConfirmationMode }) {
	const t = useT();
	return (
		<span
			className="inline-flex items-center rounded-full border border-line bg-surface-sunken px-2 py-0.5 text-xs font-medium"
			data-testid="loyalty-confirmation-mode"
			data-mode={mode}
		>
			{t(CONFIRMATION_MODE_KEYS[mode])}
		</span>
	);
}

interface SaveArgs {
	readonly storeId: string;
	readonly change: LoyaltyStoreSettingsChange;
}

export function ConfirmationTab() {
	const t = useT();
	const { tenant, stores } = useReadyTenantScope();
	const formatters = useFormatters(tenant);
	const loyalty = useLoyaltySource();
	const demo = loyalty?.kind === "demo";
	const storeIds = useMemo(() => stores.map((store) => store.id), [stores]);
	const settings = useLoyaltyStoreSettings(storeIds);
	const load = useSectionLoad([settings]);
	const [chosenId, setChosenId] = useState<string | null>(null);
	const write = useCallback(
		async (_source: unknown, tenantId: string, args: SaveArgs) => {
			if (loyalty === null) throw new SettingsWriteError("network");
			await loyalty.saveStoreSettings(tenantId, args.storeId, args.change);
		},
		[loyalty],
	);
	const mutation = useSettingsMutation<SaveArgs>(write);
	const rows = settings.data;
	const current =
		stores.find((store) => store.id === chosenId) ?? stores[0] ?? null;
	const access: SettingsAccess = useSettingsAccess(
		"loyaltyConfirmation",
		current?.id ?? null,
	);
	const format: DraftFormat = { formatters, currencyCode: tenant.currencyCode };
	let body: ReactNode;
	if (stores.length === 0) {
		body = (
			<p className="text-sm" data-testid="loyalty-confirmation-no-stores">
				{t("settings.loyalty.confirmation.noStores")}
			</p>
		);
	} else if (rows === undefined) {
		body = (
			<SectionLoadState
				load={load}
				failedTestId="loyalty-confirmation-load-failed"
			/>
		);
	} else {
		const saved =
			current === null
				? undefined
				: rows.find((row) => row.storeId === current.id);
		body = (
			<>
				<section className="space-y-2">
					<h4 className="text-base font-semibold">
						{t("settings.loyalty.confirmation.stores")}
					</h4>
					<ul className="space-y-2" data-testid="loyalty-confirmation-stores">
						{stores.map((store) => {
							const row = rows.find(
								(candidate) => candidate.storeId === store.id,
							);
							const isCurrent = store.id === current?.id;
							return (
								<li key={store.id}>
									<Button
										tone="secondary"
										aria-pressed={isCurrent}
										onClick={() => {
											mutation.reset();
											setChosenId(store.id);
										}}
										className="flex w-full min-w-0 flex-wrap items-center justify-between gap-2 text-start aria-pressed:border-accent"
										data-testid="loyalty-confirmation-store"
										data-store={store.id}
									>
										<span className="min-w-0 font-medium">{store.name}</span>
										{row === undefined ? (
											<span className="text-xs text-ink-muted">
												{t("settings.loyalty.confirmation.store.missing")}
											</span>
										) : (
											<ModeBadge mode={row.confirmation} />
										)}
									</Button>
								</li>
							);
						})}
					</ul>
				</section>
				{current !== null && saved !== undefined ? (
					<StoreConfirmationForm
						key={`${saved.storeId}:${saved.updatedAt}`}
						saved={saved}
						storeName={current.name}
						canWrite={access.canWrite && !demo}
						format={format}
						timeZone={tenant.timeZone}
						saving={mutation.saving}
						outcome={saveOutcomeOf(mutation)}
						onSave={(change) =>
							void mutation.save({ storeId: saved.storeId, change })
						}
						onRetry={() => void mutation.retry()}
						onEdit={() => {
							if (!mutation.saving && (mutation.saved || mutation.errorKey))
								mutation.reset();
						}}
					/>
				) : null}
			</>
		);
	}
	return (
		<section
			aria-labelledby="loyalty-confirmation-heading"
			className="min-w-0 space-y-4"
			data-testid="loyalty-confirmation"
		>
			<h3 id="loyalty-confirmation-heading" className="text-lg font-semibold">
				{t("settings.loyalty.confirmation.title")}
			</h3>
			<p
				className="text-sm text-ink-muted"
				data-testid="loyalty-confirmation-intro"
			>
				{t("settings.loyalty.confirmation.intro")}
			</p>
			<ModeComparison />
			{demo ? (
				<p
					role="note"
					className="rounded-lg border border-line bg-surface-sunken px-3 py-2 text-sm"
					data-testid="loyalty-confirmation-demo"
				>
					{t("settings.loyalty.confirmation.demo")}
				</p>
			) : (
				<ReadOnlyNotice
					access={access}
					messages={CONFIRMATION_READ_ONLY_MESSAGES}
					testId="loyalty-confirmation-read-only"
				/>
			)}
			{body}
			<p className="text-sm">
				<TextLink to="/khach-hang/bat-thuong">
					{t("settings.loyalty.confirmation.anomaliesLink")}
				</TextLink>
			</p>
		</section>
	);
}
