import {
	type AnalyticsRow,
	type ReportSource,
	rangeOfPreset,
	runTheme,
	shiftsCalls,
	shiftsKeys,
	shiftsTheme,
	type ThemeContext,
	type ThemeRow,
} from "@fnb/reports";
import { describe, expect, it, vi } from "vitest";
import { csvOfRows } from "../../../components/report-card/data-table";
import { ReportCard } from "../../../components/report-card/report-card";
import { type MessageKey, translate } from "../../../i18n";
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

function memberRow(
	ordinal: number | null,
	openedAt: string | null,
	invoices: number,
	members: number,
): ThemeRow<"member_share_by_shift"> {
	return {
		store_id: STORE,
		business_date: "2026-10-20",
		shift_ordinal: ordinal,
		opened_at: openedAt,
		closed_at: null,
		invoices,
		member_invoices: members,
		identified_invoices: members,
		member_share: members / invoices,
		identified_share: members / invoices,
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

type Answers = Readonly<Record<string, readonly unknown[]>>;

const loginShifts = [
	reviewRow("late", "2026-10-20T08:00:00Z"),
	reviewRow("early", "2026-10-20T01:00:00Z", { cashier_name: null }),
];

const answers: Answers = {
	[shiftsCalls.coverage]: [],
	[shiftsCalls.shifts]: [
		...loginShifts,
		reviewRow("named", "2026-10-21T01:00:00Z", {
			business_date: "2026-10-21",
			cashier_name: "Lan",
		}),
	],
	[shiftsCalls.adjustments]: [
		adjustmentRow("late", "2026-10-20T08:00:00Z"),
		adjustmentRow("early", "2026-10-20T01:00:00Z"),
	],
	[shiftsCalls.settings]: [],
	[shiftsCalls.memberShare]: [
		memberRow(1, "2026-10-20T01:00:00Z", 40, 12),
		memberRow(2, "2026-10-20T08:00:00Z", 30, 3),
		memberRow(null, null, 4, 1),
	],
	[shiftsCalls.memberSharePrevious]: [],
};

const unnamedAnswers: Answers = {
	...answers,
	[shiftsCalls.shifts]: loginShifts,
};

const sharedLoginAnswers: Answers = {
	...answers,
	[shiftsCalls.shifts]: [
		reviewRow("late", "2026-10-20T08:00:00Z"),
		reviewRow("early", "2026-10-20T01:00:00Z", { cashier_name: ` ${LOGIN} ` }),
	],
};

function fixtureSource(fixture: Answers = answers): ReportSource {
	const keys = new Map(
		shiftsTheme
			.primaryCalls(context)
			.map((call) => [JSON.stringify([call.name, call.args]), call.key]),
	);
	const answer = async (name: string, args: unknown) =>
		fixture[keys.get(JSON.stringify([name, args])) ?? ""] ?? [];
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
			"cashiers",
			"member_share",
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
					card.id === "cashiers"
						? translate(language, "report.label.unknownCashier")
						: translate(language, "report.label.shiftNumber", { number: 1 }),
				);
				expect(markup, `${card.id} ${language}`).not.toContain("@");
				expect(markup, `${card.id} ${language}`).not.toContain("example.com");
				expect(markup, `${card.id} ${language}`).not.toMatch(EMAIL_LIKE);
				unmount();
			}
		}
	});

	it("asks for display names when the cashiers are an e-mail login and an empty value, and for individual logins when every shift carries one login, never ranking and never showing an address", async () => {
		for (const [fixture, notice] of [
			[unnamedAnswers, shiftsKeys.cashiers.displayNames],
			[sharedLoginAnswers, shiftsKeys.cashiers.logins],
		] as const) {
			const cards = await runTheme(
				shiftsTheme,
				context,
				fixtureSource(fixture),
			);
			const cashiers = cards.find((card) => card.id === "cashiers");
			expect(cashiers?.notice?.part.key).toBe(notice);
			expect(cashiers?.headline.value).toBeNull();
			expect(cashiers?.tables[0]?.rows).toEqual([]);
			for (const language of ["vi", "en"] as const) {
				const formatters = vndFormatters(language === "vi" ? "vi-VN" : "en-GB");
				const props = toReportCardProps(
					cashiers as NonNullable<typeof cashiers>,
					"shifts",
					(key, params) => translate(language, key, params),
					formatters,
				);
				const { container, unmount } = renderWithLanguage(
					<ReportCard {...props} />,
					language,
				);
				const markup = container.innerHTML;
				expect(markup, `${notice} ${language}`).toContain(
					translate(language, notice as MessageKey),
				);
				expect(markup, `${notice} ${language}`).not.toContain("@");
				expect(markup, `${notice} ${language}`).not.toMatch(EMAIL_LIKE);
				unmount();
			}
		}
	});

	it("reads the member share table's shift column as Ca n, and Không rõ ca for invoices tied to no shift, in both languages", async () => {
		const cards = await runTheme(shiftsTheme, context, fixtureSource());
		const card = cards.find((entry) => entry.id === "member_share");
		expect(card).toBeDefined();
		for (const language of ["vi", "en"] as const) {
			const props = toReportCardProps(
				card as NonNullable<typeof card>,
				"shifts",
				(key, params) => translate(language, key, params),
				vndFormatters(language === "vi" ? "vi-VN" : "en-GB"),
			);
			expect(props.table?.rows.map((row) => row.cells.shift)).toEqual([
				translate(language, "report.label.shiftNumber", { number: 1 }),
				translate(language, "report.label.shiftNumber", { number: 2 }),
				translate(
					language,
					"theme.shifts.memberShare.unknownShift" as MessageKey,
				),
			]);
		}
	});
});
