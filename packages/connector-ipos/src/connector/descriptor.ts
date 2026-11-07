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
		adjustments: false,
		controlTotals: true,
		customers: true,
		guestCount: true,
		costs: false,
	}),
	credentialsSchema: iposCredentialsSchema,
	notes: [
		"adjustments is false: edited/cancelled invoices (CMS report C05) and removed items (C08) are not captured yet; fetchAdjustments throws ConnectorCapabilityError.",
		"costs is false: the item master carries cost_price 0 or null, so item costs are left to the application's manual cost table.",
		"The business-day start comes from each store's open_at (whole hours) in the login payload unless the dayStartMinutes option overrides it; iPOS cannot express a day start that is not a whole hour.",
		"Control totals come from the sale-summary days view queried with local-midnight instants and store_open_at in hours; each row is labelled by its date field. Sales, lines and payments come from the accounting reports filtered by the store's business-day instants.",
		"Shifts are returned as the shifts report scopes them for the store and window (the report keys shifts on their close time, so a shift opened before the window and closed inside it is included); rows without a store id are flagged and dropped.",
		"Price-level promotions (amount_discount_price) are already netted into line amounts and are reported as item discounts; discount_extra_amount is the bill discount; voucher_amount_paid is the voucher amount.",
	],
};
