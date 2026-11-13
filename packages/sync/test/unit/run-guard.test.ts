import { describe, expect, it } from "vitest";
import {
	DEFAULT_COST_MODEL,
	INCREMENTAL_BUDGET,
	RunGuard,
	SUPABASE_FREE_PLAN_EDGE_LIMITS,
	type WorkCostModel,
} from "../../src/index.js";

const MODEL: WorkCostModel = {
	setupCpuMs: 100,
	dayCpuMs: 50,
	saleCpuMs: 1,
	dayWallMs: 5_000,
	saleWallMs: 10,
	closingWallMs: 5_000,
};

function clockAt(start = 0) {
	let now = start;
	return {
		read: () => now,
		advance: (milliseconds: number) => {
			now += milliseconds;
		},
	};
}

describe("run guard", () => {
	it("keeps the default budget inside the Free plan's Edge Function limits with a margin", () => {
		expect(SUPABASE_FREE_PLAN_EDGE_LIMITS).toEqual({
			wallClockMs: 150_000,
			cpuMs: 2_000,
			requestIdleMs: 150_000,
			memoryMb: 256,
		});
		expect(INCREMENTAL_BUDGET.wallClockMs).toBeLessThanOrEqual(
			SUPABASE_FREE_PLAN_EDGE_LIMITS.wallClockMs * 0.75,
		);
		expect(INCREMENTAL_BUDGET.cpuMs).toBeLessThanOrEqual(
			SUPABASE_FREE_PLAN_EDGE_LIMITS.cpuMs * 0.6,
		);
		const guard = new RunGuard({ clock: () => 0 });
		expect(guard.estimatedCpuMs).toBe(DEFAULT_COST_MODEL.setupCpuMs);
	});

	it("admits days until the estimated CPU time would pass the budget", () => {
		const clock = clockAt();
		const guard = new RunGuard({
			budget: { wallClockMs: 1_000_000, cpuMs: 1_000 },
			model: MODEL,
			clock: clock.read,
		});
		expect(guard.admit(400)).toBeNull();
		guard.record(400, 1_000);
		expect(guard.estimatedCpuMs).toBe(550);
		expect(guard.admit(400)).toBeNull();
		guard.record(400, 1_000);
		expect(guard.estimatedCpuMs).toBe(1_000);
		expect(guard.admit(0)).toBe("cpu_time");
	});

	it("refuses a single day that alone exceeds the CPU budget", () => {
		const guard = new RunGuard({
			budget: { wallClockMs: 1_000_000, cpuMs: 1_000 },
			model: MODEL,
			clock: () => 0,
		});
		expect(guard.admit(900)).toBe("cpu_time");
		expect(guard.admit(850)).toBeNull();
	});

	it("stops before a day that would run past the wall-clock budget, counting the closing reserve", () => {
		const clock = clockAt(1_000);
		const guard = new RunGuard({
			budget: { wallClockMs: 30_000, cpuMs: 100_000 },
			model: MODEL,
			clock: clock.read,
			startedAt: 0,
		});
		expect(guard.elapsedMs).toBe(1_000);
		expect(guard.admit(100)).toBeNull();
		clock.advance(18_000);
		expect(guard.admit(100)).toBeNull();
		clock.advance(1);
		expect(guard.admit(100)).toBe("wall_time");
	});

	it("projects the next day from the slowest of the model and the days measured so far", () => {
		const clock = clockAt();
		const guard = new RunGuard({
			budget: { wallClockMs: 60_000, cpuMs: 100_000 },
			model: MODEL,
			clock: clock.read,
		});
		expect(guard.dayWallMs(0)).toBe(5_000);
		clock.advance(20_000);
		guard.record(10, 20_000);
		expect(guard.dayWallMs(10)).toBe(20_000);
		expect(guard.admit(10)).toBeNull();
		clock.advance(15_001);
		expect(guard.admit(10)).toBe("wall_time");
		expect(guard.dayWallMs(3_000)).toBe(35_000);
	});

	it("refuses a budget that is not positive", () => {
		expect(
			() =>
				new RunGuard({
					budget: { wallClockMs: 0, cpuMs: 1 },
					clock: () => 0,
				}),
		).toThrow(RangeError);
		expect(
			() =>
				new RunGuard({
					budget: { wallClockMs: 1, cpuMs: Number.NaN },
					clock: () => 0,
				}),
		).toThrow(RangeError);
	});
});
