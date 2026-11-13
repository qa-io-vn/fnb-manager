import { createInterface } from "node:readline";
import { assertTimezone } from "@fnb/core";
import {
	type ChannelKind,
	CLI_CYCLE_LIMITS,
	createAdapterRegistry,
	createCycleBudget,
	DEFAULT_SECRET_NAMES,
	dispatchDue,
	emptyCycleReport,
	isSecretNameValid,
	message,
	NOTICE_VERSION,
	pollBot,
	providerBaseUrl,
	REQUEST_TIMEOUT_MS,
	realSleep,
	renderHandover,
	renderLinkCodeEmail,
	renderNotice,
	resolveSecret,
	TEMPLATE_REFS,
	USER_AGENT,
} from "@fnb/notify";
import {
	destinationState,
	enqueueMessage,
	findMemberByEmail,
	issueLinkCode,
	kickNotify,
	listDestinations,
	messageOutcomes,
	prepareBotDestination,
	saveBotName,
	storeIdsByExternalId,
} from "@fnb/notify/postgres";
import { requireTenant } from "../admin/tenants.js";
import { isCi } from "../config/config.js";
import { ConfigError } from "../config/errors.js";
import {
	type CommandContext,
	flag,
	type OptionValues,
	requiredString,
	stringList,
	stringOption,
	UsageError,
} from "../context.js";
import {
	cliWorker,
	destinationLabel,
	integerOption,
	notifyRepository,
	requireFixtureTenantForTestSends,
} from "./notify.js";
import { type CommandSpec, HELP_OPTION } from "./spec.js";

const LINK_KINDS = ["zalo_bot", "telegram", "email", "webhook"] as const;
type LinkKind = (typeof LINK_KINDS)[number];
const DEFAULT_WAIT_SECONDS = 600;
const MAX_WAIT_SECONDS = 3600;
const POLL_INTERVAL_MS = 2000;
const POLL_WAIT_SECONDS = 1;
const LABEL_MAX_CHARACTERS = 60;
const DEFAULT_LABELS: Readonly<Record<LinkKind, string>> = {
	zalo_bot: "Zalo Bot",
	telegram: "Telegram",
	email: "E-mail",
	webhook: "Webhook",
};
const KIND_ONLY_OPTIONS: Readonly<Record<string, LinkKind>> = {
	provider: "email",
	"from-email": "email",
	"from-name": "email",
	url: "webhook",
};

function linkKind(values: OptionValues): LinkKind {
	const kind = requiredString(values, "kind");
	if (!(LINK_KINDS as readonly string[]).includes(kind)) {
		throw new UsageError(`--kind must be one of ${LINK_KINDS.join(", ")}`);
	}
	return kind as LinkKind;
}

function checkKindOptions(values: OptionValues, kind: LinkKind): void {
	for (const [option, owner] of Object.entries(KIND_ONLY_OPTIONS)) {
		if (values[option] !== undefined && owner !== kind) {
			throw new UsageError(`--${option} applies to --kind ${owner}`);
		}
	}
}

interface LinkSetup {
	kind: ChannelKind;
	secretName: string;
	secret: string;
	label: string;
	timezone: string | null;
	wait: number;
	email: string;
}

function linkSetup(
	context: CommandContext,
	values: OptionValues,
	kind: LinkKind,
): LinkSetup {
	const secretName =
		stringOption(values, "secret") ?? DEFAULT_SECRET_NAMES[kind];
	if (!isSecretNameValid(kind, secretName)) {
		throw new UsageError(
			`--secret must be ${DEFAULT_SECRET_NAMES[kind]} or ${DEFAULT_SECRET_NAMES[kind]}_<SUFFIX> for --kind ${kind}`,
		);
	}
	const label = (stringOption(values, "label") ?? DEFAULT_LABELS[kind]).trim();
	if (label.length < 1 || label.length > LABEL_MAX_CHARACTERS) {
		throw new UsageError(
			`--label must be 1 to ${LABEL_MAX_CHARACTERS} characters`,
		);
	}
	const timezone = stringOption(values, "timezone") ?? null;
	if (timezone !== null) {
		try {
			assertTimezone(timezone);
		} catch {
			throw new UsageError(`--timezone "${timezone}" is not an IANA time zone`);
		}
	}
	const email = requiredString(values, "member").trim();
	if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
		throw new UsageError("--member must be the member's login e-mail");
	}
	const secret = resolveSecret(kind, secretName, context.env);
	if (secret === null) {
		throw new ConfigError(
			`${secretName} is not set here; add ${kind === "email" ? "the e-mail API key" : "the bot token"} to .env (docs/secrets.md)`,
		);
	}
	return {
		kind,
		secretName,
		secret,
		label,
		timezone,
		wait: integerOption(
			values,
			"wait",
			DEFAULT_WAIT_SECONDS,
			0,
			MAX_WAIT_SECONDS,
		),
		email,
	};
}

async function linkBot(
	context: CommandContext,
	values: OptionValues,
	kind: LinkKind,
): Promise<number> {
	const setup = linkSetup(context, values, kind);
	const adapters = createAdapterRegistry();
	const adapter = Object.values(adapters).find(
		(candidate) =>
			candidate.kind === setup.kind &&
			candidate.available &&
			candidate.pollUpdates !== undefined,
	);
	if (!adapter?.checkCredentials) {
		throw new UsageError(
			`--kind ${kind}: the ${kind} adapter is not built yet; zalo_bot is available`,
		);
	}
	const { sql } = context.services.db();
	const tenant = await requireTenant(
		sql,
		requiredString(values, "tenant"),
		context.output.ci,
	);
	const member = await findMemberByEmail(sql, tenant.id, setup.email);
	if (!member) {
		throw new Error(
			"no member of the tenant has that login e-mail; add them with fnb tenant add-member",
		);
	}
	if (member.role === "publisher") {
		throw new UsageError("a publisher login cannot receive digests or alerts");
	}
	const externalIds = stringList(values, "store");
	let storeIds: string[] | null = null;
	if (externalIds.length > 0) {
		const found = await storeIdsByExternalId(sql, tenant.id, externalIds);
		const missing = externalIds.filter((id) => !found.has(id));
		if (missing.length > 0) {
			throw new UsageError(
				`no store with external id ${missing.join(", ")} in the tenant`,
			);
		}
		storeIds = externalIds.map((id) => found.get(id) ?? "");
	}
	const sendContext = {
		secret: setup.secret,
		fetch: (input: string, init: RequestInit) => fetch(input, init),
		baseUrl: providerBaseUrl(adapter.provider, context.env),
		timeoutMs: REQUEST_TIMEOUT_MS,
		userAgent: USER_AGENT,
		now: context.now,
	};
	const credentials = await adapter.checkCredentials(sendContext);
	if (!credentials.ok) {
		context.output.error(
			`the bot refused ${setup.secretName} (${credentials.code ?? "unknown"}); check the token`,
		);
		return 1;
	}
	await saveBotName(sql, setup.secretName, setup.kind, credentials.botName);
	const botName = credentials.botName ?? "bot";
	const noticeFacts = {
		tenantName: tenant.name,
		channelKind: setup.kind,
		provider: adapter.provider,
	};
	context.output.line(`Thông báo cho người nhận (${NOTICE_VERSION}):`);
	context.output.line(renderNotice(noticeFacts));
	context.output.line("");
	const prepared = await prepareBotDestination(sql, {
		tenantId: tenant.id,
		userId: member.userId,
		kind: setup.kind,
		provider: adapter.provider,
		label: setup.label,
		secretName: setup.secretName,
		timezone: setup.timezone,
		storeIds,
	});
	const numbered = (await listDestinations(sql, tenant.id)).find(
		(destination) => destination.id === prepared.channelId,
	);
	const label = destinationLabel({
		number: numbered?.number ?? 0,
		kind: setup.kind,
	});
	if (
		prepared.previousStatus !== null &&
		prepared.previousStatus !== "pending"
	) {
		context.output.line(
			`${label} was ${prepared.previousStatus}; it stays pending until the member accepts again`,
		);
	}
	const code = await issueLinkCode(
		sql,
		prepared.channelId,
		"bot_link",
		context.now(),
	);
	context.output.line(renderHandover({ ...noticeFacts, code, botName }));
	context.output.line("");
	context.output.line(message("link.instruction", { code, bot: botName }));
	context.output.line(message("link.retry"));
	if (setup.wait === 0) {
		await kickNotify(sql, "kick");
		context.output.line(
			`${label}: waiting for the code; the notify function or the next fnb notify tick keeps polling`,
		);
		return 0;
	}
	const repository = notifyRepository(context, sql, false);
	const worker = cliWorker();
	const deadline = performance.now() + setup.wait * 1000;
	let announcedNotice = false;
	let lastError: string | null = null;
	try {
		while (performance.now() < deadline) {
			const started = performance.now();
			const round = await pollBot({
				repository,
				adapter,
				kind: setup.kind,
				secretName: setup.secretName,
				secret: setup.secret,
				baseUrl: sendContext.baseUrl,
				worker,
				clock: context.now,
				fetch: sendContext.fetch,
				waitSeconds: POLL_WAIT_SECONDS,
				release: false,
			});
			if (round.outcome === "error" && round.code !== lastError) {
				context.output.error(
					`link polling: the bot answered ${round.code ?? "an error"}; retrying`,
				);
			}
			lastError = round.outcome === "error" ? round.code : null;
			await dispatchDue(
				{
					repository,
					adapters,
					environment: context.env,
					runtime: "cli",
					worker,
					tenantId: tenant.id,
					clock: context.now,
					fetch: sendContext.fetch,
					log: (line) => context.output.error(line),
					budget: createCycleBudget({
						...CLI_CYCLE_LIMITS,
						linkPollSeconds: 0,
						maxSends: 10,
					}),
					runSqlTick: false,
					dryRun: false,
				},
				emptyCycleReport(),
			);
			const state = await destinationState(sql, prepared.channelId);
			if (state?.status === "active") {
				context.output.line(
					`${label}: linked, chat ${state.addressHint ?? "…"}`,
				);
				if (flag(values, "print-fallback-entry") && state.address !== null) {
					context.output.line(
						JSON.stringify([{ kind: setup.kind, chat_id: state.address }]),
					);
				}
				return 0;
			}
			if (state?.hasAddress && !announcedNotice) {
				announcedNotice = true;
				context.output.line(
					`${label}: code received; the notice was sent to the chat, waiting for the member to reply ĐỒNG Ý`,
				);
			}
			const rest = POLL_INTERVAL_MS - (performance.now() - started);
			if (rest > 0) {
				await realSleep(rest);
			}
		}
	} finally {
		await repository.releasePollLease(setup.secretName, worker);
	}
	await kickNotify(sql, "kick");
	const state = await destinationState(sql, prepared.channelId);
	context.output.line(
		`${label}: ${state?.hasAddress ? "waiting for the member's acceptance" : "waiting for the code"}; the notify function or the next fnb notify tick keeps polling (code valid 15 minutes, acceptance 24 hours)`,
	);
	return 0;
}

const EMAIL_PROVIDERS = ["brevo", "resend"] as const;
const BUILT_EMAIL_PROVIDERS: readonly string[] = ["brevo"];
const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const EMAIL_CODE_ATTEMPTS = 5;
const LINK_CODE_LIFETIME_MS = 15 * 60_000;
const SENDER_NAME_MAX_CHARACTERS = 80;

export function emailHint(address: string): string {
	const [local = "", domain = ""] = address.trim().split("@");
	return `${local.slice(0, 1)}…@${domain}`.slice(0, 40);
}

export function emailSenderConfig(
	values: OptionValues,
	environment: Readonly<Record<string, string | undefined>>,
): Record<string, string> {
	const fromEmail = stringOption(values, "from-email")?.trim();
	const fromName = stringOption(values, "from-name")?.trim();
	if (fromEmail !== undefined && !EMAIL_PATTERN.test(fromEmail)) {
		throw new UsageError("--from-email must be an e-mail address");
	}
	if (
		fromName !== undefined &&
		(fromName.length < 1 || fromName.length > SENDER_NAME_MAX_CHARACTERS)
	) {
		throw new UsageError(
			`--from-name must be 1 to ${SENDER_NAME_MAX_CHARACTERS} characters`,
		);
	}
	if (fromEmail === undefined && !environment.NOTIFY_EMAIL_FROM?.trim()) {
		throw new ConfigError(
			"no sender: set NOTIFY_EMAIL_FROM (the verified sender address) or pass --from-email",
		);
	}
	return {
		...(fromEmail === undefined ? {} : { from_email: fromEmail }),
		...(fromName === undefined ? {} : { from_name: fromName }),
	};
}

async function promptCodes(
	question: string,
	attempts: number,
	check: (code: string) => Promise<boolean>,
): Promise<boolean> {
	const reader = createInterface({ input: process.stdin, terminal: false });
	try {
		let left = attempts;
		process.stdout.write(question);
		for await (const line of reader) {
			const code = line.trim();
			if (code === "") {
				process.stdout.write(question);
				continue;
			}
			if (await check(code)) {
				return true;
			}
			left -= 1;
			if (left <= 0) {
				return false;
			}
			process.stdout.write(`Mã chưa đúng, còn ${left} lần thử. ${question}`);
		}
		return false;
	} finally {
		reader.close();
	}
}

async function linkEmail(
	context: CommandContext,
	values: OptionValues,
): Promise<number> {
	const provider = stringOption(values, "provider") ?? "brevo";
	if (!(EMAIL_PROVIDERS as readonly string[]).includes(provider)) {
		throw new UsageError(
			`--provider must be one of ${EMAIL_PROVIDERS.join(", ")}`,
		);
	}
	if (!BUILT_EMAIL_PROVIDERS.includes(provider)) {
		throw new UsageError(
			`--provider ${provider}: the ${provider} adapter is not built yet; brevo is available`,
		);
	}
	const setup = linkSetup(context, values, "email");
	const config = emailSenderConfig(values, context.env);
	const { sql } = context.services.db();
	const tenant = await requireTenant(
		sql,
		requiredString(values, "tenant"),
		context.output.ci,
	);
	const member = await findMemberByEmail(sql, tenant.id, setup.email);
	if (!member) {
		throw new Error(
			"no member of the tenant has that login e-mail; add them with fnb tenant add-member",
		);
	}
	if (member.role === "publisher") {
		throw new UsageError("a publisher login cannot receive digests or alerts");
	}
	const storeIds = await narrowedStores(context, values, tenant.id);
	const noticeFacts = {
		tenantName: tenant.name,
		channelKind: "email" as const,
		provider: "brevo" as const,
	};
	context.output.line(`Thông báo cho người nhận (${NOTICE_VERSION}):`);
	context.output.line(renderNotice(noticeFacts));
	context.output.line("");
	const prepared = await prepareBotDestination(sql, {
		tenantId: tenant.id,
		userId: member.userId,
		kind: "email",
		provider: "brevo",
		label: setup.label,
		secretName: setup.secretName,
		timezone: setup.timezone,
		storeIds,
		config,
		addressHint: emailHint(setup.email),
	});
	const numbered = (await listDestinations(sql, tenant.id)).find(
		(destination) => destination.id === prepared.channelId,
	);
	const label = destinationLabel({
		number: numbered?.number ?? 0,
		kind: "email",
	});
	const at = context.now();
	const code = await issueLinkCode(
		sql,
		prepared.channelId,
		"email_confirm",
		at,
	);
	const rendered = renderLinkCodeEmail({ ...noticeFacts, code });
	const messageId = await enqueueMessage(sql, {
		tenantId: tenant.id,
		channelId: prepared.channelId,
		kind: "link_code",
		templateRef: TEMPLATE_REFS.link_code,
		dedupeKey: `link_code:${prepared.channelId}:${at.getTime()}`,
		title: rendered.title,
		body: rendered.text,
		expiresAt: new Date(at.getTime() + LINK_CODE_LIFETIME_MS),
		at,
	});
	await dispatchDue(
		{
			repository: notifyRepository(context, sql, false),
			adapters: createAdapterRegistry(),
			environment: context.env,
			runtime: "cli",
			worker: cliWorker(),
			tenantId: tenant.id,
			clock: context.now,
			fetch: (input, init) => fetch(input, init),
			log: (line) => context.output.error(line),
			budget: createCycleBudget({
				...CLI_CYCLE_LIMITS,
				linkPollSeconds: 0,
				maxSends: 5,
			}),
			runSqlTick: false,
			dryRun: false,
		},
		emptyCycleReport(),
	);
	const [outcome] = await messageOutcomes(sql, [messageId]);
	if (outcome?.status !== "sent") {
		context.output.error(
			`${label}: the code e-mail was not sent (${outcome?.lastErrorCode ?? outcome?.decision ?? outcome?.status ?? "unknown"}); check ${setup.secretName} and the sender, then run the command again`,
		);
		return 1;
	}
	context.output.line(
		`${label}: the notice and a 6-digit code were e-mailed to the member's login address; the member reads the notice and, if they agree, tells you the code.`,
	);
	const confirmed = await promptCodes(
		"Nhập mã xác nhận (6 chữ số): ",
		EMAIL_CODE_ATTEMPTS,
		async (entered) => {
			const [row] = await sql<{ ok: boolean | null }[]>`
				select app.confirm_email_link(${prepared.channelId}::uuid, ${entered}::text, ${context.now()}::timestamptz) as ok
			`;
			return row?.ok === true;
		},
	);
	const state = await destinationState(sql, prepared.channelId);
	if (confirmed && state?.status === "active") {
		context.output.line(`${label}: linked, ${state.addressHint ?? "…"}`);
		if (flag(values, "print-fallback-entry")) {
			context.output.line(
				JSON.stringify([
					{
						kind: "email",
						provider,
						from: config.from_email ?? context.env.NOTIFY_EMAIL_FROM ?? "",
						from_name:
							config.from_name ?? context.env.NOTIFY_EMAIL_FROM_NAME ?? "",
						to: setup.email,
					},
				]),
			);
		}
		return 0;
	}
	context.output.error(
		`${label}: not linked; ${state === null ? "five wrong codes removed the pending destination" : "no valid code was entered"}. Run fnb notify link again for a new code.`,
	);
	return 1;
}

async function narrowedStores(
	context: CommandContext,
	values: OptionValues,
	tenantId: string,
): Promise<string[] | null> {
	const externalIds = stringList(values, "store");
	if (externalIds.length === 0) {
		return null;
	}
	const { sql } = context.services.db();
	const found = await storeIdsByExternalId(sql, tenantId, externalIds);
	const missing = externalIds.filter((id) => !found.has(id));
	if (missing.length > 0) {
		throw new UsageError(
			`no store with external id ${missing.join(", ")} in the tenant`,
		);
	}
	return externalIds.map((id) => found.get(id) ?? "");
}

async function link(
	context: CommandContext,
	values: OptionValues,
): Promise<number> {
	if (isCi(context.env)) {
		throw new UsageError(
			"fnb notify link is refused in CI: it prints a link code and the notice for a member",
		);
	}
	requireFixtureTenantForTestSends(
		context,
		requiredString(values, "tenant"),
		false,
	);
	const kind = linkKind(values);
	checkKindOptions(values, kind);
	if (kind === "webhook") {
		throw new UsageError(
			`--kind ${kind}: the ${kind} adapter is not built yet; zalo_bot and email are available`,
		);
	}
	if (kind === "email") {
		return linkEmail(context, values);
	}
	return linkBot(context, values, kind);
}

interface UnlinkCounts {
	readonly destinations: number;
	readonly cancelled: number;
}

async function openMessageCount(
	context: CommandContext,
	channelIds: readonly string[],
): Promise<number> {
	const { sql } = context.services.db();
	const [row] = await sql<{ count: string }[]>`
		select count(*)::text as count
		from public.outbound_messages
		where channel_id in (select jsonb_array_elements_text(${JSON.stringify([...channelIds])}::text::jsonb)::uuid)
			and status in ('queued', 'held')
	`;
	return Number(row?.count ?? 0);
}

async function removeDestination(
	context: CommandContext,
	tenantId: string,
	number: number,
): Promise<UnlinkCounts & { kind: string }> {
	const { sql } = context.services.db();
	const destination = (await listDestinations(sql, tenantId)).find(
		(entry) => entry.number === number,
	);
	if (!destination) {
		throw new UsageError(
			`the tenant has no destination ${number}; fnb notify status lists them`,
		);
	}
	const cancelled = await openMessageCount(context, [destination.id]);
	await sql`
		delete from public.notification_channels
		where id = ${destination.id}::uuid and tenant_id = ${tenantId}::uuid
	`;
	return { destinations: 1, cancelled, kind: destination.kind };
}

async function withdrawMember(
	context: CommandContext,
	tenantId: string,
	email: string,
): Promise<UnlinkCounts> {
	const { sql } = context.services.db();
	const member = await findMemberByEmail(sql, tenantId, email);
	if (!member) {
		throw new Error(
			"no member of the tenant has that login e-mail; fnb tenant members lists them",
		);
	}
	const destinations = (await listDestinations(sql, tenantId)).filter(
		(entry) => entry.userId === member.userId,
	);
	const [row] = await sql<{ cancelled: number | null }[]>`
		select app.withdraw_notifications(${tenantId}::uuid, ${member.userId}::uuid, ${context.now()}::timestamptz)::integer as cancelled
	`;
	return {
		destinations: destinations.length,
		cancelled: Number(row?.cancelled ?? 0),
	};
}

async function unlink(
	context: CommandContext,
	values: OptionValues,
): Promise<number> {
	const slug = requiredString(values, "tenant");
	const chosen = stringOption(values, "destination");
	const email = stringOption(values, "member");
	const all = flag(values, "all");
	if ((chosen === undefined) === (email === undefined)) {
		throw new UsageError(
			"give either --destination <n> or --member <login e-mail> --all",
		);
	}
	if (email !== undefined && !all) {
		throw new UsageError(
			"--member withdraws the member's consent and disables every destination of theirs; add --all to confirm",
		);
	}
	if (chosen !== undefined && all) {
		throw new UsageError("--all applies to --member");
	}
	const { sql } = context.services.db();
	const tenant = await requireTenant(sql, slug, context.output.ci);
	if (chosen !== undefined) {
		const number = integerOption(values, "destination", 1, 1, 10_000);
		const removed = await removeDestination(context, tenant.id, number);
		context.output.line(
			`${destinationLabel({ number, kind: removed.kind })}: removed, ${removed.cancelled} waiting message(s) cancelled; the member's consent is unchanged`,
		);
		return 0;
	}
	const withdrawn = await withdrawMember(context, tenant.id, email ?? "");
	context.output.line(
		`${context.output.ci ? "member 1" : "member"}: notifications consent withdrawn, ${withdrawn.destinations} destination(s) disabled or removed, ${withdrawn.cancelled} waiting message(s) cancelled`,
	);
	return 0;
}

export const notifyUnlinkCommand: CommandSpec = {
	path: ["notify", "unlink"],
	summary:
		"Remove one destination, or withdraw a member's consent and stop all their notifications",
	usage:
		"fnb notify unlink --tenant <slug> (--destination <n> | --member <login e-mail> --all)",
	options: {
		...HELP_OPTION,
		tenant: { type: "string" },
		destination: { type: "string" },
		member: { type: "string" },
		all: { type: "boolean" },
	},
	details: [
		"--destination n (numbered as fnb notify status shows them) removes that destination and cancels its waiting messages; it is a channel preference, so the member's notifications consent stays.",
		"--member <login e-mail> --all withdraws the member's notifications consent (the ledger row is revoked, never deleted), disables every destination of theirs (a destination still waiting for its link is removed) and cancels their waiting messages, in one transaction. The next claim honours it.",
		"Output names no member or address: the member is 'member 1' in CI.",
	],
	run: unlink,
};

export const notifyLinkCommand: CommandSpec = {
	path: ["notify", "link"],
	summary:
		"Link a member's Zalo Bot chat or login e-mail (Telegram and webhook follow) for digests and alerts",
	usage:
		"fnb notify link --tenant <slug> --kind zalo_bot|telegram|email|webhook [--member <login e-mail>] [--label <text>] [--secret <NOTIFY_NAME>] [--provider brevo|resend] [--from-email <address> --from-name <text>] [--url https://…] [--timezone <IANA>] [--store <external id>]… [--wait <seconds, default 600>] [--print-fallback-entry]",
	options: {
		...HELP_OPTION,
		tenant: { type: "string" },
		kind: { type: "string" },
		member: { type: "string" },
		label: { type: "string" },
		secret: { type: "string" },
		provider: { type: "string" },
		"from-email": { type: "string" },
		"from-name": { type: "string" },
		url: { type: "string" },
		timezone: { type: "string" },
		store: { type: "string", multiple: true },
		wait: { type: "string" },
		"print-fallback-entry": { type: "boolean" },
	},
	details: [
		"Prints the notice (ops-notifications-v1) and a hand-over block for the member, checks the bot token with getMe, creates or reuses the member's pending destination and a one-time code FNB-XXXXXXXX valid 15 minutes.",
		"The member sends the code to the bot from their own chat, reads the notice the bot sends back and replies ĐỒNG Ý; only then does the destination turn active and their notifications consent get recorded.",
		"While --wait lasts (default 600 s) the command polls the bot every 2 s under the bot's polling lease; afterwards the notify function or the next fnb notify tick keeps polling.",
		"--secret is the only way to use a token other than NOTIFY_ZALO_BOT_TOKEN (a suffix such as NOTIFY_ZALO_BOT_TOKEN_2). --store narrows the member's digest to some stores; --timezone sets the reader's zone for quiet hours.",
		"Running it again for a linked member re-links: the destination is pending until the member accepts again.",
		"--kind email (provider brevo) e-mails the notice and a 6-digit code to the member's login address and asks for the code here; the member reads the notice and, if they agree, hands the code over, which records their consent. Five wrong codes remove the pending destination. The sender is --from-email/--from-name or NOTIFY_EMAIL_FROM and NOTIFY_EMAIL_FROM_NAME.",
		"Refused in CI. Telegram, Resend and webhook destinations arrive with their adapters in a later step.",
	],
	run: link,
};
