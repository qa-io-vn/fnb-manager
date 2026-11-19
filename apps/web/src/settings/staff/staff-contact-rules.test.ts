import { describe, expect, it } from "vitest";
import {
	contactLength,
	normalisedContact,
	STAFF_CONTACT_MAX,
	staffContactIssue,
	textHoldsLink,
} from "./staff-contact-rules";

describe("the staff contact note", () => {
	it("keeps line breaks, makes Windows line breaks plain and trims spaces, tabs and blank lines at the ends", () => {
		expect(
			normalisedContact(
				"  \r\nGặp quản lý ca tại quầy.\r\nGọi 0901 234 567.\n\t ",
			),
		).toBe("Gặp quản lý ca tại quầy.\nGọi 0901 234 567.");
		expect(normalisedContact(" \n\t ")).toBeNull();
		expect(normalisedContact("")).toBeNull();
	});

	it("counts characters once composed, as the database counts the text it is sent", () => {
		expect(contactLength(normalisedContact("ệ"))).toBe(1);
		expect(staffContactIssue("ệ".repeat(STAFF_CONTACT_MAX))).toBeNull();
		expect(staffContactIssue("ệ".repeat(STAFF_CONTACT_MAX + 1))).toBe(
			"tooLong",
		);
	});

	it("refuses control characters other than line breaks and tabs", () => {
		expect(staffContactIssue("Gặp\tquản lý\nở quầy")).toBeNull();
		expect(staffContactIssue("Gặp\u0007quản lý")).toBe("control");
	});

	it.each([
		"Xem https://example.com",
		"Vào www.example.com",
		"Nhắn zalo.me/0901234567",
		"Trang example.vn",
		"Trang shop.example.com.",
		"ftp://files",
	])("finds a link in %s", (text) => {
		expect(textHoldsLink(text)).toBe(true);
		expect(staffContactIssue(text)).toBe("link");
	});

	it.each([
		"Gửi thư tới hr@example.com",
		"Gọi 0901.234.567",
		"Cửa hàng ở TP.HCM",
		"Phiên bản 1.2.3",
		"Gặp chị Lan, quản lý ca sáng",
	])("finds no link in %s", (text) => {
		expect(textHoldsLink(text)).toBe(false);
		expect(staffContactIssue(text)).toBeNull();
	});
});
