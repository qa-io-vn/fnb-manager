import type { ThemeRow } from "@fnb/reports";
import type { AggregateStore } from "../aggregates.js";
import { DEMO_TENANT_ID, type OpeningHours } from "../calendar.js";
import {
	requireThemeStoreIds,
	type ThemeHandlerArgs,
	type ThemeHandlerContext,
} from "./theme-support.js";

type Row = ThemeRow<"store_profiles">;

function openingHoursRow(hours: OpeningHours | null): Row["opening_hours"] {
	if (hours === null) return null;
	return Object.fromEntries(
		Object.entries(hours).flatMap(([weekday, spans]) =>
			spans === undefined
				? []
				: [
						[
							weekday,
							spans.map(([open, close]): [string, string] => [open, close]),
						],
					],
		),
	);
}

export function storeLabels(
	store: AggregateStore,
): ReadonlyMap<string, string> {
	const ranked = [...store.stores()].sort(
		(left, right) => left.index - right.index,
	);
	return new Map(
		ranked.map((definition, position) => [definition.id, `S${position + 1}`]),
	);
}

export function storeProfiles(
	store: AggregateStore,
	args: ThemeHandlerArgs<"store_profiles">,
	context: ThemeHandlerContext,
): Row[] {
	requireThemeStoreIds("store_profiles", args.store_ids);
	const labels = storeLabels(store);
	const tenant = context.settings.tenantProfile();
	return store.visibleStores(args.store_ids).map((definition) => {
		const profile = context.settings.storeProfile(definition.id);
		return {
			store_id: definition.id,
			tenant_id: DEMO_TENANT_ID,
			label: labels.get(definition.id) ?? `S${definition.index}`,
			name: definition.name,
			timezone: definition.timeZone,
			business_day_start_minutes: definition.businessDayStartMinutes,
			opened_on: profile?.openedOn ?? null,
			opening_hours: openingHoursRow(profile?.openingHours ?? null),
			seat_count: profile?.seatCount ?? null,
			e_invoice_status: profile?.eInvoiceStatus ?? "unknown",
			currency_code: tenant.currencyCode,
			country_code: tenant.countryCode,
		};
	});
}
