import { bootstrapCommand } from "./bootstrap.js";
import { datapackCommand } from "./datapack.js";
import { digestCommand } from "./digest.js";
import { doctorCommand } from "./doctor.js";
import { iposSnapshotCommands } from "./ipos-snapshot.js";
import { loyaltyCommands } from "./loyalty.js";
import { loyaltySaleCommand } from "./loyalty-sale.js";
import { maskCommand } from "./mask.js";
import { notifyCommands } from "./notify.js";
import { notifyJobFailedCommand } from "./notify-job.js";
import { notifyLinkCommand, notifyUnlinkCommand } from "./notify-link.js";
import { onboardCommand } from "./onboard.js";
import { photosPruneCommand } from "./photos.js";
import { publishPlanCommand } from "./publish-plan.js";
import type { CommandSpec } from "./spec.js";
import { statusCommand } from "./status.js";
import { syncCommands } from "./sync.js";
import { tenantCommands } from "./tenant.js";
import { zaloCommands } from "./zalo.js";

export const COMMANDS: readonly CommandSpec[] = [
	...tenantCommands,
	onboardCommand,
	...syncCommands,
	bootstrapCommand,
	...iposSnapshotCommands,
	statusCommand,
	doctorCommand,
	maskCommand,
	digestCommand,
	...notifyCommands,
	notifyLinkCommand,
	notifyUnlinkCommand,
	notifyJobFailedCommand,
	datapackCommand,
	publishPlanCommand,
	...zaloCommands,
	photosPruneCommand,
	...loyaltyCommands,
	loyaltySaleCommand,
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
