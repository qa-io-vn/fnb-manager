#!/usr/bin/env node
// The read-only loyalty fields check (G-11). DATABASE_URL is required and has
// no default; see src/live/loyalty-fields-cli.ts.
import { register } from "tsx/esm/api";

register();
const { runLoyaltyFieldsCheck } = await import(
	new URL("../src/live/loyalty-fields-cli.ts", import.meta.url).href
);
process.exitCode = await runLoyaltyFieldsCheck(
	process.env,
	(line) => process.stdout.write(`${line}\n`),
	(line) => process.stderr.write(`${line}\n`),
);
