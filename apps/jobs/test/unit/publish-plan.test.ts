import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	type CanonicalValue,
	canonicalJson,
	type PlanPublishInput,
} from "@fnb/datapack";
import { miniPack, samplePlan } from "@fnb/datapack/testing";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { runCli } from "../../src/cli.js";
import type { Environment } from "../../src/config/env-file.js";
import { findRepositoryRoot } from "../../src/config/env-file.js";
import { collectSecrets } from "../../src/config/secrets.js";
import {
	type PublisherAnswer,
	type PublisherSession,
	rejectionCodes,
	usePublisherFactory,
} from "../../src/datapack/publisher.js";
import { capture } from "../support/capture.js";

const ROOT = findRepositoryRoot();
const FIXTURES = join(ROOT, "packages", "datapack", "test", "fixtures");
const GOLDEN_PACK = join(FIXTURES, "demo-pack.json");
const PUBLISHER_ENV: Environment = {
	SUPABASE_URL: "http://127.0.0.1:54321",
	SUPABASE_PUBLISHABLE_KEY: "sb_publishable_synthetic_key",
	FNB_PUBLISHER_EMAIL: "publisher-synthetic@example.com",
	FNB_PUBLISHER_PASSWORD: "synthetic-publisher-password",
	DATABASE_URL: "postgresql://postgres:never-used-db-pw@127.0.0.1:1/postgres",
	SUPABASE_SECRET_KEY: "synthetic-secret-never-used-value",
	FNB_MEMBER_PASSWORD: "never-used-member-password",
};

interface Recorded {
	created: [string, string][];
	signIns: [string, string][];
	published: PlanPublishInput[];
	signedOut: number;
}

let scratch: string;
let planPath: string;
let packPath: string;
let recorded: Recorded;

function fakeSession(options: {
	signIn?: boolean;
	members?: number | null;
	answer?: PublisherAnswer;
	throwOnPublish?: boolean;
}): void {
	usePublisherFactory((url, key) => {
		recorded.created.push([url, key]);
		const session: PublisherSession = {
			async signIn(email, password) {
				recorded.signIns.push([email, password]);
				return options.signIn ?? true;
			},
			async visibleMembers() {
				return options.members === undefined ? 0 : options.members;
			},
			async publish(input) {
				if (options.throwOnPublish) throw new TypeError("fetch failed");
				recorded.published.push(input);
				return (
					options.answer ?? {
						planId: "0123456789abcdef-plan",
						alreadyPublished: false,
						error: null,
					}
				);
			},
			async signOut() {
				recorded.signedOut += 1;
			},
		};
		return session;
	});
}

async function run(argv: string[], env: Environment = PUBLISHER_ENV) {
	const io = capture();
	const code = await runCli(argv, env, {
		streams: io.streams,
		loadEnvFile: false,
		rootDir: ROOT,
	});
	return { code, stdout: io.stdout(), stderr: io.stderr() };
}

function publish(...rest: string[]): string[] {
	return ["publish-plan", "--plan", planPath, "--pack", packPath, ...rest];
}

beforeAll(() => {
	scratch = mkdtempSync(join(tmpdir(), "fnb-publish-"));
	const pack = miniPack();
	packPath = join(scratch, "pack.json");
	writeFileSync(packPath, canonicalJson(pack as unknown as CanonicalValue));
	planPath = join(scratch, "plan.md");
	writeFileSync(planPath, samplePlan(pack));
});

afterAll(() => {
	rmSync(scratch, { recursive: true, force: true });
});

afterEach(() => {
	usePublisherFactory(null);
});

function reset(): void {
	recorded = { created: [], signIns: [], published: [], signedOut: 0 };
}

describe("fnb publish-plan without --check", () => {
	it("publishes a clean plan as the publisher with the publishable key only, via skill by default, then signs out", async () => {
		reset();
		fakeSession({});
		const ran = await run(publish());
		expect(ran.code).toBe(0);
		expect(recorded.created).toEqual([
			["http://127.0.0.1:54321", "sb_publishable_synthetic_key"],
		]);
		expect(recorded.signIns).toEqual([
			["publisher-synthetic@example.com", "synthetic-publisher-password"],
		]);
		expect(recorded.published[0]?.p_generated_via).toBe("skill");
		expect(recorded.signedOut).toBe(1);
		expect(ran.stdout).toContain("publish-plan: published");
		expect(ran.stdout).toContain("plan: 01234567");
		expect(ran.stdout).toMatch(/stores: \d+/);
		expect(ran.stdout + ran.stderr).not.toContain(
			"publisher-synthetic@example.com",
		);
		expect(ran.stdout + ran.stderr).not.toContain("never-used");
	});

	it("publishes via routine when asked, and refuses another --via", async () => {
		reset();
		fakeSession({});
		expect((await run(publish("--via", "routine"))).code).toBe(0);
		expect(recorded.published[0]?.p_generated_via).toBe("routine");
		expect((await run(publish("--via", "pasted"))).code).toBe(2);
	});

	it("says so and exits 0 when the plan was already published", async () => {
		reset();
		fakeSession({
			answer: {
				planId: "abcdef0123456789",
				alreadyPublished: true,
				error: null,
			},
		});
		const ran = await run(publish());
		expect(ran.code).toBe(0);
		expect(ran.stdout).toContain("already published");
	});

	it("exits 3 before any sign-in when the lint finds errors", async () => {
		reset();
		fakeSession({});
		const broken = join(scratch, "broken.md");
		writeFileSync(
			broken,
			readFileSync(planPath, "utf8").replace("## 7.", "## Mục bảy"),
		);
		const ran = await run(
			["publish-plan", "--plan", broken, "--pack", packPath],
			{},
		);
		expect(ran.code).toBe(3);
		expect(recorded.created).toEqual([]);
		expect(ran.stdout).toContain("section_missing:7");
	});

	it("exits 4 for a sample pack with sample_pack_not_publishable before signing in", async () => {
		reset();
		fakeSession({});
		const golden = JSON.parse(readFileSync(GOLDEN_PACK, "utf8"));
		const samplePlanPath = join(scratch, "sample-plan.md");
		writeFileSync(samplePlanPath, samplePlan(golden));
		const ran = await run([
			"publish-plan",
			"--plan",
			samplePlanPath,
			"--pack",
			GOLDEN_PACK,
		]);
		expect(ran.code).toBe(4);
		expect(ran.stderr).toContain("sample_pack_not_publishable");
		expect(recorded.created).toEqual([]);
	});

	it("asks for the publisher variables only when publishing, naming the missing ones and no value", async () => {
		reset();
		fakeSession({});
		expect(
			(
				await run(
					["publish-plan", "--check", "--plan", planPath, "--pack", packPath],
					{},
				)
			).code,
		).toBe(0);
		const ran = await run(publish(), {
			SUPABASE_URL: "http://127.0.0.1:54321",
			DATABASE_URL: PUBLISHER_ENV.DATABASE_URL as string,
		});
		expect(ran.code).toBe(1);
		expect(ran.stderr).toContain(
			"SUPABASE_PUBLISHABLE_KEY, FNB_PUBLISHER_EMAIL, FNB_PUBLISHER_PASSWORD",
		);
		expect(recorded.created).toEqual([]);
	});

	it("exits 1 without repeating the e-mail when the sign-in is refused", async () => {
		reset();
		fakeSession({ signIn: false });
		const ran = await run(publish());
		expect(ran.code).toBe(1);
		expect(ran.stderr).toContain("publisher login was refused");
		expect(ran.stderr).not.toContain("publisher-synthetic");
		expect(recorded.published).toEqual([]);
	});

	it.each([
		{ members: 1, label: "a login that reads a member row" },
		{ members: null, label: "a login whose member count cannot be read" },
	])(
		"stops $label as a data member, signs out and publishes nothing",
		async ({ members }) => {
			reset();
			fakeSession({ members });
			const ran = await run(publish());
			expect(ran.code).toBe(1);
			expect(ran.stderr).toContain("data member");
			expect(recorded.published).toEqual([]);
			expect(recorded.signedOut).toBe(1);
		},
	);

	it.each([
		{
			code: "22023",
			details: "section_missing:7, kpi_unknown:net_sales",
			exit: 3,
			text: "kpi_unknown:net_sales",
		},
		{ code: "42501", details: null, exit: 1, text: "scope denied" },
		{ code: "PGRST301", details: null, exit: 1, text: "publishing failed" },
	])(
		"maps a $code answer to exit $exit",
		async ({ code, details, exit, text }) => {
			reset();
			fakeSession({
				answer: {
					planId: null,
					alreadyPublished: false,
					error: { code, details, message: "x" },
				},
			});
			const ran = await run(publish());
			expect(ran.code).toBe(exit);
			expect(ran.stdout + ran.stderr).toContain(text);
			expect(recorded.signedOut).toBe(1);
		},
	);

	it("exits 1 on a network failure and still signs out", async () => {
		reset();
		fakeSession({ throwOnPublish: true });
		const ran = await run(publish());
		expect(ran.code).toBe(1);
		expect(ran.stderr).toContain("network");
		expect(recorded.signedOut).toBe(1);
	});

	it("prints the same counts in CI without any e-mail", async () => {
		reset();
		fakeSession({});
		const ran = await run(publish(), { ...PUBLISHER_ENV, CI: "1" });
		expect(ran.code).toBe(0);
		expect(ran.stdout).not.toContain("@example.com");
	});
});

describe("the publisher helpers", () => {
	it("splits the rejection codes of the details", () => {
		expect(rejectionCodes("section_missing:7, kpi_unknown:net_sales")).toEqual([
			"section_missing:7",
			"kpi_unknown:net_sales",
		]);
		expect(rejectionCodes(null)).toEqual([]);
	});

	it("masks the publisher e-mail and password", () => {
		const secrets = collectSecrets(PUBLISHER_ENV);
		expect(secrets).toContain("publisher-synthetic@example.com");
		expect(secrets).toContain("synthetic-publisher-password");
	});
});
