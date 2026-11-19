import { type FormEvent, useEffect, useId, useRef, useState } from "react";
import { Button } from "../../components/ui/button";
import { cn } from "../../components/ui/cn";
import { type Translate, useT } from "../../i18n";
import {
	CHECKLIST_ITEMS_MAX,
	CHECKLIST_TITLE_MAX,
	CHECKLIST_UNIT_MAX,
	type ChecklistTemplate,
	type ChecklistTemplateChange,
	SHIFT_PHASES,
	type ShiftPhase,
} from "../../operations/source";
import { controlClass, Field } from "../forms/field";
import type { SaveBarStatus } from "../forms/save-bar";
import { UNAVAILABLE_CLASS } from "../forms/save-bar";
import { SelectField } from "../forms/select-field";
import {
	type ChecklistDraft,
	type ChecklistStoreChoice,
	checklistDraftOf,
	emptyItem,
	type ItemDraft,
	isDraftEmpty,
	movedItem,
	PHASE_KEYS,
	readChecklistDraft,
	sameChecklist,
	skeletonDraft,
	type TextIssue,
	withoutItem,
} from "./checklist-rules";

const STATUS_TONES: Readonly<Record<SaveBarStatus["tone"], string>> = {
	info: "text-ink-muted",
	success: "text-positive",
	error: "text-negative",
};

export function textIssueMessage(
	t: Translate,
	issue: TextIssue | null,
	required: Parameters<Translate>[0],
): string | null {
	if (issue === null) return null;
	switch (issue.kind) {
		case "required":
			return t(required);
		case "control":
			return t("settings.checklists.form.control");
		case "tooLong":
			return t("settings.checklists.form.tooLong", { max: issue.max });
	}
}

export function storeChoiceLabel(
	t: Translate,
	choice: Pick<ChecklistStoreChoice, "name">,
): string {
	return choice.name ?? t("settings.checklists.allStores");
}

export interface ChecklistEditorProps {
	readonly template: ChecklistTemplate | null;
	readonly storeChoices: readonly ChecklistStoreChoice[];
	readonly storeName: string | null;
	readonly busy: boolean;
	readonly status: SaveBarStatus | null;
	readonly onRetry: (() => void) | null;
	readonly onSubmit: (change: ChecklistTemplateChange) => void;
	readonly onEdit: () => void;
	readonly onClose: () => void;
}

function ItemEditor({
	item,
	index,
	count,
	issues,
	show,
	busy,
	onChange,
	onMove,
	onRemove,
}: {
	readonly item: ItemDraft;
	readonly index: number;
	readonly count: number;
	readonly issues: ReturnType<typeof readChecklistDraft>["items"][number];
	readonly show: boolean;
	readonly busy: boolean;
	readonly onChange: (item: ItemDraft) => void;
	readonly onMove: (direction: -1 | 1) => void;
	readonly onRemove: () => void;
}) {
	const t = useT();
	const ids = useId();
	const position = index + 1;
	const labelError = show
		? textIssueMessage(
				t,
				issues.label,
				"settings.checklists.form.labelRequired",
			)
		: null;
	const unitError = show
		? textIssueMessage(t, issues.unit, "settings.checklists.form.unitRequired")
		: null;
	return (
		<li
			className="min-w-0 space-y-2 rounded-lg border border-line p-3"
			data-testid="checklist-item"
		>
			<Field
				id={`${ids}-label`}
				label={t("settings.checklists.form.itemLabel", { position })}
				error={labelError}
			>
				{(control) => (
					<input
						{...control}
						type="text"
						autoComplete="off"
						value={item.label}
						onChange={(event) =>
							onChange({ ...item, label: event.target.value })
						}
						className={controlClass}
						data-testid="checklist-item-label"
					/>
				)}
			</Field>
			<div className="flex flex-wrap items-center gap-x-4 gap-y-1">
				<label className="flex min-h-11 items-center gap-2">
					<input
						type="checkbox"
						checked={item.requiresPhoto}
						onChange={(event) =>
							onChange({ ...item, requiresPhoto: event.target.checked })
						}
						className="size-5 shrink-0 accent-accent"
						data-testid="checklist-item-photo"
					/>
					<span>{t("settings.checklists.form.requiresPhoto")}</span>
				</label>
				<label className="flex min-h-11 items-center gap-2">
					<input
						type="checkbox"
						checked={item.hasNumber}
						onChange={(event) =>
							onChange({ ...item, hasNumber: event.target.checked })
						}
						className="size-5 shrink-0 accent-accent"
						data-testid="checklist-item-number"
					/>
					<span>{t("settings.checklists.form.hasNumber")}</span>
				</label>
			</div>
			{item.hasNumber ? (
				<Field
					id={`${ids}-unit`}
					label={t("settings.checklists.form.unit", { position })}
					hint={t("settings.checklists.form.unitHint", {
						max: CHECKLIST_UNIT_MAX,
					})}
					error={unitError}
				>
					{(control) => (
						<input
							{...control}
							type="text"
							autoComplete="off"
							value={item.unit}
							onChange={(event) =>
								onChange({ ...item, unit: event.target.value })
							}
							className={cn(controlClass, "max-w-48")}
							data-testid="checklist-item-unit"
						/>
					)}
				</Field>
			) : null}
			<div className="flex flex-wrap gap-2">
				<Button
					tone="secondary"
					size="compact"
					aria-label={t("settings.checklists.form.moveUp", { position })}
					aria-disabled={busy || index === 0 || undefined}
					onClick={busy || index === 0 ? undefined : () => onMove(-1)}
					className={UNAVAILABLE_CLASS}
					data-testid="checklist-item-up"
				>
					<span aria-hidden="true">↑</span>
				</Button>
				<Button
					tone="secondary"
					size="compact"
					aria-label={t("settings.checklists.form.moveDown", { position })}
					aria-disabled={busy || index === count - 1 || undefined}
					onClick={busy || index === count - 1 ? undefined : () => onMove(1)}
					className={UNAVAILABLE_CLASS}
					data-testid="checklist-item-down"
				>
					<span aria-hidden="true">↓</span>
				</Button>
				<Button
					tone="secondary"
					size="compact"
					aria-label={t("settings.checklists.form.remove", { position })}
					aria-disabled={busy || count === 1 || undefined}
					onClick={busy || count === 1 ? undefined : onRemove}
					className={UNAVAILABLE_CLASS}
					data-testid="checklist-item-remove"
				>
					{t("settings.checklists.form.removeShort")}
				</Button>
			</div>
		</li>
	);
}

export function ChecklistEditor({
	template,
	storeChoices,
	storeName,
	busy,
	status,
	onRetry,
	onSubmit,
	onEdit,
	onClose,
}: ChecklistEditorProps) {
	const t = useT();
	const ids = useId();
	const titleRef = useRef<HTMLInputElement | null>(null);
	const [draft, setDraft] = useState<ChecklistDraft>(() =>
		checklistDraftOf(template, storeChoices[0]?.value ?? ""),
	);
	const [submitted, setSubmitted] = useState(false);
	const [touchedTitle, setTouchedTitle] = useState(false);
	const editedTitle = useRef(false);
	useEffect(() => {
		titleRef.current?.focus();
	}, []);
	const choices =
		template === null
			? storeChoices.map((choice) => choice.value)
			: [draft.store];
	const reading = readChecklistDraft(draft, choices);
	const change =
		reading.change === null
			? null
			: { ...reading.change, templateId: template?.id ?? null };
	const unchanged =
		template !== null && change !== null && sameChecklist(template, change);
	const edit = (next: ChecklistDraft) => {
		setDraft(next);
		onEdit();
	};
	const editItems = (items: readonly ItemDraft[]) => edit({ ...draft, items });
	const submit = (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		setSubmitted(true);
		if (busy || change === null || unchanged) return;
		onSubmit(change);
	};
	const empty = isDraftEmpty(draft);
	const countError =
		submitted && reading.count !== null
			? reading.count === "required"
				? t("settings.checklists.form.itemsRequired")
				: t("settings.checklists.form.itemsMax", { max: CHECKLIST_ITEMS_MAX })
			: null;
	const heading =
		template === null
			? t("settings.checklists.form.addTitle")
			: t("settings.checklists.form.editTitle", { title: template.title });
	return (
		<form
			noValidate
			aria-labelledby={`${ids}-heading`}
			onSubmit={submit}
			onKeyDown={(event) => {
				if (event.key === "Escape" && !busy) onClose();
			}}
			className="min-w-0 space-y-3 rounded-lg border border-line bg-surface p-3"
			data-testid="checklist-form"
			data-mode={template === null ? "add" : "edit"}
		>
			<h4 id={`${ids}-heading`} className="text-sm font-semibold">
				{heading}
			</h4>
			{template === null ? (
				<div className="grid gap-3 sm:grid-cols-2">
					<SelectField<string>
						id={`${ids}-store`}
						testId="checklist-form-store"
						label={t("settings.checklists.form.store")}
						hint={t("settings.checklists.form.storeHint")}
						value={draft.store}
						options={storeChoices.map((choice) => ({
							value: choice.value,
							label: storeChoiceLabel(t, choice),
						}))}
						onChange={(store) => edit({ ...draft, store })}
					/>
					<SelectField<ShiftPhase>
						id={`${ids}-phase`}
						testId="checklist-form-phase"
						label={t("settings.checklists.form.phase")}
						value={draft.phase}
						options={SHIFT_PHASES.map((phase) => ({
							value: phase,
							label: t(PHASE_KEYS[phase]),
						}))}
						onChange={(phase) => edit({ ...draft, phase })}
					/>
				</div>
			) : (
				<p
					className="text-sm text-ink-muted"
					data-testid="checklist-form-fixed"
				>
					{t("settings.checklists.form.fixed", {
						store: storeName ?? t("settings.checklists.allStores"),
						phase: t(PHASE_KEYS[template.phase]),
					})}
				</p>
			)}
			<Field
				id={`${ids}-title`}
				label={t("settings.checklists.form.title")}
				hint={t("settings.checklists.form.titleHint", {
					max: CHECKLIST_TITLE_MAX,
				})}
				error={
					submitted || touchedTitle
						? textIssueMessage(
								t,
								reading.title,
								"settings.checklists.form.titleRequired",
							)
						: null
				}
			>
				{(control) => (
					<input
						{...control}
						ref={titleRef}
						type="text"
						autoComplete="off"
						value={draft.title}
						onChange={(event) => {
							editedTitle.current = true;
							edit({ ...draft, title: event.target.value });
						}}
						onBlur={() => {
							if (editedTitle.current) setTouchedTitle(true);
						}}
						className={controlClass}
						data-testid="checklist-form-title"
					/>
				)}
			</Field>
			<fieldset
				className="min-w-0 space-y-2"
				data-testid="checklist-form-items"
			>
				<legend className="text-sm font-medium">
					{t("settings.checklists.form.items")}
				</legend>
				<ol className="space-y-2">
					{draft.items.map((item, index) => (
						<ItemEditor
							key={item.key}
							item={item}
							index={index}
							count={draft.items.length}
							issues={reading.items[index] ?? { label: null, unit: null }}
							show={submitted}
							busy={busy}
							onChange={(next) =>
								editItems(
									draft.items.map((candidate, position) =>
										position === index ? next : candidate,
									),
								)
							}
							onMove={(direction) =>
								editItems(movedItem(draft.items, index, direction))
							}
							onRemove={() => editItems(withoutItem(draft.items, index))}
						/>
					))}
				</ol>
				{countError === null ? null : (
					<p
						className="text-sm text-negative"
						data-testid="settings-field-error"
					>
						{countError}
					</p>
				)}
				<div className="flex flex-wrap gap-2">
					<Button
						tone="secondary"
						size="compact"
						aria-disabled={
							busy || draft.items.length >= CHECKLIST_ITEMS_MAX || undefined
						}
						onClick={
							busy || draft.items.length >= CHECKLIST_ITEMS_MAX
								? undefined
								: () => editItems([...draft.items, emptyItem()])
						}
						className={UNAVAILABLE_CLASS}
						data-testid="checklist-add-item"
					>
						{t("settings.checklists.form.addItem")}
					</Button>
					<Button
						tone="secondary"
						size="compact"
						aria-describedby={`${ids}-skeleton-hint`}
						aria-disabled={busy || !empty || undefined}
						onClick={
							busy || !empty ? undefined : () => edit(skeletonDraft(draft, t))
						}
						className={UNAVAILABLE_CLASS}
						data-testid="checklist-skeleton"
					>
						{t("settings.checklists.form.skeleton")}
					</Button>
				</div>
				<p id={`${ids}-skeleton-hint`} className="text-xs text-ink-muted">
					{t("settings.checklists.form.skeletonHint")}
				</p>
			</fieldset>
			<p
				className="rounded-lg border border-line bg-surface-sunken px-3 py-2 text-sm"
				data-testid="checklist-next-run"
			>
				{t("settings.checklists.form.nextRun")}
			</p>
			<div className="flex flex-wrap items-center gap-2">
				<Button
					type="submit"
					size="compact"
					aria-disabled={busy || unchanged || undefined}
					aria-busy={busy || undefined}
					className={UNAVAILABLE_CLASS}
					data-testid="checklist-form-submit"
				>
					{template === null
						? t("settings.checklists.form.submitAdd")
						: t("settings.checklists.form.submitEdit")}
				</Button>
				<Button
					tone="secondary"
					size="compact"
					aria-disabled={busy || undefined}
					onClick={busy ? undefined : onClose}
					className={UNAVAILABLE_CLASS}
					data-testid="checklist-form-close"
				>
					{t("settings.checklists.form.close")}
				</Button>
			</div>
			<div className="flex flex-wrap items-center gap-2">
				<p
					role="status"
					className={cn("text-sm", status ? STATUS_TONES[status.tone] : null)}
					data-testid="checklist-form-status"
				>
					{status?.text ?? (unchanged ? t("settings.saveBar.none") : "")}
				</p>
				{onRetry === null ? null : (
					<Button
						tone="secondary"
						size="compact"
						aria-disabled={busy || undefined}
						onClick={busy ? undefined : onRetry}
						className={UNAVAILABLE_CLASS}
						data-testid="checklist-form-retry"
					>
						{t("app.retry")}
					</Button>
				)}
			</div>
		</form>
	);
}
