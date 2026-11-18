import { useId, useState } from "react";
import { type MessageKey, useT } from "../../i18n";
import type { SettingsAccess } from "../access";
import { SaveBar } from "../forms/save-bar";
import { ReadOnlyNotice } from "../read-only-notice";
import { type ProfileOutcome, profileStatusOf } from "../store/profile-outcome";
import {
	STAFF_REVENUE_VISIBILITIES,
	type StaffRevenueVisibility,
} from "./source";

export const REVENUE_LEVEL_KEYS: Readonly<
	Record<StaffRevenueVisibility, { label: MessageKey; hint: MessageKey }>
> = {
	all: {
		label: "settings.staff.revenue.all",
		hint: "settings.staff.revenue.allHint",
	},
	store_totals: {
		label: "settings.staff.revenue.storeTotals",
		hint: "settings.staff.revenue.storeTotalsHint",
	},
	none: {
		label: "settings.staff.revenue.none",
		hint: "settings.staff.revenue.noneHint",
	},
};

export interface RevenueVisibilityFormProps {
	readonly saved: StaffRevenueVisibility;
	readonly access: SettingsAccess;
	readonly saving: boolean;
	readonly outcome: ProfileOutcome;
	readonly onSave: (visibility: StaffRevenueVisibility) => void;
	readonly onEdit: () => void;
}

export function RevenueVisibilityForm({
	saved,
	access,
	saving,
	outcome,
	onSave,
	onEdit,
}: RevenueVisibilityFormProps) {
	const t = useT();
	const ids = useId();
	const [synced, setSynced] = useState(saved);
	const [draft, setDraft] = useState(saved);
	if (synced !== saved) {
		setSynced(saved);
		setDraft(saved);
	}
	const pendingCount = draft === saved ? 0 : 1;
	const choose = (next: StaffRevenueVisibility) => {
		if (saving) return;
		setDraft(next);
		onEdit();
	};
	return (
		<section
			aria-labelledby={`${ids}-title`}
			className="min-w-0 space-y-3 rounded-xl border border-line bg-surface-raised px-4 py-3 print:hidden"
			data-testid="staff-revenue"
			data-saved={saved}
		>
			<h3 id={`${ids}-title`} className="text-base font-semibold">
				{t("settings.staff.revenue.title")}
			</h3>
			<p className="text-sm text-ink-muted" data-testid="staff-revenue-note">
				{t("settings.staff.revenue.note")}
			</p>
			<ReadOnlyNotice
				access={access}
				messages={{ ownerOnly: "settings.staff.revenue.readOnly" }}
			/>
			{access.canWrite ? (
				<fieldset className="min-w-0 space-y-2">
					<legend className="text-sm font-medium">
						{t("settings.staff.revenue.legend")}
					</legend>
					{STAFF_REVENUE_VISIBILITIES.map((level) => {
						const id = `${ids}-${level}`;
						return (
							<div
								key={level}
								className="flex items-start gap-3 rounded-lg border border-line px-3 py-2"
								data-testid="staff-revenue-option"
								data-level={level}
							>
								<input
									id={id}
									type="radio"
									name={`${ids}-level`}
									value={level}
									checked={draft === level}
									onChange={() => choose(level)}
									aria-describedby={`${id}-hint`}
									className="mt-0.5 size-6 shrink-0 accent-accent"
								/>
								<div className="min-w-0">
									<label htmlFor={id} className="font-medium">
										{t(REVENUE_LEVEL_KEYS[level].label)}
									</label>
									<p id={`${id}-hint`} className="text-sm text-ink-muted">
										{t(REVENUE_LEVEL_KEYS[level].hint)}
									</p>
								</div>
							</div>
						);
					})}
				</fieldset>
			) : (
				<div className="space-y-1" data-testid="staff-revenue-current">
					<p className="font-medium">
						{t("settings.staff.revenue.current", {
							level: t(REVENUE_LEVEL_KEYS[saved].label),
						})}
					</p>
					<p className="text-sm text-ink-muted">
						{t(REVENUE_LEVEL_KEYS[saved].hint)}
					</p>
				</div>
			)}
			{access.canWrite ? (
				<SaveBar
					label={t("settings.staff.revenue.saveBar")}
					pendingCount={pendingCount}
					canSave
					saving={saving}
					onSave={() => onSave(draft)}
					onCancel={() => choose(saved)}
					status={profileStatusOf(t, outcome, pendingCount, false)}
				/>
			) : null}
		</section>
	);
}
