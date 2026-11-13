import type {
	ItemTypeRole,
	PaymentKindValue,
	PromotionKind,
} from "../contract/values.js";
import type { ReportKind } from "../period/periods.js";
import type {
	ComparisonKind,
	NoticeAction,
	UnavailableReason,
} from "./card.js";
import type { DriverDimension } from "./narrative.js";

const driverDimensions = [
	"store",
	"hour",
	"weekday",
	"day",
	"month",
	"item",
	"category",
	"promotion",
	"payment",
	"cashier",
] as const satisfies readonly DriverDimension[];

const unavailableReasons = [
	"no_data",
	"store_too_young",
	"no_reference",
	"not_measured",
	"not_configured",
	"building_baseline",
] as const satisfies readonly UnavailableReason[];

const comparisonKinds = [
	"previous",
	"last_year",
	"baseline",
	"average_4_weeks",
	"forecast",
	"target",
] as const satisfies readonly ComparisonKind[];

export const reportKeys = {
	compare: {
		previous: {
			day: "report.compare.previous.day",
			week: "report.compare.previous.week",
			month: "report.compare.previous.month",
			year: "report.compare.previous.year",
		},
		lastYear: {
			day: "report.compare.lastYear.day",
			week: "report.compare.lastYear.week",
			month: "report.compare.lastYear.month",
			year: "report.compare.lastYear.year",
		},
		baseline: "report.compare.baseline",
		baselinePartial: "report.compare.baselinePartial",
		average4Weeks: "report.compare.average4Weeks",
		forecast: {
			weekdayProfile: "report.compare.forecast.weekdayProfile",
			seasonalNaive: "report.compare.forecast.seasonalNaive",
		},
		target: "report.compare.target",
		likeForLike: "report.compare.likeForLike",
	},
	decomposition: {
		net: "report.decomposition.net",
		ticket: "report.decomposition.ticket",
	},
	clause: {
		driver: {
			store: "report.clause.driver.store",
			storeAgainst: "report.clause.driver.storeAgainst",
			hour: "report.clause.driver.hour",
			hourAgainst: "report.clause.driver.hourAgainst",
			weekday: "report.clause.driver.weekday",
			weekdayAgainst: "report.clause.driver.weekdayAgainst",
			day: "report.clause.driver.day",
			dayAgainst: "report.clause.driver.dayAgainst",
			month: "report.clause.driver.month",
			monthAgainst: "report.clause.driver.monthAgainst",
			item: "report.clause.driver.item",
			itemAgainst: "report.clause.driver.itemAgainst",
			category: "report.clause.driver.category",
			categoryAgainst: "report.clause.driver.categoryAgainst",
			promotion: "report.clause.driver.promotion",
			promotionAgainst: "report.clause.driver.promotionAgainst",
			payment: "report.clause.driver.payment",
			paymentAgainst: "report.clause.driver.paymentAgainst",
			cashier: "report.clause.driver.cashier",
			cashierAgainst: "report.clause.driver.cashierAgainst",
			storeHighestTicket: "report.clause.driver.storeHighestTicket",
		},
		decomposition: {
			invoices: "report.clause.decomposition.invoices",
			items_per_ticket: "report.clause.decomposition.items_per_ticket",
			avg_item_price: "report.clause.decomposition.avg_item_price",
		},
		decompositionReference: {
			invoices: "report.clause.decompositionReference.invoices",
			items_per_ticket: "report.clause.decompositionReference.items_per_ticket",
			avg_item_price: "report.clause.decompositionReference.avg_item_price",
		},
		coverage: {
			youngStore: "report.clause.coverage.youngStore",
			likeForLike: "report.clause.coverage.likeForLike",
			likeForLikeValues: "report.clause.coverage.likeForLikeValues",
		},
		tet: {
			shift: "report.clause.tet.shift",
		},
	},
	marker: {
		stale: "report.marker.stale",
	},
	value: {
		points: "report.value.points",
		isoWeek: "report.value.isoWeek",
	},
	holiday: {
		tet: "report.holiday.tet",
		public: "report.holiday.public",
		custom: "report.holiday.custom",
	},
	action: {
		settings_roles: "report.action.settings_roles",
		settings_targets: "report.action.settings_targets",
		today: "report.action.today",
	},
	page: {
		todayClamped: "report.page.todayClamped",
		notStarted: "report.page.notStarted",
	},
	print: {
		summary: "report.print.summary",
	},
	tabs: {
		label: "report.tabs.label",
	},
	table: {
		store: "report.table.store",
		period: "report.table.period",
		date: "report.table.date",
		weekday: "report.table.weekday",
		month: "report.table.month",
		hour: "report.table.hour",
		item: "report.table.item",
		category: "report.table.category",
		quantity: "report.table.quantity",
		netAmount: "report.table.netAmount",
		invoices: "report.table.invoices",
		avgTicket: "report.table.avgTicket",
		itemsPerTicket: "report.table.itemsPerTicket",
		avgItemPrice: "report.table.avgItemPrice",
		share: "report.table.share",
		change: "report.table.change",
		changePoints: "report.table.changePoints",
		baseline: "report.table.baseline",
		previous: "report.table.previous",
		lastYear: "report.table.lastYear",
		state: "report.table.state",
		current: "report.table.current",
		difference: "report.table.difference",
		baselineInvoices: "report.table.baselineInvoices",
		method: "report.table.method",
		paymentKind: "report.table.paymentKind",
		amount: "report.table.amount",
		cashier: "report.table.cashier",
		shift: "report.table.shift",
		openedAt: "report.table.openedAt",
		closedAt: "report.table.closedAt",
		cashSales: "report.table.cashSales",
		expectedCash: "report.table.expectedCash",
		drawer: "report.table.drawer",
		variance: "report.table.variance",
		zScore: "report.table.zScore",
		reasons: "report.table.reasons",
		promotion: "report.table.promotion",
		promotionKind: "report.table.promotionKind",
		discount: "report.table.discount",
		costShare: "report.table.costShare",
		component: "report.table.component",
		memberInvoices: "report.table.memberInvoices",
		memberShare: "report.table.memberShare",
		captureRate: "report.table.captureRate",
		role: "report.table.role",
		from: "report.table.from",
		to: "report.table.to",
		days: "report.table.days",
	},
	paymentKind: {
		cash: "report.paymentKind.cash",
		card: "report.paymentKind.card",
		bank_transfer: "report.paymentKind.bank_transfer",
		ewallet: "report.paymentKind.ewallet",
		voucher: "report.paymentKind.voucher",
		other: "report.paymentKind.other",
	},
	promotionKind: {
		item: "report.promotionKind.item",
		bill: "report.promotionKind.bill",
		voucher: "report.promotionKind.voucher",
	},
	shiftReasons: {
		absolute: "report.shiftReasons.absolute",
		relative: "report.shiftReasons.relative",
		z_score: "report.shiftReasons.z_score",
		absolute_relative: "report.shiftReasons.absolute_relative",
		absolute_z_score: "report.shiftReasons.absolute_z_score",
		relative_z_score: "report.shiftReasons.relative_z_score",
		absolute_relative_z_score: "report.shiftReasons.absolute_relative_z_score",
	},
	role: {
		drink: "report.role.drink",
		topping: "report.role.topping",
		food: "report.role.food",
		snack: "report.role.snack",
		other: "report.role.other",
		unmapped: "report.role.unmapped",
	},
	label: {
		unknownCashier: "report.label.unknownCashier",
		unnamed: "report.label.unnamed",
		uncategorised: "report.label.uncategorised",
	},
	periodRow: {
		current: "report.periodRow.current",
		previous: "report.periodRow.previous",
		lastYear: "report.periodRow.lastYear",
		baseline: "report.periodRow.baseline",
		average4Weeks: "report.periodRow.average4Weeks",
	},
} as const;

export function unavailableKey(
	reason: UnavailableReason,
	kind: ComparisonKind,
): string {
	return `report.unavailable.${reason}.${kind}`;
}

export function previousLabelKey(kind: ReportKind): string {
	return reportKeys.compare.previous[kind];
}

export function lastYearLabelKey(kind: ReportKind): string {
	return reportKeys.compare.lastYear[kind];
}

export function driverClauseKey(
	dimension: DriverDimension,
	against: boolean,
): string {
	return `report.clause.driver.${dimension}${against ? "Against" : ""}`;
}

export function decompositionClauseKey(
	factor: keyof typeof reportKeys.clause.decomposition,
): string {
	return reportKeys.clause.decomposition[factor];
}

export function decompositionReferenceClauseKey(
	factor: keyof typeof reportKeys.clause.decompositionReference,
): string {
	return reportKeys.clause.decompositionReference[factor];
}

export function actionKey(action: NoticeAction): string {
	return reportKeys.action[action];
}

export function paymentKindKey(kind: PaymentKindValue): string {
	return reportKeys.paymentKind[kind];
}

export function promotionKindKey(kind: PromotionKind): string {
	return reportKeys.promotionKind[kind];
}

export function roleKey(role: ItemTypeRole | null): string {
	return role === null ? reportKeys.role.unmapped : reportKeys.role[role];
}

const SHIFT_REASON_ORDER = ["absolute", "relative", "z_score"] as const;

export function shiftReasonsKey(
	reasons: readonly string[] | null,
): string | null {
	const present = SHIFT_REASON_ORDER.filter((reason) =>
		(reasons ?? []).includes(reason),
	);
	if (present.length === 0) return null;
	return reportKeys.shiftReasons[
		present.join("_") as keyof typeof reportKeys.shiftReasons
	];
}

function collectStrings(value: unknown, into: string[]): void {
	if (typeof value === "string") {
		into.push(value);
		return;
	}
	if (value !== null && typeof value === "object") {
		for (const nested of Object.values(value)) {
			collectStrings(nested, into);
		}
	}
}

export function sharedReportKeys(): readonly string[] {
	const keys: string[] = [];
	collectStrings(reportKeys, keys);
	for (const dimension of driverDimensions) {
		keys.push(
			driverClauseKey(dimension, false),
			driverClauseKey(dimension, true),
		);
	}
	for (const reason of unavailableReasons) {
		for (const kind of comparisonKinds) {
			keys.push(unavailableKey(reason, kind));
		}
	}
	return [...new Set(keys)];
}

export const DRIVER_DIMENSIONS = driverDimensions;
export const UNAVAILABLE_REASONS = unavailableReasons;
export const COMPARISON_KINDS = comparisonKinds;
