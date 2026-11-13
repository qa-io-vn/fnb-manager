export type TicketSource = "schedule" | "manual";

export interface IncrementalTicket {
	tenantId: string;
	storeId: string;
	dueAt: string;
	source: TicketSource;
}

export interface RunnerDatabase {
	claimIncrementalTicket(ticket: string): Promise<IncrementalTicket | null>;
	storeWatched(storeId: string): Promise<boolean>;
	syncGapMinutes(storeId: string, at: Date): Promise<number | null>;
	longestSyncGapMinutes(
		storeId: string,
		from: Date,
		to: Date,
	): Promise<number | null>;
	incrementalScheduleEnabled(): Promise<boolean>;
}

export const TICKET_PATTERN =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isTicket(value: unknown): value is string {
	return typeof value === "string" && TICKET_PATTERN.test(value);
}
