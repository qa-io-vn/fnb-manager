import {
	DEFAULT_MOCK_PROFILE,
	generateDay,
	mockStore,
	SYNTHETIC_PHONE_PATTERN,
} from "@fnb/connector-mock";
import { addDays } from "@fnb/reports";
import { describe, expect, it } from "vitest";
import {
	CAPTURE_FROM,
	createDemoReportSource,
	DEMO_SEED,
	DemoDayCache,
} from "../../src/index.js";

const NOW = new Date("2026-11-04T05:30:00.000Z");
const AS_OF = "2026-11-03";
const STORES = ["MOCK-S1", "MOCK-S2"];
const DATES = [addDays(AS_OF, -6), addDays(AS_OF, -1), AS_OF];

async function phonesOf(days: DemoDayCache): Promise<(string | undefined)[]> {
	const phones: (string | undefined)[] = [];
	for (const storeId of STORES) {
		for (const date of DATES) {
			const day = await days.generated(storeId, date);
			for (const sale of day?.sales ?? []) phones.push(sale.customerPhone);
		}
	}
	return phones;
}

describe("the demo's member phones", () => {
	it("are synthetic 0900000xxx numbers, on a seeded share of invoices, the same for the same seed", async () => {
		const first = await phonesOf(
			new DemoDayCache({ now: () => NOW, volumeScale: 0.5 }),
		);
		const again = await phonesOf(
			new DemoDayCache({ now: () => NOW, volumeScale: 0.5 }),
		);
		const attached = first.filter(
			(phone): phone is string => phone !== undefined,
		);
		expect(attached.length).toBeGreaterThan(0);
		expect(attached.length).toBeLessThan(first.length);
		expect(attached.every((phone) => SYNTHETIC_PHONE_PATTERN.test(phone))).toBe(
			true,
		);
		expect(again).toEqual(first);
	});

	it("follow the seed: another seed attaches other phones, and none before the capture ramp", () => {
		const profile = { ...DEFAULT_MOCK_PROFILE, customerCaptureRate: 0.5 };
		const store = mockStore(1, profile);
		const seeded = generateDay(DEMO_SEED, profile, store, AS_OF);
		const same = generateDay(DEMO_SEED, profile, store, AS_OF);
		const other = generateDay(DEMO_SEED + 1, profile, store, AS_OF);
		const phones = (day: typeof seeded) =>
			day.sales.map((sale) => sale.customerPhone ?? null);
		expect(phones(same)).toEqual(phones(seeded));
		expect(phones(other)).not.toEqual(phones(seeded));
		expect(
			phones(seeded).every(
				(phone) => phone === null || SYNTHETIC_PHONE_PATTERN.test(phone),
			),
		).toBe(true);
		const before = generateDay(
			DEMO_SEED,
			{ ...profile, customerCaptureRate: 0 },
			store,
			addDays(CAPTURE_FROM, -1),
		);
		expect(before.sales.every((sale) => sale.customerPhone === undefined)).toBe(
			true,
		);
	});
});

describe("member_share_by_shift in the demo", () => {
	it("gives every shift of the range its Ca n, counts the generator's member phones and adds up to the day's member invoices", async () => {
		const days = new DemoDayCache({ now: () => NOW, volumeScale: 0.5 });
		const source = createDemoReportSource({
			now: () => NOW,
			days,
			volumeScale: 0.5,
			validateRows: true,
		});
		const rows = await source.callTheme("member_share_by_shift", {
			store_ids: STORES,
			from_date: DATES[0] ?? AS_OF,
			to_date: AS_OF,
		});
		expect(rows.length).toBeGreaterThan(0);
		expect(rows.every((row) => row.shift_ordinal !== null)).toBe(true);
		expect(rows.some((row) => row.member_invoices > 0)).toBe(true);
		for (const row of rows) {
			expect(row.identified_invoices).toBe(row.member_invoices);
			expect(row.member_share).toBe(
				row.invoices === 0
					? null
					: Math.round((row.member_invoices / row.invoices) * 1e6) / 1e6,
			);
		}
		for (const storeId of STORES) {
			for (const date of DATES) {
				const day = await days.generated(storeId, date);
				const members = (day?.sales ?? []).filter(
					(sale) =>
						sale.status !== "voided" && sale.customerPhone !== undefined,
				).length;
				const counted = rows
					.filter(
						(row) => row.store_id === storeId && row.business_date === date,
					)
					.reduce((sum, row) => sum + row.member_invoices, 0);
				expect(counted, `${storeId} ${date}`).toBe(members);
				const ordinals = rows
					.filter(
						(row) => row.store_id === storeId && row.business_date === date,
					)
					.map((row) => row.shift_ordinal);
				expect(ordinals).toEqual(ordinals.map((_, index) => index + 1));
			}
		}
	});
});
