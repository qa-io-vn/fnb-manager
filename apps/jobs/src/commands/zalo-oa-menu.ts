import { readFileSync } from "node:fs";
import { isFixtureTenantSlug, ZaloConfigError } from "@fnb/zalo";
import {
	diffLines,
	type MenuChange,
	menuChanged,
	menuDiff,
	menuDigest,
	needsMiniApp,
	OaConfigError,
	type OaMenuConfig,
	oaApiSettings,
	parseMenuButtons,
	parseMenuConfig,
	parseZaloButtons,
	updateOaMenu,
	type ZaloButton,
	zaloButtons,
} from "@fnb/zalo/oa";
import type { Sql } from "postgres";
import { requireTenant } from "../admin/tenants.js";
import {
	type CommandContext,
	flag,
	type OptionValues,
	requiredString,
	stringOption,
	UsageError,
} from "../context.js";
import {
	assertPrivateOutput,
	PathRefusedError,
	resolveUserPath,
} from "../datapack/files.js";
import { type CommandSpec, HELP_OPTION } from "./spec.js";
import { BRAND_KEY_PATTERN } from "./zalo-config.js";
import { brandLabel } from "./zalo-tokens.js";

export interface MenuSource {
	readonly brandKey: string;
	readonly menuId: string | null;
	readonly oaId: string;
	readonly packageTier: string;
	readonly buttons: unknown;
	readonly appliedButtons: unknown;
	readonly appliedAt: Date | null;
	readonly miniAppId: string | null;
}

export type MenuPlan =
	| { readonly kind: "no_menu" }
	| { readonly kind: "no_mini_app" }
	| {
			readonly kind: "ready";
			readonly menuId: string;
			readonly oaId: string;
			readonly buttons: readonly ZaloButton[];
			readonly digest: string;
			readonly changes: readonly MenuChange[];
			readonly changed: boolean;
			readonly appliedAt: Date | null;
	  };

export async function planMenu(source: MenuSource): Promise<MenuPlan> {
	if (source.menuId === null || source.buttons === null) {
		return { kind: "no_menu" };
	}
	const configured = parseMenuButtons(source.buttons);
	if (needsMiniApp(configured) && source.miniAppId === null) {
		return { kind: "no_mini_app" };
	}
	const buttons = zaloButtons(configured, source.miniAppId);
	const changes = menuDiff(parseZaloButtons(source.appliedButtons), buttons);
	return {
		kind: "ready",
		menuId: source.menuId,
		oaId: source.oaId,
		buttons,
		digest: await menuDigest(buttons),
		changes,
		changed: menuChanged(changes),
		appliedAt: source.appliedAt,
	};
}

function pending(changes: readonly MenuChange[]): number {
	return changes.filter((change) => change.kind !== "same").length;
}

export function planLines(
	label: string,
	plan: MenuPlan,
	ci: boolean,
): string[] {
	switch (plan.kind) {
		case "no_menu":
			return [
				`${label}: no OA menu is configured; set one with fnb zalo oa-menu set`,
			];
		case "no_mini_app":
			return [
				`${label}: the menu opens the customer Mini App, but the brand has none in mini_apps; add it with fnb zalo config set`,
			];
		case "ready": {
			const since =
				plan.appliedAt === null
					? "never applied"
					: `last applied ${plan.appliedAt.toISOString()}`;
			const count = pending(plan.changes);
			return [
				`${label}: ${plan.buttons.length} button(s), ${count === 0 ? "no change" : `${count} change(s)`} (${since})`,
				...diffLines(plan.changes, ci),
			];
		}
	}
}

interface SourceRow {
	brand_key: string;
	menu_id: string | null;
	oa_id: string;
	package_tier: string;
	buttons: unknown;
	applied_buttons: unknown;
	applied_at: Date | null;
	mini_app_id: string | null;
}

export async function menuSources(
	sql: Sql,
	tenantId: string,
	brandKey: string | null,
): Promise<MenuSource[]> {
	const rows = await sql<SourceRow[]>`
		select b.brand_key, s.menu_id::text as menu_id, s.oa_id::text as oa_id, s.package_tier,
			s.buttons, s.applied_buttons, s.applied_at, s.mini_app_id
		from public.brands b
		cross join lateral app.oa_menu_source(b.tenant_id, b.brand_key) s
		where b.tenant_id = ${tenantId}::uuid
			and (${brandKey}::text is null or b.brand_key = ${brandKey}::text)
		order by b.brand_key
	`;
	return rows.map((row) => ({
		brandKey: row.brand_key,
		menuId: row.menu_id,
		oaId: row.oa_id,
		packageTier: row.package_tier,
		buttons: row.buttons,
		appliedButtons: row.applied_buttons,
		appliedAt: row.applied_at,
		miniAppId: row.mini_app_id,
	}));
}

function brandOption(values: OptionValues, required: boolean): string | null {
	const brand = stringOption(values, "brand");
	if (brand === undefined && required) {
		throw new UsageError("--brand is required");
	}
	if (brand !== undefined && !BRAND_KEY_PATTERN.test(brand)) {
		throw new UsageError("--brand must be a neutral key such as brand-1");
	}
	return brand ?? null;
}

function readMenuFile(context: CommandContext, file: string): unknown {
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
	try {
		return JSON.parse(text);
	} catch {
		throw new UsageError("--file is not JSON");
	}
}

export function menuConfig(
	context: CommandContext,
	values: OptionValues,
): OaMenuConfig {
	const file = stringOption(values, "file");
	const imageUrl = stringOption(values, "form-image-url");
	const raw = file === undefined ? {} : readMenuFile(context, file);
	const merged =
		imageUrl === undefined || raw === null || typeof raw !== "object"
			? raw
			: { ...(raw as Record<string, unknown>), form_image_url: imageUrl };
	try {
		return parseMenuConfig(merged);
	} catch (error) {
		if (error instanceof OaConfigError) {
			throw new UsageError(error.message);
		}
		throw error;
	}
}

async function setMenu(
	context: CommandContext,
	values: OptionValues,
): Promise<number> {
	const slug = requiredString(values, "tenant");
	const brand = brandOption(values, true);
	const config = menuConfig(context, values);
	const { sql } = context.services.db();
	const tenant = await requireTenant(sql, slug, context.output.ci);
	let outcome: string;
	try {
		const [row] = await sql<{ outcome: string }[]>`
			select app.set_oa_menu(
				${tenant.id}::uuid, ${brand}::text, ${JSON.stringify(config.buttons)}::text::jsonb,
				${config.welcomeEnabled}::boolean, ${config.welcomeText}::text, ${config.joinedText}::text,
				${config.memberText}::text, ${config.formTitle}::text, ${config.formSubtitle}::text,
				${config.formImageUrl}::text
			) as outcome
		`;
		outcome = row?.outcome ?? "unchanged";
	} catch (error) {
		if (error instanceof Error && "code" in error && error.code === "22023") {
			context.output.error(
				`${context.output.ci ? "the brand" : brand} has no OA in this tenant; add it with fnb zalo config set`,
			);
			return 1;
		}
		throw error;
	}
	const label = context.output.ci ? "the brand" : `${brand}`;
	context.output.line(
		outcome === "unchanged"
			? `${label}: the OA menu already holds these values`
			: `${label}: OA menu ${outcome}; fnb zalo oa-menu apply --dry-run shows what the next apply pushes`,
	);
	return 0;
}

function apiSettings(context: CommandContext) {
	try {
		return oaApiSettings(context.env);
	} catch (error) {
		if (error instanceof ZaloConfigError) {
			throw new UsageError(error.message);
		}
		throw error;
	}
}

async function push(
	context: CommandContext,
	sql: Sql,
	label: string,
	plan: Extract<MenuPlan, { kind: "ready" }>,
	baseUrl: string,
): Promise<boolean> {
	const [row] = await sql<{ token: string | null }[]>`
		select app.oa_access_token(${plan.oaId}::uuid, ${context.now().toISOString()}::timestamptz) as token
	`;
	const token = row?.token ?? null;
	if (token === null) {
		context.output.error(
			`${label}: no valid OA token; the OA needs the tang_truong or toan_dien package and fnb zalo oa authorize, then fnb zalo oa refresh. Nothing pushed`,
		);
		return false;
	}
	const answer = await updateOaMenu({ baseUrl }, token, plan.buttons);
	if (!answer.ok) {
		context.output.error(
			`${label}: Zalo refused the menu (error ${answer.error}); nothing recorded`,
		);
		return false;
	}
	await sql`
		select app.record_oa_menu_applied(
			${plan.menuId}::uuid, ${JSON.stringify(plan.buttons)}::text::jsonb,
			${plan.digest}::text, ${context.now().toISOString()}::timestamptz
		)
	`;
	context.output.line(`${label}: menu applied (${plan.digest.slice(0, 12)})`);
	return true;
}

async function applyMenu(
	context: CommandContext,
	values: OptionValues,
): Promise<number> {
	const slug = requiredString(values, "tenant");
	const brand = brandOption(values, false);
	const dryRun = flag(values, "dry-run");
	const settings = dryRun ? null : apiSettings(context);
	const { sql } = context.services.db();
	const tenant = await requireTenant(sql, slug, context.output.ci);
	if (
		settings !== null &&
		(settings.integration || settings.local) &&
		(tenant.id !== settings.tenantId ||
			(settings.integration && !isFixtureTenantSlug(tenant.slug)))
	) {
		throw new UsageError(
			"with ZALO_INTEGRATION=1 or ZALO_LOCAL_DEV=1 the menu is applied only to the tenant named by ZALO_TENANT_ID (a zalo-it- fixture tenant in the integration suite)",
		);
	}
	const sources = await menuSources(sql, tenant.id, brand);
	if (sources.length === 0) {
		context.output.line(
			brand === null
				? "no brand of this tenant has an OA; nothing to apply"
				: `${context.output.ci ? "the brand" : brand} has no OA in this tenant; nothing to apply`,
		);
		return brand === null ? 0 : 1;
	}
	let failures = 0;
	for (const [index, source] of sources.entries()) {
		const label = brandLabel(context.output.ci, index, {
			tenantSlug: tenant.slug,
			brandKey: source.brandKey,
		});
		let plan: MenuPlan;
		try {
			plan = await planMenu(source);
		} catch (error) {
			if (error instanceof OaConfigError) {
				context.output.error(`${label}: ${error.message}`);
				failures += 1;
				continue;
			}
			throw error;
		}
		for (const line of planLines(label, plan, context.output.ci)) {
			context.output.line(line);
		}
		if (plan.kind === "no_mini_app") {
			failures += 1;
			continue;
		}
		if (plan.kind !== "ready") {
			continue;
		}
		if (dryRun) {
			context.output.line(`${label}: dry run, nothing pushed`);
			continue;
		}
		if (!plan.changed) {
			context.output.line(
				`${label}: the OA already shows this menu; nothing pushed`,
			);
			continue;
		}
		if (
			settings === null ||
			!(await push(context, sql, label, plan, settings.baseUrl))
		) {
			failures += 1;
		}
	}
	return failures === 0 ? 0 : 1;
}

const SAFETY_DETAIL =
	"Tokens and secrets are never printed. With CI set brands are numbered and the diff names button kinds only, without labels or links.";

export const zaloOaMenuCommands: CommandSpec[] = [
	{
		path: ["zalo", "oa-menu", "set"],
		summary: "Set a brand's OA chat menu, welcome and join texts",
		usage:
			"fnb zalo oa-menu set --tenant <slug> --brand <key> [--file <menu.json>] [--form-image-url <https URL>]",
		options: {
			...HELP_OPTION,
			tenant: { type: "string" },
			brand: { type: "string" },
			file: { type: "string" },
			"form-image-url": { type: "string" },
		},
		details: [
			"Needs DATABASE_URL (or SUPABASE_DB_URL).",
			"The file is JSON kept outside the repository (or below docs/private/): buttons [{action, label, target}], welcome_enabled, welcome_text, joined_text, member_text, form_title, form_subtitle, form_image_url. Every field is optional; a missing one takes the default (join, points, vouchers and open the Mini App, with Vietnamese texts).",
			"action is join, points, vouchers or open_app; target is mini_app (a deep link into the brand's customer Mini App) or query (the OA keyword that sends Zalo's request_user_info form, join only). No other link is possible, and texts carry no link or phone number.",
			"A join button of target query needs form_image_url, the https image Zalo shows in its form. The welcome is a consultation message, never a promotion; joined_text says how to opt in to promotions from the Mini App.",
			"A re-run with the same values changes nothing; new values replace the menu, and fnb zalo oa-menu apply pushes them.",
		],
		run: setMenu,
	},
	{
		path: ["zalo", "oa-menu", "apply"],
		summary: "Push each brand's OA menu through the OA Open API (diff first)",
		usage: "fnb zalo oa-menu apply --tenant <slug> [--brand <key>] [--dry-run]",
		options: {
			...HELP_OPTION,
			tenant: { type: "string" },
			brand: { type: "string" },
			"dry-run": { type: "boolean" },
		},
		details: [
			"Needs DATABASE_URL (or SUPABASE_DB_URL). --dry-run reads the database only: it prints, per brand, the buttons and the diff against the menu applied last, and calls nothing.",
			"Without --dry-run a changed menu is pushed with the brand's OA token (fnb zalo oa authorize; the OA needs tang_truong or toan_dien) and recorded once Zalo accepts it; an unchanged one is not pushed again. Exit 1 when a brand failed.",
			"The OA API is https://openapi.zalo.me; with ZALO_INTEGRATION=1 or ZALO_LOCAL_DEV=1 ZALO_OA_API_BASE_URL must name a loopback mock, and only the tenant of ZALO_TENANT_ID is touched.",
			SAFETY_DETAIL,
		],
		run: applyMenu,
	},
];
