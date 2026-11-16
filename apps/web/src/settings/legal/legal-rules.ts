import type { Language } from "../../i18n";
import type { IsoDate } from "../../lib/business-dates";
import {
	LEGAL_DOCUMENT_KINDS,
	type LegalDocumentKind,
	type LegalDocumentRow,
	type LegalDocumentStatus,
	type LegalDraftChange,
} from "../manual/source";
import { APP_LANGUAGES } from "../source";

export const LEGAL_VERSION_PATTERN = /^[a-z0-9][a-z0-9.-]{0,39}$/;
export const LEGAL_VERSION_MAX_LENGTH = 40;
export const LEGAL_TITLE_MAX_LENGTH = 200;
export const LEGAL_BODY_MAX_LENGTH = 100_000;

export const LEGAL_SKELETON_HEADINGS: Readonly<
	Record<Language, readonly string[]>
> = {
	vi: [
		"Mục đích xử lý dữ liệu",
		"Dữ liệu được thu thập",
		"Thời gian lưu trữ",
		"Quyền của chủ thể dữ liệu và cách thực hiện",
		"Liên hệ",
		"Bên xử lý dữ liệu và lưu trữ ở nước ngoài",
	],
	en: [
		"Purpose of processing",
		"Data collected",
		"Retention",
		"Your rights and how to use them",
		"Contact",
		"Processors and hosting abroad",
	],
};

export function legalSkeleton(language: Language): string {
	return LEGAL_SKELETON_HEADINGS[language]
		.map((heading) => `## ${heading}`)
		.join("\n\n");
}

export function legalVersionLabelOf(
	kind: LegalDocumentKind,
	date: IsoDate,
): string {
	return `${kind.replaceAll("_", "-")}-${date.slice(0, 7)}`;
}

export function suggestedLegalVersion(
	kind: LegalDocumentKind,
	today: IsoDate,
	taken: ReadonlySet<string>,
): string {
	const base = legalVersionLabelOf(kind, today);
	if (!taken.has(base)) return base;
	let suffix = 2;
	while (taken.has(`${base}.${suffix}`)) suffix += 1;
	return `${base}.${suffix}`;
}

export interface LegalDraftFields {
	readonly title: string;
	readonly version: string;
	readonly bodyMarkdown: string;
}

export type LegalFieldIssue =
	| { readonly key: "required" }
	| { readonly key: "textLength"; readonly max: number }
	| { readonly key: "versionFormat" }
	| { readonly key: "versionTaken" };

export type LegalDraftIssues = Readonly<
	Partial<Record<keyof LegalDraftFields, LegalFieldIssue>>
>;

export function characterCount(text: string): number {
	return [...text].length;
}

function textIssue(text: string, max: number): LegalFieldIssue | null {
	if (text.trim() === "") return { key: "required" };
	return characterCount(text) > max ? { key: "textLength", max } : null;
}

function versionIssue(
	version: string,
	taken: ReadonlySet<string>,
): LegalFieldIssue | null {
	if (version === "") return { key: "required" };
	if (!LEGAL_VERSION_PATTERN.test(version)) return { key: "versionFormat" };
	return taken.has(version) ? { key: "versionTaken" } : null;
}

export function legalDraftIssues(
	fields: LegalDraftFields,
	taken: ReadonlySet<string>,
): LegalDraftIssues {
	const normalised = normalisedDraftFields(fields);
	const issues: Partial<Record<keyof LegalDraftFields, LegalFieldIssue>> = {};
	const title = textIssue(normalised.title, LEGAL_TITLE_MAX_LENGTH);
	const version = versionIssue(normalised.version, taken);
	const body = textIssue(normalised.bodyMarkdown, LEGAL_BODY_MAX_LENGTH);
	if (title !== null) issues.title = title;
	if (version !== null) issues.version = version;
	if (body !== null) issues.bodyMarkdown = body;
	return issues;
}

export function normalisedDraftFields(
	fields: LegalDraftFields,
): LegalDraftFields {
	return {
		title: fields.title.trim(),
		version: fields.version.trim(),
		bodyMarkdown: fields.bodyMarkdown,
	};
}

export function changedDraftFields(
	saved: LegalDraftFields,
	draft: LegalDraftFields,
): (keyof LegalDraftFields)[] {
	const normalised = normalisedDraftFields(draft);
	return (["title", "version", "bodyMarkdown"] as const).filter(
		(field) => normalised[field] !== saved[field],
	);
}

export function legalDraftChangeOf(
	kind: LegalDocumentKind,
	language: Language,
	draftId: string | null,
	fields: LegalDraftFields,
): LegalDraftChange {
	const normalised = normalisedDraftFields(fields);
	return {
		...(draftId === null ? {} : { id: draftId }),
		kind,
		language,
		...normalised,
	};
}

export interface LegalGroup {
	readonly kind: LegalDocumentKind;
	readonly language: Language;
	readonly current: LegalDocumentRow | null;
	readonly versions: readonly LegalDocumentRow[];
}

const STATUS_ORDER: Readonly<Record<LegalDocumentStatus, number>> = {
	published: 0,
	draft: 1,
	retired: 2,
};

function versionOrder(left: LegalDocumentRow, right: LegalDocumentRow) {
	const byStatus = STATUS_ORDER[left.status] - STATUS_ORDER[right.status];
	if (byStatus !== 0) return byStatus;
	if (left.status === "retired") {
		const byRetirement = (right.retiredAt ?? "").localeCompare(
			left.retiredAt ?? "",
		);
		if (byRetirement !== 0) return byRetirement;
	}
	return left.version < right.version
		? -1
		: left.version > right.version
			? 1
			: 0;
}

export function legalGroupsOf(rows: readonly LegalDocumentRow[]): LegalGroup[] {
	return LEGAL_DOCUMENT_KINDS.flatMap((kind) =>
		APP_LANGUAGES.map((language) => {
			const versions = rows
				.filter((row) => row.kind === kind && row.language === language)
				.sort(versionOrder);
			return {
				kind,
				language,
				current: versions.find((row) => row.status === "published") ?? null,
				versions,
			};
		}),
	);
}

export function takenVersionsOf(
	group: LegalGroup,
	exceptId: string | null = null,
): Set<string> {
	return new Set(
		group.versions
			.filter((row) => row.id !== exceptId)
			.map((row) => row.version),
	);
}
