import type { Sql } from "../oa-webhook/database.ts";
import type { BotReply, BotTarget, BotWebhookStore } from "./handler.ts";

const UNIQUE_VIOLATION = "23505";

function isUniqueViolation(error: unknown): boolean {
	return (
		typeof error === "object" &&
		error !== null &&
		(error as { readonly code?: unknown }).code === UNIQUE_VIOLATION
	);
}

export class PostgresBotWebhookStore implements BotWebhookStore {
	private readonly sql: Sql;

	constructor(sql: Sql) {
		this.sql = sql;
	}

	async target(secretTokenSha256: string): Promise<BotTarget | null> {
		const rows = await this.sql<{ secret_name: string; kind: string }[]>`
			select t.secret_name, t.kind::text as kind
			from app.bot_webhook_target(${secretTokenSha256}::text) t
		`;
		const row = rows[0];
		return rows.length === 1 && row !== undefined && row.kind === "zalo_bot"
			? { secretName: row.secret_name, kind: "zalo_bot" }
			: null;
	}

	async completeLink(
		target: BotTarget,
		code: string,
		chatId: string,
		hint: string,
		at: Date,
	): Promise<string | null> {
		try {
			const [row] = await this.sql<{ channel_id: string | null }[]>`
				select app.complete_channel_link(
					${target.kind}::public.channel_kind,
					${target.secretName}::text,
					${code}::text,
					${chatId}::text,
					${hint}::text,
					${at.toISOString()}::timestamptz
				)::text as channel_id
			`;
			return row?.channel_id ?? null;
		} catch (error) {
			if (isUniqueViolation(error)) {
				return null;
			}
			throw error;
		}
	}

	async acceptLink(
		target: BotTarget,
		chatId: string,
		at: Date,
	): Promise<string | null> {
		const [row] = await this.sql<{ channel_id: string | null }[]>`
			select app.accept_channel_link(
				${target.kind}::public.channel_kind,
				${target.secretName}::text,
				${chatId}::text,
				${at.toISOString()}::timestamptz
			)::text as channel_id
		`;
		return row?.channel_id ?? null;
	}

	async stopChat(
		target: BotTarget,
		chatId: string,
		at: Date,
	): Promise<readonly string[]> {
		const rows = await this.sql<{ channel_id: string }[]>`
			select s.channel_id::text as channel_id
			from app.stop_bot_chat(
				${target.kind}::public.channel_kind,
				${target.secretName}::text,
				${chatId}::text,
				${at.toISOString()}::timestamptz
			) s
		`;
		return rows.map((row) => row.channel_id);
	}

	async recordReply(
		channelIds: readonly string[],
		reply: BotReply,
		at: Date,
	): Promise<number> {
		const [row] = await this.sql<{ logged: number }[]>`
			select app.record_bot_reply(
				string_to_array(${channelIds.join(",")}::text, ',')::uuid[],
				${reply.template}::text,
				${reply.status}::text,
				${reply.errorCode}::text,
				${reply.providerMessageId}::text,
				${at.toISOString()}::timestamptz
			) as logged
		`;
		return row?.logged ?? 0;
	}
}
