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
	await page.getByTestId("sign-in-zalo").click();
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
