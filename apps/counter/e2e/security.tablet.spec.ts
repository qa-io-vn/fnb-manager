import { expect, test } from "./support/fixtures";

// counter:e2e/security (ADR-066): the built page carries its content security policy and the browser applies it
// (no inline script, no script from elsewhere, calls only to the app, the API and the sign-in function); the bundle names no
// secret key; the sign-in function refuses a forged state and a forged ticket straight from the browser.

test("the built page carries a strict CSP and the browser enforces it", async ({
	page,
	seeded,
}) => {
	expect(seeded.slug).toMatch(/^ct-e2e-/);
	await page.goto("/");
	const policy = await page
		.locator('meta[http-equiv="Content-Security-Policy"]')
		.getAttribute("content");
	expect(policy).toContain("script-src 'self'");
	expect(policy).toContain("object-src 'none'");
	expect(policy).not.toContain("unsafe-eval");
	// an inline script added to the page does not run (the policy allows scripts from the app only)
	const inlineBlocked = await page.evaluate(async () => {
		const script = document.createElement("script");
		script.textContent = "window.inlineRan = true;";
		document.head.append(script);
		await new Promise((resolve) => setTimeout(resolve, 50));
		return (window as unknown as { inlineRan?: boolean }).inlineRan !== true;
	});
	expect(inlineBlocked).toBe(true);
	const foreign = await page.evaluate(async () => {
		try {
			await fetch("https://example.com/");
			return "reached";
		} catch {
			return "blocked";
		}
	});
	expect(foreign).toBe("blocked");
});

test("the bundle names no secret key, no service role and no e-mail address", async ({
	page,
	request,
}) => {
	await page.goto("/");
	const scripts = await page
		.locator("script[src]")
		.evaluateAll((nodes) =>
			nodes.map((node) => node.getAttribute("src") ?? ""),
		);
	expect(scripts.length).toBeGreaterThan(0);
	for (const src of scripts) {
		const body = await (await request.get(src)).text();
		expect(body).not.toMatch(/sb_secret_[A-Za-z0-9_-]{6,}/);
		expect(body).not.toMatch(/service_role/);
		expect(body).not.toMatch(/ZALO_APP_SECRET_[A-Z0-9_]+\s*[:=]/);
		expect(body).not.toMatch(/[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+\.(com|vn)\b/);
	}
});

test("the sign-in function refuses a forged state and a forged ticket from the browser", {
	tag: ["@criterion-5"],
}, async ({ page }) => {
	await page.goto("/");
	const answers = await page.evaluate(async () => {
		const call = async (body: Record<string, unknown>) => {
			const response = await fetch("http://127.0.0.1:5767", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ brand: "brand-1", ...body }),
			});
			return `${response.status}:${(await response.json()).error}`;
		};
		return [
			await call({
				action: "callback",
				redirect_uri: `${location.origin}/`,
				code: "forged",
				state: "f".repeat(80),
				code_verifier: "v".repeat(43),
			}),
			await call({
				action: "pair",
				ticket: "t".repeat(80),
				pairing_code: "123456",
			}),
			await call({
				action: "start",
				redirect_uri: "https://evil.example.com/",
				code_challenge: "c".repeat(43),
			}),
		];
	});
	expect(answers).toEqual([
		"401:state_refused",
		"401:ticket_refused",
		"403:redirect_not_allowed",
	]);
});
