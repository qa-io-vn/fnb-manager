import { watchMiniAppPage } from "@fnb/zalo-mini/testing/design-checks";
import { expect, test } from "@playwright/test";
import { LocalLoop, localStackRuns, portOf, withoutKey } from "./local-loop";
import { createOpsFixture } from "./ops-fixture";
import { expectOpsRun, opsSummary, runShiftOnTheLocalStack } from "./ops-flow";
import { localDatabaseUrl } from "./pairing-fixture";
import { sidewaysPhoto } from "./photo-fixture";

const LAN_PORT = portOf(5773);
const STACK_SKIP =
	"set ZALO_LOCAL_DEV=1 with the local stack running to drive pnpm zalo:dev";

test("pnpm zalo:dev --lan lets an iPhone run a shift on a zalo-it- fixture tenant: photo upload, cash count, handover and incident", async ({
	page,
	browser,
	browserName,
}) => {
	test.skip(!(await localStackRuns()) || localDatabaseUrl() === "", STACK_SKIP);
	expect(browserName).toBe("webkit");
	const photo = await sidewaysPhoto(browser);
	const fixture = await createOpsFixture();
	const loop = new LocalLoop();
	try {
		const ready = await loop.start([
			"--lan",
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
			LAN_PORT,
		]);
		test.skip(ready.phoneUrl === null, "this PC has no LAN IPv4 address");
		expect(await fixture.unbindMockUser()).toBe(1);
		await fixture.setVisibility("store_totals");
		await watchMiniAppPage(page);
		try {
			const run = await runShiftOnTheLocalStack(
				page,
				fixture,
				ready.phoneUrl ?? "",
				photo,
			);
			test
				.info()
				.annotations.push({ type: "shift", description: opsSummary(run) });
			expectOpsRun(run);
			await expect(page).toHaveURL(ready.appUrl);
		} catch (error) {
			if (error instanceof Error) {
				error.message = withoutKey(error.message);
				if (error.stack !== undefined) error.stack = withoutKey(error.stack);
			}
			throw error;
		}
		expect(await loop.stop()).toBe(0);
	} finally {
		await loop.dispose();
		await fixture.cleanupOps();
	}
});
