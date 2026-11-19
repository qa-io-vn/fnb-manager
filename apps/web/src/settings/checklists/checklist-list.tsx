import { type ReactNode, useCallback, useId, useRef, useState } from "react";
import { Button } from "../../components/ui/button";
import { cn } from "../../components/ui/cn";
import { type Translate, useT } from "../../i18n";
import type {
	ChecklistTemplate,
	ChecklistTemplateChange,
	OperationsSource,
	SavedChecklistTemplate,
} from "../../operations/source";
import { useFormatters } from "../../state/formatters";
import { useReadyTenantScope } from "../../state/tenant-scope";
import { AuditLine } from "../forms/audit-line";
import type { SaveBarStatus } from "../forms/save-bar";
import { UNAVAILABLE_CLASS } from "../forms/save-bar";
import { SelectField } from "../forms/select-field";
import {
	useChecklistTemplates,
	useMembership,
	useStoreProfiles,
} from "../queries";
import { ReadOnlyNotice } from "../read-only-notice";
import { SectionLoadState, useSectionLoad } from "../section-load";
import { SettingsWriteError, type StoreProfile } from "../source";
import {
	type SettingsWrite,
	useSettingsMutation,
} from "../use-settings-mutation";
import { ChecklistEditor, storeChoiceLabel } from "./checklist-editor";
import {
	type ChecklistStoreChoice,
	checklistErrorKey,
	checklistGroups,
	checklistStoreChoices,
	copiedChange,
	copyTargets,
	PHASE_KEYS,
	templateAccess,
} from "./checklist-rules";

type Editor =
	| { readonly mode: "add" }
	| { readonly mode: "edit"; readonly id: string }
	| null;

type ListAction =
	| { readonly kind: "add"; readonly title: string }
	| { readonly kind: "save"; readonly title: string }
	| { readonly kind: "retire"; readonly title: string }
	| { readonly kind: "activate"; readonly title: string }
	| { readonly kind: "copy"; readonly title: string; readonly store: string };

interface ActiveArgs {
	readonly templateId: string;
	readonly active: boolean;
}

function operationsOf(operations: OperationsSource | null): OperationsSource {
	if (operations === null) throw new SettingsWriteError("forbidden");
	return operations;
}

const STATUS_TONES: Readonly<Record<SaveBarStatus["tone"], string>> = {
	info: "text-ink-muted",
	success: "text-positive",
	error: "text-negative",
};

function doneText(
	t: Translate,
	action: ListAction,
	saved: SavedChecklistTemplate | null,
): string {
	switch (action.kind) {
		case "add":
			return t("settings.checklists.done.added", { title: action.title });
		case "save":
			return t("settings.checklists.done.saved", {
				title: action.title,
				version: saved?.version ?? "",
			});
		case "retire":
			return t("settings.checklists.done.retired", { title: action.title });
		case "activate":
			return t("settings.checklists.done.activated", { title: action.title });
		case "copy":
			return t("settings.checklists.done.copied", {
				title: action.title,
				store: action.store,
			});
	}
}

function storeNameOf(
	storeId: string | null,
	profiles: readonly StoreProfile[],
): string | null {
	if (storeId === null) return null;
	return profiles.find((profile) => profile.storeId === storeId)?.name ?? null;
}

function TemplateItems({ template }: { readonly template: ChecklistTemplate }) {
	const t = useT();
	return (
		<ol
			className="list-decimal space-y-0.5 ps-5 text-sm"
			data-testid="checklist-items"
		>
			{template.items.map((item) => (
				<li key={item.id} className="break-words">
					<span data-testid="checklist-item-text">{item.label}</span>
					{item.requiresPhoto ? (
						<span className="ms-2 rounded border border-line px-1 text-xs text-ink-muted">
							{t("settings.checklists.tag.photo")}
						</span>
					) : null}
					{item.numberUnit === null ? null : (
						<span className="ms-2 rounded border border-line px-1 text-xs text-ink-muted">
							{t("settings.checklists.tag.number", { unit: item.numberUnit })}
						</span>
					)}
				</li>
			))}
		</ol>
	);
}

function CopyPanel({
	template,
	targets,
	busy,
	onCopy,
	onCancel,
}: {
	readonly template: ChecklistTemplate;
	readonly targets: readonly ChecklistStoreChoice[];
	readonly busy: boolean;
	readonly onCopy: (storeId: string, storeName: string) => void;
	readonly onCancel: () => void;
}) {
	const t = useT();
	const ids = useId();
	const [target, setTarget] = useState(targets[0]?.value ?? "");
	const chosen = targets.find((choice) => choice.value === target);
	return (
		<fieldset
			className="min-w-0 space-y-2 rounded-lg border border-line bg-surface p-3"
			data-testid="checklist-copy"
			onKeyDown={(event) => {
				if (event.key === "Escape" && !busy) onCancel();
			}}
		>
			<legend className="float-left w-full text-sm font-semibold">
				{t("settings.checklists.copy.title", { title: template.title })}
			</legend>
			<p className="clear-left text-xs text-ink-muted">
				{t("settings.checklists.copy.hint")}
			</p>
			<SelectField<string>
				id={`${ids}-target`}
				testId="checklist-copy-store"
				label={t("settings.checklists.copy.store")}
				value={target}
				options={targets.map((choice) => ({
					value: choice.value,
					label: storeChoiceLabel(t, choice),
				}))}
				onChange={setTarget}
			/>
			<div className="flex flex-wrap gap-2">
				<Button
					size="compact"
					aria-disabled={busy || chosen === undefined || undefined}
					onClick={() => {
						if (busy || chosen?.storeId == null) return;
						onCopy(chosen.storeId, chosen.name ?? "");
					}}
					className={UNAVAILABLE_CLASS}
					data-testid="checklist-copy-submit"
				>
					{t("settings.checklists.copy.submit")}
				</Button>
				<Button
					tone="secondary"
					size="compact"
					aria-disabled={busy || undefined}
					onClick={busy ? undefined : onCancel}
					className={UNAVAILABLE_CLASS}
					data-testid="checklist-copy-cancel"
				>
					{t("settings.checklists.copy.cancel")}
				</Button>
			</div>
		</fieldset>
	);
}

function TemplateCard({
	template,
	canWrite,
	reason,
	targets,
	busy,
	editing,
	copying,
	editor,
	copyPanel,
	onEdit,
	onToggle,
	onCopy,
}: {
	readonly template: ChecklistTemplate;
	readonly canWrite: boolean;
	readonly reason: ReturnType<typeof templateAccess>;
	readonly targets: readonly ChecklistStoreChoice[];
	readonly busy: boolean;
	readonly editing: boolean;
	readonly copying: boolean;
	readonly editor: ReactNode;
	readonly copyPanel: ReactNode;
	readonly onEdit: (opener: HTMLElement) => void;
	readonly onToggle: () => void;
	readonly onCopy: () => void;
}) {
	const t = useT();
	const { tenant } = useReadyTenantScope();
	const formatters = useFormatters(tenant);
	const photoItems = template.items.filter((item) => item.requiresPhoto).length;
	const title = template.title;
	return (
		<li
			className="space-y-3 py-3"
			data-testid="checklist-template"
			data-template-id={template.id}
			data-active={template.active ? "true" : "false"}
		>
			<div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
				<div className="min-w-0 flex-1 basis-56 space-y-1">
					<p className="break-words font-medium" data-testid="checklist-title">
						{title}
					</p>
					<p className="text-sm text-ink-muted" data-testid="checklist-facts">
						{[
							t(PHASE_KEYS[template.phase]),
							t("settings.checklists.version", { version: template.version }),
							template.active
								? t("settings.checklists.active")
								: t("settings.checklists.retired"),
							t("settings.checklists.itemCount", {
								count: template.items.length,
							}),
							t("settings.checklists.photoCount", { count: photoItems }),
						].join(" · ")}
					</p>
					<TemplateItems template={template} />
					{template.audit === null ? null : (
						<AuditLine
							entry={template.audit}
							formatters={formatters}
							timeZone={tenant.timeZone}
						/>
					)}
				</div>
				{canWrite ? (
					<div className="flex flex-wrap gap-2">
						<Button
							tone="secondary"
							size="compact"
							aria-label={t("settings.checklists.action.editLabel", { title })}
							aria-disabled={busy || editing || undefined}
							onClick={(event) => {
								if (!busy && !editing) onEdit(event.currentTarget);
							}}
							className={UNAVAILABLE_CLASS}
							data-testid="checklist-edit"
						>
							{t("settings.checklists.action.edit")}
						</Button>
						<Button
							tone="secondary"
							size="compact"
							aria-label={t(
								template.active
									? "settings.checklists.action.retireLabel"
									: "settings.checklists.action.activateLabel",
								{ title },
							)}
							aria-disabled={busy || undefined}
							onClick={busy ? undefined : onToggle}
							className={UNAVAILABLE_CLASS}
							data-testid={
								template.active ? "checklist-retire" : "checklist-activate"
							}
						>
							{t(
								template.active
									? "settings.checklists.action.retire"
									: "settings.checklists.action.activate",
							)}
						</Button>
						{targets.length === 0 ? null : (
							<Button
								tone="secondary"
								size="compact"
								aria-label={t("settings.checklists.action.copyLabel", {
									title,
								})}
								aria-disabled={busy || copying || undefined}
								onClick={busy || copying ? undefined : onCopy}
								className={UNAVAILABLE_CLASS}
								data-testid="checklist-copy-open"
							>
								{t("settings.checklists.action.copy")}
							</Button>
						)}
					</div>
				) : null}
			</div>
			{canWrite ? null : (
				<ReadOnlyNotice
					access={reason}
					messages={{ scope: "settings.checklists.rowReadOnly" }}
					testId="checklist-read-only"
				/>
			)}
			{copyPanel}
			{editor}
		</li>
	);
}

function focusSoon(target: () => HTMLElement | null) {
	window.requestAnimationFrame(() => {
		const element = target();
		if (element?.isConnected) element.focus();
	});
}

export function ChecklistSettings() {
	const t = useT();
	const ids = useId();
	const templates = useChecklistTemplates();
	const profiles = useStoreProfiles();
	const membership = useMembership();
	const load = useSectionLoad([templates, profiles]);
	const member = membership.status === "success" ? membership.data : undefined;
	const storeProfiles = profiles.data ?? [];
	const choices = checklistStoreChoices(member, storeProfiles);
	const lastSaved = useRef<SavedChecklistTemplate | null>(null);
	const writeSave = useCallback<SettingsWrite<ChecklistTemplateChange>>(
		async (_source, tenantId, change, _manual, _staff, operations) => {
			lastSaved.current = await operationsOf(operations).saveChecklistTemplate(
				tenantId,
				change,
			);
		},
		[],
	);
	const writeActive = useCallback<SettingsWrite<ActiveArgs>>(
		(_source, _tenantId, args, _manual, _staff, operations) =>
			operationsOf(operations).setChecklistTemplateActive(
				args.templateId,
				args.active,
			),
		[],
	);
	const save = useSettingsMutation(writeSave);
	const active = useSettingsMutation(writeActive);
	const [editor, setEditor] = useState<Editor>(null);
	const [copyingId, setCopyingId] = useState<string | null>(null);
	const [action, setAction] = useState<ListAction | null>(null);
	const opener = useRef<HTMLElement | null>(null);
	const addButton = useRef<HTMLButtonElement | null>(null);
	const busy = save.saving || active.saving;
	const current =
		action === null
			? null
			: action.kind === "retire" || action.kind === "activate"
				? active
				: save;
	const errorKey =
		current === null ? null : checklistErrorKey(current.errorCode);
	const status: SaveBarStatus | null =
		action === null || current === null
			? null
			: current.saving
				? { tone: "info", text: t("settings.saving") }
				: errorKey !== null
					? { tone: "error", text: t(errorKey) }
					: current.saved
						? { tone: "success", text: doneText(t, action, lastSaved.current) }
						: null;
	const formOwnsStatus =
		editor !== null &&
		action !== null &&
		(action.kind === "add" || action.kind === "save") &&
		!(current?.saved ?? false);
	const listStatus = formOwnsStatus ? null : status;
	const formStatus = formOwnsStatus ? status : null;
	const canRetry = current?.canRetry === true;
	const resetAll = () => {
		for (const mutation of [save, active]) {
			if (!mutation.saving) mutation.reset();
		}
		setAction(null);
	};
	const closeEditor = () => {
		const mode = editor?.mode ?? "add";
		setEditor(null);
		if (formOwnsStatus) resetAll();
		focusSoon(() => (mode === "add" ? addButton.current : opener.current));
	};
	const submit = async (
		change: ChecklistTemplateChange,
		kind: "add" | "save",
	) => {
		setAction({ kind, title: change.title });
		const ok = await save.save(change);
		if (ok) {
			setEditor(null);
			focusSoon(() => (kind === "add" ? addButton.current : opener.current));
		}
	};
	if (templates.data === undefined || profiles.data === undefined) {
		return (
			<SectionLoadState load={load} failedTestId="checklist-load-failed" />
		);
	}
	const groups = checklistGroups(templates.data, storeProfiles);
	return (
		<section
			aria-labelledby={`${ids}-heading`}
			className="space-y-3"
			data-testid="checklist-settings"
		>
			<div className="flex flex-wrap items-center justify-between gap-2">
				<h3 id={`${ids}-heading`} className="text-lg font-semibold">
					{t("settings.checklists.listTitle")}
				</h3>
				{choices.length === 0 ? null : (
					<Button
						ref={addButton}
						size="compact"
						aria-disabled={busy || editor?.mode === "add" || undefined}
						onClick={() => {
							if (busy || editor?.mode === "add") return;
							resetAll();
							setCopyingId(null);
							setEditor({ mode: "add" });
						}}
						className={UNAVAILABLE_CLASS}
						data-testid="checklist-add"
					>
						{t("settings.checklists.action.add")}
					</Button>
				)}
			</div>
			{editor?.mode === "add" ? (
				<ChecklistEditor
					template={null}
					storeChoices={choices}
					storeName={null}
					busy={busy}
					status={formStatus}
					onRetry={formOwnsStatus && canRetry ? () => void save.retry() : null}
					onSubmit={(change) => void submit(change, "add")}
					onEdit={() => {
						if (!busy && action !== null) resetAll();
					}}
					onClose={closeEditor}
				/>
			) : null}
			<div className="flex flex-wrap items-center gap-2">
				<p
					role="status"
					className={cn(
						"text-sm",
						listStatus ? STATUS_TONES[listStatus.tone] : null,
					)}
					data-testid="checklist-status"
				>
					{listStatus?.text ?? ""}
				</p>
				{listStatus !== null && canRetry ? (
					<Button
						tone="secondary"
						size="compact"
						aria-disabled={busy || undefined}
						onClick={busy ? undefined : () => void (current ?? save).retry()}
						className={UNAVAILABLE_CLASS}
						data-testid="checklist-retry"
					>
						{t("app.retry")}
					</Button>
				) : null}
			</div>
			{groups.length === 0 ? (
				<p className="text-sm text-ink-muted" data-testid="checklist-empty">
					{t("settings.checklists.empty")}
				</p>
			) : (
				groups.map((group) => (
					<section
						key={group.storeId ?? "all"}
						aria-labelledby={`${ids}-${group.storeId ?? "all"}`}
						className="rounded-xl border border-line bg-surface-raised px-4"
						data-testid="checklist-group"
						data-store-id={group.storeId ?? "all"}
					>
						<h4
							id={`${ids}-${group.storeId ?? "all"}`}
							className="pt-3 font-semibold"
						>
							{group.name ?? t("settings.checklists.allStores")}
						</h4>
						<ul className="divide-y divide-line">
							{group.templates.map((template) => {
								const access = templateAccess(member, template);
								const targets = copyTargets(template, choices);
								const editing =
									editor?.mode === "edit" && editor.id === template.id;
								return (
									<TemplateCard
										key={template.id}
										template={template}
										canWrite={access.canWrite}
										reason={access}
										targets={targets}
										busy={busy}
										editing={editing}
										copying={copyingId === template.id}
										onEdit={(element) => {
											opener.current = element;
											resetAll();
											setCopyingId(null);
											setEditor({ mode: "edit", id: template.id });
										}}
										onToggle={() => {
											resetAll();
											setAction({
												kind: template.active ? "retire" : "activate",
												title: template.title,
											});
											void active.save({
												templateId: template.id,
												active: !template.active,
											});
										}}
										onCopy={() => {
											resetAll();
											setEditor(null);
											setCopyingId(template.id);
										}}
										copyPanel={
											copyingId === template.id ? (
												<CopyPanel
													template={template}
													targets={targets}
													busy={busy}
													onCopy={(storeId, store) => {
														setAction({
															kind: "copy",
															title: template.title,
															store,
														});
														void save
															.save(copiedChange(template, storeId))
															.then((ok) => {
																if (ok) setCopyingId(null);
															});
													}}
													onCancel={() => setCopyingId(null)}
												/>
											) : null
										}
										editor={
											editing ? (
												<ChecklistEditor
													template={template}
													storeChoices={choices}
													storeName={storeNameOf(
														template.storeId,
														storeProfiles,
													)}
													busy={busy}
													status={formStatus}
													onRetry={
														formOwnsStatus && canRetry
															? () => void save.retry()
															: null
													}
													onSubmit={(change) => void submit(change, "save")}
													onEdit={() => {
														if (!busy && action !== null) resetAll();
													}}
													onClose={closeEditor}
												/>
											) : null
										}
									/>
								);
							})}
						</ul>
					</section>
				))
			)}
		</section>
	);
}
