import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";
import { Button } from "../../components/ui/button";
import { TextLink } from "../../components/ui/text-link";
import { useT } from "../../i18n";
import { todayIn } from "../../lib/business-dates";
import { loyaltyReadAccess } from "../../loyalty/access";
import type {
	LoyaltyProgrammeChange,
	LoyaltyProgrammeRecord,
	LoyaltySource,
	ProgrammeField,
} from "../../loyalty/source";
import { seesLoyaltyStaffPhones } from "../../settings/access";
import { SelectField } from "../../settings/forms/select-field";
import { STATUS_KEYS } from "../../settings/loyalty/programme-fields";
import {
	ProgrammeForm,
	type ProgrammeOutcome,
} from "../../settings/loyalty/programme-form";
import { StaffPhones } from "../../settings/loyalty/staff-phones";
import {
	settingsQueryKey,
	useLoyaltyProgrammes,
	useMembership,
} from "../../settings/queries";
import { ReadOnlyNotice } from "../../settings/read-only-notice";
import { SectionLoadState, useSectionLoad } from "../../settings/section-load";
import { useSettingsSourceState } from "../../settings/settings-source-context";
import { type SettingsSource, SettingsWriteError } from "../../settings/source";
import { useSettingsAccess } from "../../settings/use-settings-access";
import { useSettingsMutation } from "../../settings/use-settings-mutation";
import { useFormatters } from "../../state/formatters";
import { useReadyTenantScope } from "../../state/tenant-scope";

const STATUS_ORDER = ["active", "paused", "draft", "ended"] as const;

export function preferredProgramme(
	rows: readonly LoyaltyProgrammeRecord[],
): LoyaltyProgrammeRecord | null {
	for (const status of STATUS_ORDER) {
		const found = rows.find((row) => row.status === status);
		if (found !== undefined) return found;
	}
	return null;
}

export function withSavedProgramme(
	rows: readonly LoyaltyProgrammeRecord[] | undefined,
	saved: LoyaltyProgrammeRecord,
): LoyaltyProgrammeRecord[] | undefined {
	if (rows === undefined) return rows;
	const known = rows.some((row) => row.id === saved.id);
	return known
		? rows.map((row) => (row.id === saved.id ? saved : row))
		: [saved, ...rows];
}

function useLoyaltySource(): LoyaltySource | null {
	const state = useSettingsSourceState();
	return state.status === "ready" ? (state.loyalty ?? null) : null;
}

function ProgrammeSection() {
	const t = useT();
	const { tenant } = useReadyTenantScope();
	const formatters = useFormatters(tenant);
	const loyalty = useLoyaltySource();
	const access = useSettingsAccess("loyalty");
	const programmes = useLoyaltyProgrammes();
	const load = useSectionLoad([programmes]);
	const queryClient = useQueryClient();
	const [chosenId, setChosenId] = useState<string | null>(null);
	const [creating, setCreating] = useState(false);
	const demo = loyalty?.kind === "demo";
	const canWrite = access.canWrite && !demo;
	const write = useCallback(
		async (
			source: SettingsSource,
			tenantId: string,
			change: LoyaltyProgrammeChange,
		) => {
			if (loyalty === null) throw new SettingsWriteError("network");
			const saved = await loyalty.saveProgramme(tenantId, change);
			queryClient.setQueryData<LoyaltyProgrammeRecord[]>(
				settingsQueryKey(source.kind, tenantId, "loyaltyProgrammes"),
				(previous) => withSavedProgramme(previous, saved),
			);
			setCreating(false);
			setChosenId(saved.id);
		},
		[loyalty, queryClient],
	);
	const mutation = useSettingsMutation(write);
	const rows = programmes.data;
	if (rows === undefined) {
		return <SectionLoadState load={load} failedTestId="loyalty-load-failed" />;
	}
	const current =
		rows.find((row) => row.id === chosenId) ?? preferredProgramme(rows);
	const outcome: ProgrammeOutcome =
		mutation.errorCode !== null
			? {
					kind: "refused",
					code: mutation.errorCode,
					field: mutation.errorConstraint as ProgrammeField | null,
				}
			: mutation.saved
				? { kind: "saved" }
				: { kind: "idle" };
	const canCreate =
		canWrite && !creating && rows.every((row) => row.status === "ended");
	const shown = creating ? null : current;
	return (
		<section
			aria-labelledby="loyalty-programme-heading"
			className="min-w-0 space-y-4"
			data-testid="loyalty-programme"
		>
			<h3 id="loyalty-programme-heading" className="text-lg font-semibold">
				{t("settings.loyalty.programme.title")}
			</h3>
			{demo ? (
				<p
					role="note"
					className="rounded-lg border border-line bg-surface-sunken px-3 py-2 text-sm"
					data-testid="loyalty-demo"
				>
					{t("settings.loyalty.demo")}
				</p>
			) : (
				<ReadOnlyNotice
					access={access}
					messages={{
						role: "settings.loyalty.readOnly.role",
						scope: "settings.loyalty.readOnly.scope",
					}}
				/>
			)}
			{rows.length > 1 && !creating ? (
				<SelectField<string>
					id="loyalty-programme-choice"
					testId="loyalty-programme-choice"
					label={t("settings.loyalty.choose")}
					value={current?.id ?? ""}
					options={rows.map((row) => ({
						value: row.id,
						label: t("settings.loyalty.choice", {
							name: row.name,
							status: t(STATUS_KEYS[row.status]),
						}),
					}))}
					onChange={(id) => {
						mutation.reset();
						setChosenId(id);
					}}
				/>
			) : null}
			{rows.length === 0 && !creating ? (
				<p className="text-sm" data-testid="loyalty-empty">
					{t(
						canWrite
							? "settings.loyalty.empty"
							: "settings.loyalty.emptyReadOnly",
					)}
				</p>
			) : null}
			{canCreate ? (
				<Button
					tone="secondary"
					size="compact"
					onClick={() => {
						mutation.reset();
						setCreating(true);
					}}
					data-testid="loyalty-create"
				>
					{t(
						rows.length === 0
							? "settings.loyalty.create"
							: "settings.loyalty.createAnother",
					)}
				</Button>
			) : null}
			{shown === null && !creating ? null : (
				<ProgrammeForm
					key={shown?.id ?? "new"}
					saved={shown}
					canWrite={canWrite}
					formatters={formatters}
					currencyCode={tenant.currencyCode}
					timeZone={tenant.timeZone}
					today={todayIn(tenant.timeZone, new Date())}
					saving={mutation.saving}
					outcome={outcome}
					onSave={(change) => void mutation.save(change)}
					onEdit={() => {
						if (outcome.kind !== "idle" && !mutation.saving) mutation.reset();
					}}
					onCancelNew={() => setCreating(false)}
				/>
			)}
		</section>
	);
}

function StaffPhonesSection() {
	const { tenant } = useReadyTenantScope();
	const formatters = useFormatters(tenant);
	const loyalty = useLoyaltySource();
	const membership = useMembership();
	const access = useSettingsAccess("loyalty");
	const member = membership.status === "success" ? membership.data : undefined;
	if (!seesLoyaltyStaffPhones(member)) return null;
	return (
		<StaffPhones
			loyalty={loyalty}
			canWrite={access.canWrite && loyalty?.kind !== "demo"}
			formatters={formatters}
			timeZone={tenant.timeZone}
		/>
	);
}

function MembersLink() {
	const t = useT();
	const membership = useMembership();
	const member = membership.status === "success" ? membership.data : undefined;
	if (!loyaltyReadAccess(member).canRead) return null;
	return (
		<p className="text-sm" data-testid="loyalty-members-link">
			<TextLink to="/khach-hang/thanh-vien">
				{t("settings.loyalty.membersLink")}
			</TextLink>
		</p>
	);
}

export default function KhachHangThanThietPage() {
	const t = useT();
	const { tenant } = useReadyTenantScope();
	return (
		<div className="space-y-6" data-testid="loyalty-settings-page">
			<p className="text-sm text-ink-muted" data-testid="loyalty-intro">
				{t("settings.loyalty.intro")}
			</p>
			<ProgrammeSection key={`programme-${tenant.id}`} />
			<StaffPhonesSection key={`phones-${tenant.id}`} />
			<MembersLink />
		</div>
	);
}
