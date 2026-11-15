import {
	DEFAULT_REPORT_SETTINGS,
	type ReportSettings,
	Z_THRESHOLD,
} from "@fnb/reports";
import { useMemo, useState } from "react";
import { type MessageKey, useT } from "../../i18n";
import type { Formatters } from "../../lib/format";
import { AuditLine } from "../forms/audit-line";
import { IntegerField } from "../forms/integer-field";
import { issueText } from "../forms/issue-text";
import { MoneyField } from "../forms/money-field";
import { PercentField } from "../forms/percent-field";
import {
	RestoreDefaultsButton,
	SaveBar,
	type SaveBarStatus,
} from "../forms/save-bar";
import type { ReportSettingsState, SettingsWriteCode } from "../source";
import { WRITE_ERROR_KEYS } from "../use-settings-mutation";
import type { ValidationIssue } from "../validation";
import {
	rangeIssueOf,
	readThresholdDraft,
	shownLimitOf,
	THRESHOLD_GROUPS,
	THRESHOLD_SPECS,
	type ThresholdField,
	type ThresholdFormat,
	type ThresholdSpec,
	type ThresholdTexts,
	thresholdBoundFormatter,
	thresholdDefaultText,
	thresholdFieldOfConstraint,
	thresholdTextsOf,
} from "./fields";

export type ThresholdsOutcome =
	| { readonly kind: "idle" }
	| { readonly kind: "saved" }
	| {
			readonly kind: "refused";
			readonly code: SettingsWriteCode;
			readonly constraint: string | null;
	  };

export interface ThresholdsFormProps {
	readonly saved: ReportSettingsState;
	readonly canWrite: boolean;
	readonly formatters: Formatters;
	readonly currencyCode: string;
	readonly timeZone: string;
	readonly saving: boolean;
	readonly outcome: ThresholdsOutcome;
	readonly onSave: (changes: Partial<ReportSettings>) => void;
	readonly onEdit: () => void;
}

const NO_TOUCH: ReadonlySet<ThresholdField> = new Set();

function fieldId(field: ThresholdField): string {
	return `thresholds-${field}`;
}

interface ThresholdInputProps {
	readonly spec: ThresholdSpec;
	readonly format: ThresholdFormat;
	readonly text: string;
	readonly issue: ValidationIssue | null;
	readonly readOnly: boolean;
	readonly onChange: (text: string) => void;
	readonly onBlur: () => void;
}

function ThresholdInput({
	spec,
	format,
	text,
	issue,
	readOnly,
	onChange,
	onBlur,
}: ThresholdInputProps) {
	const t = useT();
	const unit = spec.unitKey === null ? null : t(spec.unitKey);
	const shared = {
		id: fieldId(spec.field),
		testId: fieldId(spec.field),
		label: t(spec.labelKey),
		hint: `${t(spec.hintKey)} ${t("settings.thresholds.default", {
			value: thresholdDefaultText(spec, format, unit),
		})}`,
		error: issueText(t, issue, thresholdBoundFormatter(spec, format)),
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
			{...(unit === null ? {} : { unit })}
		/>
	);
}

function statusOf(
	t: (key: MessageKey) => string,
	outcome: ThresholdsOutcome,
	pendingCount: number,
	showsIssue: boolean,
): SaveBarStatus | null {
	if (outcome.kind === "refused") {
		return { tone: "error", text: t(WRITE_ERROR_KEYS[outcome.code]) };
	}
	if (showsIssue) {
		return { tone: "info", text: t("settings.saveBar.invalid") };
	}
	if (outcome.kind === "saved" && pendingCount === 0) {
		return { tone: "success", text: t("settings.saved") };
	}
	return null;
}

export function ThresholdsForm({
	saved,
	canWrite,
	formatters,
	currencyCode,
	timeZone,
	saving,
	outcome,
	onSave,
	onEdit,
}: ThresholdsFormProps) {
	const t = useT();
	const format = useMemo<ThresholdFormat>(
		() => ({ formatters, currencyCode }),
		[formatters, currencyCode],
	);
	const savedTexts = useMemo(
		() => thresholdTextsOf(saved.settings, format),
		[saved.settings, format],
	);
	const defaultTexts = useMemo(
		() => thresholdTextsOf(DEFAULT_REPORT_SETTINGS, format),
		[format],
	);
	const savedKey = JSON.stringify(savedTexts);
	const [syncedKey, setSyncedKey] = useState(savedKey);
	const [texts, setTexts] = useState<ThresholdTexts>(savedTexts);
	const [touched, setTouched] = useState(NO_TOUCH);
	if (syncedKey !== savedKey) {
		setSyncedKey(savedKey);
		setTexts(savedTexts);
		setTouched(NO_TOUCH);
	}
	const draft = readThresholdDraft(saved.settings, texts, format);
	const refusedField =
		outcome.kind === "refused"
			? thresholdFieldOfConstraint(outcome.constraint)
			: null;
	const issueOfField = (spec: ThresholdSpec): ValidationIssue | null => {
		if (!canWrite) return null;
		const { field } = spec;
		const issue = draft.issues[field] ?? null;
		if (issue !== null) {
			return touched.has(field) || texts[field] === savedTexts[field]
				? issue
				: null;
		}
		return refusedField === field ? rangeIssueOf(spec) : null;
	};
	const replaceTexts = (next: ThresholdTexts) => {
		setTexts(next);
		setTouched(NO_TOUCH);
		onEdit();
	};
	const atDefaults = THRESHOLD_SPECS.every(
		(spec) => texts[spec.field] === defaultTexts[spec.field],
	);
	const showsIssue = THRESHOLD_SPECS.some(
		(spec) => issueOfField(spec) !== null,
	);
	const save = () => {
		if (draft.changes !== null) onSave(draft.changes);
	};
	return (
		<div className="space-y-6" data-testid="thresholds-form">
			{THRESHOLD_GROUPS.map(({ group, titleKey }) => (
				<fieldset
					key={group}
					className="min-w-0 space-y-3 rounded-xl border border-line bg-surface-raised p-4"
					data-testid={`thresholds-group-${group}`}
				>
					<legend className="px-1 text-base font-semibold">
						{t(titleKey)}
					</legend>
					<div className="grid gap-4 sm:grid-cols-2">
						{THRESHOLD_SPECS.filter((spec) => spec.group === group).map(
							(spec) => (
								<ThresholdInput
									key={spec.field}
									spec={spec}
									format={format}
									text={texts[spec.field]}
									issue={issueOfField(spec)}
									readOnly={!canWrite || saving}
									onChange={(text) => {
										setTexts((current) => ({ ...current, [spec.field]: text }));
										onEdit();
									}}
									onBlur={() =>
										setTouched((current) => new Set(current).add(spec.field))
									}
								/>
							),
						)}
					</div>
					{group === "cash" ? (
						<p
							className="text-sm text-ink-muted"
							data-testid="thresholds-z-fixed"
						>
							{t("settings.thresholds.cash.zFixed", {
								value: formatters.count(Z_THRESHOLD),
							})}
						</p>
					) : null}
				</fieldset>
			))}
			<div className="flex flex-wrap items-center gap-3">
				{saved.hasRow && saved.audit === null ? null : (
					<AuditLine
						entry={saved.hasRow ? saved.audit : null}
						formatters={formatters}
						timeZone={timeZone}
						neverText={t("settings.thresholds.usingDefaults")}
					/>
				)}
				{canWrite ? (
					<span className="ml-auto">
						<RestoreDefaultsButton
							disabled={atDefaults || saving}
							onClick={() => replaceTexts(defaultTexts)}
						/>
					</span>
				) : null}
			</div>
			{canWrite ? (
				<SaveBar
					pendingCount={draft.changed.length}
					canSave={draft.changes !== null}
					saving={saving}
					onSave={save}
					onCancel={() => replaceTexts(savedTexts)}
					status={statusOf(t, outcome, draft.changed.length, showsIssue)}
				/>
			) : null}
		</div>
	);
}
