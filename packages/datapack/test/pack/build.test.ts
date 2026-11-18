import type { DemoReportSource } from "@fnb/demo-analytics";
import {
	type AnalyticsArgs,
	type AnalyticsFunctionName,
	createRpcReportSource,
	type ReportSource,
	reportCallIdentity,
	type ThemeArgs,
	type ThemeFunctionName,
} from "@fnb/reports";
import { beforeAll, describe, expect, it } from "vitest";
import { buildDataPack, buildPackWith } from "../../src/pack/build.js";
import {
	BROWSER_CONCURRENCY,
	distinctCallCount,
	packCalls,
} from "../../src/pack/calls.js";
import { fixedClock } from "../../src/pack/clock.js";
import { TOKEN_LIMIT } from "../../src/pack/estimate.js";
import { validatePack } from "../../src/pack/invariants.js";
import { recordingReportSource } from "../../src/pack/record.js";
import { HORIZONS, PACK_LANGUAGES } from "../../src/pack/request.js";
import { ALL_SCOPE } from "../../src/pack/schema.js";
import { strategyPrompt } from "../../src/prompt/prompt.js";
import {
	buildWith,
	demoRequest,
	demoSource,
	GOLDEN_FOCUS,
} from "./support/demo.js";
import { overriddenSource, rpcClientOver } from "./support/sources.js";

const LIVE_IDS = new Map([
	["MOCK-S1", "22222222-2222-4222-8222-000000000001"],
	["MOCK-S2", "22222222-2222-4222-8222-000000000002"],
]);

function concurrencyProbe(base: ReportSource): {
	readonly source: ReportSource;
	readonly peak: () => number;
} {
	let active = 0;
	let peak = 0;
	async function track<Result>(run: () => Promise<Result>): Promise<Result> {
		active += 1;
		peak = Math.max(peak, active);
		await new Promise((resolve) => setTimeout(resolve, 1));
		try {
			return await run();
		} finally {
			active -= 1;
		}
	}
	return {
		peak: () => peak,
		source: {
			kind: base.kind,
			call<N extends AnalyticsFunctionName>(name: N, args: AnalyticsArgs<N>) {
				return track(() => base.call(name, args));
			},
			callTheme<N extends ThemeFunctionName>(name: N, args: ThemeArgs<N>) {
				return track(() => base.callTheme(name, args));
			},
		},
	};
}

describe("buildDataPack", () => {
	let source: DemoReportSource;

	beforeAll(async () => {
		source = demoSource();
		await buildWith(source, demoRequest());
	});

	it("carries strategyPrompt in the pack's language", async () => {
		for (const language of PACK_LANGUAGES) {
			const built = await buildDataPack(demoRequest({ language }), {
				source,
				clock: fixedClock("2026-11-12T03:00:00Z"),
				fence: null,
			});
			expect(built.pack.prompt).toEqual(strategyPrompt(language));
			expect(built.pack.request.language).toBe(language);
		}
	});

	it("refuses a prompt in another language than the pack", async () => {
		await expect(
			buildPackWith(
				demoRequest({ language: "vi" }),
				{ source, clock: fixedClock("2026-11-12T03:00:00Z"), fence: null },
				() => strategyPrompt("en"),
			),
		).rejects.toThrow(/^pack_invalid: the prompt is in en, the pack in vi/);
	});

	it("validates for every horizon, in both languages, with and without a focus and an owner note", async () => {
		for (const horizon of HORIZONS) {
			for (const language of PACK_LANGUAGES) {
				for (const texts of [
					{ focus: null, ownerNote: null },
					{
						focus: GOLDEN_FOCUS,
						ownerNote: "Cửa hàng 2 mới mở, đang tuyển thêm người.",
					},
				]) {
					const built = await buildWith(
						source,
						demoRequest({ horizon, language, ...texts }),
					);
					const validation = await validatePack(built.pack);
					expect(validation.issues).toEqual([]);
					expect(built.pack.request.horizon).toBe(horizon);
					expect(built.pack.prompt.language).toBe(language);
					expect(built.pack.request.focus).toBe(texts.focus);
					expect(built.pack.request.owner_note).toBe(texts.ownerNote);
					expect(built.estimatedTokens).toBeLessThanOrEqual(TOKEN_LIMIT);
					expect(built.pack.tables.kpi?.title).toBe(
						language === "vi"
							? "KPI theo cửa sổ 28 ngày"
							: "KPIs over 28-day windows",
					);
				}
			}
		}
	});

	it("records every planned call with its arguments and rows, store profiles first", async () => {
		const recording = recordingReportSource(source);
		const built = await buildWith(recording.source, demoRequest());
		const resolved = {
			stores: built.pack.request.stores,
			asOf: built.pack.request.as_of,
			horizon: built.pack.request.horizon,
			language: built.pack.request.language,
			focus: null,
			ownerNote: null,
			sample: true,
			currency: "VND",
		};
		const planned = packCalls(resolved);
		expect(built.calls.map((call) => call.key)).toEqual(
			planned.map((spec) => spec.key),
		);
		expect(built.calls[0]?.name).toBe("store_profiles");
		expect(recording.calls[0]?.name).toBe("store_profiles");
		expect(recording.calls).toHaveLength(distinctCallCount(planned));
		const byIdentity = new Map(
			recording.calls.map((call) => [call.key, call.rows]),
		);
		for (const call of built.calls) {
			expect(call.args).toEqual(
				planned.find((spec) => spec.key === call.key)?.args,
			);
			const spec = planned.find((entry) => entry.key === call.key);
			if (spec === undefined) throw new Error(`no planned call ${call.key}`);
			expect(byIdentity.get(reportCallIdentity(spec))).toEqual(call.rows);
		}
	});

	it("shares duplicate calls: a one-store pack plans its scope once", async () => {
		const recording = recordingReportSource(source);
		const built = await buildWith(
			recording.source,
			demoRequest({ storeIds: ["MOCK-S2"] }),
		);
		expect(built.pack.request.stores).toEqual([{ id: "MOCK-S2", label: "S2" }]);
		expect(
			Object.keys(built.pack.tables.kpi?.rows ?? {}).every((key) =>
				key.startsWith(`${ALL_SCOPE}/`),
			),
		).toBe(true);
		const identities = recording.calls.map((call) => call.key);
		expect(new Set(identities).size).toBe(identities.length);
	});

	it("reports progress up to the number of distinct calls", async () => {
		const seen: [number, number][] = [];
		const built = await buildWith(source, demoRequest(), {
			onProgress: (done, total) => seen.push([done, total]),
		});
		const last = seen.at(-1);
		expect(last?.[0]).toBe(last?.[1]);
		expect(last?.[1]).toBe(built.calls.length);
		expect(seen.every(([done, total]) => done <= total)).toBe(true);
		for (let index = 1; index < seen.length; index += 1) {
			expect(seen[index]?.[0]).toBeGreaterThanOrEqual(
				seen[index - 1]?.[0] ?? 0,
			);
		}
	});

	it("runs a few calls at a time in the browser and one at a time inside a snapshot", async () => {
		const browser = concurrencyProbe(source);
		await buildWith(browser.source, demoRequest());
		expect(browser.peak()).toBe(BROWSER_CONCURRENCY);
		const snapshot = concurrencyProbe(
			createRpcReportSource(
				rpcClientOver(source, "jsonb", LIVE_IDS),
				"postgres",
			),
		);
		const live = demoRequest({
			storeIds: [...LIVE_IDS.values()],
			sample: false,
		});
		await buildWith(snapshot.source, live);
		expect(snapshot.peak()).toBe(1);
	});

	it("reads the fence before and after and rebuilds when it moved", async () => {
		const plain = await buildWith(source, demoRequest());
		const fences = ["a", "b", "b", "b"];
		let reads = 0;
		const recording = recordingReportSource(source);
		const built = await buildWith(recording.source, demoRequest(), {
			fence: async () => fences[reads++] ?? "z",
		});
		expect(reads).toBe(4);
		expect(built.text).toBe(plain.text);
		expect(recording.calls.length).toBe(2 * built.calls.length);
	});

	it("gives up with pack_data_changed after three attempts", async () => {
		let reads = 0;
		await expect(
			buildWith(source, demoRequest(), {
				fence: async () => String(reads++),
			}),
		).rejects.toThrow(/^pack_data_changed: /);
		expect(reads).toBe(6);
	});

	it("refuses a pack whose till texts look like personal data", async () => {
		const leaky = overriddenSource(source, {
			item_summary: (rows) =>
				rows.map((row, index) =>
					index === 0 ? { ...row, item_name: "Gọi 0901234567" } : row,
				),
		});
		await expect(buildWith(leaky, demoRequest())).rejects.toThrow(
			/^pack_not_aggregate: text_phone at tables\.items/,
		);
	});

	it("refuses a request before reading anything", async () => {
		const recording = recordingReportSource(source);
		await expect(
			buildWith(
				recording.source,
				demoRequest({ focus: "mail me: owner@example.com" }),
			),
		).rejects.toThrow(/^pack_text_contact_details: /);
		await expect(
			buildWith(recording.source, demoRequest({ storeIds: ["MOCK-S9"] })),
		).rejects.toThrow(/^pack_stores_invalid: /);
		expect(recording.calls.map((call) => call.name)).toEqual([
			"store_profiles",
		]);
	});

	it("refuses an as-of day that is not complete yet", async () => {
		await expect(
			buildWith(source, demoRequest({ asOf: "2026-11-12" })),
		).rejects.toThrow(/^pack_as_of_not_complete: /);
		const earlier = await buildWith(
			source,
			demoRequest({ asOf: "2026-10-31" }),
		);
		expect(earlier.pack.request.as_of).toBe("2026-10-31");
		expect(earlier.pack.calendar.month_to_date).toEqual({
			from: "2026-10-01",
			to: "2026-10-31",
		});
	});
});
