export interface EdgeFunctionLimits {
	wallClockMs: number;
	cpuMs: number;
	requestIdleMs: number;
	memoryMb: number;
}

export const SUPABASE_FREE_PLAN_EDGE_LIMITS: EdgeFunctionLimits = {
	wallClockMs: 150_000,
	cpuMs: 2_000,
	requestIdleMs: 150_000,
	memoryMb: 256,
};

export interface RunBudget {
	wallClockMs: number;
	cpuMs: number;
}

export const INCREMENTAL_BUDGET: RunBudget = {
	wallClockMs: 105_000,
	cpuMs: 1_200,
};

export const SERVER_INCREMENTAL_BUDGET: RunBudget = {
	wallClockMs: 10 * 60_000,
	cpuMs: 10 * 60_000,
};

export class RunDeadlineError extends Error {
	readonly budgetMs: number;

	constructor(budgetMs: number) {
		super(
			`the run reached its ${budgetMs} ms wall-clock budget before this POS call finished`,
		);
		this.name = "RunDeadlineError";
		this.budgetMs = budgetMs;
	}
}

export interface WorkCostModel {
	setupCpuMs: number;
	dayCpuMs: number;
	saleCpuMs: number;
	dayWallMs: number;
	saleWallMs: number;
	closingWallMs: number;
}

export const DEFAULT_COST_MODEL: WorkCostModel = {
	setupCpuMs: 250,
	dayCpuMs: 50,
	saleCpuMs: 1,
	dayWallMs: 8_000,
	saleWallMs: 20,
	closingWallMs: 10_000,
};

export type GuardStop = "wall_time" | "cpu_time";

export interface RunGuardOptions {
	budget?: RunBudget | undefined;
	model?: WorkCostModel | undefined;
	clock: () => number;
	startedAt?: number | undefined;
}

function assertBudget(budget: RunBudget): void {
	for (const [name, value] of Object.entries(budget)) {
		if (!Number.isFinite(value) || value <= 0) {
			throw new RangeError(`the run budget's ${name} must be positive`);
		}
	}
}

export class RunGuard {
	readonly budget: RunBudget;
	readonly model: WorkCostModel;
	private readonly clock: () => number;
	private readonly startedAt: number;
	private cpuEstimate: number;
	private measuredDays = 0;
	private measuredWallMs = 0;

	constructor(options: RunGuardOptions) {
		this.budget = options.budget ?? INCREMENTAL_BUDGET;
		this.model = options.model ?? DEFAULT_COST_MODEL;
		assertBudget(this.budget);
		this.clock = options.clock;
		this.startedAt = options.startedAt ?? options.clock();
		this.cpuEstimate = this.model.setupCpuMs;
	}

	get elapsedMs(): number {
		return Math.max(0, this.clock() - this.startedAt);
	}

	get estimatedCpuMs(): number {
		return Math.round(this.cpuEstimate);
	}

	get remainingPosMs(): number {
		return Math.max(
			0,
			this.budget.wallClockMs - this.model.closingWallMs - this.elapsedMs,
		);
	}

	dayCpuMs(invoiceCount: number): number {
		return this.model.dayCpuMs + this.model.saleCpuMs * invoiceCount;
	}

	dayWallMs(invoiceCount: number): number {
		const modelled =
			this.model.dayWallMs + this.model.saleWallMs * invoiceCount;
		const observed =
			this.measuredDays > 0 ? this.measuredWallMs / this.measuredDays : 0;
		return Math.max(modelled, observed);
	}

	admit(invoiceCount: number): GuardStop | null {
		if (this.cpuEstimate + this.dayCpuMs(invoiceCount) > this.budget.cpuMs) {
			return "cpu_time";
		}
		const projected =
			this.elapsedMs + this.dayWallMs(invoiceCount) + this.model.closingWallMs;
		return projected > this.budget.wallClockMs ? "wall_time" : null;
	}

	record(invoiceCount: number, wallMs: number): void {
		this.cpuEstimate += this.dayCpuMs(invoiceCount);
		this.measuredDays += 1;
		this.measuredWallMs += Math.max(0, wallMs);
	}
}
