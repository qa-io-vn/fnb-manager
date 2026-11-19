import { type CustomerInput, inputParameter } from "@fnb/zalo/oa";
import {
	type CustomerStep,
	parseCustomerStep,
	type ReplyRecord,
} from "./customer.ts";
import type { Sql } from "./database.ts";
import type {
	OaTarget,
	OaWebhookStore,
	ReceivedEvent,
	Reception,
	WebhookMode,
} from "./handler.ts";

function webhookMode(value: string): WebhookMode {
	return value === "enforce" ? "enforce" : "observe";
}

function receptionOutcome(value: string): Reception["outcome"] {
	if (value === "recorded" || value === "duplicate" || value === "refused") {
		return value;
	}
	throw new Error("app.receive_oa_event answered an unknown outcome");
}

export class PostgresOaWebhookStore implements OaWebhookStore {
	private readonly sql: Sql;

	constructor(sql: Sql) {
		this.sql = sql;
	}

	async targets(appId: string, oaId: string): Promise<readonly OaTarget[]> {
		const rows = await this.sql<
			{
				oa_id: string;
				tenant_id: string;
				secret_name: string;
				webhook_mode: string;
			}[]
		>`
			select t.oa_id::text as oa_id, t.tenant_id::text as tenant_id, t.secret_name, t.webhook_mode
			from app.oa_webhook_target(${appId}::text, ${oaId}::text) t
		`;
		return rows.map((row) => ({
			oaId: row.oa_id,
			tenantId: row.tenant_id,
			secretName: row.secret_name,
			webhookMode: webhookMode(row.webhook_mode),
		}));
	}

	async receive(event: ReceivedEvent): Promise<Reception> {
		const [row] = await this.sql<
			{ outcome: string; event_row: string | null; unverified: number | null }[]
		>`
			select r.outcome, r.event_row::text as event_row, r.unverified
			from app.receive_oa_event(
				${event.oaId}::uuid,
				${event.eventId}::text,
				${event.eventName}::text,
				${event.oaUserId}::text,
				${event.occurredAt?.toISOString() ?? null}::timestamptz,
				${event.signature}::text,
				${event.receivedAt.toISOString()}::timestamptz
			) r
		`;
		if (row === undefined) {
			throw new Error("app.receive_oa_event answered no row");
		}
		return {
			outcome: receptionOutcome(row.outcome),
			eventRow: row.event_row,
			unverified: row.unverified,
		};
	}

	async apply(eventRow: string, at: Date): Promise<string> {
		const [row] = await this.sql<{ outcome: string }[]>`
			select app.apply_oa_event(${eventRow}::uuid, ${at.toISOString()}::timestamptz) as outcome
		`;
		return row?.outcome ?? "none";
	}

	async raiseAlert(
		oaId: string,
		unverified: number,
		at: Date,
	): Promise<string> {
		const [row] = await this.sql<{ outcome: string | null }[]>`
			select app.raise_oa_webhook_alert(${oaId}::uuid, ${unverified}::integer, ${at.toISOString()}::timestamptz) as outcome
		`;
		return row?.outcome ?? "none";
	}

	async customerStep(
		eventRow: string,
		input: CustomerInput,
		at: Date,
	): Promise<CustomerStep> {
		const [row] = await this.sql<{ answer: string | null }[]>`
			select app.oa_customer_step(
				${eventRow}::uuid,
				${JSON.stringify(inputParameter(input))}::text::jsonb,
				${at.toISOString()}::timestamptz
			)::text as answer
		`;
		if (row?.answer === undefined || row.answer === null) {
			throw new Error("app.oa_customer_step answered no row");
		}
		return parseCustomerStep(JSON.parse(row.answer));
	}

	async accessToken(oaId: string, at: Date): Promise<string | null> {
		const [row] = await this.sql<{ token: string | null }[]>`
			select app.oa_access_token(${oaId}::uuid, ${at.toISOString()}::timestamptz) as token
		`;
		return row?.token ?? null;
	}

	async recordReply(record: ReplyRecord): Promise<void> {
		await this.sql`
			select app.record_oa_reply(
				${record.oaUserRow}::uuid,
				${record.customerId}::uuid,
				${record.kind}::text,
				${record.status}::text,
				${record.errorCode}::text,
				${record.providerMessageId}::text,
				${record.at.toISOString()}::timestamptz
			)
		`;
	}
}
