import { useI18n } from "@fnb/zalo-mini/react";
import {
	type ReactNode,
	useCallback,
	useEffect,
	useId,
	useRef,
	useState,
} from "react";
import { useNavigate } from "react-router-dom";
import { followOA } from "zmp-sdk";
import { CheckOption } from "../announcements/compose";
import { failureKey } from "../shift/env";
import type { Failure } from "../shift/model";
import {
	Alert,
	Card,
	Chip,
	Hint,
	Loading,
	Panel,
	SubScreen,
	type Tone,
} from "../shift/parts";
import { type Load, PROFILE_PATH, useLoad, useTeamEnv } from "../team/env";
import type { TeamScreenProps } from "../team/route";
import {
	dangerButton,
	primaryButton,
	quietButton,
	Spinner,
	secondaryButton,
} from "../ui";
import {
	clockText,
	type Destination,
	type DestinationState,
	destinationState,
	type LinkCode,
	type LinkNotice,
	type LinkStage,
	linkedBot,
	type MutableRule,
	mutableDestinations,
	NO_SETTINGS,
	receiving,
	ruleLabelKey,
	type NotificationSettings as Settings,
	secondsLeft,
	toggled,
} from "./contract";

export type FollowRequest = (oaId: string) => Promise<boolean>;

export async function requestFollow(oaId: string): Promise<boolean> {
	try {
		await followOA({ id: oaId });
		return true;
	} catch {
		return false;
	}
}

const STATE_TONES: Readonly<Record<DestinationState, Tone>> = {
	receiving: "positive",
	waiting: "warning",
	failing: "negative",
	stopped: "neutral",
};

const WAITING_KEYS: Readonly<Record<LinkStage | "expired", string>> = {
	code: "notify.waitingCode",
	acceptance: "notify.waitingHint",
	expired: "notify.waitingExpired",
};

export function NotReady({
	testId,
	children,
}: {
	readonly testId: string;
	readonly children: ReactNode;
}) {
	const { t } = useI18n();
	return (
		<div
			className="flex flex-col gap-1 rounded-xl bg-surface-sunken px-3 py-2"
			data-testid={testId}
			data-state="not-ready"
		>
			<p className="text-sm font-semibold text-ink">{t("notify.notReady")}</p>
			<p className="text-base text-ink">{children}</p>
		</div>
	);
}

function useMounted(): { readonly current: boolean } {
	const mounted = useRef(true);
	useEffect(() => {
		mounted.current = true;
		return () => {
			mounted.current = false;
		};
	}, []);
	return mounted;
}

function useNow(active: boolean): number {
	const [now, setNow] = useState(() => Date.now());
	useEffect(() => {
		if (!active) return;
		setNow(Date.now());
		const timer = window.setInterval(() => setNow(Date.now()), 1000);
		return () => window.clearInterval(timer);
	}, [active]);
	return now;
}

function useRun(): {
	readonly busy: boolean;
	readonly failure: Failure | null;
	run<T>(work: () => Promise<T>): Promise<T | null>;
	clear(): void;
} {
	const { recover } = useTeamEnv();
	const mounted = useMounted();
	const running = useRef(false);
	const [busy, setBusy] = useState(false);
	const [failure, setFailure] = useState<Failure | null>(null);
	const run = useCallback(
		async <T,>(work: () => Promise<T>): Promise<T | null> => {
			if (running.current) return null;
			running.current = true;
			setBusy(true);
			setFailure(null);
			try {
				return await work();
			} catch (error) {
				const kind = recover(error);
				if (mounted.current) setFailure(kind);
				return null;
			} finally {
				running.current = false;
				if (mounted.current) setBusy(false);
			}
		},
		[recover, mounted],
	);
	const clear = useCallback(() => setFailure(null), []);
	return { busy, failure, run, clear };
}

function ConsentLine({ settings }: { readonly settings: Settings }) {
	const { t } = useI18n();
	const { when } = useTeamEnv();
	const consent = settings.consent;
	const at =
		consent.state === "active"
			? consent.grantedAt
			: consent.state === "withdrawn"
				? consent.revokedAt
				: null;
	return (
		<p
			className="text-base text-ink"
			data-testid="consent-state"
			data-state={consent.state}
		>
			{at === null
				? t(`notify.consent.${consent.state}`)
				: t(`notify.consent.${consent.state}At`, when(at))}
		</p>
	);
}

function DestinationCard({
	destination,
}: {
	readonly destination: Destination;
}) {
	const { t } = useI18n();
	const state = destinationState(destination);
	return (
		<li
			data-testid="destination"
			data-state={state}
			data-kind={destination.kind ?? "other"}
		>
			<Card>
				<div className="flex items-start justify-between gap-2">
					<div className="flex min-w-0 flex-col gap-0.5">
						<p className="break-words text-base font-semibold text-ink">
							{destination.label}
						</p>
						{destination.hint === null ? null : (
							<p className="text-sm text-ink-muted">{destination.hint}</p>
						)}
					</div>
					<Chip tone={STATE_TONES[state]} testId="destination-state">
						{t(`notify.state.${state}`)}
					</Chip>
				</div>
				{state === "waiting" ? (
					<Hint testId="destination-waiting">
						{t(WAITING_KEYS[destination.linkStage ?? "expired"])}
					</Hint>
				) : null}
				{state === "stopped" && destination.disabledReason !== null ? (
					<Hint testId="destination-reason">
						{t(`notify.reason.${destination.disabledReason}`)}
					</Hint>
				) : null}
				{destination.mutedRules.length > 0 ? (
					<Hint testId="destination-muted">
						{t("notify.muted", { count: destination.mutedRules.length })}
					</Hint>
				) : null}
			</Card>
		</li>
	);
}

function Destinations({
	load,
	reload,
}: {
	readonly load: Load<Settings>;
	readonly reload: () => void;
}) {
	const { t } = useI18n();
	return (
		<Panel title={t("notify.destinations")} testId="notify-destinations">
			{load.status === "loading" ? (
				<Loading label={t("notify.loading")} />
			) : load.status === "failed" ? (
				<div className="flex flex-col gap-2">
					<Alert testId="destinations-failed">
						{t(failureKey(load.failure))}
					</Alert>
					<button type="button" className={secondaryButton} onClick={reload}>
						{t("ops.retry")}
					</button>
				</div>
			) : (
				<>
					<ConsentLine settings={load.value} />
					{load.value.destinations.length === 0 ? (
						<p
							className="text-base text-ink-muted"
							data-testid="destinations-empty"
						>
							{t("notify.noDestinations")}
						</p>
					) : (
						<ul className="flex flex-col gap-3" data-testid="destination-list">
							{load.value.destinations.map((destination) => (
								<DestinationCard
									key={destination.id}
									destination={destination}
								/>
							))}
						</ul>
					)}
				</>
			)}
		</Panel>
	);
}

function linkFailureKey(failure: Failure): string {
	switch (failure) {
		case "duplicate":
			return "notify.bot.failed.linked";
		case "state":
			return "notify.bot.failed.tooMany";
		case "not-allowed":
			return "notify.bot.failed.notAllowed";
		default:
			return failureKey(failure);
	}
}

function NoticeStep({
	notice,
	busy,
	onCreate,
	onLater,
}: {
	readonly notice: LinkNotice;
	readonly busy: boolean;
	readonly onCreate: () => void;
	readonly onLater: () => void;
}) {
	const { t } = useI18n();
	const headingId = useId();
	const headingRef = useRef<HTMLHeadingElement>(null);
	useEffect(() => {
		headingRef.current?.focus({ preventScroll: true });
	}, []);
	return (
		<section
			aria-labelledby={headingId}
			className="flex flex-col gap-3 rounded-2xl border border-line bg-surface-raised p-4"
			data-testid="bot-notice"
			data-version={notice.version}
		>
			<h3
				id={headingId}
				ref={headingRef}
				tabIndex={-1}
				className="text-base font-semibold text-ink outline-none"
			>
				{t("notify.bot.noticeTitle")}
			</h3>
			<p className="text-base text-ink" data-testid="notice-text">
				{notice.text}
			</p>
			<Hint>{t("notify.bot.noticeHint")}</Hint>
			<button
				type="button"
				className={primaryButton}
				data-action="primary"
				disabled={busy}
				aria-busy={busy}
				onClick={onCreate}
			>
				{busy ? <Spinner /> : null}
				{t("notify.bot.create")}
			</button>
			<button
				type="button"
				className={quietButton}
				disabled={busy}
				onClick={onLater}
			>
				{t("notify.bot.later")}
			</button>
		</section>
	);
}

function CodeStep({
	link,
	botName,
	onRenew,
	onDone,
}: {
	readonly link: LinkCode;
	readonly botName: string | null;
	readonly onRenew: () => void;
	readonly onDone: () => void;
}) {
	const { t } = useI18n();
	const now = useNow(true);
	const left = secondsLeft(link.expiresAt, now);
	const bot = link.botName ?? botName;
	return (
		<Card testId="bot-code" state={left > 0 ? "live" : "expired"}>
			{left > 0 ? (
				<>
					<p className="text-base text-ink">{t("notify.bot.codeIntro")}</p>
					<p
						className="select-all break-all text-center font-mono text-2xl font-semibold tracking-widest text-ink"
						data-testid="link-code"
					>
						{link.code}
					</p>
					<p
						className="text-center text-base text-ink"
						data-testid="link-countdown"
					>
						{t("notify.bot.expiresIn", { time: clockText(left) })}
					</p>
					<ol
						className="flex list-decimal flex-col gap-1 pl-5 text-base text-ink"
						data-testid="link-steps"
					>
						<li>
							{bot === null
								? t("notify.bot.stepOpenUnnamed")
								: t("notify.bot.stepOpen", { bot })}
						</li>
						<li>{t("notify.bot.stepSend")}</li>
						<li>{t("notify.bot.stepAgree")}</li>
					</ol>
					<button type="button" className={secondaryButton} onClick={onDone}>
						{t("notify.bot.done")}
					</button>
				</>
			) : (
				<>
					<p
						role="status"
						className="text-base text-ink"
						data-testid="link-expired"
					>
						{t("notify.bot.expired")}
					</p>
					<button type="button" className={secondaryButton} onClick={onRenew}>
						{t("notify.bot.renew")}
					</button>
				</>
			)}
		</Card>
	);
}

type LinkStep =
	| { readonly step: "idle" }
	| { readonly step: "notice" }
	| { readonly step: "code"; readonly link: LinkCode };

function BotLink({
	settings,
	tenantId,
	onChanged,
}: {
	readonly settings: Settings;
	readonly tenantId: string | null;
	readonly onChanged: () => void;
}) {
	const { t } = useI18n();
	const { client } = useTeamEnv();
	const [step, setStep] = useState<LinkStep>({ step: "idle" });
	const action = useRun();
	const linked = linkedBot(settings.destinations);
	const notice = settings.notice;
	const create = async () => {
		if (tenantId === null || notice === null) return;
		const link = await action.run(() =>
			client.startBotLink(tenantId, notice.version),
		);
		if (link === null) return;
		setStep({ step: "code", link });
		onChanged();
	};
	let body: ReactNode;
	if (step.step === "code") {
		body = (
			<CodeStep
				link={step.link}
				botName={settings.botName}
				onRenew={() => {
					action.clear();
					setStep({ step: "notice" });
				}}
				onDone={() => {
					setStep({ step: "idle" });
					onChanged();
				}}
			/>
		);
	} else if (linked !== null) {
		body = (
			<p className="text-base text-ink" data-testid="bot-linked">
				{t("notify.bot.linked")}
			</p>
		);
	} else if (tenantId === null || notice === null) {
		body = (
			<NotReady testId="bot-not-ready">{t("notify.bot.notReady")}</NotReady>
		);
	} else if (step.step === "notice") {
		body = (
			<NoticeStep
				notice={notice}
				busy={action.busy}
				onCreate={() => void create()}
				onLater={() => {
					action.clear();
					setStep({ step: "idle" });
				}}
			/>
		);
	} else {
		body = (
			<Card testId="bot-start">
				<p className="text-base text-ink">{t("notify.bot.intro")}</p>
				<button
					type="button"
					className={secondaryButton}
					onClick={() => setStep({ step: "notice" })}
				>
					{t("notify.bot.start")}
				</button>
			</Card>
		);
	}
	return (
		<Panel title={t("notify.bot.title")} testId="notify-bot">
			{body}
			{action.failure === null ? null : (
				<Alert testId="bot-failed">{t(linkFailureKey(action.failure))}</Alert>
			)}
		</Panel>
	);
}

type FollowState = "idle" | "busy" | "done" | "refused";

function FollowOa({
	follow,
	tenantId,
}: {
	readonly follow: FollowRequest;
	readonly tenantId: string | null;
}) {
	const { t } = useI18n();
	const { client, recover } = useTeamEnv();
	const fetchTarget = useCallback(
		() =>
			tenantId === null ? Promise.resolve(null) : client.followTarget(tenantId),
		[client, tenantId],
	);
	const { load } = useLoad(fetchTarget, recover);
	const target = load.status === "ready" ? load.value : null;
	const [state, setState] = useState<FollowState>("idle");
	const mounted = useMounted();
	const start = async (oaId: string) => {
		setState("busy");
		const followed = await follow(oaId);
		if (mounted.current) setState(followed ? "done" : "refused");
	};
	return (
		<Panel title={t("notify.follow.title")} testId="notify-follow">
			{load.status === "loading" ? (
				<Loading label={t("notify.loading")} />
			) : target === null ? (
				<NotReady testId="follow-not-ready">
					{t("notify.follow.notReady")}
				</NotReady>
			) : (
				<Card>
					<p className="text-base text-ink" data-testid="follow-purpose">
						{t("notify.follow.purpose")}
					</p>
					{state === "done" ? (
						<p
							role="status"
							className="rounded-xl bg-positive-soft px-3 py-2 text-base text-positive"
							data-testid="follow-done"
						>
							{t("notify.follow.done")}
						</p>
					) : (
						<>
							{state === "refused" ? (
								<p
									role="status"
									className="text-base text-ink"
									data-testid="follow-refused"
								>
									{t("notify.follow.refused")}
								</p>
							) : null}
							<button
								type="button"
								className={secondaryButton}
								disabled={state === "busy"}
								aria-busy={state === "busy"}
								onClick={() => void start(target)}
							>
								{state === "busy" ? <Spinner /> : null}
								{t("notify.follow.action")}
							</button>
						</>
					)}
				</Card>
			)}
		</Panel>
	);
}

function DestinationMutes({
	destination,
	rules,
	onChanged,
}: {
	readonly destination: Destination;
	readonly rules: readonly MutableRule[];
	readonly onChanged: () => void;
}) {
	const { t } = useI18n();
	const { client } = useTeamEnv();
	const action = useRun();
	const [muted, setMuted] = useState<readonly string[]>(destination.mutedRules);
	const saved = destination.mutedRules.join(",");
	useEffect(() => {
		setMuted(saved === "" ? [] : saved.split(","));
	}, [saved]);
	const change = async (key: string, receive: boolean) => {
		const before = muted;
		const wanted = toggled(muted, key, receive);
		setMuted(wanted);
		const result = await action.run(() =>
			client.setMutedRules(destination.id, wanted),
		);
		if (result === null) {
			setMuted(before);
			return;
		}
		setMuted(result);
		onChanged();
	};
	return (
		<fieldset
			className="flex min-w-0 flex-col gap-2"
			data-testid="mute-destination"
			data-destination={destination.id}
		>
			<legend className="mb-2 text-base font-semibold text-ink">
				{destination.hint === null
					? destination.label
					: t("notify.mute.destination", {
							label: destination.label,
							hint: destination.hint,
						})}
			</legend>
			{rules.map((rule) => (
				<CheckOption
					key={rule.key}
					checked={!muted.includes(rule.key)}
					disabled={action.busy}
					label={t(ruleLabelKey(rule))}
					testId={`mute-${rule.key}`}
					onChange={(receive) => void change(rule.key, receive)}
				/>
			))}
			{action.failure === null ? null : (
				<Alert testId="mute-failed">{t(failureKey(action.failure))}</Alert>
			)}
		</fieldset>
	);
}

function Mutes({
	settings,
	onChanged,
}: {
	readonly settings: Settings;
	readonly onChanged: () => void;
}) {
	const { t } = useI18n();
	const destinations = mutableDestinations(settings.destinations);
	return (
		<Panel title={t("notify.mute.title")} testId="notify-mute">
			{destinations.length === 0 ? (
				<p className="text-base text-ink-muted" data-testid="mute-empty">
					{t("notify.mute.noDestination")}
				</p>
			) : settings.rules.length === 0 ? (
				<p className="text-base text-ink-muted" data-testid="mute-empty">
					{t("notify.mute.noRules")}
				</p>
			) : (
				<>
					<Hint>{t("notify.mute.hint")}</Hint>
					{destinations.map((destination) => (
						<DestinationMutes
							key={destination.id}
							destination={destination}
							rules={settings.rules}
							onChanged={onChanged}
						/>
					))}
				</>
			)}
		</Panel>
	);
}

type StopStep =
	| { readonly step: "idle" }
	| { readonly step: "confirm" }
	| { readonly step: "done"; readonly cancelled: number };

function StopNotifications({
	settings,
	tenantId,
	onStopped,
}: {
	readonly settings: Settings;
	readonly tenantId: string | null;
	readonly onStopped: () => void;
}) {
	const { t } = useI18n();
	const { client } = useTeamEnv();
	const [step, setStep] = useState<StopStep>({ step: "idle" });
	const action = useRun();
	const questionId = useId();
	const questionRef = useRef<HTMLParagraphElement>(null);
	const confirming = step.step === "confirm";
	useEffect(() => {
		if (confirming) questionRef.current?.focus({ preventScroll: true });
	}, [confirming]);
	const stop = async () => {
		if (tenantId === null) return;
		const cancelled = await action.run(() =>
			client.stopNotifications(tenantId),
		);
		if (cancelled === null) return;
		setStep({ step: "done", cancelled });
		onStopped();
	};
	let body: ReactNode;
	if (step.step === "done") {
		body = (
			<div
				role="status"
				className="flex flex-col gap-1 rounded-xl bg-positive-soft px-3 py-2 text-positive"
				data-testid="stop-done"
			>
				<p className="text-base">{t("notify.stop.done")}</p>
				{step.cancelled > 0 ? (
					<p className="text-base">
						{t("notify.stop.cancelled", { count: step.cancelled })}
					</p>
				) : null}
			</div>
		);
	} else if (!receiving(settings) || tenantId === null) {
		body = (
			<p className="text-base text-ink-muted" data-testid="stop-nothing">
				{t("notify.stop.nothing")}
			</p>
		);
	} else if (step.step === "confirm") {
		body = (
			<section
				aria-labelledby={questionId}
				className="flex flex-col gap-3 rounded-2xl border border-line bg-surface-raised p-4"
				data-testid="stop-confirm"
			>
				<p
					id={questionId}
					ref={questionRef}
					tabIndex={-1}
					className="text-base font-semibold text-ink outline-none"
				>
					{t("notify.stop.question")}
				</p>
				<p className="text-base text-ink">{t("notify.stop.consequence")}</p>
				<button
					type="button"
					className={dangerButton}
					disabled={action.busy}
					aria-busy={action.busy}
					onClick={() => void stop()}
				>
					{action.busy ? <Spinner /> : null}
					{t("notify.stop.confirm")}
				</button>
				<button
					type="button"
					className={secondaryButton}
					disabled={action.busy}
					onClick={() => {
						action.clear();
						setStep({ step: "idle" });
					}}
				>
					{t("notify.stop.cancel")}
				</button>
			</section>
		);
	} else {
		body = (
			<>
				<p className="text-base text-ink">{t("notify.stop.body")}</p>
				<button
					type="button"
					className={dangerButton}
					onClick={() => setStep({ step: "confirm" })}
				>
					{t("notify.stop.action")}
				</button>
			</>
		);
	}
	return (
		<Panel title={t("notify.stop.title")} testId="notify-stop">
			{body}
			{action.failure === null ? null : (
				<Alert testId="stop-failed">{t(failureKey(action.failure))}</Alert>
			)}
			<Hint testId="stop-staff-ops">{t("notify.stop.staffOps")}</Hint>
		</Panel>
	);
}

export function NotificationSettings({
	follow = requestFollow,
}: {
	readonly follow?: FollowRequest;
}) {
	const { t } = useI18n();
	const navigate = useNavigate();
	const { client, recover, context } = useTeamEnv();
	const tenantId = context.tenantId;
	const fetchSettings = useCallback(
		() =>
			tenantId === null
				? Promise.resolve(NO_SETTINGS)
				: client.notificationSettings(tenantId),
		[client, tenantId],
	);
	const { load, reload } = useLoad(fetchSettings, recover);
	const settings = load.status === "ready" ? load.value : null;
	return (
		<SubScreen
			title={t("notify.title")}
			subtitle={t("notify.subtitle")}
			onBack={() => navigate(PROFILE_PATH)}
			testId="notification-settings"
		>
			<Destinations load={load} reload={reload} />
			{settings === null ? null : (
				<BotLink settings={settings} tenantId={tenantId} onChanged={reload} />
			)}
			<FollowOa follow={follow} tenantId={tenantId} />
			<Panel title={t("notify.group.title")} testId="notify-group">
				<p className="text-base text-ink">{t("notify.group.body")}</p>
			</Panel>
			{settings === null ? null : (
				<>
					<Mutes settings={settings} onChanged={reload} />
					<StopNotifications
						settings={settings}
						tenantId={tenantId}
						onStopped={reload}
					/>
				</>
			)}
		</SubScreen>
	);
}

export function NotificationSettingsScreen(_: TeamScreenProps) {
	return <NotificationSettings />;
}
