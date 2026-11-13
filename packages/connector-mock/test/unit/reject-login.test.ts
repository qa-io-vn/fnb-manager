import { ConnectorAuthError } from "@fnb/connector-core";
import { describe, expect, it } from "vitest";
import { createMockConnector, mockCredentialsSchema } from "../../src/index.js";

describe("rejectLogin", () => {
	it("makes authenticate() throw ConnectorAuthError and leaves no session", async () => {
		const connector = createMockConnector();
		await expect(
			connector.authenticate({ seed: 1, storeCount: 2, rejectLogin: true }),
		).rejects.toBeInstanceOf(ConnectorAuthError);
		await expect(connector.discoverStores()).rejects.toBeInstanceOf(
			ConnectorAuthError,
		);
	});

	it("accepts only true, and logs in normally without it", async () => {
		expect(
			mockCredentialsSchema.safeParse({ seed: 1, rejectLogin: false }).success,
		).toBe(false);
		const connector = createMockConnector();
		await connector.authenticate({ seed: 1, storeCount: 2 });
		expect(await connector.discoverStores()).toHaveLength(2);
	});
});
