import type { LegalDocument, LegalDocumentKind } from "@fnb/zalo-mini";
import { Popup, useI18n } from "@fnb/zalo-mini/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { quietButton, secondaryButton, shownDate } from "../ui";
import { MarkdownText } from "./markdown";

export type LegalLoader = () => Promise<readonly LegalDocument[] | null>;

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

type LegalLoad =
	| { readonly status: "loading" }
	| { readonly status: "ready"; readonly document: LegalDocument }
	| { readonly status: "unavailable" };

export function LegalPopup({
	kind,
	load,
	onClose,
}: {
	readonly kind: LegalDocumentKind;
	readonly load: LegalLoader;
	readonly onClose: () => void;
}) {
	const { t, language } = useI18n();
	const [state, setState] = useState<LegalLoad>({ status: "loading" });
	const mounted = useRef(true);
	useEffect(() => {
		mounted.current = true;
		return () => {
			mounted.current = false;
		};
	}, []);
	const fetchDocument = useCallback(() => {
		setState({ status: "loading" });
		load()
			.catch(() => null)
			.then((documents) => {
				if (!mounted.current) return;
				const document =
					documents === null ? null : pickDocument(documents, kind, language);
				setState(
					document === null
						? { status: "unavailable" }
						: { status: "ready", document },
				);
			});
	}, [load, kind, language]);
	useEffect(() => {
		fetchDocument();
	}, [fetchDocument]);
	const title =
		state.status === "ready" ? state.document.title : t(LEGAL_LABEL_KEYS[kind]);
	return (
		<Popup title={title} onClose={onClose} testId={`legal-${kind}`}>
			{state.status === "loading" ? (
				<p
					role="status"
					aria-live="polite"
					className="flex items-center gap-3 text-base text-ink"
				>
					<span
						aria-hidden="true"
						className="size-5 animate-spin rounded-full border-2 border-line border-t-accent"
					/>
					{t("legal.loading")}
				</p>
			) : state.status === "unavailable" ? (
				<div className="flex flex-col gap-3">
					<p role="alert" className="text-base text-ink">
						{t("legal.unavailable")}
					</p>
					<button
						type="button"
						className={secondaryButton}
						onClick={fetchDocument}
					>
						{t("entry.retry")}
					</button>
				</div>
			) : (
				<div className="flex flex-col gap-3" data-testid="legal-document">
					<p className="text-sm text-ink-muted" data-testid="legal-version">
						{t("legal.version", {
							version: state.document.version,
							date: shownDate(state.document.publishedAt),
						})}
					</p>
					<MarkdownText
						markdown={state.document.bodyMarkdown}
						headingLevel={3}
					/>
				</div>
			)}
		</Popup>
	);
}

export function LegalButtons({ load }: { readonly load: LegalLoader }) {
	const { t } = useI18n();
	const [open, setOpen] = useState<LegalDocumentKind | null>(null);
	const close = useCallback(() => setOpen(null), []);
	return (
		<>
			<div className="flex flex-wrap items-center justify-center gap-x-2">
				<button
					type="button"
					className={quietButton}
					onClick={() => setOpen("privacy_notice")}
				>
					{t("legal.privacy")}
				</button>
				<button
					type="button"
					className={quietButton}
					onClick={() => setOpen("mini_app_terms")}
				>
					{t("legal.terms")}
				</button>
			</div>
			{open === null ? null : (
				<LegalPopup kind={open} load={load} onClose={close} />
			)}
		</>
	);
}
