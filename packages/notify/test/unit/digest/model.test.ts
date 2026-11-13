import { createRpcAnalyticsSource, dayCards, runReport } from "@fnb/reports";
import { describe, expect, it } from "vitest";
import {
	buildDigest,
	compareDigestWithNgay,
	type DigestBuildInput,
	type DueDigest,
	defaultRuleSet,
	recordingSource,
} from "../../../src/index.js";
import {
	correctionDelta,
	DIGEST_CARD_IDS,
	DIGEST_TABLE_COLUMNS,
	type DigestModel,
	digestFingerprint,
	digestModelSchema,
	isEmptyDelta,
	renderDigest,
} from "../../../src/render/index.js";
import {
	CASHIER_ADDRESS,
	DAY,
	dueFor,
	type NgayScenario,
	ngayClient,
	STORE_A,
	STORE_B,
	storesOf,
	TWO_STORES,
} from "../../fixtures/ngay-rows.js";

const NOW = new Date("2026-11-07T21:00:00.000Z");

function input(
	scenario: NgayScenario,
	storeIds: readonly string[],
	due: Partial<DueDigest> = {},
): DigestBuildInput {
	return {
		due: dueFor(storeIds, due),
		stores: storesOf(scenario, storeIds),
		rules: defaultRuleSet(),
		openAlerts: [],
		appBaseUrl: "https://example.github.io/app/",
		now: NOW,
	};
}

async function build(
	scenario: NgayScenario,
	storeIds: readonly string[] = [STORE_A, STORE_B],
	due: Partial<DueDigest> = {},
) {
	const client = ngayClient(scenario);
	return buildDigest(
		input(scenario, storeIds, due),
		recordingSource(createRpcAnalyticsSource(client, "postgres")),
	);
}

function card(build: Awaited<ReturnType<typeof buildDigest>>, id: string) {
	const found = build.cards.find((entry) => entry.id === id);
	if (!found) {
		throw new Error(`no card ${id}`);
	}
	return found;
}

describe("digest model", () => {
	it("copies every number from the Ngày cards, Object.is-equal", async () => {
		const result = await build(TWO_STORES);
		const { model } = result;
		expect(digestModelSchema.parse(model)).toEqual(model);
		const net = card(result, "net_revenue");
		expect(Object.is(model.totals.net, net.headline.value)).toBe(true);
		const baseline = net.comparisons.find((entry) => entry.kind === "baseline");
		const previous = net.comparisons.find((entry) => entry.kind === "previous");
		expect(Object.is(model.totals.vsBaseline.change, baseline?.change)).toBe(
			true,
		);
		expect(model.totals.vsBaseline.sampleDays).toBe(baseline?.sampleDays);
		expect(Object.is(model.totals.vsPrevious.change, previous?.change)).toBe(
			true,
		);
		expect(
			Object.is(model.totals.invoices, card(result, "invoices").headline.value),
		).toBe(true);
		expect(
			Object.is(
				model.totals.avgTicket,
				card(result, "avg_ticket").headline.value,
			),
		).toBe(true);
		expect(
			Object.is(
				model.totals.cashToCount,
				card(result, "payments").headline.value,
			),
		).toBe(true);
		const hourly = card(result, "hourly");
		expect(model.totals.peakHour).toEqual({
			hour: 19,
			net: hourly.headline.value,
		});
		const items = card(result, "top_items").tables[0]?.rows ?? [];
		expect(model.totals.topItems).toEqual(
			items.slice(0, 3).map((row) => ({
				name: row.cells.item,
				quantity: row.cells.quantity,
			})),
		);
		expect(model.totals.topItems).toHaveLength(3);
		expect(model.totals.net).toBe(12_345_000);
	});

	it("takes the store lines from the same rows as the net revenue store table", async () => {
		const result = await build(TWO_STORES);
		const table = card(result, "net_revenue").tables[0];
		for (const store of result.model.stores) {
			const row = table?.rows.find((entry) => entry.id === store.storeId);
			expect(Object.is(store.net, row?.cells.value)).toBe(true);
			expect(
				Object.is(store.vsBaseline.change, row?.cells.changeBaseline),
			).toBe(true);
		}
		expect(result.model.stores.map((store) => store.state)).toEqual([
			"verified",
			"verified",
		]);
		expect(result.model.dataState).toBe("verified");
		expect(result.model.link).toEqual({
			kind: "ngay",
			path: `#/bao-cao/ngay?date=${DAY}`,
		});
	});

	it("pins the card ids and table columns it reads against dayCards", async () => {
		const ids = dayCards.map((entry) => entry.id);
		for (const id of Object.values(DIGEST_CARD_IDS)) {
			expect(ids).toContain(id);
		}
		const result = await build(TWO_STORES);
		const items = card(result, "top_items").tables[0];
		for (const key of DIGEST_TABLE_COLUMNS.topItems) {
			expect(items?.columns.map((column) => column.key)).toContain(key);
		}
		const stores = card(result, "net_revenue").tables[0];
		for (const key of DIGEST_TABLE_COLUMNS.netStores) {
			expect(stores?.columns.map((column) => column.key)).toContain(key);
		}
	});

	it("builds the same numbers as a separate Ngày run over the same rows", async () => {
		const result = await build(TWO_STORES);
		const separate = await runReport(
			(await import("@fnb/reports")).dayReport,
			result.context,
			createRpcAnalyticsSource(ngayClient(TWO_STORES), "postgres"),
		);
		const net = separate.find((entry) => entry.id === "net_revenue");
		expect(net?.headline.value).toBe(result.model.totals.net);
	});

	it("marks partial baselines, missing data, holidays and closed days", async () => {
		const young: NgayScenario = {
			...TWO_STORES,
			stores: TWO_STORES.stores.map((store) => ({
				...store,
				baseline: { ...store.baseline, days_with_data: 3 },
			})),
		};
		const partial = await build(young);
		expect(partial.model.totals.vsBaseline.sampleDays).toBe(3);
		expect(partial.model.stores[0]?.vsBaseline.sampleDays).toBe(3);

		const voided: NgayScenario = {
			...TWO_STORES,
			stores: TWO_STORES.stores.map((store) => ({
				...store,
				current: {
					days_with_data: 0,
					invoices: 0,
					net_amount: 0,
					avg_ticket: null,
				},
			})),
			items: [],
			hours: [],
		};
		const empty = await build(voided);
		expect(empty.model.dataState).toBe("no_data");
		expect(
			empty.model.stores.every((store) => store.state === "no_sales"),
		).toBe(true);

		const holiday: NgayScenario = {
			...TWO_STORES,
			stores: TWO_STORES.stores.map((store) => ({
				...store,
				holidayKind: "public",
			})),
		};
		expect((await build(holiday)).model.holidayKind).toBe("public");

		const closed = await build(TWO_STORES, [STORE_A, STORE_B], {
			storeFacts: dueFor([STORE_A, STORE_B]).storeFacts.map((facts) =>
				facts.storeId === STORE_B ? { ...facts, openingMinutes: 0 } : facts,
			),
		});
		expect(
			closed.model.stores.find((store) => store.storeId === STORE_B)?.state,
		).toBe("closed");

		const unchecked: NgayScenario = {
			...TWO_STORES,
			stores: TWO_STORES.stores.map((store, index) => ({
				...store,
				coverage: index === 0 ? { unchecked_sales_days: 1 } : {},
			})),
		};
		const unverified = await build(unchecked);
		expect(unverified.model.dataState).toBe("unverified");
		expect(unverified.model.stores[0]?.state).toBe("unverified");
	});

	it("is partial at the deadline and links to Hôm nay while the day has not ended", async () => {
		const result = await build(TWO_STORES, [STORE_A, STORE_B], {
			trigger: "deadline",
			storeFacts: dueFor([STORE_A, STORE_B]).storeFacts.map((facts) =>
				facts.storeId === STORE_B
					? { ...facts, settledAt: null, openShifts: 1, dayEnded: false }
					: facts,
			),
		});
		expect(result.model.dataState).toBe("partial");
		expect(
			result.model.stores.find((store) => store.storeId === STORE_B)?.state,
		).toBe("shift_open");
		expect(result.model.link).toEqual({ kind: "hom_nay", path: "#/" });
		const one = await build(TWO_STORES, [STORE_B], { allStores: false });
		expect(one.model.link.path).toBe(
			`#/bao-cao/ngay?date=${DAY}&store=${STORE_B}`,
		);
	});
});

describe("digest model, comparisons and privacy", () => {
	it("copies a like-for-like previous-day comparison with the stores it covers", async () => {
		const opened: NgayScenario = {
			...TWO_STORES,
			stores: TWO_STORES.stores.map((store) =>
				store.id === STORE_B
					? { ...store, coverage: { history_start: DAY, first_sales_on: DAY } }
					: store,
			),
		};
		const result = await build(opened);
		const previous = card(result, "net_revenue").comparisons.find(
			(entry) => entry.kind === "previous",
		);
		expect(previous?.basis).toBe("like_for_like");
		expect(result.model.totals.vsPrevious).toMatchObject({
			basis: "like_for_like",
			coveredStores: 1,
			totalStores: 2,
		});
		expect(result.model.totals.vsPrevious.change).not.toBeNull();
		expect(
			Object.is(result.model.totals.vsPrevious.change, previous?.change),
		).toBe(true);
		expect(compareDigestWithNgay(result.model, result.cards).equal).toBe(true);
		const relabelled = {
			...result.model,
			totals: {
				...result.model.totals,
				vsPrevious: {
					...result.model.totals.vsPrevious,
					basis: "all_stores" as const,
				},
			},
		};
		expect(compareDigestWithNgay(relabelled, result.cards).differing).toContain(
			"vs_previous",
		);
		const text = renderDigest(result.model, {
			channel: "zalo_bot",
			appBaseUrl: null,
			timeZone: "Asia/Ho_Chi_Minh",
			currencyCode: "VND",
		}).text;
		expect(text).toContain("• So với hôm trước (cùng 1/2 cửa hàng): ");
		const full = await build(TWO_STORES);
		expect(full.model.totals.vsPrevious).toMatchObject({
			basis: "all_stores",
			coveredStores: 2,
			totalStores: 2,
		});
	});

	it("never carries a cashier's name or address into the model or any rendered channel", async () => {
		const withCashier: NgayScenario = {
			...TWO_STORES,
			stores: TWO_STORES.stores.map((store) =>
				store.id === STORE_A
					? {
							...store,
							shifts: [
								{
									shift_external_id: "shift-cashier",
									shift_name: `Ca sáng ${CASHIER_ADDRESS}`,
									cashier_name: CASHIER_ADDRESS,
									variance_amount: -70_000,
									over_abs_threshold: true,
									flagged: true,
									reasons: ["abs"],
								},
								{
									shift_external_id: "shift-later",
									shift_name: `Ca chiều ${CASHIER_ADDRESS}`,
									cashier_name: CASHIER_ADDRESS,
									opened_at: "2026-11-07T08:00:00+00:00",
									closed_at: "2026-11-07T15:00:00+00:00",
								},
							],
						}
					: store,
			),
		};
		const result = await build(withCashier);
		const drawer = result.model.findings.filter(
			(finding) => finding.ruleKey === "drawer_variance",
		);
		expect(drawer).toHaveLength(1);
		expect(drawer[0]?.values.shift_number).toBe(1);
		const serialised = JSON.stringify(result.model);
		expect(serialised).not.toContain(CASHIER_ADDRESS);
		expect(serialised).not.toContain("@");
		expect(serialised).not.toContain("Ca sáng");
		for (const channel of ["zalo_bot", "telegram", "email"] as const) {
			const rendered = renderDigest(result.model, {
				channel,
				appBaseUrl: "https://example.github.io/app/",
				timeZone: "Asia/Ho_Chi_Minh",
				currencyCode: "VND",
			});
			for (const text of [rendered.text, rendered.title, rendered.html ?? ""]) {
				expect(text).not.toContain(CASHIER_ADDRESS);
				expect(text).not.toContain("@");
				expect(text).not.toContain("Ca sáng");
			}
			expect(rendered.text).toContain("Ca 1 (07:00–15:00) lệch két");
		}
	});
});

describe("fingerprint and correction delta", () => {
	async function model(
		scenario: NgayScenario = TWO_STORES,
	): Promise<DigestModel> {
		return (await build(scenario)).model;
	}

	it("ignores item lines, cash to count and a state-only change", async () => {
		const base = await model();
		const changed: DigestModel = {
			...base,
			totals: {
				...base.totals,
				topItems: [{ name: "Khác", quantity: 1 }],
				cashToCount: 1,
				avgTicket: 1,
			},
			stores: base.stores.map((store) => ({ ...store, state: "unverified" })),
			dataState: "unverified",
		};
		expect(await digestFingerprint(changed)).toBe(
			await digestFingerprint(base),
		);
		expect(isEmptyDelta(correctionDelta(base, changed))).toBe(true);
		expect(await digestFingerprint(base)).toMatch(/^[0-9a-f]{64}$/);
	});

	it("changes with a shown figure or a new finding and lists exactly those", async () => {
		const base = await model();
		const figures: DigestModel = {
			...base,
			totals: { ...base.totals, net: (base.totals.net ?? 0) + 1000 },
			stores: base.stores.map((store, index) =>
				index === 0 ? { ...store, net: (store.net ?? 0) + 1000 } : store,
			),
		};
		expect(await digestFingerprint(figures)).not.toBe(
			await digestFingerprint(base),
		);
		const delta = correctionDelta(base, figures);
		expect(delta.net).toEqual({
			old: base.totals.net,
			new: (base.totals.net ?? 0) + 1000,
		});
		expect(delta.invoices).toBeNull();
		expect(delta.stores).toHaveLength(1);

		const finding: DigestModel = {
			...base,
			findings: [
				...base.findings,
				{
					ruleKey: "drawer_variance",
					storeId: STORE_A,
					values: { shift_external_id: "shift-9", variance: -62_000 },
				},
			],
		};
		expect(await digestFingerprint(finding)).not.toBe(
			await digestFingerprint(base),
		);
		expect(correctionDelta(base, finding).newFindings).toHaveLength(1);
		expect(isEmptyDelta(correctionDelta(finding, base))).toBe(true);
	});
});
