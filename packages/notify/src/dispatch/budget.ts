export type BudgetWork = "digest" | "send" | "poll";

export interface CycleBudgetLimits {
	readonly wallSeconds: number;
	readonly maxDigests: number;
	readonly maxSends: number;
	readonly linkPollSeconds: number;
}

export const EDGE_CYCLE_LIMITS: CycleBudgetLimits = {
	wallSeconds: 90,
	maxDigests: 4,
	maxSends: 30,
	linkPollSeconds: 30,
};

export const CLI_CYCLE_LIMITS: CycleBudgetLimits = {
	wallSeconds: 120,
	maxDigests: 50,
	maxSends: 500,
	linkPollSeconds: 10,
};

export class CycleBudget {
	readonly limits: CycleBudgetLimits;
	private readonly monotonic: () => number;
	private readonly startedAt: number;
	private digests = 0;
	private sends = 0;
	private pollMilliseconds = 0;
	private exhaustedReason: string | null = null;

	constructor(
		limits: CycleBudgetLimits,
		monotonic: () => number = () => performance.now(),
	) {
		this.limits = limits;
		this.monotonic = monotonic;
		this.startedAt = monotonic();
	}

	elapsedMilliseconds(): number {
		return this.monotonic() - this.startedAt;
	}

	remainingMilliseconds(): number {
		return Math.max(
			0,
			this.limits.wallSeconds * 1000 - this.elapsedMilliseconds(),
		);
	}

	remainingPollSeconds(): number {
		return Math.max(
			0,
			Math.min(
				this.limits.linkPollSeconds - this.pollMilliseconds / 1000,
				this.remainingMilliseconds() / 1000,
			),
		);
	}

	allows(work: BudgetWork): boolean {
		if (this.remainingMilliseconds() <= 0) {
			this.exhaustedReason = "wall_clock";
			return false;
		}
		if (work === "digest" && this.digests >= this.limits.maxDigests) {
			this.exhaustedReason = "digests";
			return false;
		}
		if (work === "send" && this.sends >= this.limits.maxSends) {
			this.exhaustedReason = "sends";
			return false;
		}
		if (work === "poll" && this.remainingPollSeconds() < 1) {
			return false;
		}
		return true;
	}

	spend(work: BudgetWork, milliseconds = 0): void {
		if (work === "digest") {
			this.digests += 1;
		} else if (work === "send") {
			this.sends += 1;
		} else {
			this.pollMilliseconds += milliseconds;
		}
	}

	exhausted(): string | null {
		return this.exhaustedReason;
	}
}

export function createCycleBudget(
	limits: CycleBudgetLimits,
	monotonic?: () => number,
): CycleBudget {
	return new CycleBudget(limits, monotonic);
}
