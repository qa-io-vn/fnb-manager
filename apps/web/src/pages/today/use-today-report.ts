import { useQuery } from "@tanstack/react-query";
import type { VerificationMarker } from "../../components/report-card/types";
import type { RowSource, StoreRow, TenantRow } from "../../data/row-source";
import { computeToday, planToday, type TodayReport } from "../../metrics/today";
import { verificationOf } from "../../metrics/verification";

export interface TodayData {
	now: Date;
	report: TodayReport;
	verification: { today: VerificationMarker; yesterday: VerificationMarker };
}

export async function loadToday(
	source: RowSource,
	tenant: TenantRow,
	stores: readonly StoreRow[],
	now: Date,
): Promise<TodayData> {
	const plan = planToday(stores, now);
	const storeIds = stores.map((store) => store.id);
	const shownDates = [...new Set([...plan.todayDates, ...plan.yesterdayDates])];
	const [
		invoices,
		lines,
		payments,
		paymentMethods,
		excludedDates,
		verification,
	] = await Promise.all([
		source.invoices({ storeIds, dates: plan.requiredDates }),
		source.invoiceLines({ storeIds, dates: plan.todayDates }),
		source.payments({ storeIds, dates: plan.todayDates }),
		source.paymentMethods(tenant.id),
		source.excludedDates(tenant, plan.requiredDates),
		source.verification({ storeIds, dates: shownDates }),
	]);
	const report = computeToday(
		stores,
		{
			invoices,
			lines,
			payments,
			paymentMethods,
			excludedDates: new Set(excludedDates),
		},
		now,
	);
	return {
		now,
		report,
		verification: {
			today: verificationOf(
				verification,
				plan.stores.map((store) => ({
					storeId: store.store.id,
					date: store.today,
				})),
			),
			yesterday: verificationOf(
				verification,
				plan.stores.map((store) => ({
					storeId: store.store.id,
					date: store.yesterday,
				})),
			),
		},
	};
}

export function useTodayReport(
	source: RowSource,
	tenant: TenantRow,
	stores: readonly StoreRow[],
) {
	return useQuery({
		queryKey: [
			source.kind,
			"today",
			tenant.id,
			stores.map((store) => store.id).join(","),
		],
		queryFn: () => loadToday(source, tenant, stores, new Date()),
		staleTime: 60_000,
		refetchInterval: 5 * 60_000,
		refetchOnWindowFocus: true,
		enabled: stores.length > 0,
	});
}
