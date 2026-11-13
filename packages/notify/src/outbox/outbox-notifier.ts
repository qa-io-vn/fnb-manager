import type { Notification, Notifier } from "@fnb/runner";
import type { Sql } from "postgres";

export type OutboxSource = "incremental" | "cli";

export interface RunnerNotificationOutcome {
	readonly eventId: string | null;
	readonly outcome: string;
	readonly messages: number;
}

export class OutboxNotifier implements Notifier {
	private readonly sql: () => Sql;
	private readonly source: OutboxSource;

	constructor(sql: () => Sql, source: OutboxSource) {
		this.sql = sql;
		this.source = source;
	}

	async notify(notification: Notification): Promise<void> {
		await this.record(notification);
	}

	async record(
		notification: Notification,
	): Promise<RunnerNotificationOutcome[]> {
		const { subject } = notification;
		const rows = await this.sql()<
			{ event_id: string | null; outcome: string; messages: number }[]
		>`
			select r.event_id::text as event_id, r.outcome, r.messages::integer as messages
			from app.record_runner_notification(
				${notification.kind}::text,
				${notification.severity}::text,
				${subject.tenantId}::uuid,
				${subject.accountId ?? null}::uuid,
				${subject.storeId ?? null}::uuid,
				${subject.runId ?? null}::uuid,
				${JSON.stringify(notification.facts)}::text::jsonb,
				${notification.occurredAt}::timestamptz,
				${this.source}::text
			) r
		`;
		return rows.map((row) => ({
			eventId: row.event_id,
			outcome: row.outcome,
			messages: Number(row.messages),
		}));
	}
}
