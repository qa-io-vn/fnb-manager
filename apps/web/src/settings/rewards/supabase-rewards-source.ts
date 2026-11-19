import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { fetchAllPages, fetchOnce } from "../../data/paginate";
import {
	auditAuthorOf,
	type MemberRoleRow,
	SettingsWriteError,
} from "../source";
import {
	createSupabaseAudits,
	nullableNumeric,
	numeric,
	onlyRow,
	type PostgrestFailure,
	writeErrorOf,
} from "../supabase-common";
import {
	type ApprovalAuthor,
	COUPON_RAILS,
	EINVOICE_DISPLAYS,
	REWARD_KINDS,
	REWARD_STATUSES,
	type RewardChange,
	type RewardField,
	type RewardRecord,
	type RewardRefusal,
	type RewardsSource,
	RewardWriteError,
} from "./source";

const REWARD_SELECT =
	"id,programme_id,reward_key,name,description,reward_kind,reward_percent,reward_amount,reward_item_external_ids,excluded_item_external_ids,cost_stamps,cost_points,min_bill_amount,valid_from,valid_until,valid_days,hold_hours,per_member_limit,store_ids,status,approved_by,approved_at,created_at,updated_at,updated_by";

const rewardRow = z.object({
	id: z.string(),
	programme_id: z.string(),
	reward_key: z.string(),
	name: z.string(),
	description: z.string().nullable(),
	reward_kind: z.enum(REWARD_KINDS),
	reward_percent: nullableNumeric,
	reward_amount: nullableNumeric,
	reward_item_external_ids: z.array(z.string()).nullable(),
	excluded_item_external_ids: z.array(z.string()),
	cost_stamps: z.number(),
	cost_points: z.number(),
	min_bill_amount: numeric,
	valid_from: z.string().nullable(),
	valid_until: z.string().nullable(),
	valid_days: z.number(),
	hold_hours: z.number(),
	per_member_limit: z.number().nullable(),
	store_ids: z.array(z.string()).nullable(),
	status: z.enum(REWARD_STATUSES),
	approved_by: z.string().nullable(),
	approved_at: z.string().nullable(),
	created_at: z.string(),
	updated_at: z.string(),
	updated_by: z.string().nullable(),
});

type RewardRow = z.infer<typeof rewardRow>;

const railRow = z.object({
	store_id: z.string(),
	rail: z.enum(COUPON_RAILS),
	active_from: z.string(),
});

const mappingRow = z.object({
	id: z.string(),
	store_id: z.string(),
	reward_key: z.string(),
	pos_discount_name: z.string().nullable(),
	pos_free_item_external_id: z.string().nullable(),
	crm_programme_external_id: z.string().nullable(),
	einvoice_display: z.enum(EINVOICE_DISPLAYS),
});

const discountDaysRow = z.object({
	item_external_id: z.string(),
	item_name: z.string().nullable(),
	price_discount_days: z.number(),
	gift_days: z.number(),
	voucher_days: z.number(),
	limit_days: z.number().nullable(),
	over_limit: z.boolean(),
});

const READ_PAGE = 500;

const CONSTRAINT_FIELDS: Readonly<Record<string, RewardField>> = {
	coupons_reward_percent_check: "rewardPercent",
	coupons_reward_amount_check: "rewardAmount",
	coupons_reward_terms_check: "rewardKind",
	coupons_reward_items_check: "rewardItemExternalIds",
	coupons_excluded_items_check: "excludedItemExternalIds",
	coupons_description_check: "description",
	coupons_validity_check: "validUntil",
	coupons_per_member_limit_check: "perMemberLimit",
	coupons_reward_key_check: "rewardKey",
	coupons_name_check: "name",
	coupons_cost_stamps_check: "costStamps",
	coupons_cost_points_check: "costPoints",
	coupons_check: "costStamps",
	coupons_min_bill_amount_check: "minBillAmount",
	coupons_valid_days_check: "validDays",
	coupons_hold_hours_check: "holdHours",
	coupons_store_ids_check: "storeIds",
	coupons_programme_id_reward_key_key: "rewardKey",
};

const MESSAGE_REFUSALS: readonly (readonly [
	RegExp,
	RewardField,
	RewardRefusal,
])[] = [
	[/gives at most .* off the price it reduces/, "rewardPercent", "cap"],
	[/names the minimum bill it reduces/, "minBillAmount", "minBillRequired"],
	[/gives at most .* of its minimum bill/, "rewardAmount", "amountCap"],
	[/POS item external id/, "rewardItemExternalIds", "itemId"],
	[
		/either a reward item or an excluded item/,
		"excludedItemExternalIds",
		"itemOverlap",
	],
	[/retired reward stays retired/, "status", "retiredFinal"],
	[/new reward starts as a draft/, "status", "value"],
	[/only an owner with every store approves/, "status", "ownerApproves"],
	[/has a coupon rail/, "status", "noRail"],
	[/maps it to a POS discount/, "status", "noMapping"],
	[/keeps its e-invoice mapping/, "status", "keepsMapping"],
	[/store_ids/, "storeIds", "storeScope"],
];

function textOf(error: PostgrestFailure): string {
	return `${error.message ?? ""} ${error.details ?? ""}`;
}

export function rewardWriteError(error: PostgrestFailure): SettingsWriteError {
	const text = textOf(error);
	if (
		error.code === "22023" ||
		error.code === "42501" ||
		error.code === "23503"
	) {
		const known = MESSAGE_REFUSALS.find(([pattern]) => pattern.test(text));
		if (known !== undefined) {
			return new RewardWriteError(
				error.code === "42501" ? "forbidden" : "invalid",
				known[1],
				known[2],
			);
		}
	}
	const generic = writeErrorOf(error);
	const constraint = /constraint "([^"]+)"/.exec(text)?.[1] ?? null;
	const field =
		constraint !== null && Object.hasOwn(CONSTRAINT_FIELDS, constraint)
			? (CONSTRAINT_FIELDS[constraint] ?? null)
			: null;
	if (field !== null) {
		return new RewardWriteError(
			generic.code,
			field,
			generic.code === "duplicate" ? "duplicateKey" : "value",
		);
	}
	return generic;
}

export function rewardColumnsOf(change: RewardChange): Record<string, unknown> {
	return {
		programme_id: change.programmeId,
		reward_key: change.rewardKey,
		name: change.name,
		description: change.description,
		reward_kind: change.rewardKind,
		reward_percent: change.rewardPercent,
		reward_amount: change.rewardAmount,
		reward_item_external_ids: change.rewardItemExternalIds,
		excluded_item_external_ids: change.excludedItemExternalIds,
		cost_stamps: change.costStamps,
		cost_points: change.costPoints,
		min_bill_amount: change.minBillAmount,
		valid_from: change.validFrom,
		valid_until: change.validUntil,
		valid_days: change.validDays,
		hold_hours: change.holdHours,
		per_member_limit: change.perMemberLimit,
		store_ids: change.storeIds,
	};
}

async function writtenRewards(
	request: PromiseLike<{ data: unknown; error: PostgrestFailure | null }>,
): Promise<RewardRow[]> {
	let result: { data: unknown; error: PostgrestFailure | null };
	try {
		result = await request;
	} catch {
		throw new SettingsWriteError("network");
	}
	if (result.error !== null) throw rewardWriteError(result.error);
	return z.array(rewardRow).parse(result.data ?? []);
}

function approvalAuthorOf(
	approvedBy: string | null,
	userId: string | null,
	members: readonly MemberRoleRow[],
): ApprovalAuthor {
	if (approvedBy === null) return { kind: "system" };
	const author = auditAuthorOf(approvedBy, userId, members);
	if (author.kind === "you") return author;
	return author.kind === "member" && author.role === "owner"
		? { kind: "owner" }
		: { kind: "unknown" };
}

export function createSupabaseRewardsSource(
	client: SupabaseClient,
): RewardsSource {
	const audits = createSupabaseAudits(client);
	const context = async (tenantId: string) => {
		const [userId, members] = await Promise.all([
			audits.currentUserId().catch(() => null),
			audits.memberRoles(tenantId).catch((): MemberRoleRow[] => []),
		]);
		return {
			recordOf: (row: RewardRow): RewardRecord => ({
				id: row.id,
				programmeId: row.programme_id,
				rewardKey: row.reward_key,
				name: row.name,
				description: row.description,
				rewardKind: row.reward_kind,
				rewardPercent: row.reward_percent,
				rewardAmount: row.reward_amount,
				rewardItemExternalIds: row.reward_item_external_ids,
				excludedItemExternalIds: row.excluded_item_external_ids,
				costStamps: row.cost_stamps,
				costPoints: row.cost_points,
				minBillAmount: row.min_bill_amount,
				validFrom: row.valid_from,
				validUntil: row.valid_until,
				validDays: row.valid_days,
				holdHours: row.hold_hours,
				perMemberLimit: row.per_member_limit,
				storeIds: row.store_ids,
				status: row.status,
				approval:
					row.approved_at === null
						? null
						: {
								at: row.approved_at,
								by: approvalAuthorOf(row.approved_by, userId, members),
							},
				createdAt: row.created_at,
				audit: {
					changedAt: row.updated_at,
					author: auditAuthorOf(row.updated_by, userId, members),
				},
			}),
		};
	};
	return {
		kind: "supabase",
		async rewards(tenantId) {
			const [rows, made] = await Promise.all([
				fetchAllPages(
					rewardRow,
					(from, to) =>
						client
							.from("coupons")
							.select(REWARD_SELECT)
							.eq("tenant_id", tenantId)
							.order("created_at")
							.order("id")
							.range(from, to),
					READ_PAGE,
				),
				context(tenantId),
			]);
			return rows.map(made.recordOf);
		},
		async rails(tenantId) {
			const [rails, mappings] = await Promise.all([
				fetchAllPages(
					railRow,
					(from, to) =>
						client
							.from("coupon_rails")
							.select("store_id,rail,active_from")
							.eq("tenant_id", tenantId)
							.is("active_until", null)
							.order("store_id")
							.range(from, to),
					READ_PAGE,
				),
				fetchAllPages(
					mappingRow,
					(from, to) =>
						client
							.from("coupon_rail_rewards")
							.select(
								"id,store_id,reward_key,pos_discount_name,pos_free_item_external_id,crm_programme_external_id,einvoice_display",
							)
							.eq("tenant_id", tenantId)
							.eq("active", true)
							.order("id")
							.range(from, to),
					READ_PAGE,
				),
			]);
			return {
				rails: rails.map((row) => ({
					storeId: row.store_id,
					rail: row.rail,
					activeFrom: row.active_from,
				})),
				mappings: mappings.map((row) => ({
					storeId: row.store_id,
					rewardKey: row.reward_key,
					posDiscountName: row.pos_discount_name,
					posFreeItemExternalId: row.pos_free_item_external_id,
					crmProgrammeExternalId: row.crm_programme_external_id,
					einvoiceDisplay: row.einvoice_display,
				})),
			};
		},
		async discountDays(_tenantId, rewardId, year) {
			const rows = await fetchOnce(
				discountDaysRow,
				client.rpc("coupon_discount_days", {
					p_coupon_id: rewardId,
					p_calendar_year: year,
				}),
			);
			return rows.map((row) => ({
				itemExternalId: row.item_external_id,
				itemName: row.item_name,
				priceDiscountDays: row.price_discount_days,
				giftDays: row.gift_days,
				voucherDays: row.voucher_days,
				limitDays: row.limit_days,
				overLimit: row.over_limit,
			}));
		},
		async saveReward(tenantId, change) {
			const columns = rewardColumnsOf(change);
			const request =
				change.id === null
					? client
							.from("coupons")
							.insert({ tenant_id: tenantId, ...columns })
							.select(REWARD_SELECT)
					: client
							.from("coupons")
							.update(columns)
							.eq("tenant_id", tenantId)
							.eq("id", change.id)
							.select(REWARD_SELECT);
			const row = onlyRow(await writtenRewards(request));
			return (await context(tenantId)).recordOf(row);
		},
		async setStatus(tenantId, change) {
			const row = onlyRow(
				await writtenRewards(
					client
						.from("coupons")
						.update({ status: change.status })
						.eq("tenant_id", tenantId)
						.eq("id", change.id)
						.select(REWARD_SELECT),
				),
			);
			return (await context(tenantId)).recordOf(row);
		},
	};
}
