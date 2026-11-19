import { useI18n } from "@fnb/zalo-mini/react";
import {
	type ReactNode,
	useCallback,
	useEffect,
	useRef,
	useState,
} from "react";
import { useNavigate } from "react-router-dom";
import { followOA } from "zmp-sdk";
import { failureKey } from "../shift/env";
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
import { PROFILE_PATH, useLoad, useTeamEnv } from "../team/env";
import type { TeamScreenProps } from "../team/route";
import { Spinner, secondaryButton } from "../ui";
import {
	type Destination,
	type DestinationState,
	destinationState,
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
				{state === "waiting" ? <Hint>{t("notify.waitingHint")}</Hint> : null}
				{state === "stopped" && destination.disabledReason !== null ? (
					<Hint testId="destination-reason">
						{t(`notify.reason.${destination.disabledReason}`)}
					</Hint>
				) : null}
				{destination.mutedRules > 0 ? (
					<Hint testId="destination-muted">
						{t("notify.muted", { count: destination.mutedRules })}
					</Hint>
				) : null}
			</Card>
		</li>
	);
}

function Destinations() {
	const { t } = useI18n();
	const { client, recover } = useTeamEnv();
	const fetchDestinations = useCallback(() => client.destinations(), [client]);
	const { load, reload } = useLoad(fetchDestinations, recover);
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
			) : load.value.length === 0 ? (
				<p
					className="text-base text-ink-muted"
					data-testid="destinations-empty"
				>
					{t("notify.noDestinations")}
				</p>
			) : (
				<ul className="flex flex-col gap-3" data-testid="destination-list">
					{load.value.map((destination) => (
						<DestinationCard key={destination.id} destination={destination} />
					))}
				</ul>
			)}
		</Panel>
	);
}

type FollowState = "idle" | "busy" | "done" | "refused";

function FollowOa({ follow }: { readonly follow: FollowRequest }) {
	const { t } = useI18n();
	const { client, recover } = useTeamEnv();
	const fetchTarget = useCallback(() => client.followTarget(), [client]);
	const { load } = useLoad(fetchTarget, recover);
	const target = load.status === "ready" ? load.value : null;
	const [state, setState] = useState<FollowState>("idle");
	const mounted = useRef(true);
	useEffect(() => {
		mounted.current = true;
		return () => {
			mounted.current = false;
		};
	}, []);
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

export function NotificationSettings({
	follow = requestFollow,
}: {
	readonly follow?: FollowRequest;
}) {
	const { t } = useI18n();
	const navigate = useNavigate();
	return (
		<SubScreen
			title={t("notify.title")}
			subtitle={t("notify.subtitle")}
			onBack={() => navigate(PROFILE_PATH)}
			testId="notification-settings"
		>
			<Destinations />
			<Panel title={t("notify.bot.title")} testId="notify-bot">
				<NotReady testId="bot-not-ready">{t("notify.bot.notReady")}</NotReady>
			</Panel>
			<FollowOa follow={follow} />
			<Panel title={t("notify.group.title")} testId="notify-group">
				<p className="text-base text-ink">{t("notify.group.body")}</p>
			</Panel>
			<Panel title={t("notify.mute.title")} testId="notify-mute">
				<NotReady testId="mute-not-ready">{t("notify.mute.notReady")}</NotReady>
			</Panel>
			<Panel title={t("notify.stop.title")} testId="notify-stop">
				<NotReady testId="stop-not-ready">{t("notify.stop.notReady")}</NotReady>
				<Hint>{t("notify.stop.staffOps")}</Hint>
			</Panel>
		</SubScreen>
	);
}

export function NotificationSettingsScreen(_: TeamScreenProps) {
	return <NotificationSettings />;
}
