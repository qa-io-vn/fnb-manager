import { firstOfMonth, storeBusinessDate } from "@fnb/reports";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useId, useState } from "react";
import { Button } from "../../components/ui/button";
import { cn } from "../../components/ui/cn";
import { TextLink } from "../../components/ui/text-link";
import { useT } from "../../i18n";
import { type IsoDate, todayIn } from "../../lib/business-dates";
import type { Formatters } from "../../lib/format";
import { monthLabel } from "../../reports/typed-values";
import { useFormatters } from "../../state/formatters";
import { useReadyTenantScope } from "../../state/tenant-scope";
import type { SettingsAccess } from "../access";
import { AuditLine } from "../forms/audit-line";
import { controlClass, Field } from "../forms/field";
import { issueText, numericBound } from "../forms/issue-text";
import { formatMoneyText, MoneyField } from "../forms/money-field";
import { readMoneyText } from "../forms/money-text";
import { SaveBar, type SaveBarStatus } from "../forms/save-bar";
import {
	RetrySave,
	type SaveOutcome,
	saveOutcomeOf,
	saveStatusOf,
} from "../forms/save-outcome";
import { settingsQueryKey, useMembership, useTargets } from "../queries";
import { ReadOnlyNotice } from "../read-only-notice";
import { SectionLoadState, useSectionLoad } from "../section-load";
import type { SettingsSource } from "../source";
import { useSettingsAccess } from "../use-settings-access";
import { useSettingsMutation } from "../use-settings-mutation";
import { targetAmount, type ValidationIssue } from "../validation";
import type { ManualSettingsSource, TargetChange, TargetRow } from "./source";
import {
	defaultTargetStore,
	monthReportPath,
	monthTargetOf,
	readTargetEdits,
	shareOfTarget,
	type TargetDraft,
	targetMonthsOf,
	withoutSavedTargets,
	withSavedTargets,
} from "./targets";
import { type MonthPace, useMonthPace } from "./use-month-pace";

interface TargetStoreOption {
	readonly id: string;
	readonly name: string;
}

function StoreSelect({
	storeId,
	stores,
	locked,
	onChange,
}: {
	readonly storeId: string;
	readonly stores: readonly TargetStoreOption[];
	readonly locked: boolean;
	readonly onChange: (storeId: string) => void;
}) {
	const t = useT();
	const id = useId();
	return (
		<Field
			id={`${id}-store`}
			label={t("settings.targets.store.label")}
			hint={t(
				locked
					? "settings.targets.store.locked"
					: "settings.targets.store.hint",
			)}
		>
			{(control) => (
				<select
					id={control.id}
					aria-describedby={control["aria-describedby"]}
					value={storeId}
					disabled={locked}
					onChange={(event) => onChange(event.target.value)}
					className={cn(controlClass, "sm:max-w-80")}
					data-testid="target-store"
				>
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

function PaceValue({
	amount,
	target,
	formatters,
	emptyText,
}: {
	readonly amount: number | null;
	readonly target: number | null;
	readonly formatters: Formatters;
	readonly emptyText: string;
}) {
	const t = useT();
	if (amount === null) return <>{emptyText}</>;
	const value = formatters.moneyExact(amount);
	const share = shareOfTarget(amount, target);
	return (
		<>
			{share === null
				? value
				: t("settings.targets.pace.ofTarget", {
						value,
						share: formatters.percent(share),
					})}
		</>
	);
}

function MonthPaceBlock({
	pace,
	target,
	storeId,
	monthStart,
	formatters,
}: {
	readonly pace: MonthPace;
	readonly target: number | null;
	readonly storeId: string;
	readonly monthStart: IsoDate;
	readonly formatters: Formatters;
}) {
	const t = useT();
	const headingId = useId();
	const { row } = pace;
	return (
		<section
			aria-labelledby={headingId}
			className="space-y-2 rounded-lg border border-line bg-surface-sunken p-3"
			data-testid="target-pace"
			data-status={pace.status}
		>
			<h5 id={headingId} className="text-sm font-semibold">
				{t("settings.targets.pace.label")}
			</h5>
			{pace.status === "loading" ? (
				<p role="status" className="text-sm text-ink-muted">
					{t("settings.targets.pace.loading")}
				</p>
			) : null}
			{pace.status === "failed" ? (
				<div role="alert" className="space-y-2 text-sm">
					<p>{t("settings.targets.pace.failed")}</p>
					{pace.canRetry ? (
						<Button tone="secondary" size="compact" onClick={pace.retry}>
							{t("app.retry")}
						</Button>
					) : null}
				</div>
			) : null}
			{pace.status === "ready" && row !== null ? (
				<dl className="grid gap-x-4 gap-y-1 text-sm sm:grid-cols-[minmax(0,1fr)_auto]">
					<dt className="text-ink-muted">
						{row.elapsed_days > 0
							? t("settings.targets.pace.monthToDate", {
									date: formatters.date(row.as_of_date),
								})
							: t("settings.targets.pace.noDays")}
					</dt>
					<dd className="tabular-nums" data-testid="target-pace-net">
						<PaceValue
							amount={
								row.elapsed_days > 0 ? row.month_to_date_net_amount : null
							}
							target={target}
							formatters={formatters}
							emptyText={t("settings.targets.pace.noDaysValue")}
						/>
					</dd>
					<dt className="text-ink-muted">
						{t("settings.targets.pace.forecastWeekdayProfile")}
					</dt>
					<dd className="tabular-nums" data-testid="target-pace-profile">
						<PaceValue
							amount={row.forecast_weekday_profile_net_amount}
							target={target}
							formatters={formatters}
							emptyText={t("settings.targets.pace.noForecast")}
						/>
					</dd>
					<dt className="text-ink-muted">
						{t("settings.targets.pace.forecastSeasonalNaive")}
					</dt>
					<dd className="tabular-nums" data-testid="target-pace-naive">
						<PaceValue
							amount={row.forecast_seasonal_naive_net_amount}
							target={target}
							formatters={formatters}
							emptyText={t("settings.targets.pace.noForecast")}
						/>
					</dd>
				</dl>
			) : null}
			<TextLink
				to={monthReportPath(monthStart, storeId)}
				className="text-sm font-medium"
				data-testid="target-report-link"
			>
				{t("settings.targets.pace.link")}
			</TextLink>
		</section>
	);
}

interface TargetMonthProps {
	readonly monthStart: IsoDate;
	readonly current: boolean;
	readonly saved: TargetRow | null;
	readonly text: string;
	readonly issue: ValidationIssue | null;
	readonly canWrite: boolean;
	readonly formatters: Formatters;
	readonly currencyCode: string;
	readonly timeZone: string;
	readonly onChange: (text: string) => void;
	readonly pace: MonthPace | null;
	readonly storeId: string;
}

function TargetMonth({
	monthStart,
	current,
	saved,
	text,
	issue,
	canWrite,
	formatters,
	currencyCode,
	timeZone,
	onChange,
	pace,
	storeId,
}: TargetMonthProps) {
	const t = useT();
	const id = useId();
	const headingId = `${id}-month`;
	const label = t("report.period.month", { month: monthLabel(monthStart) });
	return (
		<li
			className="space-y-2 border-b border-line py-3 last:border-b-0"
			data-testid="target-month"
			data-month={monthStart}
			data-current={current ? "true" : undefined}
		>
			<h4
				id={headingId}
				className="font-medium"
				data-testid="target-month-label"
			>
				{current ? `${label} · ${t("settings.targets.current")}` : label}
			</h4>
			<p className="text-sm" data-testid="target-saved">
				{saved === null
					? t("settings.targets.notSet")
					: t("settings.targets.saved", {
							amount: formatters.moneyExact(saved.netTargetAmount),
						})}
			</p>
			{saved?.audit ? (
				<AuditLine
					entry={saved.audit}
					formatters={formatters}
					timeZone={timeZone}
				/>
			) : null}
			{canWrite ? (
				<fieldset aria-labelledby={headingId} className="sm:max-w-96">
					<MoneyField
						id={`${id}-amount`}
						testId="target-amount"
						label={
							<>
								{t("settings.targets.amount.label")}{" "}
								<span className="sr-only">
									{t("settings.targets.amount.forMonth", {
										month: monthLabel(monthStart),
									})}
								</span>
							</>
						}
						hint={t(
							saved === null
								? "settings.targets.amount.hint"
								: "settings.targets.amount.keep",
						)}
						error={issueText(t, issue, numericBound(formatters.moneyExact))}
						value={text}
						onChange={onChange}
						formatters={formatters}
						currencyCode={currencyCode}
					/>
				</fieldset>
			) : null}
			{pace === null ? null : (
				<MonthPaceBlock
					pace={pace}
					target={saved?.netTargetAmount ?? null}
					storeId={storeId}
					monthStart={monthStart}
					formatters={formatters}
				/>
			)}
		</li>
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

interface TargetsFormProps {
	readonly storeId: string;
	readonly stores: readonly TargetStoreOption[];
	readonly onStoreChange: (storeId: string) => void;
	readonly rows: readonly TargetRow[];
	readonly today: IsoDate;
	readonly timeZone: string;
	readonly access: SettingsAccess;
	readonly formatters: Formatters;
	readonly currencyCode: string;
	readonly pace: MonthPace;
	readonly saving: boolean;
	readonly outcome: SaveOutcome;
	readonly onSave: (changes: readonly TargetChange[]) => Promise<boolean>;
	readonly onRetry: () => Promise<boolean>;
	readonly onEdit: () => void;
}

function TargetsForm({
	storeId,
	stores,
	onStoreChange,
	rows,
	today,
	timeZone,
	access,
	formatters,
	currencyCode,
	pace,
	saving,
	outcome,
	onSave,
	onRetry,
	onEdit,
}: TargetsFormProps) {
	const t = useT();
	const listId = useId();
	const [draft, setDraft] = useState<TargetDraft>({});
	const reading = readTargetEdits(draft, {
		storeId,
		rows,
		readAmount: (text) =>
			readMoneyText(
				text,
				formatters,
				currencyCode,
				targetAmount(formatters.moneyFractionDigits),
			),
	});
	const currentMonth = firstOfMonth(today);
	const forget = (changes: readonly TargetChange[]) => (saved: boolean) => {
		if (saved) setDraft((previous) => withoutSavedTargets(previous, changes));
	};
	return (
		<div className="space-y-4" data-testid="targets-form">
			<p className="text-sm text-ink-muted">{t("settings.targets.intro")}</p>
			<StoreSelect
				storeId={storeId}
				stores={stores}
				locked={reading.pendingCount > 0}
				onChange={onStoreChange}
			/>
			<ReadOnlyNotice
				access={access}
				messages={{ role: "settings.targets.readOnly.role" }}
			/>
			<section
				aria-labelledby={`${listId}-title`}
				className="space-y-2 rounded-xl border border-line bg-surface-raised px-4 py-3"
				data-testid="target-months"
			>
				<h3 id={`${listId}-title`} className="text-base font-semibold">
					{t("settings.targets.list.label")}
				</h3>
				<ul>
					{targetMonthsOf(today).map((monthStart) => {
						const saved = monthTargetOf(rows, storeId, monthStart);
						const typed = draft[monthStart];
						return (
							<TargetMonth
								key={monthStart}
								monthStart={monthStart}
								current={monthStart === currentMonth}
								saved={saved}
								text={
									typed ??
									(saved === null
										? ""
										: formatMoneyText(saved.netTargetAmount, formatters))
								}
								issue={reading.issues.get(monthStart) ?? null}
								canWrite={access.canWrite}
								formatters={formatters}
								currencyCode={currencyCode}
								timeZone={timeZone}
								onChange={(text) => {
									if (saving) return;
									setDraft((previous) => ({ ...previous, [monthStart]: text }));
									onEdit();
								}}
								pace={monthStart === currentMonth ? pace : null}
								storeId={storeId}
							/>
						);
					})}
				</ul>
			</section>
			{access.canWrite ? (
				<>
					<SaveBar
						label={t("settings.targets.saveBar")}
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

export function TargetsTab() {
	const t = useT();
	const { tenant, stores } = useReadyTenantScope();
	const formatters = useFormatters(tenant);
	const membership = useMembership();
	const targets = useTargets();
	const load = useSectionLoad([membership, targets]);
	const [chosen, setChosen] = useState<string | null>(null);
	const membershipKnown = membership.status !== "pending";
	const storeId =
		chosen ??
		(membershipKnown ? defaultTargetStore(membership.data, stores) : null);
	const store = stores.find((candidate) => candidate.id === storeId) ?? null;
	const timeZone = store?.timeZone ?? tenant.timeZone;
	const now = new Date();
	const today =
		store === null ? todayIn(timeZone, now) : storeBusinessDate(store, now);
	const pace = useMonthPace(store?.id ?? null, firstOfMonth(today));
	const access = useSettingsAccess("manualData", storeId);
	const queryClient = useQueryClient();
	const writeTargets = useCallback(
		async (
			source: SettingsSource,
			tenantId: string,
			changes: readonly TargetChange[],
			manual: ManualSettingsSource,
		) => {
			const saved = await manual.saveTargets(tenantId, changes);
			queryClient.setQueryData<TargetRow[]>(
				settingsQueryKey(source.kind, tenantId, "targets"),
				(previous) => withSavedTargets(previous, saved),
			);
		},
		[queryClient],
	);
	const saving = useSettingsMutation(writeTargets);
	if (stores.length === 0) {
		return (
			<p className="text-ink-muted" data-testid="targets-empty">
				{t("settings.targets.empty")}
			</p>
		);
	}
	if (store === null || targets.data === undefined) {
		return <SectionLoadState load={load} failedTestId="targets-load-failed" />;
	}
	const outcome = saveOutcomeOf(saving);
	return (
		<TargetsForm
			key={store.id}
			storeId={store.id}
			stores={stores}
			onStoreChange={(next) => {
				setChosen(next);
				saving.reset();
			}}
			rows={targets.data}
			today={today}
			timeZone={timeZone}
			access={access}
			formatters={formatters}
			currencyCode={tenant.currencyCode}
			pace={pace}
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
