import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "../../components/ui/button";
import { TextLink } from "../../components/ui/text-link";
import { type MessageKey, type Translate, useT } from "../../i18n";
import { todayIn } from "../../lib/business-dates";
import {
	LegalEditor,
	type LegalSaveOutcome,
} from "../../settings/legal/legal-editor";
import {
	domIdOf,
	LEGAL_KIND_KEYS,
	type LegalAction,
	LegalGroupBlock,
	type LegalGroupStatus,
	legalEditButtonId,
	legalNewButtonId,
} from "../../settings/legal/legal-group";
import {
	type LegalDraftFields,
	type LegalGroup,
	legalDraftChangeOf,
	legalGroupsOf,
	suggestedLegalVersion,
	takenVersionsOf,
} from "../../settings/legal/legal-rules";
import {
	LEGAL_DOCUMENT_KINDS,
	type LegalDocumentKind,
	type LegalDocumentRow,
	type LegalDraftChange,
	type ManualSettingsSource,
} from "../../settings/manual/source";
import { settingsQueryKey, useLegalDocuments } from "../../settings/queries";
import { ReadOnlyNotice } from "../../settings/read-only-notice";
import {
	useRetrySettingsSource,
	useSettingsSourceState,
} from "../../settings/settings-source-context";
import type { SettingsSource, SettingsWriteCode } from "../../settings/source";
import { useSettingsAccess } from "../../settings/use-settings-access";
import { useSettingsMutation } from "../../settings/use-settings-mutation";
import { useFormatters } from "../../state/formatters";
import { useReadyTenantScope } from "../../state/tenant-scope";

const CONSENT_PHASE = "17a";

const DONE_KEYS: Readonly<Record<LegalAction, MessageKey>> = {
	publish: "settings.legal.done.publish",
	retire: "settings.legal.done.retire",
	delete: "settings.legal.done.delete",
};

interface EditorTarget {
	readonly session: number;
	readonly kind: LegalDocumentKind;
	readonly language: LegalGroup["language"];
	readonly draftId: string | null;
	readonly openedFrom: "new" | "edit";
}

interface DraftWrite {
	readonly session: number;
	readonly change: LegalDraftChange;
}

interface ActionWrite {
	readonly action: LegalAction;
	readonly row: LegalDocumentRow;
}

export function withSavedLegal(
	rows: readonly LegalDocumentRow[] | undefined,
	saved: LegalDocumentRow,
	previousId: string | null,
): LegalDocumentRow[] | undefined {
	if (rows === undefined) return rows;
	const kept = rows.filter(
		(row) => row.id !== saved.id && row.id !== previousId,
	);
	return [...kept, saved];
}

function groupKeyOf(group: {
	readonly kind: LegalDocumentKind;
	readonly language: string;
}): string {
	return `${group.kind}:${group.language}`;
}

export function actionErrorKey(
	action: LegalAction,
	code: SettingsWriteCode,
	errorKey: MessageKey,
): MessageKey {
	return code === "invalid" && action !== "delete"
		? "settings.legal.stale"
		: errorKey;
}

function actionStatus(
	t: Translate,
	mutation: {
		readonly saving: boolean;
		readonly saved: boolean;
		readonly errorCode: SettingsWriteCode | null;
		readonly errorKey: MessageKey | null;
		readonly canRetry: boolean;
	},
	last: ActionWrite,
): LegalGroupStatus | null {
	if (mutation.saving) {
		return { tone: "info", text: t("settings.legal.busy"), canRetry: false };
	}
	if (mutation.errorKey !== null && mutation.errorCode !== null) {
		return {
			tone: "error",
			text: t(
				actionErrorKey(last.action, mutation.errorCode, mutation.errorKey),
			),
			canRetry: mutation.canRetry,
		};
	}
	return mutation.saved
		? {
				tone: "success",
				text: t(DONE_KEYS[last.action], { version: last.row.version }),
				canRetry: false,
			}
		: null;
}

function LoadFailed({ onRetry }: { readonly onRetry: () => void }) {
	const t = useT();
	return (
		<div role="alert" className="space-y-2" data-testid="legal-load-failed">
			<p>{t("app.error")}</p>
			<Button tone="secondary" size="compact" onClick={onRetry}>
				{t("app.retry")}
			</Button>
		</div>
	);
}

function LegalDocuments() {
	const t = useT();
	const { tenant } = useReadyTenantScope();
	const formatters = useFormatters(tenant);
	const access = useSettingsAccess("legal");
	const documents = useLegalDocuments();
	const sourceState = useSettingsSourceState();
	const retrySource = useRetrySettingsSource();
	const queryClient = useQueryClient();
	const sessions = useRef(0);
	const [editor, setEditor] = useState<EditorTarget | null>(null);
	const [lastAction, setLastAction] = useState<ActionWrite | null>(null);
	const [focusTarget, setFocusTarget] = useState<string | null>(null);
	useEffect(() => {
		if (focusTarget === null) return;
		document.getElementById(focusTarget)?.focus();
		setFocusTarget(null);
	}, [focusTarget]);

	const writeDraft = useCallback(
		async (
			source: SettingsSource,
			tenantId: string,
			write: DraftWrite,
			manual: ManualSettingsSource,
		) => {
			const saved = await manual.saveLegalDraft(tenantId, write.change);
			queryClient.setQueryData<LegalDocumentRow[]>(
				settingsQueryKey(source.kind, tenantId, "legalDocuments"),
				(previous) => withSavedLegal(previous, saved, write.change.id ?? null),
			);
			setEditor((target) =>
				target !== null && target.session === write.session
					? { ...target, draftId: saved.id }
					: target,
			);
		},
		[queryClient],
	);
	const draftMutation = useSettingsMutation(writeDraft);

	const writeAction = useCallback(
		async (
			source: SettingsSource,
			tenantId: string,
			write: ActionWrite,
			manual: ManualSettingsSource,
		) => {
			try {
				if (write.action === "publish") {
					await manual.publishLegalDocument(tenantId, write.row.id);
				} else if (write.action === "retire") {
					await manual.retireLegalDocument(tenantId, write.row.id);
				} else {
					await manual.deleteLegalDraft(tenantId, write.row.id);
				}
			} catch (failure) {
				void queryClient.invalidateQueries({
					queryKey: settingsQueryKey(source.kind, tenantId, "legalDocuments"),
				});
				throw failure;
			}
		},
		[queryClient],
	);
	const actionMutation = useSettingsMutation(writeAction);

	if (documents.data === undefined) {
		const failed =
			sourceState.status === "failed" || documents.status === "error";
		return failed ? (
			<LoadFailed
				onRetry={
					sourceState.status === "failed"
						? retrySource
						: () => void documents.refetch()
				}
			/>
		) : (
			<p role="status">{t("app.loading")}</p>
		);
	}

	const rows = documents.data;
	const groups = legalGroupsOf(rows);
	const today = todayIn(tenant.timeZone, new Date());
	const editedId = editor?.draftId ?? null;
	const editedRow =
		editedId === null
			? null
			: (rows.find((row) => row.id === editedId) ?? null);
	const openEditor =
		editor !== null &&
		access.canWrite &&
		(editor.draftId === null || editedRow?.status === "draft")
			? editor
			: null;
	const busy = actionMutation.saving;
	const open = (target: Omit<EditorTarget, "session">) => {
		sessions.current += 1;
		draftMutation.reset();
		setEditor({ ...target, session: sessions.current });
	};
	const draftOutcome: LegalSaveOutcome =
		draftMutation.errorCode !== null && draftMutation.errorKey !== null
			? {
					kind: "refused",
					code: draftMutation.errorCode,
					messageKey: draftMutation.errorKey,
					canRetry: draftMutation.canRetry,
				}
			: draftMutation.saved
				? { kind: "saved" }
				: { kind: "idle" };

	const editorFor = (group: LegalGroup) => {
		if (
			openEditor === null ||
			openEditor.kind !== group.kind ||
			openEditor.language !== group.language
		) {
			return null;
		}
		const draft = openEditor.draftId === null ? null : editedRow;
		return (
			<LegalEditor
				key={openEditor.session}
				id={domIdOf("editor", group.kind, group.language)}
				language={group.language}
				draft={draft}
				taken={takenVersionsOf(group, draft?.id ?? null)}
				suggestedVersion={suggestedLegalVersion(
					group.kind,
					today,
					takenVersionsOf(group),
				)}
				formatters={formatters}
				saving={draftMutation.saving}
				outcome={draftOutcome}
				onSave={(fields: LegalDraftFields) =>
					void draftMutation.save({
						session: openEditor.session,
						change: legalDraftChangeOf(
							group.kind,
							group.language,
							draft?.id ?? null,
							fields,
						),
					})
				}
				onRetry={() => void draftMutation.retry()}
				onEdit={() => {
					if (draftOutcome.kind !== "idle" && !draftMutation.saving) {
						draftMutation.reset();
					}
				}}
				onClose={() => {
					setEditor(null);
					setFocusTarget(
						openEditor.openedFrom === "edit" && openEditor.draftId !== null
							? legalEditButtonId(openEditor.draftId)
							: legalNewButtonId(group.kind, group.language),
					);
				}}
			/>
		);
	};

	return (
		<div className="space-y-6" data-testid="legal-documents">
			<ReadOnlyNotice
				access={access}
				messages={{ ownerOnly: "settings.legal.readOnly" }}
			/>
			{LEGAL_DOCUMENT_KINDS.map((kind) => {
				const headingId = domIdOf("kind", kind);
				return (
					<section
						key={kind}
						aria-labelledby={headingId}
						className="min-w-0 space-y-4 rounded-xl border border-line bg-surface-raised p-4"
						data-testid="legal-kind"
						data-kind={kind}
					>
						<h3 id={headingId} className="text-lg font-semibold">
							{t(LEGAL_KIND_KEYS[kind])}
						</h3>
						{groups
							.filter((group) => group.kind === kind)
							.map((group) => (
								<LegalGroupBlock
									key={groupKeyOf(group)}
									group={group}
									canWrite={access.canWrite}
									editor={editorFor(group)}
									editingId={openEditor?.draftId ?? null}
									editorOpen={openEditor !== null}
									busy={busy}
									status={
										lastAction !== null &&
										groupKeyOf(lastAction.row) === groupKeyOf(group)
											? actionStatus(t, actionMutation, lastAction)
											: null
									}
									formatters={formatters}
									timeZone={tenant.timeZone}
									onNew={() =>
										open({
											kind: group.kind,
											language: group.language,
											draftId: null,
											openedFrom: "new",
										})
									}
									onEdit={(row) =>
										open({
											kind: row.kind,
											language: row.language,
											draftId: row.id,
											openedFrom: "edit",
										})
									}
									onAction={(action, row) => {
										setLastAction({ action, row });
										return actionMutation.save({ action, row });
									}}
									onRetry={() => void actionMutation.retry()}
								/>
							))}
					</section>
				);
			})}
		</div>
	);
}

function RelatedSlots() {
	const t = useT();
	return (
		<section
			aria-labelledby="legal-related-heading"
			className="min-w-0 space-y-3"
			data-testid="legal-related"
		>
			<h3 id="legal-related-heading" className="text-lg font-semibold">
				{t("settings.legal.related")}
			</h3>
			<div className="grid gap-3 md:grid-cols-2">
				<div
					className="space-y-1 rounded-xl border border-dashed border-line bg-surface-raised p-4"
					data-testid="legal-slot-consent"
				>
					<p className="font-medium">
						{t("settings.legal.slot.consent.title")}
					</p>
					<p className="text-sm text-ink-muted">
						{t("settings.legal.slot.consent.body", { phase: CONSENT_PHASE })}
					</p>
				</div>
				<div
					className="space-y-1 rounded-xl border border-line bg-surface-raised p-4"
					data-testid="legal-slot-legal-form"
				>
					<p className="font-medium">
						{t("settings.legal.slot.legalForm.title")}
					</p>
					<p className="text-sm text-ink-muted">
						{t("settings.legal.slot.legalForm.body")}
					</p>
					<TextLink to="/cai-dat/cua-hang">
						{t("settings.legal.slot.legalForm.link")}
					</TextLink>
				</div>
			</div>
		</section>
	);
}

export default function PhapLyPage() {
	const t = useT();
	const { tenant } = useReadyTenantScope();
	return (
		<div className="space-y-6" data-testid="legal-page">
			<p className="text-sm text-ink-muted" data-testid="legal-page-note">
				{t("settings.legal.intro")}
			</p>
			<LegalDocuments key={`legal-${tenant.id}`} />
			<RelatedSlots />
		</div>
	);
}
