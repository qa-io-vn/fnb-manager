import { useI18n } from "@fnb/zalo-mini/react";
import { useCallback, useId, useMemo, useState } from "react";
import { failureKey } from "../shift/env";
import { Alert, Chip, Loading } from "../shift/parts";
import { useLoad, useTeamEnv } from "../team/env";
import type { TeamScreenProps } from "../team/route";
import { primaryButton, secondaryButton } from "../ui";
import { ComposeAnnouncement } from "./compose";
import type { Announcement } from "./contract";
import { AnnouncementDetail } from "./detail";
import { isPinned, isUnread, orderFeed } from "./model";
import { storeLabel, UnreadDot } from "./parts";

type View =
	| { readonly kind: "list" }
	| { readonly kind: "detail"; readonly id: string }
	| { readonly kind: "compose" };

function NoticeCard({
	announcement,
	now,
	onOpen,
}: {
	readonly announcement: Announcement;
	readonly now: Date;
	readonly onOpen: () => void;
}) {
	const { t } = useI18n();
	const env = useTeamEnv();
	const unread = isUnread(announcement, env.memberId);
	const pinned = isPinned(announcement, now);
	const published = env.when(announcement.publishedAt);
	return (
		<li
			data-testid="notice-card"
			data-pinned={pinned}
			data-unread={unread}
			data-id={announcement.id}
		>
			<button
				type="button"
				onClick={onOpen}
				className="flex w-full min-w-0 gap-3 rounded-card-2xl border-card border-line bg-surface-raised p-4 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
			>
				{unread ? <UnreadDot /> : <span className="w-2.5 shrink-0" />}
				<span className="flex min-w-0 flex-1 flex-col gap-1">
					{pinned || unread ? (
						<span className="flex flex-wrap gap-2">
							{pinned ? (
								<Chip tone="accent" testId="notice-pinned">
									{t("notices.pinned")}
								</Chip>
							) : null}
							{unread ? (
								<Chip tone="warning" testId="notice-unread">
									{t("notices.unread")}
								</Chip>
							) : null}
						</span>
					) : null}
					<span
						className={`break-words text-body text-ink ${unread ? "font-semibold" : ""}`}
					>
						{announcement.title}
					</span>
					<span className="line-clamp-2 break-words text-sm text-ink-muted">
						{announcement.body}
					</span>
					<span className="text-sm text-ink-muted">
						{t("notices.publishedAt", published)}
						{" · "}
						{storeLabel(announcement, env, t)}
					</span>
				</span>
			</button>
		</li>
	);
}

function NoticeList({
	announcements,
	now,
	onOpen,
}: {
	readonly announcements: readonly Announcement[];
	readonly now: Date;
	readonly onOpen: (id: string) => void;
}) {
	const { t } = useI18n();
	const ordered = useMemo(
		() => orderFeed(announcements, now),
		[announcements, now],
	);
	if (ordered.length === 0) {
		return (
			<p className="text-body text-ink-muted" data-testid="notices-empty">
				{t("notices.empty")}
			</p>
		);
	}
	return (
		<ul className="flex flex-col gap-3" data-testid="notices-list">
			{ordered.map((announcement) => (
				<NoticeCard
					key={announcement.id}
					announcement={announcement}
					now={now}
					onOpen={() => onOpen(announcement.id)}
				/>
			))}
		</ul>
	);
}

export function AnnouncementsScreen({ open }: TeamScreenProps) {
	const { t } = useI18n();
	const env = useTeamEnv();
	const { client, recover, manager } = env;
	const headingId = useId();
	const [view, setView] = useState<View>(
		open.announcementId === null
			? { kind: "list" }
			: { kind: "detail", id: open.announcementId },
	);
	const [reads, setReads] = useState<Readonly<Record<string, string>>>({});
	const [now, setNow] = useState(() => new Date());
	const fetchFeed = useCallback(async () => {
		const feed = await client.feed(null);
		setNow(new Date());
		return feed;
	}, [client]);
	const { load, reload } = useLoad(fetchFeed, recover);
	const feed = useMemo(
		() =>
			load.status === "ready"
				? load.value.map((announcement) => {
						const readAt = reads[announcement.id];
						return readAt === undefined || announcement.readAt !== null
							? announcement
							: { ...announcement, readAt };
					})
				: [],
		[load, reads],
	);
	const back = useCallback(() => setView({ kind: "list" }), []);

	if (view.kind === "compose") {
		return (
			<ComposeAnnouncement
				onBack={back}
				onPublished={() => {
					setView({ kind: "list" });
					reload();
				}}
			/>
		);
	}

	if (view.kind === "detail" && load.status === "ready") {
		const announcement = feed.find((candidate) => candidate.id === view.id);
		return (
			<AnnouncementDetail
				key={view.id}
				announcement={announcement ?? null}
				now={now}
				onBack={back}
				onRead={(id, readAt) => {
					setReads((current) => ({ ...current, [id]: readAt }));
				}}
			/>
		);
	}

	return (
		<section
			aria-labelledby={headingId}
			className="flex flex-col gap-4 px-4 pt-5 pb-8"
			data-testid="announcements"
			data-status={load.status}
		>
			<header className="flex flex-col gap-0.5">
				<h1 id={headingId} className="text-xl font-semibold text-ink">
					{t("notices.title")}
				</h1>
				<p className="text-sm text-ink-muted">{t("notices.subtitle")}</p>
			</header>
			{manager ? (
				<button
					type="button"
					className={primaryButton}
					data-action="primary"
					onClick={() => setView({ kind: "compose" })}
				>
					{t("notices.compose")}
				</button>
			) : null}
			{load.status === "loading" ? (
				<Loading label={t("notices.loading")} />
			) : load.status === "failed" ? (
				<div className="flex flex-col gap-2">
					<Alert testId="notices-failed">{t(failureKey(load.failure))}</Alert>
					<button
						type="button"
						className={manager ? secondaryButton : primaryButton}
						{...(manager ? {} : { "data-action": "primary" })}
						onClick={reload}
					>
						{t("ops.retry")}
					</button>
				</div>
			) : (
				<NoticeList
					announcements={feed}
					now={now}
					onOpen={(id) => setView({ kind: "detail", id })}
				/>
			)}
		</section>
	);
}
