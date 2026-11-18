import {
	checkMiniAppScreen,
	watchMiniAppPage,
} from "@fnb/zalo-mini/testing/design-checks";
import { expect, test } from "@playwright/test";
import {
	checkHome,
	expectHomeFor,
	homeSummary,
	watchDataRequests,
} from "./home-check";
import { LocalLoop, localStackRuns, portOf, ROLE_LABELS } from "./local-loop";
import { createPairingFixture, localDatabaseUrl } from "./pairing-fixture";
import { pairingSummary, pairOnTheLocalStack } from "./pairing-flow";

const PORT = portOf(5761);
const PAIRING_PORT = portOf(5763);
const STACK_SKIP =
	"set ZALO_LOCAL_DEV=1 with the local stack running to drive pnpm zalo:dev";
const loop = new LocalLoop();

test.afterAll(async () => {
	await loop.dispose();
});

test("pnpm zalo:dev signs the mock Zalo user in through the real zalo-session and stops cleanly", async ({
	page,
}) => {
	test.skip(!(await localStackRuns()), STACK_SKIP);
	const ready = await loop.start(["--port", PORT]);
	expect(ready.appUrl).toBe(`http://127.0.0.1:${PORT}/`);
	expect(ready.phoneUrl).toBeNull();
	expect(ready.stores).toBeGreaterThan(0);

	await watchMiniAppPage(page);
	const hosts = new Set<string>();
	page.on("request", (request) => hosts.add(new URL(request.url()).host));
	const dataHeaders = watchDataRequests(page);
	const session = page.waitForResponse(
		(response) =>
			response.url().endsWith("/functions/v1/zalo-session") &&
			response.request().method() === "POST",
	);
	await page.goto(ready.appUrl);
	await page.getByRole("button", { name: "Tiếp tục" }).click();
	const answer = await session;
	expect(answer.status()).toBe(200);
	const bound = await answer.json();
	expect(bound.status).toBe("bound");

	await expect(
		page.getByRole("heading", { name: `Xin chào, ${ready.mockName}` }),
	).toBeVisible();
	await expect(page.getByTestId("member-role")).toHaveText(
		ROLE_LABELS[ready.role] ?? ready.role,
	);
	const home = await checkHome(
		page,
		ready.appUrl,
		await dataHeaders(),
		String(bound.member?.tenant_id ?? ""),
	);
	test
		.info()
		.annotations.push({ type: "home", description: homeSummary(home) });
	expectHomeFor(ready.role, ready.stores, home);
	await expect(page.getByTestId("stand-in-header")).toBeVisible();
	await checkMiniAppScreen(page);
	expect([...hosts]).toEqual([`127.0.0.1:${PORT}`]);

	expect(await loop.stop()).toBe(0);
	await expect(fetch(ready.appUrl)).rejects.toThrow();
});

test("pnpm zalo:dev pairs a person on the roster with a real code, on a zalo-it- fixture tenant", async ({
	page,
}) => {
	test.skip(!(await localStackRuns()) || localDatabaseUrl() === "", STACK_SKIP);
	const fixture = await createPairingFixture();
	const pairingLoop = new LocalLoop();
	try {
		const ready = await pairingLoop.start([
			"--tenant",
			fixture.slug,
			"--brand",
			fixture.brandKey,
			"--member",
			fixture.ownerEmail,
			"--mock-user",
			fixture.mockUser,
			"--mock-name",
			fixture.mockName,
			"--port",
			PAIRING_PORT,
		]);
		expect(ready.appUrl).toBe(`http://127.0.0.1:${PAIRING_PORT}/`);
		expect(await fixture.unbindMockUser()).toBe(1);
		await watchMiniAppPage(page);
		const hosts = new Set<string>();
		page.on("request", (request) => hosts.add(new URL(request.url()).host));
		const run = await pairOnTheLocalStack(
			page,
			fixture,
			ready.appUrl,
			ready.appUrl,
		);
		test
			.info()
			.annotations.push({ type: "pairing", description: pairingSummary(run) });
		expect(run.sessionCallsBeforeContinue).toBe(0);
		expect(run.answers).toEqual([
			"unpaired",
			"unpaired:code_refused",
			"unpaired:notice_outdated",
			"bound",
			"unpaired",
		]);
		expect([...hosts]).toEqual([`127.0.0.1:${PAIRING_PORT}`]);
		expect(await pairingLoop.stop()).toBe(0);
	} finally {
		await pairingLoop.dispose();
		await fixture.cleanup();
	}
});
