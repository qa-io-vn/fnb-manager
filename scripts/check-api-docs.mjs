import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const defaultDocPath = join(repoRoot, "docs", "api.md");
const clientAnchor = join(repoRoot, "packages", "sync", "package.json");
const supabaseConfigPath = join(repoRoot, "supabase", "config.toml");
const apiRole = "authenticated";
const exposedSchema = "public";
const statementTimeoutMs = 15000;
const localHosts = new Set([
	"localhost",
	"127.0.0.1",
	"::1",
	"[::1]",
	"host.docker.internal",
	"db",
	"db.supabase.internal",
]);
const localStackHostPrefix = "supabase_db_";
const plaintextSslModes = new Set(["disable", "false", "allow", "prefer"]);
const credentialsInUrl = /\/\/[^/@\s]*@/g;
const credentialsInPath = /[^/\s]*:[^/@\s]*@/g;

const usage = `Usage: node scripts/check-api-docs.mjs [--list] [--doc <file>]

Compares the signature blocks of docs/api.md with every function in the
${exposedSchema} schema that the ${apiRole} role may execute: name, arguments with
their defaults, and result. The catalogue is read in a read-only transaction.

  DATABASE_URL set      read through the postgres client of the workspace;
                        a host that is not local gets TLS (sslmode=require
                        unless the URL names a stricter mode), and a URL that
                        allows plaintext (disable, allow, prefer) is refused
  DATABASE_URL not set  local fallback: docker exec psql in the database
                        container of the local Supabase stack
  --list                print the functions found before the comparison
  --doc <file>          check another Markdown file instead of docs/api.md

Pass the database URL in DATABASE_URL, never as an argument.

Exit codes: 0 in step, 1 out of step, 2 usage or connection error.`;

const catalogueQuery = `
select coalesce(json_agg(f order by f.name, f.identity_arguments), '[]'::json)::text as payload
from (
  select p.proname as name,
         pg_get_function_identity_arguments(p.oid) as identity_arguments,
         pg_get_function_arguments(p.oid) as arguments,
         pg_get_function_result(p.oid) as result,
         has_function_privilege('${apiRole}', p.oid, 'execute') as executable
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  where n.nspname = '${exposedSchema}'
    and p.prokind = 'f'
    and p.prorettype <> 'pg_catalog.trigger'::pg_catalog.regtype
    and not exists (
      select 1
      from pg_catalog.pg_depend d
      where d.classid = 'pg_catalog.pg_proc'::pg_catalog.regclass
        and d.objid = p.oid
        and d.deptype = 'e'
    )
) f`;

class SetupError extends Error {}

function printable(text) {
	return text
		.replace(credentialsInUrl, "//<redacted>@")
		.replace(credentialsInPath, "<redacted>@");
}

function unknownArgumentError(argument) {
	if (!argument.startsWith("-")) {
		return new SetupError(
			"unexpected argument (not shown); pass the database URL in DATABASE_URL",
		);
	}
	return new SetupError(`unknown option ${printable(argument)}`);
}

function parseOptions(argv) {
	const options = { list: false, docPath: defaultDocPath, help: false };
	for (let index = 0; index < argv.length; index += 1) {
		const argument = argv[index];
		if (argument === "--help" || argument === "-h") {
			options.help = true;
		} else if (argument === "--list") {
			options.list = true;
		} else if (argument === "--doc") {
			const value = argv[index + 1];
			if (value === undefined) {
				throw new SetupError("--doc needs a file");
			}
			options.docPath = resolve(value);
			index += 1;
		} else {
			throw unknownArgumentError(argument);
		}
	}
	return options;
}

function maskQuoted(text) {
	return text.replace(/'(?:[^']|'')*'|"(?:[^"]|"")*"/g, (match) =>
		"_".repeat(match.length),
	);
}

function splitTopLevel(text) {
	const masked = maskQuoted(text);
	const parts = [];
	let depth = 0;
	let start = 0;
	for (let index = 0; index < masked.length; index += 1) {
		const character = masked[index];
		if (character === "(" || character === "[") {
			depth += 1;
		} else if (character === ")" || character === "]") {
			depth -= 1;
		} else if (character === "," && depth === 0) {
			parts.push(text.slice(start, index));
			start = index + 1;
		}
	}
	parts.push(text.slice(start));
	return parts.map((part) => part.trim()).filter((part) => part !== "");
}

function closingParenthesis(text, openIndex) {
	const masked = maskQuoted(text);
	let depth = 0;
	for (let index = openIndex; index < masked.length; index += 1) {
		if (masked[index] === "(") {
			depth += 1;
		} else if (masked[index] === ")") {
			depth -= 1;
			if (depth === 0) {
				return index;
			}
		}
	}
	return -1;
}

function tidy(text) {
	return text
		.split(/('(?:[^']|'')*'|"(?:[^"]|"")*")/)
		.map((segment, index) =>
			index % 2 === 1
				? segment
				: segment
						.replace(/\s+/g, " ")
						.replace(/\s*,\s*/g, ", ")
						.replace(/([([])\s+/g, "$1")
						.replace(/\s+([)\]])/g, "$1")
						.replace(/\bpublic\./g, ""),
		)
		.join("")
		.trim();
}

function withoutDefault(argument) {
	const found = /\s(?:default\s|=)/i.exec(maskQuoted(argument));
	return found === null ? argument : argument.slice(0, found.index);
}

function argumentList(text) {
	return splitTopLevel(text).map(tidy);
}

function fullArguments(text) {
	return argumentList(text).join(", ");
}

function identityArguments(text) {
	return splitTopLevel(text)
		.map((argument) => tidy(withoutDefault(argument)))
		.join(", ");
}

function normalizeResult(text) {
	const compact = tidy(text);
	const table = /^TABLE\s*\(([\s\S]*)\)$/i.exec(compact);
	if (table === null) {
		return compact;
	}
	return `TABLE(${splitTopLevel(table[1]).map(tidy).join(", ")})`;
}

function keyOf(name, identity) {
	return `${name}(${identity})`;
}

function parseSignature(body) {
	const head = new RegExp(
		`^${exposedSchema}\\.([a-z_][a-z0-9_]*)\\s*\\(`,
		"i",
	).exec(body);
	if (head === null) {
		return null;
	}
	const open = head[0].length - 1;
	const close = closingParenthesis(body, open);
	if (close === -1) {
		return null;
	}
	const returns = /^returns\s+([\s\S]+)$/i.exec(body.slice(close + 1).trim());
	if (returns === null) {
		return null;
	}
	return {
		name: head[1],
		argumentsText: body.slice(open + 1, close),
		resultText: returns[1],
	};
}

function documentedSignatures(markdown, label) {
	const signatures = [];
	const problems = [];
	const fence = /^```sql[ \t]*\r?\n([\s\S]*?)^```[ \t]*$/gm;
	for (const match of markdown.matchAll(fence)) {
		const body = match[1].trim();
		if (!body.startsWith(`${exposedSchema}.`)) {
			continue;
		}
		const line = markdown.slice(0, match.index).split("\n").length + 1;
		const parsed = parseSignature(body);
		if (parsed === null) {
			problems.push(
				`${label} line ${line}: the block does not read "${exposedSchema}.<name>(<arguments>) returns <result>"`,
			);
			continue;
		}
		signatures.push({ ...parsed, line });
	}
	return { signatures, problems };
}

function isLocalHost(host) {
	const name = host.toLowerCase();
	return localHosts.has(name) || name.startsWith(localStackHostPrefix);
}

function tlsOption(url) {
	let parsed;
	try {
		parsed = new URL(url);
	} catch {
		throw new SetupError("DATABASE_URL is not a valid URL");
	}
	if (isLocalHost(parsed.hostname)) {
		return {};
	}
	const mode = parsed.searchParams.get("sslmode");
	if (mode === null) {
		return { ssl: "require" };
	}
	if (plaintextSslModes.has(mode.toLowerCase())) {
		throw new SetupError(
			"DATABASE_URL lets the connection to a remote host fall back to plaintext; drop its sslmode or set sslmode=require, verify-ca or verify-full",
		);
	}
	return {};
}

async function catalogueThroughUrl(url) {
	const ssl = tlsOption(url);
	let entry;
	try {
		entry = createRequire(clientAnchor).resolve("postgres");
	} catch {
		throw new SetupError(
			"the postgres client of the workspace is not installed; run pnpm install",
		);
	}
	const { default: postgres } = await import(pathToFileURL(entry).href);
	const sql = postgres(url, {
		max: 1,
		connect_timeout: 15,
		onnotice: () => undefined,
		connection: { application_name: "fnb-check-api-docs" },
		...ssl,
	});
	try {
		const rows = await sql.begin("read only", async (transaction) => {
			await transaction.unsafe(`set local search_path to ${exposedSchema}`);
			await transaction.unsafe(
				`set local statement_timeout to ${statementTimeoutMs}`,
			);
			return transaction.unsafe(catalogueQuery);
		});
		return JSON.parse(rows[0].payload);
	} catch (error) {
		throw new SetupError(
			`the catalogue could not be read: ${printable(error instanceof Error ? error.message : String(error))}`,
		);
	} finally {
		await sql.end({ timeout: 5 });
	}
}

function localDatabaseContainer() {
	let config;
	try {
		config = readFileSync(supabaseConfigPath, "utf8");
	} catch {
		throw new SetupError("supabase/config.toml is missing");
	}
	const projectId = /^project_id\s*=\s*"([^"]+)"/m.exec(config);
	if (projectId === null) {
		throw new SetupError("supabase/config.toml names no project_id");
	}
	return `supabase_db_${projectId[1]}`;
}

function catalogueThroughContainer(container) {
	const result = spawnSync(
		"docker",
		[
			"exec",
			"-e",
			`PGOPTIONS=-c default_transaction_read_only=on -c statement_timeout=${statementTimeoutMs} -c search_path=${exposedSchema}`,
			container,
			"psql",
			"-U",
			"postgres",
			"-d",
			"postgres",
			"-X",
			"-q",
			"-A",
			"-t",
			"-v",
			"ON_ERROR_STOP=1",
			"-c",
			catalogueQuery,
		],
		{ encoding: "utf8", maxBuffer: 16 * 1024 * 1024 },
	);
	if (result.error) {
		throw new SetupError(
			`docker could not be run (${result.error.message}); set DATABASE_URL or start the local stack with pnpm db:start`,
		);
	}
	if (result.status !== 0) {
		throw new SetupError(
			`psql in ${container} failed: ${result.stderr.trim() || `exit ${result.status}`}; set DATABASE_URL or start the local stack with pnpm db:start`,
		);
	}
	return JSON.parse(result.stdout.trim());
}

function signatureBlock(entry) {
	const args = argumentList(entry.arguments);
	const head =
		args.length === 0
			? `${exposedSchema}.${entry.name}()`
			: `${exposedSchema}.${entry.name}(\n${args.map((argument) => `  ${argument}`).join(",\n")}\n)`;
	const result = normalizeResult(entry.result);
	const table = /^TABLE\((.*)\)$/.exec(result);
	const tail =
		table === null
			? `returns ${result}`
			: `returns TABLE(\n${splitTopLevel(table[1])
					.map((column) => `  ${column}`)
					.join(",\n")}\n)`;
	return ["```sql", head, tail, "```"].join("\n");
}

function indent(text, spaces) {
	const pad = " ".repeat(spaces);
	return text
		.split("\n")
		.map((line) => `${pad}${line}`)
		.join("\n");
}

function compare(functions, signatures, label) {
	const problems = [];
	const byKey = new Map(
		functions.map((entry) => [
			keyOf(entry.name, identityArguments(entry.identity_arguments)),
			entry,
		]),
	);
	const seen = new Map();
	const matched = new Set();
	const unmatchedDocumented = [];
	for (const signature of signatures) {
		const key = keyOf(
			signature.name,
			identityArguments(signature.argumentsText),
		);
		if (seen.has(key)) {
			problems.push(
				`documented twice: ${exposedSchema}.${key} (${label} lines ${seen.get(key)} and ${signature.line})`,
			);
			continue;
		}
		seen.set(key, signature.line);
		const entry = byKey.get(key);
		if (entry === undefined) {
			unmatchedDocumented.push({ key, signature });
			continue;
		}
		if (!entry.executable) {
			problems.push(
				`documented, but ${apiRole} may not execute it: ${exposedSchema}.${key} (${label} line ${signature.line})`,
			);
			continue;
		}
		matched.add(key);
		const documentedArguments = fullArguments(signature.argumentsText);
		const databaseArguments = fullArguments(entry.arguments);
		if (documentedArguments !== databaseArguments) {
			problems.push(
				`arguments differ: ${exposedSchema}.${signature.name} (${label} line ${signature.line})\n    database: ${databaseArguments}\n    docs:     ${documentedArguments}`,
			);
		}
		const documentedResult = normalizeResult(signature.resultText);
		const databaseResult = normalizeResult(entry.result);
		if (documentedResult !== databaseResult) {
			problems.push(
				`result differs: ${exposedSchema}.${signature.name} (${label} line ${signature.line})\n    database: ${databaseResult}\n    docs:     ${documentedResult}`,
			);
		}
	}
	const unmatchedDatabase = functions.filter(
		(entry) =>
			entry.executable &&
			!matched.has(
				keyOf(entry.name, identityArguments(entry.identity_arguments)),
			),
	);
	for (const { key, signature } of unmatchedDocumented) {
		const sameName = unmatchedDatabase.findIndex(
			(entry) => entry.name === signature.name,
		);
		if (sameName === -1) {
			problems.push(
				`no longer in the database: ${exposedSchema}.${key} (${label} line ${signature.line})`,
			);
			continue;
		}
		const [entry] = unmatchedDatabase.splice(sameName, 1);
		problems.push(
			`arguments differ: ${exposedSchema}.${signature.name} (${label} line ${signature.line})\n    database: ${fullArguments(entry.arguments)}\n    docs:     ${fullArguments(signature.argumentsText)}`,
		);
	}
	for (const entry of unmatchedDatabase) {
		problems.push(
			`missing from ${label}: ${exposedSchema}.${keyOf(entry.name, identityArguments(entry.identity_arguments))}\n${indent(signatureBlock(entry), 4)}`,
		);
	}
	return problems;
}

async function main() {
	let options;
	try {
		options = parseOptions(process.argv.slice(2));
	} catch (error) {
		console.error(`check-api-docs: ${error.message}\n\n${usage}`);
		return 2;
	}
	if (options.help) {
		console.log(usage);
		return 0;
	}
	const relativePath = relative(repoRoot, options.docPath);
	const label =
		relativePath === "" || relativePath.startsWith("..")
			? options.docPath
			: relativePath;
	let markdown;
	try {
		markdown = readFileSync(options.docPath, "utf8");
	} catch {
		console.error(`check-api-docs: ${printable(label)} cannot be read`);
		return 2;
	}
	let functions;
	try {
		const url = process.env.DATABASE_URL;
		if (url) {
			functions = await catalogueThroughUrl(url);
		} else {
			const container = localDatabaseContainer();
			console.error(
				`check-api-docs: DATABASE_URL is not set; reading the catalogue of the local container ${container} through docker exec psql`,
			);
			functions = catalogueThroughContainer(container);
		}
	} catch (error) {
		console.error(
			`check-api-docs: ${error instanceof SetupError ? error.message : String(error)}`,
		);
		return 2;
	}
	const executable = functions.filter((entry) => entry.executable);
	if (options.list) {
		for (const entry of executable) {
			console.log(
				`${exposedSchema}.${entry.name}(${entry.identity_arguments})`,
			);
		}
	}
	const { signatures, problems: parseProblems } = documentedSignatures(
		markdown,
		label,
	);
	const problems = [...parseProblems, ...compare(functions, signatures, label)];
	if (problems.length === 0) {
		console.log(
			`check-api-docs: ${label} matches the database: ${executable.length} functions in ${exposedSchema} that ${apiRole} may execute, ${signatures.length} documented.`,
		);
		return 0;
	}
	console.error(
		`check-api-docs: ${label} is out of step with the database (${executable.length} functions in ${exposedSchema} that ${apiRole} may execute, ${signatures.length} documented):`,
	);
	for (const problem of problems) {
		console.error(`  ${problem}`);
	}
	console.error(
		`\nCopy each signature as pg_get_function_arguments and pg_get_function_result print it (see "Keeping this page current" in docs/api.md).`,
	);
	return 1;
}

process.exitCode = await main();
