import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "../../components/ui/button";
import { useT } from "../../i18n";
import { useReadyTenantScope } from "../../state/tenant-scope";
import {
	ErrorLine,
	LoadState,
	Note,
	NotifySection,
	useNotifyAction,
} from "./common";
import { invalidateNotify } from "./queries";
import {
	type Destination,
	LINK_ANSWER_LIMIT_MS,
	LINK_POLL_MS,
	type LinkableKind,
	type LinkStart,
	type NotifyOverview,
	type NotifySource,
	TEST_POLL_LIMIT_MS,
	TEST_POLL_MS,
} from "./source";
import {
	ageParts,
	decisionKey,
	disabledKey,
	isFinalOutcome,
	isIanaZone,
	kindKey,
	RULE_LABEL_KEYS,
	reasonOf,
	STATUS_KEYS,
	type TestOutcome,
	testOutcomeOf,
} from "./words";

function useNow(intervalMs: number): number {
	const [now, setNow] = useState(() => Date.now());
	useEffect(() => {
		const timer = setInterval(() => setNow(Date.now()), intervalMs);
		return () => clearInterval(timer);
	}, [intervalMs]);
	return now;
}

export function TestButton({
	source,
	destination,
	scheduleEnabled,
	formatTime,
}: {
	source: NotifySource;
	destination: Destination;
	scheduleEnabled: boolean;
	formatTime: (iso: string) => string;
}) {
	const t = useT();
	const send = useNotifyAction(source, (s, _tenant, id: string) =>
		s.sendTest(id),
	);
	const [outcome, setOutcome] = useState<TestOutcome | null>(null);
	const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
	useEffect(
		() => () => {
			if (timer.current !== null) clearTimeout(timer.current);
		},
		[],
	);
	const start = async () => {
		setOutcome(null);
		const messageId = await send.run(destination.id);
		if (messageId === undefined) return;
		const startedAt = Date.now();
		setOutcome({ kind: "waiting" });
		const poll = async () => {
			let state = null;
			try {
				state = await source.messageStatus(messageId);
			} catch {
				state = null;
			}
			const next = testOutcomeOf(
				state,
				Date.now() - startedAt,
				TEST_POLL_LIMIT_MS,
				scheduleEnabled,
			);
			setOutcome(next);
			if (!isFinalOutcome(next)) {
				timer.current = setTimeout(poll, TEST_POLL_MS);
			}
		};
		timer.current = setTimeout(poll, TEST_POLL_MS);
	};
	const waiting = send.pending || outcome?.kind === "waiting";
	return (
		<div className="space-y-1">
			<Button
				tone="secondary"
				size="compact"
				disabled={waiting}
				aria-label={t("settings.notify.action.testLabel", {
					label: destination.label,
				})}
				onClick={() => void start()}
				data-testid="notify-test"
			>
				{t("settings.notify.action.test")}
			</Button>
			<p
				aria-live="polite"
				className="text-sm"
				data-testid="notify-test-outcome"
			>
				{outcome === null ? null : testOutcomeText(t, outcome, formatTime)}
			</p>
			<ErrorLine errorKey={send.errorKey} testId="notify-test-error" />
		</div>
	);
}

export function testOutcomeText(
	t: ReturnType<typeof useT>,
	outcome: TestOutcome,
	formatTime: (iso: string) => string,
): string {
	switch (outcome.kind) {
		case "waiting":
			return t("settings.notify.test.waiting");
		case "sent":
			return t("settings.notify.test.sent", {
				time: outcome.at === null ? "" : formatTime(outcome.at),
			});
		case "held":
			return t("settings.notify.test.held", {
				time: outcome.until === null ? "" : formatTime(outcome.until),
			});
		case "failed": {
			const reason = reasonOf(outcome.code);
			return t("settings.notify.test.failed", {
				reason: t(reason.key, reason.params),
			});
		}
		case "cancelled": {
			const key = decisionKey(outcome.decision);
			return t("settings.notify.test.cancelled", {
				reason: key === null ? "" : t(key),
			});
		}
		case "uncertain":
			return t("settings.notify.test.uncertain");
		case "stillQueued":
			return outcome.scheduleOff
				? t("settings.notify.test.scheduleOff")
				: t("settings.notify.test.stillQueued");
	}
}

function DestinationEditor({
	source,
	destination,
	onDone,
	ruleKeys,
}: {
	source: NotifySource;
	destination: Destination;
	onDone: () => void;
	ruleKeys: readonly string[];
}) {
	const t = useT();
	const [label, setLabel] = useState(destination.label);
	const [enabled, setEnabled] = useState(destination.enabled);
	const [zone, setZone] = useState(destination.timezone ?? "");
	const [muted, setMuted] = useState<ReadonlySet<string>>(
		new Set(destination.mutedRules),
	);
	const [problem, setProblem] = useState<
		| "settings.notify.edit.labelInvalid"
		| "settings.notify.edit.timezoneInvalid"
		| null
	>(null);
	const save = useNotifyAction(
		source,
		(s, _tenant, change: Parameters<NotifySource["updateDestination"]>[1]) =>
			s.updateDestination(destination.id, change).then(() => true),
	);
	const submit = async () => {
		const trimmed = label.trim();
		if (trimmed.length < 1 || trimmed.length > 60) {
			setProblem("settings.notify.edit.labelInvalid");
			return;
		}
		if (zone.trim() !== "" && !isIanaZone(zone.trim())) {
			setProblem("settings.notify.edit.timezoneInvalid");
			return;
		}
		setProblem(null);
		const done = await save.run({
			label: trimmed,
			enabled,
			mutedRules: [...muted].sort(),
			...(zone.trim() === "" ? {} : { timezone: zone.trim() }),
		});
		if (done === true) onDone();
	};
	const idBase = `notify-edit-${destination.id}`;
	return (
		<form
			className="space-y-3 rounded-lg border border-line p-3"
			data-testid="notify-edit"
			onSubmit={(event) => {
				event.preventDefault();
				void submit();
			}}
		>
			<p className="font-medium">{t("settings.notify.edit.title")}</p>
			<div className="space-y-1">
				<label htmlFor={`${idBase}-label`} className="block text-sm">
					{t("settings.notify.edit.label")}
				</label>
				<input
					id={`${idBase}-label`}
					className="min-h-11 w-full rounded-lg border border-line bg-surface px-3"
					value={label}
					maxLength={80}
					onChange={(event) => setLabel(event.target.value)}
				/>
			</div>
			<label className="flex items-center gap-2 text-sm">
				<input
					type="checkbox"
					checked={enabled}
					onChange={(event) => setEnabled(event.target.checked)}
				/>
				{t("settings.notify.edit.enabled")}
			</label>
			<div className="space-y-1">
				<label htmlFor={`${idBase}-zone`} className="block text-sm">
					{t("settings.notify.edit.timezone")}
				</label>
				<input
					id={`${idBase}-zone`}
					className="min-h-11 w-full rounded-lg border border-line bg-surface px-3"
					value={zone}
					onChange={(event) => setZone(event.target.value)}
				/>
			</div>
			<fieldset className="space-y-1">
				<legend className="text-sm">{t("settings.notify.edit.muted")}</legend>
				<div className="grid gap-1 sm:grid-cols-2">
					{ruleKeys.map((key) => {
						const labelKey = RULE_LABEL_KEYS[key];
						return (
							<label key={key} className="flex items-center gap-2 text-sm">
								<input
									type="checkbox"
									checked={muted.has(key)}
									onChange={(event) => {
										const next = new Set(muted);
										if (event.target.checked) next.add(key);
										else next.delete(key);
										setMuted(next);
									}}
								/>
								{labelKey ? t(labelKey) : key}
							</label>
						);
					})}
				</div>
			</fieldset>
			{problem !== null ? (
				<p role="alert" className="text-sm text-negative">
					{t(problem)}
				</p>
			) : null}
			<ErrorLine errorKey={save.errorKey} testId="notify-edit-error" />
			<div className="flex flex-wrap gap-2">
				<Button type="submit" size="compact" disabled={save.pending}>
					{t("settings.notify.action.save")}
				</Button>
				<Button tone="secondary" size="compact" onClick={onDone}>
					{t("settings.notify.action.cancel")}
				</Button>
			</div>
		</form>
	);
}

function DestinationCard({
	source,
	destination,
	overview,
	canManage,
	canTest,
	now,
	formatTime,
	ruleKeys,
	onRemoved,
}: {
	source: NotifySource;
	destination: Destination;
	overview: NotifyOverview;
	canManage: boolean;
	canTest: boolean;
	now: number;
	formatTime: (iso: string) => string;
	ruleKeys: readonly string[];
	onRemoved: (count: number) => void;
}) {
	const t = useT();
	const [editing, setEditing] = useState(false);
	const [confirming, setConfirming] = useState(false);
	const remove = useNotifyAction(source, (s, _tenant) =>
		s.removeDestination(destination.id),
	);
	const lastOk = ageParts(destination.lastOkAt, now);
	const testable =
		canTest &&
		destination.kind !== "webhook" &&
		destination.enabled &&
		(destination.status === "active" || destination.status === "failing");
	return (
		<li
			className="space-y-2 rounded-lg border border-line p-3"
			data-testid="notify-destination"
			data-status={destination.status}
			data-kind={destination.kind}
		>
			<div className="flex flex-wrap items-baseline gap-x-2">
				<span className="font-medium">{destination.label}</span>
				<span className="text-sm text-ink-muted">
					{t(kindKey(destination.kind))}
					{destination.addressHint ? ` · ${destination.addressHint}` : ""}
					{destination.mine
						? ` · ${t("settings.notify.destinations.mine")}`
						: ""}
				</span>
			</div>
			<p className="text-sm" data-testid="notify-destination-status">
				{t(STATUS_KEYS[destination.status])}
				{destination.enabled
					? ""
					: ` · ${t("settings.notify.destinations.off")}`}
			</p>
			{destination.memberEmail ? (
				<p className="text-sm text-ink-muted">
					{t("settings.notify.destinations.member", {
						email: destination.memberEmail,
					})}
				</p>
			) : null}
			{lastOk !== null ? (
				<p className="text-sm text-ink-muted">
					{t("settings.notify.destinations.lastOk", {
						age: t(lastOk.key, { count: lastOk.count }),
					})}
				</p>
			) : null}
			{destination.lastErrorCode !== null &&
			destination.status === "failing" ? (
				<p className="text-sm" data-testid="notify-destination-error">
					{(() => {
						const reason = reasonOf(destination.lastErrorCode);
						return t("settings.notify.destinations.lastError", {
							reason: t(reason.key, reason.params),
						});
					})()}
				</p>
			) : null}
			{destination.status === "disabled" ? (
				<p className="text-sm">
					{t("settings.notify.destinations.disabled", {
						reason: t(disabledKey(destination.disabledReason)),
					})}
				</p>
			) : null}
			{destination.mutedRules.length > 0 ? (
				<p className="text-sm text-ink-muted">
					{t("settings.notify.destinations.muted", {
						rules: destination.mutedRules
							.map((key) => {
								const labelKey = RULE_LABEL_KEYS[key];
								return labelKey ? t(labelKey) : key;
							})
							.join(", "),
					})}
				</p>
			) : null}
			{overview.scheduleEnabled &&
			destination.status !== "pending" &&
			!destination.secretReported &&
			overview.dispatcherSecrets.length > 0 ? (
				<Note tone="warning">{t("settings.notify.status.secretMissing")}</Note>
			) : null}
			<div className="flex flex-wrap gap-2">
				{testable ? (
					<TestButton
						source={source}
						destination={destination}
						scheduleEnabled={overview.scheduleEnabled}
						formatTime={formatTime}
					/>
				) : null}
				{canManage && !editing ? (
					<Button
						tone="secondary"
						size="compact"
						aria-label={t("settings.notify.action.editLabel", {
							label: destination.label,
						})}
						onClick={() => setEditing(true)}
						data-testid="notify-edit-open"
					>
						{t("settings.notify.action.edit")}
					</Button>
				) : null}
				{canManage && !confirming ? (
					<Button
						tone="secondary"
						size="compact"
						aria-label={t("settings.notify.action.removeLabel", {
							label: destination.label,
						})}
						onClick={() => setConfirming(true)}
						data-testid="notify-remove"
					>
						{t("settings.notify.action.remove")}
					</Button>
				) : null}
			</div>
			{editing ? (
				<DestinationEditor
					source={source}
					destination={destination}
					ruleKeys={ruleKeys}
					onDone={() => setEditing(false)}
				/>
			) : null}
			{confirming ? (
				<div className="space-y-2" data-testid="notify-remove-confirm">
					<p className="text-sm">
						{t("settings.notify.remove.confirm", { label: destination.label })}
					</p>
					<div className="flex flex-wrap gap-2">
						<Button
							tone="warning"
							size="compact"
							disabled={remove.pending}
							onClick={async () => {
								const count = await remove.run();
								if (count !== undefined) {
									setConfirming(false);
									onRemoved(count);
								}
							}}
							data-testid="notify-remove-yes"
						>
							{t("settings.notify.action.confirm")}
						</Button>
						<Button
							tone="secondary"
							size="compact"
							onClick={() => setConfirming(false)}
						>
							{t("settings.notify.action.cancel")}
						</Button>
					</div>
					<ErrorLine errorKey={remove.errorKey} />
				</div>
			) : null}
		</li>
	);
}

type LinkStage =
	| { readonly kind: "idle" }
	| { readonly kind: "notice"; readonly channel: LinkableKind }
	| {
			readonly kind: "code";
			readonly channel: LinkableKind;
			readonly link: LinkStart;
			readonly startedAt: number;
	  }
	| { readonly kind: "done"; readonly channel: LinkableKind }
	| { readonly kind: "expired"; readonly channel: LinkableKind };

export function linkStageAfter(
	stage: LinkStage,
	status: Destination["status"] | null,
	now: number,
): LinkStage {
	if (stage.kind !== "code") return stage;
	if (status === "active" || status === "failing") {
		return { kind: "done", channel: stage.channel };
	}
	const expires =
		stage.link.expiresAt === null
			? null
			: new Date(stage.link.expiresAt).getTime();
	if (
		(expires !== null && now >= expires) ||
		now - stage.startedAt >= LINK_ANSWER_LIMIT_MS
	) {
		return { kind: "expired", channel: stage.channel };
	}
	return stage;
}

function LinkFlow({
	source,
	tenantName,
	overview,
	formatTime,
}: {
	source: NotifySource;
	tenantName: string;
	overview: NotifyOverview;
	formatTime: (iso: string) => string;
}) {
	const t = useT();
	const { tenant } = useReadyTenantScope();
	const queryClient = useQueryClient();
	const [stage, setStage] = useState<LinkStage>({ kind: "idle" });
	const start = useNotifyAction(source, (s, tenantId, channel: LinkableKind) =>
		s.startLink(tenantId, channel, null),
	);
	const stageRef = useRef(stage);
	stageRef.current = stage;
	const check = useCallback(async () => {
		const current = stageRef.current;
		if (current.kind !== "code") return;
		let status: Destination["status"] | null = null;
		try {
			const fresh = await source.overview(tenant.id);
			status =
				fresh.destinations.find((row) => row.id === current.link.channelId)
					?.status ?? null;
		} catch {
			status = null;
		}
		const next = linkStageAfter(current, status, Date.now());
		if (next !== current) {
			setStage(next);
			await invalidateNotify(queryClient, source.kind, tenant.id);
		}
	}, [source, tenant.id, queryClient]);
	useEffect(() => {
		if (stage.kind !== "code") return;
		const timer = setInterval(() => void check(), LINK_POLL_MS);
		return () => clearInterval(timer);
	}, [stage.kind, check]);
	const begin = async (channel: LinkableKind) => {
		const link = await start.run(channel);
		if (link === undefined) return;
		setStage(
			link.status === "active"
				? { kind: "done", channel }
				: { kind: "code", channel, link, startedAt: Date.now() },
		);
	};
	const channelName = (channel: LinkableKind) => t(kindKey(channel));
	const usesTelegram = overview.destinations.some(
		(row) => row.kind === "telegram",
	);
	return (
		<div className="space-y-2" data-testid="notify-link">
			<div className="flex flex-wrap gap-2">
				<Button
					size="compact"
					onClick={() => setStage({ kind: "notice", channel: "zalo_bot" })}
					data-testid="notify-link-bot"
				>
					{t("settings.notify.action.linkBot")}
				</Button>
				<Button
					tone="secondary"
					size="compact"
					onClick={() => setStage({ kind: "notice", channel: "email" })}
					data-testid="notify-link-email"
				>
					{t("settings.notify.action.linkEmail")}
				</Button>
				{usesTelegram ? (
					<Button
						tone="secondary"
						size="compact"
						onClick={() => setStage({ kind: "notice", channel: "telegram" })}
						data-testid="notify-link-telegram"
					>
						{t("settings.notify.action.linkTelegram")}
					</Button>
				) : null}
			</div>
			{stage.kind === "notice" ? (
				<div
					className="space-y-2 rounded-lg border border-line p-3"
					data-testid="notify-link-notice"
				>
					<p className="font-medium">{t("settings.notify.link.noticeTitle")}</p>
					<p className="text-sm">
						{t("settings.notify.link.notice", {
							tenant: tenantName,
							channel: channelName(stage.channel),
						})}
					</p>
					<div className="flex flex-wrap gap-2">
						<Button
							size="compact"
							disabled={start.pending}
							onClick={() => void begin(stage.channel)}
							data-testid="notify-link-start"
						>
							{stage.channel === "email"
								? t("settings.notify.link.startEmail")
								: t("settings.notify.link.start")}
						</Button>
						<Button
							tone="secondary"
							size="compact"
							onClick={() => setStage({ kind: "idle" })}
						>
							{t("settings.notify.action.cancel")}
						</Button>
					</div>
				</div>
			) : null}
			{stage.kind === "code" ? (
				<div
					className="space-y-2 rounded-lg border border-line p-3"
					data-testid="notify-link-code"
				>
					<p className="font-mono text-lg font-semibold">
						{t("settings.notify.link.code", {
							code: stage.link.linkCode ?? "",
						})}
					</p>
					<p className="text-sm">
						{t("settings.notify.link.instructions", {
							bot: stage.link.botName ?? t("settings.notify.link.botUnknown"),
							channel: channelName(stage.channel),
							time:
								stage.link.expiresAt === null
									? ""
									: formatTime(stage.link.expiresAt),
						})}
					</p>
					<p className="text-sm text-ink-muted" aria-live="polite">
						{t("settings.notify.link.waiting")}
					</p>
				</div>
			) : null}
			<div aria-live="polite">
				{stage.kind === "done" ? (
					<p className="text-sm" data-testid="notify-link-done">
						{stage.channel === "email"
							? t("settings.notify.link.emailDone")
							: t("settings.notify.link.done")}
					</p>
				) : null}
				{stage.kind === "expired" ? (
					<div className="space-y-2" data-testid="notify-link-expired">
						<p className="text-sm">{t("settings.notify.link.expired")}</p>
						<Button
							tone="secondary"
							size="compact"
							onClick={() => void begin(stage.channel)}
						>
							{t("settings.notify.retry")}
						</Button>
					</div>
				) : null}
			</div>
			<ErrorLine errorKey={start.errorKey} testId="notify-link-error" />
		</div>
	);
}

function StopAll({ source }: { source: NotifySource }) {
	const t = useT();
	const [confirming, setConfirming] = useState(false);
	const [done, setDone] = useState<number | null>(null);
	const stop = useNotifyAction(source, (s, tenantId) => s.stopMine(tenantId));
	return (
		<div className="space-y-2" data-testid="notify-stop">
			{confirming ? (
				<div className="space-y-2" data-testid="notify-stop-confirm">
					<p className="text-sm">{t("settings.notify.stop.confirm")}</p>
					<div className="flex flex-wrap gap-2">
						<Button
							tone="warning"
							size="compact"
							disabled={stop.pending}
							onClick={async () => {
								const count = await stop.run();
								if (count !== undefined) {
									setDone(count);
									setConfirming(false);
								}
							}}
							data-testid="notify-stop-yes"
						>
							{t("settings.notify.action.confirm")}
						</Button>
						<Button
							tone="secondary"
							size="compact"
							onClick={() => setConfirming(false)}
						>
							{t("settings.notify.action.cancel")}
						</Button>
					</div>
				</div>
			) : (
				<Button
					tone="warning"
					size="compact"
					onClick={() => setConfirming(true)}
					data-testid="notify-stop-all"
				>
					{t("settings.notify.action.stopAll")}
				</Button>
			)}
			<p aria-live="polite" className="text-sm" data-testid="notify-stop-done">
				{done === null ? null : t("settings.notify.stop.done", { count: done })}
			</p>
			<ErrorLine errorKey={stop.errorKey} />
		</div>
	);
}

export function DestinationsSection({
	source,
	overview,
	failed,
	onRetry,
	unlimitedOwner,
	unlimitedManager,
	tenantName,
	formatTime,
	ruleKeys,
}: {
	source: NotifySource | null;
	overview: NotifyOverview | undefined;
	failed: boolean;
	onRetry: () => void;
	unlimitedOwner: boolean;
	unlimitedManager: boolean;
	tenantName: string;
	formatTime: (iso: string) => string;
	ruleKeys: readonly string[];
}) {
	const t = useT();
	const now = useNow(60_000);
	const [removed, setRemoved] = useState<number | null>(null);
	return (
		<NotifySection
			id="notify-destinations"
			titleKey="settings.notify.destinations.title"
			testId="notify-destinations"
		>
			{overview === undefined || source === null ? (
				<LoadState
					failed={failed}
					onRetry={onRetry}
					testId="notify-destinations-failed"
				/>
			) : (
				<div className="space-y-3">
					{overview.destinations.length === 0 ? (
						<p className="text-sm" data-testid="notify-destinations-empty">
							{t("settings.notify.destinations.empty")}
						</p>
					) : (
						<ul className="space-y-2">
							{overview.destinations.map((destination) => (
								<DestinationCard
									key={destination.id}
									source={source}
									destination={destination}
									overview={overview}
									canManage={
										(destination.mine && destination.hasMember) ||
										unlimitedOwner
									}
									canTest={destination.mine || unlimitedManager}
									now={now}
									formatTime={formatTime}
									ruleKeys={ruleKeys}
									onRemoved={setRemoved}
								/>
							))}
						</ul>
					)}
					<p
						aria-live="polite"
						className="text-sm"
						data-testid="notify-removed"
					>
						{removed === null
							? null
							: t("settings.notify.remove.done", { count: removed })}
					</p>
					<LinkFlow
						source={source}
						tenantName={tenantName}
						overview={overview}
						formatTime={formatTime}
					/>
					{overview.destinations.some((row) => row.mine) ? (
						<StopAll source={source} />
					) : null}
				</div>
			)}
		</NotifySection>
	);
}
