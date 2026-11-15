import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { renderWithLanguage, vndFormatters } from "../../test/render";
import { AuditLine, auditAuthorOf, type MemberRoleRow } from "./audit-line";

const MEMBERS: readonly MemberRoleRow[] = [
	{ userId: "u-owner", role: "owner" },
	{ userId: "u-manager", role: "manager" },
];

const CHANGED_AT = "2026-11-14T17:30:00Z";

describe("auditAuthorOf", () => {
	it("names the current member, another member by role, or nobody", () => {
		expect(auditAuthorOf("u-owner", "u-owner", MEMBERS)).toEqual({
			kind: "you",
		});
		expect(auditAuthorOf("u-manager", "u-owner", MEMBERS)).toEqual({
			kind: "member",
			role: "manager",
		});
		expect(auditAuthorOf("u-gone", "u-owner", MEMBERS)).toEqual({
			kind: "unknown",
		});
		expect(auditAuthorOf(null, "u-owner", MEMBERS)).toEqual({
			kind: "unknown",
		});
	});
});

describe("AuditLine", () => {
	const formatters = vndFormatters();

	it("says when and by which role a value last changed, in the shop's time zone", () => {
		renderWithLanguage(
			<AuditLine
				entry={{
					changedAt: CHANGED_AT,
					author: { kind: "member", role: "manager" },
				}}
				formatters={formatters}
				timeZone="Asia/Ho_Chi_Minh"
			/>,
		);
		expect(screen.getByTestId("settings-audit-line")).toHaveTextContent(
			"Sửa lần cuối 15/11/2026 lúc 00:30, bởi quản lý.",
		);
	});

	it("says when the current member made the change", () => {
		renderWithLanguage(
			<AuditLine
				entry={{ changedAt: CHANGED_AT, author: { kind: "you" } }}
				formatters={formatters}
				timeZone="Asia/Ho_Chi_Minh"
			/>,
		);
		expect(screen.getByTestId("settings-audit-line")).toHaveTextContent(
			"Bạn sửa lần cuối 15/11/2026 lúc 00:30.",
		);
	});

	it("gives only the time when the author cannot be read", () => {
		renderWithLanguage(
			<AuditLine
				entry={{ changedAt: CHANGED_AT, author: { kind: "unknown" } }}
				formatters={formatters}
				timeZone="Asia/Ho_Chi_Minh"
			/>,
			"en",
		);
		expect(screen.getByTestId("settings-audit-line")).toHaveTextContent(
			"Last changed on 15/11/2026 at 00:30.",
		);
	});

	it("says nothing was saved yet, or the page's own words for it", () => {
		const { rerender } = renderWithLanguage(
			<AuditLine
				entry={null}
				formatters={formatters}
				timeZone="Asia/Ho_Chi_Minh"
			/>,
		);
		expect(screen.getByTestId("settings-audit-line")).toHaveTextContent(
			"Chưa lưu lần nào.",
		);
		rerender(
			<AuditLine
				entry={null}
				formatters={formatters}
				timeZone="Asia/Ho_Chi_Minh"
				neverText="Đang dùng giá trị mặc định."
			/>,
		);
		expect(screen.getByTestId("settings-audit-line")).toHaveTextContent(
			"Đang dùng giá trị mặc định.",
		);
	});
});
