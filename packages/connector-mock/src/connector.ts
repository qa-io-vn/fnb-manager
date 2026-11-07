import {
	assertCapability,
	assertWindow,
	type BusinessDateWindow,
	ConnectorAuthError,
	type ConnectorDescriptor,
	type ConnectorFactory,
	capabilities,
	type PosConnector,
	windowDates,
} from "@fnb/connector-core";
import type {
	CanonicalAdjustment,
	CanonicalCatalog,
	CanonicalDailyTotal,
	CanonicalSale,
	CanonicalShift,
	CanonicalStore,
} from "@fnb/core";
import { z } from "zod";
import { generateDay, mockStore } from "./generate.js";
import { MENU, type Menu } from "./menu.js";
import { type MockProfile, resolveProfile } from "./profile.js";

export const MOCK_CONNECTOR_ID = "mock";

export const mockCredentialsSchema = z.object({
	seed: z.number().int().nonnegative(),
	storeCount: z.number().int().min(1).max(5).optional(),
});

export type MockCredentials = z.infer<typeof mockCredentialsSchema>;

export interface MockConnectorOptions {
	profile?: Partial<MockProfile>;
	menu?: Menu;
}

const DESCRIPTOR_BASE: Omit<ConnectorDescriptor, "credentialsSchema"> = {
	id: MOCK_CONNECTOR_ID,
	label: "Seeded synthetic shop",
	capabilities: capabilities({
		lines: true,
		modifiers: true,
		payments: true,
		shifts: true,
		adjustments: true,
		controlTotals: true,
		customers: true,
		guestCount: true,
		costs: true,
	}),
	notes: [
		"Every day is generated independently from (seed, store, date), so any window is the union of its days.",
		"Voided sales are emitted with status voided and excluded from control totals.",
	],
};

export function createMockConnector(
	options: MockConnectorOptions = {},
): PosConnector {
	const profile = resolveProfile(options.profile);
	const menu = options.menu ?? MENU;
	const descriptor: ConnectorDescriptor = {
		...DESCRIPTOR_BASE,
		credentialsSchema: mockCredentialsSchema,
	};
	let credentials: MockCredentials | null = null;

	const session = (): MockCredentials => {
		if (!credentials) {
			throw new ConnectorAuthError(
				MOCK_CONNECTOR_ID,
				"authenticate() was not called",
			);
		}
		return credentials;
	};

	const days = (store: CanonicalStore, window: BusinessDateWindow) => {
		assertWindow(window);
		const { seed } = session();
		return windowDates(window).map((date) =>
			generateDay(seed, profile, store, date, menu),
		);
	};

	return {
		describe: () => descriptor,
		async authenticate(input) {
			const parsed = mockCredentialsSchema.safeParse(input);
			if (!parsed.success) {
				throw new ConnectorAuthError(
					MOCK_CONNECTOR_ID,
					parsed.error.issues[0]?.message ?? "invalid credentials",
				);
			}
			credentials = parsed.data;
		},
		async discoverStores() {
			const count = session().storeCount ?? 1;
			return Array.from({ length: count }, (_, index) =>
				mockStore(index + 1, profile),
			);
		},
		async fetchCatalog(): Promise<CanonicalCatalog> {
			session();
			return menu.catalog;
		},
		async *fetchSales(store, window): AsyncIterable<CanonicalSale[]> {
			for (const day of days(store, window)) {
				yield day.sales;
			}
		},
		async fetchShifts(store, window): Promise<CanonicalShift[]> {
			assertCapability(descriptor, "shifts");
			return days(store, window).flatMap((day) => day.shifts);
		},
		async fetchAdjustments(store, window): Promise<CanonicalAdjustment[]> {
			assertCapability(descriptor, "adjustments");
			return days(store, window).flatMap((day) => day.adjustments);
		},
		async fetchControlTotals(store, window): Promise<CanonicalDailyTotal[]> {
			assertCapability(descriptor, "controlTotals");
			return days(store, window).map((day) => day.dailyTotal);
		},
	};
}

export const mockConnectorFactory: ConnectorFactory<MockConnectorOptions> = {
	id: MOCK_CONNECTOR_ID,
	create: (options) => createMockConnector(options ?? {}),
};
