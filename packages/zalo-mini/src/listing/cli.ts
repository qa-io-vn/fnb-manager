import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { parseArgs } from "node:util";
import {
	isListed,
	ListingConfigError,
	listingProblems,
	loadListings,
	logoProblems,
	OWNER_CHECKLIST,
	SYNTHETIC_LISTING_CONFIGS,
} from "./index";

const usage = [
	"Usage:",
	"  listing [--config <file>]... [--brand <key>]",
	"",
	"Checks the listing assets of every listed Mini App in the files (the synthetic brands by default):",
	"name, owner's mark, description, category and logo. Rows of several files merge by brand_key and kind;",
	"a logo path is read from the folder of the file that names it.",
].join("\n");

function callerPath(path: string): string {
	return isAbsolute(path)
		? path
		: resolve(process.env.INIT_CWD ?? process.cwd(), path);
}

export function run(argv: readonly string[]): number {
	const { values } = parseArgs({
		strict: true,
		args: [...argv],
		options: {
			config: { type: "string", multiple: true },
			brand: { type: "string" },
			help: { type: "boolean", default: false },
		},
	});
	if (values.help) {
		console.log(usage);
		return 0;
	}
	const configPaths =
		values.config === undefined
			? SYNTHETIC_LISTING_CONFIGS
			: values.config.map(callerPath);
	const listings = loadListings(configPaths).filter(
		(listing) =>
			isListed(listing) &&
			(values.brand === undefined || listing.brandKey === values.brand),
	);
	if (listings.length === 0) {
		console.error(
			`listing: no listed Mini App${values.brand === undefined ? "" : ` for ${values.brand}`} in ${configPaths.join(", ")}`,
		);
		return 1;
	}
	console.log(`listing: ${configPaths.join(", ")}`);
	let failed = false;
	for (const listing of listings) {
		const problems = listingProblems(listing);
		const notes: string[] = [];
		if (listing.logo !== null) {
			if (!existsSync(listing.logo)) {
				problems.push(`the logo file ${listing.logo} does not exist`);
			} else {
				const check = logoProblems(readFileSync(listing.logo));
				problems.push(...check.problems);
				notes.push(...check.notes);
			}
		}
		const label = `${listing.brandKey} ${listing.kind} "${listing.name}"`;
		if (problems.length === 0) {
			console.log(`  ${label}: ok`);
		} else {
			failed = true;
			console.log(`  ${label}: ${problems.length} problem(s)`);
			for (const problem of problems) console.log(`    - ${problem}`);
		}
		for (const note of notes) console.log(`    note: ${note}`);
	}
	console.log(
		"owner checklist, to confirm by hand before the listing is submitted:",
	);
	for (const item of OWNER_CHECKLIST) console.log(`  [ ] ${item}`);
	return failed ? 1 : 0;
}

if (
	process.argv[1] !== undefined &&
	resolve(process.argv[1]) === resolve(import.meta.filename)
) {
	try {
		process.exitCode = run(process.argv.slice(2));
	} catch (error) {
		if (error instanceof ListingConfigError || error instanceof SyntaxError) {
			console.error(`listing: ${error.message}`);
			process.exitCode = 1;
		} else if (
			error instanceof TypeError &&
			String((error as { code?: unknown }).code).startsWith("ERR_PARSE_ARGS")
		) {
			console.error(`listing: ${error.message}`);
			console.error(usage);
			process.exitCode = 2;
		} else {
			throw error;
		}
	}
}
