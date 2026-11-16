import {
	type AnalyticsRow,
	type ReportSource,
	rangeOfPreset,
	runTheme,
	shiftsCalls,
	shiftsTheme,
	type ThemeContext,
	type ThemeRow,
} from "@fnb/reports";
import { describe, expect, it, vi } from "vitest";
import { csvOfRows } from "../../../components/report-card/data-table";
import { ReportCard } from "../../../components/report-card/report-card";
import { translate } from "../../../i18n";
import { CSV_DIALECTS } from "../../../lib/csv";
import { toReportCardProps } from "../../../reports/card-adapter";
import { renderWithLanguage, vndFormatters } from "../../../test/render";

vi.mock("../../../components/report-card/echarts-view", () => ({
	default: () => <div data-testid="echarts" />,
}));

const STORE = "11111111-1111-4111-8111-111111111111";
const LOGIN = "thu.ngan@example.com";
const EMAIL_LIKE = /[^\s@]+@[^\s@]+\.[^\s@]+/;

function reviewRow(
	id: string,
	openedAt: string,
	overrides: Partial<AnalyticsRow<"shift_review">> = {},
): AnalyticsRow<"shift_review"> {
	return {
		store_id: STORE,
		shift_id: id,
		shift_external_id: id,
		shift_name: LOGIN,
		business_date: "2026-10-20",
		cashier_name: LOGIN,
		opened_at: openedAt,
		closed_at: null,
		orders: 40,
		sales_amount: 2_000_000,
		cash_sales_amount: 800_000,
		opening_float_amount: 500_000,
		expected_cash_amount: 1_300_000,
		drawer_amount: 1_200_000,
		variance_amount: -100_000,
		trailing_shifts: 10,
		z_score: -2.5,
		over_abs_threshold: true,
		over_rel_threshold: false,
		over_z_threshold: true,
		flagged: true,
		reasons: ["absolute", "z_score"],
		...overrides,
	};
}

function adjustmentRow(
	id: string,
	openedAt: string,
): ThemeRow<"shift_adjustments"> {
	return {
		store_id: STORE,
		shift_id: id,
		shift_external_id: id,
		shift_name: LOGIN,
		business_date: "2026-10-20",
		cashier_name: LOGIN,
		opened_at: openedAt,
		closed_at: null,
		orders: 40,
		item_lines: 60,
		voids: 3,
		void_amount: 90_000,
		edits: 2,
		removed_lines: 2,
		removed_amount: 40_000,
		edits_after_close: 1,
		changed_after_close: true,
		void_rate: 0.069767,
		removed_line_rate: 0.033333,
		trailing_shifts: 12,
		void_z_score: 2.6,
		removed_z_score: 1.1,
		flagged: true,
		reasons: ["voids", "after_close"],
	};
}

const context: ThemeContext = {
	tenantId: "33333333-3333-4333-8333-333333333333",
	stores: [
		{
			id: STORE,
			name: "Store 1",
			timeZone: "Asia/Ho_Chi_Minh",
			businessDayStartMinutes: 0,
		},
	],
	allStoresSelected: true,
	range: rangeOfPreset("28d", "2026-11-03"),
	sample: false,
	params: {},
	catchUpPending: null,
};

const answers: Readonly<Record<string, readonly unknown[]>> = {
	[shiftsCalls.coverage]: [],
	[shiftsCalls.shifts]: [
		reviewRow("late", "2026-10-20T08:00:00Z"),
		reviewRow("early", "2026-10-20T01:00:00Z", { cashier_name: null }),
	],
	[shiftsCalls.adjustments]: [
		adjustmentRow("late", "2026-10-20T08:00:00Z"),
		adjustmentRow("early", "2026-10-20T01:00:00Z"),
	],
	[shiftsCalls.settings]: [],
};

function fixtureSource(): ReportSource {
	const keys = new Map(
		shiftsTheme
			.primaryCalls(context)
			.map((call) => [JSON.stringify([call.name, call.args]), call.key]),
	);
	const answer = async (name: string, args: unknown) =>
		answers[keys.get(JSON.stringify([name, args])) ?? ""] ?? [];
	return {
		kind: "supabase",
		call: answer as ReportSource["call"],
		callTheme: answer as ReportSource["callTheme"],
	};
}

describe("Ca & két tiền with e-mail-shaped shift and cashier names", () => {
	it("shows no e-mail address in any card, table or CSV in either dialect, and labels shifts Ca n", async () => {
		const cards = await runTheme(shiftsTheme, context, fixtureSource());
		expect(cards.map((card) => card.id)).toEqual([
			"shift_sales",
			"drawer",
			"adjustments",
		]);
		for (const language of ["vi", "en"] as const) {
			const formatters = vndFormatters(language === "vi" ? "vi-VN" : "en-GB");
			for (const card of cards) {
				const props = toReportCardProps(
					card,
					"shifts",
					(key, params) => translate(language, key, params),
					formatters,
				);
				const tables = [props.table, props.secondaryTable].filter(
					(table) => table !== undefined,
				);
				expect(tables.length, card.id).toBeGreaterThan(0);
				expect(
					JSON.stringify([props.sentence, props.chart ?? null, tables]),
				).not.toMatch(EMAIL_LIKE);
				for (const dialect of CSV_DIALECTS) {
					for (const table of tables) {
						const csv = csvOfRows(
							table.columns,
							table.rows,
							(label) => `${label} (%)`,
							formatters,
							dialect,
						);
						expect(csv, `${card.id} ${dialect}`).not.toContain("@");
					}
				}
			}
			const shiftColumn = cards
				.flatMap((card) => card.tables[0]?.rows ?? [])
				.map((row) => [row.id, row.cells.shift]);
			expect(shiftColumn).toContainEqual(["early", 1]);
			expect(shiftColumn).toContainEqual(["late", 2]);
			expect(shiftColumn).not.toContainEqual(["early", 2]);
		}
	});

	it("renders every card without an @ anywhere in its markup, attributes and accessible labels included", async () => {
		const cards = await runTheme(shiftsTheme, context, fixtureSource());
		for (const language of ["vi", "en"] as const) {
			const formatters = vndFormatters(language === "vi" ? "vi-VN" : "en-GB");
			for (const card of cards) {
				const props = toReportCardProps(
					card,
					"shifts",
					(key, params) => translate(language, key, params),
					formatters,
				);
				const { container, unmount } = renderWithLanguage(
					<ReportCard {...props} />,
					language,
				);
				const markup = container.innerHTML;
				expect(markup, `${card.id} ${language}`).toContain(
					language === "vi" ? "Ca 1" : "Shift 1",
				);
				expect(markup, `${card.id} ${language}`).not.toContain("@");
				expect(markup, `${card.id} ${language}`).not.toContain("example.com");
				expect(markup, `${card.id} ${language}`).not.toMatch(EMAIL_LIKE);
				unmount();
			}
		}
	});
});
