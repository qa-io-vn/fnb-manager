import { readStoredJson, writeStoredJson } from "../lib/storage";
import {
	afterCursor,
	newestFirst,
	PLAN_PAGE_SIZE,
	type PlanDetail,
	type PlanSource,
	PlanSourceError,
	type PlanSummary,
} from "./source";

export const DEMO_PLANS_KEY = "fnb.demo-plans";

export interface DemoPlanOptions {
	readonly tenantId: string;
	readonly seed: () => Promise<PlanDetail | null>;
	readonly now?: () => Date;
	readonly newId?: () => string;
}

interface StoredDemoPlan extends PlanDetail {
	readonly tenantId: string;
	readonly removed?: boolean;
}

function isStoredList(value: unknown): StoredDemoPlan[] | undefined {
	return Array.isArray(value) ? (value as StoredDemoPlan[]) : undefined;
}

function strip(plan: StoredDemoPlan): PlanSummary {
	const {
		content: _content,
		pack: _pack,
		tenantId: _tenant,
		removed: _removed,
		...summary
	} = plan;
	return summary;
}

export function createDemoPlanSource(options: DemoPlanOptions): PlanSource {
	const now = options.now ?? (() => new Date());
	const newId = options.newId ?? (() => crypto.randomUUID());
	let seeded: Promise<void> | null = null;
	const read = () =>
		readStoredJson(DEMO_PLANS_KEY, isStoredList, "session") ?? [];
	const write = (plans: readonly StoredDemoPlan[]) =>
		writeStoredJson(DEMO_PLANS_KEY, plans, "session");
	const ensureSeed = () => {
		seeded ??= (async () => {
			if (read().some((plan) => plan.tenantId === options.tenantId)) return;
			const sample = await options.seed();
			if (sample === null) return;
			write([...read(), { ...sample, tenantId: options.tenantId }]);
		})();
		return seeded;
	};
	const live = async () => {
		await ensureSeed();
		return read().filter(
			(plan) => plan.tenantId === options.tenantId && plan.removed !== true,
		);
	};
	const update = async (
		id: string,
		change: (plan: StoredDemoPlan) => StoredDemoPlan,
	) => {
		await ensureSeed();
		write(read().map((plan) => (plan.id === id ? change(plan) : plan)));
	};
	return {
		kind: "demo",
		async list({ archived, after, limit = PLAN_PAGE_SIZE }) {
			return (await live())
				.filter((plan) => archived || plan.archivedAt === null)
				.filter((plan) => after === null || afterCursor(plan, after))
				.sort(newestFirst)
				.slice(0, limit)
				.map(strip);
		},
		async get(id) {
			const found = (await live()).find((plan) => plan.id === id);
			if (found === undefined) return null;
			const { tenantId: _tenant, removed: _removed, ...detail } = found;
			return detail;
		},
		async publish(input) {
			const plans = await live();
			const existing = plans.find(
				(plan) => plan.content === input.p_content_markdown,
			);
			if (existing !== undefined) {
				return { planId: existing.id, alreadyPublished: true };
			}
			if (input.p_store_ids.length === 0) {
				throw new PlanSourceError(
					"22023",
					"plan_stores_invalid",
					"plan_rejected",
				);
			}
			const id = newId();
			const plan: StoredDemoPlan = {
				tenantId: options.tenantId,
				id,
				title: input.p_title,
				storeIds: [...input.p_store_ids],
				createdAt: now().toISOString(),
				asOf: input.p_as_of_date,
				horizon: input.p_horizon,
				language: input.p_language,
				via: input.p_generated_via,
				kpis: input.p_kpis,
				lint: input.p_lint,
				archivedAt: null,
				promptVersion: input.p_prompt_version,
				packId: input.p_pack_id,
				content: input.p_content_markdown,
				pack: input.p_data_pack,
			};
			write([...read(), plan]);
			return { planId: id, alreadyPublished: false };
		},
		async rename(id, title) {
			await update(id, (plan) => ({ ...plan, title }));
		},
		async setArchived(id, archived) {
			const at = archived ? now().toISOString() : null;
			await update(id, (plan) => ({ ...plan, archivedAt: at }));
		},
		async remove(id) {
			await update(id, (plan) => ({ ...plan, removed: true }));
		},
	};
}
