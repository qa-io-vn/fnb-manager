import { useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Button } from "../../components/ui/button";
import { type MessageKey, useT } from "../../i18n";
import { settingsQueryKey, useItemTypes } from "../../settings/queries";
import { ReadOnlyNotice } from "../../settings/read-only-notice";
import { roleKeyOf } from "../../settings/roles/roles";
import { RolesForm, type RolesOutcome } from "../../settings/roles/roles-form";
import { useRoleUsage } from "../../settings/roles/use-role-usage";
import {
	useRetrySettingsSource,
	useSettingsSourceState,
} from "../../settings/settings-source-context";
import type {
	ItemTypeEntry,
	RoleChange,
	SettingsSource,
} from "../../settings/source";
import { useSettingsAccess } from "../../settings/use-settings-access";
import { useSettingsMutation } from "../../settings/use-settings-mutation";
import { useFormatters } from "../../state/formatters";
import { useReadyTenantScope } from "../../state/tenant-scope";

export const MAPPING_TABS = [
	{ slug: "vai-tro", titleKey: "settings.mapping.tab.roles", phase: null },
	{
		slug: "nhom-mon",
		titleKey: "settings.mapping.tab.categories",
		phase: "10b",
	},
	{
		slug: "thanh-toan",
		titleKey: "settings.mapping.tab.paymentKinds",
		phase: "10b",
	},
] as const satisfies readonly {
	slug: string;
	titleKey: MessageKey;
	phase: string | null;
}[];

type MappingTab = (typeof MAPPING_TABS)[number];

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

export default function PhanLoaiPage() {
	const t = useT();
	const { tenant } = useReadyTenantScope();
	const [search] = useSearchParams();
	const tab = mappingTabOf(search.get("tab"));
	return (
		<div className="space-y-4" data-testid="mapping-page">
			<MappingTabs current={tab} />
			{tab.phase === null ? (
				<RolesSection key={tenant.id} />
			) : (
				<p
					className="rounded-xl border border-dashed border-line bg-surface-raised p-5 text-ink-muted"
					data-testid="mapping-tab-later"
				>
					{t("settings.mapping.tab.later", { phase: tab.phase })}
				</p>
			)}
		</div>
	);
}
