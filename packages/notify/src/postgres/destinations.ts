import type { Sql } from "postgres";
import type {
	ChannelKind,
	MessageKind,
	ProviderId,
} from "../channels/types.js";

export interface MemberRecord {
	readonly userId: string;
	readonly role: string;
	readonly storeIds: readonly string[] | null;
}

export async function findMemberByEmail(
	sql: Sql,
	tenantId: string,
	email: string,
): Promise<MemberRecord | null> {
	const [row] = await sql<
		{ user_id: string; role: string; store_ids: string[] | null }[]
	>`
		select m.user_id::text as user_id, m.role::text as role, m.store_ids::text[] as store_ids
		from public.tenant_members m
		join auth.users u on u.id = m.user_id
		where m.tenant_id = ${tenantId}::uuid
			and lower(u.email) = lower(${email.trim()})
	`;
	return row
		? { userId: row.user_id, role: row.role, storeIds: row.store_ids }
		: null;
}

export async function storeIdsByExternalId(
	sql: Sql,
	tenantId: string,
	externalIds: readonly string[],
): Promise<Map<string, string>> {
	const rows = await sql<{ id: string; external_id: string }[]>`
		select id::text as id, external_id
		from public.stores
		where tenant_id = ${tenantId}::uuid
			and external_id in (select jsonb_array_elements_text(${JSON.stringify([...externalIds])}::text::jsonb))
	`;
	return new Map(rows.map((row) => [row.external_id, row.id]));
}

export interface BotDestinationInput {
	readonly tenantId: string;
	readonly userId: string;
	readonly kind: ChannelKind;
	readonly provider: ProviderId;
	readonly label: string;
	readonly secretName: string;
	readonly timezone: string | null;
	readonly storeIds: readonly string[] | null;
	readonly config?: Readonly<Record<string, string>> | null;
	readonly addressHint?: string | null;
}

export interface PreparedDestination {
	readonly channelId: string;
	readonly previousStatus: string | null;
}

export async function prepareBotDestination(
	sql: Sql,
	input: BotDestinationInput,
): Promise<PreparedDestination> {
	const storeIds =
		input.storeIds === null ? null : JSON.stringify([...input.storeIds]);
	const config = JSON.stringify(input.config ?? {});
	const hint = input.addressHint ?? null;
	const [row] = await sql<{ id: string; previous_status: string | null }[]>`
		with existing as (
			select c.status
			from public.notification_channels c
			where c.tenant_id = ${input.tenantId}::uuid
				and c.user_id = ${input.userId}::uuid
				and c.kind = ${input.kind}::public.channel_kind
				and c.secret_name = ${input.secretName}
		)
		insert into public.notification_channels (tenant_id, kind, provider, label, user_id, secret_name, timezone, store_ids, status, config, address_hint)
		values (
			${input.tenantId}::uuid,
			${input.kind}::public.channel_kind,
			${input.provider},
			${input.label},
			${input.userId}::uuid,
			${input.secretName},
			${input.timezone},
			case when ${storeIds}::text::jsonb is null then null else array(select jsonb_array_elements_text(${storeIds}::text::jsonb)::uuid) end,
			'pending',
			${config}::text::jsonb,
			${hint}::text
		)
		on conflict (tenant_id, user_id, kind, secret_name) where user_id is not null
		do update set
			label = excluded.label,
			timezone = excluded.timezone,
			store_ids = excluded.store_ids,
			status = 'pending',
			enabled = true,
			provider = excluded.provider,
			config = excluded.config,
			address = null,
			address_hint = excluded.address_hint,
			linked_at = null,
			disabled_reason = null,
			consecutive_failures = 0,
			last_error_code = null,
			last_error_at = null
		returning id::text as id, (select e.status from existing e) as previous_status
	`;
	if (!row) {
		throw new Error("the destination insert returned no row");
	}
	return { channelId: row.id, previousStatus: row.previous_status };
}

export async function issueLinkCode(
	sql: Sql,
	channelId: string,
	purpose: "bot_link" | "email_confirm",
	at: Date,
): Promise<string> {
	const [row] = await sql<{ code: string | null }[]>`
		select app.issue_link_code(${channelId}::uuid, ${purpose}::text, ${at}::timestamptz) as code
	`;
	if (!row?.code) {
		throw new Error("issuing the link code returned nothing");
	}
	return row.code;
}

export async function saveBotName(
	sql: Sql,
	secretName: string,
	kind: ChannelKind,
	botName: string | null,
): Promise<void> {
	await sql`
		insert into app.bot_poll_state (secret_name, kind, bot_name)
		values (${secretName}, ${kind}::public.channel_kind, ${botName})
		on conflict (secret_name) do update set bot_name = coalesce(excluded.bot_name, app.bot_poll_state.bot_name)
	`;
}

export interface DestinationState {
	readonly status: string;
	readonly enabled: boolean;
	readonly hasAddress: boolean;
	readonly addressHint: string | null;
	readonly address: string | null;
	readonly linkedAt: Date | null;
	readonly consentRecordId: string | null;
}

export async function destinationState(
	sql: Sql,
	channelId: string,
): Promise<DestinationState | null> {
	const [row] = await sql<
		{
			status: string;
			enabled: boolean;
			address: string | null;
			address_hint: string | null;
			linked_at: Date | null;
			consent_record_id: string | null;
		}[]
	>`
		select status, enabled, address, address_hint, linked_at, consent_record_id::text as consent_record_id
		from public.notification_channels
		where id = ${channelId}::uuid
	`;
	return row
		? {
				status: row.status,
				enabled: row.enabled,
				hasAddress: row.address !== null,
				addressHint: row.address_hint,
				address: row.address,
				linkedAt: row.linked_at,
				consentRecordId: row.consent_record_id,
			}
		: null;
}

export interface NumberedDestination {
	readonly number: number;
	readonly id: string;
	readonly kind: ChannelKind;
	readonly provider: string;
	readonly label: string;
	readonly status: string;
	readonly enabled: boolean;
	readonly userId: string | null;
	readonly secretName: string;
	readonly lastOkAt: Date | null;
	readonly lastErrorCode: string | null;
	readonly consecutiveFailures: number;
}

export async function listDestinations(
	sql: Sql,
	tenantId: string,
): Promise<NumberedDestination[]> {
	const rows = await sql<
		{
			number: string;
			id: string;
			kind: ChannelKind;
			provider: string;
			label: string;
			status: string;
			enabled: boolean;
			user_id: string | null;
			secret_name: string;
			last_ok_at: Date | null;
			last_error_code: string | null;
			consecutive_failures: number;
		}[]
	>`
		select
			(row_number() over (order by c.created_at, c.id))::text as number,
			c.id::text as id,
			c.kind::text as kind,
			c.provider,
			c.label,
			c.status,
			c.enabled,
			c.user_id::text as user_id,
			c.secret_name,
			c.last_ok_at,
			c.last_error_code,
			c.consecutive_failures
		from public.notification_channels c
		where c.tenant_id = ${tenantId}::uuid
		order by c.created_at, c.id
	`;
	return rows.map((row) => ({
		number: Number(row.number),
		id: row.id,
		kind: row.kind,
		provider: row.provider,
		label: row.label,
		status: row.status,
		enabled: row.enabled,
		userId: row.user_id,
		secretName: row.secret_name,
		lastOkAt: row.last_ok_at,
		lastErrorCode: row.last_error_code,
		consecutiveFailures: Number(row.consecutive_failures),
	}));
}

export interface EnqueueInput {
	readonly tenantId: string;
	readonly channelId: string;
	readonly kind: MessageKind;
	readonly templateRef: string;
	readonly dedupeKey: string;
	readonly params?: Readonly<Record<string, string | number | boolean | null>>;
	readonly title?: string | null;
	readonly body?: string | null;
	readonly severity?: "info" | "warning" | "critical" | null;
	readonly storeId?: string | null;
	readonly businessDate?: string | null;
	readonly digestId?: string | null;
	readonly alertEventId?: string | null;
	readonly expiresAt: Date;
	readonly at: Date;
}

export async function enqueueMessage(
	sql: Sql,
	input: EnqueueInput,
): Promise<string> {
	const [row] = await sql<{ id: string | null }[]>`
		select app.enqueue_message(
			${input.tenantId}::uuid,
			${input.channelId}::uuid,
			${input.kind}::text,
			${input.templateRef}::text,
			${input.dedupeKey}::text,
			${JSON.stringify(input.params ?? {})}::text::jsonb,
			${input.title ?? null}::text,
			${input.body ?? null}::text,
			${input.severity ?? null}::public.alert_severity,
			${input.storeId ?? null}::uuid,
			${input.businessDate ?? null}::date,
			${input.digestId ?? null}::uuid,
			${input.alertEventId ?? null}::uuid,
			${input.expiresAt}::timestamptz,
			${input.at}::timestamptz
		)::text as id
	`;
	if (!row?.id) {
		throw new Error("enqueueing the message returned no id");
	}
	return row.id;
}

export type KickReason = "kick" | "continue";

export async function kickNotify(
	sql: Sql,
	reason: KickReason,
): Promise<boolean> {
	const [row] = await sql<{ kicked: boolean | null }[]>`
		select app.kick_notify(${reason}::text) as kicked
	`;
	return row?.kicked === true;
}

export interface MessageOutcome {
	readonly id: string;
	readonly status: string;
	readonly decision: string | null;
	readonly lastErrorCode: string | null;
	readonly channelId: string | null;
}

export async function messageOutcomes(
	sql: Sql,
	ids: readonly string[],
): Promise<MessageOutcome[]> {
	const rows = await sql<
		{
			id: string;
			status: string;
			decision: string | null;
			last_error_code: string | null;
			channel_id: string | null;
		}[]
	>`
		select id::text as id, status, decision, last_error_code, channel_id::text as channel_id
		from public.outbound_messages
		where id in (select jsonb_array_elements_text(${JSON.stringify([...ids])}::text::jsonb)::uuid)
	`;
	return rows.map((row) => ({
		id: row.id,
		status: row.status,
		decision: row.decision,
		lastErrorCode: row.last_error_code,
		channelId: row.channel_id,
	}));
}

export async function botName(
	sql: Sql,
	secretName: string,
): Promise<string | null> {
	const [row] = await sql<{ bot_name: string | null }[]>`
		select bot_name from app.bot_poll_state where secret_name = ${secretName}
	`;
	return row?.bot_name ?? null;
}
