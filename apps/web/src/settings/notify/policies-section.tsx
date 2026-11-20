import { useState } from "react";
import { Button } from "../../components/ui/button";
import { type MessageKey, useT } from "../../i18n";
import {
	ErrorLine,
	LoadState,
	Note,
	NotifySection,
	useNotifyAction,
} from "./common";
import { useEffectivePolicies } from "./queries";
import type { EffectivePolicy, NotifySource, PolicyChange } from "./source";
import { capValid, kindKey, windowValid } from "./words";

const CLASS_KEYS: Readonly<
	Record<EffectivePolicy["messageClass"], MessageKey>
> = {
	operational: "settings.notify.class.operational",
	transactional: "settings.notify.class.transactional",
	advertising: "settings.notify.class.advertising",
};

const EDITABLE_KINDS: ReadonlySet<string> = new Set([
	"zalo_bot",
	"email",
	"telegram",
	"webhook",
]);

export function policyChangeOf(
	policy: EffectivePolicy,
	start: string,
	end: string,
	cap: string,
	bypass: boolean,
): PolicyChange | null {
	if (!windowValid(start.trim(), end.trim()) || !capValid(cap)) return null;
	return {
		channelKind: policy.channelKind,
		overrideId: policy.source === "tenant" ? policy.policyId : null,
		windowStart: start.trim() === "" ? null : start.trim(),
		windowEnd: end.trim() === "" ? null : end.trim(),
		maxPerDay: cap.trim() === "" ? null : Number(cap.trim()),
		criticalBypass: bypass,
	};
}

function PolicyEditor({
	source,
	policy,
	onDone,
}: {
	source: NotifySource;
	policy: EffectivePolicy;
	onDone: () => void;
}) {
	const t = useT();
	const [start, setStart] = useState(policy.windowStart ?? "");
	const [end, setEnd] = useState(policy.windowEnd ?? "");
	const [cap, setCap] = useState(
		policy.maxPerDay === null ? "" : String(policy.maxPerDay),
	);
	const [bypass, setBypass] = useState(policy.criticalBypass);
	const [problem, setProblem] = useState<MessageKey | null>(null);
	const save = useNotifyAction(source, (s, tenantId, change: PolicyChange) =>
		s.savePolicy(tenantId, change).then(() => true),
	);
	const base = `notify-policy-${policy.channelKind}`;
	return (
		<form
			className="space-y-3 rounded-lg border border-line p-3"
			data-testid="notify-policy-editor"
			onSubmit={async (event) => {
				event.preventDefault();
				if (!windowValid(start.trim(), end.trim())) {
					setProblem("settings.notify.policies.windowInvalid");
					return;
				}
				if (!capValid(cap)) {
					setProblem("settings.notify.policies.capInvalid");
					return;
				}
				setProblem(null);
				const change = policyChangeOf(policy, start, end, cap, bypass);
				if (change === null) return;
				const done = await save.run(change);
				if (done === true) onDone();
			}}
		>
			<div className="grid gap-2 sm:grid-cols-2">
				<div className="space-y-1">
					<label htmlFor={`${base}-start`} className="block text-sm">
						{t("settings.notify.policies.start")}
					</label>
					<input
						id={`${base}-start`}
						className="min-h-11 w-32 rounded-lg border border-line bg-surface px-3"
						value={start}
						onChange={(event) => setStart(event.target.value)}
						data-testid="notify-policy-start"
					/>
				</div>
				<div className="space-y-1">
					<label htmlFor={`${base}-end`} className="block text-sm">
						{t("settings.notify.policies.end")}
					</label>
					<input
						id={`${base}-end`}
						className="min-h-11 w-32 rounded-lg border border-line bg-surface px-3"
						value={end}
						onChange={(event) => setEnd(event.target.value)}
						data-testid="notify-policy-end"
					/>
				</div>
			</div>
			<div className="space-y-1">
				<label htmlFor={`${base}-cap`} className="block text-sm">
					{t("settings.notify.policies.cap")}
				</label>
				<input
					id={`${base}-cap`}
					inputMode="numeric"
					className="min-h-11 w-32 rounded-lg border border-line bg-surface px-3"
					value={cap}
					onChange={(event) => setCap(event.target.value)}
				/>
			</div>
			<label className="flex items-center gap-2 text-sm">
				<input
					type="checkbox"
					checked={bypass}
					onChange={(event) => setBypass(event.target.checked)}
				/>
				{t("settings.notify.policies.bypass")}
			</label>
			{problem !== null ? (
				<p role="alert" className="text-sm text-negative">
					{t(problem)}
				</p>
			) : null}
			<ErrorLine errorKey={save.errorKey} testId="notify-policy-error" />
			<div className="flex flex-wrap gap-2">
				<Button
					type="submit"
					size="compact"
					disabled={save.pending}
					data-testid="notify-policy-save"
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

function PolicyRow({
	source,
	policy,
	canEdit,
}: {
	source: NotifySource;
	policy: EffectivePolicy;
	canEdit: boolean;
}) {
	const t = useT();
	const [editing, setEditing] = useState(false);
	const reset = useNotifyAction(source, (s, tenantId, id: string) =>
		s.resetPolicy(tenantId, id),
	);
	return (
		<li
			className="space-y-1 border-t border-line pt-2"
			data-testid="notify-policy"
			data-kind={policy.channelKind}
			data-source={policy.source}
		>
			<p className="font-medium">{t(kindKey(policy.channelKind))}</p>
			<p className="text-sm">
				{policy.windowStart !== null && policy.windowEnd !== null
					? t("settings.notify.policies.window", {
							start: policy.windowStart,
							end: policy.windowEnd,
						})
					: t("settings.notify.policies.anyTime")}
				{" · "}
				{policy.maxPerDay === null
					? t("settings.notify.policies.noCap")
					: t("settings.notify.policies.maxPerDay", {
							count: policy.maxPerDay,
						})}
			</p>
			<p className="text-sm text-ink-muted">
				{policy.criticalBypass
					? t("settings.notify.policies.critical")
					: t("settings.notify.policies.noCritical")}
				{" · "}
				{t("settings.notify.policies.source", {
					source:
						policy.source === "tenant"
							? t("settings.notify.source.tenant")
							: t("settings.notify.source.global"),
				})}
			</p>
			{policy.note ? (
				<p className="text-xs text-ink-muted">{policy.note}</p>
			) : null}
			{canEdit ? (
				<div className="flex flex-wrap gap-2">
					{!editing ? (
						<Button
							tone="secondary"
							size="compact"
							onClick={() => setEditing(true)}
							data-testid="notify-policy-edit"
						>
							{t("settings.notify.action.edit")}
						</Button>
					) : null}
					{policy.source === "tenant" ? (
						<Button
							tone="secondary"
							size="compact"
							disabled={reset.pending}
							onClick={() => void reset.run(policy.policyId)}
							data-testid="notify-policy-reset"
						>
							{t("settings.notify.action.default")}
						</Button>
					) : null}
				</div>
			) : null}
			<ErrorLine errorKey={reset.errorKey} />
			{editing ? (
				<PolicyEditor
					source={source}
					policy={policy}
					onDone={() => setEditing(false)}
				/>
			) : null}
		</li>
	);
}

export function PoliciesSection({
	source,
	failed,
	onRetry,
	canEdit,
}: {
	source: NotifySource | null;
	failed: boolean;
	onRetry: () => void;
	canEdit: boolean;
}) {
	const t = useT();
	const policies = useEffectivePolicies(source);
	const operational =
		policies.data?.filter(
			(policy) =>
				policy.messageClass === "operational" &&
				policy.allowed &&
				EDITABLE_KINDS.has(policy.channelKind),
		) ?? [];
	return (
		<NotifySection
			id="notify-policies"
			titleKey="settings.notify.policies.title"
			testId="notify-policies"
		>
			{!canEdit ? (
				<Note testId="notify-policies-read-only">
					{t("settings.notify.readOnly.policies")}
				</Note>
			) : null}
			{source === null || policies.data === undefined ? (
				<LoadState
					failed={failed || policies.isError}
					onRetry={() => {
						onRetry();
						void policies.refetch();
					}}
					testId="notify-policies-failed"
				/>
			) : (
				<>
					<h4 className="font-semibold">{t(CLASS_KEYS.operational)}</h4>
					<ul className="space-y-2">
						{operational.map((policy) => (
							<PolicyRow
								key={policy.channelKind}
								source={source}
								policy={policy}
								canEdit={canEdit}
							/>
						))}
					</ul>
					<div
						className="space-y-1 text-sm"
						data-testid="notify-policies-other"
					>
						<p>{t("settings.notify.policies.otherClasses")}</p>
						<p>
							{t(CLASS_KEYS.transactional)}:{" "}
							{t("settings.notify.policies.transactionalFloor")}
						</p>
						<p>
							{t(CLASS_KEYS.advertising)}:{" "}
							{t("settings.notify.policies.advertisingFloor")}
						</p>
					</div>
				</>
			)}
		</NotifySection>
	);
}
