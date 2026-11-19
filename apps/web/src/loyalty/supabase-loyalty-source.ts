import {
	LOYALTY_ENTRY_KINDS,
	LOYALTY_PROGRAMME_STATUSES,
	LOYALTY_REFUSAL_REASONS,
	type LoyaltyParameters,
	MATCHED_PATHS,
	NOTIFICATION_DECISIONS,
	normalizeLoyaltyPhone,
} from "@fnb/core";
import type { IsoDate } from "@fnb/reports";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import {
	fetchAllByKey,
	fetchOnce,
	type QueryResult,
	quotedFilterValue,
} from "../data/paginate";
import { addDays } from "../lib/business-dates";
import { SettingsWriteError } from "../settings/source";
import {
	createSupabaseAudits,
	nullableNumeric,
	numeric,
	onlyRow,
	type PostgrestFailure,
	writeErrorOf,
} from "../settings/supabase-common";
import { phoneTail, samePhone } from "./mask-phone";
import { PARAMETER_COLUMNS, refusedProgrammeField } from "./programme-columns";
import {
	type AnomalyInputs,
	type CustomerSource,
	type InvoiceReference,
	type LedgerEntryRow,
	type LoyaltyProgrammeChange,
	type LoyaltyProgrammeRecord,
	type LoyaltySource,
	LoyaltyWriteError,
	MEMBERSHIP_STATUSES,
	type MemberRow,
	QUEUE_REASONS,
	QUEUE_STATES,
	type QueueItemRow,
	type StaffPhoneRow,
} from "./source";

export const ID_CHUNK = 100;
export const READ_PAGE = 1_000;
export const CLOSED_QUEUE_ITEMS = 100;

const PARAMETER_SELECT = Object.values(PARAMETER_COLUMNS).join(",");

export const PROGRAMME_SELECT = `id,name,starts_on,ends_on,reward_budget_amount,status,notification_decision,notification_decided_at,notification_basis,created_at,updated_at,updated_by,${PARAMETER_SELECT}`;

const programmeRow = z.object({
	id: z.string(),
	name: z.string(),
	starts_on: z.string(),
	ends_on: z.string().nullable(),
	reward_budget_amount: numeric,
	status: z.enum(LOYALTY_PROGRAMME_STATUSES),
	notification_decision: z.enum(NOTIFICATION_DECISIONS),
	notification_decided_at: z.string().nullable(),
	notification_basis: z.string().nullable(),
	created_at: z.string(),
	updated_at: z.string(),
	updated_by: z.string().nullable(),
	stamps_per_card: numeric,
	stamp_min_bill_amount: numeric,
	welcome_stamps: numeric,
	point_unit_amount: numeric,
	points_per_unit: numeric,
	stamp_validity_months: numeric,
	points_expiry_months: numeric,
	earning_invoices_per_phone_per_day: numeric,
	checkin_window_before_minutes: numeric,
	checkin_window_after_minutes: numeric,
	checkin_code_ttl_seconds: numeric,
	checkin_pending_hours: numeric,
	receipt_claim_window_hours: numeric,
	receipt_claims_per_phone_per_day: numeric,
	excluded_order_sources: z.array(z.string()),
	point_value_amount: numeric,
	expected_breakage_rate: numeric,
});

type ProgrammeRow = z.infer<typeof programmeRow>;

const STAFF_PHONE_SELECT = "id,phone,label,created_at";

const staffPhoneRow = z.object({
	id: z.string(),
	phone: z.string(),
	label: z.string().nullable(),
	created_at: z.string(),
});

const customerEmbed = z
	.object({ phone: z.string().nullable() })
	.nullable()
	.optional();

const MEMBER_SELECT =
	"id,programme_id,joined_at,status,channel,customer:customers(phone)";

const memberRow = z.object({
	id: z.string(),
	programme_id: z.string(),
	joined_at: z.string(),
	status: z.enum(MEMBERSHIP_STATUSES),
	channel: z.string(),
	customer: customerEmbed,
});

const INVOICE_COLUMNS =
	"id,external_id,receipt_no,business_date,sold_at,net_amount,shift_external_id";

const invoiceRow = z.object({
	id: z.string(),
	external_id: z.string(),
	receipt_no: z.string().nullable(),
	business_date: z.string(),
	sold_at: z.string(),
	net_amount: numeric,
	shift_external_id: z.string().nullable(),
});

const LEDGER_SELECT = `id,membership_id,store_id,entry_kind,stamp_delta,point_delta,value_amount,business_date,matched_path,pending,source_entry_id,reason,occurred_at,expires_at,invoice:invoices(${INVOICE_COLUMNS})`;

const ledgerRow = z.object({
	id: z.string(),
	membership_id: z.string(),
	store_id: z.string().nullable(),
	entry_kind: z.enum(LOYALTY_ENTRY_KINDS),
	stamp_delta: numeric,
	point_delta: numeric,
	value_amount: numeric,
	business_date: z.string().nullable(),
	matched_path: z.enum(MATCHED_PATHS).nullable(),
	pending: z.boolean(),
	source_entry_id: z.string().nullable(),
	reason: z.string().nullable(),
	occurred_at: z.string(),
	expires_at: z.string().nullable(),
	invoice: invoiceRow.nullable().optional(),
});

const QUEUE_SELECT =
	"id,store_id,membership_id,matched_path,candidate_invoice_ids,reason,state,created_at,resolved_at,resolved_by,chosen_invoice_id,resolution_reason,entry_id,membership:memberships(customer:customers(phone)),checkin:pending_checkins(recorded_at,amount),claim:receipt_claims(receipt_no,amount,business_date)";

const queueRow = z.object({
	id: z.string(),
	store_id: z.string(),
	membership_id: z.string(),
	matched_path: z.enum(["B", "C"]),
	candidate_invoice_ids: z.array(z.string()),
	reason: z.enum(QUEUE_REASONS),
	state: z.enum(QUEUE_STATES),
	created_at: z.string(),
	resolved_at: z.string().nullable(),
	resolved_by: z.string().nullable(),
	chosen_invoice_id: z.string().nullable(),
	resolution_reason: z.string().nullable(),
	entry_id: z.string().nullable(),
	membership: z.object({ customer: customerEmbed }).nullable().optional(),
	checkin: z
		.object({ recorded_at: z.string().nullable(), amount: nullableNumeric })
		.nullable()
		.optional(),
	claim: z
		.object({
			receipt_no: z.string(),
			amount: numeric,
			business_date: z.string(),
		})
		.nullable()
		.optional(),
});

const queueOutcome = z.object({
	state: z.enum(["resolved", "dismissed"]),
	entry_id: z.string().nullable(),
	refusal: z.enum(LOYALTY_REFUSAL_REASONS).nullable(),
});

const shiftRow = z.object({
	id: z.string(),
	store_id: z.string(),
	external_id: z.string(),
	opened_at: z.string(),
	closed_at: z.string().nullable(),
});

const shiftInvoice = z
	.object({
		shift_external_id: z.string().nullable(),
		sold_at: z.string(),
	})
	.nullable()
	.optional();

const earnRow = z.object({
	id: z.string(),
	store_id: z.string(),
	business_date: z.string(),
	matched_path: z.enum(MATCHED_PATHS).nullable(),
	invoice: shiftInvoice,
});

const refusalRow = z.object({
	id: z.string(),
	store_id: z.string(),
	business_date: z.string(),
	reason: z.enum(LOYALTY_REFUSAL_REASONS),
	invoice: shiftInvoice,
});

const adjustmentRow = z.object({
	id: z.string(),
	store_id: z.string(),
	occurred_at: z.string(),
});

const checkinRow = z.object({
	id: z.string(),
	store_id: z.string(),
	recorded_at: z.string(),
});

function chunks<T>(values: readonly T[], size: number): T[][] {
	const result: T[][] = [];
	for (let index = 0; index < values.length; index += size) {
		result.push(values.slice(index, index + size));
	}
	return result;
}

function parametersOf(row: ProgrammeRow): LoyaltyParameters {
	return {
		stampsPerCard: row.stamps_per_card,
		stampMinBillAmount: row.stamp_min_bill_amount,
		welcomeStamps: row.welcome_stamps,
		pointUnitAmount: row.point_unit_amount,
		pointsPerUnit: row.points_per_unit,
		stampValidityMonths: row.stamp_validity_months,
		pointsExpiryMonths: row.points_expiry_months,
		earningInvoicesPerPhonePerDay: row.earning_invoices_per_phone_per_day,
		checkinWindowBeforeMinutes: row.checkin_window_before_minutes,
		checkinWindowAfterMinutes: row.checkin_window_after_minutes,
		checkinCodeTtlSeconds: row.checkin_code_ttl_seconds,
		checkinPendingHours: row.checkin_pending_hours,
		receiptClaimWindowHours: row.receipt_claim_window_hours,
		receiptClaimsPerPhonePerDay: row.receipt_claims_per_phone_per_day,
		excludedOrderSources: row.excluded_order_sources,
		pointValueAmount: row.point_value_amount,
		expectedBreakageRate: row.expected_breakage_rate,
	};
}

export function programmeColumnsOf(
	change: LoyaltyProgrammeChange,
): Record<string, unknown> {
	const parameters = Object.fromEntries(
		(Object.keys(PARAMETER_COLUMNS) as (keyof LoyaltyParameters)[]).map(
			(field) => [PARAMETER_COLUMNS[field], change.parameters[field]],
		),
	);
	return {
		name: change.name,
		starts_on: change.startsOn,
		ends_on: change.endsOn,
		reward_budget_amount: change.rewardBudgetAmount,
		status: change.status,
		notification_decision: change.notificationDecision,
		notification_basis: change.notificationBasis,
		notification_decided_at: change.notificationDecidedAt,
		...parameters,
	};
}

export function programmeWriteError(
	error: PostgrestFailure,
): SettingsWriteError {
	if (error.code === "22023") {
		const refusal = refusedProgrammeField(error.message);
		return new LoyaltyWriteError("invalid", refusal.field, refusal.hold);
	}
	if (
		error.code === "23505" &&
		/one_active_per_tenant/.test(
			`${error.message ?? ""} ${error.details ?? ""}`,
		)
	) {
		return new LoyaltyWriteError("duplicate", "status");
	}
	return writeErrorOf(error);
}

async function writtenWith<Row>(
	schema: z.ZodType<Row>,
	request: PromiseLike<{ data: unknown; error: PostgrestFailure | null }>,
	errorOf: (error: PostgrestFailure) => SettingsWriteError = writeErrorOf,
): Promise<Row[]> {
	let result: { data: unknown; error: PostgrestFailure | null };
	try {
		result = await request;
	} catch {
		throw new SettingsWriteError("network");
	}
	if (result.error !== null) throw errorOf(result.error);
	return z.array(schema).parse(result.data ?? []);
}

function invoiceOf(row: z.infer<typeof invoiceRow>): InvoiceReference {
	return {
		id: row.id,
		externalId: row.external_id,
		receiptNo: row.receipt_no,
		businessDate: row.business_date,
		soldAt: row.sold_at,
		netAmount: row.net_amount,
		shiftExternalId: row.shift_external_id,
	};
}

function memberOf(row: z.infer<typeof memberRow>): MemberRow {
	return {
		membershipId: row.id,
		programmeId: row.programme_id,
		phone: row.customer?.phone ?? null,
		joinedAt: row.joined_at,
		status: row.status,
		channel: row.channel,
	};
}

function ledgerEntryOf(row: z.infer<typeof ledgerRow>): LedgerEntryRow {
	return {
		id: row.id,
		membershipId: row.membership_id,
		storeId: row.store_id,
		entryKind: row.entry_kind,
		stampDelta: row.stamp_delta,
		pointDelta: row.point_delta,
		valueAmount: row.value_amount,
		invoice: row.invoice == null ? null : invoiceOf(row.invoice),
		businessDate: row.business_date,
		matchedPath: row.matched_path,
		pending: row.pending,
		sourceEntryId: row.source_entry_id,
		reason: row.reason,
		occurredAt: row.occurred_at,
		expiresAt: row.expires_at,
	};
}

function windowOf(from: IsoDate, to: IsoDate) {
	return {
		start: `${addDays(from, -1)}T00:00:00Z`,
		end: `${addDays(to, 2)}T00:00:00Z`,
	};
}

export function createSupabaseLoyaltySource(
	client: SupabaseClient,
): LoyaltySource {
	const audits = createSupabaseAudits(client);
	const recordOf =
		(auditOf: Awaited<ReturnType<typeof audits.auditsFor>>) =>
		(row: ProgrammeRow): LoyaltyProgrammeRecord => ({
			id: row.id,
			name: row.name,
			startsOn: row.starts_on,
			endsOn: row.ends_on,
			rewardBudgetAmount: row.reward_budget_amount,
			status: row.status,
			notificationDecision: row.notification_decision,
			notificationDecidedAt: row.notification_decided_at,
			notificationBasis: row.notification_basis,
			parameters: parametersOf(row),
			createdAt: row.created_at,
			audit: auditOf(row.updated_at, row.updated_by),
		});
	return {
		kind: "supabase",
		async programmes(tenantId) {
			const [rows, auditOf] = await Promise.all([
				fetchOnce(
					programmeRow,
					client
						.from("loyalty_programmes")
						.select(PROGRAMME_SELECT)
						.eq("tenant_id", tenantId)
						.order("created_at", { ascending: false })
						.order("id")
						.limit(READ_PAGE),
				),
				audits.auditsFor(tenantId),
			]);
			return rows.map(recordOf(auditOf));
		},
		async saveProgramme(tenantId, change) {
			const columns = programmeColumnsOf(change);
			const request =
				change.id === null
					? client
							.from("loyalty_programmes")
							.insert({ tenant_id: tenantId, ...columns })
							.select(PROGRAMME_SELECT)
					: client
							.from("loyalty_programmes")
							.update(columns)
							.eq("tenant_id", tenantId)
							.eq("id", change.id)
							.select(PROGRAMME_SELECT);
			const row = onlyRow(
				await writtenWith(programmeRow, request, programmeWriteError),
			);
			const auditOf = await audits.auditsFor(tenantId);
			return recordOf(auditOf)(row);
		},
		async staffPhones(tenantId) {
			const rows = await byId(staffPhoneRow, () =>
				client
					.from("loyalty_staff_phones")
					.select(STAFF_PHONE_SELECT)
					.eq("tenant_id", tenantId),
			);
			return rows
				.map(
					(row): StaffPhoneRow => ({
						id: row.id,
						phone: row.phone,
						label: row.label,
						createdAt: row.created_at,
					}),
				)
				.sort((left, right) =>
					left.createdAt === right.createdAt
						? left.id.localeCompare(right.id)
						: left.createdAt.localeCompare(right.createdAt),
				);
		},
		async addStaffPhone(tenantId, change) {
			const row = onlyRow(
				await writtenWith(
					staffPhoneRow,
					client
						.from("loyalty_staff_phones")
						.insert({
							tenant_id: tenantId,
							phone: change.phone,
							label: change.label,
						})
						.select(STAFF_PHONE_SELECT),
				),
			);
			return {
				id: row.id,
				phone: row.phone,
				label: row.label,
				createdAt: row.created_at,
			};
		},
		async removeStaffPhone(tenantId, id) {
			const removed = await writtenWith(
				z.object({ id: z.string() }),
				client
					.from("loyalty_staff_phones")
					.delete()
					.eq("tenant_id", tenantId)
					.eq("id", id)
					.select("id"),
			);
			if (removed.length === 0) throw new SettingsWriteError("forbidden");
		},
	};
}

async function invoicesById(
	client: SupabaseClient,
	ids: readonly string[],
): Promise<Map<string, InvoiceReference>> {
	const unique = [...new Set(ids)];
	const found = new Map<string, InvoiceReference>();
	for (const part of chunks(unique, ID_CHUNK)) {
		const rows = await fetchOnce(
			invoiceRow,
			client.from("invoices").select(INVOICE_COLUMNS).in("id", part),
		);
		for (const row of rows) found.set(row.id, invoiceOf(row));
	}
	return found;
}

function queueItemOf(
	row: z.infer<typeof queueRow>,
	invoices: ReadonlyMap<string, InvoiceReference>,
): QueueItemRow {
	return {
		id: row.id,
		storeId: row.store_id,
		membershipId: row.membership_id,
		phone: row.membership?.customer?.phone ?? null,
		matchedPath: row.matched_path,
		reason: row.reason,
		state: row.state,
		createdAt: row.created_at,
		resolvedAt: row.resolved_at,
		resolvedBy: row.resolved_by,
		chosenInvoiceId: row.chosen_invoice_id,
		resolutionReason: row.resolution_reason,
		entryId: row.entry_id,
		checkin:
			row.checkin == null
				? null
				: { recordedAt: row.checkin.recorded_at, amount: row.checkin.amount },
		claim:
			row.claim == null
				? null
				: {
						receiptNo: row.claim.receipt_no,
						amount: row.claim.amount,
						businessDate: row.claim.business_date,
					},
		candidateIds: row.candidate_invoice_ids,
		candidates: row.candidate_invoice_ids.flatMap((id) => {
			const invoice = invoices.get(id);
			return invoice === undefined ? [] : [invoice];
		}),
	};
}

interface Pageable {
	gt(column: string, value: string): Pageable;
	order(column: string): Pageable;
	limit(count: number): PromiseLike<QueryResult>;
}

function byId<Row extends { readonly id: string }>(
	schema: z.ZodType<Row>,
	build: () => Pageable,
): Promise<Row[]> {
	return fetchAllByKey(
		schema,
		(row) => row.id,
		(after, pageSize) =>
			(after === null ? build() : build().gt("id", after.id))
				.order("id")
				.limit(pageSize),
	);
}

export function createSupabaseCustomerSource(
	client: SupabaseClient,
): CustomerSource {
	return {
		kind: "supabase",
		async members(tenantId, after, pageSize) {
			let query = client
				.from("memberships")
				.select(MEMBER_SELECT)
				.eq("tenant_id", tenantId)
				.order("joined_at", { ascending: false })
				.order("id", { ascending: false })
				.limit(pageSize + 1);
			if (after !== null) {
				const joined = quotedFilterValue(after.joinedAt);
				const id = quotedFilterValue(after.membershipId);
				query = query.or(
					`joined_at.lt.${joined},and(joined_at.eq.${joined},id.lt.${id})`,
				);
			}
			const rows = (await fetchOnce(memberRow, query)).map(memberOf);
			const page = rows.slice(0, pageSize);
			const last = page.at(-1);
			return {
				rows: page,
				next:
					rows.length > pageSize && last !== undefined
						? { joinedAt: last.joinedAt, membershipId: last.membershipId }
						: null,
			};
		},
		async lookup(tenantId, phone) {
			const wanted = normalizeLoyaltyPhone(phone);
			const tail = phoneTail(wanted);
			if (wanted === null || tail === null) return [];
			const customers = await byId(
				z.object({ id: z.string(), phone: z.string().nullable() }),
				() =>
					client
						.from("customers")
						.select("id,phone")
						.eq("tenant_id", tenantId)
						.like("phone", `%${tail}`),
			);
			const matched = customers
				.filter((customer) => samePhone(customer.phone, wanted))
				.map((customer) => customer.id);
			if (matched.length === 0) return [];
			const members: MemberRow[] = [];
			for (const part of chunks(matched, ID_CHUNK)) {
				const rows = await fetchOnce(
					memberRow,
					client
						.from("memberships")
						.select(MEMBER_SELECT)
						.eq("tenant_id", tenantId)
						.in("customer_id", part)
						.order("joined_at", { ascending: false }),
				);
				members.push(...rows.map(memberOf));
			}
			return members;
		},
		async member(membershipId) {
			const rows = await fetchOnce(
				memberRow,
				client
					.from("memberships")
					.select(MEMBER_SELECT)
					.eq("id", membershipId)
					.limit(1),
			);
			const [row] = rows;
			return row === undefined ? null : memberOf(row);
		},
		async ledger(membershipIds) {
			const entries: LedgerEntryRow[] = [];
			for (const part of chunks([...new Set(membershipIds)], ID_CHUNK)) {
				const rows = await byId(ledgerRow, () =>
					client
						.from("loyalty_ledger")
						.select(LEDGER_SELECT)
						.in("membership_id", part),
				);
				entries.push(...rows.map(ledgerEntryOf));
			}
			return entries;
		},
		async queue(tenantId) {
			const [open, closed] = await Promise.all([
				byId(queueRow, () =>
					client
						.from("loyalty_queue")
						.select(QUEUE_SELECT)
						.eq("tenant_id", tenantId)
						.eq("state", "open"),
				),
				fetchOnce(
					queueRow,
					client
						.from("loyalty_queue")
						.select(QUEUE_SELECT)
						.eq("tenant_id", tenantId)
						.neq("state", "open")
						.order("resolved_at", { ascending: false })
						.order("id")
						.limit(CLOSED_QUEUE_ITEMS),
				),
			]);
			const rows = [...open, ...closed];
			const invoices = await invoicesById(
				client,
				rows.flatMap((row) => row.candidate_invoice_ids),
			);
			return rows.map((row) => queueItemOf(row, invoices));
		},
		async resolveQueueItem(resolution) {
			let result: { data: unknown; error: PostgrestFailure | null };
			try {
				result = await client.rpc("resolve_loyalty_queue_item", {
					p_item_id: resolution.itemId,
					p_choice: resolution.choice,
					p_reason: resolution.reason,
				});
			} catch {
				throw new SettingsWriteError("network");
			}
			if (result.error !== null) throw writeErrorOf(result.error);
			const outcome = queueOutcome.parse(result.data);
			return {
				state: outcome.state,
				entryId: outcome.entry_id,
				refusal: outcome.refusal,
			};
		},
		async anomalies(storeIds, from, to): Promise<AnomalyInputs> {
			if (storeIds.length === 0) {
				return {
					shifts: [],
					earns: [],
					refusals: [],
					adjustments: [],
					checkinsWithoutInvoice: [],
				};
			}
			const stores = [...storeIds];
			const window = windowOf(from, to);
			const [shifts, earns, refusals, adjustments, checkins] =
				await Promise.all([
					byId(shiftRow, () =>
						client
							.from("shifts")
							.select("id,store_id,external_id,opened_at,closed_at")
							.in("store_id", stores)
							.gte("opened_at", window.start)
							.lt("opened_at", window.end),
					),
					byId(earnRow, () =>
						client
							.from("loyalty_ledger")
							.select(
								"id,store_id,business_date,matched_path,invoice:invoices(shift_external_id,sold_at)",
							)
							.in("store_id", stores)
							.eq("entry_kind", "earn")
							.gte("business_date", from)
							.lte("business_date", to),
					),
					byId(refusalRow, () =>
						client
							.from("loyalty_refusals")
							.select(
								"id,store_id,business_date,reason,invoice:invoices(shift_external_id,sold_at)",
							)
							.in("store_id", stores)
							.gte("business_date", from)
							.lte("business_date", to),
					),
					byId(adjustmentRow, () =>
						client
							.from("loyalty_ledger")
							.select("id,store_id,occurred_at")
							.in("store_id", stores)
							.eq("entry_kind", "adjust")
							.neq("reason", "welcome")
							.gte("occurred_at", window.start)
							.lt("occurred_at", window.end),
					),
					byId(checkinRow, () =>
						client
							.from("pending_checkins")
							.select("id,store_id,recorded_at")
							.in("store_id", stores)
							.not("recorded_at", "is", null)
							.is("matched_invoice_id", null)
							.neq("status", "queued")
							.gte("recorded_at", window.start)
							.lt("recorded_at", window.end),
					),
				]);
			return {
				shifts: shifts.map((row) => ({
					id: row.id,
					storeId: row.store_id,
					externalId: row.external_id,
					openedAt: row.opened_at,
					closedAt: row.closed_at,
				})),
				earns: earns.map((row) => ({
					storeId: row.store_id,
					businessDate: row.business_date,
					matchedPath: row.matched_path,
					shiftExternalId: row.invoice?.shift_external_id ?? null,
					soldAt: row.invoice?.sold_at ?? null,
				})),
				refusals: refusals.map((row) => ({
					storeId: row.store_id,
					businessDate: row.business_date,
					reason: row.reason,
					shiftExternalId: row.invoice?.shift_external_id ?? null,
					soldAt: row.invoice?.sold_at ?? null,
				})),
				adjustments: adjustments.map((row) => ({
					storeId: row.store_id,
					at: row.occurred_at,
				})),
				checkinsWithoutInvoice: checkins.map((row) => ({
					storeId: row.store_id,
					at: row.recorded_at,
				})),
			};
		},
	};
}
