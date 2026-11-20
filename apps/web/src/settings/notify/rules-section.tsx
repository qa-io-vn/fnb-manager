import { useState } from "react";
import { Button } from "../../components/ui/button";
import { TextLink } from "../../components/ui/text-link";
import type { StoreRow } from "../../data/row-source";
import { type MessageKey, useT } from "../../i18n";
import {
	ErrorLine,
	LoadState,
	Note,
	NotifySection,
	useNotifyAction,
} from "./common";
import { useEffectiveRules, useRuleCatalogue } from "./queries";
import {
	type CatalogueRule,
	type Destination,
	type EffectiveRule,
	type NotifySource,
	type RuleChange,
	SEVERITIES,
	type Severity,
} from "./source";
import {
	CATEGORY_ORDER,
	categoryKey,
	paramValid,
	parseParamValue,
	RULE_LABEL_KEYS,
	roleKeys,
	SEVERITY_KEYS,
} from "./words";

const SOURCE_KEYS: Readonly<Record<EffectiveRule["source"], MessageKey>> = {
	catalogue: "settings.notify.source.catalogue",
	tenant: "settings.notify.source.tenant",
	store: "settings.notify.source.store",
};

export function ruleLabel(t: ReturnType<typeof useT>, ruleKey: string): string {
	const key = RULE_LABEL_KEYS[ruleKey];
	return key ? t(key) : ruleKey;
}

export function groupRules(
	rules: readonly EffectiveRule[],
): [string, EffectiveRule[]][] {
	const groups = new Map<string, EffectiveRule[]>();
	for (const rule of rules) {
		const list = groups.get(rule.category) ?? [];
		list.push(rule);
		groups.set(rule.category, list);
	}
	const known = CATEGORY_ORDER as readonly string[];
	return [...groups.entries()].sort(
		([left], [right]) =>
			(known.indexOf(left) + 1 || 99) - (known.indexOf(right) + 1 || 99),
	);
}

export interface ParamProblem {
	readonly param: string;
	readonly min?: number | undefined;
	readonly max?: number | undefined;
}

export function paramProblems(
	catalogue: CatalogueRule | undefined,
	params: Readonly<Record<string, unknown>>,
): ParamProblem[] {
	if (catalogue === undefined) return [];
	return Object.entries(catalogue.paramsSchema).flatMap(([param, schema]) =>
		paramValid(schema, params[param])
			? []
			: [{ param, min: schema.min, max: schema.max }],
	);
}

function RuleEditor({
	source,
	rule,
	catalogue,
	storeId,
	onDone,
}: {
	source: NotifySource;
	rule: EffectiveRule;
	catalogue: CatalogueRule | undefined;
	storeId: string | null;
	onDone: () => void;
}) {
	const t = useT();
	const [enabled, setEnabled] = useState(rule.enabled);
	const [severity, setSeverity] = useState<Severity>(rule.severity);
	const [cooldown, setCooldown] = useState(String(rule.cooldownHours));
	const [texts, setTexts] = useState<Record<string, string>>(() =>
		Object.fromEntries(
			Object.entries(rule.params).map(([key, value]) => [key, String(value)]),
		),
	);
	const [problems, setProblems] = useState<ParamProblem[]>([]);
	const [cooldownBad, setCooldownBad] = useState(false);
	const save = useNotifyAction(source, (s, tenantId, change: RuleChange) =>
		s.saveRule(tenantId, change).then(() => true),
	);
	const schema = catalogue?.paramsSchema ?? {};
	const submit = async () => {
		const params = Object.fromEntries(
			Object.entries(schema).map(([param, entry]) => [
				param,
				parseParamValue(entry.type, texts[param] ?? ""),
			]),
		);
		const found = paramProblems(catalogue, params);
		const hours = Number(cooldown.replace(",", "."));
		const badCooldown = !Number.isFinite(hours) || hours < 0 || hours > 168;
		setProblems(found);
		setCooldownBad(badCooldown);
		if (found.length > 0 || badCooldown) return;
		const done = await save.run({
			ruleKey: rule.ruleKey,
			storeId,
			overrideId:
				rule.source === (storeId === null ? "tenant" : "store")
					? rule.overrideId
					: null,
			enabled,
			severity,
			params,
			cooldownHours: hours,
		});
		if (done === true) onDone();
	};
	const base = `notify-rule-${rule.ruleKey}`;
	return (
		<form
			className="space-y-3 rounded-lg border border-line p-3"
			data-testid="notify-rule-editor"
			onSubmit={(event) => {
				event.preventDefault();
				void submit();
			}}
		>
			<label className="flex items-center gap-2 text-sm">
				<input
					type="checkbox"
					checked={enabled}
					onChange={(event) => setEnabled(event.target.checked)}
					data-testid="notify-rule-enabled"
				/>
				{t("settings.notify.rules.enabled")}
			</label>
			<div className="space-y-1">
				<label htmlFor={`${base}-severity`} className="block text-sm">
					{t("settings.notify.rules.severity")}
				</label>
				<select
					id={`${base}-severity`}
					className="min-h-11 rounded-lg border border-line bg-surface px-3"
					value={severity}
					onChange={(event) => setSeverity(event.target.value as Severity)}
				>
					{SEVERITIES.map((value) => (
						<option key={value} value={value}>
							{t(SEVERITY_KEYS[value])}
						</option>
					))}
				</select>
			</div>
			<div className="space-y-1">
				<label htmlFor={`${base}-cooldown`} className="block text-sm">
					{t("settings.notify.rules.cooldown")}
				</label>
				<input
					id={`${base}-cooldown`}
					inputMode="decimal"
					className="min-h-11 w-32 rounded-lg border border-line bg-surface px-3"
					value={cooldown}
					aria-invalid={cooldownBad}
					onChange={(event) => setCooldown(event.target.value)}
				/>
			</div>
			<fieldset className="space-y-2">
				<legend className="text-sm font-medium">
					{t("settings.notify.rules.params")}
				</legend>
				{Object.keys(schema).length === 0 ? (
					<p className="text-sm text-ink-muted">
						{t("settings.notify.rules.noParams")}
					</p>
				) : null}
				{Object.entries(schema).map(([param, entry]) => {
					const problem = problems.find((row) => row.param === param);
					const id = `${base}-${param}`;
					return (
						<div key={param} className="space-y-1">
							<label htmlFor={id} className="block font-mono text-sm">
								{param}
							</label>
							{entry.type === "boolean" ? (
								<select
									id={id}
									className="min-h-11 rounded-lg border border-line bg-surface px-3"
									value={texts[param] ?? "false"}
									onChange={(event) =>
										setTexts({ ...texts, [param]: event.target.value })
									}
								>
									<option value="true">{t("settings.notify.yes")}</option>
									<option value="false">{t("settings.notify.no")}</option>
								</select>
							) : entry.type === "enum" ? (
								<select
									id={id}
									className="min-h-11 rounded-lg border border-line bg-surface px-3"
									value={texts[param] ?? ""}
									onChange={(event) =>
										setTexts({ ...texts, [param]: event.target.value })
									}
								>
									{(entry.values ?? []).map((value) => (
										<option key={value} value={value}>
											{value}
										</option>
									))}
								</select>
							) : (
								<input
									id={id}
									inputMode={entry.type === "time" ? "text" : "decimal"}
									className="min-h-11 w-40 rounded-lg border border-line bg-surface px-3"
									value={texts[param] ?? ""}
									aria-invalid={problem !== undefined}
									aria-describedby={problem ? `${id}-problem` : undefined}
									onChange={(event) =>
										setTexts({ ...texts, [param]: event.target.value })
									}
									data-testid={`notify-param-${param}`}
								/>
							)}
							{problem ? (
								<p
									id={`${id}-problem`}
									className="text-sm text-negative"
									data-testid="notify-param-problem"
								>
									{problem.min !== undefined && problem.max !== undefined
										? t("settings.notify.rules.paramInvalid", {
												param,
												min: problem.min,
												max: problem.max,
											})
										: t("settings.notify.rules.paramInvalidPlain", { param })}
								</p>
							) : null}
						</div>
					);
				})}
			</fieldset>
			<ErrorLine errorKey={save.errorKey} testId="notify-rule-error" />
			<div className="flex flex-wrap gap-2">
				<Button
					type="submit"
					size="compact"
					disabled={save.pending}
					data-testid="notify-rule-save"
				>
					{t("settings.notify.action.save")}
				</Button>
				<Button tone="secondary" size="compact" onClick={onDone}>
					{t("settings.notify.action.cancel")}
				</Button>
			</div>
		</form>
	);
}

function RuleRow({
	source,
	rule,
	catalogue,
	storeId,
	canEdit,
	myDestination,
	storesWithoutHours,
}: {
	source: NotifySource;
	rule: EffectiveRule;
	catalogue: CatalogueRule | undefined;
	storeId: string | null;
	canEdit: boolean;
	myDestination: Destination | null;
	storesWithoutHours: boolean;
}) {
	const t = useT();
	const [editing, setEditing] = useState(false);
	const reset = useNotifyAction(source, (s, tenantId, id: string) =>
		s.resetRule(tenantId, id),
	);
	const mute = useNotifyAction(source, (s, _tenant, muted: string[]) =>
		myDestination === null
			? Promise.resolve()
			: s.updateDestination(myDestination.id, { mutedRules: muted }),
	);
	const ownOverride =
		rule.overrideId !== null &&
		rule.source === (storeId === null ? "tenant" : "store");
	const [pendingMute, setPendingMute] = useState<boolean | null>(null);
	const muted =
		pendingMute ?? myDestination?.mutedRules.includes(rule.ruleKey) ?? false;
	const roles = roleKeys(rule.roles)
		.map((key) => t(key))
		.join(", ");
	return (
		<li
			className="space-y-1 border-t border-line pt-2"
			data-testid="notify-rule"
			data-rule={rule.ruleKey}
			data-source={rule.source}
			data-enabled={rule.enabled}
		>
			<div className="flex flex-wrap items-baseline justify-between gap-2">
				<span className="font-medium">{ruleLabel(t, rule.ruleKey)}</span>
				<span className="text-sm text-ink-muted">
					{rule.enabled
						? t("settings.notify.rules.on")
						: t("settings.notify.rules.off")}{" "}
					· {t(SEVERITY_KEYS[rule.severity])} · {t(SOURCE_KEYS[rule.source])}
				</span>
			</div>
			<p className="text-sm text-ink-muted">
				{t("settings.notify.rules.roles", { roles })}
				{rule.cooldownHours > 0
					? ` · ${t("settings.notify.rules.cooldownShown", { hours: rule.cooldownHours })}`
					: ""}
			</p>
			{Object.keys(rule.params).length > 0 ? (
				<p className="break-words font-mono text-xs text-ink-muted">
					{Object.entries(rule.params)
						.map(([key, value]) => `${key}=${String(value)}`)
						.join(" · ")}
				</p>
			) : null}
			{rule.ruleKey === "zero_sales_open" && storesWithoutHours ? (
				<p className="text-sm" data-testid="notify-rule-hours-note">
					{t("settings.notify.rules.openingHoursNote")}{" "}
					<TextLink to="/cai-dat/cua-hang">
						{t("settings.notify.rules.openingHoursLink")}
					</TextLink>
				</p>
			) : null}
			{rule.ruleKey === "drawer_variance" ? (
				<p className="text-sm">
					{t("settings.notify.rules.drawerNote")}{" "}
					<TextLink to="/cai-dat/bao-cao">
						{t("settings.notify.rules.thresholdsLink")}
					</TextLink>
				</p>
			) : null}
			<div className="flex flex-wrap gap-2">
				{canEdit && !editing ? (
					<Button
						tone="secondary"
						size="compact"
						onClick={() => setEditing(true)}
						data-testid="notify-rule-edit"
					>
						{t("settings.notify.action.edit")}
					</Button>
				) : null}
				{canEdit && ownOverride && rule.overrideId !== null ? (
					<Button
						tone="secondary"
						size="compact"
						disabled={reset.pending}
						onClick={() => void reset.run(rule.overrideId as string)}
						data-testid="notify-rule-reset"
					>
						{t("settings.notify.action.default")}
					</Button>
				) : null}
				{myDestination !== null && !canEdit ? (
					<label className="flex items-center gap-2 text-sm">
						<input
							type="checkbox"
							checked={muted}
							disabled={mute.pending}
							onChange={(event) => {
								const next = new Set(myDestination.mutedRules);
								if (event.target.checked) next.add(rule.ruleKey);
								else next.delete(rule.ruleKey);
								setPendingMute(event.target.checked);
								void mute
									.run([...next].sort())
									.finally(() => setPendingMute(null));
							}}
							data-testid="notify-rule-mute"
						/>
						{t("settings.notify.rules.mute")}
					</label>
				) : null}
			</div>
			<ErrorLine errorKey={reset.errorKey ?? mute.errorKey} />
			{editing ? (
				<RuleEditor
					source={source}
					rule={rule}
					catalogue={catalogue}
					storeId={storeId}
					onDone={() => setEditing(false)}
				/>
			) : null}
		</li>
	);
}

export function RulesSection({
	source,
	failed,
	onRetry,
	canEdit,
	stores,
	storesWithoutHours,
	myDestination,
}: {
	source: NotifySource | null;
	failed: boolean;
	onRetry: () => void;
	canEdit: boolean;
	stores: readonly StoreRow[];
	storesWithoutHours: boolean;
	myDestination: Destination | null;
}) {
	const t = useT();
	const [storeId, setStoreId] = useState<string | null>(null);
	const catalogue = useRuleCatalogue(source);
	const rules = useEffectiveRules(source, storeId);
	const shown =
		storeId === null
			? rules.data
			: rules.data?.filter((rule) => rule.storeScoped);
	return (
		<NotifySection
			id="notify-rules"
			titleKey="settings.notify.rules.title"
			testId="notify-rules"
		>
			{!canEdit ? (
				<Note testId="notify-rules-read-only">
					{t("settings.notify.readOnly.rules")}
				</Note>
			) : null}
			{stores.length > 1 || canEdit ? (
				<div className="space-y-1">
					<label htmlFor="notify-rules-store" className="block text-sm">
						{t("settings.notify.rules.store")}
					</label>
					<select
						id="notify-rules-store"
						className="min-h-11 rounded-lg border border-line bg-surface px-3"
						value={storeId ?? ""}
						onChange={(event) =>
							setStoreId(event.target.value === "" ? null : event.target.value)
						}
						data-testid="notify-rules-store"
					>
						<option value="">{t("settings.notify.rules.wholeTenant")}</option>
						{stores.map((store) => (
							<option key={store.id} value={store.id}>
								{store.name}
							</option>
						))}
					</select>
				</div>
			) : null}
			{source === null || shown === undefined ? (
				<LoadState
					failed={failed || rules.isError}
					onRetry={() => {
						onRetry();
						void rules.refetch();
					}}
					testId="notify-rules-failed"
				/>
			) : (
				<div className="space-y-4">
					{groupRules(shown).map(([category, list]) => (
						<div key={category} className="space-y-1">
							<h4 className="font-semibold">{t(categoryKey(category))}</h4>
							<ul className="space-y-2">
								{list.map((rule) => (
									<RuleRow
										key={`${storeId ?? "tenant"}-${rule.ruleKey}`}
										source={source}
										rule={rule}
										catalogue={catalogue.data?.find(
											(row) => row.ruleKey === rule.ruleKey,
										)}
										storeId={storeId}
										canEdit={canEdit}
										myDestination={myDestination}
										storesWithoutHours={storesWithoutHours}
									/>
								))}
							</ul>
						</div>
					))}
				</div>
			)}
		</NotifySection>
	);
}
