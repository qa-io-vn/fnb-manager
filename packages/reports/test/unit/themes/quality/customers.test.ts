import { describe, expect, it } from "vitest";
import { buildCustomersCard } from "../../../../src/themes/quality/cards/customers.js";
import { qualityKeys } from "../../../../src/themes/quality/keys.js";
import { qualityCalls } from "../../../../src/themes/quality/support.js";
import { STORE_A, STORE_B } from "../../fixtures.js";
import { themeContext } from "../fixtures.js";
import { cardInput, type SummaryRow, summaryRow } from "./support.js";

function card(rows: readonly SummaryRow[]) {
	return buildCustomersCard(
		cardInput(themeContext("28d", [STORE_A, STORE_B]), {
			[qualityCalls.summary]: rows,
		}),
	);
}

describe("the Chất lượng dữ liệu customer card", () => {
	it("reads the capture rate and the consent coverage, in counts only, with the add-customer hint", () => {
		const model = card([
			summaryRow(null, {
				invoices: 200,
				identified_invoices: 40,
				capture_rate: 0.2,
				identified_customers: 25,
				consent_coverage: 0.4,
			}),
			summaryRow(STORE_A),
			summaryRow(STORE_B, {
				identified_invoices: 100,
				capture_rate: 1,
			}),
		]);
		expect(model.metricId).toBe("customer_capture_rate");
		expect(model.relatedMetricIds).toEqual(["consent_coverage"]);
		expect(model.headline.value).toBe(0.2);
		expect(model.narrative[1]).toEqual({
			key: qualityKeys.customers.coverage,
			values: {
				coverage: { kind: "percent", value: 0.4 },
				customers: { kind: "count", value: 25 },
			},
		});
		const [first, second] = model.tables[0]?.rows ?? [];
		expect(first?.cells.fix).toBe(qualityKeys.fix.pos.member);
		expect(second?.cells.fix).toBeNull();
		for (const row of model.tables[0]?.rows ?? []) {
			for (const [key, value] of Object.entries(row.cells)) {
				if (key === "store" || key === "fix") continue;
				expect(value === null || typeof value === "number", key).toBe(true);
			}
		}
		expect(model.notice?.part.key).toBe(qualityKeys.customers.notice);
	});

	it("names the state without identified customers instead of a 0 % coverage", () => {
		const model = card([
			summaryRow(null, {
				identified_customers: 0,
				loyalty_consents: 0,
				marketing_consents: 0,
				consent_coverage: null,
			}),
			summaryRow(STORE_A),
		]);
		expect(model.narrative[1]?.key).toBe(qualityKeys.customers.noIdentified);
	});

	it("asks to switch the member feature on in the POS where it is recorded as off", () => {
		const model = card([
			summaryRow(null),
			summaryRow(STORE_A, { member_capture_status: "disabled" }),
			summaryRow(STORE_B),
		]);
		expect(model.tables[0]?.rows.map((row) => row.cells.fix)).toEqual([
			qualityKeys.fix.pos.memberFeature,
			qualityKeys.fix.pos.member,
		]);
		expect(model.notice).toEqual({
			tone: "warning",
			part: { key: qualityKeys.customers.featureNotice, values: {} },
			action: null,
		});
	});

	it("says there is no invoice instead of showing 0", () => {
		const model = card([
			summaryRow(null, {
				invoices: 0,
				identified_invoices: 0,
				capture_rate: null,
			}),
		]);
		expect(model.headline.value).toBeNull();
		expect(model.narrative.map((entry) => entry.key)).toEqual([
			qualityKeys.customers.noData,
		]);
		expect(model.notice).toBeNull();
	});
});
