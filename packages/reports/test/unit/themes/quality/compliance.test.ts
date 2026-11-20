import { describe, expect, it } from "vitest";
import {
	COUPON_RAILS,
	loyaltyRailFlagsRow,
	type ThemeRow,
} from "../../../../src/themes/contract.js";
import {
	buildComplianceCard,
	isEInvoiceFinding,
	receiptReading,
	receiptsDisagree,
	storeFindings,
} from "../../../../src/themes/quality/cards/compliance.js";
import { qualityKeys } from "../../../../src/themes/quality/keys.js";
import {
	qualityCalls,
	qualityNeeds,
	qualityPrimaryCalls,
} from "../../../../src/themes/quality/support.js";
import { STORE_A, STORE_B } from "../../fixtures.js";
import { themeContext } from "../fixtures.js";
import { cardInput, type SummaryRow, summaryRow } from "./support.js";

function card(rows: readonly SummaryRow[]) {
	return buildComplianceCard(
		cardInput(themeContext("28d", [STORE_A, STORE_B]), {
			[qualityCalls.summary]: rows,
		}),
	);
}

describe("the e-invoice finding (FR-CMP-10)", () => {
	it("flags every status but configured, with the POS hint to register or the Settings hint to record the status", () => {
		expect(isEInvoiceFinding(summaryRow(STORE_A))).toBe(false);
		expect(storeFindings(summaryRow(STORE_A))).toEqual([]);
		for (const status of ["not_configured", "disabled"] as const) {
			const row = summaryRow(STORE_A, { e_invoice_status: status });
			expect(isEInvoiceFinding(row), status).toBe(true);
			expect(storeFindings(row)).toEqual([
				{
					finding: "eInvoice",
					findingKey: qualityKeys.finding.eInvoice[status],
					fixKey: qualityKeys.fix.pos.eInvoice,
				},
			]);
		}
		for (const status of ["unknown", null] as const) {
			const row = summaryRow(STORE_A, { e_invoice_status: status });
			expect(isEInvoiceFinding(row), String(status)).toBe(true);
			expect(storeFindings(row)).toEqual([
				{
					finding: "eInvoice",
					findingKey: qualityKeys.finding.eInvoice.unknown,
					fixKey: qualityKeys.fix.settings.eInvoice,
				},
			]);
		}
	});
});

describe("the receipt-numbering comparison", () => {
	const cases = [
		["daily", true, false],
		["daily", false, true],
		["yearly", true, true],
		["yearly", false, false],
		["never", true, true],
		["never", false, false],
		["daily", null, false],
		["unknown", true, false],
	] as const;

	it.each(cases)(
		"reads %s against restarts %s as a disagreement: %s",
		(period, restarts, disagrees) => {
			const row = summaryRow(STORE_A, {
				tran_no_reset_period: period,
				receipt_restarts_daily: restarts,
				receipt_days: restarts === null ? null : 60,
			});
			expect(receiptsDisagree(row)).toBe(disagrees);
		},
	);

	it("reads the data as daily, not daily or not enough", () => {
		expect(
			receiptReading(summaryRow(STORE_A, { receipt_restarts_daily: true })),
		).toBe("daily");
		expect(
			receiptReading(summaryRow(STORE_A, { receipt_restarts_daily: false })),
		).toBe("notDaily");
		expect(receiptReading(summaryRow(STORE_A))).toBe("unknown");
	});

	it("flags a numbering not recorded and one the data contradicts, with the Settings hint", () => {
		expect(
			storeFindings(summaryRow(STORE_A, { tran_no_reset_period: "unknown" })),
		).toEqual([
			{
				finding: "receipts",
				findingKey: qualityKeys.finding.receipts.unknown,
				fixKey: qualityKeys.fix.settings.receipts,
			},
		]);
		expect(
			storeFindings(
				summaryRow(STORE_A, {
					tran_no_reset_period: "yearly",
					receipt_restarts_daily: true,
					receipt_days: 60,
				}),
			),
		).toEqual([
			{
				finding: "receipts",
				findingKey: qualityKeys.finding.receipts.mismatch,
				fixKey: qualityKeys.fix.settings.receipts,
			},
		]);
	});
});

describe("the Chất lượng dữ liệu compliance card", () => {
	it("flags the store without e-invoicing, lists each finding with its hint and links to Cửa hàng to record the status (acceptance A7)", () => {
		const model = card([
			summaryRow(null),
			summaryRow(STORE_A),
			summaryRow(STORE_B, {
				e_invoice_status: "not_configured",
				tran_no_reset_period: "unknown",
				member_capture_status: "disabled",
				opening_hours_known: false,
				seat_count: null,
				opened_on: null,
			}),
		]);
		expect(model.headline).toEqual({ value: 1, unit: "count", caption: null });
		expect(model.narrative).toEqual([
			{
				key: qualityKeys.compliance.main,
				values: {
					count: { kind: "count", value: 1 },
					total: { kind: "count", value: 2 },
				},
			},
			{
				key: qualityKeys.compliance.eInvoice,
				values: { count: { kind: "count", value: 1 } },
			},
		]);
		const [findings, stores] = model.tables;
		expect(findings?.rows.map((row) => row.cells)).toEqual([
			{
				store: "Store 2",
				finding: qualityKeys.finding.eInvoice.not_configured,
				fix: qualityKeys.fix.pos.eInvoice,
			},
			{
				store: "Store 2",
				finding: qualityKeys.finding.receipts.unknown,
				fix: qualityKeys.fix.settings.receipts,
			},
			{
				store: "Store 2",
				finding: qualityKeys.finding.memberDisabled,
				fix: qualityKeys.fix.pos.memberFeatureRecord,
			},
			{
				store: "Store 2",
				finding: qualityKeys.finding.hours,
				fix: qualityKeys.fix.settings.hours,
			},
			{
				store: "Store 2",
				finding: qualityKeys.finding.seats,
				fix: qualityKeys.fix.settings.seats,
			},
			{
				store: "Store 2",
				finding: qualityKeys.finding.openedOn,
				fix: qualityKeys.fix.settings.openedOn,
			},
		]);
		expect(stores?.rows.map((row) => row.cells)).toEqual([
			{
				store: "Store 1",
				eInvoice: qualityKeys.eInvoice.configured,
				receipts: qualityKeys.receipts.daily,
				receiptsData: qualityKeys.receiptsData.unknown,
				member: qualityKeys.member.enabled,
				openingHours: qualityKeys.value.entered,
				seats: 30,
				openedOn: "2024-01-15",
			},
			{
				store: "Store 2",
				eInvoice: qualityKeys.eInvoice.not_configured,
				receipts: qualityKeys.receipts.unknown,
				receiptsData: qualityKeys.receiptsData.unknown,
				member: qualityKeys.member.disabled,
				openingHours: qualityKeys.value.missing,
				seats: null,
				openedOn: null,
			},
		]);
		expect(model.notice).toEqual({
			tone: "warning",
			part: { key: qualityKeys.compliance.eInvoiceNotice, values: {} },
			action: "settings_e_invoice",
		});
	});

	it("links to the store profile, under a label that fits every finding, when only profile fields are missing", () => {
		for (const overrides of [
			{ seat_count: null },
			{ opened_on: null },
			{ tran_no_reset_period: "unknown" as const },
		]) {
			const model = card([
				summaryRow(null),
				summaryRow(STORE_A, overrides),
				summaryRow(STORE_B),
			]);
			expect(model.narrative.map((entry) => entry.key)).toEqual([
				qualityKeys.compliance.main,
			]);
			expect(model.notice).toEqual({
				tone: "info",
				part: { key: qualityKeys.compliance.storeNotice, values: {} },
				action: "settings_store_profile",
			});
		}
	});

	it("gives a member feature switched off its POS hint and the store profile link", () => {
		const model = card([
			summaryRow(null),
			summaryRow(STORE_A, { member_capture_status: "disabled" }),
			summaryRow(STORE_B),
		]);
		expect(model.tables[0]?.rows.map((row) => row.cells)).toEqual([
			{
				store: "Store 1",
				finding: qualityKeys.finding.memberDisabled,
				fix: qualityKeys.fix.pos.memberFeatureRecord,
			},
		]);
		expect(model.notice).toEqual({
			tone: "info",
			part: { key: qualityKeys.compliance.memberNotice, values: {} },
			action: "settings_store_profile",
		});
	});

	it("says every store is in order and keeps the profile table", () => {
		const model = card([
			summaryRow(null),
			summaryRow(STORE_A),
			summaryRow(STORE_B),
		]);
		expect(model.headline.value).toBe(0);
		expect(model.narrative[0]?.key).toBe(qualityKeys.compliance.none);
		expect(model.tables.map((table) => table.captionKey)).toEqual([
			qualityKeys.compliance.storesTable,
		]);
		expect(model.notice).toBeNull();
	});
});

describe("the loyalty rail e-invoice flag (FR-CMP-10, #242)", () => {
	type RailRow = ThemeRow<"loyalty_rail_flags">;
	function railRow(storeId: string, overrides: Partial<RailRow> = {}): RailRow {
		return {
			store_id: storeId,
			rail: "pos_payment_discount",
			active_from: "2026-11-01T00:00:00+07:00",
			e_invoice_status: "not_configured",
			flagged: true,
			...overrides,
		};
	}
	function railCard(
		rows: readonly SummaryRow[],
		rails: readonly RailRow[] | undefined,
	) {
		return buildComplianceCard(
			cardInput(themeContext("28d", [STORE_A, STORE_B]), {
				[qualityCalls.summary]: rows,
				...(rails === undefined ? {} : { [qualityCalls.railFlags]: rails }),
			}),
		);
	}
	const railFinding = {
		finding: "railEInvoice",
		findingKey: qualityKeys.finding.railEInvoice,
		fixKey: qualityKeys.fix.pos.eInvoice,
	};

	it("the card needs the rail flags and the page asks for them with the selected stores", () => {
		expect(qualityNeeds.compliance).toContain(qualityCalls.railFlags);
		const call = qualityPrimaryCalls(
			themeContext("28d", [STORE_A, STORE_B]),
		).find((entry) => entry.key === qualityCalls.railFlags);
		expect(call?.name).toBe("loyalty_rail_flags");
		expect(call?.args).toEqual({ p_store_ids: [STORE_A, STORE_B] });
	});

	it("a flagged store gets the rail finding next to its e-invoice finding, with the POS fix", () => {
		expect(storeFindings(summaryRow(STORE_A), false)).toEqual([]);
		expect(storeFindings(summaryRow(STORE_A), true)).toEqual([railFinding]);
		const model = railCard(
			[
				summaryRow(STORE_A, { e_invoice_status: "not_configured" }),
				summaryRow(STORE_B),
			],
			[
				railRow(STORE_A),
				railRow(STORE_B, { flagged: false, e_invoice_status: "configured" }),
			],
		);
		const findings = model.tables[0];
		expect(findings?.rows.map((row) => row.cells.finding)).toEqual([
			qualityKeys.finding.eInvoice.not_configured,
			qualityKeys.finding.railEInvoice,
		]);
		expect(model.narrative.map((entry) => entry.key)).toContain(
			qualityKeys.compliance.railEInvoice,
		);
		expect(model.headline.value).toBe(1);
	});

	it("an unflagged rail, a store without a rail and a failed or empty call add nothing", () => {
		const rows = [summaryRow(STORE_A), summaryRow(STORE_B)];
		for (const rails of [
			undefined,
			[],
			[railRow(STORE_A, { flagged: false, e_invoice_status: "configured" })],
			[railRow("99999999-9999-4999-8999-999999999999")],
		]) {
			const model = railCard(rows, rails);
			expect(model.headline.value, JSON.stringify(rails)).toBe(0);
			expect(model.narrative.map((entry) => entry.key)).not.toContain(
				qualityKeys.compliance.railEInvoice,
			);
		}
	});

	it("the row schema refuses an unknown rail or status and accepts each rail", () => {
		for (const rail of COUPON_RAILS) {
			expect(
				loyaltyRailFlagsRow.safeParse(railRow(STORE_A, { rail })).success,
			).toBe(true);
		}
		expect(
			loyaltyRailFlagsRow.safeParse({ ...railRow(STORE_A), rail: "cash" })
				.success,
		).toBe(false);
		expect(
			loyaltyRailFlagsRow.safeParse({
				...railRow(STORE_A),
				e_invoice_status: "maybe",
			}).success,
		).toBe(false);
		expect(
			loyaltyRailFlagsRow.safeParse({ ...railRow(STORE_A), flagged: "yes" })
				.success,
		).toBe(false);
	});
});
