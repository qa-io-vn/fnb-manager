import {
	type CanonicalCatalog,
	type CanonicalDailyTotal,
	type CanonicalSale,
	type CanonicalStore,
	canonicalAdjustmentSchema,
	canonicalCatalogSchema,
	canonicalDailyTotalSchema,
	canonicalShiftSchema,
	canonicalStoreSchema,
	type DataQualityFlag,
} from "@fnb/core";
import { beforeAll, describe, expect, it } from "vitest";
import {
	type BusinessDateWindow,
	CAPABILITY_NAMES,
	collectSales,
	type FetchContext,
	type PosConnector,
} from "../connector.js";
import { ConnectorCapabilityError } from "../errors.js";
import { singleDayWindow, windowDates } from "../window.js";
import {
	type CheckContext,
	checkAdjustments,
	checkBoundarySales,
	checkBusinessDates,
	checkControlTotals,
	checkFlags,
	checkLinelessSales,
	checkLineSums,
	checkModifierPresence,
	checkModifiers,
	checkNetComponents,
	checkNetTotals,
	checkPaginationCompleteness,
	checkPayments,
	checkSaleSchemas,
	checkStableIds,
	checkUniqueIds,
	checkWindowEdges,
	describeViolations,
	type Violation,
} from "./checks.js";

export interface ConformanceOptions {
	credentials: unknown;
	window: BusinessDateWindow;
	storeExternalId?: string;
	moneyTolerance?: number;
	expectSalesOnEdges?: boolean;
	expectBoundarySales?: boolean;
	boundaryMarginMinutes?: number;
	expectFullyPaid?: boolean;
	expectAdjustments?: boolean;
	timeoutMs?: number;
}

interface LoadedState {
	store: CanonicalStore;
	catalog: CanonicalCatalog;
	firstRun: CanonicalSale[];
	secondRun: CanonicalSale[];
	perDay: { date: string; sales: CanonicalSale[] }[];
	controlTotals: CanonicalDailyTotal[] | null;
	flags: DataQualityFlag[];
	context: CheckContext;
}

const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_BOUNDARY_MARGIN_MINUTES = 60;

function expectClean(violations: Violation[]): void {
	expect(violations, describeViolations(violations)).toEqual([]);
}

function pickStore(
	stores: CanonicalStore[],
	storeExternalId: string | undefined,
): CanonicalStore {
	const store =
		storeExternalId === undefined
			? stores[0]
			: stores.find((candidate) => candidate.externalId === storeExternalId);
	if (!store) {
		throw new Error(
			storeExternalId === undefined
				? "discoverStores returned no store"
				: `discoverStores returned no store with externalId ${storeExternalId}`,
		);
	}
	return store;
}

function edgeDates(window: BusinessDateWindow): string[] {
	const dates = windowDates(window);
	const first = dates[0];
	const last = dates[dates.length - 1];
	return [...new Set([first, last])].filter(
		(date): date is string => date !== undefined,
	);
}

export function runConnectorConformanceSuite(
	name: string,
	factory: () => PosConnector,
	options: ConformanceOptions,
): void {
	const timeout = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
	const moneyTolerance = options.moneyTolerance ?? 1;
	const expectSalesOnEdges = options.expectSalesOnEdges ?? true;
	const expectBoundarySales = options.expectBoundarySales ?? true;
	const boundaryMarginMinutes =
		options.boundaryMarginMinutes ?? DEFAULT_BOUNDARY_MARGIN_MINUTES;
	const expectFullyPaid = options.expectFullyPaid ?? false;
	const expectAdjustments = options.expectAdjustments ?? true;

	describe(`${name} conformance`, () => {
		const connector = factory();
		const descriptor = connector.describe();
		const capabilities = descriptor.capabilities;
		let loaded: LoadedState | null = null;

		const state = (): LoadedState => {
			if (!loaded) {
				throw new Error("conformance state was not loaded");
			}
			return loaded;
		};

		beforeAll(async () => {
			const flags: DataQualityFlag[] = [];
			const fetchContext: FetchContext = {
				onFlag: (flag) => flags.push(flag),
			};
			await connector.authenticate(options.credentials);
			const stores = await connector.discoverStores();
			const store = pickStore(stores, options.storeExternalId);
			const catalog = await connector.fetchCatalog(store);
			const firstRun = await collectSales(
				connector.fetchSales(store, options.window, fetchContext),
			);
			const secondRun = await collectSales(
				connector.fetchSales(store, options.window, fetchContext),
			);
			const perDay: LoadedState["perDay"] = [];
			for (const date of windowDates(options.window)) {
				perDay.push({
					date,
					sales: await collectSales(
						connector.fetchSales(store, singleDayWindow(date), fetchContext),
					),
				});
			}
			const controlTotals = capabilities.controlTotals
				? await connector.fetchControlTotals(
						store,
						options.window,
						fetchContext,
					)
				: null;
			loaded = {
				store,
				catalog,
				firstRun,
				secondRun,
				perDay,
				controlTotals,
				flags,
				context: {
					store,
					window: options.window,
					moneyTolerance,
				},
			};
		}, timeout);

		it("describes itself with an id, a label and every capability flag", () => {
			expect(descriptor.id.length).toBeGreaterThan(0);
			expect(descriptor.label.length).toBeGreaterThan(0);
			for (const capability of CAPABILITY_NAMES) {
				expect(typeof capabilities[capability]).toBe("boolean");
			}
		});

		it("rejects an empty credentials object", () => {
			expect(descriptor.credentialsSchema.safeParse({}).success).toBe(false);
		});

		it("discovers a store that matches CanonicalStore", () => {
			expect(canonicalStoreSchema.safeParse(state().store).success).toBe(true);
		});

		it("returns a catalog that matches CanonicalCatalog", () => {
			const result = canonicalCatalogSchema.safeParse(state().catalog);
			expect(result.success, result.error?.message).toBe(true);
			if (capabilities.lines) {
				expect(state().catalog.items.length).toBeGreaterThan(0);
			}
		});

		it("emits sales that match CanonicalSale with unique ids", () => {
			expect(state().firstRun.length).toBeGreaterThan(0);
			expectClean(checkSaleSchemas(state().firstRun));
			expectClean(checkUniqueIds(state().firstRun));
		});

		it("keeps external ids, amounts and payments stable across two runs", () => {
			expectClean(checkStableIds(state().firstRun, state().secondRun));
		});

		it("places every sale inside the window on the business date derived from soldAt", () => {
			expectClean(checkBusinessDates(state().firstRun, state().context));
		});

		it("makes gross minus discounts plus charges equal the sale net", () => {
			expectClean(checkNetComponents(state().firstRun, state().context));
		});

		if (capabilities.lines) {
			it("makes line net amounts minus bill discount and voucher equal the sale net", () => {
				expectClean(checkLineSums(state().firstRun, state().context));
			});

			it("keeps modifier lines free of money and consistent with the catalog", () => {
				expectClean(checkModifiers(state().firstRun, state().catalog));
			});
		} else {
			it("emits no lines when the lines capability is declared false", () => {
				expectClean(checkLinelessSales(state().firstRun));
			});
		}

		it("makes payments sum to the paid amount", () => {
			expectClean(checkPayments(state().firstRun, state().context));
		});

		if (expectFullyPaid) {
			it("pays every sale in full across the window", () => {
				expectClean(checkNetTotals(state().firstRun, state().context));
			});
		}

		it("fetches the whole window exactly as the union of its single-day windows", () => {
			const union = state().perDay.flatMap((day) => day.sales);
			expectClean(checkPaginationCompleteness(state().firstRun, union));
		});

		it("treats both window edges as inclusive", () => {
			const perDay = state().perDay;
			const first = perDay[0];
			const last = perDay[perDay.length - 1];
			const edges = [first, last].filter(
				(edge): edge is NonNullable<typeof edge> => edge !== undefined,
			);
			expectClean(
				checkWindowEdges(state().firstRun, edges, expectSalesOnEdges),
			);
		});

		if (expectBoundarySales) {
			it("emits sales close to both ends of each edge business day", () => {
				expectClean(
					checkBoundarySales(
						state().firstRun,
						edgeDates(options.window),
						state().context,
						boundaryMarginMinutes,
					),
				);
			});
		}

		it("emits only well-formed data-quality flags", () => {
			expectClean(checkFlags(state().flags));
		});

		if (capabilities.controlTotals) {
			it("control totals equal the emitted sales per business date", () => {
				const totals = state().controlTotals ?? [];
				expect(totals.length).toBeGreaterThan(0);
				for (const total of totals) {
					expect(canonicalDailyTotalSchema.safeParse(total).success).toBe(true);
				}
				expectClean(
					checkControlTotals(state().firstRun, totals, state().context),
				);
			});
		} else {
			it("rejects fetchControlTotals with ConnectorCapabilityError", async () => {
				await expect(
					connector.fetchControlTotals(state().store, options.window),
				).rejects.toBeInstanceOf(ConnectorCapabilityError);
			});
		}

		if (capabilities.shifts) {
			it("returns shifts that match CanonicalShift", { timeout }, async () => {
				const shifts = await connector.fetchShifts(
					state().store,
					options.window,
				);
				for (const shift of shifts) {
					const result = canonicalShiftSchema.safeParse(shift);
					expect(result.success, result.error?.message).toBe(true);
				}
			});
		} else {
			it("rejects fetchShifts with ConnectorCapabilityError", async () => {
				await expect(
					connector.fetchShifts(state().store, options.window),
				).rejects.toBeInstanceOf(ConnectorCapabilityError);
			});
		}

		if (capabilities.adjustments) {
			it("returns adjustments that match CanonicalAdjustment and the adjustment rules", {
				timeout,
			}, async () => {
				const flags: DataQualityFlag[] = [];
				const adjustments = await connector.fetchAdjustments(
					state().store,
					options.window,
					{ onFlag: (flag) => flags.push(flag) },
				);
				if (expectAdjustments) {
					expect(adjustments.length).toBeGreaterThan(0);
				}
				for (const adjustment of adjustments) {
					const result = canonicalAdjustmentSchema.safeParse(adjustment);
					expect(result.success, result.error?.message).toBe(true);
				}
				expectClean(checkAdjustments(adjustments, state().context));
				expectClean(checkFlags(flags));
			});
		} else {
			it("rejects fetchAdjustments with ConnectorCapabilityError", async () => {
				await expect(
					connector.fetchAdjustments(state().store, options.window),
				).rejects.toBeInstanceOf(ConnectorCapabilityError);
			});
		}

		if (!capabilities.payments) {
			it("emits no payments when the payments capability is declared false", () => {
				expect(
					state().firstRun.every((sale) => sale.payments.length === 0),
				).toBe(true);
			});
		}

		if (capabilities.modifiers) {
			it("emits at least one modifier line when the catalog lists modifiers", () => {
				expectClean(checkModifierPresence(state().firstRun, state().catalog));
			});
		} else {
			it("emits no modifier lines when the modifiers capability is declared false", () => {
				expect(
					state().firstRun.every((sale) =>
						sale.lines.every((line) => line.lineKind !== "modifier"),
					),
				).toBe(true);
			});
		}
	});
}
