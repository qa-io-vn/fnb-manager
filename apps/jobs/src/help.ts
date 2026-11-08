import { COMMANDS } from "./commands/index.js";
import type { CommandSpec } from "./commands/spec.js";

export function generalHelp(): string {
	const width = Math.max(
		...COMMANDS.map((command) => command.path.join(" ").length),
	);
	return [
		"fnb — onboarding, POS sync and health checks for FNB Manager",
		"",
		"Usage: fnb <command> [options]",
		"",
		"Commands:",
		...COMMANDS.map(
			(command) =>
				`  ${command.path.join(" ").padEnd(width)}  ${command.summary}`,
		),
		"",
		"Run fnb <command> --help for the options of one command.",
		"Configuration comes from the environment and the repository's .env (see docs/secrets.md and docs/sync.md).",
		"In CI (CI or GITHUB_ACTIONS set) credentials are masked first and output names no shop: stores are numbered, accounts are called by their position in POS_ACCOUNTS_JSON (account 1 is the first entry) and onboarded accounts missing from it other 1, other 2 and so on.",
	].join("\n");
}

export function commandHelp(command: CommandSpec): string {
	return [
		`fnb ${command.path.join(" ")} — ${command.summary}`,
		"",
		`Usage: ${command.usage}`,
		"",
		...command.details.map((line) => `  ${line}`),
	].join("\n");
}

export function groupHelp(
	group: string,
	commands: readonly CommandSpec[],
): string {
	return [
		`fnb ${group} <subcommand>`,
		"",
		...commands.map((command) => `  ${command.usage}`),
	].join("\n");
}
