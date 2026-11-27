import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test as base, expect, type Page } from "@playwright/test";
import postgres, { type Sql } from "postgres";
import type { SeededPerson, SeededTenant } from "../../test/support/seed";
import { SEEDED_FILE } from "./ports";

interface SeededFile {
	readonly skip: boolean;
	readonly seeded?: SeededTenant;
	readonly mockUrl?: string;
	readonly stack?: { readonly databaseUrl: string };
}

function seededFile(): SeededFile {
	const path = join(import.meta.dirname, "..", ".cache", SEEDED_FILE);
	if (!existsSync(path)) return { skip: true };
	return JSON.parse(readFileSync(path, "utf8")) as SeededFile;
}

export const MOCK_COOKIE = "mock_zalo_user";

export const test = base.extend<
	{ seeded: SeededTenant; db: Sql },
	{ file: SeededFile }
>({
	file: [
		// biome-ignore lint/correctness/noEmptyPattern: Playwright's fixture signature
		async ({}, use) => {
			await use(seededFile());
		},
		{ scope: "worker" },
	],
	seeded: async ({ file }, use) => {
		test.skip(
			file.skip || file.seeded === undefined,
			"the local stack is not available (run through scripts/with-local-stack.mjs)",
		);
		await use(file.seeded as SeededTenant);
	},
	db: async ({ file }, use) => {
		test.skip(
			file.skip || file.stack === undefined,
			"the local stack is not available",
		);
		const sql = postgres(file.stack?.databaseUrl ?? "", {
			max: 2,
			onnotice: () => undefined,
		});
		await use(sql);
		await sql.end({ timeout: 5 });
	},
});

export { expect };

/** Chooses who signs in at the mock Zalo (its web login reads this cookie) and signs in through the real function. */
export async function chooseZaloPerson(
	page: Page,
	person: { readonly zaloId: string; readonly name: string },
): Promise<void> {
	await page.context().addCookies([
		{
			name: MOCK_COOKIE,
			value: encodeURIComponent(`${person.zaloId}~${person.name}`),
			domain: "127.0.0.1",
			path: "/",
		},
	]);
}

export async function signIn(page: Page, person: SeededPerson): Promise<void> {
	await chooseZaloPerson(page, person);
	await page.goto("/");
	await page.evaluate(() => {
		window.localStorage.clear();
		window.sessionStorage.clear();
	});
	await page.goto("/");
	await page.getByTestId("sign-in-zalo").click();
	// a member of several stores (the owner) first chooses the store of the device: store A
	const picker = page.getByTestId("store-picker");
	await expect(page.getByTestId("account").or(picker)).toBeVisible();
	if (await picker.isVisible()) {
		await picker.getByRole("button", { name: "Cửa hàng mẫu A" }).click();
	}
	await expect(page.getByTestId("account")).toBeVisible();
}

/** The navigation item of a section, the rail on a tablet or the bottom tab on a phone. */
export function nav(page: Page, section: string) {
	return page
		.locator(
			`[data-testid="rail-${section}"]:visible, [data-testid="tab-${section}"]:visible`,
		)
		.first();
}

/** No horizontal scroll at this viewport (design: nothing needs it at 1024×768 or on a phone). */
export async function expectNoHorizontalScroll(page: Page): Promise<void> {
	const overflow = await page.evaluate(
		() =>
			document.documentElement.scrollWidth -
			document.documentElement.clientWidth,
	);
	expect(overflow).toBeLessThanOrEqual(1);
}

/** Runs a database function as a signed-in member, as PostgREST would (claims of the person, inside a transaction). */
export async function asMember<T>(
	db: Sql,
	userId: string,
	run: (tx: Sql) => Promise<T>,
): Promise<T> {
	return (await db.begin(async (tx) => {
		await tx`select set_config('request.jwt.claims', ${JSON.stringify({ sub: userId, role: "authenticated" })}, true)`;
		return await run(tx as unknown as Sql);
	})) as T;
}

/** The store's counter QR code, as a manager prints it. */
export async function counterToken(
	db: Sql,
	seeded: SeededTenant,
): Promise<string> {
	return await asMember(db, seeded.people.manager.id, async (tx) => {
		const [row] = await tx<
			{ token: string }[]
		>`select app.manager_counter_qr(${seeded.storeA}::uuid, false) ->> 'token' as token`;
		return row?.token ?? "";
	});
}

/** An open shift for a person, as if they clocked in (the cash they take is then checked at clock-out). */
export async function openShiftFor(
	db: Sql,
	seeded: SeededTenant,
	userId: string,
): Promise<void> {
	await db`delete from public.staff_shifts where user_id = ${userId} and status <> 'closed'`;
	await db`insert into public.staff_shifts (tenant_id, store_id, user_id, business_date, clock_in_at, opening_cash)
		values (${seeded.tenantId}, ${seeded.storeA}, ${userId}, (now() at time zone 'Asia/Ho_Chi_Minh')::date, now() - interval '1 minute', 0)`;
}

/** Closes every open order of the tenant, so a test starts from an empty queue. */
export async function clearQueue(db: Sql, seeded: SeededTenant): Promise<void> {
	await db`delete from public.orders where tenant_id = ${seeded.tenantId}`;
}

/** The SQLSTATE a call answers for a member ("ok" when it does not refuse), in a savepoint so the test goes on. */
export async function refusalOf(
	db: Sql,
	userId: string,
	run: (tx: Sql) => PromiseLike<unknown>,
): Promise<string> {
	return await asMember(db, userId, async (tx) => {
		try {
			await (
				tx as unknown as {
					savepoint: (
						fn: (sp: Sql) => PromiseLike<unknown>,
					) => Promise<unknown>;
				}
			).savepoint(run);
			return "ok";
		} catch (error) {
			return (error as { code?: string }).code ?? "error";
		}
	});
}
