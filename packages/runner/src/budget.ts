import { INCREMENTAL_BUDGET, type RunBudget } from "@fnb/sync";
import type { RunnerEnvironment } from "./connectors.js";

export const WALL_BUDGET_VARIABLE = "FNB_INCREMENTAL_WALL_MS";
export const CPU_BUDGET_VARIABLE = "FNB_INCREMENTAL_CPU_MS";

export const EDGE_FUNCTION_BUDGET_LIMITS: RunBudget = {
	wallClockMs: 390_000,
	cpuMs: 2_000,
};

export class BudgetConfigError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "BudgetConfigError";
	}
}

export function budgetMilliseconds(
	name: string,
	raw: string | undefined,
	fallback: number,
	maximum: number = Number.MAX_SAFE_INTEGER,
): number {
	const text = raw?.trim() ?? "";
	if (text === "") {
		return fallback;
	}
	if (!/^[1-9][0-9]*$/.test(text) || !Number.isSafeInteger(Number(text))) {
		throw new BudgetConfigError(
			`${name} must be a whole number of milliseconds from 1`,
		);
	}
	const value = Number(text);
	if (value > maximum) {
		throw new BudgetConfigError(`${name} must be at most ${maximum} ms`);
	}
	return value;
}

export function edgeFunctionBudget(
	environment: RunnerEnvironment,
	defaults: RunBudget = INCREMENTAL_BUDGET,
	limits: RunBudget = EDGE_FUNCTION_BUDGET_LIMITS,
): RunBudget {
	return {
		wallClockMs: budgetMilliseconds(
			WALL_BUDGET_VARIABLE,
			environment[WALL_BUDGET_VARIABLE],
			defaults.wallClockMs,
			limits.wallClockMs,
		),
		cpuMs: budgetMilliseconds(
			CPU_BUDGET_VARIABLE,
			environment[CPU_BUDGET_VARIABLE],
			defaults.cpuMs,
			limits.cpuMs,
		),
	};
}
