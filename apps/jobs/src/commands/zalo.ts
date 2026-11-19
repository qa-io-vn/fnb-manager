import { readFileSync } from "node:fs";
import { findAuthUserId, requireTenant } from "../admin/tenants.js";
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
	assertPrivateOutput,
	PathRefusedError,
	resolveUserPath,
} from "../datapack/files.js";
import { type CommandSpec, HELP_OPTION } from "./spec.js";
import { EMAIL_PATTERN, tenantName } from "./tenant.js";
import {
	BRAND_KEY_PATTERN,
	type BrandConfig,
	configFromFlags,
	OA_TIERS,
	parseBrandFile,
	showLines,
	WEBHOOK_MODES,
} from "./zalo-config.js";
import { zaloOaMenuCommands } from "./zalo-oa-menu.js";
import {
	applyBrandConfig,
	BrandConflictError,
	brandAppId,
	brandOverview,
	issueBindingCode,
	resolveStoreIds,
	tenantStores,
} from "./zalo-queries.js";
import { zaloTokenCommands } from "./zalo-tokens.js";

const FLAG_FIELDS = [
	"name",
	"store",
	"app-id",
	"app-secret-name",
	"app-status",
	"oa-id",
	"oa-secret-name",
	"oa-tier",
	"oa-expires-on",
	"oa-verified",
	"webhook-mode",
] as const;

function readBrandConfig(
	context: CommandContext,
	values: OptionValues,
): BrandConfig {
	const file = stringOption(values, "file");
	const brand = stringOption(values, "brand");
	if (file === undefined) {
		return configFromFlags({
			brand,
			name: stringOption(values, "name"),
			stores: stringList(values, "store"),
			appId: stringOption(values, "app-id"),
			appSecretName: stringOption(values, "app-secret-name"),
			appStatus: stringOption(values, "app-status"),
			oaId: stringOption(values, "oa-id"),
			oaSecretName: stringOption(values, "oa-secret-name"),
			oaTier: stringOption(values, "oa-tier"),
			oaExpiresOn: stringOption(values, "oa-expires-on"),
			oaVerified: flag(values, "oa-verified"),
			webhookMode: stringOption(values, "webhook-mode"),
		});
	}
	const mixed = FLAG_FIELDS.filter((name) => values[name] !== undefined);
	if (mixed.length > 0) {
		throw new UsageError(
			`pass either --file or the brand flags, not both (--${mixed.join(", --")})`,
		);
	}
	let path: string;
	try {
		path = assertPrivateOutput(
			resolveUserPath(file, context.env),
			context.rootDir,
		);
	} catch (error) {
		if (error instanceof PathRefusedError) {
			throw new UsageError(
				"--file must be kept outside the repository or below docs/private/",
			);
		}
		throw error;
	}
	let text: string;
	try {
		text = readFileSync(path, "utf8");
	} catch {
		throw new UsageError("--file could not be read");
	}
	const config = parseBrandFile(text);
	if (brand !== undefined && brand !== config.brand) {
		throw new UsageError("--brand differs from the brand of the file");
	}
	return config;
}

async function configSet(
	context: CommandContext,
	values: OptionValues,
): Promise<number> {
	const slug = requiredString(values, "tenant");
	const config = readBrandConfig(context, values);
	const { sql } = context.services.db();
	const tenant = await requireTenant(sql, slug, context.output.ci);
	const storeIds = resolveStoreIds(
		await tenantStores(sql, tenant.id),
		config.stores,
	);
	const label = `${config.brand} of ${tenantName(context, tenant.slug)}`;
	try {
		const reports = await applyBrandConfig(sql, tenant.id, config, storeIds);
		const created = reports.filter((report) => report.change === "created");
		context.output.line(
			created.length === 0
				? `${label} unchanged: every row already holds these values`
				: `${label}: ${created.map((report) => report.row).join(", ")} created; ${reports.length - created.length} unchanged`,
		);
		return 0;
	} catch (error) {
		if (error instanceof BrandConflictError) {
			context.output.error(
				`${label} already exists with different values (${error.conflicts.join("; ")}); nothing was changed`,
			);
			return 1;
		}
		throw error;
	}
}

async function configShow(
	context: CommandContext,
	values: OptionValues,
): Promise<number> {
	const slug = requiredString(values, "tenant");
	const { sql } = context.services.db();
	const tenant = await requireTenant(sql, slug, context.output.ci);
	for (const line of showLines(
		await brandOverview(sql, tenant.id),
		context.output.ci,
	)) {
		context.output.line(line);
	}
	return 0;
}

async function bind(
	context: CommandContext,
	values: OptionValues,
): Promise<number> {
	if (context.output.ci) {
		throw new UsageError(
			"fnb zalo bind prints a one-time code; run it on the owner's machine, not in CI",
		);
	}
	const slug = requiredString(values, "tenant");
	const email = requiredString(values, "member").trim();
	if (!EMAIL_PATTERN.test(email)) {
		throw new UsageError("--member is the member's login e-mail address");
	}
	const brand = requiredString(values, "brand");
	if (!BRAND_KEY_PATTERN.test(brand)) {
		throw new UsageError("--brand must be a neutral key such as brand-1");
	}
	const { sql } = context.services.db();
	const tenant = await requireTenant(sql, slug, false);
	const userId = await findAuthUserId(sql, email);
	if (userId === null) {
		throw new UsageError("no login exists for this e-mail");
	}
	const zaloAppId = await brandAppId(sql, tenant.id, brand);
	if (zaloAppId === null) {
		throw new UsageError(
			`${brand} has no Zalo App in this tenant; add it with fnb zalo config set`,
		);
	}
	let issued: { code: string; expiresAt: Date };
	try {
		issued = await issueBindingCode(sql, tenant.id, userId, zaloAppId);
	} catch (error) {
		if (error instanceof Error && "code" in error && error.code === "22023") {
			context.output.error(`no binding code: ${error.message}`);
			return 1;
		}
		throw error;
	}
	context.output.line(
		`binding code for ${email} in the ${brand} Mini Apps: ${issued.code}`,
	);
	context.output.line(
		`valid until ${issued.expiresAt.toISOString()} (10 minutes), for one use; the sixth wrong code burns it. A new code replaces this one.`,
	);
	return 0;
}

const BRAND_FLAG_OPTIONS = {
	brand: { type: "string" },
	file: { type: "string" },
	name: { type: "string" },
	store: { type: "string", multiple: true },
	"app-id": { type: "string" },
	"app-secret-name": { type: "string" },
	"app-status": { type: "string" },
	"oa-id": { type: "string" },
	"oa-secret-name": { type: "string" },
	"oa-tier": { type: "string" },
	"oa-expires-on": { type: "string" },
	"oa-verified": { type: "boolean" },
	"webhook-mode": { type: "string" },
} as const;

export const zaloCommands: CommandSpec[] = [
	{
		path: ["zalo", "config", "set"],
		summary: "Set a brand's Zalo App, OA and Mini App rows (idempotent)",
		usage:
			"fnb zalo config set --tenant <slug> (--file <brand.json> | --brand <key> --name <name> --store <external id>… --app-id <id> --app-secret-name ZALO_APP_SECRET_<BRAND> [--app-status active|disabled] [--oa-id <id> --oa-secret-name ZALO_OA_SECRET_<BRAND> --oa-tier <tier> --oa-expires-on <YYYY-MM-DD> --oa-verified --webhook-mode observe|enforce])",
		options: {
			...HELP_OPTION,
			tenant: { type: "string" },
			...BRAND_FLAG_OPTIONS,
		},
		details: [
			"Needs DATABASE_URL (or SUPABASE_DB_URL).",
			"The file is JSON kept outside the repository (or below docs/private/): brand, name, stores, zalo_app {id, secret_name, status}, oa {id, secret_name, package_tier, package_expires_on, verified, webhook_mode} and mini_apps [{kind, id, title, header_title_vi, header_title_en, header_color_light, header_color_dark, text_color_light, text_color_dark}]. Mini Apps are set from the file only.",
			"Secret columns take the NAME of a function secret (ZALO_APP_SECRET_<BRAND>, ZALO_OA_SECRET_<BRAND>), never its value.",
			`--oa-tier is one of ${OA_TIERS.join(", ")}; --webhook-mode is one of ${WEBHOOK_MODES.join(", ")}.`,
			"A re-run with the same values changes nothing; different values for a stored row are refused and nothing is changed.",
		],
		run: configSet,
	},
	{
		path: ["zalo", "config", "show"],
		summary: "Show the brands of a tenant with their Zalo rows",
		usage: "fnb zalo config show --tenant <slug>",
		options: { ...HELP_OPTION, tenant: { type: "string" } },
		details: [
			"Needs DATABASE_URL (or SUPABASE_DB_URL).",
			"With CI set, brands are numbered and only their states are printed: no id, secret name, display name or title.",
		],
		run: configShow,
	},
	{
		path: ["zalo", "bind"],
		summary: "Issue a one-time code that binds a member's Zalo account",
		usage:
			"fnb zalo bind --tenant <slug> --member <login e-mail> --brand <key>",
		options: {
			...HELP_OPTION,
			tenant: { type: "string" },
			member: { type: "string" },
			brand: { type: "string" },
		},
		details: [
			"Needs DATABASE_URL (or SUPABASE_DB_URL). Refused in CI.",
			"Prints a 6-digit code valid 10 minutes, stored only as a hash. The member enters it once in the brand's Mini App, which then signs in with the member's role and stores.",
			"A wrong code counts against every live code of the brand; the sixth wrong attempt burns them. A publisher login cannot be bound.",
		],
		run: bind,
	},
	...zaloTokenCommands,
	...zaloOaMenuCommands,
];
