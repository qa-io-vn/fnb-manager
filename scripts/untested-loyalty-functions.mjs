#!/usr/bin/env node
// docs/test-gaps.md G-40, the SQL half: lists the loyalty functions of the `app`
// and `public` schemas, at their latest definition in supabase/migrations, that
// no file of supabase/tests names. It prints function names only, one per line,
// and exits 0 whatever it finds: it reports, it does not gate. A one-line count
// goes to stderr.
//
//   node scripts/untested-loyalty-functions.mjs [--pattern <regex>]
//
// "Loyalty" is a reading of the function's name (see LOYALTY_NAME); --pattern
// replaces it, for example --pattern . lists every app and public function.
// "Named" is a whole-word, case-insensitive match of the bare name in the text of
// a test file, comments removed, so a call, a has_function() argument and a
// privilege check all count.

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

const NAME = "((?:app|public)\\.[a-z0-9_]+)";
const CREATE = new RegExp(
	`\\bcreate\\s+(?:or\\s+replace\\s+)?function\\s+${NAME}\\s*\\(`,
	"gi",
);
const DROP = new RegExp(
	`\\bdrop\\s+function\\s+(?:if\\s+exists\\s+)?${NAME}(?=[\\s(;])`,
	"gi",
);
const RENAME = new RegExp(
	`\\balter\\s+function\\s+${NAME}\\s*\\((?:[^()]|\\([^()]*\\))*\\)\\s+rename\\s+to\\s+([a-z0-9_]+)`,
	"gi",
);

// The words of a loyalty function's name, split at underscores. check_in and
// code_attempt are two-word terms.
const LOYALTY_WORDS = [
	"loyalty",
	"redemptions?",
	"redeem",
	"coupons?",
	"rewards?",
	"rails?",
	"voucher",
	"stamps?",
	"members?",
	"membership",
	"programmes?",
	"wallet",
	"check_in",
	"receipt",
	"bills?",
	"counter",
	"pool",
	"earn",
	"clawback",
	"customers?",
	"points",
	"erased",
	"enrol",
	"code_attempt",
	"phone_hash",
	"phone_masked",
	"cohort",
	"rfm",
];
export const LOYALTY_NAME = new RegExp(
	`(?:^|_)(?:${LOYALTY_WORDS.join("|")})(?:_|$)`,
);

function withoutComments(sql) {
	return sql.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--[^\n]*/g, " ");
}

// The functions that exist after the migrations ran, by schema-qualified name
// and the migration that defines them last. Overloads share a name: a drop
// removes the name until a later create adds it back.
export function functionsAfterMigrations(migrations) {
	const defined = new Map();
	for (const { file, text } of [...migrations].sort((left, right) =>
		left.file < right.file ? -1 : left.file > right.file ? 1 : 0,
	)) {
		const sql = withoutComments(text);
		const events = [];
		for (const match of sql.matchAll(CREATE)) {
			events.push({ at: match.index, kind: "create", name: match[1] });
		}
		for (const match of sql.matchAll(DROP)) {
			events.push({ at: match.index, kind: "drop", name: match[1] });
		}
		for (const match of sql.matchAll(RENAME)) {
			events.push({
				at: match.index,
				kind: "rename",
				name: match[1],
				to: `${match[1].split(".")[0]}.${match[2]}`,
			});
		}
		events.sort((left, right) => left.at - right.at);
		for (const event of events) {
			const name = event.name.toLowerCase();
			if (event.kind === "create") {
				defined.set(name, file);
			} else if (event.kind === "drop") {
				defined.delete(name);
			} else if (defined.has(name)) {
				defined.delete(name);
				defined.set(event.to.toLowerCase(), file);
			}
		}
	}
	return defined;
}

export function loyaltyNames(names, pattern = LOYALTY_NAME) {
	return [...names].filter((name) => pattern.test(name.split(".")[1] ?? name));
}

// True when any of the texts names the function, schema-qualified or not.
export function namedIn(texts, qualifiedName) {
	const bare = qualifiedName.split(".")[1] ?? qualifiedName;
	const word = new RegExp(`(?<![a-z0-9_])${bare}(?![a-z0-9_])`, "i");
	return texts.some((text) => word.test(text));
}

export function untestedLoyaltyFunctions(migrations, tests, pattern) {
	const stripped = tests.map(withoutComments);
	const all = functionsAfterMigrations(migrations);
	const loyalty = loyaltyNames(all.keys(), pattern);
	return {
		loyalty: loyalty.length,
		untested: loyalty.filter((name) => !namedIn(stripped, name)).sort(),
	};
}

function sqlFilesUnder(directory) {
	return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
		const path = join(directory, entry.name);
		if (entry.isDirectory()) return sqlFilesUnder(path);
		return entry.name.endsWith(".sql") ? [path] : [];
	});
}

export function main(argv, write, warn) {
	let pattern;
	const flag = argv.indexOf("--pattern");
	if (flag >= 0) {
		const value = argv[flag + 1];
		if (value === undefined) {
			warn("untested-loyalty-functions: --pattern needs a regular expression");
			return 2;
		}
		pattern = new RegExp(value);
	}
	const migrations = sqlFilesUnder(join(ROOT, "supabase", "migrations")).map(
		(path) => ({ file: path, text: readFileSync(path, "utf8") }),
	);
	const tests = sqlFilesUnder(join(ROOT, "supabase", "tests")).map((path) =>
		readFileSync(path, "utf8"),
	);
	const { loyalty, untested } = untestedLoyaltyFunctions(
		migrations,
		tests,
		pattern,
	);
	for (const name of untested) {
		write(name);
	}
	warn(
		`untested-loyalty-functions: ${untested.length} of ${loyalty} loyalty functions of app and public are not named in any file of supabase/tests`,
	);
	return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
	process.exitCode = main(
		process.argv.slice(2),
		(line) => process.stdout.write(`${line}\n`),
		(line) => process.stderr.write(`${line}\n`),
	);
}
