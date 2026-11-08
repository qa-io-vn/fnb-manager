import { collectSales, type PosConnector } from "@fnb/connector-core";
import {
	checkBusinessDates,
	checkLineSums,
	checkModifiers,
	checkNetComponents,
	checkPayments,
	describeViolations,
} from "@fnb/connector-core/conformance";
import {
	type CanonicalSale,
	type CanonicalStore,
	type DataQualityFlag,
	expectedNetFromComponents,
	moneyEquals,
	shiftIsoDate,
} from "@fnb/core";
import { describe, expect, it } from "vitest";
import { createIposConnector, vietnamDaysAgo } from "../../src/index.js";
import {
	hasAppAccessToken,
	type LiveAccount,
	liveEnabled,
	loadIposAccounts,
	resolveAppAccessToken,
	timed,
} from "./accounts.js";

const accounts = loadIposAccounts();

for (const account of accounts.filter((entry) => !hasAppAccessToken(entry))) {
	console.log(
		`[live] account "${account.key}" skipped: set IPOS_APP_KEY in .env or add appAccessToken to its POS_ACCOUNTS_JSON entry`,
	);
}

const MONEY_TOLERANCE = 1_000;
const RECENT_DAY = vietnamDaysAgo(1);
const VOUCHER_LOOKBACK_DAYS = 35;
const MIN_VOUCHER_INVOICES = 5;

function summariseFlags(flags: readonly DataQualityFlag[]): string {
	const counts = new Map<string, number>();
	for (const flag of flags) {
		counts.set(flag.code, (counts.get(flag.code) ?? 0) + 1);
	}
	return (
		[...counts].map(([code, count]) => `${code}=${count}`).join(" ") || "none"
	);
}

function hasDiscount(sale: CanonicalSale): boolean {
	return (
		sale.voucherAmount > 0 ||
		sale.itemDiscountAmount > 0 ||
		sale.billDiscountAmount > 0 ||
		sale.voucherCode !== undefined
	);
}

interface LiveSession {
	connector: PosConnector;
	stores: CanonicalStore[];
	flags: DataQualityFlag[];
}

async function connect(account: LiveAccount): Promise<LiveSession> {
	const flags: DataQualityFlag[] = [];
	const connector = createIposConnector({ onFlag: (flag) => flags.push(flag) });
	await timed("authenticate", () =>
		connector.authenticate({
			email: account.email,
			password: account.password,
			appAccessToken: resolveAppAccessToken(account),
		}),
	);
	const stores = await timed("discoverStores", () =>
		connector.discoverStores(),
	);
	return { connector, stores, flags };
}

describe.skipIf(!liveEnabled)("iPOS connector live verification", () => {
	for (const [position, account] of accounts.entries()) {
		describe.skipIf(!hasAppAccessToken(account))(
			`account #${position + 1}`,
			() => {
				it("control totals equal emitted sales for one recent day per store and every sale passes the invariants", {
					timeout: 300_000,
				}, async () => {
					const session = await connect(account);
					expect(session.stores.length).toBeGreaterThan(0);
					for (const store of session.stores) {
						const window = { fromDate: RECENT_DAY, toDate: RECENT_DAY };
						const label = `store#${session.stores.indexOf(store) + 1}`;
						const totals = await timed(`${label} fetchControlTotals`, () =>
							session.connector.fetchControlTotals(store, window),
						);
						const sales = await timed(`${label} fetchSales`, () =>
							collectSales(session.connector.fetchSales(store, window)),
						);
						const shifts = await timed(`${label} fetchShifts`, () =>
							session.connector.fetchShifts(store, window),
						);
						const catalog = await timed(`${label} fetchCatalog`, () =>
							session.connector.fetchCatalog(store),
						);
						const total = totals.find((row) => row.businessDate === RECENT_DAY);
						const net = sales.reduce((sum, sale) => sum + sale.netAmount, 0);
						console.log(
							`[live] ${label} ${RECENT_DAY}: sales=${sales.length} controlCount=${total?.invoiceCount ?? "n/a"} netDelta=${Math.abs(net - (total?.netAmount ?? 0))} shifts=${shifts.length} items=${catalog.items.length} modifiers=${catalog.modifiers.length} lines=${sales.reduce((sum, sale) => sum + sale.lines.length, 0)} modifierLines=${sales.reduce((sum, sale) => sum + sale.lines.filter((line) => line.lineKind === "modifier").length, 0)} flags=${session.flags.length} (${summariseFlags(session.flags)})`,
						);
						expect(total).toBeDefined();
						expect(total?.invoiceCount).toBe(sales.length);
						expect(
							moneyEquals(net, total?.netAmount ?? 0, MONEY_TOLERANCE),
						).toBe(true);
						const context = { store, window, moneyTolerance: 1 };
						const violations = [
							...checkBusinessDates(sales, context),
							...checkLineSums(sales, context),
							...checkNetComponents(sales, context),
							...checkModifiers(sales, catalog),
							...checkPayments(sales, context),
						];
						const flaggedSales = new Set(
							session.flags
								.filter((flag) => flag.severity === "warn")
								.map((flag) => flag.saleExternalId),
						);
						const unexplained = violations.filter(
							(violation) =>
								violation.saleExternalId === undefined ||
								!flaggedSales.has(violation.saleExternalId),
						);
						console.log(
							`[live] ${label} invariants: violations=${violations.length} explainedByFlags=${violations.length - unexplained.length}`,
						);
						expect(unexplained, describeViolations(unexplained)).toEqual([]);
					}
				});

				it("confirms the discount decomposition identity on voucher invoices", {
					timeout: 600_000,
				}, async () => {
					const session = await connect(account);
					const store = session.stores[0];
					if (!store) {
						throw new Error("no store discovered");
					}
					const window = {
						fromDate: shiftIsoDate(RECENT_DAY, -VOUCHER_LOOKBACK_DAYS),
						toDate: RECENT_DAY,
					};
					const sales = await timed("fetchSales (lookback)", () =>
						collectSales(session.connector.fetchSales(store, window)),
					);
					const discounted = sales.filter(hasDiscount);
					const withVoucherCode = discounted.filter(
						(sale) => sale.voucherCode !== undefined,
					);
					const identityHolds = discounted.filter((sale) =>
						moneyEquals(expectedNetFromComponents(sale), sale.netAmount, 1),
					);
					console.log(
						`[live] lookback ${VOUCHER_LOOKBACK_DAYS}d: sales=${sales.length} discounted=${discounted.length} withVoucherCode=${withVoucherCode.length} voucherAmountPaid>0=${discounted.filter((sale) => sale.voucherAmount > 0).length} itemDiscount>0=${discounted.filter((sale) => sale.itemDiscountAmount > 0).length} billDiscount>0=${discounted.filter((sale) => sale.billDiscountAmount > 0).length} identityHolds=${identityHolds.length} flags=${session.flags.length} (${summariseFlags(session.flags)})`,
					);
					if (discounted.length === 0) {
						console.log(
							`[live] account #${position + 1} used no discounts or vouchers in the window`,
						);
						return;
					}
					expect(discounted.length).toBeGreaterThanOrEqual(
						MIN_VOUCHER_INVOICES,
					);
					expect(identityHolds.length).toBe(discounted.length);
					expect(
						session.flags.filter((flag) => flag.code === "line_sum_mismatch"),
					).toEqual([]);
				});
			},
		);
	}
});
