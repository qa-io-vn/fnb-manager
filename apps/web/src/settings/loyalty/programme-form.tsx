import { LOYALTY_PROGRAMME_STATUSES, NOTIFICATION_DECISIONS } from "@fnb/core";
import { MONEY_COLUMN_MAX } from "@fnb/reports";
import { useMemo, useState } from "react";
import { cn } from "../../components/ui/cn";
import { TextLink } from "../../components/ui/text-link";
import { type MessageKey, type Translate, useT } from "../../i18n";
import type { IsoDate } from "../../lib/business-dates";
import type { Formatters } from "../../lib/format";
import type {
	LoyaltyProgrammeChange,
	LoyaltyProgrammeRecord,
	ProgrammeField,
} from "../../loyalty/source";
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
	DECISION_KEYS,
	NOTIFICATION_BASIS_MAX,
	type NumericParameter,
	PARAMETER_GROUPS,
	PARAMETER_LABEL_KEYS,
	PARAMETER_SPECS,
	type ParameterSpec,
	type ProgrammeFormat,
	type ProgrammeIssue,
	type ProgrammeTexts,
	parameterDefaultText,
	programmeTextsOf,
	readProgrammeDraft,
	STATUS_KEYS,
	shownLimitOf,
} from "./programme-fields";

export type ProgrammeOutcome =
	| { readonly kind: "idle" }
	| { readonly kind: "saved" }
	| {
			readonly kind: "refused";
			readonly code: SettingsWriteCode;
			readonly field: ProgrammeField | null;
	  };

export interface ProgrammeFormProps {
	readonly saved: LoyaltyProgrammeRecord | null;
	readonly canWrite: boolean;
	readonly formatters: Formatters;
	readonly currencyCode: string;
	readonly timeZone: string;
	readonly today: IsoDate;
	readonly saving: boolean;
	readonly outcome: ProgrammeOutcome;
	readonly onSave: (change: LoyaltyProgrammeChange) => void;
	readonly onEdit: () => void;
	readonly onCancelNew?: () => void;
}

export const LEGAL_PAGE = "/cai-dat/phap-ly";

export function fieldIdOf(field: ProgrammeField): string {
	return `loyalty-${field}`;
}

function refusalIssueOf(
	outcome: ProgrammeOutcome,
): { field: ProgrammeField; issue: ProgrammeIssue } | null {
	if (outcome.kind !== "refused" || outcome.field === null) return null;
	if (outcome.field === "status") {
		return {
			field: "status",
			issue: {
				kind: "rule",
				key:
					outcome.code === "duplicate"
						? "settings.loyalty.error.otherActive"
						: "settings.loyalty.hold.refused",
			},
		};
	}
	return {
		field: outcome.field,
		issue: { kind: "rule", key: "settings.loyalty.error.refused" },
	};
}

export function programmeIssueText(
	t: Translate,
	issue: ProgrammeIssue | null,
	formatBound: BoundFormatter = String,
): string | null {
	if (issue === null) return null;
	return issue.kind === "rule"
		? t(issue.key)
		: issueText(t, issue.issue, formatBound);
}

export function refusalStatusKey(outcome: ProgrammeOutcome): MessageKey | null {
	if (outcome.kind !== "refused") return null;
	if (outcome.field === "status") {
		return outcome.code === "duplicate"
			? "settings.loyalty.error.otherActive"
			: "settings.loyalty.hold.refused";
	}
	return WRITE_ERROR_KEYS[outcome.code];
}

function boundFormatterOf(
	spec: ParameterSpec,
	format: ProgrammeFormat,
): BoundFormatter {
	if (spec.kind === "money") return numericBound(format.formatters.moneyExact);
	if (spec.kind === "percent") {
		return numericBound((value) =>
			formatPercentBound(value, format.formatters.locale, shownLimitOf(spec)),
		);
	}
	return numericBound(format.formatters.count);
}

function ParameterInput({
	spec,
	format,
	text,
	error,
	readOnly,
	onChange,
	onBlur,
}: {
	readonly spec: ParameterSpec;
	readonly format: ProgrammeFormat;
	readonly text: string;
	readonly error: string | null;
	readonly readOnly: boolean;
	readonly onChange: (text: string) => void;
	readonly onBlur: () => void;
}) {
	const t = useT();
	const keys = PARAMETER_LABEL_KEYS[spec.field];
	const shared = {
		id: fieldIdOf(spec.field),
		testId: fieldIdOf(spec.field),
		label: t(keys.label),
		hint: `${t(keys.hint)} ${t("settings.loyalty.default", {
			value: parameterDefaultText(
				spec,
				format,
				spec.unitKey === null ? null : t(spec.unitKey),
			),
		})}`,
		error,
		readOnly,
		value: text,
		onChange,
		onBlur,
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
				limit={shownLimitOf(spec)}
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
	readonly field: ProgrammeField;
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
			id={fieldIdOf(field)}
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
						data-testid={fieldIdOf(field)}
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
						data-testid={fieldIdOf(field)}
					/>
				)
			}
		</Field>
	);
}

function DecisionOptions() {
	const t = useT();
	return (
		<div className="space-y-2 text-sm" data-testid="loyalty-decision-options">
			<ul className="list-disc space-y-1 pl-5">
				{NOTIFICATION_DECISIONS.map((decision) => (
					<li key={decision} data-decision={decision}>
						<span className="font-medium">
							{t(DECISION_KEYS[decision].label)}
						</span>
						{": "}
						{t(DECISION_KEYS[decision].body)}
					</li>
				))}
			</ul>
			<p>
				<TextLink to={LEGAL_PAGE} data-testid="loyalty-legal-link">
					{t("settings.loyalty.decision.legalLink")}
				</TextLink>
			</p>
		</div>
	);
}

function HoldNote({ texts }: { readonly texts: ProgrammeTexts }) {
	const t = useT();
	const held = texts.notificationDecision === "pending";
	return (
		<p
			role="note"
			className={cn(
				"rounded-lg border px-3 py-2 text-sm",
				held
					? "border-warning bg-warning-soft"
					: "border-line bg-surface-sunken",
			)}
			data-testid="loyalty-hold"
			data-held={held ? "true" : "false"}
		>
			{t(held ? "settings.loyalty.hold.on" : "settings.loyalty.hold.off")}
		</p>
	);
}

type Touched = ReadonlySet<ProgrammeField>;

const CROSS_FIELD_RULES: ReadonlySet<ProgrammeField> = new Set([
	"status",
	"endsOn",
	"welcomeStamps",
	"notificationBasis",
]);

const NO_TOUCH: Touched = new Set();

function statusOf(
	t: Translate,
	outcome: ProgrammeOutcome,
	pending: number,
	showsIssue: boolean,
): SaveBarStatus | null {
	const refusal = refusalStatusKey(outcome);
	if (refusal !== null) return { tone: "error", text: t(refusal) };
	if (showsIssue) return { tone: "info", text: t("settings.saveBar.invalid") };
	if (outcome.kind === "saved" && pending === 0) {
		return { tone: "success", text: t("settings.saved") };
	}
	return null;
}

export function ProgrammeForm({
	saved,
	canWrite,
	formatters,
	currencyCode,
	timeZone,
	today,
	saving,
	outcome,
	onSave,
	onEdit,
	onCancelNew,
}: ProgrammeFormProps) {
	const t = useT();
	const format = useMemo<ProgrammeFormat>(
		() => ({ formatters, currencyCode, timeZone }),
		[formatters, currencyCode, timeZone],
	);
	const savedTexts = useMemo(
		() => programmeTextsOf(saved, format, today),
		[saved, format, today],
	);
	const savedKey = JSON.stringify(savedTexts);
	const [syncedKey, setSyncedKey] = useState(savedKey);
	const [texts, setTexts] = useState<ProgrammeTexts>(savedTexts);
	const [touched, setTouched] = useState<Touched>(NO_TOUCH);
	if (syncedKey !== savedKey) {
		setSyncedKey(savedKey);
		setTexts(savedTexts);
		setTouched(NO_TOUCH);
	}
	const draft = readProgrammeDraft(saved, savedTexts, texts, format);
	const refusal = refusalIssueOf(outcome);
	const changed = new Set(draft.changed);
	const shows = (field: ProgrammeField): boolean => {
		const issue = draft.issues[field];
		if (issue === undefined) return false;
		return (
			touched.has(field) ||
			changed.has(field) ||
			field === "status" ||
			(issue.kind === "rule" &&
				CROSS_FIELD_RULES.has(field) &&
				changed.size > 0)
		);
	};
	const issueOf = (field: ProgrammeField): ProgrammeIssue | null => {
		if (!canWrite) return null;
		if (shows(field)) return draft.issues[field] ?? null;
		return refusal?.field === field ? refusal.issue : null;
	};
	const touch = (field: ProgrammeField) =>
		setTouched((current) => new Set(current).add(field));
	const update = (change: Partial<ProgrammeTexts>) => {
		setTexts((current) => ({ ...current, ...change }));
		onEdit();
	};
	const updateParameter = (field: NumericParameter, text: string) => {
		setTexts((current) => ({
			...current,
			parameters: { ...current.parameters, [field]: text },
		}));
		onEdit();
	};
	const readOnly = !canWrite || saving;
	const isNew = saved === null;
	const pending = isNew
		? Math.max(draft.changed.length, 1)
		: draft.changed.length;
	const fieldsShowingIssues = [
		"name",
		"startsOn",
		"endsOn",
		"rewardBudgetAmount",
		"status",
		"notificationDecision",
		"notificationBasis",
		"notificationDecidedOn",
		"excludedOrderSources",
		...PARAMETER_SPECS.map((spec) => spec.field),
	] as const satisfies readonly ProgrammeField[];
	const showsIssue = fieldsShowingIssues.some(shows);
	const error = (field: ProgrammeField, bound?: BoundFormatter) =>
		programmeIssueText(t, issueOf(field), bound);
	const dateBound = (value: number | string) =>
		typeof value === "string" ? formatters.date(value) : String(value);
	return (
		<div
			className="space-y-6"
			data-testid="loyalty-programme-form"
			data-new={isNew ? "true" : "false"}
		>
			<fieldset
				className="min-w-0 space-y-3 rounded-xl border border-line bg-surface-raised p-4"
				data-testid="loyalty-group-programme"
			>
				<legend className="px-1 text-base font-semibold">
					{t("settings.loyalty.group.programme")}
				</legend>
				<div className="grid gap-4 sm:grid-cols-2">
					<TextInput
						field="name"
						label={t("settings.loyalty.name.label")}
						hint={t("settings.loyalty.name.hint")}
						error={error("name")}
						readOnly={readOnly}
						value={texts.name}
						onChange={(name) => update({ name })}
						onBlur={() => touch("name")}
					/>
					<MoneyField
						id={fieldIdOf("rewardBudgetAmount")}
						testId={fieldIdOf("rewardBudgetAmount")}
						label={t("settings.loyalty.budget.label")}
						hint={t("settings.loyalty.budget.hint")}
						error={error(
							"rewardBudgetAmount",
							numericBound((value) =>
								value === MONEY_COLUMN_MAX
									? formatters.count(value)
									: formatters.moneyExact(value),
							),
						)}
						readOnly={readOnly}
						value={texts.rewardBudgetAmount}
						onChange={(rewardBudgetAmount) => update({ rewardBudgetAmount })}
						onBlur={() => touch("rewardBudgetAmount")}
						formatters={formatters}
						currencyCode={currencyCode}
					/>
					<DateField
						id={fieldIdOf("startsOn")}
						testId={fieldIdOf("startsOn")}
						label={t("settings.loyalty.startsOn.label")}
						error={error("startsOn", dateBound)}
						readOnly={readOnly}
						value={texts.startsOn}
						today={today}
						onChange={(startsOn) => update({ startsOn })}
						onBlur={() => touch("startsOn")}
					/>
					<DateField
						id={fieldIdOf("endsOn")}
						testId={fieldIdOf("endsOn")}
						label={t("settings.loyalty.endsOn.label")}
						hint={t("settings.loyalty.endsOn.hint")}
						error={error("endsOn", dateBound)}
						readOnly={readOnly}
						value={texts.endsOn}
						today={today}
						onChange={(endsOn) => update({ endsOn })}
						onBlur={() => touch("endsOn")}
					/>
				</div>
			</fieldset>
			<fieldset
				className="min-w-0 space-y-3 rounded-xl border border-line bg-surface-raised p-4"
				data-testid="loyalty-group-status"
			>
				<legend className="px-1 text-base font-semibold">
					{t("settings.loyalty.group.status")}
				</legend>
				<SelectField
					id={fieldIdOf("status")}
					testId={fieldIdOf("status")}
					label={t("settings.loyalty.status.label")}
					hint={t("settings.loyalty.status.hint")}
					error={error("status")}
					readOnly={readOnly}
					value={texts.status}
					options={LOYALTY_PROGRAMME_STATUSES.map((status) => ({
						value: status,
						label: t(STATUS_KEYS[status]),
					}))}
					onChange={(status) => update({ status })}
				/>
				<HoldNote texts={texts} />
			</fieldset>
			{PARAMETER_GROUPS.map(({ group, titleKey }) => (
				<fieldset
					key={group}
					className="min-w-0 space-y-3 rounded-xl border border-line bg-surface-raised p-4"
					data-testid={`loyalty-group-${group}`}
				>
					<legend className="px-1 text-base font-semibold">
						{t(titleKey)}
					</legend>
					<div className="grid gap-4 sm:grid-cols-2">
						{PARAMETER_SPECS.filter((spec) => spec.group === group).map(
							(spec) => (
								<ParameterInput
									key={spec.field}
									spec={spec}
									format={format}
									text={texts.parameters[spec.field]}
									error={error(spec.field, boundFormatterOf(spec, format))}
									readOnly={readOnly}
									onChange={(text) => updateParameter(spec.field, text)}
									onBlur={() => touch(spec.field)}
								/>
							),
						)}
					</div>
					{group === "limits" ? (
						<TextInput
							field="excludedOrderSources"
							label={t("settings.loyalty.sources.label")}
							hint={t("settings.loyalty.sources.hint")}
							error={error("excludedOrderSources")}
							readOnly={readOnly}
							value={texts.excludedOrderSources}
							onChange={(excludedOrderSources) =>
								update({ excludedOrderSources })
							}
							onBlur={() => touch("excludedOrderSources")}
							multiline
						/>
					) : null}
				</fieldset>
			))}
			<fieldset
				className="min-w-0 space-y-3 rounded-xl border border-line bg-surface-raised p-4"
				data-testid="loyalty-group-decision"
			>
				<legend className="px-1 text-base font-semibold">
					{t("settings.loyalty.group.decision")}
				</legend>
				<p className="text-sm text-ink-muted">
					{t("settings.loyalty.decision.intro")}
				</p>
				<DecisionOptions />
				<div className="grid gap-4 sm:grid-cols-2">
					<SelectField
						id={fieldIdOf("notificationDecision")}
						testId={fieldIdOf("notificationDecision")}
						label={t("settings.loyalty.decision.label")}
						error={error("notificationDecision")}
						readOnly={readOnly}
						value={texts.notificationDecision}
						options={NOTIFICATION_DECISIONS.map((decision) => ({
							value: decision,
							label: t(DECISION_KEYS[decision].label),
						}))}
						onChange={(notificationDecision) =>
							update({
								notificationDecision,
								...(notificationDecision !== "pending" &&
								texts.notificationDecidedOn === ""
									? { notificationDecidedOn: today }
									: {}),
							})
						}
					/>
					{texts.notificationDecision === "pending" ? null : (
						<DateField
							id={fieldIdOf("notificationDecidedOn")}
							testId={fieldIdOf("notificationDecidedOn")}
							label={t("settings.loyalty.decidedOn.label")}
							hint={t("settings.loyalty.decidedOn.hint")}
							error={error("notificationDecidedOn", dateBound)}
							readOnly={readOnly}
							value={texts.notificationDecidedOn}
							today={today}
							onChange={(notificationDecidedOn) =>
								update({ notificationDecidedOn })
							}
							onBlur={() => touch("notificationDecidedOn")}
						/>
					)}
				</div>
				<TextInput
					field="notificationBasis"
					label={t("settings.loyalty.basis.label")}
					hint={t("settings.loyalty.basis.hint", {
						max: formatters.count(NOTIFICATION_BASIS_MAX),
					})}
					error={error("notificationBasis")}
					readOnly={readOnly}
					value={texts.notificationBasis}
					onChange={(notificationBasis) => update({ notificationBasis })}
					onBlur={() => touch("notificationBasis")}
					multiline
				/>
			</fieldset>
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
						setTouched(new Set(fieldsShowingIssues));
						if (draft.change !== null) onSave(draft.change);
					}}
					onCancel={() => {
						setTexts(savedTexts);
						setTouched(NO_TOUCH);
						onEdit();
						if (isNew) onCancelNew?.();
					}}
					status={statusOf(t, outcome, draft.changed.length, showsIssue)}
				/>
			) : null}
		</div>
	);
}
