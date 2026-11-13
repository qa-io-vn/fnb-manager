import type { Notification, Notifier } from "@fnb/runner";

export class NotifierDeliveryError extends Error {
	readonly failed: number;
	readonly total: number;

	constructor(failed: number, total: number) {
		super(`${failed} of ${total} notifiers failed`);
		this.name = "NotifierDeliveryError";
		this.failed = failed;
		this.total = total;
	}
}

export class CompositeNotifier implements Notifier {
	private readonly notifiers: readonly Notifier[];

	constructor(notifiers: readonly Notifier[]) {
		this.notifiers = notifiers;
	}

	async notify(notification: Notification): Promise<void> {
		const results = await Promise.allSettled(
			this.notifiers.map((notifier) => notifier.notify(notification)),
		);
		const failed = results.filter(
			(result) => result.status === "rejected",
		).length;
		if (failed > 0) {
			throw new NotifierDeliveryError(failed, this.notifiers.length);
		}
	}
}
