import type { StoredSession } from "@fnb/zalo-mini";
import { useDataEndpoint, useI18n, useSession } from "@fnb/zalo-mini/react";
import { type ReactNode, useCallback, useId, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import type { Announcement } from "../announcements/contract";
import {
	isOwn,
	isUnread,
	pinnedNow,
	unreadCount,
} from "../announcements/model";
import { UnreadDot } from "../announcements/parts";
import { canManage } from "../shift/model";
import { Chip, focusRing, quietAction } from "../shift/parts";
import { secondaryButton } from "../ui";
import {
	TEAM_PATHS,
	type TeamOpen,
	type TeamPath,
	teamOpenState,
	useLoad,
} from "./env";
import type { HomeTeamParts, HomeTeamProps } from "./home-slot";
import { type TeamSourceFactory, teamSourceFor } from "./source";

const noRecovery = () => "unknown" as const;

function useTeamSource(session: StoredSession, sourceFor: TeamSourceFactory) {
	const endpoint = useDataEndpoint();
	return useMemo(
		() => sourceFor(endpoint, session),
		[sourceFor, endpoint, session],
	);
}

function useOpen() {
	const navigate = useNavigate();
	return useCallback(
		(path: TeamPath, open?: Partial<TeamOpen>) =>
			navigate(path, { state: teamOpenState(open ?? {}) }),
		[navigate],
	);
}

function HomeSection({
	title,
	testId,
	status,
	children,
}: {
	readonly title: string;
	readonly testId: string;
	readonly status?: string;
	readonly children: ReactNode;
}) {
	const headingId = useId();
	return (
		<section
			aria-labelledby={headingId}
			className="flex flex-col gap-3"
			data-testid={testId}
			data-status={status}
		>
			<h2 id={headingId} className="text-body font-semibold text-ink">
				{title}
			</h2>
			<div className="flex flex-col gap-3 rounded-card-2xl border-card border-line bg-surface-raised p-4">
				{children}
			</div>
		</section>
	);
}

function PinnedRow({
	announcement,
	memberId,
	onOpen,
}: {
	readonly announcement: Announcement;
	readonly memberId: string | null;
	readonly onOpen: () => void;
}) {
	const { t } = useI18n();
	const unread = isUnread(announcement, memberId);
	return (
		<li data-testid="home-pinned" data-unread={unread}>
			<button
				type="button"
				onClick={onOpen}
				className={`flex min-h-11 w-full min-w-0 items-start gap-3 rounded-control-xl py-2 text-left ${focusRing}`}
			>
				{unread ? <UnreadDot /> : <span className="w-2.5 shrink-0" />}
				<span className="flex min-w-0 flex-1 flex-col gap-0.5">
					<span
						className={`break-words text-body text-ink ${unread ? "font-semibold" : ""}`}
					>
						{announcement.title}
					</span>
					<span className="text-sm text-ink-muted">
						{unread
							? t("notices.unread")
							: isOwn(announcement, memberId)
								? t("notices.own")
								: t("team.home.read")}
					</span>
				</span>
			</button>
		</li>
	);
}

function SignedInNotices({
	storeId,
	session,
	sourceFor,
}: HomeTeamProps & {
	readonly session: StoredSession;
	readonly sourceFor: TeamSourceFactory;
}) {
	const { t } = useI18n();
	const source = useTeamSource(session, sourceFor);
	const open = useOpen();
	const fetchFeed = useCallback(
		() => source.client.feed(storeId),
		[source, storeId],
	);
	const { load, reload } = useLoad(fetchFeed, noRecovery);
	if (load.status === "loading") return null;
	if (load.status === "failed") {
		return (
			<HomeSection
				title={t("notices.title")}
				testId="home-notices"
				status="failed"
			>
				<div className="flex items-center justify-between gap-2">
					<p className="text-body text-ink-muted">
						{t("team.home.noticesFailed")}
					</p>
					<button type="button" className={quietAction} onClick={reload}>
						{t("ops.retry")}
					</button>
				</div>
			</HomeSection>
		);
	}
	const now = new Date();
	const pinned = pinnedNow(load.value, now);
	const unread = unreadCount(load.value, source.memberId);
	if (pinned.length === 0 && unread === 0) return null;
	return (
		<HomeSection
			title={t("notices.title")}
			testId="home-notices"
			status="ready"
		>
			{pinned.length === 0 ? null : (
				<div className="flex flex-col gap-1">
					<Chip tone="accent">{t("team.home.pinned")}</Chip>
					<ul className="flex flex-col" data-testid="home-pinned-list">
						{pinned.map((announcement) => (
							<PinnedRow
								key={announcement.id}
								announcement={announcement}
								memberId={source.memberId}
								onOpen={() =>
									open(TEAM_PATHS.notices, { announcementId: announcement.id })
								}
							/>
						))}
					</ul>
				</div>
			)}
			{unread === 0 ? null : (
				<p className="text-body text-ink" data-testid="home-unread-count">
					{t("team.home.unread", { count: unread })}
				</p>
			)}
			<button
				type="button"
				className={secondaryButton}
				onClick={() => open(TEAM_PATHS.notices)}
			>
				{t("team.home.allNotices")}
			</button>
		</HomeSection>
	);
}

function PendingCount({
	session,
	sourceFor,
}: {
	readonly session: StoredSession;
	readonly sourceFor: TeamSourceFactory;
}) {
	const { t } = useI18n();
	const source = useTeamSource(session, sourceFor);
	const fetchQueue = useCallback(() => source.client.queue(), [source]);
	const { load, reload } = useLoad(fetchQueue, noRecovery);
	if (load.status === "loading") {
		return (
			<p role="status" className="text-sm text-ink-muted">
				{t("team.home.pendingLoading")}
			</p>
		);
	}
	if (load.status === "failed") {
		return (
			<div className="flex items-center justify-between gap-2">
				<p className="text-sm text-ink-muted">{t("team.home.pendingFailed")}</p>
				<button type="button" className={quietAction} onClick={reload}>
					{t("ops.retry")}
				</button>
			</div>
		);
	}
	const count = load.value.length;
	return (
		<Chip tone={count > 0 ? "warning" : "positive"} testId="home-pending-count">
			{count > 0 ? t("team.home.pending", { count }) : t("team.home.noPending")}
		</Chip>
	);
}

function SignedInRequests({
	storeId,
	session,
	sourceFor,
}: HomeTeamProps & {
	readonly session: StoredSession;
	readonly sourceFor: TeamSourceFactory;
}) {
	const { t } = useI18n();
	const open = useOpen();
	const manager = canManage(session.member.role);
	return (
		<HomeSection title={t("team.home.requests")} testId="home-requests">
			{manager ? (
				<div
					className="flex flex-col gap-2 border-b border-line pb-3"
					data-testid="home-approvals"
				>
					<div className="flex flex-wrap items-center justify-between gap-2">
						<p className="text-body font-semibold text-ink">
							{t("approvals.title")}
						</p>
						<PendingCount session={session} sourceFor={sourceFor} />
					</div>
					<button
						type="button"
						className={secondaryButton}
						onClick={() => open(TEAM_PATHS.approvals, { storeId })}
					>
						{t("team.home.openApprovals")}
					</button>
				</div>
			) : null}
			<p className="text-sm text-ink-muted">{t("team.home.requestsBody")}</p>
			<button
				type="button"
				className={secondaryButton}
				onClick={() => open(TEAM_PATHS.sendRequest, { storeId })}
			>
				{t("ask.title")}
			</button>
			<button
				type="button"
				className={quietAction}
				onClick={() => open(TEAM_PATHS.myRequests, { storeId })}
			>
				{t("ask.mine")}
			</button>
		</HomeSection>
	);
}

export function TeamHomeNotices({
	storeId,
	sourceFor = teamSourceFor,
}: HomeTeamProps & { readonly sourceFor?: TeamSourceFactory }) {
	const { state } = useSession();
	if (state.status !== "signed-in") return null;
	return (
		<SignedInNotices
			key={storeId}
			storeId={storeId}
			session={state.session}
			sourceFor={sourceFor}
		/>
	);
}

export function TeamHomeRequests({
	storeId,
	sourceFor = teamSourceFor,
}: HomeTeamProps & { readonly sourceFor?: TeamSourceFactory }) {
	const { state } = useSession();
	if (state.status !== "signed-in") return null;
	const role = state.session.member.role;
	if (role !== "owner" && role !== "manager" && role !== "staff") return null;
	return (
		<SignedInRequests
			storeId={storeId}
			session={state.session}
			sourceFor={sourceFor}
		/>
	);
}

export const TEAM_HOME_PARTS: HomeTeamParts = {
	notices: TeamHomeNotices,
	requests: TeamHomeRequests,
};
