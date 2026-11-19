import config from "virtual:mini-app-config";
import type {
	LegalDocument,
	LegalDocumentKind,
	Translate,
} from "@fnb/zalo-mini";
import type { CustomerLegal } from "@fnb/zalo-mini/loyalty";
import { Popup, useI18n } from "@fnb/zalo-mini/react";
import { useCallback, useState } from "react";
import { useCustomerData } from "../data/customer-data";
import { isoDateIn, shownDate } from "../data/dates";
import { quietButton, secondaryButton } from "../ui";
import { MarkdownText } from "./markdown";

export const LEGAL_TITLE_KEYS: Readonly<Record<LegalDocumentKind, string>> = {
	privacy_notice: "legal.privacyTitle",
	mini_app_terms: "legal.termsTitle",
};

export const LEGAL_LABEL_KEYS: Readonly<Record<LegalDocumentKind, string>> = {
	privacy_notice: "legal.privacy",
	mini_app_terms: "legal.terms",
};

export function pickDocument(
	documents: readonly LegalDocument[],
	kind: LegalDocumentKind,
	language: "vi" | "en",
): LegalDocument | null {
	const ofKind = documents.filter((document) => document.kind === kind);
	return (
		ofKind.find((document) => document.language === language) ??
		ofKind.find((document) => document.language === "vi") ??
		ofKind[0] ??
		null
	);
}

export function legalTitle(
	t: Translate,
	kind: LegalDocumentKind,
	appName: string = config.app.title,
): string {
	return t(LEGAL_TITLE_KEYS[kind], { app: appName });
}

function LegalBody({
	legal,
	kind,
}: {
	readonly legal: CustomerLegal;
	readonly kind: LegalDocumentKind;
}) {
	const { t, language } = useI18n();
	const document = pickDocument(legal.documents, kind, language);
	if (document === null) {
		return (
			<p role="alert" className="text-base text-ink">
				{t("legal.unavailable")}
			</p>
		);
	}
	return (
		<div className="flex flex-col gap-3" data-testid="legal-document">
			<p className="text-base text-ink" data-testid="legal-entity">
				{t("legal.entity", { entity: legal.entityName })}
			</p>
			<p className="text-sm text-ink-muted" data-testid="legal-version">
				{t("legal.version", {
					version: document.version,
					date: shownDate(isoDateIn(Date.parse(document.publishedAt))),
				})}
			</p>
			<MarkdownText markdown={document.bodyMarkdown} />
		</div>
	);
}

export function LegalPopup({
	kind,
	onClose,
}: {
	readonly kind: LegalDocumentKind;
	readonly onClose: () => void;
}) {
	const { t } = useI18n();
	const { home, reloadHome } = useCustomerData();
	return (
		<Popup
			title={legalTitle(t, kind)}
			onClose={onClose}
			testId={`legal-${kind}`}
		>
			{home.status === "ready" ? (
				<LegalBody legal={home.data.legal} kind={kind} />
			) : home.status === "loading" ? (
				<p role="status" className="text-base text-ink">
					{t("customer.loading")}
				</p>
			) : (
				<div className="flex flex-col gap-3">
					<p role="alert" className="text-base text-ink">
						{t("legal.unavailable")}
					</p>
					<button
						type="button"
						className={secondaryButton}
						onClick={reloadHome}
					>
						{t("customer.retry")}
					</button>
				</div>
			)}
		</Popup>
	);
}

export function useLegalPopup() {
	const [open, setOpen] = useState<LegalDocumentKind | null>(null);
	const close = useCallback(() => setOpen(null), []);
	const popup =
		open === null ? null : <LegalPopup kind={open} onClose={close} />;
	return { open: setOpen, popup };
}

export function LegalButtons() {
	const { t } = useI18n();
	const { open, popup } = useLegalPopup();
	return (
		<>
			<div className="flex flex-wrap items-center justify-center gap-x-2">
				<button
					type="button"
					className={quietButton}
					onClick={() => open("privacy_notice")}
				>
					{t(LEGAL_LABEL_KEYS.privacy_notice)}
				</button>
				<button
					type="button"
					className={quietButton}
					onClick={() => open("mini_app_terms")}
				>
					{t(LEGAL_LABEL_KEYS.mini_app_terms)}
				</button>
			</div>
			{popup}
		</>
	);
}
