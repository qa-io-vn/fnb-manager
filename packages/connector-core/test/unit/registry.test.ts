import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
	assertCapability,
	ConnectorAuthError,
	ConnectorCapabilityError,
	ConnectorError,
	ConnectorRateLimitError,
	ConnectorRegistry,
	ConnectorSchemaError,
	capabilities,
	type PosConnector,
} from "../../src/index.js";

function stubConnector(id: string): PosConnector {
	const descriptor = {
		id,
		label: `${id} stub`,
		capabilities: capabilities({ lines: true }),
		credentialsSchema: z.object({ token: z.string() }),
	};
	return {
		describe: () => descriptor,
		authenticate: async () => undefined,
		discoverStores: async () => [],
		fetchCatalog: async () => ({
			items: [],
			itemTypes: [],
			itemClasses: [],
			modifiers: [],
			paymentMethods: [],
			sources: [],
			promotions: [],
			packages: [],
		}),
		fetchSales: async function* () {
			yield [];
		},
		fetchShifts: async () => {
			assertCapability(descriptor, "shifts");
			return [];
		},
		fetchAdjustments: async () => {
			assertCapability(descriptor, "adjustments");
			return [];
		},
		fetchControlTotals: async () => {
			assertCapability(descriptor, "controlTotals");
			return [];
		},
	};
}

describe("ConnectorRegistry", () => {
	it("creates connectors by id and lists what it knows", () => {
		const registry = new ConnectorRegistry()
			.register({ id: "alpha", create: () => stubConnector("alpha") })
			.register({ id: "beta", create: () => stubConnector("beta") });

		expect(registry.ids()).toEqual(["alpha", "beta"]);
		expect(registry.has("alpha")).toBe(true);
		expect(registry.create("beta", {}).describe().id).toBe("beta");
	});

	it("refuses duplicate ids and unknown ids", () => {
		const registry = new ConnectorRegistry().register({
			id: "alpha",
			create: () => stubConnector("alpha"),
		});

		expect(() =>
			registry.register({ id: "alpha", create: () => stubConnector("alpha") }),
		).toThrow(ConnectorError);
		expect(() => registry.create("gamma", {})).toThrow(
			/no connector registered/,
		);
	});
});

describe("capability gating", () => {
	it("throws ConnectorCapabilityError for capabilities declared false", async () => {
		const connector = stubConnector("alpha");
		const store = {
			externalId: "S1",
			name: "Store",
			timezone: "Asia/Ho_Chi_Minh",
			dayStartMinutes: 0,
			currency: "VND",
		};
		const window = { fromDate: "2026-01-01", toDate: "2026-01-01" };

		await expect(connector.fetchShifts(store, window)).rejects.toMatchObject({
			name: "ConnectorCapabilityError",
			capability: "shifts",
			connectorId: "alpha",
		});
		await expect(
			connector.fetchControlTotals(store, window),
		).rejects.toBeInstanceOf(ConnectorCapabilityError);
	});
});

describe("typed errors", () => {
	it("carry the connector id and a readable message", () => {
		expect(new ConnectorAuthError("alpha", "bad password").message).toBe(
			"alpha: authentication failed (bad password)",
		);
		const schemaError = new ConnectorSchemaError("alpha", "invoices", [
			{ path: "rows.0.total", message: "expected number" },
		]);
		expect(schemaError.message).toContain("rows.0.total: expected number");
		expect(schemaError.issues).toHaveLength(1);
		expect(new ConnectorRateLimitError("alpha", 2_000).retryAfterMs).toBe(
			2_000,
		);
		expect(new ConnectorRateLimitError("alpha", null).message).toBe(
			"alpha: rate limited by the POS",
		);
		expect(new ConnectorCapabilityError("alpha", "costs")).toBeInstanceOf(
			ConnectorError,
		);
	});
});
