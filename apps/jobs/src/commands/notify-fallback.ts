import type { Sql } from "postgres";
import { requireTenant } from "../admin/tenants.js";
import { isCi } from "../config/config.js";
import type { Environment } from "../config/env-file.js";
import { ConfigError } from "../config/errors.js";
import {
	type CommandContext,
	type OptionValues,
	requiredString,
	UsageError,
} from "../context.js";
import { destinationLabel, integerOption } from "./notify.js";
import { type CommandSpec, HELP_OPTION } from "./spec.js";

export const FALLBACK_KINDS = ["zalo_bot", "telegram", "email"] as const;

export interface FallbackSource {
	readonly number: number;
	readonly kind: string;
	readonly provider: string;
	readonly status: string;
	readonly address: string | null;
	readonly config: Readonly<Record<string, unknown>>;
	readonly memberEmail: string | null;
}

export type FallbackEntry =
	| { readonly kind: "zalo_bot" | "telegram"; readonly chat_id: string }
	| {
			readonly kind: "email";
			readonly provider: string;
			readonly from: string;
			readonly from_name: string;
			readonly to: string;
	  };

function configText(
	config: Readonly<Record<string, unknown>>,
	key: string,
): string | undefined {
	const value = config[key];
	return typeof value === "string" && value.trim() !== ""
		? value.trim()
		: undefined;
}

export function fallbackEntry(
	source: FallbackSource,
	environment: Environment,
): FallbackEntry {
	const label = destinationLabel(source);
	if (source.kind === "zalo_bot" || source.kind === "telegram") {
		if (source.address === null || source.address.trim() === "") {
			throw new UsageError(
				`${label} has no linked chat yet; finish fnb notify link first`,
			);
		}
		return { kind: source.kind, chat_id: source.address };
	}
	if (source.kind === "email") {
		const to = source.address ?? source.memberEmail;
		if (to === null || to.trim() === "") {
			throw new UsageError(`${label} has no recipient address`);
		}
		const from =
			configText(source.config, "from_email") ??
			environment.NOTIFY_EMAIL_FROM?.trim() ??
			"";
		if (from === "") {
			throw new ConfigError(
				"no sender: set NOTIFY_EMAIL_FROM (the verified sender address) or link the destination with --from-email",
			);
		}
		return {
			kind: "email",
			provider: source.provider,
			from,
			from_name:
				configText(source.config, "from_name") ??
				environment.NOTIFY_EMAIL_FROM_NAME?.trim() ??
				"",
			to: to.trim(),
		};
	}
	throw new UsageError(
		`${label} cannot be a fallback target; use a Zalo Bot, Telegram or e-mail destination`,
	);
}

async function numberedDestination(
	sql: Sql,
	tenantId: string,
	number: number,
): Promise<FallbackSource | null> {
	const [row] = await sql<
		{
			number: string;
			kind: string;
			provider: string;
			status: string;
			address: string | null;
			config: unknown;
			member_email: string | null;
		}[]
	>`
		select n.number::text as number, n.kind, n.provider, n.status, n.address, n.config, u.email::text as member_email
		from (
			select
				row_number() over (order by c.created_at, c.id) as number,
				c.kind::text as kind,
				c.provider,
				c.status,
				c.address,
				c.config,
				c.user_id
			from public.notification_channels c
			where c.tenant_id = ${tenantId}::uuid
		) n
		left join auth.users u on u.id = n.user_id
		where n.number = ${number}::bigint
	`;
	if (!row) {
		return null;
	}
	const config =
		row.config !== null &&
		typeof row.config === "object" &&
		!Array.isArray(row.config)
			? (row.config as Record<string, unknown>)
			: {};
	return {
		number: Number(row.number),
		kind: row.kind,
		provider: row.provider,
		status: row.status,
		address: row.address,
		config,
		memberEmail: row.member_email,
	};
}

async function printFallbackEntry(
	context: CommandContext,
	values: OptionValues,
): Promise<number> {
	if (isCi(context.env)) {
		throw new UsageError(
			"fnb notify fallback-entry is refused in CI: it prints a chat id or an e-mail address",
		);
	}
	const slug = requiredString(values, "tenant");
	requiredString(values, "destination");
	const number = integerOption(values, "destination", 1, 1, 10_000);
	const { sql } = context.services.db();
	const tenant = await requireTenant(sql, slug, context.output.ci);
	const source = await numberedDestination(sql, tenant.id, number);
	if (source === null) {
		throw new UsageError(
			`the tenant has no destination ${number}; fnb notify status lists them`,
		);
	}
	const entry = fallbackEntry(source, context.env);
	if (source.status !== "active") {
		context.output.error(
			`${destinationLabel(source)} is ${source.status}; the entry works, but check the destination with fnb notify status`,
		);
	}
	context.output.raw(JSON.stringify([entry]));
	context.output.error(
		"Add this entry to the JSON array of the GitHub secret NOTIFY_FALLBACK_TARGETS (docs/secrets.md); keep its token in NOTIFY_ZALO_BOT_TOKEN, NOTIFY_TELEGRAM_BOT_TOKEN or NOTIFY_EMAIL_API_KEY.",
	);
	return 0;
}

export const notifyFallbackEntryCommand: CommandSpec = {
	path: ["notify", "fallback-entry"],
	summary:
		"Print one destination as an entry of NOTIFY_FALLBACK_TARGETS, the database-free failure alert list",
	usage: "fnb notify fallback-entry --tenant <slug> --destination <n>",
	options: {
		...HELP_OPTION,
		tenant: { type: "string" },
		destination: { type: "string" },
	},
	details: [
		"Prints a JSON array with one entry for destination n (numbered as fnb notify status shows them): a Zalo Bot or Telegram chat as {kind, chat_id}; an e-mail destination as {kind: email, provider, from, from_name, to}, with the sender from the destination or NOTIFY_EMAIL_FROM and NOTIFY_EMAIL_FROM_NAME and the member's login e-mail as the recipient.",
		"Paste the entry into the GitHub secret NOTIFY_FALLBACK_TARGETS. When the database cannot be reached, notify-on-failure.yml runs scripts/notify-fallback.mjs, which sends one fixed message to each entry with the tokens NOTIFY_ZALO_BOT_TOKEN, NOTIFY_TELEGRAM_BOT_TOKEN and NOTIFY_EMAIL_API_KEY. The e-mail destination is the better fallback.",
		"A webhook is not a fallback target. Refused in CI, because the entry holds a chat id or an e-mail address.",
	],
	run: printFallbackEntry,
};
