import { mulberry32 } from "@fnb/connector-mock";
import {
	addDays,
	asOfDate,
	daysBetween,
	type IsoDate,
	lastOfMonth,
	storeBusinessDate,
} from "@fnb/reports";
import {
	DEMO_DAY_START_MINUTES,
	DEMO_TIME_ZONE,
	ESTABLISHED_STORE_OPENED_ON,
} from "../../src/index.js";

export type ParityDatasetId = "D1" | "D2" | "D3";

export interface ParityDataset {
	readonly id: string;
	readonly from: IsoDate;
	readonly to: IsoDate;
	readonly volumeScale: number;
}

export interface ParityClock {
	readonly now: Date;
	readonly today: IsoDate;
	readonly asOf: IsoDate;
}

const DEMO_CLOCK = {
	timeZone: DEMO_TIME_ZONE,
	businessDayStartMinutes: DEMO_DAY_START_MINUTES,
};

export const PARITY_SEED = 20_261_108;

export function parityClock(now: Date = new Date()): ParityClock {
	return {
		now,
		today: storeBusinessDate(DEMO_CLOCK, now),
		asOf: asOfDate([DEMO_CLOCK], now),
	};
}

export function parityDatasets(
	clock: ParityClock,
): Record<ParityDatasetId, ParityDataset> {
	return {
		D1: {
			id: "D1",
			from: addDays(clock.asOf, -100),
			to: clock.today,
			volumeScale: 0.3,
		},
		D2: {
			id: "D2",
			from: ESTABLISHED_STORE_OPENED_ON,
			to: clock.today,
			volumeScale: 0.04,
		},
		D3: {
			id: "D3",
			from: addDays(clock.today, -13),
			to: clock.today,
			volumeScale: 1,
		},
	};
}

export function seededDates(
	dataset: ParityDataset,
	count: number,
	salt: number,
): IsoDate[] {
	const rng = mulberry32(PARITY_SEED + salt);
	const span = daysBetween(dataset.from, dataset.to);
	const dates = new Set<IsoDate>();
	for (
		let attempt = 0;
		dates.size < count && attempt < count * 20;
		attempt += 1
	) {
		dates.add(addDays(dataset.from, Math.floor(rng.next() * (span + 1))));
	}
	return [...dates].sort();
}

export function seededRanges(
	dataset: ParityDataset,
	count: number,
	salt: number,
	maxDays: number,
): { from: IsoDate; to: IsoDate }[] {
	const rng = mulberry32(PARITY_SEED * 7 + salt);
	const span = daysBetween(dataset.from, dataset.to);
	const ranges: { from: IsoDate; to: IsoDate }[] = [];
	for (let index = 0; index < count; index += 1) {
		const start = Math.floor(rng.next() * (span + 1));
		const length = Math.floor(rng.next() * Math.min(maxDays, span - start + 1));
		const from = addDays(dataset.from, start);
		ranges.push({ from, to: addDays(from, length) });
	}
	return ranges;
}

export function calendarDataset(clock: ParityClock): ParityDataset {
	return { id: "C1", from: clock.today, to: clock.today, volumeScale: 0.04 };
}

export function inWindow(dataset: ParityDataset, date: IsoDate): boolean {
	return date >= dataset.from && date <= dataset.to;
}

export function monthEnds(clock: ParityClock, count: number): IsoDate[] {
	const ends: IsoDate[] = [];
	let cursor = addDays(clock.asOf.slice(0, 8).concat("01"), -1);
	for (let index = 0; index < count; index += 1) {
		ends.push(lastOfMonth(cursor));
		cursor = addDays(cursor.slice(0, 8).concat("01"), -1);
	}
	return ends;
}
