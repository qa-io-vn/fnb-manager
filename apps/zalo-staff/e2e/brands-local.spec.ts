// Test design (ISTQB) for G-27: two brands in one tenant, on the staff app's local loop (`pnpm zalo:dev`) against the
// REAL functions of the local database. Each test builds its own synthetic tenant (zalo-it-…) with brand-1 (stores A1
// and A2, its own mock Zalo App, OA and staff Mini App) and brand-2 (store B1, likewise), signs one login in through one
// brand's app, and removes the tenant afterwards. A1 and B1 confirm through the POS sync (Ghi nhận khách, path B), A2
// through staff (Ghi hóa đơn, path E).
// - decision table, brand of the app × store of the login's scope × role: a login scoped to the stores of both brands
//   (staff, manager) or to every store (owner) sees only the app's own brand on the home and on every loyalty screen
//   (Ghi nhận khách, Kiểm tra ưu đãi, Tra cứu thành viên), whichever the role, and its own brand's stores still work
//   (the positive row of each table: the same screen records a member of the app's brand);
// - security, equivalence partitions of a member code: a code issued at the other brand's store and typed at a store of
//   the app's brand is refused `wrong_store` in words by the function. The refusal changes nothing (negative case: no
//   ledger, stamp, check-in, bill or refusal row appears in the tenant, the code stays live for its own store; a refused
//   bill leaves its one audit event, which holds no code and no phone);
// - decision table of `my_follow_oa` (the OA the staff app hands to the SDK's followOA): before any Zalo sign-in a login
//   whose scope spans two brands has none (the OA would be a guess), after signing in through an app it is that app's
//   OA and never the other brand's, read both through the screen's SDK call and through the function as the same session;
// - no response body of the scenario holds a full phone or a member code (`watchResponsePhones`, `tokenLeaks`).
// Every member, phone and code is synthetic; the fixture tenant takes its logins, customers and rows with it.
import {
	checkMiniAppScreen,
	watchMiniAppPage,
} from "@fnb/zalo-mini/testing/design-checks";
import {
	callRpc,
	findFullPhones,
	findTokens,
	type RpcCredentials,
	watchResponsePhones,
	watchRpcCredentials,
} from "@fnb/zalo-mini/testing/network-scan";
import { expect, type Locator, type Page, test } from "@playwright/test";
import {
	type BrandKey,
	type BrandPairFixture,
	openBrandPairFixture,
	type PairCustomer,
	type PairMember,
	type StoreKey,
} from "./brand-pair-fixture";
import {
	LocalLoop,
	localApiUrl,
	localStackRuns,
	portOf,
	type Ready,
} from "./local-loop";
import { localDatabaseUrl } from "./pairing-fixture";

const PORT = portOf(5792);
const STACK_SKIP =
	"set ZALO_LOCAL_DEV=1 with the local stack running to drive pnpm zalo:dev on a two-brand fixture tenant";
const WRONG_STORE =
	"Mã này được tạo cho cửa hàng khác. Hãy nhờ khách chọn đúng cửa hàng trong ứng dụng.";

let fixture: BrandPairFixture | null = null;
const loops: LocalLoop[] = [];

test.beforeEach(async () => {
	test.skip(!(await localStackRuns()) || localDatabaseUrl() === "", STACK_SKIP);
	fixture = await openBrandPairFixture();
});

test.afterEach(async () => {
	for (const loop of loops.splice(0)) await loop.dispose();
	const current = fixture;
	fixture = null;
	if (current !== null) {
		const left = await current.cleanup();
		test.info().annotations.push({
			type: "cleanup",
			description: JSON.stringify(left),
		});
		expect(left).toEqual({ tenants: 0, logins: 0 });
	}
});

function need(): BrandPairFixture {
	if (fixture === null) throw new Error("no fixture");
	return fixture;
}

async function startLoop(
	f: BrandPairFixture,
	brand: BrandKey,
	member: PairMember,
): Promise<Ready> {
	const loop = new LocalLoop();
	loops.push(loop);
	return loop.start([
		"--tenant",
		f.slug,
		"--brand",
		f.brands[brand].brandKey,
		"--member",
		member.email,
		"--mock-user",
		member.mockUser,
		"--mock-name",
		member.mockName,
		"--port",
		PORT,
	]);
}

const DATA_PREFIX = "/supabase";

/**
 * The dev server proxies /supabase/rest/v1, /supabase/auth/v1 and /supabase/storage/v1 to the API address it finds in
 * the workspace .env or .env.local; with another project's address in .env it sets no proxy up and those paths do not
 * answer JSON (test-plan 2.8). The paths are then forwarded here, to the loopback API only, so the spec runs on either setup.
 */
async function reachLocalApi(page: Page, ready: Ready): Promise<void> {
	const api = localApiUrl();
	if (api === "") throw new Error("SUPABASE_URL is not the local stack");
	const probe = await fetch(`${ready.appUrl}supabase/rest/v1/`, {
		headers: {
			accept: "application/json",
			apikey: process.env.SUPABASE_PUBLISHABLE_KEY ?? "",
		},
	});
	await probe.body?.cancel();
	if ((probe.headers.get("content-type") ?? "").includes("json")) return;
	const origin = new URL(ready.appUrl).origin;
	await page.route(
		(url) =>
			url.origin === origin &&
			/^\/supabase\/(?:rest|auth|storage)\/v1\//.test(url.pathname),
		async (route) => {
			const asked = new URL(route.request().url());
			const response = await route.fetch({
				url: `${api}${asked.pathname.slice(DATA_PREFIX.length)}${asked.search}`,
			});
			await route.fulfill({ response });
		},
	);
}

/** the browser's own session, replayed from this process straight against the local API (the dev proxy may be absent) */
function replayable(credentials: RpcCredentials): RpcCredentials {
	return {
		url: `${localApiUrl()}/rest/v1/rpc/my_follow_oa`,
		headers: credentials.headers,
	};
}

async function signIn(page: Page, ready: Ready): Promise<void> {
	await reachLocalApi(page, ready);
	await page.goto(ready.appUrl);
	await page.getByRole("button", { name: "Tiếp tục" }).click();
	await expect(page.getByTestId("home-loyalty")).toBeVisible();
}

function optionTexts(select: Locator): Promise<string[]> {
	return select.locator("option").allTextContents();
}

/** the stores the home offers: the picker's options, or the one store it names */
async function homeStores(page: Page): Promise<string[]> {
	const picker = page.getByTestId("store-picker");
	if ((await picker.count()) > 0) return optionTexts(picker);
	return [(await page.getByTestId("home-store").textContent()) ?? ""];
}

/** the stores a loyalty screen offers: the picker's options, or the one store its subtitle names */
async function screenStores(page: Page, screen: string): Promise<string[]> {
	// the loading and failed states carry data-status; the ready screen does not
	await expect(page.getByTestId(screen)).not.toHaveAttribute(
		"data-status",
		/.+/,
	);
	const picker = page.getByTestId("loyalty-store-picker");
	if ((await picker.count()) > 0) return optionTexts(picker);
	return [
		(await page.getByTestId(screen).locator("h1 + p").textContent()) ?? "",
	];
}

async function visitLoyaltyScreens(
	page: Page,
	expected: readonly string[],
): Promise<void> {
	const screens: readonly (readonly [string, string])[] = [
		["Kiểm tra ưu đãi", "redemption"],
		["Tra cứu thành viên", "member-lookup"],
	];
	for (const [button, testId] of screens) {
		await page
			.getByTestId("home-loyalty")
			.getByRole("button", { name: button })
			.click();
		await expect(page.getByTestId(testId)).toBeVisible();
		expect(await screenStores(page, testId), `${testId} stores`).toEqual(
			expected,
		);
		await page.getByRole("button", { name: "Quay lại" }).click();
		await expect(page.getByTestId("home-loyalty")).toBeVisible();
	}
}

async function expectNoOtherBrand(page: Page, names: string[]): Promise<void> {
	const shown = (await page.locator("body").textContent()) ?? "";
	for (const name of names) expect(shown).not.toContain(name);
}

async function followOaId(page: Page): Promise<string | undefined> {
	await page
		.getByRole("navigation", { name: "Điều hướng chính" })
		.getByRole("button", { name: "Cá nhân" })
		.click();
	const section = page.getByTestId("profile-notifications");
	await expect(section).toBeVisible();
	await section.getByRole("button", { name: "Cài đặt nhận thông báo" }).click();
	const follow = page.getByTestId("notify-follow");
	await expect(follow.getByTestId("follow-purpose")).toBeVisible();
	await follow.getByRole("button", { name: "Theo dõi OA" }).click();
	await expect(follow.getByTestId("follow-done")).toBeVisible();
	const calls = await page.evaluate(() => {
		const all = (window as unknown as Record<string, unknown>)
			.__ZALO_MOCK_CALLS__;
		return Array.isArray(all)
			? all.filter((call: { api?: unknown }) => call.api === "followOA")
			: [];
	});
	expect(calls, "one followOA call").toHaveLength(1);
	return (calls[0] as { args?: { id?: string } }).args?.id;
}

async function openCheckIn(page: Page): Promise<void> {
	await page
		.getByTestId("home-loyalty")
		.getByRole("button", { name: "Ghi nhận khách" })
		.click();
	await expect(page.getByTestId("check-in")).toBeVisible();
}

async function openBills(page: Page): Promise<void> {
	await page
		.getByTestId("home-loyalty")
		.getByRole("button", { name: "Ghi hóa đơn" })
		.click();
	await expect(page.getByTestId("bills-body")).toHaveAttribute(
		"data-status",
		"ready",
	);
}

/** types a member code at Ghi nhận khách (path B) and submits; the refusal paragraph, which shows only when the code was refused */
async function typeAtCheckIn(page: Page, code: string): Promise<Locator> {
	await page.getByTestId("checkin-entry").fill(code);
	await page.getByRole("button", { name: "Ghi nhận", exact: true }).click();
	return page.getByTestId("checkin-problem");
}

async function typeAtBills(
	page: Page,
	code: string,
	billNo: string,
	total: number,
): Promise<void> {
	await page.getByTestId("bill-code").fill(code);
	await page.getByTestId("bill-no").fill(billNo);
	await page.getByTestId("bill-total").fill(String(total));
	await page.getByRole("button", { name: "Ghi hóa đơn", exact: true }).click();
}

interface Attempt {
	readonly customer: PairCustomer;
	readonly code: string;
}

async function attempt(
	f: BrandPairFixture,
	owner: StoreKey,
	at: StoreKey,
): Promise<Attempt> {
	const customer = await f.seedMember(owner);
	let code = await f.issueCode(customer, owner);
	// a code is six digits, so two stores may hold the same one; the refusal needs a code that is live only at its own store
	for (let tries = 0; tries < 5 && (await f.codeIsLive(at, code)); tries += 1)
		code = await f.issueCode(customer, owner);
	return { customer, code };
}

test("brand 1's app, a staff login scoped to a store of each brand: only brand 1's store shows, and brand 2's member code is refused wrong_store (decision table: brand × store × role = staff)", async ({
	page,
}) => {
	const f = need();
	const staff = await f.newMember("staff", ["a1", "b1"]);
	const foreign = await attempt(f, "b1", "a1");
	const own = await attempt(f, "a1", "b1");
	// before any Zalo sign-in the OA of a login that spans two brands is a guess, so there is none
	const before = await f.session(staff);
	expect(
		(await callRpc(before, "my_follow_oa", { p_tenant_id: f.tenantId })).body,
	).toBeNull();

	const ready = await startLoop(f, "a", staff);
	expect(ready).toMatchObject({ role: "staff", boundNow: true });
	await watchMiniAppPage(page);
	const scan = watchResponsePhones(page, new URL(ready.appUrl).origin);
	const credentials = watchRpcCredentials(page);
	await signIn(page, ready);
	// precondition: the data API did send the other brand's store, which the login's scope allows, so it is the app that leaves it out
	expect(await scan.tokenLeaks([f.stores.b1.name])).not.toEqual([]);

	// the home and every loyalty screen offer brand 1's store A1 and not B1, which is in the login's scope
	expect(await homeStores(page)).toEqual([f.stores.a1.name]);
	await expect(page.getByTestId("store-picker")).toHaveCount(0);
	await expectNoOtherBrand(page, [f.stores.b1.name]);
	await visitLoyaltyScreens(page, [f.stores.a1.name]);
	await openCheckIn(page);
	expect(await screenStores(page, "check-in")).toEqual([f.stores.a1.name]);
	await expectNoOtherBrand(page, [f.stores.b1.name]);
	await checkMiniAppScreen(page);

	// equivalence partition "a member code of the other brand's store": refused in words, nothing written
	const baseline = await f.traces();
	const wrong = await typeAtCheckIn(page, foreign.code);
	await expect(wrong).toHaveAttribute("data-refusal", "wrong_store");
	await expect(wrong).toHaveText(WRONG_STORE);
	expect(await f.traces()).toEqual(baseline);
	expect(await f.customerRows(foreign.customer)).toEqual({
		ledger: 1,
		checkins: 0,
	});
	expect(await f.codeIsLive("b1", foreign.code)).toBe(true);
	await checkMiniAppScreen(page);

	// the positive row: a member code of brand 1's own store records at A1
	await page.getByTestId("checkin-entry").fill("");
	await page.getByTestId("checkin-entry").fill(own.code);
	await page.getByRole("button", { name: "Ghi nhận", exact: true }).click();
	await expect(page.getByTestId("checkin-result")).toBeVisible();
	expect(await f.customerRows(own.customer)).toEqual({
		ledger: 1,
		checkins: 1,
	});
	expect((await f.traces()).checkins).toEqual({ issued: 1, recorded: 1 });
	await expect(page.locator("body")).not.toContainText(own.customer.phone);

	// my_follow_oa: after the sign-in through brand 1's app, brand 1's OA, by the SDK call and by the function
	expect(await followOaId(page)).toBe(f.brands.a.oaId);
	const asApp = await callRpc(replayable(credentials()), "my_follow_oa", {
		p_tenant_id: f.tenantId,
	});
	expect(asApp.body).toBe(f.brands.a.oaId);
	expect(asApp.body).not.toBe(f.brands.b.oaId);

	expect(await scan.leaks()).toEqual([]);
	expect(
		await scan.tokenLeaks([foreign.code, own.code]),
		"member codes in responses",
	).toEqual([]);
	expect((await scan.responses()).length).toBeGreaterThan(0);
});

test("brand 1's app, an owner of every store: only brand 1's stores show everywhere, and brand 2's member code is refused wrong_store at both (decision table: brand × store × role = owner, store confirmed by the POS and by staff)", async ({
	page,
}) => {
	const f = need();
	await f.setStoreMode("a2", "staff");
	const owner = await f.newMember("owner", null);
	const atA1 = await attempt(f, "b1", "a1");
	const atA2 = await attempt(f, "b1", "a2");
	const own = await attempt(f, "a2", "b1");
	const before = await f.session(owner);
	expect(
		(await callRpc(before, "my_follow_oa", { p_tenant_id: f.tenantId })).body,
	).toBeNull();

	const ready = await startLoop(f, "a", owner);
	expect(ready).toMatchObject({ role: "owner", boundNow: true });
	await watchMiniAppPage(page);
	const scan = watchResponsePhones(page, new URL(ready.appUrl).origin);
	const credentials = watchRpcCredentials(page);
	await signIn(page, ready);
	// precondition: the data API did send the other brand's store, which the owner's scope allows, so it is the app that leaves it out
	expect(await scan.tokenLeaks([f.stores.b1.name])).not.toEqual([]);

	const brandOne = [f.stores.a1.name, f.stores.a2.name];
	expect(await homeStores(page)).toEqual(brandOne);
	await expectNoOtherBrand(page, [f.stores.b1.name]);
	await visitLoyaltyScreens(page, brandOne);
	await openCheckIn(page);
	expect(await screenStores(page, "check-in")).toEqual(brandOne);
	await expectNoOtherBrand(page, [f.stores.b1.name]);
	await checkMiniAppScreen(page);

	// A1 confirms through the POS: path B refuses brand 2's code
	const baseline = await f.traces();
	const wrongCheckIn = await typeAtCheckIn(page, atA1.code);
	await expect(wrongCheckIn).toHaveAttribute("data-refusal", "wrong_store");
	await expect(wrongCheckIn).toHaveText(WRONG_STORE);
	expect(await f.traces()).toEqual(baseline);
	expect(await f.codeIsLive("b1", atA1.code)).toBe(true);

	// A2 confirms through staff: path E refuses it too, and only the audit trail notes the refusal
	await page.getByRole("button", { name: "Quay lại" }).click();
	await page.getByTestId("store-picker").selectOption({
		label: f.stores.a2.name,
	});
	expect(await f.audits()).toEqual([]);
	await openBills(page);
	expect(await screenStores(page, "bills")).toEqual(brandOne);
	await typeAtBills(page, atA2.code, "IT0001", 85_000);
	const refused = page.getByTestId("bill-refused");
	await expect(refused).toHaveAttribute("data-refusal", "wrong_store");
	await expect(refused).toHaveText(WRONG_STORE);
	const after = await f.traces();
	expect({ ...after, audits: 0 }).toEqual({ ...baseline, audits: 0 });
	const audits = await f.audits();
	expect(audits.map((audit) => audit.action)).toEqual(["bill_refused"]);
	for (const audit of audits) {
		expect(audit.details).toContain("wrong_store");
		expect(audit.details).not.toContain(atA2.code);
		expect(audit.details).not.toContain(atA2.customer.phone.slice(1));
	}
	expect(await f.codeIsLive("b1", atA2.code)).toBe(true);
	expect(await f.customerRows(atA2.customer)).toEqual({
		ledger: 1,
		checkins: 0,
	});
	await checkMiniAppScreen(page);

	// the positive row: a member of brand 1 who joined at A2 records a bill at A2
	await typeAtBills(page, own.code, "IT0002", 60_000);
	await expect(page.getByTestId("bill-result")).toHaveAttribute(
		"data-state",
		"awaiting_customer",
	);
	expect((await f.traces()).bills).toBe(1);
	await expect(page.locator("body")).not.toContainText(own.customer.phone);

	expect(await followOaId(page)).toBe(f.brands.a.oaId);
	expect(
		(
			await callRpc(replayable(credentials()), "my_follow_oa", {
				p_tenant_id: f.tenantId,
			})
		).body,
	).toBe(f.brands.a.oaId);

	expect(await scan.leaks()).toEqual([]);
	expect(
		await scan.tokenLeaks([atA1.code, atA2.code, own.code]),
		"member codes in responses",
	).toEqual([]);
});

test("brand 2's app mirrors it: a manager scoped to a store of each brand sees only B1, brand 1's member code is refused wrong_store, and the OA is brand 2's (decision table: brand × store × role = manager)", async ({
	page,
}) => {
	const f = need();
	const manager = await f.newMember("manager", ["a1", "b1"]);
	const foreign = await attempt(f, "a1", "b1");
	const own = await attempt(f, "b1", "a1");
	const before = await f.session(manager);
	expect(
		(await callRpc(before, "my_follow_oa", { p_tenant_id: f.tenantId })).body,
	).toBeNull();

	const ready = await startLoop(f, "b", manager);
	expect(ready).toMatchObject({ role: "manager", boundNow: true });
	await watchMiniAppPage(page);
	const scan = watchResponsePhones(page, new URL(ready.appUrl).origin);
	const credentials = watchRpcCredentials(page);
	await signIn(page, ready);
	// precondition: the data API did send the other brand's store, which the login's scope allows, so it is the app that leaves it out
	expect(await scan.tokenLeaks([f.stores.a1.name])).not.toEqual([]);

	expect(await homeStores(page)).toEqual([f.stores.b1.name]);
	await expectNoOtherBrand(page, [f.stores.a1.name, f.stores.a2.name]);
	await visitLoyaltyScreens(page, [f.stores.b1.name]);
	await openCheckIn(page);
	expect(await screenStores(page, "check-in")).toEqual([f.stores.b1.name]);
	await expectNoOtherBrand(page, [f.stores.a1.name, f.stores.a2.name]);

	const baseline = await f.traces();
	const wrong = await typeAtCheckIn(page, foreign.code);
	await expect(wrong).toHaveAttribute("data-refusal", "wrong_store");
	await expect(wrong).toHaveText(WRONG_STORE);
	expect(await f.traces()).toEqual(baseline);
	expect(await f.codeIsLive("a1", foreign.code)).toBe(true);
	await checkMiniAppScreen(page);

	await page.getByTestId("checkin-entry").fill("");
	await page.getByTestId("checkin-entry").fill(own.code);
	await page.getByRole("button", { name: "Ghi nhận", exact: true }).click();
	await expect(page.getByTestId("checkin-result")).toBeVisible();
	expect(await f.customerRows(own.customer)).toEqual({
		ledger: 1,
		checkins: 1,
	});

	expect(await followOaId(page)).toBe(f.brands.b.oaId);
	const asApp = await callRpc(replayable(credentials()), "my_follow_oa", {
		p_tenant_id: f.tenantId,
	});
	expect(asApp.body).toBe(f.brands.b.oaId);
	expect(asApp.body).not.toBe(f.brands.a.oaId);

	expect(await scan.leaks()).toEqual([]);
	expect(
		await scan.tokenLeaks([foreign.code, own.code]),
		"member codes in responses",
	).toEqual([]);
});

test("the functions behind the screens, called by four logins (decision table: role × store in scope × brand of the code): the other brand's code is refused wrong_store at every store in scope, a store out of scope is refused 42501, and nothing is written", async () => {
	const f = need();
	await f.setStoreMode("a2", "staff");
	const callers: readonly {
		readonly label: string;
		readonly member: PairMember;
	}[] = [
		{ label: "owner of every store", member: await f.newMember("owner", null) },
		{
			label: "manager of A1 and B1",
			member: await f.newMember("manager", ["a1", "b1"]),
		},
		{
			label: "staff of A1 and B1",
			member: await f.newMember("staff", ["a1", "b1"]),
		},
		{ label: "staff of A1", member: await f.newMember("staff", ["a1"]) },
	];
	const fromB = await attempt(f, "b1", "a1");
	const fromA = await attempt(f, "a1", "b1");
	const baseline = await f.traces();
	const inScope = (member: PairMember, store: StoreKey): boolean =>
		member.scope === null || member.scope.includes(store);
	const bodies: string[] = [];
	let refusedBills = 0;
	for (const { label, member } of callers) {
		const session = await f.session(member);
		const calls: readonly {
			readonly store: StoreKey;
			readonly name: string;
			readonly args: Record<string, unknown>;
		}[] = [
			{
				store: "a1",
				name: "staff_record_checkin",
				args: { p_store_id: f.stores.a1.id, p_code: fromB.code },
			},
			{
				store: "b1",
				name: "staff_record_checkin",
				args: { p_store_id: f.stores.b1.id, p_code: fromA.code },
			},
			{
				store: "a2",
				name: "staff_submit_bill",
				args: {
					p_store_id: f.stores.a2.id,
					p_code: fromB.code,
					p_bill_no: "IT0001",
					p_total: 85_000,
				},
			},
		];
		for (const call of calls) {
			const reply = await callRpc(session, call.name, call.args);
			bodies.push(JSON.stringify(reply.body));
			const what = `${label}, ${call.name} at ${call.store}`;
			if (inScope(member, call.store)) {
				expect(reply.status, what).toBe(200);
				expect(reply.body, what).toMatchObject({
					state: "refused",
					refusal: "wrong_store",
				});
				if (call.name === "staff_submit_bill") refusedBills += 1;
			} else {
				expect(reply.status, what).toBe(403);
				expect(reply.code, what).toBe("42501");
			}
		}
	}
	// nothing was written but the audit event of each refused bill
	const after = await f.traces();
	expect(after.audits).toBe(refusedBills);
	expect({ ...after, audits: 0 }).toEqual({ ...baseline, audits: 0 });
	expect((await f.audits()).map((audit) => audit.action)).toEqual(
		Array(refusedBills).fill("bill_refused"),
	);
	expect(await f.codeIsLive("b1", fromB.code)).toBe(true);
	expect(await f.codeIsLive("a1", fromA.code)).toBe(true);
	expect(await f.customerRows(fromB.customer)).toEqual({
		ledger: 1,
		checkins: 0,
	});
	expect(await f.customerRows(fromA.customer)).toEqual({
		ledger: 1,
		checkins: 0,
	});
	// no answer carries a code or a full phone
	for (const body of bodies) {
		expect(findTokens(body, [fromA.code, fromB.code])).toEqual([]);
		expect(findFullPhones(body)).toEqual([]);
	}
});
