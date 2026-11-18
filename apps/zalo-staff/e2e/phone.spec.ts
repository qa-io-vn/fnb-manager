import {
	checkMiniAppScreen,
	watchMiniAppPage,
} from "@fnb/zalo-mini/testing/design-checks";
import { type Browser, expect, type Page, test } from "@playwright/test";
import {
	checkHome,
	expectHomeFor,
	homeSummary,
	watchDataRequests,
} from "./home-check";
import {
	LocalLoop,
	localApiUrl,
	localStackRuns,
	portOf,
	type Ready,
	ROLE_LABELS,
	withoutKey,
} from "./local-loop";

const LAN_PORT = portOf(5766);
const TUNNEL_PORT = portOf(5767);
const WRONG_KEY = "w".repeat(43);
const OUTSIDE = "203.0.113.9";
const STACK_SKIP =
	"set ZALO_LOCAL_DEV=1 with the local stack running to drive pnpm zalo:dev";
const loop = new LocalLoop();

test.afterEach(async () => {
	await loop.dispose();
});

async function keyless(run: () => Promise<void>): Promise<void> {
	try {
		await run();
	} catch (error) {
		if (!(error instanceof Error)) throw new Error(withoutKey(String(error)));
		error.message = withoutKey(error.message);
		if (error.stack !== undefined) error.stack = withoutKey(error.stack);
		throw error;
	}
}

async function strangersAreRefused(
	browser: Browser,
	appUrl: string,
): Promise<void> {
	const stranger = await browser.newContext();
	const page = await stranger.newPage();
	for (const path of [
		"",
		`?key=${WRONG_KEY}`,
		"src/main.tsx",
		"@vite/client",
	]) {
		const response = await page.goto(`${appUrl}${path}`);
		expect(response?.status(), withoutKey(path)).toBe(403);
	}
	await expect(
		page.getByRole("heading", { name: "403 Forbidden" }),
	).toBeVisible();
	for (const [path, method] of [
		["functions/v1/zalo-session", "POST"],
		["supabase/rest/v1/", "GET"],
		["supabase/auth/v1/health", "GET"],
	] as const) {
		const response = await stranger.request.fetch(`${appUrl}${path}`, {
			method,
		});
		expect(response.status(), path).toBe(403);
	}
	expect(await stranger.cookies()).toEqual([]);
	await stranger.close();
}

async function signsIn(page: Page, ready: Ready, secure: boolean) {
	const appUrl = ready.appUrl;
	await watchMiniAppPage(page);
	const hosts = new Set<string>();
	page.on("request", (request) => hosts.add(new URL(request.url()).host));
	const dataHeaders = watchDataRequests(page);
	const session = page.waitForResponse(
		(response) =>
			response.url().endsWith("/functions/v1/zalo-session") &&
			response.request().method() === "POST",
	);
	await page.goto(ready.phoneUrl ?? "");
	const answer = await session;
	expect(answer.status()).toBe(200);
	const bound = await answer.json();
	expect(bound.status).toBe("bound");
	await expect(page).toHaveURL(appUrl);
	expect(await page.evaluate(() => window.isSecureContext)).toBe(secure);

	await expect(
		page.getByRole("heading", { name: `Xin chào, ${ready.mockName}` }),
	).toBeVisible();
	await expect(page.getByTestId("member-role")).toHaveText(
		ROLE_LABELS[ready.role] ?? ready.role,
	);
	const home = await checkHome(
		page,
		appUrl,
		await dataHeaders(),
		String(bound.member?.tenant_id ?? ""),
	);
	test
		.info()
		.annotations.push({ type: "home", description: homeSummary(home) });
	expectHomeFor(ready.role, ready.stores, home);
	await expect(page.getByTestId("stand-in-header")).toBeVisible();
	await checkMiniAppScreen(page);
	expect([...hosts]).toEqual([new URL(appUrl).host]);

	const cookies = await page.context().cookies();
	expect(cookies.map((cookie) => cookie.name)).toEqual([
		secure ? "__Host-fnb_local_access" : "fnb_local_access",
	]);
	expect(cookies[0]).toMatchObject({ httpOnly: true, secure, path: "/" });

	const direct = await fetch(`${localApiUrl()}/auth/v1/health`);
	await direct.body?.cancel();
	const proxied = await page.request.get(`${appUrl}supabase/auth/v1/health`);
	expect(proxied.status()).toBe(direct.status);
}

test("pnpm zalo:dev --lan serves the staff app to an iPhone on the home network, only with the printed key", async ({
	page,
	browser,
	browserName,
}) => {
	test.skip(!(await localStackRuns()), STACK_SKIP);
	const ready = await loop.start(["--lan", "--port", LAN_PORT]);
	test.skip(ready.phoneUrl === null, "this PC has no LAN IPv4 address");
	await keyless(async () => {
		expect(browserName).toBe("webkit");
		const phone = new URL(ready.phoneUrl ?? "");
		expect(phone.protocol).toBe("http:");
		expect(phone.hostname).not.toMatch(/^(127\.|0\.0\.0\.0$)/);
		expect(phone.port).toBe(LAN_PORT);
		expect(phone.searchParams.get("key")).toMatch(/^[A-Za-z0-9_-]{43}$/);
		expect(ready.appUrl).toBe(`${phone.origin}/`);
		await expect(fetch(`http://127.0.0.1:${LAN_PORT}/`)).rejects.toThrow();

		await strangersAreRefused(browser, ready.appUrl);
		await signsIn(page, ready, false);

		expect(await loop.stop()).toBe(0);
		await expect(fetch(ready.appUrl)).rejects.toThrow();
	});
});

test("pnpm zalo:dev --tunnel serves the staff app on a public https link, only with the printed key", async ({
	page,
	browser,
}) => {
	test.skip(
		process.env.E2E_TUNNEL !== "1",
		"set E2E_TUNNEL=1 to open a real Cloudflare quick tunnel",
	);
	test.skip(!(await localStackRuns()), STACK_SKIP);
	const ready = await loop.start([
		"--tunnel",
		"--tunnel-hours",
		"1",
		"--port",
		TUNNEL_PORT,
	]);
	await keyless(async () => {
		const phone = new URL(ready.phoneUrl ?? "");
		expect(phone.protocol).toBe("https:");
		expect(phone.hostname).toMatch(/^[a-z0-9-]+\.trycloudflare\.com$/);
		expect(phone.searchParams.get("key")).toMatch(/^[A-Za-z0-9_-]{43}$/);
		expect(ready.appUrl).toBe(`${phone.origin}/`);
		for (const headers of [
			{},
			{ "cf-connecting-ip": OUTSIDE, "x-forwarded-for": OUTSIDE },
		]) {
			const local = await fetch(`http://127.0.0.1:${TUNNEL_PORT}/`, {
				headers,
			});
			await local.body?.cancel();
			expect(local.status).toBe(403);
		}

		await strangersAreRefused(browser, ready.appUrl);
		await signsIn(page, ready, true);

		expect(await loop.stop()).toBe(0);
		await expect(fetch(`http://127.0.0.1:${TUNNEL_PORT}/`)).rejects.toThrow();
		await expect
			.poll(
				async () => {
					try {
						const response = await fetch(ready.appUrl, {
							signal: AbortSignal.timeout(5000),
						});
						await response.body?.cancel();
						return response.status;
					} catch {
						return 0;
					}
				},
				{ timeout: 60_000 },
			)
			.not.toBe(403);
	});
});
