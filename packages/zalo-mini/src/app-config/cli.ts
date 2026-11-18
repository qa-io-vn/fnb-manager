import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { parseArgs } from "node:util";
import {
	AppConfigError,
	appConfigJson,
	buildAppConfig,
	differingFields,
	MINI_APP_KINDS,
	parseMiniAppConfiguration,
	readAppConfig,
	selectMiniAppRow,
	unconfiguredDifferences,
} from "./index";

const usage = [
	"Usage:",
	"  app-config --config <file> --brand <key> --app staff|customer --out <path>",
	"  app-config --config <file> --list",
	"  app-config --compare <first app-config.json> <second app-config.json>",
].join("\n");

function readJson(path: string): unknown {
	return JSON.parse(readFileSync(resolve(path), "utf8"));
}

function run(argv: readonly string[]): number {
	const { values, positionals } = parseArgs({
		args: [...argv],
		allowPositionals: true,
		options: {
			config: { type: "string" },
			brand: { type: "string" },
			app: { type: "string" },
			out: { type: "string" },
			list: { type: "boolean", default: false },
			compare: { type: "boolean", default: false },
		},
	});
	if (values.compare) {
		const [first, second] = positionals;
		if (!first || !second || positionals.length !== 2) {
			console.error(usage);
			return 2;
		}
		const left = readJson(first);
		const right = readJson(second);
		readAppConfig(left);
		readAppConfig(right);
		const unexpected = unconfiguredDifferences(left, right);
		if (unexpected.length > 0) {
			console.error(
				`app-config: the files differ outside the configured fields: ${unexpected.join(", ")}`,
			);
			return 1;
		}
		const configured = differingFields(left, right);
		console.log(
			`app-config: the files differ only in configured fields (${configured.length}: ${configured.join(", ") || "none"})`,
		);
		return 0;
	}
	if (!values.config) {
		console.error(usage);
		return 2;
	}
	const rows = parseMiniAppConfiguration(readJson(values.config));
	if (values.list) {
		for (const row of rows) console.log(`${row.brand_key} ${row.kind}`);
		return 0;
	}
	const kind = MINI_APP_KINDS.find((name) => name === values.app);
	if (!values.brand || !kind || !values.out) {
		console.error(usage);
		return 2;
	}
	const config = buildAppConfig(selectMiniAppRow(rows, values.brand, kind));
	const out = resolve(values.out);
	mkdirSync(dirname(out), { recursive: true });
	writeFileSync(out, appConfigJson(config));
	console.log(
		`app-config: wrote the ${kind} app-config.json of ${values.brand}`,
	);
	return 0;
}

try {
	process.exitCode = run(process.argv.slice(2));
} catch (error) {
	if (error instanceof AppConfigError) {
		console.error(`app-config: ${error.message}`);
		process.exitCode = 1;
	} else {
		throw error;
	}
}
