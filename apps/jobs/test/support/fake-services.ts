// A stand-in for the CLI's Services so that a unit test can run a command through
// runCli (argument parsing, the top-level error handler, the redactor, the job
// summary) without a database. Each test file mocks "../../src/services.js" with
//
//   vi.mock("../../src/services.js", async () => {
//     const { FakeServices } = await import("../support/fake-services.js");
//     return { Services: FakeServices };
//   });
//
// and gives the command its "database" with useDatabase(); nothing here opens a
// connection or reads an environment variable.

export type Row = Record<string, unknown>;

/** Answers one query by its text, or returns undefined to let the next handler try. */
export type QueryHandler = (
	query: string,
	values: readonly unknown[],
) => readonly Row[] | undefined;

export interface FakeDatabase {
	readonly sql: unknown;
	readonly runner?: unknown;
	readonly repository?: unknown;
}

let current: FakeDatabase | null = null;

export function useDatabase(database: FakeDatabase | null): void {
	current = database;
}

export class FakeServices {
	db(): FakeDatabase {
		if (current === null) {
			throw new Error("this unit test gave the command no database");
		}
		return current;
	}

	async close(): Promise<void> {}

	supabaseAdmin(): never {
		throw new Error("this unit test gave the command no Supabase client");
	}
}

/**
 * A tagged-template stand-in for postgres.js. It records the text of every query
 * (with ? where a value goes) and answers from the first handler that knows it; a
 * handler may throw to make the query fail.
 */
export function fakeSql(handlers: readonly QueryHandler[]) {
	const queries: string[] = [];
	const sql = async (
		strings: TemplateStringsArray,
		...values: unknown[]
	): Promise<readonly Row[]> => {
		const query = strings.join("?");
		queries.push(query);
		for (const handler of handlers) {
			const rows = handler(query, values);
			if (rows !== undefined) {
				return rows;
			}
		}
		return [];
	};
	return Object.assign(sql, { queries });
}

/** The row public.tenants answers for the fixture tenant of the unit tests. */
export const TENANT_ROW: Row = {
	id: "tenant-id-1",
	slug: "fixture-a",
	name: "Fixture A",
	country_code: "VN",
	currency_code: "VND",
	timezone: "Asia/Ho_Chi_Minh",
	legal_form: "unknown",
};

/** A handler that answers the tenant lookup with the given rows (none: no such tenant). */
export function tenantRows(rows: readonly Row[] = [TENANT_ROW]): QueryHandler {
	return (query) => (query.includes("from public.tenants") ? rows : undefined);
}
