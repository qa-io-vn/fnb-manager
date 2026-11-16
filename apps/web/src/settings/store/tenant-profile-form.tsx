import { useState } from "react";
import { type Language, languages, useT } from "../../i18n";
import type { Formatters } from "../../lib/format";
import type { SettingsAccess } from "../access";
import { AuditLine } from "../forms/audit-line";
import { SaveBar } from "../forms/save-bar";
import { SelectField } from "../forms/select-field";
import { ReadOnlyNotice } from "../read-only-notice";
import type { LegalForm, TenantProfile, TenantProfileChange } from "../source";
import { type ProfileOutcome, profileStatusOf } from "./profile-outcome";
import {
	LANGUAGE_KEYS,
	LEGAL_FORM_KEYS,
	LEGAL_FORM_OPTIONS,
	type TenantDraft,
	tenantChangeOf,
	tenantDraftOf,
} from "./store-fields";

export interface TenantProfileFormProps {
	readonly profile: TenantProfile;
	readonly access: SettingsAccess;
	readonly formatters: Formatters;
	readonly timeZone: string;
	readonly saving: boolean;
	readonly outcome: ProfileOutcome;
	readonly onSave: (change: TenantProfileChange) => void;
	readonly onEdit: () => void;
}

const HEADING_ID = "tenant-profile-title";

export function TenantProfileForm({
	profile,
	access,
	formatters,
	timeZone,
	saving,
	outcome,
	onSave,
	onEdit,
}: TenantProfileFormProps) {
	const t = useT();
	const saved = tenantDraftOf(profile);
	const savedKey = JSON.stringify(saved);
	const [syncedKey, setSyncedKey] = useState(savedKey);
	const [draft, setDraft] = useState<TenantDraft>(saved);
	if (syncedKey !== savedKey) {
		setSyncedKey(savedKey);
		setDraft(saved);
	}
	const change = tenantChangeOf(profile, draft);
	const pendingCount = Object.keys(change).length;
	const readOnly = !access.canWrite;
	const edit = (next: TenantDraft) => {
		if (saving) return;
		setDraft(next);
		onEdit();
	};
	return (
		<section
			aria-labelledby={HEADING_ID}
			className="min-w-0 space-y-4 rounded-xl border border-line bg-surface-raised p-4"
			data-testid="tenant-profile"
		>
			<h3 id={HEADING_ID} className="text-lg font-semibold">
				{t("settings.store.tenant.title")}
			</h3>
			<ReadOnlyNotice
				access={access}
				messages={{ ownerOnly: "settings.store.tenant.readOnly" }}
			/>
			<div className="grid gap-4 sm:grid-cols-2">
				<SelectField<LegalForm>
					id="tenant-legal-form"
					testId="tenant-legal-form"
					label={t("settings.store.legalForm.label")}
					hint={`${t("settings.store.legalForm.hint")} ${t("settings.store.legalForm.checked")}`}
					readOnly={readOnly}
					value={draft.legalForm}
					options={LEGAL_FORM_OPTIONS.map((value) => ({
						value,
						label: t(LEGAL_FORM_KEYS[value]),
					}))}
					onChange={(legalForm) => edit({ ...draft, legalForm })}
				/>
				<SelectField<Language>
					id="tenant-default-language"
					testId="tenant-default-language"
					label={t("settings.store.language.label")}
					hint={t("settings.store.language.hint")}
					readOnly={readOnly}
					value={draft.defaultLanguage}
					options={languages.map((value) => ({
						value,
						label: t(LANGUAGE_KEYS[value]),
					}))}
					onChange={(defaultLanguage) => edit({ ...draft, defaultLanguage })}
				/>
			</div>
			<AuditLine
				entry={profile.audit}
				formatters={formatters}
				timeZone={timeZone}
			/>
			{access.canWrite ? (
				<SaveBar
					label={t("settings.store.tenant.saveBar")}
					pendingCount={pendingCount}
					canSave
					saving={saving}
					onSave={() => onSave(change)}
					onCancel={() => edit(saved)}
					status={profileStatusOf(t, outcome, pendingCount, false)}
				/>
			) : null}
		</section>
	);
}
