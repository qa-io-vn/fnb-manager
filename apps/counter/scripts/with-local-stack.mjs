// Runs a command with the local Supabase stack's addresses and keys in its environment (the counter's integration
// and end-to-end tests): `node scripts/with-local-stack.mjs <command> [args…]`. It asks `supabase status` of the local
// containers (never the cloud project, never the repository's .env) and refuses anything that is not a loopback stack.
import { execFileSync, spawn } from "node:child_process";

const LOOPBACK =
	/^(http|postgresql):\/\/([^@/]*@)?(127\.0\.0\.1|localhost):\d+/;
const PNPM = process.platform === "win32" ? "npx.cmd" : "npx";

function status() {
	const output = execFileSync(
		PNPM,
		["-y", "pnpm@9.15.3", "exec", "supabase", "status", "-o", "env"],
		{
			encoding: "utf8",
			env: {
				...process.env,
				SUPABASE_PROJECT_ID: process.env.SUPABASE_PROJECT_ID ?? "FNB_Managment",
			},
			stdio: ["ignore", "pipe", "ignore"],
			shell: process.platform === "win32",
		},
	);
	const values = {};
	for (const line of output.split(/\r?\n/)) {
		const match = /^([A-Z_]+)="?(.*?)"?$/.exec(line.trim());
		if (match) values[match[1]] = match[2];
	}
	return values;
}

const [command, ...args] = process.argv.slice(2);
if (command === undefined) {
	console.error("usage: node scripts/with-local-stack.mjs <command> [args…]");
	process.exit(2);
}
const stack = status();
for (const name of ["API_URL", "DB_URL"]) {
	if (!LOOPBACK.test(stack[name] ?? "")) {
		console.error(
			`the local stack's ${name} is not a loopback address; refusing to run`,
		);
		process.exit(2);
	}
}
const child = spawn(command, args, {
	stdio: "inherit",
	shell: process.platform === "win32",
	env: {
		...process.env,
		COUNTER_LOCAL_STACK: "1",
		SUPABASE_URL: stack.API_URL,
		COUNTER_DATABASE_URL: stack.DB_URL,
		SUPABASE_SECRET_KEY: stack.SECRET_KEY ?? stack.SERVICE_ROLE_KEY,
		SUPABASE_PUBLISHABLE_KEY: stack.PUBLISHABLE_KEY ?? stack.ANON_KEY,
	},
});
child.on("exit", (code) => process.exit(code ?? 1));
