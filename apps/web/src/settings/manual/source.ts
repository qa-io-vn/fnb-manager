import type { IsoDate } from "@fnb/reports";
import type { Language } from "../../i18n";
import type { AuditEntry } from "../source";

export const LEGAL_DOCUMENT_KINDS = [
	"privacy_notice",
	"data_protection_rules",
	"mini_app_terms",
	"staff_notice",
	"loyalty_consent_text",
	"marketing_consent_text",
] as const;

export type LegalDocumentKind = (typeof LEGAL_DOCUMENT_KINDS)[number];

export const LEGAL_DOCUMENT_STATUSES = [
	"draft",
	"published",
	"retired",
] as const;

export type LegalDocumentStatus = (typeof LEGAL_DOCUMENT_STATUSES)[number];

export const TARGET_PERIOD_KINDS = ["month", "week"] as const;

export type TargetPeriodKind = (typeof TARGET_PERIOD_KINDS)[number];

export interface ItemCostChange {
	readonly storeId: string | null;
	readonly itemExternalId: string;
	readonly costAmount: number;
	readonly effectiveFrom: IsoDate;
}

export interface ItemCostRow extends ItemCostChange {
	readonly id: string;
	readonly audit: AuditEntry | null;
}

export interface TargetChange {
	readonly storeId: string;
	readonly periodKind: TargetPeriodKind;
	readonly periodStart: IsoDate;
	readonly netTargetAmount: number;
}

export interface TargetRow extends TargetChange {
	readonly id: string;
	readonly audit: AuditEntry | null;
}

export interface LegalDraftChange {
	readonly id?: string;
	readonly kind: LegalDocumentKind;
	readonly language: Language;
	readonly version: string;
	readonly title: string;
	readonly bodyMarkdown: string;
}

export interface LegalDocumentRow {
	readonly id: string;
	readonly kind: LegalDocumentKind;
	readonly language: Language;
	readonly version: string;
	readonly title: string;
	readonly bodyMarkdown: string;
	readonly status: LegalDocumentStatus;
	readonly publishedAt: string | null;
	readonly retiredAt: string | null;
	readonly audit: AuditEntry | null;
}

export interface ManualSettingsSource {
	readonly kind: "supabase" | "demo";
	itemCosts(tenantId: string): Promise<ItemCostRow[]>;
	saveItemCosts(
		tenantId: string,
		rows: readonly ItemCostChange[],
	): Promise<ItemCostRow[]>;
	deleteItemCost(tenantId: string, id: string): Promise<void>;
	targets(tenantId: string): Promise<TargetRow[]>;
	saveTargets(
		tenantId: string,
		rows: readonly TargetChange[],
	): Promise<TargetRow[]>;
	legalDocuments(tenantId: string): Promise<LegalDocumentRow[]>;
	saveLegalDraft(
		tenantId: string,
		change: LegalDraftChange,
	): Promise<LegalDocumentRow>;
	publishLegalDocument(tenantId: string, id: string): Promise<void>;
	retireLegalDocument(tenantId: string, id: string): Promise<void>;
	deleteLegalDraft(tenantId: string, id: string): Promise<void>;
}

export function legalStatusOf(
	publishedAt: string | null,
	retiredAt: string | null,
): LegalDocumentStatus {
	if (retiredAt !== null) return "retired";
	return publishedAt === null ? "draft" : "published";
}
