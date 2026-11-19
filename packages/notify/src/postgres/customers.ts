import type { Sql } from "postgres";
import type {
	CustomerClaim,
	CustomerClaimRequest,
	CustomerFinishRequest,
	CustomerRepository,
	CustomerRoute,
} from "../customer/dispatch.js";
import {
	isCustomerMessageKind,
	isZbsTemplatePurpose,
} from "../customer/templates.js";
import { textArray } from "./statements.js";

interface CustomerClaimRow {
	message_id: string;
	claimed_at: string;
	tenant_id: string;
	kind: string;
	route: string;
	attempts: number;
	oa_id: string;
	window_kind: string | null;
	template_external_id: string | null;
	template_purpose: string | null;
	recipient_kind: string;
	recipient: string | null;
	parameters: unknown;
	reader_timezone: string;
}

function record(value: unknown): Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: {};
}

export function customerClaimFromRow(row: CustomerClaimRow): CustomerClaim {
	const route: CustomerRoute | null =
		row.route === "consultation" || row.route === "template" ? row.route : null;
	if (
		!isCustomerMessageKind(row.kind) ||
		route === null ||
		row.recipient === null ||
		(row.template_purpose !== null &&
			!isZbsTemplatePurpose(row.template_purpose))
	) {
		throw new Error(
			"the customer claim returned a kind, route, recipient or template purpose this dispatcher does not know",
		);
	}
	const purpose =
		row.template_purpose !== null && isZbsTemplatePurpose(row.template_purpose)
			? row.template_purpose
			: null;
	return {
		messageId: row.message_id,
		claimedAt: row.claimed_at,
		tenantId: row.tenant_id,
		kind: row.kind,
		route,
		attempts: Number(row.attempts),
		oaId: row.oa_id,
		window:
			row.window_kind === "free" || row.window_kind === "allowance"
				? row.window_kind
				: null,
		templateExternalId: row.template_external_id,
		templatePurpose: purpose,
		recipient:
			row.recipient_kind === "uid"
				? { kind: "uid", userId: row.recipient }
				: { kind: "phone", phone: row.recipient },
		parameters: record(row.parameters),
		readerTimezone: row.reader_timezone,
	};
}

export async function claimNextCustomerMessage(
	sql: Sql,
	request: CustomerClaimRequest,
): Promise<CustomerClaim | null> {
	const rows = await sql<CustomerClaimRow[]>`
		select
			c.message_id::text as message_id,
			c.claimed_at::text as claimed_at,
			c.tenant_id::text as tenant_id,
			c.kind,
			c.route,
			c.attempts::integer as attempts,
			c.oa_id::text as oa_id,
			c.window_kind,
			c.template_external_id,
			c.template_purpose,
			c.recipient_kind,
			c.recipient,
			c.parameters,
			c.reader_timezone
		from app.claim_next_customer_message(
			${request.worker}::text,
			array(select jsonb_array_elements_text(${textArray(request.routes)}::text::jsonb)),
			make_interval(secs => ${request.leaseSeconds}::double precision),
			${request.at}::timestamptz,
			${request.tenantId}::uuid
		) c
	`;
	const row = rows[0];
	return row ? customerClaimFromRow(row) : null;
}

export async function beginCustomerSend(
	sql: Sql,
	messageId: string,
	claimedAt: string,
	at: Date,
): Promise<boolean> {
	const [row] = await sql<{ ok: boolean }[]>`
		select app.begin_customer_send(${messageId}::uuid, ${claimedAt}::timestamptz, ${at}::timestamptz) as ok
	`;
	return row?.ok === true;
}

export async function finishCustomerSend(
	sql: Sql,
	request: CustomerFinishRequest,
): Promise<string> {
	const [row] = await sql<{ status: string }[]>`
		select app.finish_customer_send(
			${request.messageId}::uuid,
			${request.claimedAt}::timestamptz,
			${request.outcome}::text,
			${request.code}::text,
			${request.providerMessageId}::text,
			${request.retryAfterSeconds}::integer,
			${request.at}::timestamptz
		) as status
	`;
	return row?.status ?? "missing";
}

export async function oaAccessToken(
	sql: Sql,
	oaId: string,
	at: Date,
): Promise<string | null> {
	const [row] = await sql<{ token: string | null }[]>`
		select app.oa_access_token(${oaId}::uuid, ${at}::timestamptz) as token
	`;
	return row?.token ?? null;
}

export async function enqueueCustomerReminders(
	sql: Sql,
	at: Date,
	tenantId: string | null,
): Promise<Record<string, number>> {
	const [row] = await sql<{ counts: unknown }[]>`
		select app.enqueue_customer_reminders(${at}::timestamptz, ${tenantId}::uuid) as counts
	`;
	return Object.fromEntries(
		Object.entries(record(row?.counts)).flatMap(([key, value]) =>
			typeof value === "number" ? [[key, value]] : [],
		),
	);
}

export function createPostgresCustomerRepository(sql: Sql): CustomerRepository {
	return {
		enqueueReminders: (at, tenantId) =>
			enqueueCustomerReminders(sql, at, tenantId),
		claimNext: (request) => claimNextCustomerMessage(sql, request),
		beginSend: (messageId, claimedAt, at) =>
			beginCustomerSend(sql, messageId, claimedAt, at),
		finishSend: (request) => finishCustomerSend(sql, request),
		accessToken: (oaId, at) => oaAccessToken(sql, oaId, at),
	};
}
