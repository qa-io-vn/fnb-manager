import { collectSecrets } from "../config/secrets.js";
import type { CommandContext } from "../context.js";
import { type CommandSpec, HELP_OPTION } from "./spec.js";

async function maskCredentials(context: CommandContext): Promise<number> {
	const count = collectSecrets(context.env).length;
	context.output.line(
		context.env.GITHUB_ACTIONS
			? `masked ${count} credential value(s) for the rest of the job`
			: "not running on GitHub Actions; nothing to mask",
	);
	return 0;
}

export const maskCommand: CommandSpec = {
	path: ["mask-credentials"],
	summary: "Register every credential with the GitHub Actions log masker",
	usage: "fnb mask-credentials",
	options: { ...HELP_OPTION },
	details: [
		"Every fnb run on GitHub Actions starts by printing ::add-mask:: for the key, password, appAccessToken and email of each POS_ACCOUNTS_JSON entry, IPOS_APP_KEY, the Supabase secret key and the user and password inside the database URL, encoded the way the runner decodes workflow commands.",
		"It also masks every NOTIFY_* credential present (bot tokens, the e-mail API key and sender address, the webhook signing secret) and every string field of each NOTIFY_FALLBACK_TARGETS entry (chat ids and addresses).",
		"This command does only that, so a workflow can mask the fields as its first step.",
	],
	run: maskCredentials,
};
