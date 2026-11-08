import { doctorCommand } from "./doctor.js";
import { maskCommand } from "./mask.js";
import { onboardCommand } from "./onboard.js";
import type { CommandSpec } from "./spec.js";
import { statusCommand } from "./status.js";
import { syncCommands } from "./sync.js";
import { tenantCommands } from "./tenant.js";

export const COMMANDS: readonly CommandSpec[] = [
	...tenantCommands,
	onboardCommand,
	...syncCommands,
	statusCommand,
	doctorCommand,
	maskCommand,
];

export function findCommand(words: readonly string[]): CommandSpec | undefined {
	return [...COMMANDS]
		.sort((left, right) => right.path.length - left.path.length)
		.find((command) =>
			command.path.every((part, index) => words[index] === part),
		);
}

export function commandsUnder(prefix: string): CommandSpec[] {
	return COMMANDS.filter((command) => command.path[0] === prefix);
}
