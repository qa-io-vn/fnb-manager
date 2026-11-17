import { describe, expect, it } from "vitest";
import {
	apiEndpoint,
	backendTarget,
	databaseEndpoint,
	webEnvPlan,
	webEnvWarnings,
} from "../../src/commands/backend-target.js";

const LOCAL_DB = "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const LOCAL_API = "http://127.0.0.1:54321";
const POOLER_DB =
	"postgresql://postgres.aaaaaaaaaaaaaaaaaaaa:pooler-pw-1!@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres?sslmode=require";
const DIRECT_DB =
	"postgresql://postgres:direct-pw-1!@db.aaaaaaaaaaaaaaaaaaaa.supabase.co:5432/postgres";
const CLOUD_API = "https://aaaaaaaaaaaaaaaaaaaa.supabase.co";
const OTHER_API = "https://bbbbbbbbbbbbbbbbbbbb.supabase.co";

describe("backend endpoints", () => {
	it("tells the local stack from a project and reads the project reference", () => {
		expect(databaseEndpoint(LOCAL_DB)).toEqual({
			locality: "local",
			projectRef: null,
		});
		expect(databaseEndpoint(POOLER_DB)).toEqual({
			locality: "remote",
			projectRef: "aaaaaaaaaaaaaaaaaaaa",
		});
		expect(databaseEndpoint(DIRECT_DB)).toEqual({
			locality: "remote",
			projectRef: "aaaaaaaaaaaaaaaaaaaa",
		});
		expect(apiEndpoint(LOCAL_API)).toEqual({
			locality: "local",
			projectRef: null,
		});
		expect(apiEndpoint("http://localhost:54321/")?.locality).toBe("local");
		expect(apiEndpoint(CLOUD_API)).toEqual({
			locality: "remote",
			projectRef: "aaaaaaaaaaaaaaaaaaaa",
		});
		expect(apiEndpoint(undefined)).toBeNull();
		expect(apiEndpoint("not a url")).toBeNull();
	});
});

describe("backendTarget", () => {
	it("accepts the local stack on both sides", () => {
		const target = backendTarget({
			DATABASE_URL: LOCAL_DB,
			SUPABASE_URL: LOCAL_API,
		});
		expect(target.databaseVariable).toBe("DATABASE_URL");
		expect(target.problem).toBeNull();
	});

	it("accepts one cloud project on both sides, read before DATABASE_URL in CI", () => {
		const target = backendTarget({
			CI: "1",
			DATABASE_URL: LOCAL_DB,
			SUPABASE_DB_URL: POOLER_DB,
			SUPABASE_URL: CLOUD_API,
		});
		expect(target.databaseVariable).toBe("SUPABASE_DB_URL");
		expect(target.problem).toBeNull();
	});

	it("refuses a local database with a cloud API, without printing the connection string", () => {
		const target = backendTarget({
			DATABASE_URL: LOCAL_DB,
			SUPABASE_DB_URL: POOLER_DB,
			SUPABASE_URL: CLOUD_API,
		});
		expect(target.databaseVariable).toBe("DATABASE_URL");
		expect(target.problem).toContain(
			"DATABASE_URL points at the local stack but SUPABASE_URL at a remote project",
		);
		expect(target.problem).not.toContain("postgres:postgres");
		expect(target.problem).not.toContain("127.0.0.1");
	});

	it("refuses two different cloud projects", () => {
		const target = backendTarget({
			SUPABASE_DB_URL: POOLER_DB,
			SUPABASE_URL: OTHER_API,
		});
		expect(target.problem).toContain("two different Supabase projects");
		expect(target.problem).not.toContain("pooler-pw-1");
		expect(target.problem).not.toContain("aaaaaaaaaaaaaaaaaaaa");
	});

	it("leaves the check to the data alone when SUPABASE_URL is missing", () => {
		const target = backendTarget({ DATABASE_URL: LOCAL_DB });
		expect(target.api).toBeNull();
		expect(target.problem).toBeNull();
	});
});

describe("apps/web/.env.local", () => {
	it("is written from SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY", () => {
		expect(
			webEnvPlan({
				SUPABASE_URL: LOCAL_API,
				SUPABASE_PUBLISHABLE_KEY: " sb_publishable_example ",
			}),
		).toEqual({
			kind: "write",
			content: `VITE_SUPABASE_URL=${LOCAL_API}\nVITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_example\n`,
		});
	});

	it("names the variables that are missing", () => {
		expect(webEnvPlan({ SUPABASE_URL: LOCAL_API })).toEqual({
			kind: "missing",
			variables: ["SUPABASE_PUBLISHABLE_KEY"],
		});
		expect(webEnvPlan({})).toEqual({
			kind: "missing",
			variables: ["SUPABASE_URL", "SUPABASE_PUBLISHABLE_KEY"],
		});
	});

	it("warns about an existing file that runs the demo or points elsewhere, without repeating its values", () => {
		const env = { SUPABASE_URL: LOCAL_API };
		expect(
			webEnvWarnings(
				`VITE_SUPABASE_URL=${LOCAL_API}/\r\nVITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_example\r\n`,
				env,
			),
		).toEqual([]);
		const empty = webEnvWarnings(
			"VITE_SUPABASE_URL=\nVITE_SUPABASE_PUBLISHABLE_KEY=\n",
			env,
		);
		expect(empty).toHaveLength(1);
		expect(empty[0]).toContain("runs the demo");
		const elsewhere = webEnvWarnings(
			`VITE_SUPABASE_URL=${CLOUD_API}\nVITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_example\n`,
			env,
		);
		expect(elsewhere).toHaveLength(1);
		expect(elsewhere[0]).toContain("another API");
		expect(elsewhere[0]).not.toContain(CLOUD_API);
	});
});
