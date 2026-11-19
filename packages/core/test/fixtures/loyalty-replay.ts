import { shiftIsoDate } from "../../src/rules/business-date.js";
import type {
	EarnParameters,
	ReplayInvoice,
} from "../../src/rules/loyalty-rules.js";

export const REPLAY_BASE_DATE = "2026-10-01";
export const REPLAY_DAYS = 30;
export const REPLAY_UTC_OFFSET_MINUTES = 7 * 60;
export const REPLAY_PHONE_COUNT = 50;
export const REPLAY_STORES = 2;
export const REPLAY_EXCLUDED_SOURCE = "delivery-app";
export const REPLAY_TILL_SOURCE = "tai-quan";

export const REPLAY_PARAMETERS: EarnParameters = {
	stampMinBillAmount: 50_000,
	pointUnitAmount: 10_000,
	pointsPerUnit: 1,
	welcomeStamps: 2,
	earningInvoicesPerPhonePerDay: 3,
	excludedOrderSources: [REPLAY_EXCLUDED_SOURCE],
};

export type ReplayRow = [
	externalId: string,
	day: number,
	store: number,
	secondOfDay: number,
	netAmount: number,
	phoneIndex: number,
	excludedSource: Flag,
	voided: Flag,
	voidedLater: Flag,
];

type Flag = 0 | 1;

type DraftRow = [
	day: number,
	store: number,
	secondOfDay: number,
	netAmount: number,
	phoneIndex: number,
	excludedSource: Flag,
	voided: Flag,
	voidedLater: Flag,
];

export interface ReplayDataset {
	readonly base: string;
	readonly days: number;
	readonly utcOffsetMinutes: number;
	readonly phones: readonly string[];
	readonly staffPhoneIndexes: readonly number[];
	readonly rows: readonly ReplayRow[];
}

export function replayPhone(index: number): string {
	return `09000070${String(index + 1).padStart(2, "0")}`;
}

function generator(seed: number): () => number {
	let state = seed >>> 0;
	return () => {
		state = (state + 0x6d2b79f5) >>> 0;
		let t = state;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

export function buildReplayDataset(seed = 20261119): ReplayDataset {
	const random = generator(seed);
	const integer = (min: number, max: number) =>
		min + Math.floor(random() * (max - min + 1));
	const draft: DraftRow[] = [];
	for (let day = 0; day < REPLAY_DAYS; day += 1) {
		for (let store = 0; store < REPLAY_STORES; store += 1) {
			const count = integer(8, 14);
			const minutes = new Set<number>();
			while (minutes.size < count) {
				minutes.add(7 * 60 + integer(0, 14 * 60 - 1));
			}
			for (const minute of [...minutes].sort((a, b) => a - b)) {
				const withPhone = random() < 0.6;
				const phoneIndex = withPhone ? integer(0, REPLAY_PHONE_COUNT - 1) : -1;
				const netAmount = 1_000 * integer(4, 150);
				const excludedSource: Flag = random() < 0.08 ? 1 : 0;
				const voided: Flag = random() < 0.03 ? 1 : 0;
				const voidedLater: Flag =
					voided === 0 && withPhone && random() < 0.05 ? 1 : 0;
				draft.push([
					day,
					store,
					minute * 60,
					netAmount,
					phoneIndex,
					excludedSource,
					voided,
					voidedLater,
				]);
			}
		}
	}
	for (const [index, minute] of [
		[0, 9 * 60 + 1],
		[1, 9 * 60 + 31],
		[2, 10 * 60 + 1],
		[3, 10 * 60 + 31],
		[4, 11 * 60 + 1],
	] as const) {
		draft.push([3, 0, minute * 60 + 30, 60_000 + index * 1_000, 0, 0, 0, 0]);
	}
	draft.sort(
		(left, right) =>
			left[0] - right[0] || left[2] - right[2] || left[1] - right[1],
	);
	const rows = draft.map(
		(row, index): ReplayRow => [
			`rp-${String(index + 1).padStart(4, "0")}`,
			...row,
		],
	);
	return {
		base: REPLAY_BASE_DATE,
		days: REPLAY_DAYS,
		utcOffsetMinutes: REPLAY_UTC_OFFSET_MINUTES,
		phones: Array.from({ length: REPLAY_PHONE_COUNT }, (_, index) =>
			replayPhone(index),
		),
		staffPhoneIndexes: [REPLAY_PHONE_COUNT - 1],
		rows,
	};
}

export function replayInvoices(dataset: ReplayDataset): ReplayInvoice[] {
	const baseMs = Date.parse(`${dataset.base}T00:00:00Z`);
	return dataset.rows.map(
		([
			externalId,
			day,
			,
			secondOfDay,
			netAmount,
			phoneIndex,
			excludedSource,
			voided,
			voidedLater,
		]) => ({
			externalId,
			businessDate: shiftIsoDate(dataset.base, day),
			soldAt: new Date(
				baseMs +
					day * 86_400_000 +
					(secondOfDay - dataset.utcOffsetMinutes * 60) * 1_000,
			).toISOString(),
			netAmount,
			phone: phoneIndex >= 0 ? (dataset.phones[phoneIndex] ?? null) : null,
			source:
				excludedSource === 1 ? REPLAY_EXCLUDED_SOURCE : REPLAY_TILL_SOURCE,
			status: voided === 1 ? "voided" : "completed",
			voidedLater: voidedLater === 1,
		}),
	);
}
