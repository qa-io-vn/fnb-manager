import type {
	DataPack,
	Horizon,
	PackLanguage,
	PlanLintSummary,
	PlanPublishInput,
	PlanVia,
	StoredKpi,
} from "@fnb/datapack";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { IsoDate } from "../lib/business-dates";

export const PLAN_PAGE_SIZE = 50;

export interface PlanLintStored {
	readonly summary?: Partial<PlanLintSummary>;
	readonly warnings?: readonly string[];
}

export interface PlanSummary {
	readonly id: string;
	readonly title: string;
	readonly storeIds: readonly string[];
	readonly createdAt: string;
	readonly asOf: IsoDate;
	readonly horizon: Horizon;
	readonly language: PackLanguage;
	readonly via: PlanVia;
	readonly kpis: Readonly<Record<string, StoredKpi>>;
	readonly lint: PlanLintStored;
	readonly archivedAt: string | null;
	readonly promptVersion: string;
	readonly packId: string;
}

export interface PlanDetail extends PlanSummary {
	readonly content: string;
	readonly pack: DataPack;
}

export interface PlanCursor {
	readonly createdAt: string;
	readonly id: string;
}

export interface PlanListQuery {
	readonly tenantId: string;
	readonly archived: boolean;
	readonly after: PlanCursor | null;
	readonly limit?: number;
}

export interface PublishOutcome {
	readonly planId: string;
	readonly alreadyPublished: boolean;
}

export class PlanSourceError extends Error {
	readonly code: string | null;
	readonly details: string | null;

	constructor(code: string | null, details: string | null, message: string) {
		super(message);
		this.name = "PlanSourceError";
		this.code = code;
		this.details = details;
	}
}

export interface PlanSource {
	readonly kind: "supabase" | "demo";
	list(query: PlanListQuery): Promise<PlanSummary[]>;
	get(id: string): Promise<PlanDetail | null>;
	publish(input: PlanPublishInput): Promise<PublishOutcome>;
	rename(id: string, title: string): Promise<void>;
	setArchived(id: string, archived: boolean, now?: Date): Promise<void>;
	remove(id: string): Promise<void>;
}

export const PLAN_LIST_COLUMNS =
	"id,title,store_ids,created_at,as_of_date,horizon,language,generated_via,kpis,lint,archived_at,prompt_version,pack_id";
export const PLAN_DETAIL_COLUMNS = `${PLAN_LIST_COLUMNS},content_markdown,data_pack`;

type Row = Record<string, unknown>;

export function summaryOf(row: Row): PlanSummary {
	return {
		id: String(row.id),
		title: String(row.title),
		storeIds: (row.store_ids as string[] | null) ?? [],
		createdAt: String(row.created_at),
		asOf: String(row.as_of_date) as IsoDate,
		horizon: row.horizon as Horizon,
		language: row.language as PackLanguage,
		via: row.generated_via as PlanVia,
		kpis: (row.kpis as Record<string, StoredKpi> | null) ?? {},
		lint: (row.lint as PlanLintStored | null) ?? {},
		archivedAt: (row.archived_at as string | null) ?? null,
		promptVersion: String(row.prompt_version),
		packId: String(row.pack_id),
	};
}

function detailOf(row: Row): PlanDetail {
	return {
		...summaryOf(row),
		content: String(row.content_markdown),
		pack: row.data_pack as DataPack,
	};
}

export function keysetFilter(cursor: PlanCursor): string {
	return `created_at.lt."${cursor.createdAt}",and(created_at.eq."${cursor.createdAt}",id.lt.${cursor.id})`;
}

function failure(error: {
	code?: string;
	details?: string | null;
	message: string;
}): PlanSourceError {
	return new PlanSourceError(
		error.code ?? null,
		error.details ?? null,
		error.message,
	);
}

export function createSupabasePlanSource(client: SupabaseClient): PlanSource {
	const table = () => client.from("strategy_reports");
	return {
		kind: "supabase",
		async list({ tenantId, archived, after, limit = PLAN_PAGE_SIZE }) {
			let query = table()
				.select(PLAN_LIST_COLUMNS)
				.eq("tenant_id", tenantId)
				.order("created_at", { ascending: false })
				.order("id", { ascending: false })
				.limit(limit);
			if (!archived) query = query.is("archived_at", null);
			if (after !== null) query = query.or(keysetFilter(after));
			const { data, error } = await query;
			if (error) throw failure(error);
			return ((data ?? []) as Row[]).map(summaryOf);
		},
		async get(id) {
			const { data, error } = await table()
				.select(PLAN_DETAIL_COLUMNS)
				.eq("id", id)
				.maybeSingle();
			if (error) throw failure(error);
			return data === null ? null : detailOf(data as Row);
		},
		async publish(input) {
			const { data, error } = await client.rpc("publish_strategy_plan", {
				...input,
			});
			if (error) throw failure(error);
			const row = (Array.isArray(data) ? data[0] : data) as Row | undefined;
			if (row === undefined) {
				throw new PlanSourceError(null, null, "no plan id returned");
			}
			return {
				planId: String(row.plan_id),
				alreadyPublished: row.already_published === true,
			};
		},
		async rename(id, title) {
			const { error } = await table().update({ title }).eq("id", id);
			if (error) throw failure(error);
		},
		async setArchived(id, archived, now = new Date()) {
			const { error } = await table()
				.update({ archived_at: archived ? now.toISOString() : null })
				.eq("id", id);
			if (error) throw failure(error);
		},
		async remove(id) {
			const { error } = await table().delete().eq("id", id);
			if (error) throw failure(error);
		},
	};
}

export function newestFirst(left: PlanSummary, right: PlanSummary): number {
	if (left.createdAt !== right.createdAt) {
		return left.createdAt < right.createdAt ? 1 : -1;
	}
	return left.id < right.id ? 1 : left.id > right.id ? -1 : 0;
}

export function afterCursor(plan: PlanSummary, cursor: PlanCursor): boolean {
	return (
		plan.createdAt < cursor.createdAt ||
		(plan.createdAt === cursor.createdAt && plan.id < cursor.id)
	);
}
