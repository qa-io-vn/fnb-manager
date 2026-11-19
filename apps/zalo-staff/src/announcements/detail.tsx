import { useI18n } from "@fnb/zalo-mini/react";
import { useCallback } from "react";
import { failureKey } from "../shift/env";
import {
	Alert,
	BusyLabel,
	Card,
	Chip,
	Hint,
	Loading,
	Panel,
	SubScreen,
} from "../shift/parts";
import { useLoad, useTeamAction, useTeamEnv } from "../team/env";
import { primaryButton, secondaryButton } from "../ui";
import type { Announcement, Reader } from "./contract";
import { isOwn, isPinned, percent } from "./model";
import { storeLabel } from "./parts";

function ReaderRow({ reader }: { readonly reader: Reader }) {
	const { t } = useI18n();
	return (
		<li
			className="flex items-center justify-between gap-2 border-t border-line py-2 first:border-t-0"
			data-testid="unread-reader"
		>
			<span className="min-w-0 break-words text-base text-ink">
				{reader.name ?? t("notices.unnamed")}
			</span>
			<span className="shrink-0 text-sm text-ink-muted">
				{reader.member
					? t(`role.${reader.role ?? "staff"}`)
					: t("notices.formerMember")}
			</span>
		</li>
	);
}

function ReadRatePanel({ id }: { readonly id: string }) {
	const { t } = useI18n();
	const { client, recover } = useTeamEnv();
	const fetch = useCallback(async () => {
		const [rate, readers] = await Promise.all([
			client.readRate(id),
			client.readers(id),
		]);
		return { rate, readers };
	}, [client, id]);
	const { load, reload } = useLoad(fetch, recover);
	return (
		<Panel title={t("notices.rate.title")} testId="notice-read-rate">
			{load.status === "loading" ? (
				<Loading label={t("notices.rate.loading")} />
			) : load.status === "failed" ? (
				<div className="flex flex-col gap-2">
					<Alert testId="notice-rate-failed">
						{t(failureKey(load.failure))}
					</Alert>
					<button type="button" className={secondaryButton} onClick={reload}>
						{t("ops.retry")}
					</button>
				</div>
			) : load.value.rate.recipients === 0 ? (
				<Hint testId="notice-rate-none">{t("notices.rate.none")}</Hint>
			) : (
				<Card>
					<p
						className="text-2xl font-semibold tabular-nums text-ink"
						data-testid="notice-rate-value"
					>
						{t("notices.rate.value", {
							readers: load.value.rate.readers,
							recipients: load.value.rate.recipients,
							percent: percent(load.value.rate.rate) ?? 0,
						})}
					</p>
					<Hint testId="notice-rate-early">
						{t("notices.rate.early", {
							count: load.value.rate.readersWithin24h,
						})}
					</Hint>
					{load.value.readers.some((reader) => reader.readAt === null) ? (
						<div className="flex flex-col gap-1">
							<h3 className="text-sm font-semibold text-ink">
								{t("notices.rate.unreadTitle", {
									count: load.value.readers.filter(
										(reader) => reader.readAt === null,
									).length,
								})}
							</h3>
							<ul data-testid="unread-readers">
								{load.value.readers
									.filter((reader) => reader.readAt === null)
									.map((reader) => (
										<ReaderRow key={reader.userId} reader={reader} />
									))}
							</ul>
						</div>
					) : (
						<p
							className="text-base text-positive"
							data-testid="notice-rate-all"
						>
							{t("notices.rate.all")}
						</p>
					)}
				</Card>
			)}
		</Panel>
	);
}

function ReadAction({
	announcement,
	onRead,
}: {
	readonly announcement: Announcement;
	readonly onRead: (id: string, readAt: string) => void;
}) {
	const { t } = useI18n();
	const { client, when } = useTeamEnv();
	const action = useTeamAction();
	if (announcement.readAt !== null) {
		return (
			<p
				role="status"
				className="rounded-xl bg-positive-soft px-3 py-2 text-base text-positive"
				data-testid="notice-read-at"
			>
				{t("notices.readAt", when(announcement.readAt))}
			</p>
		);
	}
	const read = async () => {
		const result = await action.run(() => client.markRead(announcement.id));
		if (result.ok) onRead(announcement.id, result.value.readAt);
	};
	return (
		<div className="flex flex-col gap-2">
			{action.failure === null ? null : (
				<Alert testId="notice-read-failed">
					{t(failureKey(action.failure))}
				</Alert>
			)}
			<button
				type="button"
				className={primaryButton}
				data-action="primary"
				disabled={action.busy}
				aria-busy={action.busy}
				onClick={() => void read()}
			>
				<BusyLabel busy={action.busy} busyText={t("notices.reading")}>
					{t("notices.read")}
				</BusyLabel>
			</button>
		</div>
	);
}

export function AnnouncementDetail({
	announcement,
	now,
	onBack,
	onRead,
}: {
	readonly announcement: Announcement | null;
	readonly now: Date;
	readonly onBack: () => void;
	readonly onRead: (id: string, readAt: string) => void;
}) {
	const { t } = useI18n();
	const env = useTeamEnv();
	if (announcement === null) {
		return (
			<SubScreen
				title={t("notices.title")}
				onBack={onBack}
				testId="notice-detail"
			>
				<p className="text-base text-ink-muted" data-testid="notice-missing">
					{t("notices.missing")}
				</p>
				<button
					type="button"
					className={primaryButton}
					data-action="primary"
					onClick={onBack}
				>
					{t("notices.backToList")}
				</button>
			</SubScreen>
		);
	}
	const own = isOwn(announcement, env.memberId);
	const pinned = isPinned(announcement, now);
	return (
		<SubScreen
			title={announcement.title}
			subtitle={`${t("notices.publishedAt", env.when(announcement.publishedAt))} · ${storeLabel(announcement, env, t)}`}
			onBack={onBack}
			testId="notice-detail"
		>
			{pinned && announcement.pinnedUntil !== null ? (
				<Chip tone="accent" testId="notice-pinned-until">
					{t("notices.pinnedUntil", env.when(announcement.pinnedUntil))}
				</Chip>
			) : null}
			<Card testId="notice-body-card">
				<p
					className="whitespace-pre-line break-words text-base text-ink"
					data-testid="notice-body"
				>
					{announcement.body}
				</p>
			</Card>
			{own ? (
				<Hint testId="notice-own">{t("notices.own")}</Hint>
			) : (
				<ReadAction announcement={announcement} onRead={onRead} />
			)}
			{env.manager ? <ReadRatePanel id={announcement.id} /> : null}
		</SubScreen>
	);
}
