import {
	checkMiniAppScreen,
	watchMiniAppPage,
} from "@fnb/zalo-mini/testing/design-checks";
import { expect, test } from "@playwright/test";
import { LocalLoop, localStackRuns, portOf, ROLE_LABELS } from "./local-loop";

const PORT = portOf(5761);
const loop = new LocalLoop();

test.afterAll(async () => {
	await loop.dispose();
});

test("pnpm zalo:dev signs the mock Zalo user in through the real zalo-session and stops cleanly", async ({
	page,
}) => {
	test.skip(
		!(await localStackRuns()),
		"set ZALO_LOCAL_DEV=1 with the local stack running to drive pnpm zalo:dev",
	);
	const ready = await loop.start(["--port", PORT]);
	expect(ready.appUrl).toBe(`http://127.0.0.1:${PORT}/`);
	expect(ready.phoneUrl).toBeNull();
	expect(ready.stores).toBeGreaterThan(0);

	await watchMiniAppPage(page);
	const hosts = new Set<string>();
	page.on("request", (request) => hosts.add(new URL(request.url()).host));
	const session = page.waitForResponse(
		(response) =>
			response.url().endsWith("/functions/v1/zalo-session") &&
			response.request().method() === "POST",
	);
	await page.goto(ready.appUrl);
	const answer = await session;
	expect(answer.status()).toBe(200);
	expect((await answer.json()).status).toBe("bound");

	await expect(
		page.getByRole("heading", { name: `Xin chào, ${ready.mockName}` }),
	).toBeVisible();
	await expect(page.getByTestId("member-role")).toHaveText(
		ROLE_LABELS[ready.role] ?? ready.role,
	);
	await expect(
		page.getByTestId("member-stores").getByRole("listitem"),
	).toHaveCount(ready.stores);
	await expect(page.getByTestId("stand-in-header")).toBeVisible();
	await checkMiniAppScreen(page);
	expect([...hosts]).toEqual([`127.0.0.1:${PORT}`]);

	expect(await loop.stop()).toBe(0);
	await expect(fetch(ready.appUrl)).rejects.toThrow();
});
