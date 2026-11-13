import { type BusinessDateWindow, collectSales } from "@fnb/connector-core";
import type {
	CanonicalAdjustment,
	CanonicalDailyTotal,
	CanonicalSale,
	CanonicalShift,
} from "@fnb/core";
import { toCanonicalStore } from "../mapping/store.js";
import type { StoreScope } from "./store-window-context.js";

export interface PulledData {
	sales: CanonicalSale[];
	adjustments: CanonicalAdjustment[];
	controlTotals: CanonicalDailyTotal[] | null;
	shifts: CanonicalShift[] | null;
}

function fetchContextOf(scope: StoreScope) {
	return {
		canonical: toCanonicalStore(
			scope.store,
			scope.context.account.tenant_currency,
		),
		fetchContext: {
			onFlag: scope.context.flags.sink,
			...(scope.context.signal ? { signal: scope.context.signal } : {}),
		},
	};
}

export async function pullStoreWindow(scope: StoreScope): Promise<PulledData> {
	const { connector, caller, window } = scope.context;
	const { capabilities } = scope;
	const { canonical, fetchContext } = fetchContextOf(scope);
	const sales = await caller.call("sales", () =>
		collectSales(connector.fetchSales(canonical, window, fetchContext)),
	);
	const adjustments = capabilities.adjustments
		? await caller.call("adjustments", () =>
				connector.fetchAdjustments(canonical, window, fetchContext),
			)
		: [];
	const controlTotals = capabilities.controlTotals
		? await caller.call("control totals", () =>
				connector.fetchControlTotals(canonical, window, fetchContext),
			)
		: null;
	const shifts = capabilities.shifts
		? await caller.call("shifts", () =>
				connector.fetchShifts(canonical, window, fetchContext),
			)
		: null;
	return { sales, adjustments, controlTotals, shifts };
}

export async function pullControlTotals(
	scope: StoreScope,
	window: BusinessDateWindow,
): Promise<CanonicalDailyTotal[]> {
	const { connector, caller } = scope.context;
	const { canonical, fetchContext } = fetchContextOf(scope);
	return caller.call("control totals", () =>
		connector.fetchControlTotals(canonical, window, fetchContext),
	);
}
