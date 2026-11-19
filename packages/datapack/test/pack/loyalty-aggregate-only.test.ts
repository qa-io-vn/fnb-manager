import type {
	AnalyticsArgs,
	AnalyticsFunctionName,
	ReportSource,
	ThemeArgs,
	ThemeFunctionName,
} from "@fnb/reports";
import { beforeAll, describe, expect, it } from "vitest";
import {
	aggregatesOnlyIssues,
	forbiddenColumnRule,
	personalTextRules,
} from "../../src/pack/aggregates.js";
import type { BuiltPack } from "../../src/pack/build.js";
import type { PackTable } from "../../src/pack/schema.js";
import { buildWith, demoRequest, demoSource } from "./support/demo.js";

// G-25. ISTQB techniques: error guessing (a source that leaks member fields into every row it answers) and
// equivalence partitioning of the pack's columns and texts. Synthetic values only.
const MEMBER_PHONE = "0900000123";
const MEMBER_PHONE_E164 = `+84${MEMBER_PHONE.slice(1)}`;
const MEMBER_ID = "aaaaaaaa-aaaa-4aaa-8aaa-000000000001";
const CUSTOMER_ID = "bbbbbbbb-bbbb-4bbb-8bbb-000000000002";
const MEMBER_NAME = "Synthetic Member Name";
const LEAKS = [
	MEMBER_PHONE,
	"900000123",
	MEMBER_ID,
	CUSTOMER_ID,
	MEMBER_NAME,
] as const;

function withMemberFields(base: ReportSource): ReportSource {
	const decorate = <Row>(rows: Row[]): Row[] =>
		rows.map((row) => ({
			...row,
			customer_phone: MEMBER_PHONE,
			member_phone: MEMBER_PHONE_E164,
			phone_full: MEMBER_PHONE_E164,
			membership_id: MEMBER_ID,
			member_id: MEMBER_ID,
			customer_id: CUSTOMER_ID,
			customer_name: MEMBER_NAME,
		}));
	return {
		kind: base.kind,
		async call<N extends AnalyticsFunctionName>(
			name: N,
			args: AnalyticsArgs<N>,
		) {
			return decorate(await base.call(name, args));
		},
		async callTheme<N extends ThemeFunctionName>(name: N, args: ThemeArgs<N>) {
			return decorate(await base.callTheme(name, args));
		},
	};
}

describe("the data pack of a tenant with loyalty data", () => {
	let built: BuiltPack;
	let text: string;

	beforeAll(async () => {
		built = await buildWith(
			withMemberFields(demoSource()),
			demoRequest({ focus: "Tăng khách quen" }),
		);
		text = JSON.stringify(built.pack);
	});

	it("passes the aggregate-only check", () => {
		expect(aggregatesOnlyIssues(built.pack)).toEqual([]);
	});

	it("carries no phone, member id, customer id or name that the source leaked into its rows", () => {
		for (const leak of LEAKS) expect(text).not.toContain(leak);
		expect(personalTextRules(text)).not.toContain("text_phone");
		expect(personalTextRules(text)).not.toContain("text_email");
	});

	it("has no column that names a phone, a person or an id", () => {
		const names = Object.values(built.pack.tables).flatMap((table) =>
			table.columns.map((column) => column.name),
		);
		expect(names.length).toBeGreaterThan(20);
		expect(names.filter((name) => forbiddenColumnRule(name) !== null)).toEqual(
			[],
		);
		expect(names.filter((name) => /member|phone|customer/.test(name))).toEqual(
			[],
		);
	});

	it("holds member_invoice_share only as a share of invoices", () => {
		const shares = Object.values(built.pack.tables).flatMap((table) =>
			Object.entries(table.rows).filter(([key]) =>
				key.endsWith("/member_invoice_share"),
			),
		);
		expect(shares.length).toBeGreaterThanOrEqual(3);
		for (const [, row] of shares) {
			const value = row[0];
			expect(
				value === null ||
					(typeof value === "number" && value >= 0 && value <= 1),
			).toBe(true);
		}
		const rowKeys = Object.values(built.pack.tables).flatMap((table) =>
			Object.keys(table.rows),
		);
		// the aggregate metric ids and the gap id that name members or customers
		const otherwise = rowKeys.filter((key) =>
			/member|phone|customer/.test(
				key.replace(
					/member_invoice_share|customer_capture_rate|no_customer_identity/g,
					"",
				),
			),
		);
		expect(otherwise).toEqual([]);
	});

	it("still refuses a table that would carry members", () => {
		const base = built.pack;
		const [firstId, first] = Object.entries(base.tables)[0] as [
			string,
			PackTable,
		];
		const refuse = (table: PackTable): string[] =>
			aggregatesOnlyIssues({
				...base,
				tables: { ...base.tables, [firstId]: table },
			}).map((issue) => issue.code);
		const column = (name: string): PackTable => ({
			...first,
			columns: [
				...first.columns,
				{ ...(first.columns[0] as PackTable["columns"][number]), name },
			],
		});
		expect(refuse(column("member_phone"))).toContain("column_forbidden");
		expect(refuse(column("membership_id"))).toContain("column_forbidden");
		expect(refuse(column("member_id"))).toContain("column_forbidden");
		expect(refuse(column("customer_id"))).toContain("column_forbidden");
		expect(refuse(column("customer_name"))).toContain("column_forbidden");
		expect(
			refuse({ ...first, grain: "member" as PackTable["grain"] }),
		).toContain("grain_not_allowed");
		expect(
			refuse({ ...first, grain: "customer" as PackTable["grain"] }),
		).toContain("grain_not_allowed");
		expect(refuse({ ...first, notes: `Gọi ${MEMBER_PHONE}` })).toContain(
			"text_phone",
		);
		expect(refuse({ ...first, notes: MEMBER_ID })).toContain("text_uuid");
	});

	it("refuses a request whose focus or note carries a member's phone or id", async () => {
		for (const focus of [`Khách ${MEMBER_PHONE}`, `Thành viên ${MEMBER_ID}`]) {
			await expect(
				buildWith(demoSource(), demoRequest({ focus })),
			).rejects.toThrow(/^pack_(text_contact_details|not_aggregate|text_)/);
		}
	});
});
