import {
	DATA_PACK_BUILDER_VERSION,
	DATA_PACK_FORMAT,
	DATA_PACK_SCHEMA_VERSION,
	type DataPack,
	type PackTable,
} from "../../src/pack/schema.js";
import { FIXTURE_CALENDAR } from "./fixture-calendar.js";

export const SEED_STORE_A = "22222222-2222-4222-8222-000000000001";
export const SEED_STORE_B = "22222222-2222-4222-8222-000000000002";
export const REPEATED_GROUP_ID = "11111111-1111-4111-8111-111111111111";

export function kpiTable(): PackTable {
	return {
		title: "KPI theo 28 ngày",
		grain: "metric-window",
		window: "w28",
		notes: "lo và hi là khoảng thường gặp của 12 tuần.",
		columns: [
			{ name: "w28", unit: "metric" },
			{ name: "p28", unit: "metric" },
			{ name: "vs_p28", unit: "rel_change" },
			{ name: "lo", unit: "metric" },
			{ name: "hi", unit: "metric" },
			{ name: "n", unit: "count" },
		],
		rows: {
			"ALL/avg_ticket": [52314.2714285714, 50120.5, 0.0438, 48000, 55000, 12],
			"ALL/net_sales_per_day": [
				8125000.333333, 7999000, 0.0158, 7000000, 9000000, 12,
			],
			"S1/avg_ticket": [49876.25, null, null, 45000, 52000, 12],
			"S2/avg_ticket": [54210, 53000, 0.0228, 50000, 57000, 12],
		},
	};
}

export function itemsTable(): PackTable {
	return {
		title: "Món bán chạy",
		grain: "item-period",
		window: "w28",
		notes: "",
		columns: [
			{ name: "name", unit: "text" },
			{ name: "net", unit: "money" },
			{ name: "qty", unit: "quantity" },
			{ name: "share", unit: "fraction" },
			{ name: "class", unit: "class" },
			{ name: "new", unit: "flag" },
			{ name: "first_sold", unit: "date" },
		],
		rows: {
			"ALL/r01": [
				"Trà sữa trân châu",
				12500000,
				312.5,
				0.1234,
				"star",
				false,
				"2025-03-01",
			],
			"ALL/r02": [
				"Cà phê sữa đá",
				9800000,
				280,
				0.0967,
				"plowhorse",
				true,
				"2026-10-20",
			],
			"S1/r01": [
				"Trà sữa trân châu",
				6200000,
				155.25,
				0.0612,
				"star",
				false,
				"2025-03-01",
			],
			"S2/r01": ["Bánh mì 24h", 3100000, 0.125, 0.0001, null, null, null],
		},
	};
}

export function draftPack(): DataPack {
	return {
		budget: { estimated_tokens: 0, limit: 30000, trimmed: [] },
		builder_version: DATA_PACK_BUILDER_VERSION,
		calendar: FIXTURE_CALENDAR,
		context: {
			benchmarks: [["avg_ticket", "2026-01-01", "VN", "45.000–60.000 đ"]],
			note: "Bối cảnh, không trích dẫn.",
			rules: [["promotion_cap", "VN", "2026-01-01", "Tối đa 50 %"]],
		},
		format: DATA_PACK_FORMAT,
		generated_at: "2026-11-12T03:00:00Z",
		pack_id: "0".repeat(64),
		prompt: {
			id: "fnb-strategy",
			language: "vi",
			text: "Viết kế hoạch.\nTrích dẫn số.",
			version: "1.0.0",
		},
		request: {
			as_of: "2026-11-11",
			currency: "VND",
			focus: "Tăng giá trị hóa đơn buổi chiều",
			horizon: "90d",
			language: "vi",
			owner_note: null,
			stores: [
				{ id: SEED_STORE_A, label: "S1" },
				{ id: SEED_STORE_B, label: "S2" },
			],
		},
		sample: false,
		schema_version: DATA_PACK_SCHEMA_VERSION,
		tables: { items: itemsTable(), kpi: kpiTable() },
	};
}

export function samplePackDraft(): DataPack {
	const draft = draftPack();
	return {
		...draft,
		sample: true,
		request: {
			...draft.request,
			stores: [
				{ id: "MOCK-S1", label: "S1" },
				{ id: "MOCK-S2", label: "S2" },
			],
		},
	};
}

export function reorderKeys(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(reorderKeys);
	if (typeof value !== "object" || value === null) return value;
	const entries = Object.entries(value).map(
		([key, item]) => [key, reorderKeys(item)] as const,
	);
	entries.sort(([left], [right]) =>
		left.length !== right.length
			? left.length - right.length
			: left < right
				? 1
				: left > right
					? -1
					: 0,
	);
	return Object.fromEntries(entries);
}
