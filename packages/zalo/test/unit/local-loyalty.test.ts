import type { Sql } from "postgres";
import { describe, expect, it } from "vitest";
import {
	STAFF_LOYALTY_VARIABLE,
	staffAppEnvironment,
} from "../../src/local-dev/environment.js";
import {
	LOCAL_PHONE_NUMBER,
	mockPhoneNumber,
	STAFF_LOYALTY_FUNCTIONS,
	staffLoyaltyMode,
} from "../../src/local-dev/loop.js";
import {
	LocalLoopError,
	parseLocalLoopArgs,
} from "../../src/local-dev/options.js";

function refusal(run: () => unknown): string {
	try {
		run();
	} catch (error) {
		if (error instanceof LocalLoopError) return error.message;
		throw error;
	}
	throw new Error("expected a refusal");
}

function fakeSql(found: number): Sql & { readonly asked: unknown[][] } {
	const asked: unknown[][] = [];
	const sql = (_strings: TemplateStringsArray, ...values: unknown[]) => {
		asked.push(values);
		return Promise.resolve([{ found }]);
	};
	return Object.assign(sql, { asked }) as unknown as Sql & {
		readonly asked: unknown[][];
	};
}

describe("the mock phone of pnpm zalo:dev", () => {
	it("takes a synthetic number for the phone permission and keeps 0900000789 by default", () => {
		expect(parseLocalLoopArgs([])).not.toHaveProperty("mockPhone");
		expect(
			parseLocalLoopArgs([
				"--app",
				"customer",
				"--live",
				"--mock-phone",
				"0900000123",
			]),
		).toMatchObject({ mockPhone: "0900000123" });
		expect(parseLocalLoopArgs(["--mock-phone", "0900000999"])).toMatchObject({
			mockPhone: "0900000999",
		});
		expect(mockPhoneNumber(undefined)).toBe(LOCAL_PHONE_NUMBER);
		expect(mockPhoneNumber("0900000123")).toBe("84900000123");
	});

	it("refuses a number outside the synthetic range", () => {
		for (const phone of ["0912345678", "090000012", "84900000123", "abc"]) {
			expect(refusal(() => parseLocalLoopArgs(["--mock-phone", phone]))).toBe(
				"--mock-phone must be a synthetic number from 0900000000 to 0900000999",
			);
		}
	});
});

describe("the staff app's loyalty source in the local loop", () => {
	it("is live when the local stack has every staff loyalty function, else the demo", async () => {
		const complete = fakeSql(STAFF_LOYALTY_FUNCTIONS.length);
		expect(await staffLoyaltyMode(complete)).toBe("live");
		expect(complete.asked).toEqual([[STAFF_LOYALTY_FUNCTIONS]]);
		expect(await staffLoyaltyMode(fakeSql(3))).toBe("demo");
		expect(STAFF_LOYALTY_FUNCTIONS).toContain("staff_record_checkin");
		expect(STAFF_LOYALTY_FUNCTIONS).toContain("staff_verify_redemption");
	});

	it("reaches the staff app's dev server as VITE_STAFF_LOYALTY", () => {
		const base = {
			brand: "brand-1",
			publishableKey: "sb_publishable_synthetic",
			functionUrl: "http://127.0.0.1:40124",
			phoneFunctionUrl: "http://127.0.0.1:40125",
			accessToken: "mock-zalo-access-synthetic",
			appConfigPath: null,
			access: null,
		};
		expect(STAFF_LOYALTY_VARIABLE).toBe("VITE_STAFF_LOYALTY");
		expect(staffAppEnvironment({}, { ...base, loyalty: "live" })).toMatchObject(
			{ VITE_STAFF_LOYALTY: "live" },
		);
		expect(staffAppEnvironment({}, { ...base, loyalty: "demo" })).toMatchObject(
			{ VITE_STAFF_LOYALTY: "demo" },
		);
		expect(staffAppEnvironment({}, base)).not.toHaveProperty(
			"VITE_STAFF_LOYALTY",
		);
	});
});
