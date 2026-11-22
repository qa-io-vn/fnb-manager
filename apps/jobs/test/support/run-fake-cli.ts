import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCli } from "../../src/cli.js";
import { capture } from "./capture.js";
import { type FakeDatabase, useDatabase } from "./fake-services.js";

export interface FakeRun {
	readonly code: number;
	readonly stdout: string;
	readonly stderr: string;
	/** What the command appended to the GitHub job summary. */
	readonly summary: string;
}

/**
 * Runs one command through runCli against a fake database (the test file mocks
 * "../../src/services.js" with FakeServices) and returns the exit code, stdout,
 * stderr and the job summary the command wrote.
 */
export async function runFakeCli(
	argv: readonly string[],
	database: FakeDatabase,
	options: { env?: Record<string, string>; now?: () => Date } = {},
): Promise<FakeRun> {
	const directory = mkdtempSync(join(tmpdir(), "fnb-fake-cli-"));
	const summaryFile = join(directory, "summary.md");
	const out = capture();
	useDatabase(database);
	try {
		const code = await runCli(
			argv,
			{ ...options.env, GITHUB_STEP_SUMMARY: summaryFile },
			{
				streams: out.streams,
				loadEnvFile: false,
				...(options.now === undefined ? {} : { now: options.now }),
			},
		);
		return {
			code,
			stdout: out.stdout(),
			stderr: out.stderr(),
			summary: existsSync(summaryFile) ? readFileSync(summaryFile, "utf8") : "",
		};
	} finally {
		useDatabase(null);
		rmSync(directory, { recursive: true, force: true });
	}
}
