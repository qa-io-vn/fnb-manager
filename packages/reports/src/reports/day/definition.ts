import {
	type CardDefinition,
	type ReportDefinition,
	withNoDataNotice,
} from "../../definition.js";
import { avgTicketCard } from "./cards/avg-ticket.js";
import { discountsCard } from "./cards/discounts.js";
import { hourlyCard } from "./cards/hourly.js";
import { invoicesCard } from "./cards/invoices.js";
import { membersCard } from "./cards/members.js";
import { netRevenueCard } from "./cards/net-revenue.js";
import { paymentsCard } from "./cards/payments.js";
import { shiftsCard } from "./cards/shifts.js";
import { topItemsCard } from "./cards/top-items.js";
import { dayKeys } from "./keys.js";
import { DAY_SLUG, dayFollowUpCalls, dayPrimaryCalls } from "./support.js";

export const dayCards: readonly CardDefinition[] = [
	netRevenueCard,
	invoicesCard,
	avgTicketCard,
	hourlyCard,
	topItemsCard,
	paymentsCard,
	shiftsCard,
	discountsCard,
	membersCard,
].map((card) => withNoDataNotice(card, dayKeys.noDataNotice));

export const dayReport: ReportDefinition = {
	kind: "day",
	slug: DAY_SLUG,
	titleKey: dayKeys.title,
	cards: dayCards,
	primaryCalls: dayPrimaryCalls,
	followUpCalls: dayFollowUpCalls,
};
