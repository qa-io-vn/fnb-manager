import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
	computeExpectedLedger,
	type ExpectedLedger,
	earnForAmount,
	type LedgerReplayInput,
	normalizeLoyaltyPhone,
	pointsLiability,
	type ReplayInvoice,
} from "../../src/index.js";
import {
	buildReplayDataset,
	REPLAY_DAYS,
	REPLAY_PARAMETERS,
	REPLAY_PHONE_COUNT,
	type ReplayDataset,
	replayInvoices,
} from "../fixtures/loyalty-replay.js";

const fixturePath = fileURLToPath(
	new URL("../fixtures/loyalty-replay.json", import.meta.url),
);
const sqlTestPath = fileURLToPath(
	new URL("../../../../supabase/tests/63_loyalty_earn.sql", import.meta.url),
);

interface ReplayFixture {
	readonly dataset: ReplayDataset;
	readonly expected: ExpectedLedger;
}

function replayInput(dataset: ReplayDataset): LedgerReplayInput {
	return {
		parameters: REPLAY_PARAMETERS,
		members: dataset.phones,
		staffPhones: dataset.staffPhoneIndexes.map(
			(index) => dataset.phones[index] ?? "",
		),
		invoices: replayInvoices(dataset),
	};
}

function buildFixture(): ReplayFixture {
	const dataset = buildReplayDataset();
	return { dataset, expected: computeExpectedLedger(replayInput(dataset)) };
}

if (process.env.UPDATE_LOYALTY_REPLAY === "1") {
	writeFileSync(fixturePath, `${JSON.stringify(buildFixture())}\n`);
}

function invoice(
	overrides: Partial<ReplayInvoice> & { externalId: string },
): ReplayInvoice {
	return {
		businessDate: "2026-10-05",
		soldAt: "2026-10-05T03:00:00.000Z",
		netAmount: 60_000,
		phone: "0900007001",
		source: "tai-quan",
		status: "completed",
		voidedLater: false,
		...overrides,
	};
}

function ledgerOf(invoices: ReplayInvoice[], staffPhones: string[] = []) {
	return computeExpectedLedger({
		parameters: REPLAY_PARAMETERS,
		members: ["0900007001", "0900007002"],
		staffPhones,
		invoices,
	});
}

describe("earnForAmount", () => {
	it("gives a stamp from the minimum bill and a point per started unit below it", () => {
		expect(earnForAmount(49_999, REPLAY_PARAMETERS)).toEqual({
			stamps: 0,
			points: 4,
		});
		expect(earnForAmount(50_000, REPLAY_PARAMETERS)).toEqual({
			stamps: 1,
			points: 5,
		});
		expect(earnForAmount(9_999, REPLAY_PARAMETERS)).toEqual({
			stamps: 0,
			points: 0,
		});
		expect(earnForAmount(-5_000, REPLAY_PARAMETERS)).toEqual({
			stamps: 0,
			points: 0,
		});
	});

	it("follows the parameters", () => {
		expect(
			earnForAmount(120_000, {
				stampMinBillAmount: 100_000,
				pointUnitAmount: 20_000,
				pointsPerUnit: 3,
			}),
		).toEqual({ stamps: 1, points: 18 });
	});
});

describe("computeExpectedLedger", () => {
	it("credits the welcome stamps to every member but a staff phone", () => {
		const ledger = ledgerOf([], ["0900007002"]);
		expect(ledger.members["0900007001"]?.stamps).toBe(2);
		expect(ledger.members["0900007002"]?.stamps).toBe(0);
	});

	it("refuses each anti-fraud case with its reason", () => {
		const ledger = ledgerOf(
			[
				invoice({ externalId: "a", source: "delivery-app" }),
				invoice({ externalId: "b", phone: "0900007002" }),
				invoice({ externalId: "c", status: "voided" }),
				invoice({
					externalId: "d",
					netAmount: 30_000,
					soldAt: "2026-10-05T03:01:00.000Z",
				}),
				invoice({
					externalId: "e",
					netAmount: 5_000,
					soldAt: "2026-10-05T03:02:00.000Z",
				}),
			],
			["0900007002"],
		);
		expect(ledger.refusals.excluded_source).toBe(1);
		expect(ledger.refusals.excluded_phone).toBe(1);
		expect(ledger.refusals.invoice_not_completed).toBe(1);
		expect(ledger.refusals.below_minimum).toBe(2);
		expect(ledger.earns).toBe(1);
		expect(ledger.members["0900007001"]).toEqual({
			stamps: 2,
			points: 3,
			earns: 1,
			clawbacks: 0,
		});
	});

	it("caps the earning invoices of a phone per business day", () => {
		const invoices = [0, 1, 2, 3].map((n) =>
			invoice({
				externalId: `cap-${n}`,
				soldAt: `2026-10-05T0${n + 1}:00:00.000Z`,
			}),
		);
		invoices.push(
			invoice({
				externalId: "next-day",
				businessDate: "2026-10-06",
				soldAt: "2026-10-06T01:00:00.000Z",
			}),
		);
		const ledger = ledgerOf(invoices);
		expect(ledger.refusals.daily_cap).toBe(1);
		expect(ledger.members["0900007001"]).toEqual({
			stamps: 6,
			points: 24,
			earns: 4,
			clawbacks: 0,
		});
	});

	it("reverses the earn of an invoice voided later", () => {
		const ledger = ledgerOf([
			invoice({ externalId: "kept" }),
			invoice({
				externalId: "voided",
				soldAt: "2026-10-05T04:00:00.000Z",
				netAmount: 80_000,
				voidedLater: true,
			}),
		]);
		expect(ledger.clawbacks).toBe(1);
		expect(ledger.members["0900007001"]).toEqual({
			stamps: 3,
			points: 6,
			earns: 2,
			clawbacks: 1,
		});
	});

	it("ignores invoices without a member", () => {
		const ledger = ledgerOf([
			invoice({ externalId: "x", phone: null }),
			invoice({ externalId: "y", phone: "0900009999" }),
		]);
		expect(ledger.earns).toBe(0);
		expect(Object.values(ledger.refusals).every((count) => count === 0)).toBe(
			true,
		);
	});
});

describe("the 30-day replay fixture", () => {
	const fixture = JSON.parse(
		readFileSync(fixturePath, "utf8"),
	) as ReplayFixture;

	it("is the generator's dataset: 30 days, two stores, 50 synthetic phones", () => {
		expect(fixture.dataset).toEqual(buildReplayDataset());
		expect(fixture.dataset.phones).toHaveLength(REPLAY_PHONE_COUNT);
		expect(new Set(fixture.dataset.rows.map((row) => row[1])).size).toBe(
			REPLAY_DAYS,
		);
		expect(
			fixture.dataset.phones.every((phone) => /^090000\d{4}$/.test(phone)),
		).toBe(true);
	});

	it("holds the independent calculation of the expected ledger", () => {
		expect(fixture.expected).toEqual(
			computeExpectedLedger(replayInput(fixture.dataset)),
		);
	});

	it("exercises every replayed rule", () => {
		const { refusals, clawbacks } = fixture.expected;
		expect(refusals.daily_cap).toBeGreaterThan(0);
		expect(refusals.excluded_phone).toBeGreaterThan(0);
		expect(refusals.excluded_source).toBeGreaterThan(0);
		expect(refusals.below_minimum).toBeGreaterThan(0);
		expect(refusals.invoice_not_completed).toBeGreaterThan(0);
		expect(clawbacks).toBeGreaterThan(0);
	});

	it("is embedded verbatim in the pgTAP replay", () => {
		expect(existsSync(sqlTestPath)).toBe(true);
		const sql = readFileSync(sqlTestPath, "utf8");
		const match = /\$replay\$(.*)\$replay\$/.exec(sql);
		expect(match?.[1]).toBeDefined();
		expect(JSON.parse(match?.[1] ?? "null")).toEqual(fixture);
	});
});

const plus84 = (rest: string) => `+84${rest}`;

describe("normalizeLoyaltyPhone", () => {
	it("reads the forms a till or a person types", () => {
		expect(normalizeLoyaltyPhone("0912 345 678")).toBe(plus84("912345678"));
		expect(normalizeLoyaltyPhone("84912345678")).toBe(plus84("912345678"));
		expect(normalizeLoyaltyPhone("0084912345678")).toBe(plus84("912345678"));
		expect(normalizeLoyaltyPhone("+1 (415) 555-0100")).toBe("+14155550100");
		expect(normalizeLoyaltyPhone("12345")).toBeNull();
		expect(normalizeLoyaltyPhone(null)).toBeNull();
	});
});

describe("pointsLiability", () => {
	it("is outstanding points times value times one minus breakage", () => {
		expect(
			pointsLiability({
				outstandingPoints: 1_000,
				pointValueAmount: 500,
				expectedBreakageRate: 0.2,
			}),
		).toBe(400_000);
		expect(
			pointsLiability({
				outstandingPoints: 333,
				pointValueAmount: 123.45,
				expectedBreakageRate: 0.25,
			}),
		).toBe(30_831.64);
	});
});
