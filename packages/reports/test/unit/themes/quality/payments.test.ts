import { describe, expect, it } from "vitest";
import { reportKeys } from "../../../../src/model/keys.js";
import { buildPaymentsCard } from "../../../../src/themes/quality/cards/payments.js";
import { qualityKeys } from "../../../../src/themes/quality/keys.js";
import { qualityCalls } from "../../../../src/themes/quality/support.js";
import { STORE_A } from "../../fixtures.js";
import { themeContext } from "../fixtures.js";
import { cardInput, type PaymentRow, paymentRow } from "./support.js";

function card(rows: readonly PaymentRow[]) {
	return buildPaymentsCard(
		cardInput(themeContext("28d", [STORE_A]), {
			[qualityCalls.payments]: rows,
		}),
	);
}

const other = paymentRow({
	payment_method_external_id: "SHOPEE",
	payment_method_name: "Ví lạ",
	kind: "other",
	pos_kind: "other",
	invoices: 10,
	amount: 500_000,
});

describe("the Chất lượng dữ liệu payment card", () => {
	it("counts the methods used as Other with their share of the money paid and links to Loại thanh toán", () => {
		const model = card([
			paymentRow({ amount: 1_500_000 }),
			other,
			paymentRow({
				payment_method_external_id: "UNUSED",
				kind: "other",
				invoices: null,
				amount: null,
			}),
		]);
		expect(model.headline.value).toBe(1);
		expect(model.narrative).toEqual([
			{
				key: qualityKeys.payments.main,
				values: {
					range: expect.anything(),
					count: { kind: "count", value: 1 },
					share: { kind: "percent", value: 0.25 },
				},
			},
		]);
		expect(model.tables[0]?.rows.map((row) => row.cells)).toEqual([
			{
				method: "Ví lạ",
				posKind: reportKeys.paymentKind.other,
				overrideKind: null,
				kind: reportKeys.paymentKind.other,
				invoices: 10,
				amount: 500_000,
				inCatalogue: qualityKeys.value.yes,
				fix: qualityKeys.fix.settings.paymentKind,
			},
		]);
		expect(model.notice).toEqual({
			tone: "info",
			part: { key: qualityKeys.payments.notice, values: {} },
			action: "settings_payment_kinds",
		});
		expect(model.markers.stale).toBe(false);
	});

	it("asks for the master-data sync for a method paid but missing from the catalogue", () => {
		const model = card([
			paymentRow({}),
			paymentRow({
				payment_method_external_id: "NEW",
				payment_method_name: null,
				kind: "card",
				pos_kind: null,
				in_catalogue: false,
				invoices: 2,
				amount: 100_000,
			}),
		]);
		expect(model.headline.value).toBe(0);
		expect(model.narrative.map((entry) => entry.key)).toEqual([
			qualityKeys.payments.none,
			qualityKeys.payments.notInCatalogue,
		]);
		expect(model.tables[0]?.rows[0]?.cells).toMatchObject({
			method: "NEW",
			posKind: null,
			inCatalogue: qualityKeys.value.no,
			fix: qualityKeys.fix.syncMaster,
		});
		expect(model.notice).toEqual({
			tone: "info",
			part: { key: qualityKeys.fix.syncMaster, values: {} },
			action: null,
		});
	});

	it("drops a method once Settings gives it a kind, Khác chosen on purpose included", () => {
		for (const kind of ["ewallet", "other"] as const) {
			const model = card([{ ...other, override_kind: kind, kind }]);
			expect(model.headline.value, kind).toBe(0);
			expect(model.tables, kind).toEqual([]);
			expect(model.notice, kind).toBeNull();
			expect(model.narrative[0]?.key, kind).toBe(qualityKeys.payments.none);
		}
	});

	it("says no payment was taken instead of showing 0", () => {
		const model = card([]);
		expect(model.headline.value).toBeNull();
		expect(model.narrative[0]?.key).toBe(qualityKeys.payments.noData);
	});
});
