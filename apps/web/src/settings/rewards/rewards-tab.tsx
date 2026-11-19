import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";
import { Button } from "../../components/ui/button";
import { cn } from "../../components/ui/cn";
import { type MessageKey, type Translate, useT } from "../../i18n";
import { todayIn } from "../../lib/business-dates";
import type { Formatters } from "../../lib/format";
import { useFormatters } from "../../state/formatters";
import { useReadyTenantScope } from "../../state/tenant-scope";
import { settingsQueryKey, useItems, useLoyaltyProgrammes } from "../queries";
import { ReadOnlyNotice } from "../read-only-notice";
import { SectionLoadState, useSectionLoad } from "../section-load";
import type { SettingsSource } from "../source";
import { useSettingsAccess } from "../use-settings-access";
import { useSettingsMutation } from "../use-settings-mutation";
import {
	useRewardDiscountDays,
	useRewardRails,
	useRewards,
	useRewardsSource,
} from "./queries";
import {
	ACTION_TARGETS,
	type ApprovalState,
	actionsOf,
	approvalStateOf,
	REWARD_KIND_KEYS,
	REWARD_STATUS_KEYS,
	type RewardAction,
	type RewardFormat,
	type RewardRole,
} from "./reward-fields";
import {
	RewardForm,
	type RewardItemOption,
	type RewardOutcome,
	type RewardProgrammeOption,
	refusalKeyOf,
} from "./reward-form";
import { notReady, type RewardStore, readinessOf } from "./reward-rails";
import {
	type RewardChange,
	type RewardField,
	type RewardRecord,
	type RewardRefusal,
	type RewardStatus,
	type RewardStatusChange,
	refusalOf,
} from "./source";

const PROGRAMME_ORDER = ["active", "paused", "draft", "ended"] as const;

const STATUS_TONES: Readonly<Record<RewardStatus, string>> = {
	draft: "border-line bg-surface-sunken",
	approved: "border-accent bg-surface-raised",
	active: "border-positive bg-positive-soft",
	retired: "border-line bg-surface-sunken text-ink-muted",
};

const APPROVAL_KEYS: Readonly<Record<ApprovalState, MessageKey>> = {
	awaitingOwner: "settings.rewards.approval.awaitingOwner",
	approvedByYou: "settings.rewards.approval.byYou",
	approvedByOwner: "settings.rewards.approval.byOwner",
	approvedBySystem: "settings.rewards.approval.bySystem",
	approvedUnknown: "settings.rewards.approval.byOwner",
	retired: "settings.rewards.approval.retired",
};

const ACTION_KEYS: Readonly<Record<RewardAction, MessageKey>> = {
	approve: "settings.rewards.action.approve",
	activate: "settings.rewards.action.activate",
	deactivate: "settings.rewards.action.deactivate",
	retire: "settings.rewards.action.retire",
};

export function withSavedReward(
	rows: readonly RewardRecord[] | undefined,
	saved: RewardRecord,
): RewardRecord[] | undefined {
	if (rows === undefined) return rows;
	return rows.some((row) => row.id === saved.id)
		? rows.map((row) => (row.id === saved.id ? saved : row))
		: [...rows, saved];
}

export function costText(
	t: Translate,
	formatters: Formatters,
	record: Pick<RewardRecord, "costStamps" | "costPoints">,
): string {
	const parts: string[] = [];
	if (record.costStamps > 0) {
		parts.push(
			t("settings.rewards.list.stamps", {
				count: formatters.count(record.costStamps),
			}),
		);
	}
	if (record.costPoints > 0) {
		parts.push(
			t("settings.rewards.list.points", {
				count: formatters.count(record.costPoints),
			}),
		);
	}
	return parts.join(" + ");
}

function StatusBadge({ status }: { readonly status: RewardStatus }) {
	const t = useT();
	return (
		<span
			className={cn(
				"inline-flex min-h-6 items-center rounded-full border px-2 text-xs font-medium",
				STATUS_TONES[status],
			)}
			data-testid="reward-status"
			data-status={status}
		>
			{t(REWARD_STATUS_KEYS[status])}
		</span>
	);
}

function RewardList({
	rows,
	chosenId,
	onChoose,
	formatters,
}: {
	readonly rows: readonly RewardRecord[];
	readonly chosenId: string | null;
	readonly onChoose: (id: string) => void;
	readonly formatters: Formatters;
}) {
	const t = useT();
	return (
		<ul className="space-y-2" data-testid="reward-list">
			{rows.map((row) => (
				<li key={row.id}>
					<button
						type="button"
						className="flex min-h-11 w-full min-w-0 flex-col gap-1 rounded-lg border border-line bg-surface-raised px-3 py-2 text-left hover:bg-surface-sunken aria-[current=true]:border-accent sm:flex-row sm:items-center sm:justify-between"
						aria-current={row.id === chosenId ? "true" : undefined}
						onClick={() => onChoose(row.id)}
						data-testid="reward-row"
						data-reward={row.rewardKey}
					>
						<span className="min-w-0">
							<span className="block font-medium">{row.name}</span>
							<span className="block text-sm text-ink-muted">
								{t(REWARD_KIND_KEYS[row.rewardKind].label)}
								{" · "}
								{costText(t, formatters, row)}
							</span>
						</span>
						<StatusBadge status={row.status} />
					</button>
				</li>
			))}
		</ul>
	);
}

function ApprovalLine({
	record,
	formatters,
	timeZone,
}: {
	readonly record: RewardRecord;
	readonly formatters: Formatters;
	readonly timeZone: string;
}) {
	const t = useT();
	const state = approvalStateOf(record);
	const at = record.approval === null ? null : new Date(record.approval.at);
	return (
		<p className="text-sm" data-testid="reward-approval" data-state={state}>
			{t(APPROVAL_KEYS[state], {
				date: at === null ? "" : formatters.date(todayIn(timeZone, at)),
				time: at === null ? "" : formatters.time(at),
			})}
		</p>
	);
}

function StatusPanel({
	record,
	role,
	readiness,
	busy,
	refusal,
	onAction,
}: {
	readonly record: RewardRecord;
	readonly role: RewardRole;
	readonly readiness: ReturnType<typeof readinessOf> | null;
	readonly busy: boolean;
	readonly refusal: string | null;
	readonly onAction: (action: RewardAction) => void;
}) {
	const t = useT();
	const { tenant } = useReadyTenantScope();
	const formatters = useFormatters(tenant);
	const [confirming, setConfirming] = useState(false);
	const actions = actionsOf(record.status, role);
	const missing = readiness === null ? [] : notReady(readiness);
	return (
		<section
			aria-labelledby="reward-status-heading"
			className="min-w-0 space-y-3 rounded-xl border border-line bg-surface-raised p-4"
			data-testid="reward-status-panel"
			data-status={record.status}
		>
			<div className="flex flex-wrap items-center gap-2">
				<h4 id="reward-status-heading" className="text-base font-semibold">
					{t("settings.rewards.statusTitle")}
				</h4>
				<StatusBadge status={record.status} />
			</div>
			<ApprovalLine
				record={record}
				formatters={formatters}
				timeZone={tenant.timeZone}
			/>
			<p
				role="note"
				className="text-sm text-ink-muted"
				data-testid="reward-owner-approves"
			>
				{t(
					role.canApprove
						? "settings.rewards.ownerApproves.owner"
						: "settings.rewards.ownerApproves.other",
				)}
			</p>
			{record.status === "approved" && missing.length > 0 ? (
				<p
					role="note"
					className="rounded-lg border border-warning bg-warning-soft px-3 py-2 text-sm"
					data-testid="reward-activation-blocked"
				>
					{t("settings.rewards.activation.blocked", {
						stores: missing.map((row) => row.name).join(", "),
					})}
				</p>
			) : null}
			{record.status === "retired" ? (
				<p className="text-sm" data-testid="reward-retired-note">
					{t("settings.rewards.retiredNote")}
				</p>
			) : null}
			{actions.length === 0 ? null : confirming ? (
				<div
					className="space-y-2 rounded-lg border border-warning bg-warning-soft p-3"
					data-testid="reward-retire-confirm"
				>
					<p className="text-sm">{t("settings.rewards.retireConfirm")}</p>
					<div className="flex flex-wrap gap-2">
						<Button
							tone="warning"
							size="compact"
							disabled={busy}
							onClick={() => {
								setConfirming(false);
								onAction("retire");
							}}
						>
							{t("settings.rewards.action.retireConfirm")}
						</Button>
						<Button
							tone="secondary"
							size="compact"
							onClick={() => setConfirming(false)}
						>
							{t("settings.rewards.action.keep")}
						</Button>
					</div>
				</div>
			) : (
				<div className="flex flex-wrap gap-2" data-testid="reward-actions">
					{actions.map((action) => (
						<Button
							key={action}
							tone={
								action === "retire" || action === "deactivate"
									? "secondary"
									: "primary"
							}
							size="compact"
							disabled={busy}
							data-action={action}
							onClick={() =>
								action === "retire" ? setConfirming(true) : onAction(action)
							}
						>
							{t(ACTION_KEYS[action])}
						</Button>
					))}
				</div>
			)}
			{refusal === null ? null : (
				<p
					role="alert"
					className="text-sm text-negative"
					data-testid="reward-status-refusal"
				>
					{refusal}
				</p>
			)}
		</section>
	);
}

function DiscountDaysPanel({
	record,
	year,
	demo,
}: {
	readonly record: RewardRecord;
	readonly year: number;
	readonly demo: boolean;
}) {
	const t = useT();
	const { tenant } = useReadyTenantScope();
	const formatters = useFormatters(tenant);
	const days = useRewardDiscountDays(record.id, year, !demo);
	const rows = days.data ?? [];
	const limit = rows.find((row) => row.limitDays !== null)?.limitDays ?? null;
	const shown = rows.slice(0, 10);
	return (
		<section
			aria-labelledby="reward-days-heading"
			className="min-w-0 space-y-2 rounded-xl border border-line bg-surface-raised p-4"
			data-testid="reward-discount-days"
		>
			<h4 id="reward-days-heading" className="text-base font-semibold">
				{t("settings.rewards.days.title", { year })}
			</h4>
			<p className="text-sm text-ink-muted">
				{t(
					limit === null
						? "settings.rewards.days.infoNoLimit"
						: "settings.rewards.days.info",
					{ limit: limit === null ? "" : formatters.count(limit) },
				)}
			</p>
			{demo ? (
				<p role="note" className="text-sm" data-testid="reward-days-demo">
					{t("settings.rewards.days.demo")}
				</p>
			) : days.status === "error" ? (
				<div role="alert" className="space-y-2">
					<p className="text-sm">{t("app.error")}</p>
					<Button
						tone="secondary"
						size="compact"
						onClick={() => void days.refetch()}
					>
						{t("app.retry")}
					</Button>
				</div>
			) : days.data === undefined ? (
				<p role="status" className="text-sm text-ink-muted">
					{t("app.loading")}
				</p>
			) : rows.length === 0 ? (
				<p className="text-sm" data-testid="reward-days-none">
					{t("settings.rewards.days.none")}
				</p>
			) : (
				<div className="overflow-x-auto">
					<table
						className="w-full min-w-0 text-sm"
						data-testid="reward-days-table"
					>
						<caption className="sr-only">
							{t("settings.rewards.days.title", { year })}
						</caption>
						<thead>
							<tr className="text-left text-ink-muted">
								<th scope="col" className="py-1 pr-3 font-medium">
									{t("settings.rewards.days.item")}
								</th>
								<th scope="col" className="py-1 pr-3 text-right font-medium">
									{t("settings.rewards.days.priceDays")}
								</th>
								<th scope="col" className="py-1 text-right font-medium">
									{t("settings.rewards.days.limit")}
								</th>
							</tr>
						</thead>
						<tbody>
							{shown.map((row) => (
								<tr
									key={row.itemExternalId}
									className="border-t border-line"
									data-over={row.overLimit ? "true" : "false"}
								>
									<th scope="row" className="py-1 pr-3 text-left font-normal">
										{row.itemName ?? row.itemExternalId}
									</th>
									<td className="py-1 pr-3 text-right tabular-nums">
										{formatters.count(row.priceDiscountDays)}
									</td>
									<td className="py-1 text-right">
										{row.limitDays === null
											? t("settings.rewards.days.noLimit")
											: row.overLimit
												? t("settings.rewards.days.over", {
														limit: formatters.count(row.limitDays),
													})
												: formatters.count(row.limitDays)}
									</td>
								</tr>
							))}
						</tbody>
					</table>
					{rows.length > shown.length ? (
						<p className="pt-1 text-xs text-ink-muted">
							{t("settings.rewards.days.more", {
								count: formatters.count(rows.length - shown.length),
							})}
						</p>
					) : null}
				</div>
			)}
		</section>
	);
}

function preferredProgrammeId(
	rows: readonly { id: string; status: string }[],
): string {
	for (const status of PROGRAMME_ORDER) {
		const found = rows.find((row) => row.status === status);
		if (found !== undefined) return found.id;
	}
	return "";
}

export function RewardsTab() {
	const t = useT();
	const { tenant, stores: scopeStores } = useReadyTenantScope();
	const formatters = useFormatters(tenant);
	const rewardsSource = useRewardsSource();
	const access = useSettingsAccess("rewards");
	const approval = useSettingsAccess("rewardApproval");
	const rewards = useRewards();
	const rails = useRewardRails();
	const programmes = useLoyaltyProgrammes();
	const items = useItems();
	const load = useSectionLoad([rewards, rails]);
	const queryClient = useQueryClient();
	const [chosenId, setChosenId] = useState<string | null>(null);
	const [creating, setCreating] = useState(false);
	const [saveRefusal, setSaveRefusal] = useState<RewardRefusal | null>(null);
	const [statusRefusal, setStatusRefusal] = useState<RewardRefusal | null>(
		null,
	);
	const demo = rewardsSource?.kind === "demo";
	const canWrite = access.canWrite && !demo;
	const role: RewardRole = {
		canWrite,
		canApprove: canWrite && approval.canWrite,
	};
	const remember = useCallback(
		(source: SettingsSource, saved: RewardRecord) => {
			queryClient.setQueryData<RewardRecord[]>(
				settingsQueryKey(source.kind, tenant.id, "rewards"),
				(previous) => withSavedReward(previous, saved),
			);
		},
		[queryClient, tenant.id],
	);
	const writeReward = useCallback(
		async (source: SettingsSource, tenantId: string, change: RewardChange) => {
			if (rewardsSource === null) throw new Error("no rewards source");
			setSaveRefusal(null);
			try {
				const saved = await rewardsSource.saveReward(tenantId, change);
				remember(source, saved);
				setCreating(false);
				setChosenId(saved.id);
			} catch (error) {
				setSaveRefusal(refusalOf(error));
				throw error;
			}
		},
		[rewardsSource, remember],
	);
	const writeStatus = useCallback(
		async (
			source: SettingsSource,
			tenantId: string,
			change: RewardStatusChange,
		) => {
			if (rewardsSource === null) throw new Error("no rewards source");
			setStatusRefusal(null);
			try {
				remember(source, await rewardsSource.setStatus(tenantId, change));
			} catch (error) {
				setStatusRefusal(refusalOf(error));
				throw error;
			}
		},
		[rewardsSource, remember],
	);
	const save = useSettingsMutation(writeReward);
	const status = useSettingsMutation(writeStatus);
	const rows = rewards.data;
	const railRows = rails.data ?? null;
	if (rows === undefined) {
		return <SectionLoadState load={load} failedTestId="rewards-load-failed" />;
	}
	const programmeRows = programmes.data ?? [];
	const defaultProgrammeId = preferredProgrammeId(programmeRows);
	const programmeOptions: RewardProgrammeOption[] = programmeRows.map(
		(programme) => ({ id: programme.id, label: programme.name }),
	);
	const stores: RewardStore[] = scopeStores.map((store) => ({
		id: store.id,
		name: store.name,
	}));
	const itemOptions: RewardItemOption[] = (items.data ?? [])
		.filter((item) => !item.isModifier)
		.map((item) => ({
			externalId: item.itemExternalId,
			name: item.name,
			sizeLabel: item.sizeLabel,
		}));
	const chosen = creating
		? null
		: (rows.find((row) => row.id === chosenId) ?? rows[0] ?? null);
	const saveOutcome: RewardOutcome =
		save.errorCode !== null
			? {
					kind: "refused",
					code: save.errorCode,
					field: save.errorConstraint as RewardField | null,
					refusal: saveRefusal,
				}
			: save.saved
				? { kind: "saved" }
				: { kind: "idle" };
	const statusOutcome: RewardOutcome =
		status.errorCode !== null
			? {
					kind: "refused",
					code: status.errorCode,
					field: "status",
					refusal: statusRefusal,
				}
			: { kind: "idle" };
	const statusRefusalText = (() => {
		const key = refusalKeyOf(statusOutcome);
		return key === null ? null : t(key);
	})();
	const readiness =
		chosen === null || railRows === null
			? null
			: readinessOf(chosen.storeIds, chosen.rewardKey, stores, railRows);
	const canCreate = canWrite && !creating && defaultProgrammeId !== "";
	const today = todayIn(tenant.timeZone, new Date());
	const format: RewardFormat = {
		formatters,
		currencyCode: tenant.currencyCode,
		countryCode: tenant.countryCode,
		today,
	};
	const formCanWrite = canWrite && chosen?.status !== "retired";
	return (
		<section
			aria-labelledby="rewards-heading"
			className="min-w-0 space-y-4"
			data-testid="rewards-tab"
		>
			<h3 id="rewards-heading" className="text-lg font-semibold">
				{t("settings.rewards.title")}
			</h3>
			<p className="text-sm text-ink-muted" data-testid="rewards-intro">
				{t("settings.rewards.intro")}
			</p>
			{demo ? (
				<p
					role="note"
					className="rounded-lg border border-line bg-surface-sunken px-3 py-2 text-sm"
					data-testid="rewards-demo"
				>
					{t("settings.rewards.demo")}
				</p>
			) : (
				<ReadOnlyNotice
					access={access}
					messages={{
						role: "settings.rewards.readOnly.role",
						scope: "settings.rewards.readOnly.scope",
					}}
				/>
			)}
			{rows.length === 0 && !creating ? (
				<p className="text-sm" data-testid="rewards-empty">
					{t(
						defaultProgrammeId === "" && canWrite
							? "settings.rewards.noProgramme"
							: canWrite
								? "settings.rewards.empty"
								: "settings.rewards.emptyReadOnly",
					)}
				</p>
			) : (
				<RewardList
					rows={rows}
					chosenId={chosen?.id ?? null}
					onChoose={(id) => {
						save.reset();
						status.reset();
						setCreating(false);
						setChosenId(id);
					}}
					formatters={formatters}
				/>
			)}
			{canCreate ? (
				<Button
					tone="secondary"
					size="compact"
					onClick={() => {
						save.reset();
						status.reset();
						setCreating(true);
					}}
					data-testid="reward-create"
				>
					{t("settings.rewards.create")}
				</Button>
			) : null}
			{chosen === null ? null : (
				<StatusPanel
					key={`status-${chosen.id}`}
					record={chosen}
					role={role}
					readiness={readiness}
					busy={status.saving || save.saving}
					refusal={statusRefusalText}
					onAction={(action) => {
						save.reset();
						void status.save({
							id: chosen.id,
							status: ACTION_TARGETS[action],
						});
					}}
				/>
			)}
			{chosen === null && !creating ? null : (
				<div className="space-y-2">
					<h4
						className="text-base font-semibold"
						data-testid="reward-form-title"
					>
						{creating
							? t("settings.rewards.newTitle")
							: t("settings.rewards.editTitle", { name: chosen?.name ?? "" })}
					</h4>
					<RewardForm
						key={chosen?.id ?? "new"}
						saved={chosen}
						defaultProgrammeId={defaultProgrammeId}
						programmes={programmeOptions}
						stores={stores}
						items={itemOptions}
						rails={railRows}
						canWrite={formCanWrite}
						role={role}
						format={format}
						timeZone={tenant.timeZone}
						saving={save.saving}
						outcome={saveOutcome}
						onSave={(change) => {
							status.reset();
							void save.save(change);
						}}
						onEdit={() => {
							if (saveOutcome.kind !== "idle" && !save.saving) save.reset();
						}}
						onCancelNew={() => setCreating(false)}
					/>
				</div>
			)}
			{chosen === null ? null : (
				<DiscountDaysPanel
					key={`days-${chosen.id}`}
					record={chosen}
					year={Number(today.slice(0, 4))}
					demo={demo}
				/>
			)}
		</section>
	);
}
