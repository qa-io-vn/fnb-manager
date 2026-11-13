import { INCREMENTAL_BUDGET } from "@fnb/sync";
import { describe, expect, it } from "vitest";
import {
	BudgetConfigError,
	budgetMilliseconds,
	CPU_BUDGET_VARIABLE,
	EDGE_FUNCTION_BUDGET_LIMITS,
	edgeFunctionBudget,
	WALL_BUDGET_VARIABLE,
} from "../../src/index.js";

describe("incremental budget", () => {
	it("keeps the Free-plan budget when the function has no budget secrets", () => {
		expect(edgeFunctionBudget({})).toEqual(INCREMENTAL_BUDGET);
		expect(
			edgeFunctionBudget({
				[WALL_BUDGET_VARIABLE]: "",
				[CPU_BUDGET_VARIABLE]: " ",
			}),
		).toEqual(INCREMENTAL_BUDGET);
	});

	it("takes a longer wall clock for a paid plan from the function's secrets", () => {
		expect(
			edgeFunctionBudget({
				[WALL_BUDGET_VARIABLE]: "350000",
				[CPU_BUDGET_VARIABLE]: "1500",
			}),
		).toEqual({ wallClockMs: 350_000, cpuMs: 1_500 });
	});

	it("refuses a budget the platform would cut off or that is not a whole number", () => {
		expect(EDGE_FUNCTION_BUDGET_LIMITS).toEqual({
			wallClockMs: 390_000,
			cpuMs: 2_000,
		});
		expect(() =>
			edgeFunctionBudget({ [WALL_BUDGET_VARIABLE]: "400000" }),
		).toThrow(BudgetConfigError);
		expect(() => edgeFunctionBudget({ [CPU_BUDGET_VARIABLE]: "2500" })).toThrow(
			"FNB_INCREMENTAL_CPU_MS must be at most 2000 ms",
		);
		for (const raw of ["0", "-5", "1.5", "120s", "1e5"]) {
			expect(() => budgetMilliseconds("budget", raw, 1)).toThrow(
				BudgetConfigError,
			);
		}
	});
});
