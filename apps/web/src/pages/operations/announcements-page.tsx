import { useId, useState } from "react";
import { Button } from "../../components/ui/button";
import { cn } from "../../components/ui/cn";
import { type MessageKey, type Translate, useT } from "../../i18n";
import { todayIn } from "../../lib/business-dates";
import type { Formatters } from "../../lib/format";
import {
	AnnouncementCompose,
	PIN_ISSUE_KEYS,
} from "../../operations/announcement-compose";
import {
	ANNOUNCEMENTS_PAGE_SIZE,
	announcementsInScope,
	canManageAnnouncement,
	defaultPinDate,
	isExpired,
	pinBounds,
	pinIssue,
	pinUntilOf,
	publishableStores,
	sendsToEveryStore,
	splitReaders,
	storesLabelOf,
} from "../../operations/announcements";
import type {
	Announcement,
	AnnouncementReader,
	AnnouncementRole,
} from "../../operations/announcements-source";
import { actorName, moment } from "../../operations/labels";
import { LoadFailed, PlainCard } from "../../operations/operations-ui";
import {
	useActors,
	useAnnouncementReaders,
	useAnnouncementReadRate,
	useAnnouncements,
} from "../../operations/queries";
import type { Actors } from "../../operations/source";
import { useOperationsAction } from "../../operations/use-operations-action";
import type { OperationsLocation } from "../../operations/use-operations-location";
import { DateField } from "../../settings/forms/date-field";
import { UNAVAILABLE_CLASS } from "../../settings/forms/save-bar";
import { useMembership } from "../../settings/queries";
import type { Membership, SettingsWriteCode } from "../../settings/source";
import { WRITE_ERROR_KEYS } from "../../settings/use-settings-mutation";
import { useFormatters } from "../../state/formatters";
import { useReadyTenantScope } from "../../state/tenant-scope";
import { OperationsLayout } from "./operations-layout";

type StoreName = { readonly id: string; readonly name: string };

const ROLE_KEYS: Readonly<Record<AnnouncementRole, MessageKey>> = {
	owner: "operations.actor.owner",
	manager: "operations.actor.manager",
	staff: "operations.actor.staff",
};

interface PinArgs {
	readonly announcementId: string;
	readonly pinnedUntil: string | null;
}

function pinErrorKey(code: SettingsWriteCode): MessageKey {
	return code === "forbidden"
		? "operations.announcements.pin.forbidden"
		: WRITE_ERROR_KEYS[code];
}

function storesText(
	t: Translate,
	stores: readonly StoreName[],
	storeIds: readonly string[] | null,
): string {
	const label = storesLabelOf(stores, storeIds);
	if (label.every) return t("operations.announcements.item.everyStore");
	const parts = [...label.names];
	if (label.others > 0) {
		parts.push(
			t("operations.announcements.item.otherStores", { count: label.others }),
		);
	}
	return parts.join(", ");
}

function ReadRate({ announcementId }: { readonly announcementId: string }) {
	const t = useT();
	const { tenant } = useReadyTenantScope();
	const formatters = useFormatters(tenant);
	const rate = useAnnouncementReadRate(announcementId);
	if (rate.status === "error") {
		return (
			<div role="alert" className="space-y-2" data-testid="announcement-rate">
				<p className="text-sm">{t("operations.announcements.rate.failed")}</p>
				<Button
					tone="secondary"
					size="compact"
					onClick={() => void rate.refetch()}
				>
					{t("app.retry")}
				</Button>
			</div>
		);
	}
	if (rate.data === undefined) {
		return (
			<p
				role="status"
				className="text-sm text-ink-muted"
				data-testid="announcement-rate"
			>
				{t("operations.announcements.rate.loading")}
			</p>
		);
	}
	const value = rate.data;
	if (value === null || value.recipients === 0) {
		return (
			<p className="text-sm" data-testid="announcement-rate" data-readers="0">
				{t("operations.announcements.rate.none")}
			</p>
		);
	}
	const share = value.readRate ?? value.readers / value.recipients;
	const dayShare =
		value.readRate24h ?? value.readersWithin24h / value.recipients;
	return (
		<div
			className="space-y-1"
			data-testid="announcement-rate"
			data-readers={value.readers}
			data-recipients={value.recipients}
		>
			<p className="text-sm">
				<span className="font-medium">
					{t("operations.announcements.rate.label")}
				</span>
				{": "}
				<span data-testid="announcement-rate-value">
					{t("operations.announcements.rate.value", {
						readers: formatters.count(value.readers),
						recipients: formatters.count(value.recipients),
						rate: formatters.percent(share),
					})}
				</span>
			</p>
			<div
				aria-hidden="true"
				className="h-2 w-full max-w-sm overflow-hidden rounded-full bg-surface-sunken"
			>
				<div
					className="h-2 rounded-full bg-accent"
					style={{ width: `${Math.min(100, Math.max(0, share * 100))}%` }}
				/>
			</div>
			<p className="text-xs text-ink-muted" data-testid="announcement-rate-day">
				{t("operations.announcements.rate.day", {
					readers: formatters.count(value.readersWithin24h),
					recipients: formatters.count(value.recipients),
					rate: formatters.percent(dayShare),
				})}
			</p>
		</div>
	);
}

function ReaderLine({
	reader,
	formatters,
	timeZone,
}: {
	readonly reader: AnnouncementReader;
	readonly formatters: Formatters;
	readonly timeZone: string;
}) {
	const t = useT();
	const parts = [
		reader.displayName ?? t("operations.announcements.readers.unnamed"),
		t(ROLE_KEYS[reader.role]),
		reader.member ? null : t("operations.announcements.readers.left"),
		reader.readAt === null
			? null
			: t("operations.announcements.readers.readAt", {
					time: moment(formatters, reader.readAt, timeZone) ?? "",
				}),
	].filter((part) => part !== null);
	return (
		<li className="break-words text-sm" data-testid="announcement-reader">
			{parts.join(" · ")}
		</li>
	);
}

function Readers({
	announcement,
	open,
}: {
	readonly announcement: Announcement;
	readonly open: boolean;
}) {
	const t = useT();
	const { tenant } = useReadyTenantScope();
	const formatters = useFormatters(tenant);
	const readers = useAnnouncementReaders(announcement.id, open);
	if (!open) return null;
	if (readers.status === "error") {
		return (
			<div role="alert" className="space-y-2">
				<p className="text-sm">
					{t("operations.announcements.readers.failed")}
				</p>
				<Button
					tone="secondary"
					size="compact"
					onClick={() => void readers.refetch()}
				>
					{t("app.retry")}
				</Button>
			</div>
		);
	}
	if (readers.data === undefined) {
		return (
			<p role="status" className="text-sm text-ink-muted">
				{t("operations.announcements.readers.loading")}
			</p>
		);
	}
	const { unread, read } = splitReaders(readers.data);
	const group = (
		key: MessageKey,
		people: readonly AnnouncementReader[],
		testId: string,
	) => (
		<div className="space-y-1" data-testid={testId}>
			<h4 className="text-sm font-medium">
				{t(key, { count: formatters.count(people.length) })}
			</h4>
			{people.length === 0 ? (
				<p className="text-sm text-ink-muted">
					{t("operations.announcements.readers.empty")}
				</p>
			) : (
				<ul className="list-disc space-y-1 ps-5">
					{people.map((reader) => (
						<ReaderLine
							key={reader.userId}
							reader={reader}
							formatters={formatters}
							timeZone={tenant.timeZone}
						/>
					))}
				</ul>
			)}
		</div>
	);
	return (
		<div className="grid gap-3 sm:grid-cols-2">
			{group(
				"operations.announcements.readers.unread",
				unread,
				"announcement-unread",
			)}
			{group(
				"operations.announcements.readers.read",
				read,
				"announcement-read",
			)}
		</div>
	);
}

function PinControls({
	announcement,
	busy,
	onPin,
}: {
	readonly announcement: Announcement;
	readonly busy: boolean;
	readonly onPin: (pinnedUntil: string | null) => void;
}) {
	const t = useT();
	const ids = useId();
	const { tenant } = useReadyTenantScope();
	const formatters = useFormatters(tenant);
	const today = todayIn(tenant.timeZone, new Date());
	const bounds = pinBounds(today);
	const [date, setDate] = useState(() => defaultPinDate(today));
	const label = { title: announcement.title };
	if (announcement.pinned) {
		return (
			<Button
				tone="secondary"
				size="compact"
				aria-label={t("operations.announcements.pin.unpinLabel", label)}
				aria-disabled={busy || undefined}
				onClick={busy ? undefined : () => onPin(null)}
				className={UNAVAILABLE_CLASS}
				data-testid="announcement-unpin"
			>
				{t("operations.announcements.pin.unpin")}
			</Button>
		);
	}
	const issue = pinIssue(date, today, tenant.timeZone, {
		required: true,
		expiresAt: announcement.expiresAt,
	});
	return (
		<div className="flex flex-wrap items-end gap-2">
			<DateField
				id={`${ids}-pin`}
				label={t("operations.announcements.pin.dateLabel")}
				error={
					issue === null
						? null
						: t(PIN_ISSUE_KEYS[issue], {
								min: formatters.date(bounds.min),
								max: formatters.date(bounds.max),
							})
				}
				value={date}
				onChange={setDate}
				today={today}
				bounds={bounds}
				className="w-full max-w-56"
				testId="announcement-pin-until"
			/>
			<Button
				size="compact"
				aria-label={t("operations.announcements.pin.pinLabel", label)}
				aria-disabled={busy || issue !== null || undefined}
				onClick={
					busy || issue !== null
						? undefined
						: () => onPin(pinUntilOf(date, tenant.timeZone))
				}
				className={UNAVAILABLE_CLASS}
				data-testid="announcement-pin"
			>
				{t("operations.announcements.pin.pin")}
			</Button>
		</div>
	);
}

function AnnouncementItem({
	announcement,
	stores,
	actors,
	member,
	busy,
	onPin,
}: {
	readonly announcement: Announcement;
	readonly stores: readonly StoreName[];
	readonly actors: Actors | undefined;
	readonly member: Membership | null | undefined;
	readonly busy: boolean;
	readonly onPin: (pinnedUntil: string | null) => void;
}) {
	const t = useT();
	const ids = useId();
	const { tenant } = useReadyTenantScope();
	const formatters = useFormatters(tenant);
	const [open, setOpen] = useState(false);
	const expired = isExpired(announcement, Date.now());
	const manages = canManageAnnouncement(member, announcement.storeIds);
	const at = (instant: string | null) =>
		moment(formatters, instant, tenant.timeZone) ?? "";
	return (
		<li
			className="min-w-0 space-y-2 py-4"
			data-testid="announcement"
			data-id={announcement.id}
			data-pinned={announcement.pinned ? "true" : "false"}
			data-expired={expired ? "true" : "false"}
		>
			<h3
				className="break-words font-semibold"
				data-testid="announcement-title"
			>
				{announcement.title}
			</h3>
			<div className="flex flex-wrap gap-2 text-xs">
				{announcement.pinned ? (
					<span
						className="rounded-full bg-accent px-2 py-0.5 font-medium text-accent-ink"
						data-testid="announcement-pinned"
					>
						{t("operations.announcements.item.pinned", {
							time: at(announcement.pinnedUntil),
						})}
					</span>
				) : null}
				{announcement.expiresAt === null ? null : (
					<span
						className="rounded-full border border-line px-2 py-0.5"
						data-testid="announcement-expiry"
					>
						{t(
							expired
								? "operations.announcements.item.expired"
								: "operations.announcements.item.expires",
							{ time: at(announcement.expiresAt) },
						)}
					</span>
				)}
			</div>
			<p className="text-sm text-ink-muted">
				{t("operations.announcements.item.published", {
					time: at(announcement.publishedAt),
					author:
						actorName(t, actors, announcement.publishedBy) ??
						t("operations.actor.unknown"),
				})}
			</p>
			<p className="text-sm text-ink-muted" data-testid="announcement-stores">
				{t("operations.announcements.item.stores", {
					stores: storesText(t, stores, announcement.storeIds),
				})}
				{" · "}
				{t("operations.announcements.item.audience", {
					roles: announcement.audience
						.map((role) => t(ROLE_KEYS[role]))
						.join(", "),
				})}
			</p>
			<p
				className="whitespace-pre-line break-words"
				data-testid="announcement-text"
			>
				{announcement.body}
			</p>
			<ReadRate announcementId={announcement.id} />
			<div className="flex flex-wrap items-end gap-2">
				<Button
					tone="secondary"
					size="compact"
					aria-expanded={open}
					aria-controls={`${ids}-readers`}
					aria-label={
						open
							? undefined
							: t("operations.announcements.readers.showLabel", {
									title: announcement.title,
								})
					}
					onClick={() => setOpen(!open)}
					data-testid="announcement-readers-toggle"
				>
					{open
						? t("operations.announcements.readers.hide")
						: t("operations.announcements.readers.show")}
				</Button>
				{expired ? null : manages ? (
					<PinControls announcement={announcement} busy={busy} onPin={onPin} />
				) : null}
			</div>
			{!expired && !manages ? (
				<p
					className="text-sm text-ink-muted"
					data-testid="announcement-not-managed"
				>
					{t("operations.announcements.pin.notManaged")}
				</p>
			) : null}
			<div id={`${ids}-readers`} data-testid="announcement-readers">
				<Readers announcement={announcement} open={open} />
			</div>
		</li>
	);
}

function AnnouncementList({
	announcements,
	stores,
	actors,
	member,
}: {
	readonly announcements: readonly Announcement[];
	readonly stores: readonly StoreName[];
	readonly actors: Actors | undefined;
	readonly member: Membership | null | undefined;
}) {
	const t = useT();
	const ids = useId();
	const { tenant } = useReadyTenantScope();
	const formatters = useFormatters(tenant);
	const [shown, setShown] = useState(ANNOUNCEMENTS_PAGE_SIZE);
	const [last, setLast] = useState<"pin" | "unpin" | null>(null);
	const action = useOperationsAction<PinArgs>((source, args) =>
		source.setAnnouncementPin(args.announcementId, args.pinnedUntil),
	);
	const pinnedCount = announcements.filter((item) => item.pinned).length;
	const status =
		last === null
			? null
			: action.running
				? { tone: "text-ink-muted", text: t("settings.saving") }
				: action.errorCode !== null
					? { tone: "text-negative", text: t(pinErrorKey(action.errorCode)) }
					: action.done
						? {
								tone: "text-positive",
								text: t(
									last === "pin"
										? "operations.announcements.pin.pinned"
										: "operations.announcements.pin.unpinned",
								),
							}
						: null;
	return (
		<section
			aria-labelledby={`${ids}-heading`}
			className="min-w-0 space-y-2 rounded-xl border border-line bg-surface-raised p-4"
			data-testid="announcement-list"
		>
			<h2 id={`${ids}-heading`} className="text-base font-semibold">
				{t("operations.announcements.list.title")}
			</h2>
			{announcements.length === 0 ? (
				<p className="text-sm" data-testid="announcement-none">
					{t("operations.announcements.list.none")}
				</p>
			) : (
				<p className="text-sm" data-testid="announcement-summary">
					{t("operations.announcements.list.summary", {
						total: formatters.count(announcements.length),
						pinned: formatters.count(pinnedCount),
					})}
				</p>
			)}
			{member?.storeIds == null ? null : (
				<p
					role="note"
					className="rounded-lg border border-line bg-surface-sunken px-3 py-2 text-sm"
					data-testid="announcement-scope-note"
				>
					{t("operations.announcements.list.scopeNote")}
				</p>
			)}
			<div className="flex flex-wrap items-center gap-2">
				<p
					role="status"
					className={cn("text-sm", status?.tone ?? null)}
					data-testid="announcement-pin-status"
				>
					{status?.text ?? ""}
				</p>
				{action.canRetry ? (
					<Button
						tone="secondary"
						size="compact"
						onClick={() => void action.retry()}
						data-testid="announcement-pin-retry"
					>
						{t("app.retry")}
					</Button>
				) : null}
			</div>
			{announcements.length === 0 ? null : (
				<ul className="divide-y divide-line">
					{announcements.slice(0, shown).map((announcement) => (
						<AnnouncementItem
							key={announcement.id}
							announcement={announcement}
							stores={stores}
							actors={actors}
							member={member}
							busy={action.running}
							onPin={(pinnedUntil) => {
								setLast(pinnedUntil === null ? "unpin" : "pin");
								void action.run({
									announcementId: announcement.id,
									pinnedUntil,
								});
							}}
						/>
					))}
				</ul>
			)}
			{announcements.length > shown ? (
				<Button
					tone="secondary"
					size="compact"
					onClick={() => setShown(shown + ANNOUNCEMENTS_PAGE_SIZE)}
					data-testid="announcement-more"
				>
					{t("operations.announcements.list.more")}
				</Button>
			) : null}
		</section>
	);
}

function AnnouncementsBody({
	location,
}: {
	readonly location: OperationsLocation;
}) {
	const t = useT();
	const scope = useReadyTenantScope();
	const membership = useMembership();
	const member = membership.status === "success" ? membership.data : undefined;
	const feed = useAnnouncements();
	const actors = useActors();
	const publishable = publishableStores(scope.stores, member);
	const everyAllowed = sendsToEveryStore(member);
	const title = t("operations.announcements.list.title");
	return (
		<div className="space-y-4">
			{everyAllowed || publishable.length > 0 ? (
				<AnnouncementCompose
					key={publishable.map((store) => store.id).join(",")}
					stores={publishable}
					everyAllowed={everyAllowed}
				/>
			) : null}
			{feed.status === "error" ? (
				<PlainCard title={title} testId="announcement-list" state="error">
					<LoadFailed onRetry={() => void feed.refetch()} />
				</PlainCard>
			) : feed.data === undefined ? (
				<PlainCard title={title} testId="announcement-list" state="loading">
					<p role="status" className="text-sm text-ink-muted">
						{t("app.loading")}
					</p>
				</PlainCard>
			) : (
				<AnnouncementList
					announcements={announcementsInScope(
						feed.data,
						scope.tenant.id,
						location.stores.map((store) => store.id),
					)}
					stores={scope.stores}
					actors={actors.data}
					member={member}
				/>
			)}
		</div>
	);
}

export function AnnouncementsPage() {
	return (
		<OperationsLayout
			page="thong-bao"
			ranged={false}
			introKey="operations.announcements.intro"
			demoKey="operations.announcements.demo"
		>
			{(location) => <AnnouncementsBody location={location} />}
		</OperationsLayout>
	);
}
