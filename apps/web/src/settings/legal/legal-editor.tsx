import { useEffect, useRef, useState } from "react";
import { Button } from "../../components/ui/button";
import { cn } from "../../components/ui/cn";
import {
	type Language,
	type MessageKey,
	type Translate,
	useT,
} from "../../i18n";
import type { Formatters } from "../../lib/format";
import { controlClass, Field } from "../forms/field";
import { UNAVAILABLE_CLASS } from "../forms/save-bar";
import type { LegalDocumentRow } from "../manual/source";
import type { SettingsWriteCode } from "../source";
import {
	changedDraftFields,
	type LegalDraftFields,
	type LegalFieldIssue,
	legalDraftIssues,
	legalSkeleton,
} from "./legal-rules";
import { MarkdownPreview } from "./markdown-preview";

export type LegalSaveOutcome =
	| { readonly kind: "idle" }
	| { readonly kind: "saved" }
	| {
			readonly kind: "refused";
			readonly code: SettingsWriteCode;
			readonly messageKey: MessageKey;
			readonly canRetry: boolean;
	  };

export interface LegalEditorProps {
	readonly id: string;
	readonly language: Language;
	readonly draft: LegalDocumentRow | null;
	readonly taken: ReadonlySet<string>;
	readonly suggestedVersion: string;
	readonly formatters: Formatters;
	readonly saving: boolean;
	readonly outcome: LegalSaveOutcome;
	readonly onSave: (fields: LegalDraftFields) => void;
	readonly onRetry: () => void;
	readonly onEdit: () => void;
	readonly onClose: () => void;
}

type EditorMode = "write" | "preview";

type FieldName = keyof LegalDraftFields;

const FIELD_ORDER: readonly FieldName[] = ["title", "version", "bodyMarkdown"];

const EMPTY_FIELDS: LegalDraftFields = {
	title: "",
	version: "",
	bodyMarkdown: "",
};

const PREVIEW_HEADING_BASE = 6;

function savedFieldsOf(draft: LegalDocumentRow | null): LegalDraftFields {
	return draft === null
		? EMPTY_FIELDS
		: {
				title: draft.title,
				version: draft.version,
				bodyMarkdown: draft.bodyMarkdown,
			};
}

function issueText(
	t: Translate,
	issue: LegalFieldIssue | undefined,
	formatters: Formatters,
): string | null {
	if (issue === undefined) return null;
	switch (issue.key) {
		case "required":
			return t("settings.validation.required");
		case "textLength":
			return t("settings.validation.textLength", {
				max: formatters.count(issue.max),
			});
		case "versionFormat":
			return t("settings.legal.editor.versionFormat");
		case "versionTaken":
			return t("settings.legal.editor.versionTaken");
	}
}

function statusOf(
	t: Translate,
	saving: boolean,
	outcome: LegalSaveOutcome,
	showsIssues: boolean,
	pendingCount: number,
): { tone: string; text: string } {
	if (saving) return { tone: "text-ink-muted", text: t("settings.saving") };
	if (outcome.kind === "refused") {
		return { tone: "text-negative", text: t(outcome.messageKey) };
	}
	if (showsIssues) {
		return { tone: "text-ink-muted", text: t("settings.saveBar.invalid") };
	}
	if (outcome.kind === "saved" && pendingCount === 0) {
		return { tone: "text-positive", text: t("settings.legal.editor.saved") };
	}
	return { tone: "", text: "" };
}

export function LegalEditor({
	id,
	language,
	draft,
	taken,
	suggestedVersion,
	formatters,
	saving,
	outcome,
	onSave,
	onRetry,
	onEdit,
	onClose,
}: LegalEditorProps) {
	const t = useT();
	const saved = savedFieldsOf(draft);
	const savedKey = JSON.stringify(saved);
	const [syncedKey, setSyncedKey] = useState(savedKey);
	const [fields, setFields] = useState<LegalDraftFields>(() =>
		draft === null ? { ...EMPTY_FIELDS, version: suggestedVersion } : saved,
	);
	const [touched, setTouched] = useState<ReadonlySet<FieldName>>(new Set());
	const [attempted, setAttempted] = useState(false);
	const [mode, setMode] = useState<EditorMode>("write");
	const [focusRequest, setFocusRequest] = useState<FieldName | null>(null);
	const titleRef = useRef<HTMLInputElement | null>(null);
	useEffect(() => {
		titleRef.current?.focus();
	}, []);
	useEffect(() => {
		if (focusRequest === null) return;
		document.getElementById(`${id}-${focusRequest}`)?.focus();
		setFocusRequest(null);
	}, [focusRequest, id]);
	if (syncedKey !== savedKey) {
		setSyncedKey(savedKey);
		setFields(saved);
		setTouched(new Set());
		setAttempted(false);
	}
	const issues = legalDraftIssues(fields, taken);
	const refusedTaken =
		outcome.kind === "refused" && outcome.code === "duplicate";
	const shownIssue = (field: FieldName): LegalFieldIssue | undefined => {
		if (field === "version" && refusedTaken && issues.version === undefined) {
			return { key: "versionTaken" };
		}
		return attempted || touched.has(field) ? issues[field] : undefined;
	};
	const pendingCount = changedDraftFields(saved, fields).length;
	const hasIssues = Object.keys(issues).length > 0;
	const canSave = pendingCount > 0 && !saving;
	const edit = (field: FieldName, value: string) => {
		if (saving) return;
		setFields({ ...fields, [field]: value });
		setTouched(new Set([...touched, field]));
		onEdit();
	};
	const save = () => {
		if (!canSave) return;
		if (hasIssues) {
			setAttempted(true);
			const first = FIELD_ORDER.find((field) => issues[field] !== undefined);
			if (first === "bodyMarkdown") setMode("write");
			setFocusRequest(first ?? null);
			return;
		}
		onSave(fields);
	};
	const bodyIsBlank = fields.bodyMarkdown.trim() === "";
	const status = statusOf(
		t,
		saving,
		outcome,
		attempted && hasIssues,
		pendingCount,
	);
	const headingId = `${id}-heading`;
	const skeletonHintId = `${id}-skeleton-hint`;
	return (
		<section
			aria-labelledby={headingId}
			className="min-w-0 space-y-4 rounded-xl border border-accent bg-surface-raised p-4"
			data-testid="legal-editor"
		>
			<h5 id={headingId} className="text-base font-semibold">
				{draft === null
					? t("settings.legal.editor.new")
					: t("settings.legal.editor.edit", { version: draft.version })}
			</h5>
			<div className="grid gap-4 sm:grid-cols-2">
				<Field
					id={`${id}-title`}
					label={t("settings.legal.editor.title")}
					error={issueText(t, shownIssue("title"), formatters)}
				>
					{(control) => (
						<input
							{...control}
							ref={titleRef}
							type="text"
							autoComplete="off"
							value={fields.title}
							onChange={(event) => edit("title", event.target.value)}
							className={controlClass}
							data-testid="legal-title"
						/>
					)}
				</Field>
				<Field
					id={`${id}-version`}
					label={t("settings.legal.editor.version")}
					hint={t("settings.legal.editor.versionHint", {
						suggestion: suggestedVersion,
					})}
					error={issueText(t, shownIssue("version"), formatters)}
				>
					{(control) => (
						<input
							{...control}
							type="text"
							autoComplete="off"
							autoCapitalize="none"
							spellCheck={false}
							value={fields.version}
							onChange={(event) => edit("version", event.target.value)}
							className={controlClass}
							data-testid="legal-version-input"
						/>
					)}
				</Field>
			</div>
			<div className="space-y-2">
				<Button
					tone="secondary"
					size="compact"
					aria-disabled={!bodyIsBlank || saving || undefined}
					aria-describedby={skeletonHintId}
					onClick={
						bodyIsBlank && !saving
							? () => edit("bodyMarkdown", legalSkeleton(language))
							: undefined
					}
					className={UNAVAILABLE_CLASS}
					data-testid="legal-skeleton"
				>
					{t("settings.legal.editor.skeleton")}
				</Button>
				<p id={skeletonHintId} className="text-xs text-ink-muted">
					{bodyIsBlank
						? t("settings.legal.editor.skeletonHint")
						: `${t("settings.legal.editor.skeletonHint")} ${t("settings.legal.editor.skeletonUnavailable")}`}
				</p>
			</div>
			<div className="space-y-2">
				<fieldset className="flex flex-wrap gap-2" data-testid="legal-mode">
					<legend className="sr-only">{t("settings.legal.editor.mode")}</legend>
					{(["write", "preview"] as const).map((option) => (
						<Button
							key={option}
							tone="secondary"
							size="compact"
							aria-pressed={mode === option}
							onClick={() => setMode(option)}
							className="aria-pressed:bg-accent aria-pressed:text-accent-ink"
						>
							{t(
								option === "write"
									? "settings.legal.editor.write"
									: "settings.legal.editor.preview",
							)}
						</Button>
					))}
				</fieldset>
				{mode === "write" ? (
					<Field
						id={`${id}-bodyMarkdown`}
						label={t("settings.legal.editor.body")}
						hint={t("settings.legal.editor.bodyHint")}
						error={issueText(t, shownIssue("bodyMarkdown"), formatters)}
					>
						{(control) => (
							<textarea
								{...control}
								rows={14}
								value={fields.bodyMarkdown}
								onChange={(event) => edit("bodyMarkdown", event.target.value)}
								className={cn(controlClass, "min-h-60 py-2")}
								data-testid="legal-body"
							/>
						)}
					</Field>
				) : (
					<MarkdownPreview
						markdown={fields.bodyMarkdown}
						headingBase={PREVIEW_HEADING_BASE}
						label={t("settings.legal.editor.previewLabel")}
						emptyText={t("settings.legal.editor.previewEmpty")}
					/>
				)}
			</div>
			<div className="flex flex-wrap items-center gap-2">
				<Button
					size="compact"
					aria-disabled={!canSave || undefined}
					aria-busy={saving || undefined}
					onClick={canSave ? save : undefined}
					className={UNAVAILABLE_CLASS}
					data-testid="legal-save"
				>
					{t("settings.legal.editor.save")}
				</Button>
				<Button
					tone="secondary"
					size="compact"
					aria-disabled={saving || undefined}
					onClick={saving ? undefined : onClose}
					className={UNAVAILABLE_CLASS}
					data-testid="legal-close"
				>
					{t("settings.legal.action.close")}
				</Button>
				{outcome.kind === "refused" && outcome.canRetry ? (
					<Button
						tone="secondary"
						size="compact"
						aria-disabled={saving || undefined}
						onClick={saving ? undefined : onRetry}
						data-testid="settings-retry-save"
					>
						{t("app.retry")}
					</Button>
				) : null}
				<p
					role="status"
					className={cn("min-w-0 flex-1 basis-40 text-sm", status.tone)}
					data-testid="legal-editor-status"
				>
					{status.text}
				</p>
			</div>
		</section>
	);
}
