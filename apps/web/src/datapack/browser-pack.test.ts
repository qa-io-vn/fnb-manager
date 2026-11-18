import {
	buildDataPack,
	chatBundle,
	DataPackError,
	type DataPackRequest,
	PACK_GAPS,
	parsePack,
} from "@fnb/datapack";
import { createDemoReportSource } from "@fnb/demo-analytics";
import type { ReportSource, RpcClient } from "@fnb/reports";
import { beforeAll, describe, expect, it } from "vitest";
import {
	type BrowserPack,
	buildBrowserPack,
	packFence,
	stoppableSource,
} from "./browser-pack";
import { bundleFileName, packFileName } from "./pack-files";

const INSTANT = new Date("2026-11-12T03:00:00Z");
const CLOCK = { now: () => INSTANT };

function demoSource(): ReportSource {
	return createDemoReportSource({ now: () => INSTANT });
}

function request(overrides: Partial<DataPackRequest> = {}): DataPackRequest {
	return {
		storeIds: ["MOCK-S1", "MOCK-S2"],
		asOf: null,
		horizon: "90d",
		language: "vi",
		focus: "Tăng giá trị hóa đơn buổi chiều",
		ownerNote: null,
		sample: true,
		...overrides,
	};
}

function fenceRpc(values: () => string): {
	readonly rpc: RpcClient;
	readonly calls: { fn: string; args: Record<string, unknown> }[];
} {
	const calls: { fn: string; args: Record<string, unknown> }[] = [];
	return {
		calls,
		rpc: {
			rpc: async (fn, args) => {
				calls.push({ fn, args });
				return { data: values(), error: null };
			},
		},
	};
}

function countingSource(source: ReportSource): {
	readonly source: ReportSource;
	readonly count: () => number;
} {
	let count = 0;
	return {
		count: () => count,
		source: {
			kind: source.kind,
			call: (name, args) => {
				count += 1;
				return source.call(name, args);
			},
			callTheme: (name, args) => {
				count += 1;
				return source.callTheme(name, args);
			},
		},
	};
}

describe("buildBrowserPack", () => {
	let built: BrowserPack;
	const progress: [number, number][] = [];

	beforeAll(async () => {
		built = await buildBrowserPack(request(), {
			source: demoSource(),
			rpc: null,
			signal: new AbortController().signal,
			onProgress: (done, total) => progress.push([done, total]),
			clock: CLOCK,
		});
	}, 60_000);

	it("gives the canonical text of a valid sample pack, byte for byte the package's own build", async () => {
		const parsed = await parsePack(built.text);
		expect(parsed.valid).toBe(true);
		expect(parsed.packId).toBe(built.packId);
		expect(built.text.endsWith("\n")).toBe(true);
		expect(built.text.charCodeAt(0)).toBe("{".charCodeAt(0));
		const direct = await buildDataPack(request(), {
			source: demoSource(),
			clock: CLOCK,
			fence: null,
		});
		expect(built.text).toBe(direct.text);
		expect(built.estimatedTokens).toBe(direct.estimatedTokens);
		expect(built.sample).toBe(true);
		expect(built.stores).toEqual([
			{ id: "MOCK-S1", label: "S1" },
			{ id: "MOCK-S2", label: "S2" },
		]);
		expect(built.horizon).toBe("90d");
		expect(built.language).toBe("vi");
		const parsedTables = parsed.pack?.tables ?? {};
		expect(built.tables).toHaveLength(20);
		expect(built.tables.map((table) => table.id).sort()).toEqual(
			Object.keys(parsedTables).sort(),
		);
		for (const table of built.tables) {
			expect(table.title).toBe(parsedTables[table.id]?.title);
			expect(table.rows).toBe(
				Object.keys(parsedTables[table.id]?.rows ?? {}).length,
			);
		}
	});

	it("bundles the prompt first and the same pack in a json fence", async () => {
		const parsed = await parsePack(built.text);
		if (parsed.pack === null) throw new Error("no pack");
		expect(built.bundle).toBe(chatBundle(parsed.pack));
		expect(
			built.bundle.startsWith("# Lời nhắc chiến lược fnb-strategy\n"),
		).toBe(true);
		expect(built.bundle).toContain(`"pack_id":"${built.packId}"`);
	});

	it("reports progress up to the distinct calls", () => {
		const last = progress.at(-1);
		expect(last?.[0]).toBe(last?.[1]);
		expect(last?.[1]).toBeGreaterThan(10);
		expect(progress.every(([done, total]) => done <= total)).toBe(true);
	});

	it("lists the gaps high first, each with the setting that fixes it", () => {
		expect(built.gaps.length).toBeGreaterThan(0);
		const ranks = built.gaps.map((gap) =>
			["high", "medium", "low"].indexOf(gap.severity),
		);
		expect([...ranks].sort((a, b) => a - b)).toEqual(ranks);
		for (const gap of built.gaps) {
			expect(gap.severity).toBe(PACK_GAPS[gap.code].severity);
			expect(gap.setting).toBe(PACK_GAPS[gap.code].setting);
		}
		expect(built.gaps.find((gap) => gap.code === "staff_hours")).toMatchObject({
			scope: "ALL",
			value: null,
			setting: null,
		});
	});

	it("reads the fence before and after the calls with the pack's stores", async () => {
		const fence = fenceRpc(() => "steady");
		const again = await buildBrowserPack(request(), {
			source: demoSource(),
			rpc: fence.rpc,
			signal: new AbortController().signal,
			onProgress: () => undefined,
			clock: CLOCK,
		});
		expect(again.text).toBe(built.text);
		expect(fence.calls).toEqual([
			{ fn: "pack_fence", args: { store_ids: ["MOCK-S1", "MOCK-S2"] } },
			{ fn: "pack_fence", args: { store_ids: ["MOCK-S1", "MOCK-S2"] } },
		]);
	}, 60_000);

	it("gives up with pack_data_changed when the fence moves on every attempt", async () => {
		let tick = 0;
		const fence = fenceRpc(() => {
			tick += 1;
			return String(tick);
		});
		await expect(
			buildBrowserPack(request({ language: "en", focus: null }), {
				source: demoSource(),
				rpc: fence.rpc,
				signal: new AbortController().signal,
				onProgress: () => undefined,
				clock: CLOCK,
			}),
		).rejects.toMatchObject({ code: "pack_data_changed" });
		expect(fence.calls).toHaveLength(6);
	}, 60_000);

	it("refuses contact details in the focus before reading anything", async () => {
		const counting = countingSource(demoSource());
		const error = await buildBrowserPack(
			request({ focus: "Gọi 0901 234 567 nhé" }),
			{
				source: counting.source,
				rpc: null,
				signal: new AbortController().signal,
				onProgress: () => undefined,
				clock: CLOCK,
			},
		).catch((caught: unknown) => caught);
		expect(error).toBeInstanceOf(DataPackError);
		expect(error).toMatchObject({ code: "pack_text_contact_details" });
		expect(counting.count()).toBe(0);
	});

	it("stops asking once stopped and rejects with an AbortError", async () => {
		const controller = new AbortController();
		const counting = countingSource(demoSource());
		const error = await buildBrowserPack(request(), {
			source: counting.source,
			rpc: null,
			signal: controller.signal,
			onProgress: (done) => {
				if (done >= 2) controller.abort();
			},
			clock: CLOCK,
		}).catch((caught: unknown) => caught);
		expect(error).toBeInstanceOf(DOMException);
		expect((error as DOMException).name).toBe("AbortError");
		expect(counting.count()).toBeLessThan(10);
	});
});

describe("the browser pack's helpers", () => {
	it("refuses a call after the signal is aborted", async () => {
		const controller = new AbortController();
		controller.abort();
		const source = stoppableSource(demoSource(), controller.signal);
		await expect(
			source.callTheme("store_profiles", { store_ids: ["MOCK-S1"] }),
		).rejects.toMatchObject({ name: "AbortError" });
	});

	it("reads pack_fence as text and fails on an error or a missing value", async () => {
		const ok: RpcClient = {
			rpc: async () => ({ data: "abc", error: null }),
		};
		await expect(packFence(ok, ["s"])()).resolves.toBe("abc");
		const failing: RpcClient = {
			rpc: async () => ({ data: null, error: { message: "denied" } }),
		};
		await expect(packFence(failing, ["s"])()).rejects.toThrow("denied");
		const empty: RpcClient = {
			rpc: async () => ({ data: null, error: null }),
		};
		await expect(packFence(empty, ["s"])()).rejects.toThrow("no text");
	});

	it("names the files by as-of day, all stores or their labels, and the pack id's first eight digits", () => {
		const packId = "0123456789abcdef".repeat(4);
		expect(
			packFileName({
				asOf: "2026-11-11",
				labels: ["S1", "S2"],
				allStores: true,
				packId,
			}),
		).toBe("goi-du-lieu_2026-11-11_tat-ca_01234567.json");
		expect(
			packFileName({
				asOf: "2026-11-11",
				labels: ["S1", "S3"],
				allStores: false,
				packId,
			}),
		).toBe("goi-du-lieu_2026-11-11_s1-s3_01234567.json");
		expect(
			bundleFileName({
				asOf: "2026-11-11",
				labels: ["S2"],
				allStores: false,
				packId,
			}),
		).toBe("goi-du-lieu-kem-prompt_2026-11-11_s2_01234567.txt");
	});
});
