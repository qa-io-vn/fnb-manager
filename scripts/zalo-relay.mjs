import { register } from "tsx/esm/api";

register();
const { runRelayCli } = await import(
	new URL("../packages/zalo/src/relay-node/cli.ts", import.meta.url).href
);
process.exitCode = await runRelayCli(process.argv.slice(2), process.env);
