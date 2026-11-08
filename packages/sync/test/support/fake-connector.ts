import {
	assertCapability,
	type BusinessDateWindow,
	type ConnectorCapabilities,
	type ConnectorDescriptor,
	capabilities,
	isWithinWindow,
	type PosConnector,
} from "@fnb/connector-core";
import {
	businessDate,
	type CanonicalAdjustment,
	type CanonicalCatalog,
	type CanonicalDailyTotal,
	type CanonicalSale,
	type CanonicalShift,
	type CanonicalStore,
} from "@fnb/core";
import { z } from "zod";

export interface FakeData {
	stores: CanonicalStore[];
	catalog: CanonicalCatalog;
	sales: CanonicalSale[];
	adjustments: CanonicalAdjustment[];
	totals: CanonicalDailyTotal[];
	shifts: CanonicalShift[];
}

export interface FakeConnector extends PosConnector {
	data: FakeData;
	calls: string[];
	failures: Map<string, Error[]>;
}

export const EMPTY_CATALOG: CanonicalCatalog = {
	items: [],
	itemTypes: [],
	itemClasses: [],
	modifiers: [],
	paymentMethods: [],
	sources: [],
	promotions: [],
	packages: [],
};

export const FULL_CAPABILITIES = capabilities({
	lines: true,
	modifiers: true,
	payments: true,
	shifts: true,
	adjustments: true,
	controlTotals: true,
	customers: true,
	guestCount: true,
	costs: true,
});

export function createFakeConnector(
	data: Partial<FakeData> = {},
	enabled: ConnectorCapabilities = FULL_CAPABILITIES,
): FakeConnector {
	const descriptor: ConnectorDescriptor = {
		id: "fake",
		label: "Fake connector",
		capabilities: enabled,
		credentialsSchema: z.object({ token: z.string() }),
	};
	const connector: FakeConnector = {
		data: {
			stores: data.stores ?? [],
			catalog: data.catalog ?? EMPTY_CATALOG,
			sales: data.sales ?? [],
			adjustments: data.adjustments ?? [],
			totals: data.totals ?? [],
			shifts: data.shifts ?? [],
		},
		calls: [],
		failures: new Map(),
		describe: () => descriptor,
		async authenticate() {},
		async discoverStores() {
			record("stores");
			return connector.data.stores;
		},
		async fetchCatalog() {
			record("catalog");
			return connector.data.catalog;
		},
		async *fetchSales(store, window) {
			record("sales");
			yield connector.data.sales.filter((sale) =>
				isWithinWindow(
					businessDate(sale.soldAt, store.timezone, store.dayStartMinutes),
					window,
				),
			);
		},
		async fetchShifts(_store, window) {
			assertCapability(descriptor, "shifts");
			record("shifts");
			return connector.data.shifts.filter((shift) =>
				isWithinWindow(shift.openedAt.toISOString().slice(0, 10), window),
			);
		},
		async fetchAdjustments(_store, window: BusinessDateWindow) {
			assertCapability(descriptor, "adjustments");
			record("adjustments");
			return connector.data.adjustments.filter((adjustment) =>
				isWithinWindow(
					adjustment.occurredAt.toISOString().slice(0, 10),
					window,
				),
			);
		},
		async fetchControlTotals(_store, window) {
			assertCapability(descriptor, "controlTotals");
			record("controlTotals");
			return connector.data.totals.filter((total) =>
				isWithinWindow(total.businessDate, window),
			);
		},
	};
	function record(label: string): void {
		connector.calls.push(label);
		const queued = connector.failures.get(label);
		const failure = queued?.shift();
		if (failure) {
			throw failure;
		}
	}
	return connector;
}
