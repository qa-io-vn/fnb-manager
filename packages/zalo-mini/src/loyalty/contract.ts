import type { LegalDocument } from "../session/types";
import {
	NOTICE_VERSION_PATTERN,
	readLegalDocument,
} from "../session/zalo-session-client";

export const CUSTOMER_FUNCTIONS = {
	home: "customer_home",
	wallet: "customer_wallet",
	memberCode: "customer_member_code",
	submitClaim: "customer_submit_claim",
	stopMarketing: "customer_stop_marketing",
	requestDeletion: "customer_request_deletion",
} as const;

export type CustomerFunction =
	(typeof CUSTOMER_FUNCTIONS)[keyof typeof CUSTOMER_FUNCTIONS];

export const CUSTOMER_SESSION_KIND = "customer";
export const CUSTOMER_SIGN_IN_FUNCTION = "zalo_customer_sign_in";
export const CUSTOMER_JOIN_FUNCTION = "customer_join";

export const MEMBER_CODE_REFRESH_SECONDS = 60;
export const MEMBER_CODE_VALID_SECONDS = 120;
export const MEMBER_CODE_PATTERN = /^\d{6}$/;
export const MAX_CLAIMS_PER_DAY = 3;
export const CLAIM_WINDOW_HOURS = 72;
export const MAX_CLAIM_AMOUNT = 100_000_000;
export const RECEIPT_NO_MAX_LENGTH = 40;
export const RECEIPT_NO_PATTERN = /^[^\s\p{Cc}]{1,40}$/u;
export const STORE_CODE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
export const POLICY_VERSION_PATTERN = NOTICE_VERSION_PATTERN;
export const SCREEN_VERSION_PATTERN = NOTICE_VERSION_PATTERN;
export const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
export const UUID_PATTERN =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const REFUSAL_NOT_MEMBER = "42501";
export const REFUSAL_INVALID = "22023";

export const WEEKDAYS = [
	"mon",
	"tue",
	"wed",
	"thu",
	"fri",
	"sat",
	"sun",
] as const;
export type Weekday = (typeof WEEKDAYS)[number];
export type OpeningSpan = readonly [string, string];
export type OpeningHours = Readonly<Record<Weekday, readonly OpeningSpan[]>>;

export const LEDGER_KINDS = [
	"welcome",
	"earn",
	"redeem",
	"adjust",
	"expire",
	"reversal",
] as const;
export type LedgerKind = (typeof LEDGER_KINDS)[number];

export const WELCOME_REASON = "welcome";

export const LEDGER_STATES = ["pending", "confirmed", "reversed"] as const;
export type LedgerState = (typeof LEDGER_STATES)[number];

export const MATCHED_PATHS = [
	"welcome",
	"phone",
	"member_code",
	"receipt_claim",
	"voucher",
	"manual",
] as const;
export type MatchedPath = (typeof MATCHED_PATHS)[number];

export const CLAIM_STATES = [
	"pending",
	"matched",
	"queued",
	"rejected",
	"expired",
] as const;
export type ClaimState = (typeof CLAIM_STATES)[number];

export const CLAIM_REASONS = [
	"daily_cap",
	"outside_window",
	"already_claimed",
	"already_earned",
	"amount_mismatch",
	"no_matching_invoice",
	"invoice_not_completed",
	"membership_inactive",
	"programme_inactive",
	"below_minimum",
	"excluded_phone",
	"excluded_source",
	"dismissed",
] as const;
export type KnownClaimReason = (typeof CLAIM_REASONS)[number];

export const DELETION_STATUSES = [
	"received",
	"in_progress",
	"completed",
	"rejected",
] as const;
export type DeletionStatus = (typeof DELETION_STATUSES)[number];

export const JOIN_REFUSALS = [
	"loyalty_consent_required",
	"policy_outdated",
	"unknown_store",
	"phone_in_use",
	"phone_token_used",
	"phone_token_refused",
	"zalo_unavailable",
] as const;
export type JoinRefusal = (typeof JOIN_REFUSALS)[number];

export type IsoDate = string;

export interface ProgrammeTier {
	readonly code: string;
	readonly name: string;
	readonly minPoints: number;
}

export interface Programme {
	readonly name: string;
	readonly startsOn: IsoDate | null;
	readonly endsOn: IsoDate | null;
	readonly stampsPerCard: number;
	readonly welcomeStamps: number;
	readonly stampValidityMonths: number | null;
	readonly pointsEnabled: boolean;
	readonly pointsExpiryMonths: number | null;
	readonly claimsPerDay: number;
	readonly claimWindowHours: number;
	readonly summary: string | null;
	readonly stampRule: string | null;
	readonly pointsRule: string | null;
	readonly rewardSummary: string | null;
	readonly retentionMonths: number | null;
	readonly tiers: readonly ProgrammeTier[];
}

export interface CustomerStore {
	readonly code: string;
	readonly name: string;
	readonly address: string | null;
	readonly openingHours: OpeningHours;
}

export interface MenuHighlight {
	readonly id: string;
	readonly name: string;
	readonly description: string | null;
	readonly category: string | null;
	readonly storeCodes: readonly string[] | null;
}

export interface CustomerLegal {
	readonly entityName: string;
	readonly policyVersion: string;
	readonly documents: readonly LegalDocument[];
}

export interface CustomerHome {
	readonly programme: Programme;
	readonly oaId: string | null;
	readonly legal: CustomerLegal;
	readonly stores: readonly CustomerStore[];
	readonly menu: readonly MenuHighlight[];
}

export interface MemberCard {
	readonly programmeName: string;
	readonly displayName: string;
	readonly phoneMasked: string;
	readonly memberSince: IsoDate;
	readonly purchases: number;
}

export interface StampCard {
	readonly id: string;
	readonly name: string;
	readonly stamps: number;
	readonly stampsPerCard: number;
	readonly pending: number;
	readonly expiresOn: IsoDate | null;
}

export interface PointsBalance {
	readonly balance: number;
	readonly pending: number;
	readonly expiring: { readonly points: number; readonly on: IsoDate } | null;
}

export interface TierStatus {
	readonly code: string;
	readonly name: string;
	readonly nextName: string | null;
	readonly pointsToNext: number | null;
}

export interface LedgerEntry {
	readonly id: string;
	readonly at: string;
	readonly kind: LedgerKind;
	readonly state: LedgerState;
	readonly stamps: number;
	readonly points: number;
	readonly reason: string | null;
	readonly storeName: string | null;
	readonly receiptNo: string | null;
	readonly matchedPath: MatchedPath | null;
}

export interface ClaimRecord {
	readonly id: string;
	readonly storeName: string;
	readonly receiptNo: string;
	readonly businessDate: IsoDate;
	readonly submittedAt: string;
	readonly state: ClaimState;
	readonly reason: string | null;
}

export interface Wallet {
	readonly card: MemberCard;
	readonly stampCards: readonly StampCard[];
	readonly points: PointsBalance;
	readonly tier: TierStatus | null;
	readonly marketingConsent: boolean;
	readonly history: readonly LedgerEntry[];
	readonly claims: readonly ClaimRecord[];
	readonly claimsToday: number;
	readonly claimsPerDay: number;
}

export interface MemberCode {
	readonly code: string;
	readonly qrPayload: string;
	readonly storeCode: string;
	readonly storeName: string;
	readonly issuedAt: number;
	readonly refreshAt: number;
	readonly expiresAt: number;
}

export interface ClaimInput {
	readonly store: string;
	readonly receiptNo: string;
	readonly amount: number;
	readonly businessDate: IsoDate;
}

export interface ClaimResult {
	readonly claimId: string | null;
	readonly state: ClaimState;
	readonly reason: string | null;
	readonly claimsLeftToday: number;
}

export interface MarketingStop {
	readonly marketingConsent: false;
	readonly stoppedAt: string;
}

export interface DeletionRequest {
	readonly requestId: string;
	readonly status: DeletionStatus;
	readonly requestedAt: string;
}

export interface CustomerProfile {
	readonly tenantId: string;
	readonly customerId: string | null;
	readonly displayName: string | null;
}

export interface CustomerSession {
	readonly accessToken: string;
	readonly refreshToken: string;
	readonly expiresAt: number;
	readonly customer: CustomerProfile;
}

export interface JoinRequest {
	readonly phoneToken: string;
	readonly loyaltyConsent: true;
	readonly marketingConsent: boolean;
	readonly policyVersion: string;
	readonly screenVersion: string;
	readonly store: string | null;
	readonly shownAt: number;
}

export interface JoinOutcome {
	readonly membershipId: string;
	readonly welcomeStamps: number;
	readonly alreadyMember: boolean;
}

export interface CustomerSessionAnswer {
	readonly session: CustomerSession;
	readonly joined: JoinOutcome | null;
}

export interface LoyaltyClient {
	home(): Promise<CustomerHome>;
	wallet(): Promise<Wallet>;
	memberCode(store: string): Promise<MemberCode>;
	submitClaim(input: ClaimInput): Promise<ClaimResult>;
	stopMarketing(): Promise<MarketingStop>;
	requestDeletion(): Promise<DeletionRequest>;
}

type Row = Readonly<Record<string, unknown>>;

function isRecord(value: unknown): value is Row {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function invalid(what: string): never {
	throw new Error(`the loyalty answer has no valid ${what}`);
}

function record(value: unknown, what: string): Row {
	return isRecord(value) ? value : invalid(what);
}

function list(value: unknown, what: string): readonly unknown[] {
	return Array.isArray(value) ? value : invalid(what);
}

function text(value: unknown, what: string): string {
	return typeof value === "string" && value.trim() !== ""
		? value
		: invalid(what);
}

function optionalText(value: unknown, what: string): string | null {
	if (value === null || value === undefined) return null;
	return typeof value === "string" ? value.trim() || null : invalid(what);
}

function count(value: unknown, what: string): number {
	return typeof value === "number" && Number.isInteger(value) && value >= 0
		? value
		: invalid(what);
}

function optionalCount(value: unknown, what: string): number | null {
	return value === null || value === undefined ? null : count(value, what);
}

function signedCount(value: unknown, what: string): number {
	return typeof value === "number" && Number.isInteger(value)
		? value
		: invalid(what);
}

function flag(value: unknown, what: string): boolean {
	return typeof value === "boolean" ? value : invalid(what);
}

function isoDate(value: unknown, what: string): IsoDate {
	return typeof value === "string" && ISO_DATE_PATTERN.test(value)
		? value
		: invalid(what);
}

function optionalIsoDate(value: unknown, what: string): IsoDate | null {
	return value === null || value === undefined ? null : isoDate(value, what);
}

function instant(value: unknown, what: string): string {
	return typeof value === "string" && !Number.isNaN(Date.parse(value))
		? value
		: invalid(what);
}

function optionalDay(value: unknown, what: string): IsoDate | null {
	if (value === null || value === undefined) return null;
	return typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value)
		? value.slice(0, 10)
		: invalid(what);
}

function instantMs(value: unknown, what: string): number {
	return Date.parse(instant(value, what));
}

function oneOf<T extends string>(
	allowed: readonly T[],
	value: unknown,
	what: string,
): T {
	return allowed.find((candidate) => candidate === value) ?? invalid(what);
}

function optionalOneOf<T extends string>(
	allowed: readonly T[],
	value: unknown,
	what: string,
): T | null {
	return value === null || value === undefined
		? null
		: oneOf(allowed, value, what);
}

const REASON_PATTERN = /^[a-z][a-z0-9_]{0,63}$/;

function optionalReason(value: unknown, what: string): string | null {
	if (value === null || value === undefined) return null;
	return typeof value === "string" && REASON_PATTERN.test(value)
		? value
		: invalid(what);
}

export function knownClaimReason(
	reason: string | null,
): KnownClaimReason | null {
	return CLAIM_REASONS.find((name) => name === reason) ?? null;
}

const OPENING_TIME = /^([01][0-9]|2[0-3]):[0-5][0-9]$|^24:00$/;

export function readOpeningHours(value: unknown): OpeningHours {
	const hours = isRecord(value) ? value : {};
	return Object.fromEntries(
		WEEKDAYS.map((weekday) => {
			const spans = Array.isArray(hours[weekday]) ? hours[weekday] : [];
			return [
				weekday,
				(spans as readonly unknown[]).flatMap((span) => {
					if (!Array.isArray(span)) return [];
					const [open, close] = span;
					return typeof open === "string" &&
						typeof close === "string" &&
						OPENING_TIME.test(open) &&
						OPENING_TIME.test(close)
						? [[open, close] as const]
						: [];
				}),
			];
		}),
	) as unknown as OpeningHours;
}

function readTier(value: unknown): ProgrammeTier {
	const row = record(value, "tier");
	return {
		code: text(row.code, "tier code"),
		name: text(row.name, "tier name"),
		minPoints: count(row.min_points, "tier threshold"),
	};
}

export function readProgramme(value: unknown): Programme {
	const row = record(value, "programme");
	const stampsPerCard = count(row.stamps_per_card, "stamps per card");
	if (stampsPerCard < 1) invalid("stamps per card");
	const claimWindowHours = count(
		row.receipt_claim_window_hours ?? CLAIM_WINDOW_HOURS,
		"claim window",
	);
	if (claimWindowHours < 1) invalid("claim window");
	const pointsRule = optionalText(row.points_rule, "points rule");
	return {
		name: text(row.name, "programme name"),
		startsOn: optionalIsoDate(row.starts_on, "programme start"),
		endsOn: optionalIsoDate(row.ends_on, "programme end"),
		stampsPerCard,
		welcomeStamps: count(row.welcome_stamps, "welcome stamps"),
		stampValidityMonths: optionalCount(
			row.stamp_validity_months,
			"stamp validity",
		),
		pointsEnabled:
			row.points_enabled === undefined || row.points_enabled === null
				? pointsRule !== null
				: flag(row.points_enabled, "points flag"),
		pointsExpiryMonths: optionalCount(
			row.points_expiry_months,
			"points expiry",
		),
		claimsPerDay: count(
			row.receipt_claims_per_day ?? MAX_CLAIMS_PER_DAY,
			"claims per day",
		),
		claimWindowHours,
		summary: optionalText(row.summary, "programme summary"),
		stampRule: optionalText(row.stamp_rule, "stamp rule"),
		pointsRule,
		rewardSummary: optionalText(row.reward_summary, "reward summary"),
		retentionMonths: optionalCount(row.retention_months, "retention"),
		tiers: list(row.tiers ?? [], "tiers").map(readTier),
	};
}

export function readCustomerStore(value: unknown): CustomerStore {
	const row = record(value, "store");
	const code = text(row.code, "store code");
	if (!STORE_CODE_PATTERN.test(code)) invalid("store code");
	return {
		code,
		name: text(row.name, "store name"),
		address: optionalText(row.address, "store address"),
		openingHours: readOpeningHours(row.opening_hours),
	};
}

export function readMenuHighlight(value: unknown): MenuHighlight {
	const row = record(value, "menu highlight");
	const stores =
		row.store_codes === null || row.store_codes === undefined
			? null
			: list(row.store_codes, "menu stores").map((code) =>
					text(code, "menu store"),
				);
	return {
		id: text(row.id, "menu id"),
		name: text(row.name, "menu name"),
		description: optionalText(row.description, "menu description"),
		category: optionalText(row.category, "menu category"),
		storeCodes: stores,
	};
}

export function readCustomerLegal(value: unknown): CustomerLegal {
	const row = record(value, "legal texts");
	const policyVersion = text(row.policy_version, "policy version");
	if (!POLICY_VERSION_PATTERN.test(policyVersion)) invalid("policy version");
	return {
		entityName: text(row.entity_name, "legal entity"),
		policyVersion,
		documents: list(row.documents ?? [], "legal documents").map(
			(document) => readLegalDocument(document) ?? invalid("legal document"),
		),
	};
}

export function readCustomerHome(value: unknown): CustomerHome {
	const row = record(value, "home");
	return {
		programme: readProgramme(row.programme),
		oaId: optionalText(row.oa_id, "Official Account"),
		legal: readCustomerLegal(row.legal),
		stores: list(row.stores, "stores").map(readCustomerStore),
		menu: list(row.menu ?? [], "menu").map(readMenuHighlight),
	};
}

function readMemberCard(value: unknown): MemberCard {
	const row = record(value, "member card");
	return {
		programmeName: text(row.programme_name, "card programme"),
		displayName: text(row.display_name, "card name"),
		phoneMasked: text(row.phone_masked, "card phone"),
		memberSince: isoDate(row.member_since, "member since"),
		purchases: count(row.purchases, "purchases"),
	};
}

function readStampCard(value: unknown): StampCard {
	const row = record(value, "stamp card");
	const stampsPerCard = count(row.stamps_per_card, "stamps per card");
	if (stampsPerCard < 1) invalid("stamps per card");
	return {
		id: text(row.id, "stamp card id"),
		name: text(row.name, "stamp card name"),
		stamps: count(row.stamps, "stamps"),
		stampsPerCard,
		pending: count(row.pending ?? 0, "pending stamps"),
		expiresOn: optionalDay(row.expires_on, "stamp expiry"),
	};
}

function readPoints(value: unknown): PointsBalance {
	const row = record(value, "points");
	const expiring =
		row.expiring === null || row.expiring === undefined
			? null
			: record(row.expiring, "expiring points");
	return {
		balance: signedCount(row.balance, "points balance"),
		pending: count(row.pending ?? 0, "pending points"),
		expiring:
			expiring === null
				? null
				: {
						points: count(expiring.points, "expiring points"),
						on: isoDate(expiring.on, "points expiry"),
					},
	};
}

function readTierStatus(value: unknown): TierStatus | null {
	if (value === null || value === undefined) return null;
	const row = record(value, "tier");
	return {
		code: text(row.code, "tier code"),
		name: text(row.name, "tier name"),
		nextName: optionalText(row.next_name, "next tier"),
		pointsToNext:
			row.points_to_next === null || row.points_to_next === undefined
				? null
				: count(row.points_to_next, "points to the next tier"),
	};
}

export function readLedgerEntry(value: unknown): LedgerEntry {
	const row = record(value, "history entry");
	return {
		id: text(row.id, "history id"),
		at: instant(row.at, "history time"),
		kind: oneOf(LEDGER_KINDS, row.kind, "history kind"),
		state: oneOf(LEDGER_STATES, row.state, "history state"),
		stamps: signedCount(row.stamps ?? 0, "history stamps"),
		points: signedCount(row.points ?? 0, "history points"),
		reason: optionalText(row.reason, "history reason"),
		storeName: optionalText(row.store_name, "history store"),
		receiptNo: optionalText(row.receipt_no, "history receipt"),
		matchedPath: optionalOneOf(MATCHED_PATHS, row.matched_path, "match path"),
	};
}

export function readClaimRecord(value: unknown): ClaimRecord {
	const row = record(value, "claim");
	return {
		id: text(row.id, "claim id"),
		storeName: text(row.store_name, "claim store"),
		receiptNo: text(row.receipt_no, "claim receipt"),
		businessDate: isoDate(row.business_date, "claim date"),
		submittedAt: instant(row.submitted_at, "claim time"),
		state: oneOf(CLAIM_STATES, row.state, "claim state"),
		reason: optionalReason(row.reason, "claim reason"),
	};
}

export function readWallet(value: unknown): Wallet {
	const row = record(value, "wallet");
	return {
		card: readMemberCard(row.card),
		stampCards: list(row.stamp_cards, "stamp cards").map(readStampCard),
		points: readPoints(row.points),
		tier: readTierStatus(row.tier),
		marketingConsent: flag(row.marketing_consent, "marketing consent"),
		history: list(row.history, "history").map(readLedgerEntry),
		claims: list(row.claims ?? [], "claims").map(readClaimRecord),
		claimsToday: count(row.claims_today, "claims today"),
		claimsPerDay: count(
			row.claims_per_day ?? MAX_CLAIMS_PER_DAY,
			"claims per day",
		),
	};
}

export function readMemberCode(value: unknown): MemberCode {
	const row = record(value, "member code");
	const code = text(row.code, "member code");
	if (!MEMBER_CODE_PATTERN.test(code)) invalid("member code");
	const expiresAt = instantMs(row.expires_at, "member code expiry");
	const issuedAt =
		row.issued_at === null || row.issued_at === undefined
			? expiresAt - MEMBER_CODE_VALID_SECONDS * 1000
			: instantMs(row.issued_at, "member code issue time");
	const refreshAt =
		row.refresh_at === null || row.refresh_at === undefined
			? Math.min(issuedAt + MEMBER_CODE_REFRESH_SECONDS * 1000, expiresAt)
			: instantMs(row.refresh_at, "member code refresh time");
	if (!(issuedAt <= refreshAt && refreshAt <= expiresAt))
		invalid("member code times");
	return {
		code,
		qrPayload: optionalText(row.qr_payload, "member code payload") ?? code,
		storeCode: text(row.store_code, "member code store"),
		storeName: text(row.store_name, "member code store name"),
		issuedAt,
		refreshAt,
		expiresAt,
	};
}

export function readClaimResult(value: unknown): ClaimResult {
	const row = record(value, "claim result");
	const state = oneOf(CLAIM_STATES, row.state, "claim result state");
	const reason = optionalReason(row.reason, "claim reason");
	if (state === "rejected" && reason === null) invalid("claim reason");
	return {
		claimId: optionalText(row.claim_id, "claim id"),
		state,
		reason,
		claimsLeftToday: count(row.claims_left_today, "claims left today"),
	};
}

export function readMarketingStop(value: unknown): MarketingStop {
	const row = record(value, "marketing answer");
	if (row.marketing_consent !== false) invalid("marketing answer");
	return {
		marketingConsent: false,
		stoppedAt: instant(row.stopped_at, "marketing stop time"),
	};
}

export function readDeletionRequest(value: unknown): DeletionRequest {
	const row = record(value, "deletion request");
	return {
		requestId: text(row.request_id, "deletion request id"),
		status:
			row.status === undefined && row.state === "open"
				? "received"
				: oneOf(DELETION_STATUSES, row.status, "deletion request status"),
		requestedAt: instant(row.requested_at, "deletion request time"),
	};
}

export function claimArgs(
	input: ClaimInput,
): Readonly<Record<string, unknown>> {
	return {
		p_store: input.store,
		p_receipt_no: input.receiptNo,
		p_amount: input.amount,
		p_business_date: input.businessDate,
	};
}

export function memberCodeArgs(
	store: string,
): Readonly<Record<string, unknown>> {
	return { p_store: store };
}

export function joinBody(
	request: JoinRequest,
): Readonly<Record<string, unknown>> {
	return {
		phone_token: request.phoneToken,
		loyalty_consent: request.loyaltyConsent,
		marketing_consent: request.marketingConsent,
		policy_version: request.policyVersion,
		screen_version: request.screenVersion,
		store: request.store,
		shown_at: new Date(request.shownAt).toISOString(),
	};
}

export function readCustomerProfile(value: unknown): CustomerProfile | null {
	if (!isRecord(value)) return null;
	const { tenantId, customerId, displayName } = value;
	if (typeof tenantId !== "string" || tenantId === "") return null;
	if (
		customerId !== null &&
		(typeof customerId !== "string" || customerId === "")
	)
		return null;
	if (displayName !== null && typeof displayName !== "string") return null;
	return {
		tenantId,
		customerId,
		displayName:
			displayName === null || displayName.trim() === "" ? null : displayName,
	};
}

export function readCustomerSession(value: unknown): CustomerSession | null {
	if (!isRecord(value)) return null;
	const { accessToken, refreshToken, expiresAt } = value;
	if (typeof accessToken !== "string" || accessToken === "") return null;
	if (typeof refreshToken !== "string") return null;
	if (typeof expiresAt !== "number" || !Number.isFinite(expiresAt)) return null;
	const customer = readCustomerProfile(value.customer);
	if (customer === null) return null;
	return { accessToken, refreshToken, expiresAt, customer };
}

function readJoinOutcome(value: unknown): JoinOutcome | null | undefined {
	if (value === undefined || value === null) return undefined;
	if (!isRecord(value)) return null;
	const { membership_id, welcome_stamps, already_member } = value;
	if (typeof membership_id !== "string" || membership_id === "") return null;
	if (
		typeof welcome_stamps !== "number" ||
		!Number.isInteger(welcome_stamps) ||
		welcome_stamps < 0
	)
		return null;
	if (typeof already_member !== "boolean") return null;
	return {
		membershipId: membership_id,
		welcomeStamps: welcome_stamps,
		alreadyMember: already_member,
	};
}

export function parseCustomerSessionAnswer(
	value: unknown,
): CustomerSessionAnswer | null {
	if (!isRecord(value) || value.status !== CUSTOMER_SESSION_KIND) return null;
	if (!isRecord(value.customer)) return null;
	const session = readCustomerSession({
		accessToken: value.access_token,
		refreshToken: value.refresh_token,
		expiresAt: value.expires_at,
		customer: {
			tenantId: value.customer.tenant_id,
			customerId: value.customer.customer_id ?? null,
			displayName: value.customer.display_name ?? null,
		},
	});
	if (session === null) return null;
	const joined = readJoinOutcome(value.joined);
	if (joined === null) return null;
	if (joined !== undefined && session.customer.customerId === null) return null;
	return { session, joined: joined ?? null };
}

export function joinRefusalOf(code: unknown): JoinRefusal | null {
	return JOIN_REFUSALS.find((name) => name === code) ?? null;
}
