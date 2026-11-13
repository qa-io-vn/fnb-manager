import {
	type Menu,
	type MockProfile,
	resolveProfile,
} from "@fnb/connector-mock";
import { type HolidayEntry, VIETNAM_HOLIDAYS } from "@fnb/core";
import {
	addDays,
	daysBetween,
	daysInMonth,
	firstOfMonth,
	type IsoDate,
	isoWeekday,
	isoWeekOf,
	mondayOf,
	roundHalfAwayFromZero,
} from "@fnb/reports";
import { isTetWindowDay } from "./excluded.js";
import { demoMenu, menuVariantFor } from "./menus.js";

export const DEMO_SEED = 20_261_108;
export const DEMO_TENANT_ID = "demo-tenant";
export const DEMO_POS_ACCOUNT_ID = "demo-account";
export const DEMO_TIME_ZONE = "Asia/Ho_Chi_Minh";
export const DEMO_DAY_START_MINUTES = 0;
export const ESTABLISHED_STORE_OPENED_ON = "2024-12-02";
export const YOUNG_STORE_LEAD_DAYS = 56;
export const GROWTH_EPOCH = "2025-01-01";
export const ANNUAL_GROWTH = 1.06;
export const DAYS_PER_YEAR = 365.25;
export const RAMP_START = 0.55;
export const RAMP_DAYS = 42;
export const TET_WINDOW_FACTOR = 0.5;
export const PRE_TET_FACTOR = 1.15;
export const PRE_TET_DAYS = 7;
export const PUBLIC_HOLIDAY_FACTOR = 1.1;
export const MONTH_WEIGHTS: readonly number[] = [
	1.04, 0.97, 1.0, 1.05, 1.09, 1.08, 1.05, 1.02, 0.96, 0.95, 0.98, 1.03,
];
export const CAPTURE_FROM = "2026-10-01";
export const CAPTURE_START_RATE = 0.02;
export const CAPTURE_GROWTH = 0.28;
export const CAPTURE_RAMP_DAYS = 120;
export const CAPTURE_CEILING = 0.3;
export const TUESDAY_ITEM_DISCOUNT_RATE = 0.15;
export const ITEM_DISCOUNT_RATE = 0.03;
export const FIRST_WEEK_VOUCHER_RATE = 0.2;
export const VOUCHER_RATE = 0.08;
export const TARGET_TICKET = 90_000;
export const TARGET_UPLIFT = 1.05;
export const TARGET_ROUNDING_DIGITS = -6;
export const UNMATCHED_CHECK_DAYS_BEFORE_AS_OF = 9;
export const UNCHECKED_DAYS_BEFORE_AS_OF = 4;

const CLOSED_TET_DAYS: readonly string[] = [
	"Tet, day 1",
	"Tet, day 2",
	"Tet, day 3",
];

export type DemoStoreId = "MOCK-S1" | "MOCK-S2";
export type Weekday = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";
export type OpeningHours = Readonly<
	Record<Weekday, readonly [string, string][]>
>;

export const WEEKDAY_KEYS: readonly Weekday[] = [
	"mon",
	"tue",
	"wed",
	"thu",
	"fri",
	"sat",
	"sun",
];

function everyDay(open: string, close: string): OpeningHours {
	return Object.fromEntries(
		WEEKDAY_KEYS.map((key) => [key, [[open, close]] as [string, string][]]),
	) as unknown as OpeningHours;
}

export const demoOpeningHours: OpeningHours = everyDay("07:00", "22:30");

export interface DemoStoreDefinition {
	readonly id: DemoStoreId;
	readonly index: 1 | 2;
	readonly name: string;
	readonly timeZone: "Asia/Ho_Chi_Minh";
	readonly businessDayStartMinutes: 0;
	readonly posAccountId: "demo-account";
	readonly openedOn: IsoDate;
	readonly profile: MockProfile;
	readonly openingHours: OpeningHours | null;
	readonly hasMonthlyTargets: boolean;
}

export interface DemoDayPlan {
	readonly open: boolean;
	readonly profile: MockProfile;
	readonly menu: Menu;
}

export interface DemoDayPlanOptions {
	readonly volumeScale?: number;
}

const establishedProfile = resolveProfile();
const youngProfile = resolveProfile({
	averageSalesPerDay: 72,
	largeSizeShare: 0.3,
});

export function youngStoreOpenedOn(asOf: IsoDate): IsoDate {
	return mondayOf(addDays(firstOfMonth(asOf), -YOUNG_STORE_LEAD_DAYS));
}

const storeCache = new Map<IsoDate, readonly DemoStoreDefinition[]>();

export function demoStores(asOf: IsoDate): readonly DemoStoreDefinition[] {
	const cached = storeCache.get(asOf);
	if (cached !== undefined) return cached;
	const stores: readonly DemoStoreDefinition[] = [
		{
			id: "MOCK-S1",
			index: 1,
			name: "Cửa hàng mẫu 1",
			timeZone: DEMO_TIME_ZONE,
			businessDayStartMinutes: DEMO_DAY_START_MINUTES,
			posAccountId: DEMO_POS_ACCOUNT_ID,
			openedOn: ESTABLISHED_STORE_OPENED_ON,
			profile: establishedProfile,
			openingHours: demoOpeningHours,
			hasMonthlyTargets: true,
		},
		{
			id: "MOCK-S2",
			index: 2,
			name: "Cửa hàng mẫu 2",
			timeZone: DEMO_TIME_ZONE,
			businessDayStartMinutes: DEMO_DAY_START_MINUTES,
			posAccountId: DEMO_POS_ACCOUNT_ID,
			openedOn: youngStoreOpenedOn(asOf),
			profile: youngProfile,
			openingHours: null,
			hasMonthlyTargets: false,
		},
	];
	storeCache.set(asOf, stores);
	return stores;
}

export function demoStoreIds(): readonly DemoStoreId[] {
	return ["MOCK-S1", "MOCK-S2"];
}

function tetRows(holidays: readonly HolidayEntry[]): readonly HolidayEntry[] {
	return holidays.filter((holiday) => holiday.kind === "tet");
}

export function isClosedTetDay(
	date: IsoDate,
	holidays: readonly HolidayEntry[] = VIETNAM_HOLIDAYS,
): boolean {
	return holidays.some(
		(holiday) =>
			holiday.holidayDate === date && CLOSED_TET_DAYS.includes(holiday.name),
	);
}

const firstTetDates = new WeakMap<
	readonly HolidayEntry[],
	ReadonlyMap<string, IsoDate>
>();

function firstTetOfYear(
	holidays: readonly HolidayEntry[],
	year: string,
): IsoDate | undefined {
	let byYear = firstTetDates.get(holidays);
	if (byYear === undefined) {
		const firsts = new Map<string, IsoDate>();
		for (const holiday of tetRows(holidays)) {
			const holidayYear = holiday.holidayDate.slice(0, 4);
			const known = firsts.get(holidayYear);
			if (known === undefined || holiday.holidayDate < known) {
				firsts.set(holidayYear, holiday.holidayDate);
			}
		}
		byYear = firsts;
		firstTetDates.set(holidays, byYear);
	}
	return byYear.get(year);
}

export function isPreTetDay(
	date: IsoDate,
	holidays: readonly HolidayEntry[] = VIETNAM_HOLIDAYS,
): boolean {
	const firstTet = firstTetOfYear(holidays, date.slice(0, 4));
	if (firstTet === undefined) return false;
	return date >= addDays(firstTet, -PRE_TET_DAYS) && date < firstTet;
}

export function isPublicHoliday(
	date: IsoDate,
	holidays: readonly HolidayEntry[] = VIETNAM_HOLIDAYS,
): boolean {
	return holidays.some(
		(holiday) => holiday.holidayDate === date && holiday.kind === "public",
	);
}

export function captureRate(date: IsoDate): number {
	if (date < CAPTURE_FROM) return 0;
	return Math.min(
		CAPTURE_CEILING,
		CAPTURE_START_RATE +
			(CAPTURE_GROWTH * daysBetween(CAPTURE_FROM, date)) / CAPTURE_RAMP_DAYS,
	);
}

export function isFirstIsoWeekOfMonth(date: IsoDate): boolean {
	const week = isoWeekOf(date);
	const first = isoWeekOf(firstOfMonth(date));
	return week.isoYear === first.isoYear && week.isoWeek === first.isoWeek;
}

export function salesFactor(
	store: DemoStoreDefinition,
	date: IsoDate,
	holidays: readonly HolidayEntry[] = VIETNAM_HOLIDAYS,
): number {
	let factor = 1;
	if (isTetWindowDay(holidays, date)) factor *= TET_WINDOW_FACTOR;
	if (isPreTetDay(date, holidays)) factor *= PRE_TET_FACTOR;
	if (isPublicHoliday(date, holidays)) factor *= PUBLIC_HOLIDAY_FACTOR;
	factor *= MONTH_WEIGHTS[Number(date.slice(5, 7)) - 1] ?? 1;
	factor *= ANNUAL_GROWTH ** (daysBetween(GROWTH_EPOCH, date) / DAYS_PER_YEAR);
	if (store.id === "MOCK-S2") {
		factor *= Math.min(
			1,
			RAMP_START +
				(1 - RAMP_START) * (daysBetween(store.openedOn, date) / RAMP_DAYS),
		);
	}
	return factor;
}

export function expectedInvoices(
	store: DemoStoreDefinition,
	date: IsoDate,
	options: DemoDayPlanOptions = {},
): number {
	const scale = options.volumeScale ?? 1;
	return Math.max(
		1,
		Math.round(
			store.profile.averageSalesPerDay * salesFactor(store, date) * scale,
		),
	);
}

export function isOpenOn(store: DemoStoreDefinition, date: IsoDate): boolean {
	return date >= store.openedOn && !isClosedTetDay(date);
}

export function demoDayPlan(
	store: DemoStoreDefinition,
	date: IsoDate,
	asOf: IsoDate,
	options: DemoDayPlanOptions = {},
): DemoDayPlan {
	const profile: MockProfile = {
		...store.profile,
		averageSalesPerDay: expectedInvoices(store, date, options),
		customerCaptureRate: captureRate(date),
		itemDiscountRate:
			isoWeekday(date) === 2 ? TUESDAY_ITEM_DISCOUNT_RATE : ITEM_DISCOUNT_RATE,
		voucherRate: isFirstIsoWeekOfMonth(date)
			? FIRST_WEEK_VOUCHER_RATE
			: VOUCHER_RATE,
	};
	return {
		open: isOpenOn(store, date),
		profile,
		menu: demoMenu(menuVariantFor(date, asOf, store.id === "MOCK-S1")),
	};
}

export interface DemoRole {
	readonly posAccountId: string;
	readonly itemTypeExternalId: string;
	readonly role: "drink" | "topping" | "snack" | "other";
}

const ROLE_BY_TYPE: Readonly<Record<string, DemoRole["role"]>> = {
	"TYPE-001": "drink",
	"TYPE-002": "drink",
	"TYPE-003": "drink",
	"TYPE-004": "drink",
	"TYPE-005": "drink",
	"TYPE-006": "drink",
	"TYPE-007": "topping",
	"TYPE-008": "topping",
	"TYPE-009": "snack",
	"TYPE-010": "other",
};

export function demoRoles(): readonly DemoRole[] {
	return Object.entries(ROLE_BY_TYPE).map(([itemTypeExternalId, role]) => ({
		posAccountId: DEMO_POS_ACCOUNT_ID,
		itemTypeExternalId,
		role,
	}));
}

export function demoRoleOf(
	itemTypeExternalId: string | null | undefined,
): DemoRole["role"] | null {
	if (itemTypeExternalId === null || itemTypeExternalId === undefined) {
		return null;
	}
	return ROLE_BY_TYPE[itemTypeExternalId] ?? null;
}

export function demoTargets(
	store: DemoStoreDefinition,
	monthStart: IsoDate,
	options: DemoDayPlanOptions = {},
): number | null {
	if (!store.hasMonthlyTargets) return null;
	if (monthStart !== firstOfMonth(monthStart)) return null;
	if (monthStart < firstOfMonth(store.openedOn)) return null;
	const [year, month] = monthStart.split("-").map(Number) as [number, number];
	let invoices = 0;
	for (let offset = 0; offset < daysInMonth(year, month); offset += 1) {
		const date = addDays(monthStart, offset);
		if (isOpenOn(store, date)) {
			invoices += expectedInvoices(store, date, options);
		}
	}
	return roundHalfAwayFromZero(
		invoices * TARGET_TICKET * TARGET_UPLIFT,
		TARGET_ROUNDING_DIGITS,
	);
}

export interface DemoSyncCheck {
	readonly matched: boolean;
}

export function demoSyncCheck(
	store: DemoStoreDefinition,
	date: IsoDate,
	asOf: IsoDate,
): DemoSyncCheck | null {
	if (date < store.openedOn || date > asOf) return null;
	if (
		store.id === "MOCK-S2" &&
		date === addDays(asOf, -UNCHECKED_DAYS_BEFORE_AS_OF)
	) {
		return null;
	}
	return {
		matched: !(
			store.id === "MOCK-S1" &&
			date === addDays(asOf, -UNMATCHED_CHECK_DAYS_BEFORE_AS_OF)
		),
	};
}

export function openingMinutes(
	hours: OpeningHours | null,
	date: IsoDate,
): number | null {
	if (hours === null) return null;
	const spans = hours[WEEKDAY_KEYS[isoWeekday(date) - 1] as Weekday] ?? [];
	let minutes = 0;
	for (const [open, close] of spans) {
		const opening = minutesOfDay(open);
		const closing = minutesOfDay(close);
		minutes += closing > opening ? closing - opening : closing - opening + 1440;
	}
	return minutes;
}

function minutesOfDay(clock: string): number {
	const [hours, minutes] = clock.split(":").map(Number) as [number, number];
	return hours * 60 + minutes;
}
