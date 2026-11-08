import { type ConnectorDescriptor, capabilities } from "@fnb/connector-core";
import { iposCredentialsSchema } from "./credentials.js";

export const IPOS_CONNECTOR_ID = "ipos-fabi";

export const iposDescriptor: ConnectorDescriptor = {
	id: IPOS_CONNECTOR_ID,
	label: "iPOS Fabi",
	capabilities: capabilities({
		lines: true,
		modifiers: true,
		payments: true,
		shifts: true,
		adjustments: true,
		controlTotals: true,
		customers: true,
		guestCount: true,
		costs: false,
	}),
	credentialsSchema: iposCredentialsSchema,
	notes: [
		"Adjustments come from the CMS reports C05 (edited/cancelled invoices: status DELETE becomes voided with the pre-cancel amount, status EDIT becomes edited with the absolute amount difference and the origin invoice in relatedSaleExternalId) and C08 (removed items: each sale_detail line with a negative quantity becomes one line_removed adjustment). An adjustment belongs to the window by the business date of its cancel, edit or removal time, not of the bill.",
		"The EDIT linkage (origin_tran_id, falling back to first_origin_tran_id) was inferred from the CMS export columns and confirmed by the two live EDIT rows seen so far, one of which increased the bill; the edited amount is therefore |before − after| and the direction is read from raw (total_amount_origin versus total_amount). An EDIT row without any origin reference raises an edit_without_origin flag and is still emitted.",
		"Voided bills are absent from the accounting sale report, so a voided adjustment references a sale the sales sync never stores; an edited bill's tran_id is in the sale report with the post-edit total while its origin invoice is not; a removed line's order appears in the sale report only when it was later paid.",
		"C05 refuses ranges longer than three months (HTTP 500), C08 only accepts start and end dates inside one calendar month (HTTP 400) and serves fixed pages of 20 events without a total, so the connector splits both queries per calendar month in the store's timezone and reads C08 pages until a short one.",
		"Most removed C08 lines carry the _REMOVE suffix on id_sale_detail, but live data also contains removed lines (negative quantity, sort_index −1) without it; those are emitted as line_removed and raise an informational removed_line_without_suffix flag. The removed amount is price × |quantity| and excludes toppings, which stay in raw.",
		"costs is false: the item master carries cost_price 0 or null, so item costs are left to the application's manual cost table.",
		"The business-day start comes from each store's open_at (whole hours) in the login payload unless the dayStartMinutes option overrides it; iPOS cannot express a day start that is not a whole hour.",
		"Control totals come from the sale-summary days view queried with local-midnight instants and store_open_at in hours; each row is labelled by its date field. Sales, lines and payments come from the accounting reports filtered by the store's business-day instants.",
		"Shifts are returned as the shifts report scopes them for the store and window (the report keys shifts on their close time, so a shift opened before the window and closed inside it is included); rows without a store id are flagged and dropped.",
		"Price-level promotions (amount_discount_price) are already netted into line amounts and are reported as item discounts; discount_extra_amount is the bill discount; voucher_amount_paid is the voucher amount.",
	],
};
