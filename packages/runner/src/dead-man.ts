import {
	businessDate,
	businessDayEnd,
	businessDayStart,
	shiftIsoDate,
} from "@fnb/core";
import type { StoreRecord } from "@fnb/sync";
import type { RunnerDatabase } from "./database.js";
import {
	type Notifier,
	notifySafely,
	staleSyncNotification,
} from "./notifier.js";

export const DEAD_MAN_THRESHOLD_MINUTES = 90;

export function isStale(
	minutesWithoutSync: number | null,
	thresholdMinutes: number = DEAD_MAN_THRESHOLD_MINUTES,
): minutesWithoutSync is number {
	return minutesWithoutSync !== null && minutesWithoutSync > thresholdMinutes;
}

export interface BusinessDayBounds {
	businessDate: string;
	from: Date;
	to: Date;
}

export function previousBusinessDay(
	store: Pick<StoreRecord, "timezone" | "business_day_start_minutes">,
	at: Date,
): BusinessDayBounds {
	const today = businessDate(
		at,
		store.timezone,
		store.business_day_start_minutes,
	);
	const yesterday = shiftIsoDate(today, -1);
	return {
		businessDate: yesterday,
		from: businessDayStart(
			yesterday,
			store.timezone,
			store.business_day_start_minutes,
		),
		to: businessDayEnd(
			yesterday,
			store.timezone,
			store.business_day_start_minutes,
		),
	};
}

export interface StoreToWatch {
	store: StoreRecord;
	label: string;
	tenantId: string;
	accountId: string;
}

export interface PreviousDayFreshness {
	storeId: string;
	label: string;
	businessDate: string;
	watched: boolean;
	longestGapMinutes: number | null;
	stale: boolean;
}

export interface PreviousDayCheckInput {
	database: RunnerDatabase;
	notifier: Notifier;
	stores: readonly StoreToWatch[];
	at: Date;
	thresholdMinutes?: number;
	onError: (line: string) => void;
}

export async function checkPreviousDayFreshness(
	input: PreviousDayCheckInput,
): Promise<PreviousDayFreshness[] | null> {
	if (!(await input.database.incrementalScheduleEnabled())) {
		return null;
	}
	const threshold = input.thresholdMinutes ?? DEAD_MAN_THRESHOLD_MINUTES;
	const readings: PreviousDayFreshness[] = [];
	for (const watched of input.stores) {
		const day = previousBusinessDay(watched.store, input.at);
		if (!(await input.database.storeWatched(watched.store.id))) {
			readings.push({
				storeId: watched.store.id,
				label: watched.label,
				businessDate: day.businessDate,
				watched: false,
				longestGapMinutes: null,
				stale: false,
			});
			continue;
		}
		const longest = await input.database.longestSyncGapMinutes(
			watched.store.id,
			day.from,
			day.to,
		);
		const stale = isStale(longest, threshold);
		readings.push({
			storeId: watched.store.id,
			label: watched.label,
			businessDate: day.businessDate,
			watched: true,
			longestGapMinutes: longest,
			stale,
		});
		if (stale) {
			await notifySafely(
				input.notifier,
				staleSyncNotification({
					subject: {
						tenantId: watched.tenantId,
						accountId: watched.accountId,
						storeId: watched.store.id,
					},
					label: watched.label,
					occurredAt: input.at,
					minutes: longest,
					thresholdMinutes: threshold,
					facts: { business_date: day.businessDate, scope: "previous_day" },
				}),
				input.onError,
			);
		}
	}
	return readings;
}
