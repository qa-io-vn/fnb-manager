import { parseArgs } from "node:util";
import { CompositeNotifier, OutboxNotifier } from "@fnb/notify/outbox";
import { AccountConfigError, ConsoleNotifier } from "@fnb/runner";
import { createRedactor } from "@fnb/sync";
import { commandsUnder, findCommand } from "./commands/index.js";
import { isCi } from "./config/config.js";
import {
	type Environment,
	findRepositoryRoot,
	withEnvFile,
} from "./config/env-file.js";
import { ConfigError } from "./config/errors.js";
import { collectSecrets, maskCommands } from "./config/secrets.js";
import {
	type CommandContext,
	type OptionValues,
	UsageError,
} from "./context.js";
import { commandHelp, generalHelp, groupHelp } from "./help.js";
import { Output, type OutputStreams, processStreams } from "./output.js";
import { Services } from "./services.js";

export interface CliOptions {
	streams?: OutputStreams;
	rootDir?: string;
	now?: () => Date;
	loadEnvFile?: boolean;
}

const EXIT_USAGE = 2;

function stripSeparator(argv: readonly string[]): string[] {
	return argv[0] === "--" ? argv.slice(1) : [...argv];
}

export async function runCli(
	argv: readonly string[],
	environment: Environment,
	options: CliOptions = {},
): Promise<number> {
	const streams = options.streams ?? processStreams;
	const rootDir = options.rootDir ?? findRepositoryRoot();
	const env =
		options.loadEnvFile === false
			? { ...environment }
			: withEnvFile(environment, rootDir);
	const secrets = collectSecrets(env);
	if (env.GITHUB_ACTIONS) {
		for (const command of maskCommands(secrets)) {
			streams.stdout(`${command}\n`);
		}
	}
	const redact = createRedactor(secrets);
	const output = new Output({
		ci: isCi(env),
		streams,
		redact,
		summaryFile: env.GITHUB_STEP_SUMMARY,
	});
	const words = stripSeparator(argv);
	const first = words[0];
	if (
		first === undefined ||
		first === "--help" ||
		first === "-h" ||
		first === "help"
	) {
		const target = first === "help" ? findCommand(words.slice(1)) : undefined;
		output.line(target ? commandHelp(target) : generalHelp());
		return first === undefined ? EXIT_USAGE : 0;
	}
	const command = findCommand(words);
	if (!command) {
		const group = commandsUnder(first);
		if (group.length > 0) {
			output.line(groupHelp(first, group));
			return words.includes("--help") || words.includes("-h") ? 0 : EXIT_USAGE;
		}
		output.error(`unknown command "${first}"; run fnb --help`);
		return EXIT_USAGE;
	}
	const services = new Services(env);
	const context: CommandContext = {
		env,
		rootDir,
		output,
		services,
		redact,
		notifier: new CompositeNotifier([
			new ConsoleNotifier((line) => output.error(line), redact),
			new OutboxNotifier(() => services.db().sql, "cli"),
		]),
		now: options.now ?? (() => new Date()),
	};
	try {
		const { values, positionals } = parseArgs({
			args: words.slice(command.path.length),
			options: command.options,
			allowPositionals: true,
			strict: true,
		});
		if (values.help === true) {
			output.line(commandHelp(command));
			return 0;
		}
		if (positionals.length > 0) {
			throw new UsageError(`unexpected argument "${positionals[0]}"`);
		}
		return await command.run(context, values as OptionValues);
	} catch (error) {
		if (
			error instanceof UsageError ||
			(error instanceof TypeError &&
				"code" in error &&
				String(error.code).startsWith("ERR_PARSE_ARGS"))
		) {
			output.error(`${error.message}\n\n${commandHelp(command)}`);
			return EXIT_USAGE;
		}
		if (error instanceof ConfigError || error instanceof AccountConfigError) {
			output.error(`configuration: ${error.message}`);
			return 1;
		}
		output.error(
			`fnb ${command.path.join(" ")} failed: ${error instanceof Error ? error.message : String(error)}`,
		);
		return 1;
	} finally {
		await services.close();
	}
}
