#!/usr/bin/env node
import { register } from "tsx/esm/api";

register();
const { runCli } = await import(new URL("../src/cli.ts", import.meta.url).href);
process.exitCode = await runCli(process.argv.slice(2), process.env);
