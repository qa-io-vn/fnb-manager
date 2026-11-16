import { type ReactNode, useRef, useState } from "react";
import { Button } from "../../components/ui/button";
import { cn } from "../../components/ui/cn";
import { type MessageKey, type Translate, useT } from "../../i18n";
import { todayIn } from "../../lib/business-dates";
import type { Formatters } from "../../lib/format";
import { AuditLine } from "../forms/audit-line";
import { UNAVAILABLE_CLASS } from "../forms/save-bar";
import type { LegalDocumentRow, LegalDocumentStatus } from "../manual/source";
import { ConfirmPanel } from "./confirm-panel";
import type { LegalGroup } from "./legal-rules";
import { MarkdownPreview } from "./markdown-preview";

export type LegalAction = "publish" | "retire" | "delete";

export interface LegalGroupStatus {
	readonly tone: "info" | "success" | "error";
	readonly text: string;
	readonly canRetry: boolean;
}

export const LEGAL_KIND_KEYS: Readonly<Record<LegalGroup["kind"], MessageKey>> =
	{
		privacy_notice: "settings.legal.kind.privacy_notice",
		data_protection_rules: "settings.legal.kind.data_protection_rules",
		mini_app_terms: "settings.legal.kind.mini_app_terms",
		staff_notice: "settings.legal.kind.staff_notice",
		loyalty_consent_text: "settings.legal.kind.loyalty_consent_text",
		marketing_consent_text: "settings.legal.kind.marketing_consent_text",
	};

export const LEGAL_LANGUAGE_KEYS: Readonly<
	Record<LegalGroup["language"], MessageKey>
> = {
	vi: "settings.legal.language.vi",
	en: "settings.legal.language.en",
};

const STATUS_KEYS: Readonly<Record<LegalDocumentStatus, MessageKey>> = {
	draft: "settings.legal.status.draft",
	published: "settings.legal.status.published",
	retired: "settings.legal.status.retired",
};

const STATUS_CLASSES: Readonly<Record<LegalDocumentStatus, string>> = {
	draft: "border-line bg-surface-sunken",
	published: "border-positive bg-positive-soft",
	retired: "border-line text-ink-muted",
};

const CONFIRM_KEYS: Readonly<Record<LegalAction, MessageKey>> = {
	publish: "settings.legal.confirm.publish",
	retire: "settings.legal.confirm.retire",
	delete: "settings.legal.confirm.delete",
};

const ACTION_KEYS: Readonly<Record<LegalAction, MessageKey>> = {
	publish: "settings.legal.action.publish",
	retire: "settings.legal.action.retire",
	delete: "settings.legal.action.delete",
};

const ACTION_FOR_KEYS: Readonly<Record<LegalAction, MessageKey>> = {
	publish: "settings.legal.action.publishFor",
	retire: "settings.legal.action.retireFor",
	delete: "settings.legal.action.deleteFor",
};

const STATUS_TONES: Readonly<Record<LegalGroupStatus["tone"], string>> = {
	info: "text-ink-muted",
	success: "text-positive",
	error: "text-negative",
};

export function instantText(
	t: Translate,
	formatters: Formatters,
	timeZone: string,
	iso: string,
): string {
	const instant = new Date(iso);
	return t("settings.audit.when", {
		date: formatters.date(todayIn(timeZone, instant)),
		time: formatters.time(instant),
	});
}

export function domIdOf(...parts: readonly string[]): string {
	return `legal-${parts.join("-").replace(/[^A-Za-z0-9_-]/g, "-")}`;
}

export function legalNewButtonId(kind: string, language: string): string {
	return domIdOf(kind, language, "new");
}

export function legalEditButtonId(rowId: string): string {
	return domIdOf(rowId, "edit");
}

function actionsOf(
	row: LegalDocumentRow,
	canWrite: boolean,
	editing: boolean,
): LegalAction[] {
	if (!canWrite || editing) return [];
	if (row.status === "draft") return ["publish", "delete"];
	return row.status === "published" ? ["retire"] : [];
}

function confirmMessage(
	t: Translate,
	action: LegalAction,
	row: LegalDocumentRow,
	current: LegalDocumentRow | null,
	names: { readonly kind: string; readonly language: string },
): string {
	const message = t(CONFIRM_KEYS[action], { version: row.version, ...names });
	if (action !== "publish" || current === null || current.id === row.id) {
		return message;
	}
	return `${message} ${t("settings.legal.confirm.publishReplaces", {
		current: current.version,
	})}`;
}

interface VersionRowProps {
	readonly row: LegalDocumentRow;
	readonly names: { readonly kind: string; readonly language: string };
	readonly current: LegalDocumentRow | null;
	readonly canWrite: boolean;
	readonly editing: boolean;
	readonly editorOpen: boolean;
	readonly busy: boolean;
	readonly formatters: Formatters;
	readonly timeZone: string;
	readonly onEdit: (row: LegalDocumentRow) => void;
	readonly onAction: (action: LegalAction, row: LegalDocumentRow) => void;
}

function VersionRow({
	row,
	names,
	current,
	canWrite,
	editing,
	editorOpen,
	busy,
	formatters,
	timeZone,
	onEdit,
	onAction,
}: VersionRowProps) {
	const t = useT();
	const id = domIdOf(row.id);
	const [showText, setShowText] = useState(false);
	const [confirming, setConfirming] = useState<LegalAction | null>(null);
	const triggers = useRef(new Map<LegalAction, HTMLButtonElement | null>());
	const actions = actionsOf(row, canWrite, editing);
	const canEdit = canWrite && row.status === "draft" && !editing;
	const editUnavailable = editorOpen || busy || confirming !== null;
	const cancel = () => {
		const action = confirming;
		setConfirming(null);
		if (action !== null) triggers.current.get(action)?.focus();
	};
	return (
		<li
			className="min-w-0 space-y-2 rounded-lg border border-line p-3"
			data-testid="legal-version"
			data-status={row.status}
			data-version={row.version}
		>
			<div className="flex flex-wrap items-center gap-2">
				<span
					className={cn(
						"rounded-full border px-2 py-0.5 text-xs font-medium",
						STATUS_CLASSES[row.status],
					)}
					data-testid="legal-status"
				>
					{t(STATUS_KEYS[row.status])}
				</span>
				<p className="min-w-0 font-medium break-words">{row.title}</p>
			</div>
			<dl className="grid gap-x-4 gap-y-1 text-sm sm:grid-cols-[auto_minmax(0,1fr)]">
				<dt className="text-ink-muted">{t("settings.legal.versionLabel")}</dt>
				<dd className="min-w-0 break-all font-mono" data-testid="legal-label">
					{row.version}
				</dd>
				{row.publishedAt === null ? null : (
					<>
						<dt className="text-ink-muted">
							{t("settings.legal.publishedAt")}
						</dt>
						<dd data-testid="legal-published-at">
							{instantText(t, formatters, timeZone, row.publishedAt)}
						</dd>
					</>
				)}
				{row.retiredAt === null ? null : (
					<>
						<dt className="text-ink-muted">{t("settings.legal.retiredAt")}</dt>
						<dd data-testid="legal-retired-at">
							{instantText(t, formatters, timeZone, row.retiredAt)}
						</dd>
					</>
				)}
			</dl>
			{row.status === "draft" ? (
				<AuditLine
					entry={row.audit}
					formatters={formatters}
					timeZone={timeZone}
				/>
			) : null}
			<div className="flex flex-wrap gap-2">
				<Button
					tone="secondary"
					size="compact"
					aria-expanded={showText}
					aria-controls={`${id}-text`}
					aria-label={t(
						showText
							? "settings.legal.action.hideFor"
							: "settings.legal.action.showFor",
						{ version: row.version },
					)}
					onClick={() => setShowText(!showText)}
					data-testid="legal-show"
				>
					{t(
						showText
							? "settings.legal.action.hide"
							: "settings.legal.action.show",
					)}
				</Button>
				{canEdit ? (
					<Button
						id={legalEditButtonId(row.id)}
						tone="secondary"
						size="compact"
						aria-label={t("settings.legal.action.editFor", {
							version: row.version,
						})}
						aria-disabled={editUnavailable || undefined}
						onClick={editUnavailable ? undefined : () => onEdit(row)}
						className={UNAVAILABLE_CLASS}
						data-testid="legal-edit"
					>
						{t("settings.legal.action.edit")}
					</Button>
				) : null}
				{actions.map((action) => {
					const unavailable = busy || confirming !== null;
					return (
						<Button
							key={action}
							ref={(element) => {
								triggers.current.set(action, element);
							}}
							tone={action === "publish" ? "primary" : "secondary"}
							size="compact"
							aria-label={t(ACTION_FOR_KEYS[action], { version: row.version })}
							aria-disabled={unavailable || undefined}
							onClick={unavailable ? undefined : () => setConfirming(action)}
							className={UNAVAILABLE_CLASS}
							data-testid={`legal-${action}`}
						>
							{t(ACTION_KEYS[action])}
						</Button>
					);
				})}
			</div>
			{confirming === null ? null : (
				<ConfirmPanel
					id={`${id}-confirm`}
					message={confirmMessage(t, confirming, row, current, names)}
					confirmLabel={t(ACTION_KEYS[confirming])}
					onConfirm={() => {
						setConfirming(null);
						onAction(confirming, row);
					}}
					onCancel={cancel}
				/>
			)}
			{showText ? (
				<MarkdownPreview
					id={`${id}-text`}
					markdown={row.bodyMarkdown}
					headingBase={5}
					label={row.title}
					emptyText={t("settings.legal.editor.previewEmpty")}
					testId="legal-text"
				/>
			) : null}
		</li>
	);
}

export interface LegalGroupBlockProps {
	readonly group: LegalGroup;
	readonly canWrite: boolean;
	readonly editor: ReactNode;
	readonly editingId: string | null;
	readonly editorOpen: boolean;
	readonly busy: boolean;
	readonly status: LegalGroupStatus | null;
	readonly formatters: Formatters;
	readonly timeZone: string;
	readonly onNew: () => void;
	readonly onEdit: (row: LegalDocumentRow) => void;
	readonly onAction: (
		action: LegalAction,
		row: LegalDocumentRow,
	) => Promise<unknown>;
	readonly onRetry: () => void;
}

export function LegalGroupBlock({
	group,
	canWrite,
	editor,
	editingId,
	editorOpen,
	busy,
	status,
	formatters,
	timeZone,
	onNew,
	onEdit,
	onAction,
	onRetry,
}: LegalGroupBlockProps) {
	const t = useT();
	const id = domIdOf(group.kind, group.language);
	const headingRef = useRef<HTMLHeadingElement | null>(null);
	const kind = t(LEGAL_KIND_KEYS[group.kind]);
	const language = t(LEGAL_LANGUAGE_KEYS[group.language]);
	const act = (action: LegalAction, row: LegalDocumentRow) => {
		headingRef.current?.focus();
		void onAction(action, row);
	};
	const newUnavailable = editorOpen || busy;
	return (
		<section
			aria-labelledby={`${id}-heading`}
			className="min-w-0 space-y-3"
			data-testid="legal-group"
			data-kind={group.kind}
			data-language={group.language}
		>
			<h4
				id={`${id}-heading`}
				ref={headingRef}
				tabIndex={-1}
				className="font-semibold"
			>
				{language}
			</h4>
			<p className="text-sm" data-testid="legal-current">
				{group.current === null || group.current.publishedAt === null
					? t("settings.legal.noCurrent")
					: t("settings.legal.current", {
							version: group.current.version,
							when: instantText(
								t,
								formatters,
								timeZone,
								group.current.publishedAt,
							),
						})}
			</p>
			{group.versions.length === 0 ? (
				<p className="text-sm text-ink-muted">{t("settings.legal.empty")}</p>
			) : (
				<ul
					aria-label={t("settings.legal.versions", { kind, language })}
					className="space-y-2"
				>
					{group.versions.map((row) => (
						<VersionRow
							key={row.id}
							row={row}
							names={{ kind, language }}
							current={group.current}
							canWrite={canWrite}
							editing={row.id === editingId}
							editorOpen={editorOpen}
							busy={busy}
							formatters={formatters}
							timeZone={timeZone}
							onEdit={onEdit}
							onAction={act}
						/>
					))}
				</ul>
			)}
			{editor}
			{canWrite && editor === null ? (
				<Button
					id={legalNewButtonId(group.kind, group.language)}
					tone="secondary"
					size="compact"
					aria-label={t("settings.legal.action.newFor", { kind, language })}
					aria-disabled={newUnavailable || undefined}
					onClick={newUnavailable ? undefined : onNew}
					className={UNAVAILABLE_CLASS}
					data-testid="legal-new"
				>
					{t("settings.legal.action.new")}
				</Button>
			) : null}
			<div className="flex flex-wrap items-center gap-2">
				<p
					role="status"
					className={cn(
						"text-sm",
						status === null ? null : STATUS_TONES[status.tone],
					)}
					data-testid="legal-group-status"
				>
					{status?.text ?? ""}
				</p>
				{status?.canRetry === true ? (
					<Button
						tone="secondary"
						size="compact"
						aria-disabled={busy || undefined}
						onClick={busy ? undefined : onRetry}
						data-testid="settings-retry-save"
					>
						{t("app.retry")}
					</Button>
				) : null}
			</div>
		</section>
	);
}
