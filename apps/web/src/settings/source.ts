import type { PaymentKind } from "@fnb/core";
import type {
	EInvoiceStatus,
	IsoDate,
	PosFeatureStatus,
	ReportSettings,
	TranNoResetPeriod,
} from "@fnb/reports";
import type { Language } from "../i18n";
import type { OpeningHours } from "./validation";

export type TenantRole = "owner" | "manager" | "staff" | "viewer" | "publisher";

export type ItemTypeRole = "drink" | "topping" | "food" | "snack" | "other";

export const ITEM_TYPE_ROLES: readonly ItemTypeRole[] = [
	"drink",
	"topping",
	"food",
	"snack",
	"other",
];

export interface Membership {
	readonly role: TenantRole;
	readonly storeIds: readonly string[] | null;
}

export interface ItemTypeEntry {
	readonly posAccountId: string;
	readonly posAccountName: string;
	readonly itemTypeExternalId: string;
	readonly name: string;
	readonly role: ItemTypeRole | null;
	readonly audit: AuditEntry | null;
}

export interface RoleChange {
	readonly posAccountId: string;
	readonly itemTypeExternalId: string;
	readonly role: ItemTypeRole | null;
}

export type AuditAuthor =
	| { readonly kind: "you" }
	| { readonly kind: "member"; readonly role: TenantRole }
	| { readonly kind: "unknown" };

export interface AuditEntry {
	readonly changedAt: string;
	readonly author: AuditAuthor;
}

export interface MemberRoleRow {
	readonly userId: string;
	readonly role: TenantRole;
}

export function auditAuthorOf(
	updatedBy: string | null,
	currentUserId: string | null,
	members: readonly MemberRoleRow[],
): AuditAuthor {
	if (updatedBy === null) return { kind: "unknown" };
	if (updatedBy === currentUserId) return { kind: "you" };
	const member = members.find((row) => row.userId === updatedBy);
	return member === undefined
		? { kind: "unknown" }
		: { kind: "member", role: member.role };
}

export interface ReportSettingsState {
	readonly settings: ReportSettings;
	readonly hasRow: boolean;
	readonly audit: AuditEntry | null;
}

export interface CatchUpStatus {
	readonly inputsChangedAt: string | null;
	readonly pendingFrom: IsoDate | null;
	readonly pendingTo: IsoDate | null;
	readonly pendingDays: number;
	readonly canRefresh: boolean;
}

export const LEGAL_FORMS = [
	"household_business",
	"micro_enterprise",
	"small_enterprise",
	"enterprise",
	"unknown",
] as const;

export type LegalForm = (typeof LEGAL_FORMS)[number];

export const APP_LANGUAGES: readonly Language[] = ["vi", "en"];

export interface TenantProfile {
	readonly legalForm: LegalForm;
	readonly defaultLanguage: Language;
	readonly audit: AuditEntry | null;
}

export interface TenantProfileChange {
	readonly legalForm?: LegalForm;
	readonly defaultLanguage?: Language;
}

export interface StoreProfileFields {
	readonly code: string | null;
	readonly openingHours: OpeningHours | null;
	readonly seatCount: number | null;
	readonly openedOn: IsoDate | null;
	readonly eInvoiceStatus: EInvoiceStatus;
	readonly tranNoResetPeriod: TranNoResetPeriod;
	readonly memberCaptureStatus: PosFeatureStatus;
}

export interface StoreProfile extends StoreProfileFields {
	readonly storeId: string;
	readonly posAccountId: string;
	readonly name: string;
	readonly address: string | null;
	readonly timeZone: string;
	readonly businessDayStartMinutes: number;
	readonly audit: AuditEntry | null;
}

export type StoreProfileChange = Partial<StoreProfileFields>;

export interface ItemEntry {
	readonly posAccountId: string;
	readonly itemExternalId: string;
	readonly name: string;
	readonly sizeLabel: string | null;
	readonly listPrice: number | null;
	readonly isModifier: boolean;
	readonly active: boolean;
	readonly inCatalogue: boolean;
	readonly posItemTypeExternalId: string | null;
	readonly overrideItemTypeExternalId: string | null;
	readonly audit: AuditEntry | null;
}

export interface CategoryOverrideChange {
	readonly posAccountId: string;
	readonly itemExternalId: string;
	readonly itemTypeExternalId: string | null;
}

export interface PaymentMethodEntry {
	readonly posAccountId: string;
	readonly posAccountName: string;
	readonly externalId: string;
	readonly name: string;
	readonly posKind: PaymentKind;
	readonly overrideKind: PaymentKind | null;
	readonly kind: PaymentKind;
	readonly audit: AuditEntry | null;
}

export interface KindOverrideChange {
	readonly posAccountId: string;
	readonly paymentMethodExternalId: string;
	readonly kind: PaymentKind | null;
}

export interface FeeRateChange {
	readonly storeId: string | null;
	readonly paymentMethodExternalId: string;
	readonly feePct: number;
	readonly fixedFeeAmount: number;
	readonly effectiveFrom: IsoDate;
}

export interface FeeRateRow extends FeeRateChange {
	readonly id: string;
	readonly audit: AuditEntry | null;
}

export interface HolidayChange {
	readonly holidayDate: IsoDate;
	readonly name: string;
}

export interface HolidayRow extends HolidayChange {
	readonly id: string;
	readonly countryCode: string;
	readonly kind: string;
	readonly custom: boolean;
	readonly audit: AuditEntry | null;
}

export interface SettingsSource {
	readonly kind: "supabase" | "demo";
	membership(tenantId: string): Promise<Membership | null>;
	tenantProfile(tenantId: string): Promise<TenantProfile>;
	updateTenantProfile(
		tenantId: string,
		change: TenantProfileChange,
	): Promise<TenantProfile>;
	storeProfiles(tenantId: string): Promise<StoreProfile[]>;
	updateStoreProfile(
		tenantId: string,
		storeId: string,
		change: StoreProfileChange,
	): Promise<StoreProfile>;
	itemTypes(tenantId: string): Promise<ItemTypeEntry[]>;
	saveRoles(tenantId: string, changes: readonly RoleChange[]): Promise<void>;
	items(tenantId: string): Promise<ItemEntry[]>;
	saveCategoryOverrides(
		tenantId: string,
		changes: readonly CategoryOverrideChange[],
	): Promise<void>;
	paymentMethods(tenantId: string): Promise<PaymentMethodEntry[]>;
	saveKindOverrides(
		tenantId: string,
		changes: readonly KindOverrideChange[],
	): Promise<void>;
	feeRates(tenantId: string): Promise<FeeRateRow[]>;
	saveFeeRates(
		tenantId: string,
		rows: readonly FeeRateChange[],
	): Promise<FeeRateRow[]>;
	holidays(tenantId: string, year: number): Promise<HolidayRow[]>;
	addHoliday(tenantId: string, change: HolidayChange): Promise<HolidayRow>;
	deleteHoliday(tenantId: string, id: string): Promise<void>;
	reportSettings(tenantId: string): Promise<ReportSettingsState>;
	saveReportSettings(
		tenantId: string,
		changes: Partial<ReportSettings>,
	): Promise<void>;
	catchUpStatus(tenantId: string): Promise<CatchUpStatus>;
	refreshChunk(tenantId: string): Promise<CatchUpStatus>;
}

export type SettingsWriteCode =
	| "forbidden"
	| "duplicate"
	| "invalid"
	| "frozen"
	| "network";

export function writeCodeOf(error: unknown): SettingsWriteCode {
	return error instanceof SettingsWriteError ? error.code : "network";
}

export class SettingsWriteError extends Error {
	readonly code: SettingsWriteCode;
	readonly constraint: string | null;

	constructor(code: SettingsWriteCode, constraint: string | null = null) {
		super(`settings write refused: ${code}`);
		this.name = "SettingsWriteError";
		this.code = code;
		this.constraint = constraint;
	}
}

export function yearBounds(year: number): { from: IsoDate; to: IsoDate } {
	const padded = String(year).padStart(4, "0");
	return { from: `${padded}-01-01`, to: `${padded}-12-31` };
}

export const NO_CATCH_UP: CatchUpStatus = {
	inputsChangedAt: null,
	pendingFrom: null,
	pendingTo: null,
	pendingDays: 0,
	canRefresh: false,
};
