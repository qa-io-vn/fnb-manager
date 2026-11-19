import { useId, useState } from "react";
import { type MessageKey, useT } from "../../i18n";
import type { SettingsAccess } from "../access";
import { controlClass, Field } from "../forms/field";
import { SaveBar } from "../forms/save-bar";
import { ReadOnlyNotice } from "../read-only-notice";
import { type ProfileOutcome, profileStatusOf } from "../store/profile-outcome";
import {
	contactLength,
	normalisedContact,
	STAFF_CONTACT_MAX,
	type StaffContactIssue,
	staffContactIssue,
} from "./staff-contact-rules";

export const CONTACT_ISSUE_KEYS: Readonly<
	Record<StaffContactIssue, MessageKey>
> = {
	tooLong: "settings.staff.contact.tooLong",
	control: "settings.staff.contact.control",
	link: "settings.staff.contact.link",
};

export interface StaffContactFormProps {
	readonly saved: string | null;
	readonly access: SettingsAccess;
	readonly saving: boolean;
	readonly outcome: ProfileOutcome;
	readonly onSave: (text: string | null) => void;
	readonly onEdit: () => void;
}

export function StaffContactForm({
	saved,
	access,
	saving,
	outcome,
	onSave,
	onEdit,
}: StaffContactFormProps) {
	const t = useT();
	const ids = useId();
	const [synced, setSynced] = useState(saved);
	const [draft, setDraft] = useState(saved ?? "");
	if (synced !== saved) {
		setSynced(saved);
		setDraft(saved ?? "");
	}
	const issue = staffContactIssue(draft);
	const next = normalisedContact(draft);
	const pendingCount = next === saved ? 0 : 1;
	const length = contactLength(next);
	return (
		<section
			aria-labelledby={`${ids}-title`}
			className="min-w-0 space-y-3 rounded-xl border border-line bg-surface-raised px-4 py-3 print:hidden"
			data-testid="staff-contact"
		>
			<h3 id={`${ids}-title`} className="text-base font-semibold">
				{t("settings.staff.contact.title")}
			</h3>
			<p className="text-sm text-ink-muted" data-testid="staff-contact-note">
				{t("settings.staff.contact.note")}
			</p>
			<ReadOnlyNotice
				access={access}
				messages={{ ownerOnly: "settings.staff.contact.readOnly" }}
				testId="staff-contact-read-only"
			/>
			{access.canWrite ? (
				<>
					<Field
						id={`${ids}-text`}
						label={t("settings.staff.contact.label")}
						hint={`${t("settings.staff.contact.hint", { max: STAFF_CONTACT_MAX })} ${t("settings.staff.contact.count", { count: length, max: STAFF_CONTACT_MAX })}`}
						error={
							issue === null
								? null
								: t(CONTACT_ISSUE_KEYS[issue], { max: STAFF_CONTACT_MAX })
						}
					>
						{(control) => (
							<textarea
								{...control}
								rows={4}
								value={draft}
								readOnly={saving}
								onChange={(event) => {
									setDraft(event.target.value);
									onEdit();
								}}
								className={`${controlClass} py-2`}
								data-testid="staff-contact-text"
							/>
						)}
					</Field>
					<SaveBar
						label={t("settings.staff.contact.saveBar")}
						pendingCount={pendingCount}
						canSave={issue === null}
						saving={saving}
						onSave={() => {
							if (issue === null) onSave(next);
						}}
						onCancel={() => {
							setDraft(saved ?? "");
							onEdit();
						}}
						status={profileStatusOf(t, outcome, pendingCount, issue !== null)}
					/>
				</>
			) : (
				<p
					className="whitespace-pre-line break-words rounded-lg border border-line px-3 py-2 text-sm"
					data-testid="staff-contact-current"
				>
					{saved ?? t("settings.staff.contact.empty")}
				</p>
			)}
		</section>
	);
}
