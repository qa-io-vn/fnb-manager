import { useState } from "react";
import { Button } from "../../components/ui/button";
import type { StoreRow } from "../../data/row-source";
import { useT } from "../../i18n";
import { ErrorLine, LoadState, NotifySection, useNotifyAction } from "./common";
import { useAlertHistory, useMessageLog } from "./queries";
import { ruleLabel } from "./rules-section";
import type { AlertEpisode, LogMessage, NotifySource } from "./source";
import {
	canResend,
	decisionKey,
	kindKey,
	MESSAGE_KIND_KEYS,
	MESSAGE_STATUS_KEYS,
	reasonOf,
	SEVERITY_KEYS,
} from "./words";

export function factsText(facts: Readonly<Record<string, unknown>>): string {
	return Object.entries(facts)
		.filter(([, value]) => typeof value === "number")
		.map(([key, value]) => `${key}=${value}`)
		.join(" · ");
}

function EpisodeRow({
	episode,
	storeName,
	formatInstant,
}: {
	episode: AlertEpisode;
	storeName: string | null;
	formatInstant: (iso: string) => string;
}) {
	const t = useT();
	const facts = factsText(episode.facts);
	return (
		<li
			className="space-y-1 border-t border-line pt-2"
			data-testid="notify-episode"
			data-state={episode.state}
		>
			<div className="flex flex-wrap items-baseline justify-between gap-2">
				<span className="font-medium">{ruleLabel(t, episode.ruleKey)}</span>
				<span className="text-sm text-ink-muted">
					{t(SEVERITY_KEYS[episode.severity])} ·{" "}
					{storeName ?? t("settings.notify.history.tenantWide")}
				</span>
			</div>
			<p className="text-sm">
				{t("settings.notify.history.opened", {
					time: formatInstant(episode.openedAt),
				})}
				{" · "}
				{t("settings.notify.history.lastSeen", {
					time: formatInstant(episode.lastSeenAt),
				})}
			</p>
			<p className="text-sm">
				{t("settings.notify.history.occurrences", {
					count: episode.occurrences,
				})}
				{episode.foldedOccurrences > 0
					? ` · ${t("settings.notify.history.folded", { count: episode.foldedOccurrences })}`
					: ""}
				{" · "}
				{episode.state === "open" || episode.resolvedAt === null
					? t("settings.notify.history.open")
					: t("settings.notify.history.resolved", {
							time: formatInstant(episode.resolvedAt),
						})}
			</p>
			{facts !== "" ? (
				<p className="break-words font-mono text-xs text-ink-muted">
					{t("settings.notify.history.facts", { facts })}
				</p>
			) : null}
		</li>
	);
}

function MessageRow({
	source,
	message,
	canResendHere,
	formatInstant,
}: {
	source: NotifySource;
	message: LogMessage;
	canResendHere: boolean;
	formatInstant: (iso: string) => string;
}) {
	const t = useT();
	const [confirming, setConfirming] = useState(false);
	const [done, setDone] = useState(false);
	const resend = useNotifyAction(source, (s, _tenant) => s.resend(message.id));
	const decision = decisionKey(message.decision);
	const resendable = canResend(message, canResendHere);
	return (
		<li
			className="grid gap-1 border-t border-line pt-2 text-sm sm:grid-cols-[10rem_9rem_10rem_1fr]"
			data-testid="notify-message"
			data-status={message.status}
		>
			<div className="font-medium">
				{t(MESSAGE_KIND_KEYS[message.kind])}
				<span className="block text-xs text-ink-muted">
					{t(kindKey(message.channel))}
				</span>
			</div>
			<div>
				{t(MESSAGE_STATUS_KEYS[message.status])}
				{decision !== null && message.status !== "sent" ? (
					<span className="block text-xs text-ink-muted">{t(decision)}</span>
				) : null}
				{message.status === "failed" && message.lastErrorCode !== null ? (
					<span className="block text-xs text-ink-muted">
						{(() => {
							const reason = reasonOf(message.lastErrorCode);
							return t(reason.key, reason.params);
						})()}
					</span>
				) : null}
				{message.resendOf !== null ? (
					<span className="block text-xs text-ink-muted">
						{t("settings.notify.log.resendOf")}
					</span>
				) : null}
			</div>
			<div>
				{t("settings.notify.log.created", {
					time: formatInstant(message.createdAt),
				})}
				{message.status === "held" && message.notBefore !== null ? (
					<span className="block">
						{t("settings.notify.log.until", {
							time: formatInstant(message.notBefore),
						})}
					</span>
				) : null}
				{message.sentAt !== null ? (
					<span className="block">
						{t("settings.notify.log.sent", {
							time: formatInstant(message.sentAt),
						})}
					</span>
				) : null}
			</div>
			<div className="min-w-0">
				{message.body !== null ? (
					<p className="whitespace-pre-line break-words">{message.body}</p>
				) : (
					<p className="text-ink-muted">
						{message.bodyVisible
							? t("settings.notify.log.bodyPurged")
							: t("settings.notify.log.bodyHidden")}
					</p>
				)}
				{resendable && !done ? (
					confirming ? (
						<div className="mt-2 space-y-2" data-testid="notify-resend-confirm">
							<p>{t("settings.notify.log.resendConfirm")}</p>
							<div className="flex flex-wrap gap-2">
								<Button
									size="compact"
									disabled={resend.pending}
									onClick={async () => {
										const id = await resend.run();
										if (id !== undefined) {
											setDone(true);
											setConfirming(false);
										}
									}}
									data-testid="notify-resend-yes"
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
							tone="secondary"
							size="compact"
							className="mt-2"
							onClick={() => setConfirming(true)}
							data-testid="notify-resend"
						>
							{t("settings.notify.action.resend")}
						</Button>
					)
				) : null}
				{done ? (
					<p aria-live="polite" className="mt-1" data-testid="notify-resent">
						{t("settings.notify.log.resent")}
					</p>
				) : null}
				<ErrorLine errorKey={resend.errorKey} />
			</div>
		</li>
	);
}

export function HistorySection({
	source,
	stores,
	unlimitedManager,
	formatInstant,
}: {
	source: NotifySource | null;
	stores: readonly StoreRow[];
	unlimitedManager: boolean;
	formatInstant: (iso: string) => string;
}) {
	const t = useT();
	const history = useAlertHistory(source);
	const log = useMessageLog(source);
	const episodes = history.data?.pages.flat() ?? null;
	const messages = log.data?.pages.flat() ?? null;
	const storeName = (id: string | null) =>
		id === null
			? null
			: (stores.find((store) => store.id === id)?.name ?? null);
	return (
		<>
			<NotifySection
				id="notify-history"
				titleKey="settings.notify.history.title"
				testId="notify-history"
			>
				{episodes === null ? (
					<LoadState
						failed={history.isError}
						onRetry={() => void history.refetch()}
						testId="notify-history-failed"
					/>
				) : episodes.length === 0 ? (
					<p className="text-sm">{t("settings.notify.history.empty")}</p>
				) : (
					<ul className="space-y-2">
						{episodes.map((episode) => (
							<EpisodeRow
								key={episode.id}
								episode={episode}
								storeName={storeName(episode.storeId)}
								formatInstant={formatInstant}
							/>
						))}
					</ul>
				)}
				{history.hasNextPage ? (
					<Button
						tone="secondary"
						size="compact"
						disabled={history.isFetchingNextPage}
						onClick={() => void history.fetchNextPage()}
					>
						{t("settings.notify.action.loadMore")}
					</Button>
				) : null}
			</NotifySection>
			<NotifySection
				id="notify-log"
				titleKey="settings.notify.log.title"
				testId="notify-log"
			>
				{messages === null || source === null ? (
					<LoadState
						failed={log.isError}
						onRetry={() => void log.refetch()}
						testId="notify-log-failed"
					/>
				) : messages.length === 0 ? (
					<p className="text-sm">{t("settings.notify.log.empty")}</p>
				) : (
					<ul className="space-y-2" data-testid="notify-log-list">
						{messages.map((message) => (
							<MessageRow
								key={message.id}
								source={source}
								message={message}
								canResendHere={unlimitedManager}
								formatInstant={formatInstant}
							/>
						))}
					</ul>
				)}
				{log.hasNextPage ? (
					<Button
						tone="secondary"
						size="compact"
						disabled={log.isFetchingNextPage}
						onClick={() => void log.fetchNextPage()}
					>
						{t("settings.notify.action.loadMore")}
					</Button>
				) : null}
			</NotifySection>
		</>
	);
}
