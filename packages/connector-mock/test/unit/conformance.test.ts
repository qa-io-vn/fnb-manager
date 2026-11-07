import { runConnectorConformanceSuite } from "@fnb/connector-core/conformance";
import { createMockConnector } from "../../src/index.js";

runConnectorConformanceSuite("mock connector", () => createMockConnector(), {
	credentials: { seed: 42 },
	window: { fromDate: "2026-10-26", toDate: "2026-11-01" },
	expectFullyPaid: true,
});

runConnectorConformanceSuite(
	"mock connector with a 05:00 day start and two stores",
	() => createMockConnector({ profile: { dayStartMinutes: 5 * 60 } }),
	{
		credentials: { seed: 7, storeCount: 2 },
		storeExternalId: "MOCK-S2",
		window: { fromDate: "2026-01-30", toDate: "2026-02-02" },
		expectFullyPaid: true,
	},
);
