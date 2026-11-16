import { describe, expect, it } from "vitest";
import { webhookAddressHint, webhookUrlProblem } from "../../src/index.js";

describe("webhook URL rules", () => {
	it.each([
		"https://user:pw@example.com/x",
		"https://user@example.com/x",
		"https://hooks.example.com/x?token=1",
		"https://hooks.example.com/x?",
		"https://hooks.example.com/x#fragment",
		"https://hooks.example.com/hooks/abcdefghij0123456789",
		"https://hooks.example.com/a1b2c3d4e5f6g7h8i9j0k1",
		"http://hooks.example.com/fnb/alerts",
		"https://hooks.example.com/with space",
		"hooks.example.com/fnb/alerts",
		`https://hooks.example.com/${"a".repeat(2000)}`,
	])("refuses %s", (url) => {
		const problem = webhookUrlProblem(url);
		expect(problem).not.toBeNull();
		expect(problem).not.toContain("pw");
		expect(problem).not.toContain("token");
	});

	it.each([
		"https://hooks.example.com/fnb/alerts",
		"https://hooks.example.com",
		"https://hooks.example.com/",
		"https://hooks.example.com:8443/fnb/alerts-from-the-shop",
		"https://hooks.example.com/abcdefghijklmnopqrstuvwxyz",
		"https://hooks.example.com/0123456789012345678901234",
	])("accepts %s", (url) => {
		expect(webhookUrlProblem(url)).toBeNull();
	});

	it("shows only the host as the destination's hint", () => {
		expect(webhookAddressHint("https://hooks.example.com/fnb/alerts")).toBe(
			"hooks.example.com",
		);
	});
});
