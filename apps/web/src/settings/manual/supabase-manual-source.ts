import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { fetchAllPages } from "../../data/paginate";
import { SettingsWriteError } from "../source";
import {
	type AuditOf,
	createSupabaseAudits,
	numeric,
	onlyRow,
	rereadOrNetwork,
	written,
	writtenRows,
} from "../supabase-common";
import {
	type ItemCostRow,
	LEGAL_DOCUMENT_KINDS,
	LEGAL_DOCUMENT_STATUSES,
	type LegalDocumentRow,
	type ManualSettingsSource,
	TARGET_PERIOD_KINDS,
	type TargetRow,
} from "./source";

export const ITEM_COSTS_CONFLICT =
	"tenant_id,store_id,item_external_id,effective_from";
export const TARGETS_CONFLICT = "store_id,period_kind,period_start";

const itemCostRow = z.object({
	id: z.string(),
	store_id: z.string().nullable(),
	item_external_id: z.string(),
	cost_amount: numeric,
	effective_from: z.string(),
	updated_at: z.string(),
	updated_by: z.string().nullable(),
});

const ITEM_COST_SELECT =
	"id,store_id,item_external_id,cost_amount,effective_from,updated_at,updated_by";

const targetRow = z.object({
	id: z.string(),
	store_id: z.string(),
	period_kind: z.enum(TARGET_PERIOD_KINDS),
	period_start: z.string(),
	net_target_amount: numeric,
	updated_at: z.string(),
	updated_by: z.string().nullable(),
});

const TARGET_SELECT =
	"id,store_id,period_kind,period_start,net_target_amount,updated_at,updated_by";

const legalRow = z.object({
	id: z.string(),
	kind: z.enum(LEGAL_DOCUMENT_KINDS),
	language: z.enum(["vi", "en"]),
	version: z.string(),
	title: z.string(),
	body_markdown: z.string(),
	status: z.enum(LEGAL_DOCUMENT_STATUSES),
	published_at: z.string().nullable(),
	retired_at: z.string().nullable(),
	updated_at: z.string(),
	updated_by: z.string().nullable(),
});

const LEGAL_SELECT =
	"id,kind,language,version,title,body_markdown,status,published_at,retired_at,updated_at,updated_by";

const idRow = z.object({ id: z.string() });
const statusRow = z.object({ status: z.enum(LEGAL_DOCUMENT_STATUSES) });

function itemCostOf(
	row: z.output<typeof itemCostRow>,
	auditOf: AuditOf,
): ItemCostRow {
	return {
		id: row.id,
		storeId: row.store_id,
		itemExternalId: row.item_external_id,
		costAmount: row.cost_amount,
		effectiveFrom: row.effective_from,
		audit: auditOf(row.updated_at, row.updated_by),
	};
}

function targetOf(
	row: z.output<typeof targetRow>,
	auditOf: AuditOf,
): TargetRow {
	return {
		id: row.id,
		storeId: row.store_id,
		periodKind: row.period_kind,
		periodStart: row.period_start,
		netTargetAmount: row.net_target_amount,
		audit: auditOf(row.updated_at, row.updated_by),
	};
}

function legalOf(
	row: z.output<typeof legalRow>,
	auditOf: AuditOf,
): LegalDocumentRow {
	return {
		id: row.id,
		kind: row.kind,
		language: row.language,
		version: row.version,
		title: row.title,
		bodyMarkdown: row.body_markdown,
		status: row.status,
		publishedAt: row.published_at,
		retiredAt: row.retired_at,
		audit: auditOf(row.updated_at, row.updated_by),
	};
}

export function createSupabaseManualSource(
	client: SupabaseClient,
): ManualSettingsSource {
	const audits = createSupabaseAudits(client);

	const deletedOrRefused = async (
		table: string,
		tenantId: string,
		id: string,
	): Promise<void> => {
		const removed = await writtenRows(
			idRow,
			client
				.from(table)
				.delete()
				.eq("tenant_id", tenantId)
				.eq("id", id)
				.select("id"),
		);
		if (removed.length > 0) return;
		const remaining = await rereadOrNetwork(
			idRow,
			client.from(table).select("id").eq("tenant_id", tenantId).eq("id", id),
		);
		if (remaining.length > 0) throw new SettingsWriteError("forbidden");
	};

	return {
		kind: "supabase",

		async itemCosts(tenantId): Promise<ItemCostRow[]> {
			const [rows, auditsOf] = await Promise.all([
				fetchAllPages(itemCostRow, (from, to) =>
					client
						.from("item_costs")
						.select(ITEM_COST_SELECT)
						.eq("tenant_id", tenantId)
						.order("item_external_id")
						.order("store_id", { nullsFirst: true })
						.order("effective_from")
						.order("id")
						.range(from, to),
				),
				audits.auditsFor(tenantId),
			]);
			return rows.map((row) => itemCostOf(row, auditsOf));
		},

		async saveItemCosts(tenantId, rows): Promise<ItemCostRow[]> {
			if (rows.length === 0) return [];
			const saved = await writtenRows(
				itemCostRow,
				client
					.from("item_costs")
					.upsert(
						rows.map((row) => ({
							tenant_id: tenantId,
							store_id: row.storeId,
							item_external_id: row.itemExternalId,
							cost_amount: row.costAmount,
							effective_from: row.effectiveFrom,
						})),
						{ onConflict: ITEM_COSTS_CONFLICT },
					)
					.select(ITEM_COST_SELECT),
			);
			const auditsOf = await audits.auditsFor(tenantId);
			return saved.map((row) => itemCostOf(row, auditsOf));
		},

		deleteItemCost(tenantId, id) {
			return deletedOrRefused("item_costs", tenantId, id);
		},

		async targets(tenantId): Promise<TargetRow[]> {
			const [rows, auditsOf] = await Promise.all([
				fetchAllPages(targetRow, (from, to) =>
					client
						.from("targets")
						.select(TARGET_SELECT)
						.eq("tenant_id", tenantId)
						.order("store_id")
						.order("period_kind")
						.order("period_start")
						.order("id")
						.range(from, to),
				),
				audits.auditsFor(tenantId),
			]);
			return rows.map((row) => targetOf(row, auditsOf));
		},

		async saveTargets(tenantId, rows): Promise<TargetRow[]> {
			if (rows.length === 0) return [];
			const saved = await writtenRows(
				targetRow,
				client
					.from("targets")
					.upsert(
						rows.map((row) => ({
							tenant_id: tenantId,
							store_id: row.storeId,
							period_kind: row.periodKind,
							period_start: row.periodStart,
							net_target_amount: row.netTargetAmount,
						})),
						{ onConflict: TARGETS_CONFLICT },
					)
					.select(TARGET_SELECT),
			);
			const auditsOf = await audits.auditsFor(tenantId);
			return saved.map((row) => targetOf(row, auditsOf));
		},

		async legalDocuments(tenantId): Promise<LegalDocumentRow[]> {
			const [rows, auditsOf] = await Promise.all([
				fetchAllPages(legalRow, (from, to) =>
					client
						.from("legal_documents")
						.select(LEGAL_SELECT)
						.eq("tenant_id", tenantId)
						.order("kind")
						.order("language")
						.order("version")
						.order("id")
						.range(from, to),
				),
				audits.auditsFor(tenantId),
			]);
			return rows.map((row) => legalOf(row, auditsOf));
		},

		async saveLegalDraft(tenantId, change): Promise<LegalDocumentRow> {
			const text = {
				version: change.version,
				title: change.title,
				body_markdown: change.bodyMarkdown,
			};
			const rows =
				change.id === undefined
					? await writtenRows(
							legalRow,
							client
								.from("legal_documents")
								.insert({
									tenant_id: tenantId,
									kind: change.kind,
									language: change.language,
									...text,
								})
								.select(LEGAL_SELECT),
						)
					: await writtenRows(
							legalRow,
							client
								.from("legal_documents")
								.update(text)
								.eq("tenant_id", tenantId)
								.eq("id", change.id)
								.select(LEGAL_SELECT),
						);
			return legalOf(onlyRow(rows), await audits.auditsFor(tenantId));
		},

		async publishLegalDocument(_tenantId, id) {
			await written(
				client.rpc("publish_legal_document", { p_document_id: id }),
			);
		},

		async retireLegalDocument(_tenantId, id) {
			await written(client.rpc("retire_legal_document", { p_document_id: id }));
		},

		async deleteLegalDraft(tenantId, id) {
			const removed = await writtenRows(
				idRow,
				client
					.from("legal_documents")
					.delete()
					.eq("tenant_id", tenantId)
					.eq("id", id)
					.select("id"),
			);
			if (removed.length > 0) return;
			const [remaining] = await rereadOrNetwork(
				statusRow,
				client
					.from("legal_documents")
					.select("status")
					.eq("tenant_id", tenantId)
					.eq("id", id),
			);
			if (remaining === undefined) return;
			throw new SettingsWriteError(
				remaining.status === "draft" ? "forbidden" : "frozen",
			);
		},
	};
}
