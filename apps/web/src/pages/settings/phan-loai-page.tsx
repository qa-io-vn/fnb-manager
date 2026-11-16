import { useQueryClient } from "@tanstack/react-query";
import { type ComponentType, useCallback } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Button } from "../../components/ui/button";
import { type MessageKey, useT } from "../../i18n";
import { withCategoryChanges } from "../../settings/categories/categories";
import { CategoriesForm } from "../../settings/categories/categories-form";
import { useUncategorisedSales } from "../../settings/categories/use-uncategorised-sales";
import { saveOutcomeOf } from "../../settings/forms/save-outcome";
import { withKindChanges } from "../../settings/payment-kinds/payment-kinds";
import { PaymentKindsForm } from "../../settings/payment-kinds/payment-kinds-form";
import {
	settingsQueryKey,
	useItems,
	useItemTypes,
	usePaymentMethods,
} from "../../settings/queries";
import { ReadOnlyNotice } from "../../settings/read-only-notice";
import { roleKeyOf } from "../../settings/roles/roles";
import { RolesForm, type RolesOutcome } from "../../settings/roles/roles-form";
import { useRoleUsage } from "../../settings/roles/use-role-usage";
import {
	useRetrySettingsSource,
	useSettingsSourceState,
} from "../../settings/settings-source-context";
import type {
	CategoryOverrideChange,
	ItemEntry,
	ItemTypeEntry,
	KindOverrideChange,
	PaymentMethodEntry,
	RoleChange,
	SettingsSource,
} from "../../settings/source";
import { useSettingsAccess } from "../../settings/use-settings-access";
import { useSettingsMutation } from "../../settings/use-settings-mutation";
import { useFormatters } from "../../state/formatters";
import { useReadyTenantScope } from "../../state/tenant-scope";

export const MAPPING_TABS = [
	{ slug: "vai-tro", titleKey: "settings.mapping.tab.roles" },
	{ slug: "nhom-mon", titleKey: "settings.mapping.tab.categories" },
	{ slug: "thanh-toan", titleKey: "settings.mapping.tab.paymentKinds" },
] as const satisfies readonly {
	slug: string;
	titleKey: MessageKey;
}[];

type MappingTab = (typeof MAPPING_TABS)[number];

type MappingSlug = MappingTab["slug"];

const DEFAULT_TAB = MAPPING_TABS[0];

export function mappingTabOf(slug: string | null): MappingTab {
	return MAPPING_TABS.find((tab) => tab.slug === slug) ?? DEFAULT_TAB;
}

export function withRoleChanges(
	entries: readonly ItemTypeEntry[] | undefined,
	changes: readonly RoleChange[],
): ItemTypeEntry[] | undefined {
	if (entries === undefined) return entries;
	const changed = new Map(changes.map((change) => [roleKeyOf(change), change]));
	return entries.map((entry) => {
		const change = changed.get(roleKeyOf(entry));
		return change === undefined ? entry : { ...entry, role: change.role };
	});
}

function MappingTabs({ current }: { current: MappingTab }) {
	const t = useT();
	return (
		<nav
			aria-label={t("settings.mapping.tabs.label")}
			data-testid="mapping-tabs"
		>
			<ul className="flex gap-1 overflow-x-auto rounded-xl border border-line bg-surface-raised p-1">
				{MAPPING_TABS.map((tab) => (
					<li key={tab.slug} className="shrink-0">
						<Link
							to={`?tab=${tab.slug}`}
							aria-current={tab.slug === current.slug ? "page" : undefined}
							className="flex min-h-11 items-center whitespace-nowrap rounded-lg px-3 text-sm font-medium text-ink-muted hover:bg-surface-sunken aria-[current=page]:bg-accent aria-[current=page]:text-accent-ink"
						>
							{t(tab.titleKey)}
						</Link>
					</li>
				))}
			</ul>
		</nav>
	);
}

function RolesSection() {
	const t = useT();
	const { tenant } = useReadyTenantScope();
	const formatters = useFormatters(tenant);
	const access = useSettingsAccess("roles");
	const sourceState = useSettingsSourceState();
	const retrySource = useRetrySettingsSource();
	const itemTypes = useItemTypes();
	const usage = useRoleUsage();
	const queryClient = useQueryClient();
	const writeRoles = useCallback(
		async (
			source: SettingsSource,
			tenantId: string,
			changes: readonly RoleChange[],
		) => {
			await source.saveRoles(tenantId, changes);
			queryClient.setQueryData<ItemTypeEntry[]>(
				settingsQueryKey(source.kind, tenantId, "itemTypes"),
				(previous) => withRoleChanges(previous, changes),
			);
		},
		[queryClient],
	);
	const { save, saving, saved, errorCode, reset } = useSettingsMutation(
		writeRoles,
		{ touchesMappings: true },
	);
	const loadFailed =
		sourceState.status === "failed" || itemTypes.status === "error";
	if (itemTypes.data === undefined && loadFailed) {
		return (
			<div role="alert" className="space-y-2" data-testid="roles-load-failed">
				<p>{t("app.error")}</p>
				<Button
					tone="secondary"
					size="compact"
					onClick={
						sourceState.status === "failed"
							? retrySource
							: () => void itemTypes.refetch()
					}
				>
					{t("app.retry")}
				</Button>
			</div>
		);
	}
	if (itemTypes.data === undefined) {
		return <p role="status">{t("app.loading")}</p>;
	}
	const outcome: RolesOutcome =
		errorCode !== null
			? { kind: "refused", code: errorCode }
			: saved
				? { kind: "saved" }
				: { kind: "idle" };
	return (
		<>
			<ReadOnlyNotice access={access} />
			<RolesForm
				entries={itemTypes.data}
				usage={usage}
				formatters={formatters}
				canWrite={access.canWrite}
				saving={saving}
				outcome={outcome}
				onSave={(changes) => void save(changes)}
				onEdit={() => {
					if (outcome.kind !== "idle" && !saving) reset();
				}}
			/>
		</>
	);
}

function SectionLoadState({
	failed,
	failedTestId,
	onRetry,
}: {
	readonly failed: boolean;
	readonly failedTestId: string;
	readonly onRetry: () => void;
}) {
	const t = useT();
	if (!failed) return <p role="status">{t("app.loading")}</p>;
	return (
		<div role="alert" className="space-y-2" data-testid={failedTestId}>
			<p>{t("app.error")}</p>
			<Button tone="secondary" size="compact" onClick={onRetry}>
				{t("app.retry")}
			</Button>
		</div>
	);
}

interface SectionRead {
	readonly status: "pending" | "error" | "success";
	readonly refetch: () => Promise<unknown>;
}

function useSectionReads(reads: readonly SectionRead[]) {
	const sourceState = useSettingsSourceState();
	const retrySource = useRetrySettingsSource();
	const sourceFailed = sourceState.status === "failed";
	return {
		failed: sourceFailed || reads.some((read) => read.status === "error"),
		retry: sourceFailed
			? retrySource
			: () => {
					for (const read of reads) {
						if (read.status === "error") void read.refetch();
					}
				},
	};
}

function CategoriesSection() {
	const { tenant } = useReadyTenantScope();
	const formatters = useFormatters(tenant);
	const access = useSettingsAccess("roles");
	const items = useItems();
	const itemTypes = useItemTypes();
	const sales = useUncategorisedSales();
	const load = useSectionReads([items, itemTypes]);
	const queryClient = useQueryClient();
	const writeOverrides = useCallback(
		async (
			source: SettingsSource,
			tenantId: string,
			changes: readonly CategoryOverrideChange[],
		) => {
			await source.saveCategoryOverrides(tenantId, changes);
			queryClient.setQueryData<ItemEntry[]>(
				settingsQueryKey(source.kind, tenantId, "items"),
				(previous) => withCategoryChanges(previous, changes),
			);
		},
		[queryClient],
	);
	const mutation = useSettingsMutation(writeOverrides, {
		touchesMappings: true,
	});
	if (items.data === undefined || itemTypes.data === undefined) {
		return (
			<SectionLoadState
				failed={load.failed}
				failedTestId="categories-load-failed"
				onRetry={load.retry}
			/>
		);
	}
	const outcome = saveOutcomeOf(mutation);
	return (
		<>
			<ReadOnlyNotice access={access} />
			<CategoriesForm
				entries={items.data}
				itemTypes={itemTypes.data}
				sales={sales}
				formatters={formatters}
				timeZone={tenant.timeZone}
				canWrite={access.canWrite}
				saving={mutation.saving}
				outcome={outcome}
				onSave={(changes) => void mutation.save(changes)}
				onRetry={() => void mutation.retry()}
				onEdit={() => {
					if (outcome.kind !== "idle" && !mutation.saving) mutation.reset();
				}}
			/>
		</>
	);
}

function PaymentKindsSection() {
	const { tenant } = useReadyTenantScope();
	const formatters = useFormatters(tenant);
	const access = useSettingsAccess("roles");
	const methods = usePaymentMethods();
	const load = useSectionReads([methods]);
	const queryClient = useQueryClient();
	const writeKinds = useCallback(
		async (
			source: SettingsSource,
			tenantId: string,
			changes: readonly KindOverrideChange[],
		) => {
			await source.saveKindOverrides(tenantId, changes);
			queryClient.setQueryData<PaymentMethodEntry[]>(
				settingsQueryKey(source.kind, tenantId, "paymentMethods"),
				(previous) => withKindChanges(previous, changes),
			);
		},
		[queryClient],
	);
	const mutation = useSettingsMutation(writeKinds, { touchesMappings: true });
	if (methods.data === undefined) {
		return (
			<SectionLoadState
				failed={load.failed}
				failedTestId="payment-kinds-load-failed"
				onRetry={load.retry}
			/>
		);
	}
	const outcome = saveOutcomeOf(mutation);
	return (
		<>
			<ReadOnlyNotice access={access} />
			<PaymentKindsForm
				entries={methods.data}
				formatters={formatters}
				timeZone={tenant.timeZone}
				canWrite={access.canWrite}
				saving={mutation.saving}
				outcome={outcome}
				onSave={(changes) => void mutation.save(changes)}
				onRetry={() => void mutation.retry()}
				onEdit={() => {
					if (outcome.kind !== "idle" && !mutation.saving) mutation.reset();
				}}
			/>
		</>
	);
}

const TAB_SECTIONS: Readonly<Record<MappingSlug, ComponentType>> = {
	"vai-tro": RolesSection,
	"nhom-mon": CategoriesSection,
	"thanh-toan": PaymentKindsSection,
};

export default function PhanLoaiPage() {
	const { tenant } = useReadyTenantScope();
	const [search] = useSearchParams();
	const tab = mappingTabOf(search.get("tab"));
	const Section = TAB_SECTIONS[tab.slug];
	return (
		<div className="space-y-4" data-testid="mapping-page">
			<MappingTabs current={tab} />
			<Section key={`${tenant.id}-${tab.slug}`} />
		</div>
	);
}
