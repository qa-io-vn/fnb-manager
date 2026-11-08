import { assertTimezone } from "@fnb/core";
import { createAuthUser, type NewUserMode } from "../admin/auth-users.js";
import {
	findAuthUserId,
	findTenant,
	insertTenant,
	LEGAL_FORMS,
	type LegalForm,
	requireTenant,
	TENANT_ROLES,
	type TenantInput,
	type TenantRole,
	tenantDifferences,
	upsertMember,
} from "../admin/tenants.js";
import {
	type CommandContext,
	flag,
	type OptionValues,
	requiredString,
	stringOption,
	UsageError,
} from "../context.js";
import { type CommandSpec, HELP_OPTION } from "./spec.js";

const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{1,62}$/;

function countryFromLocale(locale: string): string {
	const region = locale.split(/[-_]/)[1];
	if (!region || !/^[A-Za-z]{2}$/.test(region)) {
		throw new UsageError(
			"--locale must carry a two-letter region, for example vi-VN",
		);
	}
	return region.toUpperCase();
}

function tenantName(context: CommandContext, slug: string): string {
	return context.output.ci ? "the tenant" : slug;
}

function tenantInput(values: OptionValues): TenantInput {
	const slug = requiredString(values, "slug");
	if (!SLUG_PATTERN.test(slug)) {
		throw new UsageError(
			"--slug must be 2–63 lower-case letters, digits or hyphens",
		);
	}
	const currency = (stringOption(values, "currency") ?? "VND").toUpperCase();
	if (!/^[A-Z]{3}$/.test(currency)) {
		throw new UsageError("--currency must be a three-letter ISO 4217 code");
	}
	const timezone = stringOption(values, "timezone") ?? "Asia/Ho_Chi_Minh";
	try {
		assertTimezone(timezone);
	} catch {
		throw new UsageError(`--timezone "${timezone}" is not an IANA time zone`);
	}
	const legalForm = stringOption(values, "legal-form") ?? "unknown";
	if (!(LEGAL_FORMS as readonly string[]).includes(legalForm)) {
		throw new UsageError(
			`--legal-form must be one of ${LEGAL_FORMS.join(", ")}`,
		);
	}
	return {
		slug,
		name: requiredString(values, "name"),
		country_code: countryFromLocale(stringOption(values, "locale") ?? "vi-VN"),
		currency_code: currency,
		timezone,
		legal_form: legalForm as LegalForm,
	};
}

async function createTenant(
	context: CommandContext,
	values: OptionValues,
): Promise<number> {
	const input = tenantInput(values);
	const { sql } = context.services.db();
	const created = await insertTenant(sql, input);
	const name = tenantName(context, input.slug);
	if (created) {
		context.output.line(`tenant created: ${name}`);
		return 0;
	}
	const existing = await findTenant(sql, input.slug);
	if (!existing) {
		throw new Error("tenant insert neither created nor found a row");
	}
	const differences = tenantDifferences(existing, input);
	if (differences.length === 0) {
		context.output.line(
			`tenant unchanged: ${name} already exists with these settings`,
		);
		return 0;
	}
	context.output.error(
		`tenant ${name} already exists with different ${differences.join(", ")}; nothing was changed`,
	);
	return 1;
}

function newUserMode(
	context: CommandContext,
	values: OptionValues,
): NewUserMode | null {
	const password =
		stringOption(values, "password") ?? context.env.FNB_MEMBER_PASSWORD;
	if (password !== undefined && flag(values, "invite")) {
		throw new UsageError("pass either a password or --invite, not both");
	}
	if (password !== undefined) {
		if (password.length < 12) {
			throw new UsageError(
				"the member password must be at least 12 characters",
			);
		}
		return { kind: "password", password };
	}
	return flag(values, "invite") ? { kind: "invite" } : null;
}

async function addMember(
	context: CommandContext,
	values: OptionValues,
): Promise<number> {
	const slug = requiredString(values, "tenant");
	const email = requiredString(values, "email").trim();
	if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
		throw new UsageError("--email is not an e-mail address");
	}
	const role = requiredString(values, "role");
	if (!(TENANT_ROLES as readonly string[]).includes(role)) {
		throw new UsageError(`--role must be one of ${TENANT_ROLES.join(", ")}`);
	}
	const mode = newUserMode(context, values);
	const { sql } = context.services.db();
	const tenant = await requireTenant(sql, slug, context.output.ci);
	const who = context.output.ci ? "the member" : email;
	let userId = await findAuthUserId(sql, email);
	if (userId) {
		context.output.line(
			`login exists for ${who}${mode?.kind === "password" ? "; its password was left unchanged" : ""}`,
		);
	} else {
		if (!mode) {
			throw new UsageError(
				"no login exists for this e-mail: pass --password, set FNB_MEMBER_PASSWORD or use --invite",
			);
		}
		userId = await createAuthUser(
			context.services.supabaseAdmin(),
			email,
			mode,
		);
		context.output.line(
			mode.kind === "invite"
				? `invitation sent to ${who}`
				: `login created for ${who}`,
		);
	}
	const change = await upsertMember(sql, tenant.id, userId, role as TenantRole);
	context.output.line(
		`membership ${change}: ${who} is ${role} of ${tenantName(context, tenant.slug)}`,
	);
	return 0;
}

export const tenantCommands: CommandSpec[] = [
	{
		path: ["tenant", "create"],
		summary: "Create a tenant (idempotent)",
		usage:
			"fnb tenant create --name <name> --slug <slug> [--currency VND] [--locale vi-VN] [--timezone Asia/Ho_Chi_Minh] [--legal-form <form>]",
		options: {
			...HELP_OPTION,
			name: { type: "string" },
			slug: { type: "string" },
			currency: { type: "string" },
			locale: { type: "string" },
			timezone: { type: "string" },
			"legal-form": { type: "string" },
		},
		details: [
			"Needs DATABASE_URL (or SUPABASE_DB_URL).",
			"--locale sets the tenant country code from its region (vi-VN gives VN).",
			`--legal-form is one of ${LEGAL_FORMS.join(", ")}; default unknown.`,
			"Re-running with the same values changes nothing; different values for an existing slug are refused.",
		],
		run: createTenant,
	},
	{
		path: ["tenant", "add-member"],
		summary: "Give a login a role in a tenant, creating the login when missing",
		usage:
			"fnb tenant add-member --tenant <slug> --email <address> --role owner|manager|staff|viewer|publisher [--password <p> | --invite]",
		options: {
			...HELP_OPTION,
			tenant: { type: "string" },
			email: { type: "string" },
			role: { type: "string" },
			password: { type: "string" },
			invite: { type: "boolean" },
		},
		details: [
			"Needs DATABASE_URL, and SUPABASE_URL plus SUPABASE_SECRET_KEY when the login has to be created.",
			"A missing login is created with --password, the FNB_MEMBER_PASSWORD variable (preferred: it stays out of shell history) or --invite (sends an e-mail).",
			"An existing login keeps its password; re-running only changes the role.",
		],
		run: addMember,
	},
];
