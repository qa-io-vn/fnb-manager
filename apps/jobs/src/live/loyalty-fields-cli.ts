import { createPostgresClient } from "@fnb/sync/postgres";
import type { Sql } from "postgres";
import {
	assertNoIdentifiers,
	evaluate,
	type LoyaltyFieldsInput,
	renderReport,
} from "./loyalty-fields.js";
import {
	type ReadOptions,
	readLoyaltyFieldsReadOnly,
} from "./loyalty-fields-queries.js";

// G-11: the read-only live check of what the synced POS data carries for
// loyalty. Exit codes: 0 pass, 1 the check failed (a mapped discount entry has
// been quiet for 14 days on a store whose rail uses it, or no store is in
// scope), 2 it refused to run or could not read the database.
//
// The database comes from DATABASE_URL only and there is no default: the URL is
// never printed, no .env file is read, and nothing but counts, shares, booleans
// and the labels store-N and entry-N is written. It makes no POS or Zalo call.

export interface RunDependencies {
	readonly open?: (url: string) => Sql;
	readonly read?: (
		client: Sql,
		options: ReadOptions,
	) => Promise<LoyaltyFieldsInput>;
}

function openReadOnlyClient(url: string): Sql {
	return createPostgresClient(url, {
		maxConnections: 1,
		applicationName: "fnb-loyalty-fields",
		connectTimeoutSeconds: 15,
	});
}

function isPostgresUrl(value: string): boolean {
	try {
		const protocol = new URL(value).protocol;
		return protocol === "postgres:" || protocol === "postgresql:";
	} catch {
		return false;
	}
}

// Only an error code is ever printed: a message can carry the host or the URL.
function errorCode(error: unknown): string {
	const code = (error as { code?: unknown } | null)?.code;
	return typeof code === "string" && /^[A-Za-z0-9_]{1,24}$/.test(code)
		? code
		: "error";
}

export async function runLoyaltyFieldsCheck(
	env: Readonly<Record<string, string | undefined>>,
	write: (line: string) => void,
	warn: (line: string) => void,
	dependencies: RunDependencies = {},
): Promise<number> {
	const url = (env.DATABASE_URL ?? "").trim();
	if (url === "") {
		warn(
			"loyalty-fields: DATABASE_URL is not set; pass the URL of the database to read (there is no default).",
		);
		return 2;
	}
	if (!isPostgresUrl(url)) {
		warn(
			"loyalty-fields: DATABASE_URL is not a postgres:// or postgresql:// URL.",
		);
		return 2;
	}
	const tenantSlug = (env.LIVE_TENANT ?? "").trim();
	const client = (dependencies.open ?? openReadOnlyClient)(url);
	try {
		const read = dependencies.read ?? readLoyaltyFieldsReadOnly;
		const input = await read(client, {
			tenantSlug: tenantSlug === "" ? null : tenantSlug,
		});
		const evaluation = evaluate(input);
		const lines = renderReport(evaluation);
		assertNoIdentifiers(lines);
		for (const line of lines) {
			write(line);
		}
		return evaluation.pass ? 0 : 1;
	} catch (error) {
		warn(
			`loyalty-fields: could not complete the read-only check (${errorCode(error)}).`,
		);
		return 2;
	} finally {
		await client.end({ timeout: 5 }).catch(() => undefined);
	}
}
