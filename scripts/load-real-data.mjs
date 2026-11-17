import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const fnb = fileURLToPath(new URL("../apps/jobs/bin/fnb.mjs", import.meta.url));
const args = process.argv.slice(2);
const forwarded = args[0] === "--" ? args.slice(1) : args;

const result = spawnSync(process.execPath, [fnb, "bootstrap", ...forwarded], {
	stdio: "inherit",
	env: { ...process.env, CI: process.env.CI || "1" },
});

if (result.error) {
	process.stderr.write(`could not start fnb: ${result.error.message}\n`);
	process.exit(1);
}
process.exit(result.status ?? 1);
