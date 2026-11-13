export const NOTIFICATION_KINDS = [
	"run_failed",
	"auth_failed",
	"sync_stale",
] as const;

export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

export type NotificationSeverity = "warning" | "critical";

export type NotificationFact = number | string | boolean | null;

export interface NotificationSubject {
	tenantId: string;
	accountId?: string;
	storeId?: string;
	runId?: string | null;
}

export interface Notification {
	kind: NotificationKind;
	severity: NotificationSeverity;
	subject: NotificationSubject;
	label: string;
	message: string;
	occurredAt: string;
	facts: Readonly<Record<string, NotificationFact>>;
}

export interface Notifier {
	notify(notification: Notification): Promise<void>;
}

export type LineWriter = (line: string) => void;

function factText(facts: Notification["facts"]): string {
	const entries = Object.entries(facts).sort(([left], [right]) =>
		left < right ? -1 : left > right ? 1 : 0,
	);
	return entries.length === 0
		? ""
		: ` (${entries.map(([key, value]) => `${key}=${String(value)}`).join(", ")})`;
}

export function formatNotification(notification: Notification): string {
	return `[notify] ${notification.severity} ${notification.kind}: ${notification.label}: ${notification.message}${factText(notification.facts)}`;
}

export class ConsoleNotifier implements Notifier {
	private readonly write: LineWriter;
	private readonly redact: (text: string) => string;

	constructor(
		write: LineWriter = (line) => console.warn(line),
		redact: (text: string) => string = (text) => text,
	) {
		this.write = write;
		this.redact = redact;
	}

	async notify(notification: Notification): Promise<void> {
		this.write(this.redact(formatNotification(notification)));
	}
}

export class MemoryNotifier implements Notifier {
	readonly sent: Notification[] = [];

	async notify(notification: Notification): Promise<void> {
		this.sent.push(notification);
	}
}

export async function notifySafely(
	notifier: Notifier,
	notification: Notification,
	onError: LineWriter,
): Promise<boolean> {
	try {
		await notifier.notify(notification);
		return true;
	} catch (error) {
		onError(
			`[notify] could not deliver ${notification.kind} for ${notification.label}: ${error instanceof Error ? error.name : "error"}`,
		);
		return false;
	}
}

interface NotificationInput {
	subject: NotificationSubject;
	label: string;
	occurredAt: Date;
	facts?: Record<string, NotificationFact>;
}

export function runFailedNotification(
	input: NotificationInput & { error: string },
): Notification {
	return {
		kind: "run_failed",
		severity: "warning",
		subject: input.subject,
		label: input.label,
		message: `sync run failed: ${input.error}`,
		occurredAt: input.occurredAt.toISOString(),
		facts: input.facts ?? {},
	};
}

export function authFailedNotification(input: NotificationInput): Notification {
	return {
		kind: "auth_failed",
		severity: "critical",
		subject: input.subject,
		label: input.label,
		message:
			"the POS rejected the account's credentials; the account is now auth_failed and the incremental schedule skips it until a run logs in again",
		occurredAt: input.occurredAt.toISOString(),
		facts: input.facts ?? {},
	};
}

export function staleSyncNotification(
	input: NotificationInput & { minutes: number; thresholdMinutes: number },
): Notification {
	return {
		kind: "sync_stale",
		severity: "critical",
		subject: input.subject,
		label: input.label,
		message: `no successful sync for ${input.minutes} minutes of opening hours (threshold ${input.thresholdMinutes})`,
		occurredAt: input.occurredAt.toISOString(),
		facts: {
			...(input.facts ?? {}),
			minutes_without_sync: input.minutes,
			threshold_minutes: input.thresholdMinutes,
		},
	};
}
