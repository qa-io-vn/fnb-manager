import { useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { type MessageKey, useT } from "../../i18n";
import { staffPageAccess } from "../../settings/access";
import type { ManualSettingsSource } from "../../settings/manual/source";
import {
	settingsQueryKey,
	useMembership,
	useStaffContact,
	useStaffRevenueVisibility,
} from "../../settings/queries";
import { ReadOnlyNotice } from "../../settings/read-only-notice";
import { SectionLoadState, useSectionLoad } from "../../settings/section-load";
import type { SettingsSource, SettingsWriteCode } from "../../settings/source";
import { RevenueVisibilityForm } from "../../settings/staff/revenue-visibility-form";
import type {
	StaffRevenueVisibility,
	StaffSettingsSource,
} from "../../settings/staff/source";
import { StaffAppSection } from "../../settings/staff/staff-app-section";
import { StaffContactForm } from "../../settings/staff/staff-contact-form";
import { StaffRoster } from "../../settings/staff/staff-roster";
import { profileOutcomeOf } from "../../settings/store/profile-outcome";
import { useSettingsAccess } from "../../settings/use-settings-access";
import { useSettingsMutation } from "../../settings/use-settings-mutation";
import { useReadyTenantScope } from "../../state/tenant-scope";

export function revenueErrorKey(
	errorCode: SettingsWriteCode | null,
	errorKey: MessageKey | null,
): MessageKey | null {
	return errorCode === "forbidden"
		? "settings.staff.revenue.error.forbidden"
		: errorKey;
}

function RevenueSection() {
	const access = useSettingsAccess("staffRevenue");
	const visibility = useStaffRevenueVisibility();
	const load = useSectionLoad([visibility]);
	const queryClient = useQueryClient();
	const write = useCallback(
		async (
			_source: SettingsSource,
			tenantId: string,
			level: StaffRevenueVisibility,
			_manual: ManualSettingsSource,
			staff: StaffSettingsSource,
		) => {
			const saved = await staff.setStaffRevenueVisibility(tenantId, level);
			queryClient.setQueryData<StaffRevenueVisibility>(
				settingsQueryKey(staff.kind, tenantId, "staffRevenue"),
				saved,
			);
		},
		[queryClient],
	);
	const mutation = useSettingsMutation(write);
	if (visibility.data === undefined) {
		return (
			<SectionLoadState load={load} failedTestId="staff-revenue-load-failed" />
		);
	}
	const errorKey = revenueErrorKey(mutation.errorCode, mutation.errorKey);
	const outcome = profileOutcomeOf({ ...mutation, errorKey });
	return (
		<RevenueVisibilityForm
			saved={visibility.data}
			access={access}
			saving={mutation.saving}
			outcome={outcome}
			onSave={(level) => void mutation.save(level)}
			onEdit={() => {
				if (outcome.kind !== "idle" && !mutation.saving) mutation.reset();
			}}
		/>
	);
}

export function contactErrorKey(
	errorCode: SettingsWriteCode | null,
	errorKey: MessageKey | null,
): MessageKey | null {
	if (errorCode === "forbidden")
		return "settings.staff.contact.error.forbidden";
	if (errorCode === "invalid") return "settings.staff.contact.error.invalid";
	return errorKey;
}

function ContactSection() {
	const access = useSettingsAccess("staffContact");
	const contact = useStaffContact();
	const load = useSectionLoad([contact]);
	const queryClient = useQueryClient();
	const write = useCallback(
		async (
			_source: SettingsSource,
			tenantId: string,
			text: string | null,
			_manual: ManualSettingsSource,
			staff: StaffSettingsSource,
		) => {
			const saved = await staff.setStaffContact(tenantId, text);
			queryClient.setQueryData<string | null>(
				settingsQueryKey(staff.kind, tenantId, "staffContact"),
				saved,
			);
		},
		[queryClient],
	);
	const mutation = useSettingsMutation(write);
	if (contact.data === undefined) {
		return (
			<SectionLoadState load={load} failedTestId="staff-contact-load-failed" />
		);
	}
	const errorKey = contactErrorKey(mutation.errorCode, mutation.errorKey);
	const outcome = profileOutcomeOf({ ...mutation, errorKey });
	return (
		<StaffContactForm
			saved={contact.data}
			access={access}
			saving={mutation.saving}
			outcome={outcome}
			onSave={(text) => void mutation.save(text)}
			onEdit={() => {
				if (outcome.kind !== "idle" && !mutation.saving) mutation.reset();
			}}
		/>
	);
}

function StaffBody() {
	const t = useT();
	const membership = useMembership();
	const member = membership.status === "success" ? membership.data : undefined;
	const access =
		membership.status === "error"
			? { canWrite: false, reason: "unavailable" as const }
			: staffPageAccess(member);
	return (
		<div className="space-y-6" data-testid="staff-page">
			<p className="text-sm text-ink-muted" data-testid="staff-page-note">
				{t("settings.staff.intro")}
			</p>
			<ReadOnlyNotice
				access={access}
				messages={{ role: "settings.staff.readOnly.role" }}
			/>
			{access.canWrite ? (
				<>
					<StaffRoster />
					<StaffAppSection />
					<ContactSection />
					{member?.role === "owner" ? <RevenueSection /> : null}
				</>
			) : null}
		</div>
	);
}

export default function NhanVienPage() {
	const { tenant } = useReadyTenantScope();
	return <StaffBody key={tenant.id} />;
}
