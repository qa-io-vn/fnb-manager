import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const envFile = fileURLToPath(new URL("../../../../.env", import.meta.url));
if (process.env.LIVE === "1" && existsSync(envFile)) {
	process.loadEnvFile(envFile);
}

export const IPOS_CONNECTOR_KEY = "ipos-fabi";

const accountsSchema = z.array(
	z.object({
		key: z.string(),
		connector: z.string(),
		email: z.string(),
		password: z.string(),
		appAccessToken: z.string().optional(),
	}),
);

export type LiveAccount = z.infer<typeof accountsSchema>[number];

export const liveEnabled =
	process.env.LIVE === "1" && typeof process.env.POS_ACCOUNTS_JSON === "string";

export function loadLiveAccounts(): LiveAccount[] {
	return liveEnabled
		? accountsSchema.parse(JSON.parse(process.env.POS_ACCOUNTS_JSON ?? "[]"))
		: [];
}

export function loadIposAccounts(): LiveAccount[] {
	return loadLiveAccounts().filter(
		(account) => account.connector === IPOS_CONNECTOR_KEY,
	);
}

export function resolveAppAccessToken(account: LiveAccount): string {
	const token = account.appAccessToken ?? process.env.IPOS_APP_KEY;
	if (!token) {
		throw new Error(
			`live test skipped: set IPOS_APP_KEY in .env or add appAccessToken to the POS_ACCOUNTS_JSON entry "${account.key}"`,
		);
	}
	return token;
}

export function hasAppAccessToken(
	account: Pick<LiveAccount, "appAccessToken"> | undefined,
): boolean {
	return Boolean(account?.appAccessToken ?? process.env.IPOS_APP_KEY);
}

export async function timed<T>(
	label: string,
	work: () => Promise<T>,
): Promise<T> {
	const startedAt = Date.now();
	const result = await work();
	console.log(`[live] ${label}: ${Date.now() - startedAt} ms`);
	return result;
}
