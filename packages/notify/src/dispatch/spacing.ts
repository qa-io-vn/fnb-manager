export type Sleep = (milliseconds: number) => Promise<void>;

export const realSleep: Sleep = (milliseconds) =>
	new Promise((resolve) => setTimeout(resolve, milliseconds));

export class ChatSpacing {
	private readonly lastSend = new Map<string, number>();
	private readonly sleep: Sleep;
	private readonly monotonic: () => number;

	constructor(
		sleep: Sleep = realSleep,
		monotonic: () => number = () => performance.now(),
	) {
		this.sleep = sleep;
		this.monotonic = monotonic;
	}

	async waitFor(chatKey: string, minSpacingMs: number): Promise<void> {
		const last = this.lastSend.get(chatKey);
		if (last !== undefined) {
			const wait = last + minSpacingMs - this.monotonic();
			if (wait > 0) {
				await this.sleep(wait);
			}
		}
	}

	record(chatKey: string): void {
		this.lastSend.set(chatKey, this.monotonic());
	}
}
