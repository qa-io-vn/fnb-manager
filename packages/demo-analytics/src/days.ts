import { type GeneratedDay, generateDay, mockStore } from "@fnb/connector-mock";
import {
	addDays,
	asOfDate,
	type DateRange,
	daysBetween,
	firstOfMonth,
	type IsoDate,
	lastOfMonth,
	storeBusinessDate,
} from "@fnb/reports";
import {
	DEMO_DAY_START_MINUTES,
	DEMO_SEED,
	DEMO_TIME_ZONE,
	type DemoDayPlan,
	type DemoStoreDefinition,
	type DemoSyncCheck,
	demoDayPlan,
	demoStores,
	demoSyncCheck,
	demoTargets,
} from "./calendar.js";
import { dressFreshDemoDay } from "./dressing.js";
import { aggregateStoreDay, type StoreDayAggregates } from "./ingest.js";
import { DEFAULT_INGEST_MAPPINGS, type IngestMappings } from "./mappings.js";

export const RAW_DAY_RETENTION_DAYS = 70;

const DEMO_STORE_CLOCK = {
	timeZone: DEMO_TIME_ZONE,
	businessDayStartMinutes: DEMO_DAY_START_MINUTES,
};
const DEMO_STORE_CLOCKS = [DEMO_STORE_CLOCK];
const MILLISECONDS_PER_MINUTE = 60_000;

export interface DemoDayCacheOptions {
	readonly now?: () => Date;
	readonly volumeScale?: number;
	readonly rawRetentionDays?: number;
	readonly window?: DateRange;
}

interface YieldingScheduler {
	yield?: () => Promise<void>;
}

export function nextTask(): Promise<void> {
	const scheduler = (globalThis as { scheduler?: YieldingScheduler }).scheduler;
	if (typeof scheduler?.yield === "function") return scheduler.yield();
	return new Promise((resolve) => setTimeout(resolve, 0));
}

interface Epoch {
	readonly asOf: IsoDate;
	readonly mappingsVersion: number;
	readonly stores: readonly DemoStoreDefinition[];
	readonly raw: Map<string, GeneratedDay>;
	readonly aggregates: Map<string, StoreDayAggregates | null>;
	readonly pending: Map<string, Promise<StoreDayAggregates | null>>;
}

function dayKey(storeId: string, date: IsoDate): string {
	return `${storeId}|${date}`;
}

export class DemoDayCache {
	readonly volumeScale: number;
	readonly rawRetentionDays: number;
	readonly window: DateRange | null;
	private readonly clock: () => Date;
	private epoch: Epoch | null = null;
	private mappings: IngestMappings = DEFAULT_INGEST_MAPPINGS;
	private generationCount = 0;
	private clockMinute = Number.NaN;
	private clockDates: { readonly asOf: IsoDate; readonly today: IsoDate } = {
		asOf: "",
		today: "",
	};

	constructor(options: DemoDayCacheOptions = {}) {
		this.clock = options.now ?? (() => new Date());
		this.volumeScale = options.volumeScale ?? 1;
		this.rawRetentionDays = options.rawRetentionDays ?? RAW_DAY_RETENTION_DAYS;
		this.window = options.window ?? null;
	}

	now(): Date {
		return this.clock();
	}

	private dates(): { readonly asOf: IsoDate; readonly today: IsoDate } {
		const now = this.clock();
		const minute = Math.floor(now.getTime() / MILLISECONDS_PER_MINUTE);
		if (minute !== this.clockMinute) {
			this.clockMinute = minute;
			this.clockDates = {
				asOf: asOfDate(DEMO_STORE_CLOCKS, now),
				today: storeBusinessDate(DEMO_STORE_CLOCK, now),
			};
		}
		return this.clockDates;
	}

	useMappings(mappings: IngestMappings): void {
		this.mappings = mappings;
	}

	private current(): Epoch {
		const { asOf } = this.dates();
		const mappingsVersion = this.mappings.ingestVersion;
		if (this.epoch === null || this.epoch.asOf !== asOf) {
			this.epoch = {
				asOf,
				mappingsVersion,
				stores: demoStores(asOf),
				raw: new Map(),
				aggregates: new Map(),
				pending: new Map(),
			};
		} else if (this.epoch.mappingsVersion !== mappingsVersion) {
			this.epoch = {
				...this.epoch,
				mappingsVersion,
				aggregates: new Map(),
				pending: new Map(),
			};
		}
		return this.epoch;
	}

	asOf(): IsoDate {
		return this.current().asOf;
	}

	stores(): readonly DemoStoreDefinition[] {
		return this.current().stores;
	}

	store(storeId: string): DemoStoreDefinition | undefined {
		return this.stores().find((store) => store.id === storeId);
	}

	today(store: DemoStoreDefinition): IsoDate {
		return store.timeZone === DEMO_TIME_ZONE &&
			store.businessDayStartMinutes === DEMO_DAY_START_MINUTES
			? this.dates().today
			: storeBusinessDate(store, this.clock());
	}

	generations(): number {
		return this.generationCount;
	}

	storeRange(store: DemoStoreDefinition): DateRange | null {
		let from = store.openedOn;
		let to = this.today(store);
		if (this.window !== null) {
			if (this.window.from > from) from = this.window.from;
			if (this.window.to < to) to = this.window.to;
		}
		return from > to ? null : { from, to };
	}

	inRange(store: DemoStoreDefinition, date: IsoDate): boolean {
		const range = this.storeRange(store);
		return range !== null && date >= range.from && date <= range.to;
	}

	plan(store: DemoStoreDefinition, date: IsoDate): DemoDayPlan {
		return demoDayPlan(store, date, this.asOf(), {
			volumeScale: this.volumeScale,
		});
	}

	private planned(
		storeId: string,
		date: IsoDate,
	): { store: DemoStoreDefinition; plan: DemoDayPlan } | null {
		const store = this.store(storeId);
		if (store === undefined || !this.inRange(store, date)) return null;
		const plan = this.plan(store, date);
		return plan.open ? { store, plan } : null;
	}

	isPlanned(storeId: string, date: IsoDate): boolean {
		return this.planned(storeId, date) !== null;
	}

	private keepsRaw(store: DemoStoreDefinition, date: IsoDate): boolean {
		return daysBetween(date, this.today(store)) <= this.rawRetentionDays;
	}

	private generate(
		store: DemoStoreDefinition,
		plan: DemoDayPlan,
		date: IsoDate,
	): GeneratedDay {
		this.generationCount += 1;
		return dressFreshDemoDay(
			generateDay(
				DEMO_SEED,
				plan.profile,
				mockStore(store.index, plan.profile),
				date,
				plan.menu,
			),
		);
	}

	private produce(
		epoch: Epoch,
		storeId: string,
		date: IsoDate,
	): { day: GeneratedDay | null; aggregates: StoreDayAggregates | null } {
		const planned = this.planned(storeId, date);
		if (planned === null) return { day: null, aggregates: null };
		const { store, plan } = planned;
		const key = dayKey(storeId, date);
		const kept = epoch.raw.get(key);
		const day = kept ?? this.generate(store, plan, date);
		const aggregates = aggregateStoreDay(store, day, this.mappings);
		epoch.aggregates.set(key, aggregates);
		if (this.keepsRaw(store, date)) epoch.raw.set(key, day);
		return { day, aggregates };
	}

	generatedNow(storeId: string, date: IsoDate): GeneratedDay | null {
		const epoch = this.current();
		const kept = epoch.raw.get(dayKey(storeId, date));
		if (kept !== undefined) return kept;
		return this.produce(epoch, storeId, date).day;
	}

	async generated(
		storeId: string,
		date: IsoDate,
	): Promise<GeneratedDay | null> {
		const epoch = this.current();
		const key = dayKey(storeId, date);
		const kept = epoch.raw.get(key);
		if (kept !== undefined) return kept;
		if (!this.isPlanned(storeId, date)) return null;
		await nextTask();
		const again = epoch.raw.get(key);
		if (again !== undefined) return again;
		return this.produce(epoch, storeId, date).day;
	}

	hasAggregates(storeId: string, date: IsoDate): boolean {
		return (
			this.current().aggregates.has(dayKey(storeId, date)) ||
			!this.isPlanned(storeId, date)
		);
	}

	aggregatesNow(storeId: string, date: IsoDate): StoreDayAggregates | null {
		const epoch = this.current();
		const key = dayKey(storeId, date);
		if (epoch.aggregates.has(key)) return epoch.aggregates.get(key) ?? null;
		return this.produce(epoch, storeId, date).aggregates;
	}

	aggregates(
		storeId: string,
		date: IsoDate,
	): Promise<StoreDayAggregates | null> {
		const epoch = this.current();
		const key = dayKey(storeId, date);
		if (epoch.aggregates.has(key)) {
			return Promise.resolve(epoch.aggregates.get(key) ?? null);
		}
		if (!this.isPlanned(storeId, date)) return Promise.resolve(null);
		const known = epoch.pending.get(key);
		if (known !== undefined) return known;
		const pending = nextTask().then(() => {
			if (epoch.aggregates.has(key)) return epoch.aggregates.get(key) ?? null;
			return this.produce(epoch, storeId, date).aggregates;
		});
		epoch.pending.set(key, pending);
		const forget = () => {
			epoch.pending.delete(key);
		};
		pending.then(forget, forget);
		return pending;
	}

	datesFor(store: DemoStoreDefinition, from: IsoDate, to: IsoDate): IsoDate[] {
		const range = this.storeRange(store);
		if (range === null) return [];
		const start = from > range.from ? from : range.from;
		const end = to < range.to ? to : range.to;
		const dates: IsoDate[] = [];
		for (let cursor = start; cursor <= end; cursor = addDays(cursor, 1)) {
			dates.push(cursor);
		}
		return dates;
	}

	syncCheck(store: DemoStoreDefinition, date: IsoDate): DemoSyncCheck | null {
		if (!this.inRange(store, date)) return null;
		return demoSyncCheck(store, date, this.asOf());
	}

	target(
		store: DemoStoreDefinition,
		periodKind: "month" | "week",
		periodStart: IsoDate,
	): number | null {
		if (periodKind !== "month") return null;
		const range = this.storeRange(store);
		if (range === null) return null;
		if (lastOfMonth(periodStart) < range.from) return null;
		if (periodStart > firstOfMonth(range.to)) return null;
		return demoTargets(store, periodStart, { volumeScale: this.volumeScale });
	}
}

let shared: DemoDayCache | null = null;

export function sharedDemoDays(): DemoDayCache {
	if (shared === null) shared = new DemoDayCache();
	return shared;
}
