import {
	ADJUSTMENT_KINDS,
	adjustmentKey,
	businessDate,
	businessDayEnd,
	businessDayStart,
	type CanonicalAdjustment,
	type CanonicalCatalog,
	type CanonicalDailyTotal,
	type CanonicalLine,
	type CanonicalSale,
	type CanonicalStore,
	canonicalAdjustmentSchema,
	canonicalSaleSchema,
	type DataQualityFlag,
	dataQualityFlagSchema,
	expectedNetFromComponents,
	expectedNetFromLines,
	MILLISECONDS_PER_MINUTE,
	moneyEquals,
	paymentTotal,
	roundMoney,
	sumMoney,
} from "@fnb/core";
import type { BusinessDateWindow } from "../connector.js";
import { isWithinWindow } from "../window.js";

export interface Violation {
	rule: string;
	message: string;
	saleExternalId?: string;
}

export interface CheckContext {
	store: Pick<CanonicalStore, "timezone" | "dayStartMinutes">;
	window: BusinessDateWindow;
	moneyTolerance: number;
}

function violation(
	rule: string,
	message: string,
	saleExternalId?: string,
): Violation {
	return saleExternalId === undefined
		? { rule, message }
		: { rule, message, saleExternalId };
}

export function describeViolations(violations: readonly Violation[]): string {
	const shown = violations.slice(0, 5).map((entry) => {
		const sale = entry.saleExternalId ? ` [sale ${entry.saleExternalId}]` : "";
		return `${entry.rule}: ${entry.message}${sale}`;
	});
	const more =
		violations.length > shown.length
			? `\n… and ${violations.length - shown.length} more`
			: "";
	return `${violations.length} violation(s)\n${shown.join("\n")}${more}`;
}

export function checkSaleSchemas(sales: readonly CanonicalSale[]): Violation[] {
	const violations: Violation[] = [];
	for (const sale of sales) {
		const result = canonicalSaleSchema.safeParse(sale);
		if (!result.success) {
			const first = result.error.issues[0];
			violations.push(
				violation(
					"schema",
					`sale does not match CanonicalSale (${first?.path.join(".") ?? "<root>"}: ${first?.message ?? "invalid"})`,
					sale.externalId,
				),
			);
		}
	}
	return violations;
}

export function checkUniqueIds(sales: readonly CanonicalSale[]): Violation[] {
	const violations: Violation[] = [];
	const seen = new Set<string>();
	for (const sale of sales) {
		if (seen.has(sale.externalId)) {
			violations.push(
				violation("unique-ids", "sale externalId repeats", sale.externalId),
			);
		}
		seen.add(sale.externalId);
		const lineIds = new Set<string>();
		for (const line of sale.lines) {
			if (lineIds.has(line.externalId)) {
				violations.push(
					violation(
						"unique-ids",
						`line externalId "${line.externalId}" repeats inside the sale`,
						sale.externalId,
					),
				);
			}
			lineIds.add(line.externalId);
		}
	}
	return violations;
}

export function checkBusinessDates(
	sales: readonly CanonicalSale[],
	context: CheckContext,
): Violation[] {
	const violations: Violation[] = [];
	for (const sale of sales) {
		if (!isWithinWindow(sale.businessDate, context.window)) {
			violations.push(
				violation(
					"business-date",
					`businessDate ${sale.businessDate} is outside ${context.window.fromDate}..${context.window.toDate}`,
					sale.externalId,
				),
			);
		}
		const derived = businessDate(
			sale.soldAt,
			context.store.timezone,
			context.store.dayStartMinutes,
		);
		if (derived !== sale.businessDate) {
			violations.push(
				violation(
					"business-date",
					`businessDate ${sale.businessDate} but soldAt ${sale.soldAt.toISOString()} falls on ${derived} in ${context.store.timezone} with day start ${context.store.dayStartMinutes} min`,
					sale.externalId,
				),
			);
		}
	}
	return violations;
}

export function checkLineSums(
	sales: readonly CanonicalSale[],
	context: CheckContext,
): Violation[] {
	const violations: Violation[] = [];
	for (const sale of sales) {
		if (sale.lines.length === 0) {
			violations.push(
				violation("line-sums", "sale has no lines", sale.externalId),
			);
			continue;
		}
		const fromLines = expectedNetFromLines(sale);
		if (!moneyEquals(fromLines, sale.netAmount, context.moneyTolerance)) {
			violations.push(
				violation(
					"line-sums",
					`lines net minus bill discount and voucher give ${fromLines}, sale netAmount is ${sale.netAmount}`,
					sale.externalId,
				),
			);
		}
	}
	return violations;
}

export function checkNetComponents(
	sales: readonly CanonicalSale[],
	context: CheckContext,
): Violation[] {
	const violations: Violation[] = [];
	for (const sale of sales) {
		const fromComponents = expectedNetFromComponents(sale);
		if (!moneyEquals(fromComponents, sale.netAmount, context.moneyTolerance)) {
			violations.push(
				violation(
					"net-components",
					`gross − item − bill − voucher + service + shipping + VAT gives ${fromComponents}, sale netAmount is ${sale.netAmount}`,
					sale.externalId,
				),
			);
		}
	}
	return violations;
}

export function checkLinelessSales(
	sales: readonly CanonicalSale[],
): Violation[] {
	return sales
		.filter((sale) => sale.lines.length > 0)
		.map((sale) =>
			violation(
				"no-lines",
				`the lines capability is declared false but the sale carries ${sale.lines.length} line(s)`,
				sale.externalId,
			),
		);
}

interface CatalogModifierIndex {
	modifierItemIds: ReadonlySet<string>;
	plainItemIds: ReadonlySet<string>;
}

function indexCatalogModifiers(
	catalog: CanonicalCatalog | undefined,
): CatalogModifierIndex | undefined {
	if (!catalog) {
		return undefined;
	}
	const modifierItemIds = new Set<string>();
	const plainItemIds = new Set<string>();
	for (const item of catalog.items) {
		(item.isModifier ? modifierItemIds : plainItemIds).add(item.externalId);
	}
	for (const modifier of catalog.modifiers) {
		if (!plainItemIds.has(modifier.externalId)) {
			modifierItemIds.add(modifier.externalId);
		}
	}
	return { modifierItemIds, plainItemIds };
}

function checkModifierMoney(
	line: CanonicalLine,
	saleExternalId: string,
): Violation[] {
	const amounts = [
		line.unitPrice,
		line.grossAmount,
		line.discountAmount,
		line.netAmount,
	];
	return amounts.some((amount) => amount !== 0)
		? [
				violation(
					"modifier-amounts",
					`modifier line "${line.itemName}" carries money (${amounts.join("/")})`,
					saleExternalId,
				),
			]
		: [];
}

function checkModifierParent(
	line: CanonicalLine,
	byId: ReadonlyMap<string, CanonicalLine>,
	saleExternalId: string,
): Violation[] {
	if (line.parentLineExternalId === undefined) {
		return [];
	}
	const parent = byId.get(line.parentLineExternalId);
	if (!parent) {
		return [
			violation(
				"modifier-parent",
				`modifier "${line.itemName}" points to a missing parent line ${line.parentLineExternalId}`,
				saleExternalId,
			),
		];
	}
	if (parent.lineKind === "modifier") {
		return [
			violation(
				"modifier-parent",
				`modifier "${line.itemName}" is attached to another modifier`,
				saleExternalId,
			),
		];
	}
	return [];
}

function checkLineAgainstCatalog(
	line: CanonicalLine,
	index: CatalogModifierIndex,
	saleExternalId: string,
): Violation[] {
	const itemId = line.itemExternalId;
	if (itemId === undefined) {
		return [];
	}
	if (line.lineKind === "modifier" && index.plainItemIds.has(itemId)) {
		return [
			violation(
				"modifier-catalog",
				`modifier line "${line.itemName}" references catalog item ${itemId}, which the catalog does not mark as a modifier`,
				saleExternalId,
			),
		];
	}
	if (line.lineKind !== "modifier" && index.modifierItemIds.has(itemId)) {
		return [
			violation(
				"modifier-catalog",
				`${line.lineKind} line "${line.itemName}" references ${itemId}, which the catalog marks as a modifier`,
				saleExternalId,
			),
		];
	}
	return [];
}

export function checkModifiers(
	sales: readonly CanonicalSale[],
	catalog?: CanonicalCatalog,
): Violation[] {
	const violations: Violation[] = [];
	const index = indexCatalogModifiers(catalog);
	for (const sale of sales) {
		const byId = new Map(sale.lines.map((line) => [line.externalId, line]));
		for (const line of sale.lines) {
			if (index) {
				violations.push(
					...checkLineAgainstCatalog(line, index, sale.externalId),
				);
			}
			if (line.lineKind !== "modifier") {
				continue;
			}
			violations.push(...checkModifierMoney(line, sale.externalId));
			violations.push(...checkModifierParent(line, byId, sale.externalId));
		}
	}
	return violations;
}

export function checkModifierPresence(
	sales: readonly CanonicalSale[],
	catalog: CanonicalCatalog,
): Violation[] {
	const catalogHasModifiers =
		catalog.modifiers.length > 0 ||
		catalog.items.some((item) => item.isModifier);
	const emitted = sales.some((sale) =>
		sale.lines.some((line) => line.lineKind === "modifier"),
	);
	return catalogHasModifiers && sales.length > 0 && !emitted
		? [
				violation(
					"modifier-presence",
					"the catalog lists modifiers and the modifiers capability is declared, but no modifier line was emitted in the window",
				),
			]
		: [];
}

export function checkPayments(
	sales: readonly CanonicalSale[],
	context: CheckContext,
): Violation[] {
	const violations: Violation[] = [];
	for (const sale of sales) {
		const total = paymentTotal(sale);
		if (!moneyEquals(total, sale.paidAmount, context.moneyTolerance)) {
			violations.push(
				violation(
					"payments-sum",
					`payments sum to ${total}, paidAmount is ${sale.paidAmount}`,
					sale.externalId,
				),
			);
		}
	}
	return violations;
}

export interface DailyAggregate {
	count: number;
	net: number;
}

export function aggregateByBusinessDate(
	sales: readonly CanonicalSale[],
): Map<string, DailyAggregate> {
	const totals = new Map<string, DailyAggregate>();
	for (const sale of sales) {
		if (sale.status === "voided") {
			continue;
		}
		const current = totals.get(sale.businessDate) ?? { count: 0, net: 0 };
		totals.set(sale.businessDate, {
			count: current.count + 1,
			net: roundMoney(current.net + sale.netAmount),
		});
	}
	return totals;
}

export function checkControlTotals(
	sales: readonly CanonicalSale[],
	controlTotals: readonly CanonicalDailyTotal[],
	context: CheckContext,
): Violation[] {
	const violations: Violation[] = [];
	const emitted = aggregateByBusinessDate(sales);
	const seen = new Set<string>();
	for (const total of controlTotals) {
		if (!isWithinWindow(total.businessDate, context.window)) {
			violations.push(
				violation(
					"control-totals",
					`control total for ${total.businessDate} lies outside the window`,
				),
			);
			continue;
		}
		seen.add(total.businessDate);
		const actual = emitted.get(total.businessDate) ?? { count: 0, net: 0 };
		if (actual.count !== total.invoiceCount) {
			violations.push(
				violation(
					"control-totals",
					`${total.businessDate}: control says ${total.invoiceCount} sales, connector emitted ${actual.count}`,
				),
			);
		}
		if (!moneyEquals(actual.net, total.netAmount, context.moneyTolerance)) {
			violations.push(
				violation(
					"control-totals",
					`${total.businessDate}: control net ${total.netAmount}, emitted net ${actual.net}`,
				),
			);
		}
	}
	for (const [date, actual] of emitted) {
		if (!seen.has(date) && actual.count > 0) {
			violations.push(
				violation(
					"control-totals",
					`${date}: ${actual.count} sales emitted but no control total for that date`,
				),
			);
		}
	}
	return violations;
}

function saleSignature(sale: CanonicalSale): string {
	const lineIds = sale.lines.map((line) => line.externalId).join(",");
	const payments = sale.payments
		.map((payment) => `${payment.methodExternalId}=${payment.amount}`)
		.sort()
		.join(",");
	return `${sale.externalId}|${sale.netAmount}|${sale.businessDate}|${lineIds}|${sale.payments.length}:${payments}`;
}

function sortedSignatures(sales: readonly CanonicalSale[]): string[] {
	return sales.map(saleSignature).sort();
}

function compareSignatures(
	rule: string,
	left: readonly CanonicalSale[],
	right: readonly CanonicalSale[],
	leftLabel: string,
	rightLabel: string,
): Violation[] {
	const leftSignatures = sortedSignatures(left);
	const rightSignatures = sortedSignatures(right);
	if (leftSignatures.length !== rightSignatures.length) {
		return [
			violation(
				rule,
				`${leftLabel} emitted ${leftSignatures.length} sales, ${rightLabel} emitted ${rightSignatures.length}`,
			),
		];
	}
	const violations: Violation[] = [];
	for (let index = 0; index < leftSignatures.length; index += 1) {
		if (leftSignatures[index] !== rightSignatures[index]) {
			violations.push(
				violation(
					rule,
					`${leftLabel} and ${rightLabel} differ at position ${index}: ${leftSignatures[index]} vs ${rightSignatures[index]}`,
				),
			);
			if (violations.length >= 5) {
				break;
			}
		}
	}
	return violations;
}

export function checkStableIds(
	firstRun: readonly CanonicalSale[],
	secondRun: readonly CanonicalSale[],
): Violation[] {
	return compareSignatures(
		"stable-ids",
		firstRun,
		secondRun,
		"first run",
		"second run",
	);
}

export function checkPaginationCompleteness(
	whole: readonly CanonicalSale[],
	perDayUnion: readonly CanonicalSale[],
): Violation[] {
	return compareSignatures(
		"pagination",
		whole,
		perDayUnion,
		"whole window",
		"union of single-day windows",
	);
}

export function checkWindowEdges(
	whole: readonly CanonicalSale[],
	edgeDaySales: { date: string; sales: readonly CanonicalSale[] }[],
	expectSalesOnEdges: boolean,
): Violation[] {
	const violations: Violation[] = [];
	for (const edge of edgeDaySales) {
		const fromWhole = whole.filter((sale) => sale.businessDate === edge.date);
		violations.push(
			...compareSignatures(
				"window-edges",
				fromWhole,
				edge.sales,
				`whole window on ${edge.date}`,
				`single-day window ${edge.date}`,
			),
		);
		if (expectSalesOnEdges && edge.sales.length === 0) {
			violations.push(
				violation(
					"window-edges",
					`no sales were emitted for the window edge ${edge.date}`,
				),
			);
		}
		const outside = edge.sales.filter(
			(sale) => sale.businessDate !== edge.date,
		);
		if (outside.length > 0) {
			violations.push(
				violation(
					"window-edges",
					`${outside.length} sale(s) outside ${edge.date} came back from its single-day window`,
				),
			);
		}
	}
	return violations;
}

export function checkBoundarySales(
	sales: readonly CanonicalSale[],
	dates: readonly string[],
	context: CheckContext,
	marginMinutes: number,
): Violation[] {
	const violations: Violation[] = [];
	const margin = marginMinutes * MILLISECONDS_PER_MINUTE;
	for (const date of dates) {
		const start = businessDayStart(
			date,
			context.store.timezone,
			context.store.dayStartMinutes,
		).getTime();
		const end = businessDayEnd(
			date,
			context.store.timezone,
			context.store.dayStartMinutes,
		).getTime();
		const onDate = sales.filter((sale) => sale.businessDate === date);
		const nearStart = onDate.some(
			(sale) => sale.soldAt.getTime() - start <= margin,
		);
		const nearEnd = onDate.some(
			(sale) => end - sale.soldAt.getTime() <= margin,
		);
		if (!nearStart) {
			violations.push(
				violation(
					"boundary-sales",
					`${date}: no sale within ${marginMinutes} min after the business day start; the first hour may have been dropped`,
				),
			);
		}
		if (!nearEnd) {
			violations.push(
				violation(
					"boundary-sales",
					`${date}: no sale within ${marginMinutes} min before the business day end; the last hour may have been dropped`,
				),
			);
		}
	}
	return violations;
}

export function checkNetTotals(
	sales: readonly CanonicalSale[],
	context: CheckContext,
): Violation[] {
	const paid = sumMoney(sales.map((sale) => sale.paidAmount));
	const net = sumMoney(sales.map((sale) => sale.netAmount));
	return moneyEquals(
		paid,
		net,
		context.moneyTolerance * Math.max(1, sales.length),
	)
		? []
		: [
				violation(
					"paid-vs-net",
					`window paid total ${paid} differs from net total ${net}`,
				),
			];
}

function describeAdjustment(adjustment: CanonicalAdjustment): string {
	const line = adjustment.lineExternalId
		? ` line ${adjustment.lineExternalId}`
		: "";
	return `${adjustment.kind}${line} at ${adjustment.occurredAt.toISOString()}`;
}

function checkAdjustmentShape(
	adjustment: CanonicalAdjustment,
	position: number,
): Violation[] {
	const result = canonicalAdjustmentSchema.safeParse(adjustment);
	if (result.success) {
		return [];
	}
	const first = result.error.issues[0];
	return [
		violation(
			"adjustment-schema",
			`adjustment #${position} does not match CanonicalAdjustment (${first?.path.join(".") ?? "<root>"}: ${first?.message ?? "invalid"})`,
		),
	];
}

function checkAdjustmentFields(
	adjustment: CanonicalAdjustment,
	context: CheckContext,
): Violation[] {
	const violations: Violation[] = [];
	const saleExternalId = adjustment.saleExternalId;
	if (typeof saleExternalId !== "string" || saleExternalId.trim() === "") {
		violations.push(
			violation(
				"adjustment-sale",
				`${describeAdjustment(adjustment)} references no sale external id`,
			),
		);
	}
	if (!ADJUSTMENT_KINDS.includes(adjustment.kind)) {
		violations.push(
			violation(
				"adjustment-kind",
				`kind "${String(adjustment.kind)}" is not one of ${ADJUSTMENT_KINDS.join(", ")}`,
				saleExternalId,
			),
		);
	}
	const date = businessDate(
		adjustment.occurredAt,
		context.store.timezone,
		context.store.dayStartMinutes,
	);
	if (!isWithinWindow(date, context.window)) {
		violations.push(
			violation(
				"adjustment-window",
				`${describeAdjustment(adjustment)} falls on ${date}, outside ${context.window.fromDate}..${context.window.toDate}`,
				saleExternalId,
			),
		);
	}
	if (adjustment.amount !== undefined && adjustment.amount < 0) {
		violations.push(
			violation(
				"adjustment-amount",
				`${describeAdjustment(adjustment)} carries a negative amount ${adjustment.amount}`,
				saleExternalId,
			),
		);
	}
	if (adjustment.kind === "line_removed") {
		if (!adjustment.lineExternalId) {
			violations.push(
				violation(
					"adjustment-line",
					`${describeAdjustment(adjustment)} names no removed line`,
					saleExternalId,
				),
			);
		}
		if (adjustment.quantity === undefined || adjustment.quantity <= 0) {
			violations.push(
				violation(
					"adjustment-line",
					`${describeAdjustment(adjustment)} has no positive removed quantity`,
					saleExternalId,
				),
			);
		}
	}
	return violations;
}

export function checkAdjustments(
	adjustments: readonly CanonicalAdjustment[],
	context: CheckContext,
): Violation[] {
	const violations: Violation[] = [];
	const seen = new Set<string>();
	adjustments.forEach((adjustment, position) => {
		violations.push(...checkAdjustmentShape(adjustment, position));
		violations.push(...checkAdjustmentFields(adjustment, context));
		const key = adjustmentKey(adjustment);
		if (seen.has(key)) {
			violations.push(
				violation(
					"adjustment-duplicates",
					`${describeAdjustment(adjustment)} repeats`,
					adjustment.saleExternalId,
				),
			);
		}
		seen.add(key);
	});
	return violations;
}

export function checkFlags(flags: readonly DataQualityFlag[]): Violation[] {
	const violations: Violation[] = [];
	flags.forEach((flag, position) => {
		const result = dataQualityFlagSchema.safeParse(flag);
		if (!result.success) {
			const first = result.error.issues[0];
			violations.push(
				violation(
					"flags",
					`flag #${position} does not match DataQualityFlag (${first?.path.join(".") ?? "<root>"}: ${first?.message ?? "invalid"})`,
				),
			);
		}
	});
	return violations;
}
