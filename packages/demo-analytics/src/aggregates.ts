import { addDays, type IsoDate } from "@fnb/reports";
import type { DemoStoreDefinition } from "./calendar.js";
import type { DemoDayCache } from "./days.js";
import type { StoreDayAggregates } from "./ingest.js";

export interface StoreDayRange {
	readonly storeIds: readonly string[];
	readonly from: IsoDate;
	readonly to: IsoDate;
}

export class AggregateStore {
	readonly days: DemoDayCache;
	private missCount = 0;

	constructor(days: DemoDayCache) {
		this.days = days;
	}

	stores(): readonly DemoStoreDefinition[] {
		return this.days.stores();
	}

	store(storeId: string): DemoStoreDefinition | undefined {
		return this.days.store(storeId);
	}

	visibleStores(storeIds: readonly string[]): DemoStoreDefinition[] {
		const seen = new Set<string>();
		const visible: DemoStoreDefinition[] = [];
		for (const id of storeIds) {
			if (seen.has(id)) continue;
			seen.add(id);
			const store = this.store(id);
			if (store !== undefined) visible.push(store);
		}
		return visible;
	}

	asOf(): IsoDate {
		return this.days.asOf();
	}

	today(store: DemoStoreDefinition): IsoDate {
		return this.days.today(store);
	}

	now(): Date {
		return this.days.now();
	}

	misses(): number {
		return this.missCount;
	}

	async ensure(
		storeIds: readonly string[],
		from: IsoDate,
		to: IsoDate,
	): Promise<void> {
		for (const store of this.visibleStores(storeIds)) {
			for (const date of this.days.datesFor(store, from, to)) {
				if (!this.days.hasAggregates(store.id, date)) {
					await this.days.aggregates(store.id, date);
				}
			}
		}
	}

	async ensureAll(ranges: readonly StoreDayRange[]): Promise<void> {
		for (const range of ranges) {
			await this.ensure(range.storeIds, range.from, range.to);
		}
	}

	day(storeId: string, date: IsoDate): StoreDayAggregates | null {
		if (!this.days.hasAggregates(storeId, date)) this.missCount += 1;
		return this.days.aggregatesNow(storeId, date);
	}

	daysOf(
		store: DemoStoreDefinition,
		from: IsoDate,
		to: IsoDate,
	): StoreDayAggregates[] {
		const days: StoreDayAggregates[] = [];
		for (const date of this.days.datesFor(store, from, to)) {
			const day = this.day(store.id, date);
			if (day !== null) days.push(day);
		}
		return days;
	}

	removedLinesOn(store: DemoStoreDefinition, date: IsoDate): number {
		let total = 0;
		for (const source of [addDays(date, -1), date]) {
			const day = this.days.datesFor(store, source, source).length
				? this.day(store.id, source)
				: null;
			total += day?.removedLinesByDate.get(date) ?? 0;
		}
		return total;
	}
}
