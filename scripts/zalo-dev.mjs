import { register } from "tsx/esm/api";

register();
const { runLocalLoopCli } = await import(
	new URL("../packages/zalo/src/local-dev/cli.ts", import.meta.url).href
);
process.exitCode = await runLocalLoopCli(process.argv.slice(2), process.env);
