import type {
	EInvoiceStatus,
	PosFeatureStatus,
	TranNoResetPeriod,
} from "@fnb/reports";
import { type ReactNode, useMemo, useState } from "react";
import { Button } from "../../components/ui/button";
import { useT } from "../../i18n";
import type { IsoDate } from "../../lib/business-dates";
import type { Formatters } from "../../lib/format";
import type { SettingsAccess } from "../access";
import { AuditLine } from "../forms/audit-line";
import { DateField } from "../forms/date-field";
import { controlClass, Field } from "../forms/field";
import { IntegerField } from "../forms/integer-field";
import { dateBound, issueText, numericBound } from "../forms/issue-text";
import { OpeningHoursEditor } from "../forms/opening-hours-editor";
import { SaveBar, UNAVAILABLE_CLASS } from "../forms/save-bar";
import { SelectField } from "../forms/select-field";
import { ReadOnlyNotice } from "../read-only-notice";
import type { StoreProfile, StoreProfileChange } from "../source";
import { openingDateBounds } from "../validation";
import { type ProfileOutcome, profileStatusOf } from "./profile-outcome";
import {
	businessDayStartText,
	E_INVOICE_KEYS,
	E_INVOICE_OPTIONS,
	MEMBER_FEATURE_KEYS,
	MEMBER_FEATURE_OPTIONS,
	RECEIPT_PERIOD_KEYS,
	RECEIPT_PERIOD_OPTIONS,
	readStoreDraft,
	type StoreDraft,
	storeDraftOf,
} from "./store-fields";
import {
	type ReceiptSuggestion,
	receiptSuggestionText,
} from "./use-receipt-suggestions";

const DUPLICATE_CODE_CONSTRAINT = "stores_code_unique_in_tenant";

export interface StoreProfileFormProps {
	readonly profile: StoreProfile;
	readonly access: SettingsAccess;
	readonly hoursAccess: SettingsAccess;
	readonly suggestion: ReceiptSuggestion | undefined;
	readonly formatters: Formatters;
	readonly timeZone: string;
	readonly today: IsoDate;
	readonly saving: boolean;
	readonly outcome: ProfileOutcome;
	readonly onSave: (change: StoreProfileChange) => void;
	readonly onEdit: () => void;
}

function domIdOf(storeId: string): string {
	return `store-${storeId.replace(/[^A-Za-z0-9_-]/g, "-")}`;
}

function PosFact({
	label,
	children,
	testId,
}: {
	readonly label: string;
	readonly children: ReactNode;
	readonly testId: string;
}) {
	const t = useT();
	return (
		<div className="min-w-0" data-testid={testId}>
			<dt className="text-sm font-medium">{label}</dt>
			<dd className="flex flex-wrap items-center gap-x-2 gap-y-1">
				<span className="min-w-0 break-words">{children}</span>
				<span
					className="rounded-full border border-line bg-surface-sunken px-2 py-0.5 text-xs text-ink-muted"
					data-testid="store-from-pos"
				>
					{t("settings.store.fromPos")}
				</span>
			</dd>
		</div>
	);
}

export function StoreProfileForm({
	profile,
	access,
	hoursAccess,
	suggestion,
	formatters,
	timeZone,
	today,
	saving,
	outcome,
	onSave,
	onEdit,
}: StoreProfileFormProps) {
	const t = useT();
	const id = domIdOf(profile.storeId);
	const { locale } = formatters;
	const saved = useMemo(() => storeDraftOf(profile, locale), [profile, locale]);
	const savedKey = JSON.stringify(saved);
	const [syncedKey, setSyncedKey] = useState(savedKey);
	const [draft, setDraft] = useState<StoreDraft>(saved);
	if (syncedKey !== savedKey) {
		setSyncedKey(savedKey);
		setDraft(saved);
	}
	const reading = readStoreDraft(profile, saved, draft, locale, today);
	const pendingCount = reading.changed.length;
	const readOnly = !access.canWrite;
	const hoursReadOnly = readOnly || !hoursAccess.canWrite;
	const edit = (next: StoreDraft) => {
		if (saving) return;
		setDraft(next);
		onEdit();
	};
	const editText =
		(field: "code" | "openedOn" | "seatCount") => (text: string) =>
			edit({ ...draft, [field]: text });
	const refusedDuplicate =
		outcome.kind === "refused" &&
		outcome.constraint === DUPLICATE_CODE_CONSTRAINT &&
		reading.changed.includes("code");
	const codeError = refusedDuplicate
		? t("settings.store.code.duplicate")
		: issueText(t, reading.issues.code ?? null);
	const showsIssue =
		reading.hoursInvalid || Object.keys(reading.issues).length > 0;
	const suggestionText = receiptSuggestionText(t, suggestion, formatters.count);
	const offersDailySuggestion = !readOnly && suggestion?.restartsDaily === true;
	const suggestionApplied = draft.tranNoResetPeriod === "daily";
	return (
		<section
			aria-labelledby={`${id}-title`}
			className="min-w-0 space-y-4 rounded-xl border border-line bg-surface-raised p-4"
			data-testid="store-profile"
			data-store={profile.storeId}
		>
			<h3 id={`${id}-title`} className="text-lg font-semibold">
				{profile.name}
			</h3>
			<ReadOnlyNotice
				access={access}
				messages={{
					role: "settings.store.readOnly.role",
					scope: "settings.store.readOnly.scope",
				}}
			/>
			<div className="space-y-2">
				<dl className="grid gap-3 sm:grid-cols-2" data-testid="store-pos-facts">
					<PosFact label={t("settings.store.pos.name")} testId="store-pos-name">
						{profile.name}
					</PosFact>
					<PosFact
						label={t("settings.store.pos.address")}
						testId="store-pos-address"
					>
						{profile.address ?? t("settings.store.pos.noAddress")}
					</PosFact>
					<PosFact
						label={t("settings.store.pos.timeZone")}
						testId="store-pos-time-zone"
					>
						{profile.timeZone}
					</PosFact>
					<PosFact
						label={t("settings.store.pos.dayStart")}
						testId="store-pos-day-start"
					>
						{businessDayStartText(profile.businessDayStartMinutes)}
					</PosFact>
				</dl>
				<p className="text-xs text-ink-muted">{t("settings.store.pos.why")}</p>
			</div>
			<div className="grid gap-4 sm:grid-cols-2">
				<Field
					id={`${id}-code`}
					label={t("settings.store.code.label")}
					hint={t("settings.store.code.hint")}
					error={codeError}
					readOnly={readOnly}
				>
					{(control) => (
						<input
							{...control}
							type="text"
							autoComplete="off"
							spellCheck={false}
							value={draft.code}
							onChange={(event) => editText("code")(event.target.value)}
							className={controlClass}
							data-testid="store-code"
						/>
					)}
				</Field>
				<DateField
					id={`${id}-opened-on`}
					testId="store-opened-on"
					label={t("settings.store.openedOn.label")}
					hint={t("settings.store.openedOn.hint")}
					error={issueText(
						t,
						reading.issues.openedOn ?? null,
						dateBound(formatters.date),
					)}
					readOnly={readOnly}
					today={today}
					bounds={openingDateBounds(today)}
					value={draft.openedOn}
					onChange={editText("openedOn")}
				/>
				<IntegerField
					id={`${id}-seats`}
					testId="store-seats"
					label={t("settings.store.seats.label")}
					hint={t("settings.store.seats.hint")}
					error={issueText(
						t,
						reading.issues.seatCount ?? null,
						numericBound(formatters.count),
					)}
					readOnly={readOnly}
					locale={locale}
					unit={t("settings.store.seats.unit")}
					value={draft.seatCount}
					onChange={editText("seatCount")}
				/>
				<SelectField<EInvoiceStatus>
					id={`${id}-e-invoice`}
					testId="store-e-invoice"
					label={t("settings.store.eInvoice.label")}
					hint={t("settings.store.eInvoice.hint")}
					readOnly={readOnly}
					value={draft.eInvoiceStatus}
					options={E_INVOICE_OPTIONS.map((value) => ({
						value,
						label: t(E_INVOICE_KEYS[value]),
					}))}
					onChange={(eInvoiceStatus) => edit({ ...draft, eInvoiceStatus })}
				/>
				<div className="min-w-0 space-y-2">
					<SelectField<TranNoResetPeriod>
						id={`${id}-receipts`}
						testId="store-receipts"
						label={t("settings.store.receipts.label")}
						hint={
							suggestionText === null
								? t("settings.store.receipts.hint")
								: `${t("settings.store.receipts.hint")} ${suggestionText}`
						}
						readOnly={readOnly}
						value={draft.tranNoResetPeriod}
						options={RECEIPT_PERIOD_OPTIONS.map((value) => ({
							value,
							label: t(RECEIPT_PERIOD_KEYS[value]),
						}))}
						onChange={(tranNoResetPeriod) =>
							edit({ ...draft, tranNoResetPeriod })
						}
					/>
					{offersDailySuggestion ? (
						<Button
							tone="secondary"
							size="compact"
							aria-disabled={suggestionApplied || undefined}
							onClick={
								suggestionApplied
									? undefined
									: () => edit({ ...draft, tranNoResetPeriod: "daily" })
							}
							className={UNAVAILABLE_CLASS}
							data-testid="store-receipts-apply"
						>
							{t("settings.store.receipts.apply")}
						</Button>
					) : null}
				</div>
				<SelectField<PosFeatureStatus>
					id={`${id}-member`}
					testId="store-member"
					label={t("settings.store.member.label")}
					hint={t("settings.store.member.hint")}
					readOnly={readOnly}
					value={draft.memberCaptureStatus}
					options={MEMBER_FEATURE_OPTIONS.map((value) => ({
						value,
						label: t(MEMBER_FEATURE_KEYS[value]),
					}))}
					onChange={(memberCaptureStatus) =>
						edit({ ...draft, memberCaptureStatus })
					}
				/>
			</div>
			<div className="space-y-2">
				{readOnly ? null : (
					<ReadOnlyNotice
						access={hoursAccess}
						messages={{ ownerOnly: "settings.store.hours.readOnly" }}
						testId="store-hours-read-only"
					/>
				)}
				{profile.openingHours === null ? (
					<p className="text-xs text-ink-muted" data-testid="store-hours-unset">
						{t("settings.store.hours.unset")}
					</p>
				) : null}
				<OpeningHoursEditor
					id={`${id}-hours`}
					legend={t("settings.store.hours.label")}
					hint={t("settings.store.hours.hint")}
					readOnly={hoursReadOnly}
					showIssues={reading.hoursInvalid}
					value={draft.openingHours}
					onChange={(openingHours) => edit({ ...draft, openingHours })}
				/>
			</div>
			<AuditLine
				entry={profile.audit}
				formatters={formatters}
				timeZone={timeZone}
			/>
			{access.canWrite ? (
				<SaveBar
					label={t("settings.store.saveBar", { store: profile.name })}
					pendingCount={pendingCount}
					canSave={reading.changes !== null}
					saving={saving}
					onSave={() => {
						if (reading.changes !== null) onSave(reading.changes);
					}}
					onCancel={() => edit(saved)}
					status={profileStatusOf(t, outcome, pendingCount, showsIssue)}
				/>
			) : null}
		</section>
	);
}
