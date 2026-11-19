import type { MessageKey, Translate } from "../../i18n";
import {
	CHECKLIST_ITEM_LABEL_MAX,
	CHECKLIST_ITEMS_MAX,
	CHECKLIST_TITLE_MAX,
	CHECKLIST_UNIT_MAX,
	type ChecklistItemDraft,
	type ChecklistTemplate,
	type ChecklistTemplateChange,
	SHIFT_PHASES,
	type ShiftPhase,
} from "../../operations/source";
import { type SettingsAccess, settingsAccess } from "../access";
import type { Membership, SettingsWriteCode, StoreProfile } from "../source";
import { WRITE_ERROR_KEYS } from "../use-settings-mutation";

export const ALL_STORES = "*";

export const PHASE_KEYS: Readonly<Record<ShiftPhase, MessageKey>> = {
	opening: "operations.phase.opening",
	midshift: "operations.phase.midshift",
	closing: "operations.phase.closing",
};

export interface ItemDraft {
	readonly key: string;
	readonly label: string;
	readonly requiresPhoto: boolean;
	readonly hasNumber: boolean;
	readonly unit: string;
}

export interface ChecklistDraft {
	readonly store: string;
	readonly phase: ShiftPhase;
	readonly title: string;
	readonly items: readonly ItemDraft[];
}

export type TextIssue =
	| { readonly kind: "required" }
	| { readonly kind: "tooLong"; readonly max: number }
	| { readonly kind: "control" };

export interface ItemIssues {
	readonly label: TextIssue | null;
	readonly unit: TextIssue | null;
}

export interface DraftReading {
	readonly change: ChecklistTemplateChange | null;
	readonly title: TextIssue | null;
	readonly store: boolean;
	readonly items: readonly ItemIssues[];
	readonly count: "required" | "tooMany" | null;
}

const CONTROL = /\p{Cc}/u;

let itemKeys = 0;

export function newItemKey(): string {
	itemKeys += 1;
	return `item-${itemKeys}`;
}

export function composedText(value: string): string {
	return value.normalize("NFC").trim();
}

export function textIssue(value: string, max: number): TextIssue | null {
	const text = composedText(value);
	if (text === "") return { kind: "required" };
	if (CONTROL.test(text)) return { kind: "control" };
	if ([...text].length > max) return { kind: "tooLong", max };
	return null;
}

export function itemDraftOf(item: ChecklistItemDraft): ItemDraft {
	return {
		key: newItemKey(),
		label: item.label,
		requiresPhoto: item.requiresPhoto,
		hasNumber: item.numberUnit !== null,
		unit: item.numberUnit ?? "",
	};
}

export function emptyItem(): ItemDraft {
	return {
		key: newItemKey(),
		label: "",
		requiresPhoto: false,
		hasNumber: false,
		unit: "",
	};
}

export function storeValueOf(storeId: string | null): string {
	return storeId ?? ALL_STORES;
}

export function storeIdOf(value: string): string | null {
	return value === ALL_STORES ? null : value;
}

export function checklistDraftOf(
	template: ChecklistTemplate | null,
	defaultStore: string,
): ChecklistDraft {
	if (template === null) {
		return {
			store: defaultStore,
			phase: "opening",
			title: "",
			items: [emptyItem()],
		};
	}
	return {
		store: storeValueOf(template.storeId),
		phase: template.phase,
		title: template.title,
		items: template.items.map(itemDraftOf),
	};
}

export function movedItem(
	items: readonly ItemDraft[],
	index: number,
	direction: -1 | 1,
): ItemDraft[] {
	const target = index + direction;
	const moving = items[index];
	const other = items[target];
	if (moving === undefined || other === undefined) return [...items];
	const next = [...items];
	next[index] = other;
	next[target] = moving;
	return next;
}

export function withoutItem(
	items: readonly ItemDraft[],
	index: number,
): ItemDraft[] {
	return items.filter((_, position) => position !== index);
}

export function readChecklistDraft(
	draft: ChecklistDraft,
	storeChoices: readonly string[],
): DraftReading {
	const title = textIssue(draft.title, CHECKLIST_TITLE_MAX);
	const store = !storeChoices.includes(draft.store);
	const items = draft.items.map((item) => ({
		label: textIssue(item.label, CHECKLIST_ITEM_LABEL_MAX),
		unit: item.hasNumber ? textIssue(item.unit, CHECKLIST_UNIT_MAX) : null,
	}));
	const count =
		draft.items.length === 0
			? "required"
			: draft.items.length > CHECKLIST_ITEMS_MAX
				? "tooMany"
				: null;
	const valid =
		title === null &&
		!store &&
		count === null &&
		items.every((issues) => issues.label === null && issues.unit === null);
	return {
		change: valid
			? {
					templateId: null,
					storeId: storeIdOf(draft.store),
					phase: draft.phase,
					title: composedText(draft.title),
					items: draft.items.map((item) => ({
						label: composedText(item.label),
						requiresPhoto: item.requiresPhoto,
						numberUnit: item.hasNumber ? composedText(item.unit) : null,
					})),
				}
			: null,
		title,
		store,
		items,
		count,
	};
}

export function sameChecklist(
	template: ChecklistTemplate,
	change: ChecklistTemplateChange,
): boolean {
	return (
		template.title === change.title &&
		template.items.length === change.items.length &&
		template.items.every((item, index) => {
			const changed = change.items[index];
			return (
				changed !== undefined &&
				item.label === changed.label &&
				item.requiresPhoto === changed.requiresPhoto &&
				item.numberUnit === changed.numberUnit
			);
		})
	);
}

export interface ChecklistStoreChoice {
	readonly value: string;
	readonly storeId: string | null;
	readonly name: string | null;
}

export function checklistStoreChoices(
	membership: Membership | null | undefined,
	profiles: readonly StoreProfile[],
): ChecklistStoreChoice[] {
	const all = settingsAccess("checklists", membership, null).canWrite
		? [{ value: ALL_STORES, storeId: null, name: null }]
		: [];
	return [
		...all,
		...profiles
			.filter(
				(profile) =>
					settingsAccess("checklists", membership, profile.storeId).canWrite,
			)
			.map((profile) => ({
				value: profile.storeId,
				storeId: profile.storeId,
				name: profile.name,
			})),
	];
}

export function copyTargets(
	template: ChecklistTemplate,
	choices: readonly ChecklistStoreChoice[],
): ChecklistStoreChoice[] {
	return choices.filter(
		(choice) => choice.storeId !== null && choice.storeId !== template.storeId,
	);
}

export function copiedChange(
	template: ChecklistTemplate,
	storeId: string,
): ChecklistTemplateChange {
	return {
		templateId: null,
		storeId,
		phase: template.phase,
		title: template.title,
		items: template.items.map((item) => ({
			label: item.label,
			requiresPhoto: item.requiresPhoto,
			numberUnit: item.numberUnit,
		})),
	};
}

export function templateAccess(
	membership: Membership | null | undefined,
	template: Pick<ChecklistTemplate, "storeId">,
): SettingsAccess {
	return settingsAccess("checklists", membership, template.storeId);
}

export function checklistErrorKey(
	code: SettingsWriteCode | null,
): MessageKey | null {
	if (code === null) return null;
	if (code === "forbidden") return "settings.checklists.error.scope";
	if (code === "invalid") return "settings.checklists.error.invalid";
	return WRITE_ERROR_KEYS[code];
}

export interface ChecklistGroup {
	readonly storeId: string | null;
	readonly name: string | null;
	readonly templates: readonly ChecklistTemplate[];
}

const PHASE_RANK: Readonly<Record<ShiftPhase, number>> = {
	opening: 0,
	midshift: 1,
	closing: 2,
};

function byPhaseThenTitle(
	left: ChecklistTemplate,
	right: ChecklistTemplate,
): number {
	return (
		PHASE_RANK[left.phase] - PHASE_RANK[right.phase] ||
		Number(right.active) - Number(left.active) ||
		left.title.localeCompare(right.title, "vi", { numeric: true }) ||
		(left.id < right.id ? -1 : 1)
	);
}

export function checklistGroups(
	templates: readonly ChecklistTemplate[],
	profiles: readonly StoreProfile[],
): ChecklistGroup[] {
	const groups: ChecklistGroup[] = [];
	const tenantWide = templates.filter((template) => template.storeId === null);
	if (tenantWide.length > 0) {
		groups.push({
			storeId: null,
			name: null,
			templates: [...tenantWide].sort(byPhaseThenTitle),
		});
	}
	for (const profile of profiles) {
		const own = templates.filter(
			(template) => template.storeId === profile.storeId,
		);
		if (own.length === 0) continue;
		groups.push({
			storeId: profile.storeId,
			name: profile.name,
			templates: [...own].sort(byPhaseThenTitle),
		});
	}
	return groups;
}

interface SkeletonItem {
	readonly label: MessageKey;
	readonly requiresPhoto: boolean;
	readonly unit: MessageKey | null;
}

export const CHECKLIST_SKELETON: Readonly<
	Record<
		ShiftPhase,
		{ readonly title: MessageKey; readonly items: readonly SkeletonItem[] }
	>
> = {
	opening: {
		title: "settings.checklists.skeleton.opening.title",
		items: [
			{
				label: "settings.checklists.skeleton.opening.pos",
				requiresPhoto: false,
				unit: null,
			},
			{
				label: "settings.checklists.skeleton.opening.hygiene",
				requiresPhoto: true,
				unit: null,
			},
			{
				label: "settings.checklists.skeleton.opening.incidents",
				requiresPhoto: false,
				unit: null,
			},
			{
				label: "settings.checklists.skeleton.opening.handover",
				requiresPhoto: false,
				unit: null,
			},
		],
	},
	midshift: {
		title: "settings.checklists.skeleton.midshift.title",
		items: [
			{
				label: "settings.checklists.skeleton.midshift.hygiene",
				requiresPhoto: true,
				unit: null,
			},
			{
				label: "settings.checklists.skeleton.midshift.fridge",
				requiresPhoto: false,
				unit: "settings.checklists.skeleton.unit.celsius",
			},
			{
				label: "settings.checklists.skeleton.midshift.incidents",
				requiresPhoto: false,
				unit: null,
			},
		],
	},
	closing: {
		title: "settings.checklists.skeleton.closing.title",
		items: [
			{
				label: "settings.checklists.skeleton.closing.waste",
				requiresPhoto: false,
				unit: "settings.checklists.skeleton.unit.portions",
			},
			{
				label: "settings.checklists.skeleton.closing.hygiene",
				requiresPhoto: true,
				unit: null,
			},
			{
				label: "settings.checklists.skeleton.closing.incidents",
				requiresPhoto: false,
				unit: null,
			},
			{
				label: "settings.checklists.skeleton.closing.handover",
				requiresPhoto: false,
				unit: null,
			},
			{
				label: "settings.checklists.skeleton.closing.pos",
				requiresPhoto: false,
				unit: null,
			},
		],
	},
};

export function skeletonDraft(
	draft: ChecklistDraft,
	t: Translate,
): ChecklistDraft {
	const skeleton = CHECKLIST_SKELETON[draft.phase];
	return {
		...draft,
		title: composedText(draft.title) === "" ? t(skeleton.title) : draft.title,
		items: skeleton.items.map((item) => ({
			key: newItemKey(),
			label: t(item.label),
			requiresPhoto: item.requiresPhoto,
			hasNumber: item.unit !== null,
			unit: item.unit === null ? "" : t(item.unit),
		})),
	};
}

export function isDraftEmpty(draft: ChecklistDraft): boolean {
	return draft.items.every(
		(item) => composedText(item.label) === "" && !item.hasNumber,
	);
}

export { SHIFT_PHASES };
