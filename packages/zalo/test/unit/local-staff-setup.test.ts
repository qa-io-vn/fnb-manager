import type { Sql } from "postgres";
import { describe, expect, it } from "vitest";
import {
	LocalLoopError,
	type LocalLoopOptions,
	MOCK_USER_PATTERN,
	parseLocalLoopArgs,
} from "../../src/local-dev/options.js";
import {
	type ManagerSetup,
	seedSyntheticManager,
	syntheticManager,
} from "../../src/local-dev/seed.js";
import {
	setUpLocalStaff,
	staffDevCommand,
	staffSetupLines,
} from "../../src/local-dev/staff-setup.js";

const SYNTHETIC_PASSWORD = "synthetic-password-for-the-test";

function options(argv: readonly string[]): LocalLoopOptions {
	const parsed = parseLocalLoopArgs(argv);
	if (parsed === "help") throw new Error("help");
	return parsed;
}

function refusal(run: () => unknown): string {
	try {
		run();
	} catch (error) {
		expect(error).toBeInstanceOf(LocalLoopError);
		return (error as Error).message;
	}
	throw new Error("nothing was refused");
}

function manager(overrides: Partial<ManagerSetup> = {}): ManagerSetup {
	return {
		...syntheticManager("loyalty-sim"),
		userId: "77777777-7777-4777-8777-777777777777",
		created: true,
		password: SYNTHETIC_PASSWORD,
		storeNames: ["Synthetic store 1", "Synthetic store 2"],
		mockUserBoundElsewhere: false,
		...overrides,
	};
}

const untouchable = (() => {
	throw new Error("the database was reached");
}) as unknown as Sql;

describe("pnpm zalo:dev setup-staff", () => {
	it("targets loyalty-sim by default and takes --new-password only with setup-staff", () => {
		expect(options(["setup-staff"])).toMatchObject({
			command: "setup-staff",
			tenant: "loyalty-sim",
			brand: "brand-1",
		});
		expect(options(["setup-staff"])).not.toHaveProperty("newPassword");
		expect(
			options([
				"--",
				"setup-staff",
				"--new-password",
				"--tenant",
				"zalo-it-x1",
			]),
		).toMatchObject({
			command: "setup-staff",
			tenant: "zalo-it-x1",
			newPassword: true,
		});
		expect(refusal(() => parseLocalLoopArgs(["--new-password"]))).toContain(
			"setup-staff",
		);
		expect(refusal(() => parseLocalLoopArgs(["setup", "staff"]))).toContain(
			"unknown command",
		);
	});

	it("names a synthetic manager with an example.com address and a mock Zalo user", () => {
		expect(syntheticManager("loyalty-sim")).toEqual({
			email: "loyalty-sim-manager@example.com",
			mockUser: "mock-sim-manager-1",
		});
		expect(syntheticManager("zalo-it-x1")).toEqual({
			email: "zalo-it-x1-manager@example.com",
			mockUser: "mock-it-x1-manager-1",
		});
		expect(
			MOCK_USER_PATTERN.test(syntheticManager("loyalty-sim").mockUser),
		).toBe(true);
	});

	it("refuses a real tenant before reaching the database", async () => {
		const io = { line: () => undefined };
		await expect(
			setUpLocalStaff(
				options(["setup-staff", "--tenant", "live-local"]),
				{},
				io,
			),
		).rejects.toThrow("live-local is refused");
		await expect(
			seedSyntheticManager(untouchable, "live-local", "brand-1", {
				newPassword: false,
			}),
		).rejects.toThrow("live-local is refused");
	});

	it("refuses a database that is not the local stack", async () => {
		await expect(
			setUpLocalStaff(
				options(["setup-staff"]),
				{
					SUPABASE_URL: "http://127.0.0.1:54321",
					DATABASE_URL: "postgresql://db.project.example.com:5432/postgres",
					SUPABASE_SECRET_KEY: "sb_secret_synthetic",
					SUPABASE_PUBLISHABLE_KEY: "sb_publishable_synthetic",
				},
				{ line: () => undefined },
			),
		).rejects.toThrow("DATABASE_URL is not the local stack");
	});

	it("prints the password once with the command that opens the staff app", () => {
		const lines = staffSetupLines(
			{ tenant: "loyalty-sim", brand: "brand-1" },
			false,
			manager(),
		);
		expect(lines.filter((line) => line.includes(SYNTHETIC_PASSWORD))).toEqual([
			`  password: ${SYNTHETIC_PASSWORD}`,
		]);
		expect(lines).toContain(
			"  manager login: loyalty-sim-manager@example.com, manager of Synthetic store 1 and Synthetic store 2 (created)",
		);
		expect(lines.at(-1)).toBe(
			"  pnpm zalo:dev --tenant loyalty-sim --member loyalty-sim-manager@example.com --mock-user mock-sim-manager-1",
		);
		const again = staffSetupLines(
			{ tenant: "loyalty-sim", brand: "brand-1" },
			false,
			manager({ created: false, password: null }),
		);
		expect(again.join("\n")).not.toContain(SYNTHETIC_PASSWORD);
		expect(again).toContain(
			"  password: unchanged, printed when the login was created; pass --new-password for a new one",
		);
	});

	it("prints a command that zalo:dev reads back as this manager", () => {
		const command = staffDevCommand(
			"loyalty-sim",
			"brand-2",
			syntheticManager("loyalty-sim"),
		);
		expect(command).toContain("--brand brand-2");
		expect(
			options(command.replace(/^pnpm zalo:dev /, "").split(" ")),
		).toMatchObject({
			command: "start",
			tenant: "loyalty-sim",
			brand: "brand-2",
			member: "loyalty-sim-manager@example.com",
			mockUser: "mock-sim-manager-1",
		});
		expect(
			staffSetupLines(
				{ tenant: "loyalty-sim", brand: "brand-1" },
				true,
				manager({ mockUserBoundElsewhere: true }),
			).join("\n"),
		).toContain("mock-sim-manager-1 is bound to another login");
	});
});
