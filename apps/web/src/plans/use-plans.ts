import { asOfDate, type IsoDate, type ReportSource } from "@fnb/reports";
import { useMemo } from "react";
import { useAppMode } from "../app-mode/app-mode";
import { useSession } from "../auth/session";
import { useAnalyticsSourceState } from "../data/analytics-source-context";
import type { StoreRow } from "../data/row-source";
import { useLanguage } from "../i18n";
import type { Membership } from "../settings/source";
import { useReadyTenantScope } from "../state/tenant-scope";
import { createDemoPlanSource } from "./demo-plan-source";
import { createSupabasePlanSource, type PlanSource } from "./source";

export interface PlansContext {
	readonly plans: PlanSource;
	readonly reports: ReportSource;
	readonly stores: readonly StoreRow[];
	readonly asOfFor: (storeIds: readonly string[]) => IsoDate;
}

export function asOfForStores(
	stores: readonly StoreRow[],
	storeIds: readonly string[],
	now: Date,
): IsoDate {
	const wanted = new Set(storeIds);
	const chosen = stores.filter((store) => wanted.has(store.id));
	return asOfDate(
		(chosen.length === 0 ? stores : chosen).map((store) => ({
			timeZone: store.timeZone,
			businessDayStartMinutes: store.businessDayStartMinutes,
		})),
		now,
	);
}

export function usePlansContext(): PlansContext | null {
	const { mode } = useAppMode();
	const { client } = useSession();
	const { language } = useLanguage();
	const scope = useReadyTenantScope();
	const sourceState = useAnalyticsSourceState();
	const reports = sourceState.status === "ready" ? sourceState.source : null;
	const tenantId = scope.tenant.id;
	const stores = scope.stores;
	return useMemo(() => {
		if (reports === null) return null;
		const now = new Date();
		const asOfFor = (storeIds: readonly string[]) =>
			asOfForStores(stores, storeIds, now);
		if (mode === "demo") {
			const plans = createDemoPlanSource({
				tenantId,
				seed: () =>
					import("./demo-seed").then((module) =>
						module.demoSamplePlan({
							source: reports,
							storeIds: stores.map((store) => store.id),
							asOf: asOfFor(stores.map((store) => store.id)),
							language,
							now,
						}),
					),
			});
			return { plans, reports, stores, asOfFor };
		}
		if (client === null) return null;
		return {
			plans: createSupabasePlanSource(client),
			reports,
			stores,
			asOfFor,
		};
	}, [mode, client, reports, tenantId, stores, language]);
}

export function canReadPlans(membership: Membership | null): boolean {
	return membership !== null && membership.role !== "publisher";
}

export function canManagePlan(
	membership: Membership | null,
	storeIds: readonly string[],
): boolean {
	if (membership === null) return false;
	if (membership.role !== "owner" && membership.role !== "manager") {
		return false;
	}
	if (membership.storeIds === null) return true;
	const scope = new Set(membership.storeIds);
	return storeIds.every((id) => scope.has(id));
}

export function canPublishPlans(membership: Membership | null): boolean {
	return (
		membership !== null &&
		(membership.role === "owner" || membership.role === "manager")
	);
}
