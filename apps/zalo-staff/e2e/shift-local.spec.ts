import { watchMiniAppPage } from "@fnb/zalo-mini/testing/design-checks";
import { expect, test } from "@playwright/test";
import { LocalLoop, localStackRuns, portOf } from "./local-loop";
import { createOpsFixture } from "./ops-fixture";
import { expectOpsRun, opsSummary, runShiftOnTheLocalStack } from "./ops-flow";
import { localDatabaseUrl } from "./pairing-fixture";
import { sidewaysPhoto } from "./photo-fixture";

const PORT = portOf(5771);
const STACK_SKIP =
	"set ZALO_LOCAL_DEV=1 with the local stack running to drive pnpm zalo:dev";

test("pnpm zalo:dev runs a shift on a zalo-it- fixture tenant: a checklist with a real photo upload, a cash count with the handover and an incident", async ({
	page,
	browser,
}) => {
	test.skip(!(await localStackRuns()) || localDatabaseUrl() === "", STACK_SKIP);
	const photo = await sidewaysPhoto(browser);
	const fixture = await createOpsFixture();
	const loop = new LocalLoop();
	try {
		const ready = await loop.start([
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
			PORT,
		]);
		expect(ready.appUrl).toBe(`http://127.0.0.1:${PORT}/`);
		expect(await fixture.unbindMockUser()).toBe(1);
		await fixture.setVisibility("store_totals");
		await watchMiniAppPage(page);
		const hosts = new Set<string>();
		page.on("request", (request) => hosts.add(new URL(request.url()).host));
		const run = await runShiftOnTheLocalStack(
			page,
			fixture,
			ready.appUrl,
			photo,
		);
		test
			.info()
			.annotations.push({ type: "shift", description: opsSummary(run) });
		expectOpsRun(run);
		expect([...hosts].filter((host) => host !== "")).toEqual([
			`127.0.0.1:${PORT}`,
		]);
		expect(await loop.stop()).toBe(0);
	} finally {
		await loop.dispose();
		await fixture.cleanupOps();
	}
});
