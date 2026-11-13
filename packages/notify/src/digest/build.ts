import {
	type AnalyticsRow,
	asOfDate,
	type CardModel,
	type Comparison,
	dayReport,
	type IsoDate,
	maxDate,
	periodContaining,
	type ReportContext,
	type ReportStore,
	relativeChange,
	runReport,
} from "@fnb/reports";
import {
	type DayRuleOutcome,
	type EffectiveRuleSet,
	evaluateDayRules,
	type StoreDayFacts,
} from "../rules/day.js";
import {
	DIGEST_CARD_IDS,
	DIGEST_HOLIDAY_KINDS,
	DIGEST_MODEL_VERSION,
	DIGEST_UNAVAILABLE_REASONS,
	type DigestComparison,
	type DigestDataState,
	type DigestModel,
	type DigestOpenAlert,
	type StoreDayState,
} from "./model.js";
import {
	type RecordedCall,
	type RecordingSource,
	recordedRows,
} from "./recording-source.js";

export type DigestTrigger = "settled" | "deadline" | "manual";

export interface DigestStoreFacts {
	readonly storeId: string;
	readonly openingMinutes: number | null;
	readonly closeAt: string;
	readonly lastShiftClosedAt: string | null;
	readonly openShifts: number;
	readonly settledAt: string | null;
	readonly dayEnded: boolean;
}

export interface DueDigest {
	readonly tenantId: string;
	readonly businessDate: IsoDate;
	readonly scopeKey: string;
	readonly storeIds: readonly string[];
	readonly allStores: boolean;
	readonly trigger: DigestTrigger;
	readonly runAs: string;
	readonly channelIds: readonly string[];
	readonly storeFacts: readonly DigestStoreFacts[];
	readonly dueAt?: string | null;
}

export interface DigestBuildInput {
	readonly due: DueDigest;
	readonly stores: readonly ReportStore[];
	readonly rules: EffectiveRuleSet;
	readonly openAlerts: readonly DigestOpenAlert[];
	readonly appBaseUrl: string | null;
	readonly now: Date;
}

export interface DigestBuild {
	readonly model: DigestModel;
	readonly context: ReportContext;
	readonly cards: readonly CardModel[];
	readonly facts: readonly StoreDayFacts[];
	readonly outcomes: readonly DayRuleOutcome[];
}

export function digestContext(input: DigestBuildInput): ReportContext {
	const day = input.due.businessDate;
	return {
		tenantId: input.due.tenantId,
		stores: input.stores,
		allStoresSelected: input.due.allStores,
		period: periodContaining(
			"day",
			day,
			maxDate(day, asOfDate(input.stores, input.now)),
		),
		sample: false,
	};
}

function isCompareCall(day: IsoDate) {
	return (args: Readonly<Record<string, unknown>>) =>
		args.grain === "day" && args.anchor === day;
}

function isDayRange(day: IsoDate) {
	return (args: Readonly<Record<string, unknown>>) =>
		args.from_date === day && args.to_date === day;
}

export function storeDayFacts(
	recorded: readonly RecordedCall[],
	series: readonly AnalyticsRow<"period_series">[],
	input: DigestBuildInput,
	context: ReportContext = digestContext(input),
): StoreDayFacts[] {
	const day = input.due.businessDate;
	const compare = recordedRows(
		recorded,
		"period_compare_by_store",
		isCompareCall(day),
	);
	const shifts = recordedRows(recorded, "shift_review", isDayRange(day));
	const coverage = recordedRows(
		recorded,
		"store_coverage",
		(args) => args.to_date === context.period.end,
	);
	const factsByStore = new Map(
		input.due.storeFacts.map((facts) => [facts.storeId, facts]),
	);
	const totalSeries = series.find((row) => row.store_id === null) ?? null;
	return input.stores.map((store) => {
		const row = (period: string) =>
			compare.find(
				(entry) => entry.store_id === store.id && entry.period === period,
			) ?? null;
		const facts = factsByStore.get(store.id);
		return {
			storeId: store.id,
			name: store.name,
			timeZone: store.timeZone,
			businessDate: day,
			current: row("current"),
			previous: row("previous"),
			baseline: row("baseline"),
			shifts: shifts.filter((shift) => shift.store_id === store.id),
			coverage: coverage.find((entry) => entry.store_id === store.id) ?? null,
			series:
				series.find((entry) => entry.store_id === store.id) ?? totalSeries,
			openingMinutes: facts?.openingMinutes ?? null,
			settled:
				facts === undefined
					? true
					: facts.settledAt !== null || facts.openingMinutes === 0,
		};
	});
}

function cardOf(cards: readonly CardModel[], id: string): CardModel | null {
	return cards.find((card) => card.id === id) ?? null;
}

const UNAVAILABLE = new Set<string>(DIGEST_UNAVAILABLE_REASONS);

function digestComparison(
	comparison: Comparison | undefined,
): DigestComparison {
	if (comparison === undefined) {
		return { change: null, sampleDays: null, unavailable: "no_reference" };
	}
	const unavailable =
		comparison.unavailable !== null && UNAVAILABLE.has(comparison.unavailable)
			? (comparison.unavailable as DigestComparison["unavailable"])
			: null;
	return {
		change: comparison.change,
		sampleDays: comparison.sampleDays,
		unavailable,
		basis: comparison.basis,
		coveredStores: comparison.coveredStores,
		totalStores: comparison.totalStores,
	};
}

function comparisonOf(
	card: CardModel | null,
	kind: Comparison["kind"],
): DigestComparison {
	return digestComparison(
		card?.comparisons.find((comparison) => comparison.kind === kind),
	);
}

function peakHourOf(card: CardModel | null): DigestModel["totals"]["peakHour"] {
	const hour = card?.headline.caption?.values.hour;
	if (card === null || hour === undefined || typeof hour.value !== "number") {
		return null;
	}
	return { hour: hour.value, net: card.headline.value };
}

function topItemsOf(card: CardModel | null): DigestModel["totals"]["topItems"] {
	const rows = card?.tables[0]?.rows ?? [];
	return rows.slice(0, 3).flatMap((row) => {
		const name = row.cells.item;
		const quantity = row.cells.quantity;
		if (typeof name !== "string" || name === "") {
			return [];
		}
		return [{ name, quantity: typeof quantity === "number" ? quantity : null }];
	});
}

function storeState(facts: StoreDayFacts, due: DueDigest): StoreDayState {
	const storeFacts = due.storeFacts.find(
		(entry) => entry.storeId === facts.storeId,
	);
	if (facts.openingMinutes === 0) {
		return "closed";
	}
	if (!facts.settled) {
		return (storeFacts?.openShifts ?? 0) > 0 ? "shift_open" : "unsettled";
	}
	if ((facts.coverage?.unmatched_days ?? 0) > 0) {
		return "unmatched";
	}
	if ((facts.current?.days_with_data ?? 0) === 0) {
		return "no_sales";
	}
	return (facts.coverage?.unchecked_sales_days ?? 0) === 0 &&
		facts.coverage !== null
		? "verified"
		: "unverified";
}

function storeComparison(facts: StoreDayFacts): DigestComparison {
	const sampleDays = facts.baseline?.days_with_data ?? null;
	const reference = facts.baseline?.net_amount ?? null;
	const current = facts.current?.net_amount ?? null;
	return {
		change: relativeChange(current, reference),
		sampleDays,
		unavailable:
			sampleDays === null || sampleDays < 1 ? "building_baseline" : null,
	};
}

function holidayKindOf(
	facts: readonly StoreDayFacts[],
): DigestModel["holidayKind"] {
	for (const store of facts) {
		const kind = store.series?.holiday_kind ?? null;
		if (
			kind !== null &&
			(DIGEST_HOLIDAY_KINDS as readonly string[]).includes(kind)
		) {
			return kind;
		}
	}
	return null;
}

function dataStateOf(
	stores: DigestModel["stores"],
	verification: string | null,
): DigestDataState {
	if (
		stores.some(
			(store) => store.state === "unsettled" || store.state === "shift_open",
		)
	) {
		return "partial";
	}
	const open = stores.filter((store) => store.state !== "closed");
	if (open.length === 0 || open.every((store) => store.state === "no_sales")) {
		return "no_data";
	}
	if (stores.some((store) => store.state === "unmatched")) {
		return "unmatched";
	}
	return verification === "verified" ? "verified" : "unverified";
}

export const DIGEST_LINK_MAX_STORES = 10;

export function digestLink(
	due: Pick<
		DueDigest,
		"businessDate" | "allStores" | "storeIds" | "storeFacts"
	>,
): DigestModel["link"] {
	const ended =
		due.storeFacts.length > 0 &&
		due.storeFacts.every((facts) => facts.dayEnded);
	if (!ended) {
		return { kind: "hom_nay", path: "#/" };
	}
	const store =
		due.allStores || due.storeIds.length > DIGEST_LINK_MAX_STORES
			? ""
			: `&store=${due.storeIds.map(encodeURIComponent).join(",")}`;
	return {
		kind: "ngay",
		path: `#/bao-cao/ngay?date=${encodeURIComponent(due.businessDate)}${store}`,
	};
}

export function digestModelFromCards(build: {
	readonly input: DigestBuildInput;
	readonly context: ReportContext;
	readonly cards: readonly CardModel[];
	readonly facts: readonly StoreDayFacts[];
	readonly outcomes: readonly DayRuleOutcome[];
}): DigestModel {
	const { input, cards, facts, outcomes } = build;
	const net = cardOf(cards, DIGEST_CARD_IDS.net);
	const stores = facts.map((store) => ({
		storeId: store.storeId,
		name: store.name,
		state: storeState(store, input.due),
		net: store.current?.net_amount ?? null,
		invoices: store.current?.invoices ?? null,
		vsBaseline: storeComparison(store),
	}));
	const verification = net?.markers.verification ?? null;
	return {
		version: DIGEST_MODEL_VERSION,
		tenantId: input.due.tenantId,
		businessDate: input.due.businessDate,
		scope: {
			storeIds: [...input.due.storeIds],
			allStores: input.due.allStores,
		},
		dataState: dataStateOf(stores, verification),
		holidayKind: holidayKindOf(facts),
		totals: {
			net: net?.headline.value ?? null,
			vsBaseline: comparisonOf(net, "baseline"),
			vsPrevious: comparisonOf(net, "previous"),
			invoices: cardOf(cards, DIGEST_CARD_IDS.invoices)?.headline.value ?? null,
			avgTicket:
				cardOf(cards, DIGEST_CARD_IDS.avgTicket)?.headline.value ?? null,
			cashToCount:
				cardOf(cards, DIGEST_CARD_IDS.payments)?.headline.value ?? null,
			peakHour: peakHourOf(cardOf(cards, DIGEST_CARD_IDS.hourly)),
			topItems: topItemsOf(cardOf(cards, DIGEST_CARD_IDS.topItems)),
		},
		stores,
		findings: outcomes.flatMap((outcome) =>
			outcome.kind === "hit"
				? [
						{
							ruleKey: outcome.ruleKey,
							storeId: outcome.storeId,
							values: { ...outcome.values },
						},
					]
				: [],
		),
		openAlerts: [...input.openAlerts],
		link: digestLink(input.due),
		stale: cards.some((card) => card.markers.stale),
		builtAt: input.now.toISOString(),
	};
}

export async function buildDigest(
	input: DigestBuildInput,
	source: RecordingSource,
): Promise<DigestBuild> {
	const context = digestContext(input);
	const cards = await runReport(dayReport, context, source);
	const series = await source.call("period_series", {
		store_ids: [...input.due.storeIds],
		grain: "day",
		from_date: input.due.businessDate,
		to_date: input.due.businessDate,
	});
	const facts = storeDayFacts(source.recorded(), series, input, context);
	const outcomes = evaluateDayRules(input.rules, facts);
	return {
		model: digestModelFromCards({ input, context, cards, facts, outcomes }),
		context,
		cards,
		facts,
		outcomes,
	};
}

export async function buildDigestModel(
	input: DigestBuildInput,
	source: RecordingSource,
): Promise<DigestModel> {
	return (await buildDigest(input, source)).model;
}
