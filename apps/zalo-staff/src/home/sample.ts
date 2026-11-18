import {
	DEFAULT_REVENUE_VISIBILITY,
	isRevenueVisibility,
	memberStores,
	type OpeningHours,
	type RevenueVisibility,
	readOpeningHours,
	revenueAccess,
	storeDays,
} from "./model";
import {
	checkKey,
	type HomeSource,
	homeStores,
	type StoreFacts,
	type StoreFigures,
} from "./source";

export const SAMPLE_CURRENCY = "VND";
export const SAMPLE_TIME_ZONE = "Asia/Ho_Chi_Minh";
export const SAMPLE_SYNC_AGE_MINUTES = 6;
const MAX_SAMPLE_DELAY_MS = 10_000;
const MILLISECONDS_PER_MINUTE = 60_000;

interface SampleStore extends StoreFacts {
	readonly net: number;
	readonly invoices: number;
	readonly yesterdayVerified: boolean;
}

function everyDay(spans: readonly (readonly [string, string])[]): OpeningHours {
	return readOpeningHours(
		Object.fromEntries(
			["mon", "tue", "wed", "thu", "fri", "sat", "sun"].map((day) => [
				day,
				spans,
			]),
		),
	);
}

export const SAMPLE_STORES: readonly SampleStore[] = [
	{
		id: "00000000-0000-4000-8000-0000000005a1",
		name: "Cửa hàng Mẫu 1",
		timeZone: SAMPLE_TIME_ZONE,
		businessDayStartMinutes: 0,
		openingHours: everyDay([["07:00", "22:00"]]),
		net: 12_450_000,
		invoices: 186,
		yesterdayVerified: true,
	},
	{
		id: "00000000-0000-4000-8000-0000000005a2",
		name: "Cửa hàng Mẫu 2",
		timeZone: SAMPLE_TIME_ZONE,
		businessDayStartMinutes: 0,
		openingHours: everyDay([
			["06:30", "11:00"],
			["16:00", "22:30"],
		]),
		net: 8_320_500,
		invoices: 121,
		yesterdayVerified: false,
	},
];

export interface SampleSettings {
	readonly visibility: RevenueVisibility;
	readonly delayMs: number;
}

export function sampleSettingsFrom(search: string): SampleSettings {
	const params = new URLSearchParams(search);
	const visibility = params.get("revenue");
	const delay = Number(params.get("dataDelay") ?? "0");
	return {
		visibility: isRevenueVisibility(visibility)
			? visibility
			: DEFAULT_REVENUE_VISIBILITY,
		delayMs:
			Number.isInteger(delay) && delay > 0
				? Math.min(delay, MAX_SAMPLE_DELAY_MS)
				: 0,
	};
}

function wait(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

export function createSampleHomeSource(settings: SampleSettings): HomeSource {
	return {
		async load(query, now) {
			if (settings.delayMs > 0) await wait(settings.delayMs);
			const access = revenueAccess(query.role, settings.visibility);
			const stores = memberStores(
				SAMPLE_STORES,
				query.storeIds,
				query.storeNames,
			);
			const figures: StoreFigures = {
				totals: new Map(
					stores.map((store) => [
						store.id,
						{
							date: storeDays(now, store).today,
							net: store.net,
							invoices: store.invoices,
						},
					]),
				),
				matched: new Set(
					stores
						.filter((store) => store.yesterdayVerified)
						.map((store) =>
							checkKey(store.id, storeDays(now, store).yesterday),
						),
				),
			};
			const finishedAt = new Date(
				Math.floor(now.getTime() / MILLISECONDS_PER_MINUTE) *
					MILLISECONDS_PER_MINUTE -
					SAMPLE_SYNC_AGE_MINUTES * MILLISECONDS_PER_MINUTE,
			);
			return {
				access,
				currencyCode: SAMPLE_CURRENCY,
				timeZone: SAMPLE_TIME_ZONE,
				freshness: { kind: "synced", finishedAt },
				loadedAt: now,
				stores: homeStores(stores, access, figures, now),
			};
		},
	};
}
