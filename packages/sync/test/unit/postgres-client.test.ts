import { describe, expect, it } from "vitest";
import {
	createPostgresClient,
	defaultSsl,
	effectiveSsl,
	enforcedSsl,
	isLocalDatabaseHost,
	isLocalDatabaseUrl,
	mayFallBackToPlaintext,
} from "../../src/postgres/index.js";

const POOLER = "postgresql://postgres.ref:synthetic@example.com:5432/postgres";
const DIRECT = "postgresql://postgres:synthetic@example.org:5432/postgres";
const LOCAL = "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const LOCAL_STACK =
	"postgresql://postgres:postgres@supabase_db_example:5432/postgres";
const FUNCTIONS_SERVE = "postgresql://postgres:postgres@db:5432/postgres";

describe("postgres client TLS", () => {
	it("asks for TLS on every host that is not local unless the URL says otherwise", () => {
		expect(defaultSsl(POOLER)).toBe("require");
		expect(defaultSsl(DIRECT)).toBe("require");
		expect(defaultSsl(LOCAL)).toBeUndefined();
		expect(defaultSsl(LOCAL_STACK)).toBeUndefined();
		expect(defaultSsl(FUNCTIONS_SERVE)).toBeUndefined();
		expect(defaultSsl(`${POOLER}?sslmode=verify-full`)).toBeUndefined();
	});

	it("reports the mode a connection ends up with", () => {
		expect(effectiveSsl(POOLER)).toBe("require");
		expect(effectiveSsl(LOCAL)).toBe(false);
		expect(effectiveSsl(`${DIRECT}?sslmode=disable`)).toBe(false);
		expect(effectiveSsl(`${DIRECT}?sslmode=verify-full`)).toBe("verify-full");
		expect(effectiveSsl(LOCAL, "require")).toBe("require");
	});

	it("knows which modes can end in plaintext", () => {
		expect(mayFallBackToPlaintext(false)).toBe(true);
		expect(mayFallBackToPlaintext("prefer")).toBe(true);
		expect(mayFallBackToPlaintext("allow")).toBe(true);
		expect(mayFallBackToPlaintext("require")).toBe(false);
		expect(mayFallBackToPlaintext("verify-full")).toBe(false);
	});

	it("treats loopback, the Docker host and the local stack's database as local", () => {
		for (const host of [
			"localhost",
			"127.0.0.1",
			"::1",
			"[::1]",
			"host.docker.internal",
			"supabase_db_fnb",
			"db",
			"DB",
			"db.supabase.internal",
		]) {
			expect(isLocalDatabaseHost(host)).toBe(true);
		}
		for (const host of [
			"example.com",
			"db.abcdefghijklmnopqrst.supabase.co",
			"aws-0-ap-southeast-1.pooler.supabase.com",
			"db.example.com",
			"database",
			"dbhost",
		]) {
			expect(isLocalDatabaseHost(host)).toBe(false);
		}
	});

	it("connects in plaintext to the database URL that supabase functions serve injects", async () => {
		expect(isLocalDatabaseUrl(FUNCTIONS_SERVE)).toBe(true);
		expect(effectiveSsl(FUNCTIONS_SERVE)).toBe(false);
		expect(enforcedSsl(FUNCTIONS_SERVE)).toBe(false);
		const served = createPostgresClient(FUNCTIONS_SERVE);
		try {
			expect(served.options.ssl).toBe(false);
		} finally {
			await served.end({ timeout: 0 });
		}
	});

	it("refuses a remote URL that could end in plaintext and keeps every other mode", () => {
		expect(enforcedSsl(POOLER)).toBe("require");
		expect(enforcedSsl(DIRECT)).toBe("require");
		expect(enforcedSsl(`${POOLER}?sslmode=require`)).toBe("require");
		expect(enforcedSsl(`${POOLER}?sslmode=verify-full`)).toBe("verify-full");
		for (const mode of ["disable", "false", "allow", "prefer"]) {
			expect(enforcedSsl(`${DIRECT}?sslmode=${mode}`)).toBeNull();
		}
		expect(enforcedSsl(LOCAL)).toBe(false);
		expect(enforcedSsl(LOCAL_STACK)).toBe(false);
		expect(enforcedSsl(`${LOCAL}?sslmode=disable`)).toBe(false);
		expect(enforcedSsl(`${LOCAL}?sslmode=prefer`)).toBe("prefer");
		expect(enforcedSsl(`${FUNCTIONS_SERVE}?sslmode=require`)).toBe("require");
	});

	it("hands postgres.js the TLS mode for the documented cloud strings", async () => {
		const cloud = createPostgresClient(POOLER);
		const local = createPostgresClient(LOCAL);
		const pinned = createPostgresClient(`${POOLER}?sslmode=verify-full`);
		try {
			expect(cloud.options.ssl).toBe("require");
			expect(local.options.ssl).toBe(false);
			expect(pinned.options.ssl).toBe("verify-full");
		} finally {
			await Promise.all([
				cloud.end({ timeout: 0 }),
				local.end({ timeout: 0 }),
				pinned.end({ timeout: 0 }),
			]);
		}
	});
});
