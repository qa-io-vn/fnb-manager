import { useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { Button } from "../../components/ui/button";
import { useT } from "../../i18n";
import { todayIn } from "../../lib/business-dates";
import {
	settingsQueryKey,
	useStoreProfiles,
	useTenantProfile,
} from "../../settings/queries";
import {
	useRetrySettingsSource,
	useSettingsSourceState,
} from "../../settings/settings-source-context";
import type {
	SettingsSource,
	StoreProfile,
	StoreProfileChange,
	TenantProfile,
	TenantProfileChange,
} from "../../settings/source";
import { profileOutcomeOf } from "../../settings/store/profile-outcome";
import { touchesOpeningHours } from "../../settings/store/store-fields";
import { StoreProfileForm } from "../../settings/store/store-profile-form";
import { TenantProfileForm } from "../../settings/store/tenant-profile-form";
import {
	type ReceiptSuggestion,
	useReceiptSuggestions,
} from "../../settings/store/use-receipt-suggestions";
import { useSettingsAccess } from "../../settings/use-settings-access";
import { useSettingsMutation } from "../../settings/use-settings-mutation";
import { useFormatters } from "../../state/formatters";
import { useReadyTenantScope } from "../../state/tenant-scope";

interface StoreWrite {
	readonly storeId: string;
	readonly change: StoreProfileChange;
}

export function withSavedStore(
	profiles: readonly StoreProfile[] | undefined,
	saved: StoreProfile,
): StoreProfile[] | undefined {
	return profiles?.map((profile) =>
		profile.storeId === saved.storeId ? saved : profile,
	);
}

function LoadFailed({
	testId,
	onRetry,
}: {
	readonly testId: string;
	readonly onRetry: () => void;
}) {
	const t = useT();
	return (
		<div role="alert" className="space-y-2" data-testid={testId}>
			<p>{t("app.error")}</p>
			<Button tone="secondary" size="compact" onClick={onRetry}>
				{t("app.retry")}
			</Button>
		</div>
	);
}

function useRetryRead(refetch: () => unknown): {
	readonly sourceFailed: boolean;
	readonly retry: () => void;
} {
	const sourceState = useSettingsSourceState();
	const retrySource = useRetrySettingsSource();
	const sourceFailed = sourceState.status === "failed";
	return {
		sourceFailed,
		retry: sourceFailed ? retrySource : () => void refetch(),
	};
}

function TenantSection() {
	const t = useT();
	const { tenant } = useReadyTenantScope();
	const formatters = useFormatters(tenant);
	const access = useSettingsAccess("tenantProfile");
	const profile = useTenantProfile();
	const { sourceFailed, retry } = useRetryRead(profile.refetch);
	const queryClient = useQueryClient();
	const writeTenant = useCallback(
		async (
			source: SettingsSource,
			tenantId: string,
			change: TenantProfileChange,
		) => {
			const saved = await source.updateTenantProfile(tenantId, change);
			queryClient.setQueryData<TenantProfile>(
				settingsQueryKey(source.kind, tenantId, "tenantProfile"),
				saved,
			);
		},
		[queryClient],
	);
	const mutation = useSettingsMutation(writeTenant);
	if (profile.data === undefined) {
		return sourceFailed || profile.status === "error" ? (
			<LoadFailed testId="tenant-profile-load-failed" onRetry={retry} />
		) : (
			<p role="status">{t("app.loading")}</p>
		);
	}
	const outcome = profileOutcomeOf(mutation);
	return (
		<TenantProfileForm
			profile={profile.data}
			access={access}
			formatters={formatters}
			timeZone={tenant.timeZone}
			saving={mutation.saving}
			outcome={outcome}
			onSave={(change) => void mutation.save(change)}
			onEdit={() => {
				if (outcome.kind !== "idle" && !mutation.saving) mutation.reset();
			}}
		/>
	);
}

function StoreSection({
	profile,
	suggestion,
}: {
	readonly profile: StoreProfile;
	readonly suggestion: ReceiptSuggestion | undefined;
}) {
	const { tenant } = useReadyTenantScope();
	const formatters = useFormatters(tenant);
	const access = useSettingsAccess("storeProfile", profile.storeId);
	const hoursAccess = useSettingsAccess("openingHours", profile.storeId);
	const queryClient = useQueryClient();
	const writeStore = useCallback(
		async (source: SettingsSource, tenantId: string, write: StoreWrite) => {
			const saved = await source.updateStoreProfile(
				tenantId,
				write.storeId,
				write.change,
			);
			queryClient.setQueryData<StoreProfile[]>(
				settingsQueryKey(source.kind, tenantId, "storeProfiles"),
				(previous) => withSavedStore(previous, saved),
			);
		},
		[queryClient],
	);
	const mutation = useSettingsMutation(writeStore, { touchesOpeningHours });
	const outcome = profileOutcomeOf(mutation);
	return (
		<StoreProfileForm
			profile={profile}
			access={access}
			hoursAccess={hoursAccess}
			suggestion={suggestion}
			formatters={formatters}
			timeZone={profile.timeZone}
			today={todayIn(profile.timeZone, new Date())}
			saving={mutation.saving}
			outcome={outcome}
			onSave={(change) =>
				void mutation.save({ storeId: profile.storeId, change })
			}
			onEdit={() => {
				if (outcome.kind !== "idle" && !mutation.saving) mutation.reset();
			}}
		/>
	);
}

function StoresSection() {
	const t = useT();
	const profiles = useStoreProfiles();
	const { sourceFailed, retry } = useRetryRead(profiles.refetch);
	const suggestions = useReceiptSuggestions(profiles.data);
	if (profiles.data === undefined) {
		return sourceFailed || profiles.status === "error" ? (
			<LoadFailed testId="store-profiles-load-failed" onRetry={retry} />
		) : (
			<p role="status">{t("app.loading")}</p>
		);
	}
	if (profiles.data.length === 0) {
		return (
			<p className="text-ink-muted" data-testid="store-profiles-empty">
				{t("settings.store.empty")}
			</p>
		);
	}
	return (
		<div
			className="space-y-6"
			data-testid="store-profiles"
			data-receipt-suggestions={suggestions.settled ? "settled" : "loading"}
		>
			{profiles.data.map((profile) => (
				<StoreSection
					key={profile.storeId}
					profile={profile}
					suggestion={suggestions.byStore.get(profile.storeId)}
				/>
			))}
		</div>
	);
}

export default function CuaHangPage() {
	const t = useT();
	const { tenant } = useReadyTenantScope();
	return (
		<div className="space-y-6" data-testid="store-page">
			<p className="text-sm text-ink-muted" data-testid="store-page-note">
				{t("settings.store.intro")}
			</p>
			<TenantSection key={`tenant-${tenant.id}`} />
			<StoresSection key={`stores-${tenant.id}`} />
		</div>
	);
}
