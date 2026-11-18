import { currentMetricIds, metricValueIds } from "@fnb/metrics";
import { describe, expect, it } from "vitest";
import * as datapack from "../../src/index.js";
import {
	aggregatesOnlyIssues,
	buildDataPack,
	calendarOf,
	canonicalJson,
	chatBundle,
	comparePackTexts,
	comparePlans,
	DATA_PACK_BUILDER_VERSION,
	DATA_PACK_FORMAT,
	DATA_PACK_SCHEMA_VERSION,
	type DataPack,
	DataPackError,
	dataPackSchema,
	estimateTokens,
	formatDecimal,
	INITIATIVE_FIELDS,
	KPI_EXCLUDED_METRIC_IDS,
	KPI_WINDOW_DAYS,
	kpiStatus,
	lintPlan,
	normalizePlanText,
	PLAN_FORMAT,
	PLAN_LINT_CODE_IDS,
	PLAN_LINT_CODES,
	PLAN_SECTIONS,
	PROMPT_ID,
	PROMPT_VERSION,
	packCalls,
	parsePack,
	parsePlan,
	planFrontMatterSchema,
	planIssueParameter,
	planLintCodeOf,
	planRecord,
	sha256Hex,
	strategyPrompt,
	TOKEN_FLOOR,
	TOKEN_LIMIT,
	trackableMetricIds,
	validatePack,
} from "../../src/index.js";
import * as testing from "../../src/testing/index.js";

const NOT_IMPLEMENTED = /^not_implemented: /;

const STORE_A = "11111111-1111-4111-8111-111111111111";
const STORE_B = "22222222-2222-4222-8222-222222222222";
const PACK_ID = "0".repeat(64);

function range(from: string, to: string) {
	return { from, to };
}

function minimalPack(): DataPack {
	return {
		budget: { estimated_tokens: 0, limit: TOKEN_LIMIT, trimmed: [] },
		builder_version: DATA_PACK_BUILDER_VERSION,
		calendar: {
			band: range("2026-08-20", "2026-11-11"),
			horizon: range("2026-11-12", "2027-02-09"),
			ly28: range("2025-10-16", "2025-11-12"),
			month_to_date: range("2026-11-01", "2026-11-11"),
			months: range("2024-08-01", "2026-10-31"),
			p28: range("2026-09-17", "2026-10-14"),
			w28: range("2026-10-15", "2026-11-11"),
			w84: range("2026-08-20", "2026-11-11"),
			weeks: range("2026-08-10", "2026-11-08"),
		},
		context: { benchmarks: [], note: "", rules: [] },
		format: DATA_PACK_FORMAT,
		generated_at: "2026-11-12T03:00:00Z",
		pack_id: PACK_ID,
		prompt: { id: "fnb-strategy", language: "vi", text: "", version: "1.0.0" },
		request: {
			as_of: "2026-11-11",
			currency: "VND",
			focus: null,
			horizon: "90d",
			language: "vi",
			owner_note: null,
			stores: [
				{ id: STORE_A, label: "S1" },
				{ id: STORE_B, label: "S2" },
			],
		},
		sample: false,
		schema_version: DATA_PACK_SCHEMA_VERSION,
		tables: {
			kpi: {
				title: "KPI",
				grain: "metric-window",
				window: "w28",
				notes: "",
				columns: [{ name: "w28", unit: "metric" }],
				rows: { "ALL/avg_ticket": [52314.27] },
			},
		},
	};
}

describe("the public interface of @fnb/datapack", () => {
	it("exports the frozen names", () => {
		expect(Object.keys(datapack).sort()).toEqual(
			[
				"DATA_PACK_BUILDER_VERSION",
				"DATA_PACK_FORMAT",
				"DATA_PACK_SCHEMA_VERSION",
				"DEFAULT_HORIZON",
				"DataPackError",
				"FOCUS_MAX_LENGTH",
				"HORIZONS",
				"HORIZON_DAYS",
				"INITIATIVE_FIELDS",
				"INITIATIVE_FIELD_IDS",
				"INITIATIVE_HEADING",
				"KPI_EXCLUDED_METRIC_IDS",
				"KPI_STATUSES",
				"KPI_WINDOW_DAYS",
				"MAX_INITIATIVES",
				"MAX_PACK_STORES",
				"MAX_PLAN_CONTENT_BYTES",
				"MAX_PLAN_KPIS",
				"MIN_INITIATIVES",
				"NOT_IMPLEMENTED",
				"OWNER_NOTE_MAX_LENGTH",
				"PACK_ERROR_CODES",
				"PACK_GAPS",
				"PACK_GRAINS",
				"PACK_LANGUAGES",
				"PACK_UNITS",
				"PACK_WINDOWS",
				"PLAN_FORMAT",
				"PLAN_LINT_CODES",
				"PLAN_LINT_CODE_IDS",
				"PLAN_SECTIONS",
				"PLAN_SECTION_IDS",
				"PLAN_VIAS",
				"PROMPT_ID",
				"PROMPT_VERSION",
				"ROW_KEY_PATTERN",
				"STORE_ID_PATTERN",
				"TOKEN_FLOOR",
				"TOKEN_LIMIT",
				"aggregatesOnlyIssues",
				"buildDataPack",
				"calendarOf",
				"canonicalJson",
				"chatBundle",
				"comparePackTexts",
				"comparePlans",
				"dataPackSchema",
				"estimateTokens",
				"formatDecimal",
				"kpiStatus",
				"lintPlan",
				"normalizePlanText",
				"packCalls",
				"packTableSchema",
				"parsePack",
				"parsePlan",
				"planFrontMatterSchema",
				"planIssueParameter",
				"planLintCodeOf",
				"planRecord",
				"sha256Hex",
				"strategyPrompt",
				"trackableMetricIds",
				"validatePack",
			].sort(),
		);
		expect(Object.keys(testing).sort()).toEqual(["miniPack", "samplePlan"]);
	});

	it("holds the constants at their final values", () => {
		expect(DATA_PACK_FORMAT).toBe("fnb-datapack");
		expect(DATA_PACK_SCHEMA_VERSION).toBe("1.0.0");
		expect(DATA_PACK_BUILDER_VERSION).toBe("1.0.0");
		expect(TOKEN_LIMIT).toBe(30000);
		expect(TOKEN_FLOOR).toBe(15000);
		expect(KPI_WINDOW_DAYS).toBe(28);
		expect(KPI_EXCLUDED_METRIC_IDS).toEqual(["void_rate"]);
		expect(PLAN_FORMAT).toBe("fnb-plan/1");
		expect(PLAN_SECTIONS.map((section) => section.number)).toEqual([
			1, 2, 3, 4, 5, 6, 7, 8, 9, 10,
		]);
		expect(PLAN_SECTIONS.map((section) => section.title.vi)).toEqual([
			"Tóm tắt tình hình",
			"Điểm mạnh và điểm yếu",
			"Sáng kiến ưu tiên",
			"Kế hoạch 30/60/90 ngày",
			"Thực đơn",
			"Giờ mở cửa và nhân sự",
			"Lịch khuyến mãi",
			"Rủi ro",
			"Dữ liệu cần thu thập",
			"Giả định",
		]);
		expect(PLAN_SECTIONS.map((section) => section.title.en)).toEqual([
			"Situation summary",
			"Strengths and weaknesses",
			"Priority initiatives",
			"30/60/90-day plan",
			"Menu",
			"Opening hours and staffing",
			"Promotion calendar",
			"Risks",
			"Data to collect",
			"Assumptions",
		]);
		expect(
			INITIATIVE_FIELDS.map((field) => [
				field.id,
				field.label.vi,
				field.label.en,
			]),
		).toEqual([
			["evidence", "Căn cứ", "Evidence"],
			["action", "Hành động", "Action"],
			["impact", "Tác động dự kiến", "Expected impact"],
			["effort", "Công sức", "Effort"],
			["kpi", "KPI", "KPI"],
			["read", "Cách đọc KPI trên ứng dụng", "How to read the KPI in the app"],
			["first_step", "Bước đầu tiên", "First step"],
		]);
	});

	it("tracks the 18 metric ids that metric_value computes, are current and are not excluded", () => {
		const current = new Set<string>(currentMetricIds());
		const expected = metricValueIds().filter(
			(id) => current.has(id) && id !== "void_rate",
		);
		expect(trackableMetricIds()).toEqual(expected);
		expect(trackableMetricIds()).toHaveLength(18);
		for (const left of [
			"void_rate",
			"peak_share_20_21",
			"dead_hour_share_17_18",
		]) {
			expect(trackableMetricIds()).not.toContain(left);
		}
	});

	it("builds the format functions of the pack", async () => {
		expect(canonicalJson({ b: 1, a: [true, null, "x"] })).toBe(
			'{"a":[true,null,"x"],"b":1}\n',
		);
		expect(formatDecimal(1.5)).toBe("1.5");
		expect(estimateTokens("{}")).toBe(1);
		expect(aggregatesOnlyIssues(minimalPack())).toEqual([]);
		expect(await sha256Hex("")).toBe(
			"e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
		);
		expect((await parsePack("{}")).valid).toBe(false);
		expect((await validatePack({})).valid).toBe(false);
		expect((await comparePackTexts("{}", "{}")).valid).toBe(false);
	});

	it("derives the calendar and lists the calls, store profiles first", () => {
		expect(calendarOf("2026-11-11", "90d")).toEqual(minimalPack().calendar);
		const calls = packCalls({
			stores: [{ id: STORE_A, label: "S1" }],
			asOf: "2026-11-11",
			horizon: "90d",
			language: "vi",
			focus: null,
			ownerNote: null,
			sample: false,
			currency: "VND",
		});
		expect(calls[0]?.name).toBe("store_profiles");
		expect(calls.length).toBeGreaterThan(1);
	});

	it("builds the plan format and its lint", () => {
		const pack = minimalPack();
		expect(normalizePlanText("﻿---\r\n{}\r\n---\r\n\r\n")).toBe(
			"---\n{}\n---\n",
		);
		expect(() => parsePlan("---\n{}\n---\n")).toThrow(
			/^front_matter_invalid: /,
		);
		const empty = lintPlan("---\n{}\n---\n", pack);
		expect(empty.ok).toBe(false);
		expect(empty.plan).toBeNull();
		expect(empty.issues.map((issue) => issue.code)).toContain(
			"section_missing:7",
		);
		const text = `---\n${JSON.stringify({
			format: PLAN_FORMAT,
			pack: PACK_ID,
			title: "Kế hoạch",
			horizon: "90d",
			language: "vi",
			kpis: { avg_ticket: { target: 55000, initiatives: [1] } },
		})}\n---\n`;
		const plan = parsePlan(text);
		const lint = lintPlan(text, pack);
		expect(lint.plan).toEqual(plan);
		expect(lint.issues.map((issue) => issue.code)).not.toContain(
			"pack_mismatch",
		);
		expect(planRecord(plan, pack, lint, "pasted").p_kpis.avg_ticket).toEqual({
			scope: "ALL",
			store_ids: [STORE_A, STORE_B],
			baseline: 52314.27,
			target: 55000,
			lo: null,
			hi: null,
			initiatives: [1],
			due_on: "2027-02-09",
			window_days: KPI_WINDOW_DAYS,
		});
		expect(() =>
			planRecord(plan, { ...pack, sample: true }, lint, "pasted"),
		).toThrow(/^sample_pack_not_publishable: /);
	});

	it("names the 24 lint codes with their levels and reads a code's base and parameter", () => {
		expect(PLAN_LINT_CODE_IDS).toHaveLength(24);
		expect(PLAN_LINT_CODE_IDS).toEqual(Object.keys(PLAN_LINT_CODES));
		expect(
			PLAN_LINT_CODE_IDS.filter((code) => PLAN_LINT_CODES[code] === "warning"),
		).toEqual([
			"preamble_text",
			"front_matter_extra_fields",
			"kpi_initiative_unlinked",
			"uncited_numbers",
		]);
		expect(planLintCodeOf("section_missing:7")).toBe("section_missing");
		expect(planLintCodeOf("front_matter_missing")).toBe("front_matter_missing");
		expect(planLintCodeOf("not_a_code:1")).toBeNull();
		expect(planIssueParameter("citation_unknown:kpi:ALL/avg_ticket:w29")).toBe(
			"kpi:ALL/avg_ticket:w29",
		);
		expect(planIssueParameter("initiative_field_missing:2:effort")).toBe(
			"2:effort",
		);
		expect(planIssueParameter("pack_mismatch")).toBeNull();
	});

	it("builds the prompt and the chat bundle, and checks a request before reading", async () => {
		for (const language of ["vi", "en"] as const) {
			const prompt = strategyPrompt(language);
			expect(prompt.id).toBe(PROMPT_ID);
			expect(prompt.version).toBe(PROMPT_VERSION);
			const bundle = chatBundle({ ...minimalPack(), prompt: { ...prompt } });
			expect(
				bundle.startsWith(`${prompt.text}\n\n${"`".repeat(3)}json\n`),
			).toBe(true);
			expect(bundle).toContain(`"pack_id":"${PACK_ID}"`);
		}
		await expect(
			buildDataPack(
				{
					storeIds: [],
					asOf: null,
					horizon: "90d",
					language: "vi",
					focus: null,
					ownerNote: null,
					sample: false,
				},
				{
					source: { kind: "supabase" } as never,
					clock: { now: () => new Date(0) },
					fence: null,
				},
			),
		).rejects.toThrow(/^pack_stores_invalid: /);
	});

	it("builds the sample plan and the mini pack of the testing entry", () => {
		const pack = testing.miniPack();
		expect(pack.sample).toBe(false);
		expect(lintPlan(testing.samplePlan(pack), pack).ok).toBe(true);
	});

	it("throws not_implemented from every stub", () => {
		const synchronous: (() => unknown)[] = [
			() =>
				kpiStatus({
					baseline: 1,
					target: 2,
					current: null,
					elapsedDays: 0,
					horizonDays: 90,
					band: null,
				}),
		];
		for (const call of synchronous) {
			expect(call).toThrow(NOT_IMPLEMENTED);
			expect(call).toThrow(DataPackError);
		}
		const side = undefined as unknown as Parameters<typeof comparePlans>[0];
		expect(() =>
			comparePlans(side, side, { asOf: "2026-11-11", current: new Map() }),
		).toThrow(NOT_IMPLEMENTED);
	});
});

describe("the frozen schemas", () => {
	it("accept a minimal live-shaped pack and refuse unknown keys, bad row keys and sample ids", () => {
		expect(dataPackSchema.safeParse(minimalPack()).success).toBe(true);
		expect(
			dataPackSchema.safeParse({ ...minimalPack(), extra: true }).success,
		).toBe(false);
		const badKey = minimalPack();
		expect(
			dataPackSchema.safeParse({
				...badKey,
				tables: {
					kpi: { ...badKey.tables.kpi, rows: { "123": [1] } },
				},
			}).success,
		).toBe(false);
		const sample = minimalPack();
		expect(
			dataPackSchema.safeParse({
				...sample,
				sample: true,
				request: {
					...sample.request,
					stores: [{ id: "MOCK-S1", label: "S1" }],
				},
			}).success,
		).toBe(true);
		expect(
			dataPackSchema.safeParse({
				...sample,
				request: {
					...sample.request,
					stores: [{ id: "store-1", label: "S1" }],
				},
			}).success,
		).toBe(false);
	});

	it("read the plan front matter with scope ALL by default and drop unknown keys", () => {
		const parsed = planFrontMatterSchema.parse({
			format: "fnb-plan/1",
			pack: PACK_ID,
			title: "Kế hoạch",
			horizon: "90d",
			language: "vi",
			kpis: { avg_ticket: { target: 55000, initiatives: [1, 2] } },
			extra: 1,
		});
		expect(parsed.kpis.avg_ticket?.scope).toBe("ALL");
		expect(Object.keys(parsed)).not.toContain("extra");
		expect(
			planFrontMatterSchema.safeParse({
				...parsed,
				kpis: { avg_ticket: { target: 1, initiatives: [8] } },
			}).success,
		).toBe(false);
	});
});
