import { z } from "zod";
import { DAY_RULE_KEYS, type DayRuleKey } from "../rules/day.js";

export const DIGEST_MODEL_VERSION = 1;

export const STORE_DAY_STATES = [
	"verified",
	"unverified",
	"unmatched",
	"closed",
	"no_sales",
	"unsettled",
	"shift_open",
] as const;

export type StoreDayState = (typeof STORE_DAY_STATES)[number];

export const DIGEST_DATA_STATES = [
	"verified",
	"unverified",
	"unmatched",
	"partial",
	"no_data",
] as const;

export type DigestDataState = (typeof DIGEST_DATA_STATES)[number];

export const DIGEST_UNAVAILABLE_REASONS = [
	"no_data",
	"store_too_young",
	"no_reference",
	"not_measured",
	"not_configured",
	"building_baseline",
] as const;

export const DIGEST_HOLIDAY_KINDS = ["public", "tet", "custom"] as const;

export const DIGEST_CARD_IDS = {
	net: "net_revenue",
	invoices: "invoices",
	avgTicket: "avg_ticket",
	payments: "payments",
	hourly: "hourly",
	topItems: "top_items",
} as const;

export const DIGEST_TABLE_COLUMNS = {
	topItems: ["item", "quantity"],
	netStores: ["value", "baseline", "changeBaseline"],
} as const;

export const DIGEST_COMPARISON_BASES = ["all_stores", "like_for_like"] as const;

const comparisonSchema = z.object({
	change: z.number().nullable(),
	sampleDays: z.number().int().nullable(),
	unavailable: z.enum(DIGEST_UNAVAILABLE_REASONS).nullable(),
	basis: z.enum(DIGEST_COMPARISON_BASES).optional(),
	coveredStores: z.number().int().nonnegative().optional(),
	totalStores: z.number().int().nonnegative().optional(),
});

const valuesSchema = z.record(z.string(), z.union([z.number(), z.string()]));

export const digestModelSchema = z.object({
	version: z.literal(DIGEST_MODEL_VERSION),
	tenantId: z.string(),
	businessDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
	scope: z.object({
		storeIds: z.array(z.string()),
		allStores: z.boolean(),
	}),
	dataState: z.enum(DIGEST_DATA_STATES),
	holidayKind: z.enum(DIGEST_HOLIDAY_KINDS).nullable(),
	totals: z.object({
		net: z.number().nullable(),
		vsBaseline: comparisonSchema,
		vsPrevious: comparisonSchema,
		invoices: z.number().nullable(),
		avgTicket: z.number().nullable(),
		cashToCount: z.number().nullable(),
		peakHour: z
			.object({ hour: z.number().int(), net: z.number().nullable() })
			.nullable(),
		topItems: z.array(
			z.object({ name: z.string(), quantity: z.number().nullable() }),
		),
	}),
	stores: z.array(
		z.object({
			storeId: z.string(),
			name: z.string(),
			state: z.enum(STORE_DAY_STATES),
			net: z.number().nullable(),
			invoices: z.number().nullable(),
			vsBaseline: comparisonSchema,
		}),
	),
	findings: z.array(
		z.object({
			ruleKey: z.enum(DAY_RULE_KEYS),
			storeId: z.string(),
			values: valuesSchema,
		}),
	),
	openAlerts: z.array(
		z.object({
			ruleKey: z.string(),
			storeId: z.string().nullable(),
			accountId: z.string().nullable(),
			accountName: z.string().nullable(),
			runKind: z.string().nullable(),
			openedAt: z.string(),
		}),
	),
	link: z.object({
		kind: z.enum(["ngay", "hom_nay"]),
		path: z.string(),
	}),
	stale: z.boolean(),
	builtAt: z.string(),
});

export type DigestModel = z.infer<typeof digestModelSchema>;
export type DigestComparison = DigestModel["totals"]["vsBaseline"];
export type DigestStoreLine = DigestModel["stores"][number];
export type DigestFinding = DigestModel["findings"][number];
export type DigestOpenAlert = DigestModel["openAlerts"][number];

export function parseDigestModel(value: unknown): DigestModel | null {
	const parsed = digestModelSchema.safeParse(value);
	return parsed.success ? parsed.data : null;
}

export function findingsOf(
	model: Pick<DigestModel, "findings">,
	ruleKey: DayRuleKey,
): readonly DigestFinding[] {
	return model.findings.filter((finding) => finding.ruleKey === ruleKey);
}
