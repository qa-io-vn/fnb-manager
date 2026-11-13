import type { Sql } from "postgres";
import {
	type ChannelKind,
	isChannelKind,
	isMessageKind,
	isProviderId,
} from "../channels/types.js";
import type {
	BeginSendResult,
	ClaimedMessage,
	ClaimRequest,
	FinishRequest,
	PendingLinkBot,
	TickSummary,
} from "../dispatch/repository.js";

export function textArray(values: readonly string[]): string {
	return JSON.stringify([...values]);
}

function record(value: unknown): Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: {};
}

interface ClaimRow {
	message_id: string;
	claimed_at: string;
	tenant_id: string;
	kind: string;
	template_ref: string | null;
	params: unknown;
	title: string | null;
	body: string | null;
	severity: string | null;
	attempts: number;
	business_date: string | null;
	channel_id: string;
	channel_kind: string;
	provider: string;
	secret_name: string;
	address: string | null;
	config: unknown;
	channel_label: string;
	reader_timezone: string;
	tenant_name: string;
	currency_code: string;
	store_name: string | null;
	account_name: string | null;
	rule_key: string | null;
}

function claimFromRow(row: ClaimRow): ClaimedMessage {
	if (
		!isMessageKind(row.kind) ||
		!isChannelKind(row.channel_kind) ||
		!isProviderId(row.provider)
	) {
		throw new Error(
			"claim returned a message kind, channel kind or provider this dispatcher does not know",
		);
	}
	const severity =
		row.severity === "info" ||
		row.severity === "warning" ||
		row.severity === "critical"
			? row.severity
			: null;
	return {
		messageId: row.message_id,
		claimedAt: row.claimed_at,
		tenantId: row.tenant_id,
		kind: row.kind,
		templateRef: row.template_ref,
		params: record(row.params),
		title: row.title,
		body: row.body,
		severity,
		attempts: Number(row.attempts),
		businessDate: row.business_date,
		channelId: row.channel_id,
		channelKind: row.channel_kind,
		provider: row.provider,
		secretName: row.secret_name,
		address: row.address,
		config: record(row.config),
		channelLabel: row.channel_label,
		readerTimezone: row.reader_timezone,
		tenantName: row.tenant_name,
		currencyCode: row.currency_code,
		storeName: row.store_name,
		accountName: row.account_name,
		ruleKey: row.rule_key,
	};
}

export async function notifyTick(
	sql: Sql,
	at: Date,
	post: boolean,
	tenantId: string | null,
): Promise<TickSummary> {
	const [row] = await sql<{ summary: unknown }[]>`
		select app.notify_tick(${at}::timestamptz, ${post}::boolean, ${tenantId}::uuid) as summary
	`;
	return record(row?.summary);
}

export async function claimNextMessage(
	sql: Sql,
	request: ClaimRequest,
): Promise<ClaimedMessage | null> {
	const rows = await sql<ClaimRow[]>`
		select
			c.message_id::text as message_id,
			c.claimed_at::text as claimed_at,
			c.tenant_id::text as tenant_id,
			c.kind,
			c.template_ref,
			c.params,
			c.title,
			c.body,
			c.severity::text as severity,
			c.attempts::integer as attempts,
			c.business_date::text as business_date,
			c.channel_id::text as channel_id,
			c.channel_kind::text as channel_kind,
			c.provider,
			c.secret_name,
			c.address,
			c.config,
			c.channel_label,
			c.reader_timezone,
			c.tenant_name,
			c.currency_code,
			c.store_name,
			c.account_name,
			c.rule_key
		from app.claim_next_message(
			${request.worker}::text,
			array(select jsonb_array_elements_text(${textArray(request.secretNames)}::text::jsonb)),
			make_interval(secs => ${request.leaseSeconds}::double precision),
			${request.at}::timestamptz,
			${request.tenantId}::uuid
		) c
	`;
	const row = rows[0];
	return row ? claimFromRow(row) : null;
}

export async function beginSend(
	sql: Sql,
	messageId: string,
	claimedAt: string,
	title: string | null,
	body: string,
	bodySha256: string,
	at: Date,
): Promise<BeginSendResult> {
	const [row] = await sql<
		{ ok: boolean | null; title: string | null; body: string | null }[]
	>`
		select b.ok, b.title, b.body
		from app.begin_send(
			${messageId}::uuid,
			${claimedAt}::timestamptz,
			${title}::text,
			${body}::text,
			${bodySha256}::text,
			${at}::timestamptz
		) b
	`;
	return {
		ok: row?.ok === true,
		title: row?.title ?? null,
		body: row?.body ?? null,
	};
}

export async function finishSend(
	sql: Sql,
	request: FinishRequest,
): Promise<string> {
	const [row] = await sql<{ status: string | null }[]>`
		select app.finish_send(
			${request.messageId}::uuid,
			${request.claimedAt}::timestamptz,
			${request.outcome}::text,
			${request.scope}::text,
			${request.code}::text,
			${request.providerMessageId}::text,
			${request.retryAfterSeconds}::integer,
			${request.idempotent}::boolean,
			${request.at}::timestamptz
		) as status
	`;
	return row?.status ?? "unknown";
}

export async function recordDispatch(
	sql: Sql,
	at: Date,
	runtime: "edge" | "cli",
	secretNames: readonly string[],
	counts: Readonly<Record<string, number>>,
): Promise<void> {
	await sql`
		select app.record_dispatch(
			${at}::timestamptz,
			${runtime}::text,
			array(select jsonb_array_elements_text(${textArray(secretNames)}::text::jsonb)),
			${JSON.stringify(counts)}::text::jsonb
		)
	`;
}

export async function pendingLinkBots(
	sql: Sql,
	at: Date,
	tenantId: string | null,
): Promise<PendingLinkBot[]> {
	const rows = await sql<{ secret_name: string; kind: string }[]>`
		select distinct c.secret_name, c.kind::text as kind
		from app.notification_link_codes l
		join public.notification_channels c on c.id = l.channel_id
		where l.purpose in ('bot_link', 'bot_consent')
			and l.expires_at > ${at}::timestamptz
			and c.kind in ('zalo_bot', 'telegram')
			and (${tenantId}::uuid is null or c.tenant_id = ${tenantId}::uuid)
		order by c.secret_name
	`;
	return rows.flatMap((row) =>
		isChannelKind(row.kind)
			? [{ secretName: row.secret_name, kind: row.kind }]
			: [],
	);
}

export async function takePollLease(
	sql: Sql,
	secretName: string,
	kind: ChannelKind,
	worker: string,
	leaseSeconds: number,
	at: Date,
): Promise<boolean> {
	const [row] = await sql<{ taken: boolean | null }[]>`
		select app.take_poll_lease(
			${secretName}::text,
			${kind}::public.channel_kind,
			${worker}::text,
			make_interval(secs => ${leaseSeconds}::double precision),
			${at}::timestamptz
		) as taken
	`;
	return row?.taken === true;
}

export async function releasePollLease(
	sql: Sql,
	secretName: string,
	worker: string,
): Promise<void> {
	await sql`select app.release_poll_lease(${secretName}::text, ${worker}::text)`;
}

export async function pollCursor(
	sql: Sql,
	secretName: string,
): Promise<number | null> {
	const [row] = await sql<{ cursor: string | null }[]>`
		select last_update_id::text as cursor from app.bot_poll_state where secret_name = ${secretName}
	`;
	return row?.cursor === null || row?.cursor === undefined
		? null
		: Number(row.cursor);
}

export async function savePollState(
	sql: Sql,
	secretName: string,
	worker: string,
	cursor: number | null,
	at: Date,
): Promise<void> {
	await sql`
		update app.bot_poll_state
		set last_update_id = coalesce(${cursor === null ? null : String(cursor)}::bigint, last_update_id),
			polled_at = ${at}::timestamptz
		where secret_name = ${secretName}
			and (poller is null or poller = ${worker})
	`;
}

export async function completeChannelLink(
	sql: Sql,
	kind: ChannelKind,
	secretName: string,
	code: string,
	address: string,
	addressHint: string,
	at: Date,
): Promise<string | null> {
	const [row] = await sql<{ id: string | null }[]>`
		select app.complete_channel_link(
			${kind}::public.channel_kind,
			${secretName}::text,
			${code}::text,
			${address}::text,
			${addressHint}::text,
			${at}::timestamptz
		)::text as id
	`;
	return row?.id ?? null;
}

export async function acceptChannelLink(
	sql: Sql,
	kind: ChannelKind,
	secretName: string,
	address: string,
	at: Date,
): Promise<string | null> {
	const [row] = await sql<{ id: string | null }[]>`
		select app.accept_channel_link(
			${kind}::public.channel_kind,
			${secretName}::text,
			${address}::text,
			${at}::timestamptz
		)::text as id
	`;
	return row?.id ?? null;
}
