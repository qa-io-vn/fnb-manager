import { describe, expect, it } from "vitest";
import { apiOrigin, contentSecurityPolicy } from "./content-security-policy";

function directives(policy: string): Map<string, string[]> {
	return new Map(
		policy.split("; ").map((part) => {
			const [name, ...sources] = part.split(" ");
			return [name as string, sources];
		}),
	);
}

describe("contentSecurityPolicy", () => {
	it("allows no remote connection in the demo build", () => {
		for (const supabaseUrl of [undefined, "", "   "]) {
			const policy = directives(contentSecurityPolicy({ supabaseUrl }));
			expect(policy.get("connect-src")).toEqual(["'self'"]);
		}
	});

	it("allows exactly one API origin in the live build", () => {
		const policy = directives(
			contentSecurityPolicy({
				supabaseUrl: "https://abcdefghijklmnop.supabase.co/rest/v1?x=1",
			}),
		);
		expect(policy.get("connect-src")).toEqual([
			"'self'",
			"https://abcdefghijklmnop.supabase.co",
		]);
	});

	it("keeps the port of a local stack", () => {
		expect(apiOrigin("http://127.0.0.1:54321")).toBe("http://127.0.0.1:54321");
	});

	it("refuses an API URL that is not http(s), not a URL or carries credentials", () => {
		expect(() => apiOrigin("javascript:alert(1)")).toThrow(/https or http/);
		expect(() => apiOrigin("not a url")).toThrow(/not a URL/);
		expect(() =>
			apiOrigin(["https://user:pass", "x.supabase.co"].join("@")),
		).toThrow(/credentials/);
	});

	it("builds have no inline script or style and no wildcard source", () => {
		const policy = contentSecurityPolicy({
			supabaseUrl: "https://x.supabase.co",
		});
		expect(policy).not.toContain("unsafe-inline");
		expect(policy).not.toContain("unsafe-eval");
		expect(policy).not.toMatch(/(^|\s)\*(\s|;|$)/);
		const map = directives(policy);
		expect(map.get("default-src")).toEqual(["'self'"]);
		expect(map.get("script-src")).toEqual(["'self'"]);
		expect(map.get("style-src")).toEqual(["'self'"]);
		expect(map.get("img-src")).toEqual(["'self'", "data:", "blob:"]);
		expect(map.get("object-src")).toEqual(["'none'"]);
		expect(map.get("base-uri")).toEqual(["'self'"]);
		expect(map.get("form-action")).toEqual(["'self'"]);
	});

	it("widens only the dev server: hashed inline scripts, inline styles and the reload socket", () => {
		const map = directives(
			contentSecurityPolicy({ dev: { inlineScriptHashes: ["abc="] } }),
		);
		expect(map.get("script-src")).toEqual(["'self'", "'sha256-abc='"]);
		expect(map.get("style-src")).toEqual(["'self'", "'unsafe-inline'"]);
		expect(map.get("connect-src")).toEqual([
			"'self'",
			"ws://127.0.0.1:*",
			"ws://localhost:*",
		]);
	});
});
