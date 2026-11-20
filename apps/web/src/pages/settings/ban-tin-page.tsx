import { TextLink } from "../../components/ui/text-link";
import { type MessageKey, useT } from "../../i18n";
import { LoadState, Note } from "../../settings/notify/common";
import { useInstantFormatter } from "../../settings/notify/format";
import {
	useDigestRecords,
	useNotifyOverview,
	useNotifySource,
} from "../../settings/notify/queries";
import type {
	DigestDelivery,
	DigestRecord,
} from "../../settings/notify/source";
import { kindKey, MESSAGE_STATUS_KEYS } from "../../settings/notify/words";
import { useRetrySettingsSource } from "../../settings/settings-source-context";
import { useFormatters } from "../../state/formatters";
import { useReadyTenantScope } from "../../state/tenant-scope";

const STATE_KEYS: Readonly<Record<string, MessageKey>> = {
	verified: "settings.digest.state.verified",
	unverified: "settings.digest.state.unverified",
	unmatched: "settings.digest.state.unmatched",
	partial: "settings.digest.state.partial",
	no_data: "settings.digest.state.no_data",
};

export function dayReportPath(digest: DigestRecord): string {
	const params = new URLSearchParams({ date: digest.businessDate });
	if (!digest.allStores && digest.storeIds.length === 1) {
		params.set("store", digest.storeIds[0] as string);
	}
	return `/bao-cao/ngay?${params.toString()}`;
}

export function digestText(digest: DigestRecord): {
	text: string | null;
	correction: string | null;
} {
	const first = digest.deliveries.find(
		(row) => row.kind === "digest" && row.body !== null,
	);
	const correction = digest.deliveries.find(
		(row) => row.kind === "digest_correction" && row.body !== null,
	);
	return { text: first?.body ?? null, correction: correction?.body ?? null };
}

function DeliveryLine({
	delivery,
	label,
	formatInstant,
}: {
	delivery: DigestDelivery;
	label: string;
	formatInstant: (iso: string) => string;
}) {
	const t = useT();
	const status = t(MESSAGE_STATUS_KEYS[delivery.status]);
	return (
		<li data-testid="digest-delivery" data-status={delivery.status}>
			{delivery.sentAt === null
				? t("settings.digest.delivery", { destination: label, status })
				: t("settings.digest.deliveryAt", {
						destination: label,
						status,
						time: formatInstant(delivery.sentAt),
					})}
		</li>
	);
}

function DigestCard({
	digest,
	storeNames,
	destinationLabel,
	formatInstant,
}: {
	digest: DigestRecord;
	storeNames: (ids: readonly string[]) => string;
	destinationLabel: (id: string | null) => string;
	formatInstant: (iso: string) => string;
}) {
	const t = useT();
	const { tenant } = useReadyTenantScope();
	const formatters = useFormatters(tenant);
	const { text, correction } = digestText(digest);
	const corrected =
		digest.revision > 0 ||
		digest.deliveries.some((row) => row.kind === "digest_correction");
	return (
		<li
			className="min-w-0 space-y-2 rounded-xl border border-line bg-surface-raised p-4"
			data-testid="digest-card"
			data-date={digest.businessDate}
		>
			<h3 className="text-lg font-semibold">
				{t("settings.digest.date", {
					date: formatters.date(digest.businessDate),
				})}
			</h3>
			<p className="text-sm text-ink-muted">
				{t("settings.digest.stores", {
					stores: digest.allStores
						? t("settings.digest.allStores")
						: storeNames(digest.storeIds),
				})}
				{" · "}
				{t("settings.digest.dataState", {
					state: t(
						(digest.dataState === null
							? undefined
							: STATE_KEYS[digest.dataState]) ?? "settings.digest.state.other",
					),
				})}
			</p>
			{digest.net !== null && digest.invoices !== null ? (
				<p className="font-medium" data-testid="digest-headline">
					{t("settings.digest.headline", {
						net: formatters.moneyExact(digest.net),
						invoices: formatters.count(digest.invoices),
					})}
				</p>
			) : null}
			{corrected ? (
				<p className="text-sm" data-testid="digest-corrected">
					{t("settings.digest.corrected")}
				</p>
			) : null}
			<div className="space-y-1">
				<h4 className="text-sm font-semibold">{t("settings.digest.text")}</h4>
				{text === null ? (
					<p className="text-sm text-ink-muted">
						{t("settings.digest.textHidden")}
					</p>
				) : (
					<pre
						className="whitespace-pre-wrap break-words rounded-lg bg-surface-sunken p-3 font-sans text-sm"
						data-testid="digest-text"
					>
						{text}
					</pre>
				)}
				{correction !== null ? (
					<div className="space-y-1">
						<h4 className="text-sm font-semibold">
							{t("settings.digest.correctionText")}
						</h4>
						<pre
							className="whitespace-pre-wrap break-words rounded-lg bg-surface-sunken p-3 font-sans text-sm"
							data-testid="digest-correction-text"
						>
							{correction}
						</pre>
					</div>
				) : null}
			</div>
			<div className="space-y-1">
				<h4 className="text-sm font-semibold">
					{t("settings.digest.deliveries")}
				</h4>
				{digest.deliveries.length === 0 ? (
					<p className="text-sm text-ink-muted">
						{t("settings.digest.noDelivery")}
					</p>
				) : (
					<ul className="space-y-1 text-sm">
						{digest.deliveries.map((delivery) => (
							<DeliveryLine
								key={delivery.messageId}
								delivery={delivery}
								label={destinationLabel(delivery.channelId)}
								formatInstant={formatInstant}
							/>
						))}
					</ul>
				)}
			</div>
			<TextLink
				to={dayReportPath(digest)}
				aria-label={t("settings.digest.openDayLabel", {
					date: formatters.date(digest.businessDate),
				})}
				data-testid="digest-open-day"
			>
				{t("settings.digest.openDay")}
			</TextLink>
		</li>
	);
}

function BanTinBody() {
	const t = useT();
	const { tenant, stores } = useReadyTenantScope();
	const { source, failed } = useNotifySource();
	const retrySource = useRetrySettingsSource();
	const digests = useDigestRecords(source);
	const overview = useNotifyOverview(source);
	const formatInstant = useInstantFormatter(tenant.timeZone);
	const storeNames = (ids: readonly string[]) =>
		ids
			.map((id) => stores.find((store) => store.id === id)?.name)
			.filter((name): name is string => name !== undefined)
			.join(", ");
	const destinationLabel = (id: string | null) => {
		const found = overview.data?.destinations.find((row) => row.id === id);
		return found === undefined
			? t("settings.digest.destinationGone")
			: `${found.label} (${t(kindKey(found.kind))})`;
	};
	return (
		<div className="min-w-0 space-y-4" data-testid="ban-tin-page">
			<p className="text-sm text-ink-muted">{t("settings.digest.intro")}</p>
			{source?.kind === "demo" ? (
				<Note testId="digest-demo">{t("settings.notify.demo")}</Note>
			) : null}
			{digests.data === undefined ? (
				<LoadState
					failed={failed || digests.isError}
					onRetry={() => {
						if (failed) retrySource();
						void digests.refetch();
					}}
					testId="digest-failed"
				/>
			) : digests.data.length === 0 ? (
				<div className="space-y-2" data-testid="digest-empty">
					<p className="text-sm">{t("settings.digest.empty")}</p>
					<TextLink to="/cai-dat/canh-bao">
						{t("settings.digest.emptyLink")}
					</TextLink>
				</div>
			) : (
				<ul className="space-y-4">
					{digests.data.map((digest) => (
						<DigestCard
							key={digest.id}
							digest={digest}
							storeNames={storeNames}
							destinationLabel={destinationLabel}
							formatInstant={formatInstant}
						/>
					))}
				</ul>
			)}
		</div>
	);
}

export default function BanTinPage() {
	const { tenant } = useReadyTenantScope();
	return <BanTinBody key={tenant.id} />;
}
