import { useQueryClient } from "@tanstack/react-query";
import { type ReactNode, useCallback, useId, useMemo, useState } from "react";
import { cn } from "../../components/ui/cn";
import { useT } from "../../i18n";
import { type IsoDate, todayIn } from "../../lib/business-dates";
import type { Formatters } from "../../lib/format";
import { useFormatters } from "../../state/formatters";
import { useReadyTenantScope } from "../../state/tenant-scope";
import type { SettingsAccess } from "../access";
import { controlClass, Field } from "../forms/field";
import { readMoneyText } from "../forms/money-text";
import { readPercentDraft } from "../forms/percent-field";
import { SaveBar, type SaveBarStatus } from "../forms/save-bar";
import {
	RetrySave,
	type SaveOutcome,
	saveOutcomeOf,
	saveStatusOf,
} from "../forms/save-outcome";
import { KIND_LABEL_KEYS } from "../payment-kinds/payment-kinds";
import {
	settingsQueryKey,
	useFeeRates,
	useMembership,
	usePaymentMethods,
} from "../queries";
import { ReadOnlyNotice } from "../read-only-notice";
import { SectionLoadState, useSectionLoad } from "../section-load";
import type {
	FeeRateChange,
	FeeRateRow,
	PaymentMethodEntry,
	SettingsSource,
} from "../source";
import { useSettingsAccess } from "../use-settings-access";
import { useSettingsMutation } from "../use-settings-mutation";
import { feeFixedAmount } from "../validation";
import { FeeRow, type FeeRowContext } from "./fee-row";
import {
	defaultFeeScope,
	type FeeDraft,
	type FeeKindGroup,
	type FeeScope,
	feeGroupsOf,
	feeMethodsOf,
	readFeeEdits,
	withoutSavedFees,
	withSavedFeeRates,
} from "./fees";

const ALL_STORES = "all";

interface ScopeStore {
	readonly id: string;
	readonly name: string;
	readonly timeZone: string;
	readonly posAccountId: string;
}

function ScopeSelect({
	scope,
	stores,
	locked,
	onChange,
}: {
	readonly scope: FeeScope;
	readonly stores: readonly ScopeStore[];
	readonly locked: boolean;
	readonly onChange: (scope: FeeScope) => void;
}) {
	const t = useT();
	const id = useId();
	const hint = locked
		? t("settings.fees.scope.locked")
		: t(
				scope === null
					? "settings.fees.scope.hintAll"
					: "settings.fees.scope.hintStore",
			);
	return (
		<Field
			id={`${id}-scope`}
			label={t("settings.fees.scope.label")}
			hint={hint}
		>
			{(control) => (
				<select
					id={control.id}
					aria-describedby={control["aria-describedby"]}
					value={scope ?? ALL_STORES}
					disabled={locked}
					onChange={(event) =>
						onChange(
							event.target.value === ALL_STORES ? null : event.target.value,
						)
					}
					className={cn(controlClass, "sm:max-w-80")}
					data-testid="fee-scope"
				>
					<option value={ALL_STORES}>{t("settings.fees.scope.all")}</option>
					{stores.map((store) => (
						<option key={store.id} value={store.id}>
							{store.name}
						</option>
					))}
				</select>
			)}
		</Field>
	);
}

function KindSection({
	group,
	children,
}: {
	readonly group: FeeKindGroup;
	readonly children: ReactNode;
}) {
	const t = useT();
	const headingId = useId();
	return (
		<section
			aria-labelledby={headingId}
			className="rounded-xl border border-line bg-surface-raised px-4 py-1"
			data-testid="fee-kind"
			data-kind={group.kind}
		>
			<h3 id={headingId} className="pt-3 text-base font-semibold">
				{t(KIND_LABEL_KEYS[group.kind])}
			</h3>
			<ul>{children}</ul>
		</section>
	);
}

function saveBarStatusOf(
	t: ReturnType<typeof useT>,
	outcome: SaveOutcome,
	pendingCount: number,
	invalid: boolean,
): SaveBarStatus | null {
	if (invalid && outcome.kind !== "refused") {
		return { tone: "info", text: t("settings.saveBar.invalid") };
	}
	return saveStatusOf(t, outcome, pendingCount);
}

interface FeesFormProps {
	readonly scope: FeeScope;
	readonly stores: readonly ScopeStore[];
	readonly onScopeChange: (scope: FeeScope) => void;
	readonly groups: readonly FeeKindGroup[];
	readonly rows: readonly FeeRateRow[];
	readonly today: IsoDate;
	readonly timeZone: string;
	readonly access: SettingsAccess;
	readonly formatters: Formatters;
	readonly currencyCode: string;
	readonly saving: boolean;
	readonly outcome: SaveOutcome;
	readonly onSave: (changes: readonly FeeRateChange[]) => Promise<boolean>;
	readonly onRetry: () => Promise<boolean>;
	readonly onEdit: () => void;
}

function FeesForm({
	scope,
	stores,
	onScopeChange,
	groups,
	rows,
	today,
	timeZone,
	access,
	formatters,
	currencyCode,
	saving,
	outcome,
	onSave,
	onRetry,
	onEdit,
}: FeesFormProps) {
	const t = useT();
	const [draft, setDraft] = useState<FeeDraft>({});
	const reading = readFeeEdits(draft, {
		scope,
		rows,
		today,
		readPercent: (text) =>
			readPercentDraft(text, formatters.locale, { required: false }),
		readFixed: (text) =>
			readMoneyText(
				text,
				formatters,
				currencyCode,
				feeFixedAmount(formatters.moneyFractionDigits),
			),
	});
	const context: FeeRowContext = {
		scope,
		rows,
		today,
		canWrite: access.canWrite,
		formatters,
		currencyCode,
		timeZone,
		onEdit: (methodId, edit) => {
			if (saving) return;
			setDraft((previous) => ({ ...previous, [methodId]: edit }));
			onEdit();
		},
	};
	const forget = (changes: readonly FeeRateChange[]) => (saved: boolean) => {
		if (saved) setDraft((previous) => withoutSavedFees(previous, changes));
	};
	return (
		<div className="space-y-4" data-testid="fees-form">
			<p className="text-sm text-ink-muted">{t("settings.fees.intro")}</p>
			<ScopeSelect
				scope={scope}
				stores={stores}
				locked={reading.pendingCount > 0}
				onChange={onScopeChange}
			/>
			<ReadOnlyNotice
				access={access}
				messages={{
					role: "settings.manual.readOnly.role",
					...(scope === null ? { scope: "settings.fees.readOnly.scope" } : {}),
				}}
			/>
			{groups.length === 0 ? (
				<p className="text-ink-muted" data-testid="fees-empty">
					{t("settings.fees.empty")}
				</p>
			) : (
				groups.map((group) => (
					<KindSection key={group.kind} group={group}>
						{group.methods.map((method) => (
							<FeeRow
								key={method.externalId}
								method={method}
								edit={draft[method.externalId]}
								issues={reading.issues.get(method.externalId)}
								context={context}
							/>
						))}
					</KindSection>
				))
			)}
			{access.canWrite ? (
				<>
					{outcome.kind === "saved" ? (
						<p
							role="status"
							className="rounded-lg border border-line bg-surface-sunken px-3 py-2 text-sm"
							data-testid="fees-catch-up-note"
						>
							{t("settings.fees.catchUpNote")}
						</p>
					) : null}
					<SaveBar
						label={t("settings.fees.saveBar")}
						pendingCount={reading.pendingCount}
						canSave={!reading.invalid}
						saving={saving}
						onSave={() => {
							const changes = reading.changes;
							void onSave(changes).then(forget(changes));
						}}
						onCancel={() => {
							setDraft({});
							onEdit();
						}}
						status={saveBarStatusOf(
							t,
							outcome,
							reading.pendingCount,
							reading.invalid,
						)}
					/>
					<RetrySave
						outcome={outcome}
						saving={saving}
						onRetry={() => {
							const changes = reading.changes;
							void onRetry().then(forget(changes));
						}}
					/>
				</>
			) : null}
		</div>
	);
}

function useFeeGroups(
	entries: readonly PaymentMethodEntry[] | undefined,
	rows: readonly FeeRateRow[] | undefined,
	scope: FeeScope,
	posAccountId: string | null,
): FeeKindGroup[] {
	return useMemo(
		() =>
			feeGroupsOf(
				feeMethodsOf(
					entries ?? [],
					posAccountId,
					(rows ?? [])
						.filter((row) => row.storeId === scope)
						.map((row) => row.paymentMethodExternalId),
				),
			),
		[entries, rows, scope, posAccountId],
	);
}

export function FeesTab() {
	const { tenant, stores } = useReadyTenantScope();
	const formatters = useFormatters(tenant);
	const membership = useMembership();
	const methods = usePaymentMethods();
	const rates = useFeeRates();
	const load = useSectionLoad([membership, methods, rates]);
	const [chosen, setChosen] = useState<{ scope: FeeScope } | null>(null);
	const scope =
		chosen === null ? defaultFeeScope(membership.data, stores) : chosen.scope;
	const store =
		scope === null
			? null
			: (stores.find((candidate) => candidate.id === scope) ?? null);
	const timeZone = store?.timeZone ?? tenant.timeZone;
	const today = todayIn(timeZone, new Date());
	const access = useSettingsAccess("manualData", scope);
	const groups = useFeeGroups(
		methods.data,
		rates.data,
		scope,
		store?.posAccountId ?? null,
	);
	const queryClient = useQueryClient();
	const writeRates = useCallback(
		async (
			source: SettingsSource,
			tenantId: string,
			changes: readonly FeeRateChange[],
		) => {
			const saved = await source.saveFeeRates(tenantId, changes);
			queryClient.setQueryData<FeeRateRow[]>(
				settingsQueryKey(source.kind, tenantId, "feeRates"),
				(previous) => withSavedFeeRates(previous, saved),
			);
		},
		[queryClient],
	);
	const saving = useSettingsMutation(writeRates, { touchesMappings: true });
	if (
		membership.status === "pending" ||
		methods.data === undefined ||
		rates.data === undefined
	) {
		return <SectionLoadState load={load} failedTestId="fees-load-failed" />;
	}
	const outcome = saveOutcomeOf(saving);
	return (
		<FeesForm
			key={scope ?? ALL_STORES}
			scope={scope}
			stores={stores}
			onScopeChange={(next) => {
				setChosen({ scope: next });
				saving.reset();
			}}
			groups={groups}
			rows={rates.data}
			today={today}
			timeZone={timeZone}
			access={access}
			formatters={formatters}
			currencyCode={tenant.currencyCode}
			saving={saving.saving}
			outcome={outcome}
			onSave={saving.save}
			onRetry={saving.retry}
			onEdit={() => {
				if (outcome.kind !== "idle" && !saving.saving) saving.reset();
			}}
		/>
	);
}
