import type { PaymentKind } from "@fnb/core";
import { addDays, type IsoDate } from "../../lib/business-dates";
import { readDateDraft } from "../forms/date-field";
import type { NumberDraft } from "../number-text";
import { KIND_OPTIONS } from "../payment-kinds/payment-kinds";
import type {
	FeeRateChange,
	FeeRateRow,
	Membership,
	PaymentMethodEntry,
} from "../source";
import { FIRST_BUSINESS_DATE, type ValidationIssue } from "../validation";

export type FeeScope = string | null;

export interface FeeMethod {
	readonly externalId: string;
	readonly name: string;
	readonly kind: PaymentKind;
}

export interface FeeKindGroup {
	readonly kind: PaymentKind;
	readonly methods: readonly FeeMethod[];
}

export interface CurrentRate {
	readonly row: FeeRateRow;
	readonly inherited: boolean;
}

export interface RateHistory {
	readonly own: readonly FeeRateRow[];
	readonly shared: readonly FeeRateRow[];
}

export type RateDateHintKind =
	| "wholeHistory"
	| "keepsEarlier"
	| "keepsShared"
	| "replacesShared"
	| "replaces"
	| "fromDate";

export interface RateDateHint {
	readonly kind: RateDateHintKind;
	readonly until: IsoDate | null;
}

export interface FeeEdit {
	readonly percent: string;
	readonly fixed: string;
	readonly date: IsoDate | null;
}

export type FeeDraft = Readonly<Record<string, FeeEdit>>;

export interface FeeFieldIssues {
	readonly percent: ValidationIssue | null;
	readonly fixed: ValidationIssue | null;
	readonly date: ValidationIssue | null;
}

export interface FeeReading {
	readonly changes: readonly FeeRateChange[];
	readonly pendingCount: number;
	readonly invalid: boolean;
	readonly issues: ReadonlyMap<string, FeeFieldIssues>;
}

export interface FeeDraftContext {
	readonly scope: FeeScope;
	readonly rows: readonly FeeRateRow[];
	readonly today: IsoDate;
	readonly readPercent: (text: string) => NumberDraft;
	readonly readFixed: (text: string) => NumberDraft;
}

const NAME_ORDER = new Intl.Collator("vi", { sensitivity: "base" });

interface ScopeStore {
	readonly id: string;
}

export function defaultFeeScope(
	membership: Membership | null | undefined,
	stores: readonly ScopeStore[],
): FeeScope {
	const limited = membership?.storeIds ?? null;
	if (
		limited === null ||
		(membership?.role !== "owner" && membership?.role !== "manager")
	) {
		return null;
	}
	return stores.find((store) => limited.includes(store.id))?.id ?? null;
}

export function feeMethodsOf(
	entries: readonly PaymentMethodEntry[],
	posAccountId: string | null,
	rateMethodIds: readonly string[],
): FeeMethod[] {
	const methods = new Map<string, FeeMethod>();
	for (const entry of entries) {
		if (posAccountId !== null && entry.posAccountId !== posAccountId) continue;
		if (methods.has(entry.externalId)) continue;
		methods.set(entry.externalId, {
			externalId: entry.externalId,
			name: entry.name,
			kind: entry.kind,
		});
	}
	for (const externalId of rateMethodIds) {
		if (methods.has(externalId)) continue;
		methods.set(externalId, { externalId, name: externalId, kind: "other" });
	}
	return [...methods.values()];
}

export function feeGroupsOf(methods: readonly FeeMethod[]): FeeKindGroup[] {
	return KIND_OPTIONS.map((kind) => ({
		kind,
		methods: methods
			.filter((method) => method.kind === kind)
			.sort(
				(left, right) =>
					NAME_ORDER.compare(left.name, right.name) ||
					left.externalId.localeCompare(right.externalId),
			),
	})).filter((group) => group.methods.length > 0);
}

export function scopeRatesOf(
	rows: readonly FeeRateRow[],
	scope: FeeScope,
	methodId: string,
): FeeRateRow[] {
	return rows
		.filter(
			(row) =>
				row.storeId === scope && row.paymentMethodExternalId === methodId,
		)
		.sort((left, right) =>
			left.effectiveFrom.localeCompare(right.effectiveFrom),
		);
}

export function rateHistoryOf(
	rows: readonly FeeRateRow[],
	scope: FeeScope,
	methodId: string,
): RateHistory {
	return {
		own: scopeRatesOf(rows, scope, methodId),
		shared: scope === null ? [] : scopeRatesOf(rows, null, methodId),
	};
}

function inForceOn(
	scopeRows: readonly FeeRateRow[],
	date: IsoDate,
): FeeRateRow | null {
	let found: FeeRateRow | null = null;
	for (const row of scopeRows) {
		if (row.effectiveFrom <= date) found = row;
	}
	return found;
}

export function currentRateOf(
	history: RateHistory,
	today: IsoDate,
): CurrentRate | null {
	const own = inForceOn(history.own, today);
	if (own !== null) return { row: own, inherited: false };
	const shared = inForceOn(history.shared, today);
	return shared === null ? null : { row: shared, inherited: true };
}

export function defaultRateDate(history: RateHistory, today: IsoDate): IsoDate {
	return history.own.length === 0 && history.shared.length === 0
		? FIRST_BUSINESS_DATE
		: today;
}

export function rateDateHintOf(
	{ own, shared }: RateHistory,
	date: IsoDate,
	today: IsoDate,
): RateDateHint {
	if (own.some((row) => row.effectiveFrom === date)) {
		return { kind: "replaces", until: null };
	}
	const next = own.find((row) => row.effectiveFrom > date);
	const until = next === undefined ? null : addDays(next.effectiveFrom, -1);
	if (own.some((row) => row.effectiveFrom < date)) {
		return { kind: "keepsEarlier", until };
	}
	const firstShared = shared[0]?.effectiveFrom;
	if (firstShared !== undefined) {
		const pastEnd =
			next === undefined || next.effectiveFrom > today
				? today
				: next.effectiveFrom;
		if (date < pastEnd && firstShared < pastEnd) {
			return { kind: "replacesShared", until };
		}
		if (firstShared < date) return { kind: "keepsShared", until };
	}
	return {
		kind: date === FIRST_BUSINESS_DATE ? "wholeHistory" : "fromDate",
		until,
	};
}

export function editedRateDateOf(
	edit: FeeEdit | undefined,
	history: RateHistory,
	today: IsoDate,
): IsoDate {
	return edit?.date ?? defaultRateDate(history, today);
}

export function readFeeEdits(
	draft: FeeDraft,
	{ scope, rows, today, readPercent, readFixed }: FeeDraftContext,
): FeeReading {
	const changes: FeeRateChange[] = [];
	const issues = new Map<string, FeeFieldIssues>();
	let pendingCount = 0;
	for (const [methodId, edit] of Object.entries(draft)) {
		const history = rateHistoryOf(rows, scope, methodId);
		const date = editedRateDateOf(edit, history, today);
		const typedPercent = edit.percent.trim() !== "";
		const typedFixed = edit.fixed.trim() !== "";
		if (
			!typedPercent &&
			!typedFixed &&
			date === defaultRateDate(history, today)
		) {
			continue;
		}
		pendingCount += 1;
		const percent: NumberDraft = typedPercent
			? readPercent(edit.percent)
			: { value: null, issue: { key: "required" } };
		const fixed: NumberDraft = typedFixed
			? readFixed(edit.fixed)
			: { value: 0, issue: null };
		const dateIssue = readDateDraft(date, today);
		if (
			percent.issue !== null ||
			fixed.issue !== null ||
			dateIssue !== null ||
			percent.value === null ||
			fixed.value === null
		) {
			issues.set(methodId, {
				percent: percent.issue,
				fixed: fixed.issue,
				date: dateIssue,
			});
			continue;
		}
		changes.push({
			storeId: scope,
			paymentMethodExternalId: methodId,
			feePct: percent.value,
			fixedFeeAmount: fixed.value,
			effectiveFrom: date,
		});
	}
	return {
		changes,
		pendingCount,
		invalid: issues.size > 0,
		issues,
	};
}

export function withoutSavedFees(
	draft: FeeDraft,
	saved: readonly FeeRateChange[],
): FeeDraft {
	const savedMethods = new Set(
		saved.map((change) => change.paymentMethodExternalId),
	);
	return Object.fromEntries(
		Object.entries(draft).filter(([methodId]) => !savedMethods.has(methodId)),
	);
}

function rateKeyOf(
	row: Pick<
		FeeRateChange,
		"storeId" | "paymentMethodExternalId" | "effectiveFrom"
	>,
): string {
	return `${row.storeId ?? ""}|${row.paymentMethodExternalId}|${row.effectiveFrom}`;
}

export function withSavedFeeRates(
	previous: readonly FeeRateRow[] | undefined,
	saved: readonly FeeRateRow[],
): FeeRateRow[] | undefined {
	if (previous === undefined) return previous;
	const savedByKey = new Map(saved.map((row) => [rateKeyOf(row), row]));
	const kept = previous.map((row) => {
		const replaced = savedByKey.get(rateKeyOf(row));
		if (replaced === undefined) return row;
		savedByKey.delete(rateKeyOf(row));
		return replaced;
	});
	return [...kept, ...savedByKey.values()];
}
