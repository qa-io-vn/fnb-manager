import { DEFAULT_LOYALTY_PARAMETERS } from "@fnb/core";
import { describe, expect, it } from "vitest";
import { PARAMETER_COLUMNS, refusedProgrammeField } from "./programme-columns";
import { LoyaltyWriteError } from "./source";
import {
	programmeColumnsOf,
	programmeWriteError,
} from "./supabase-loyalty-source";

describe("refusedProgrammeField", () => {
	it.each([
		[
			"a loyalty programme cannot become active while its notification decision is pending",
			"status",
			true,
		],
		[
			"a not_required notification decision needs its legal basis in notification_basis",
			"notificationBasis",
			false,
		],
		[
			"a loyalty programme name holds 1 to 120 characters without control characters",
			"name",
			false,
		],
		["a loyalty programme ends on or after the day it starts", "endsOn", false],
		["stamps_per_card is between 2 and 20", "stampsPerCard", false],
		[
			"welcome_stamps is between 0 and one less than stamps_per_card",
			"welcomeStamps",
			false,
		],
		[
			"expected_breakage_rate is between 0 and 0.9",
			"expectedBreakageRate",
			false,
		],
		["reward_budget_amount is 0 or more", "rewardBudgetAmount", false],
		[
			"excluded_order_sources holds at most 50 sources",
			"excludedOrderSources",
			false,
		],
		[
			"each excluded order source holds 1 to 100 characters",
			"excludedOrderSources",
			false,
		],
		[
			"notification_basis holds 1 to 500 characters without control characters",
			"notificationBasis",
			false,
		],
		["something else", null, false],
	] as const)("reads %j as the refusal of %s", (message, field, hold) => {
		expect(refusedProgrammeField(message)).toEqual({ field, hold });
	});
});

describe("programmeWriteError", () => {
	it("puts a 22023 refusal on its field and keeps the hold apart", () => {
		const held = programmeWriteError({
			code: "22023",
			message:
				"a loyalty programme cannot become active while its notification decision is pending",
		});
		expect(held).toBeInstanceOf(LoyaltyWriteError);
		expect(held).toMatchObject({
			code: "invalid",
			field: "status",
			hold: true,
		});
		expect(
			programmeWriteError({
				code: "22023",
				message: "points_per_unit is between 0 and 100",
			}),
		).toMatchObject({ code: "invalid", field: "pointsPerUnit", hold: false });
	});

	it("reads a second active programme as a duplicate on the status, and a refused write as forbidden", () => {
		expect(
			programmeWriteError({
				code: "23505",
				message:
					'duplicate key value violates unique constraint "loyalty_programmes_one_active_per_tenant_key"',
			}),
		).toMatchObject({ code: "duplicate", field: "status" });
		expect(
			programmeWriteError({ code: "42501", message: "row-level security" }),
		).toMatchObject({ code: "forbidden" });
	});
});

describe("programmeColumnsOf", () => {
	it("writes every parameter to its column next to the programme record", () => {
		const columns = programmeColumnsOf({
			id: null,
			name: "Tích dấu",
			startsOn: "2026-12-01",
			endsOn: null,
			rewardBudgetAmount: 1_000_000,
			status: "draft",
			notificationDecision: "pending",
			notificationBasis: null,
			notificationDecidedAt: null,
			parameters: DEFAULT_LOYALTY_PARAMETERS,
		});
		expect(columns).toMatchObject({
			name: "Tích dấu",
			starts_on: "2026-12-01",
			ends_on: null,
			reward_budget_amount: 1_000_000,
			status: "draft",
			notification_decision: "pending",
			notification_basis: null,
			notification_decided_at: null,
			stamps_per_card: 8,
			excluded_order_sources: [],
			expected_breakage_rate: 0.2,
		});
		expect(Object.keys(columns)).toHaveLength(
			8 + Object.keys(PARAMETER_COLUMNS).length,
		);
		expect(columns).not.toHaveProperty("id");
		expect(columns).not.toHaveProperty("tenant_id");
	});
});
