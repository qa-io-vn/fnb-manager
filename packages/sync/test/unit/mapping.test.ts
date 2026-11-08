import { describe, expect, it } from "vitest";
import { mapCatalog, mapSale, mergeCatalogs } from "../../src/index.js";
import { EMPTY_CATALOG } from "../support/fake-connector.js";
import { cashPayment, itemLine, sale } from "../support/sales.js";

const context = {
	tenantId: "tenant-1",
	storeId: "store-1",
	posAccountId: "account-1",
	businessDate: "2026-11-01",
};

describe("mapSale", () => {
	it("maps invoice fields with fixed numeric scale and explicit nulls", () => {
		const canonical = sale("T-1", "2026-11-01T03:15:00.000Z", "2026-11-01", {
			receiptNo: "0042",
			customerPhone: "0900000000",
			customerName: "Khách quen",
			voucherCode: "VC-10K",
			voucherName: "Voucher 10k",
			voucherAmount: 10_000,
			billDiscountAmount: 2_500.5,
			billDiscountName: "Giảm giá hoá đơn",
			grossAmount: 57_500.5,
			netAmount: 45_000,
			paidAmount: 45_000,
			guestCount: 2,
			status: "edited",
			openedAt: new Date("2026-11-01T03:10:00.000Z"),
		});
		const { write, flags } = mapSale(canonical, context);
		expect(flags).toEqual([]);
		expect(write.invoice).toMatchObject({
			tenant_id: "tenant-1",
			store_id: "store-1",
			pos_account_id: "account-1",
			external_id: "T-1",
			receipt_no: "0042",
			sold_at: "2026-11-01T03:15:00.000Z",
			business_date: "2026-11-01",
			opened_at: "2026-11-01T03:10:00.000Z",
			closed_at: null,
			sale_type: "dine_in",
			guest_count: 2,
			customer_phone: "0900000000",
			customer_name: "Khách quen",
			voucher_code: "VC-10K",
			voucher_name: "Voucher 10k",
			voucher_amount: "10000.00",
			bill_discount_amount: "2500.50",
			bill_discount_name: "Giảm giá hoá đơn",
			extra_discount_amount: "0.00",
			gross_amount: "57500.50",
			net_amount: "45000.00",
			paid_amount: "45000.00",
			device_code: null,
			table_name: null,
			status: "edited",
			primary_payment_method_external_id: "PM-CASH",
			primary_payment_method_name: "Tiền mặt",
			raw: { id: "T-1" },
		});
	});

	it("stores an unknown guest count and blank text as null", () => {
		const { write } = mapSale(
			sale("T-2", "2026-11-01T03:15:00.000Z", "2026-11-01", {
				guestCount: 0,
				tableName: "  ",
				receiptNo: undefined,
			}),
			context,
		);
		expect(write.invoice.guest_count).toBeNull();
		expect(write.invoice.table_name).toBeNull();
		expect(write.invoice.receipt_no).toBeNull();
	});

	it("maps line kinds, parents, packages and quantities", () => {
		const { write, flags } = mapSale(
			sale("T-3", "2026-11-01T03:15:00.000Z", "2026-11-01", {
				lines: [
					itemLine("L1", {
						quantity: 2,
						unitPrice: 20_000,
						grossAmount: 40_000,
						netAmount: 40_000,
					}),
					itemLine("L2", {
						lineKind: "modifier",
						itemExternalId: "MOD-ICE",
						itemName: "50% đá",
						baseName: "50% đá",
						sizeLabel: undefined,
						parentLineExternalId: "L1",
						unitPrice: 0,
						grossAmount: 0,
						netAmount: 0,
					}),
					itemLine("P1", {
						itemExternalId: "PKG-1",
						itemName: "Combo",
						baseName: "Combo",
						netAmount: 0,
						grossAmount: 0,
						unitPrice: 0,
					}),
					itemLine("P1-A", {
						lineKind: "package_component",
						parentLineExternalId: "P1",
						quantity: 0.5,
					}),
					itemLine("P2-A", { lineKind: "package_component" }),
				],
			}),
			context,
		);
		const [first, modifier, pack, component, orphan] = write.lines;
		expect(first).toMatchObject({
			line_kind: "item",
			quantity: "2.000",
			unit_price: "20000.00",
			parent_line_external_id: null,
			package_external_id: null,
			item_class_name: "Đồ uống",
			item_class_external_id: null,
			list_unit_price: null,
		});
		expect(modifier).toMatchObject({
			line_kind: "modifier",
			parent_line_external_id: "L1",
			size_label: null,
			net_amount: "0.00",
		});
		expect(pack).toMatchObject({
			line_kind: "item",
			item_external_id: "PKG-1",
		});
		expect(component).toMatchObject({
			line_kind: "item",
			package_external_id: "PKG-1",
			quantity: "0.500",
		});
		expect(orphan?.package_external_id).toBeNull();
		expect(flags.map((flag) => flag.code)).toEqual([
			"package_component_without_parent",
		]);
	});

	it("numbers payments in list order and keeps the business date on each", () => {
		const { write } = mapSale(
			sale("T-4", "2026-11-01T03:15:00.000Z", "2026-11-01", {
				payments: [
					cashPayment(15_000),
					cashPayment(30_000, {
						methodExternalId: "PM-MOMO",
						methodName: "MoMo",
						kind: "ewallet",
						referenceNo: "REF-1",
						feeAmount: 330,
					}),
				],
			}),
			context,
		);
		expect(
			write.payments.map((payment) => [
				payment.sequence_no,
				payment.payment_method_external_id,
				payment.amount,
				payment.fee_amount,
				payment.reference_no,
				payment.business_date,
			]),
		).toEqual([
			[1, "PM-CASH", "15000.00", "0.00", null, "2026-11-01"],
			[2, "PM-MOMO", "30000.00", "330.00", "REF-1", "2026-11-01"],
		]);
		expect(write.invoice.primary_payment_method_external_id).toBe("PM-MOMO");
	});

	it("keeps repeated line ids apart and flags them", () => {
		const { write, flags } = mapSale(
			sale("T-5", "2026-11-01T03:15:00.000Z", "2026-11-01", {
				lines: [itemLine("L1"), itemLine("L1")],
			}),
			context,
		);
		expect(write.lines.map((line) => line.external_id)).toEqual(["L1", "L1#2"]);
		expect(flags[0]?.code).toBe("duplicate_line_id");
	});
});

describe("mapCatalog", () => {
	it("classifies payment kinds, resolves item classes and gates costs", () => {
		const catalog = mergeCatalogs([
			{
				...EMPTY_CATALOG,
				itemClasses: [{ externalId: "CLS-1", name: "Đồ uống" }],
				items: [
					{
						externalId: "ITEM-1",
						name: "Trà đào (M)",
						baseName: "Trà đào",
						sizeLabel: "M",
						itemTypeExternalId: "TYPE-1",
						itemClassName: "Đồ uống",
						listPrice: 45_000,
						costPrice: 12_000,
						isModifier: false,
						active: true,
					},
				],
				paymentMethods: [
					{ externalId: "PM-2", name: "Chuyển khoản", kind: "other" },
					{ externalId: "PM-1", name: "Quầy riêng", kind: "card" },
				],
			},
			{
				...EMPTY_CATALOG,
				paymentMethods: [
					{ externalId: "PM-1", name: "Duplicate", kind: "cash" },
				],
			},
		]);
		const write = mapCatalog(catalog, {
			tenantId: "t",
			posAccountId: "a",
			includeCosts: false,
		});
		expect(write.payment_methods).toEqual([
			{ external_id: "PM-1", name: "Quầy riêng", kind: "card", raw: null },
			{
				external_id: "PM-2",
				name: "Chuyển khoản",
				kind: "bank_transfer",
				raw: null,
			},
		]);
		expect(write.items?.[0]).toMatchObject({
			item_class_external_id: "CLS-1",
			list_price: "45000.00",
			cost_price: null,
			size_label: "M",
		});
		expect(write.units).toBeNull();
		expect(write.devices).toBeNull();
		const withCosts = mapCatalog(catalog, {
			tenantId: "t",
			posAccountId: "a",
			includeCosts: true,
		});
		expect(withCosts.items?.[0]?.cost_price).toBe("12000.00");
	});
});
