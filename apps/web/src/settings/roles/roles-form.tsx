import { useMemo, useState } from "react";
import { Button } from "../../components/ui/button";
import { cn } from "../../components/ui/cn";
import { type MessageKey, useT } from "../../i18n";
import type { Formatters } from "../../lib/format";
import { controlClass, Field } from "../forms/field";
import { SaveBar, type SaveBarStatus } from "../forms/save-bar";
import type {
	ItemTypeEntry,
	ItemTypeRole,
	RoleChange,
	SettingsWriteCode,
} from "../source";
import { WRITE_ERROR_KEYS } from "../use-settings-mutation";
import {
	type AccountGroup,
	groupsOf,
	keepEdits,
	ROLE_LABEL_KEYS,
	ROLE_OPTIONS,
	type RoleDraft,
	roleChangesOf,
	roleKeyOf,
	savedDraftOf,
	suggestionOf,
	suggestionsFor,
} from "./roles";
import type { RoleUsage } from "./use-role-usage";

export type RolesOutcome =
	| { readonly kind: "idle" }
	| { readonly kind: "saved" }
	| { readonly kind: "refused"; readonly code: SettingsWriteCode };

export interface RolesFormProps {
	readonly entries: readonly ItemTypeEntry[];
	readonly usage: RoleUsage;
	readonly formatters: Formatters;
	readonly canWrite: boolean;
	readonly saving: boolean;
	readonly outcome: RolesOutcome;
	readonly onSave: (changes: readonly RoleChange[]) => void;
	readonly onEdit: () => void;
}

const NO_ROLE = "";

function roleLabel(
	t: (key: MessageKey) => string,
	role: ItemTypeRole | null,
): string {
	return role === null
		? t("settings.mapping.roles.none")
		: t(ROLE_LABEL_KEYS[role]);
}

function isRole(value: string): value is ItemTypeRole {
	return (ROLE_OPTIONS as readonly string[]).includes(value);
}

interface RoleRowProps {
	readonly entry: ItemTypeEntry;
	readonly role: ItemTypeRole | null;
	readonly usageText: string | null;
	readonly readOnly: boolean;
	readonly onChange: (role: ItemTypeRole | null) => void;
}

function RoleRow({ entry, role, usageText, readOnly, onChange }: RoleRowProps) {
	const t = useT();
	const id = `role-${roleKeyOf(entry).replace(/[^A-Za-z0-9_-]/g, "-")}`;
	const suggestion = suggestionOf(entry);
	const showSuggestion = role === null && suggestion !== null;
	const badgeId = `${id}-suggestion`;
	return (
		<li
			className="border-b border-line py-3 last:border-b-0"
			data-testid="role-row"
			data-type={entry.itemTypeExternalId}
		>
			<Field id={id} label={entry.name} hint={usageText} readOnly={readOnly}>
				{(control) => {
					const describedBy =
						[control["aria-describedby"], showSuggestion ? badgeId : null]
							.filter((value) => value !== null && value !== undefined)
							.join(" ") || undefined;
					return (
						<div className="flex flex-wrap items-center gap-2">
							{readOnly ? (
								<input
									id={control.id}
									aria-describedby={describedBy}
									type="text"
									readOnly
									value={roleLabel(t, role)}
									className={cn(controlClass, "sm:max-w-56")}
									data-testid="role-select"
								/>
							) : (
								<select
									id={control.id}
									aria-describedby={describedBy}
									value={role ?? NO_ROLE}
									onChange={(event) => {
										const value = event.target.value;
										onChange(isRole(value) ? value : null);
									}}
									className={cn(controlClass, "sm:max-w-56")}
									data-testid="role-select"
								>
									<option value={NO_ROLE}>
										{t("settings.mapping.roles.none")}
									</option>
									{ROLE_OPTIONS.map((option) => (
										<option key={option} value={option}>
											{t(ROLE_LABEL_KEYS[option])}
										</option>
									))}
								</select>
							)}
							{showSuggestion ? (
								<span
									id={badgeId}
									className="rounded-full border border-line bg-surface-sunken px-2 py-0.5 text-xs"
									data-testid="role-suggestion"
								>
									{t("settings.mapping.roles.suggestion", {
										role: t(ROLE_LABEL_KEYS[suggestion]),
									})}
								</span>
							) : null}
						</div>
					);
				}}
			</Field>
		</li>
	);
}

function statusOf(
	t: (key: MessageKey) => string,
	outcome: RolesOutcome,
	pending: number,
	suggestionsApplied: boolean,
): SaveBarStatus | null {
	if (outcome.kind === "refused") {
		return { tone: "error", text: t(WRITE_ERROR_KEYS[outcome.code]) };
	}
	if (suggestionsApplied && pending > 0) {
		return { tone: "info", text: t("settings.mapping.roles.applied") };
	}
	if (outcome.kind === "saved" && pending === 0) {
		return { tone: "success", text: t("settings.saved") };
	}
	return null;
}

export function RolesForm({
	entries,
	usage,
	formatters,
	canWrite,
	saving,
	outcome,
	onSave,
	onEdit,
}: RolesFormProps) {
	const t = useT();
	const saved = useMemo(() => savedDraftOf(entries), [entries]);
	const [synced, setSynced] = useState<RoleDraft>(saved);
	const [draft, setDraft] = useState<RoleDraft>(saved);
	const [suggestionsApplied, setSuggestionsApplied] = useState(false);
	if (JSON.stringify(synced) !== JSON.stringify(saved)) {
		setSynced(saved);
		setDraft(keepEdits(synced, saved, draft));
		setSuggestionsApplied(false);
	}
	const groups: AccountGroup[] = useMemo(() => groupsOf(entries), [entries]);
	const changes = roleChangesOf(entries, draft);
	const suggestions = suggestionsFor(entries, draft);
	const suggestionCount = Object.keys(suggestions).length;
	const edit = (next: RoleDraft, applied: boolean) => {
		setDraft(next);
		setSuggestionsApplied(applied);
		onEdit();
	};
	const usageText = (entry: ItemTypeEntry): string | null => {
		if (usage.failed || usage.failedAccounts.has(entry.posAccountId)) {
			return t("settings.mapping.roles.usageUnavailable");
		}
		if (usage.loading) return null;
		const found = usage.byKey.get(roleKeyOf(entry));
		if (found === undefined) return t("settings.mapping.roles.usageNone");
		return t("settings.mapping.roles.usage", {
			items: formatters.count(found.items),
			share: found.share === null ? "—" : formatters.percent(found.share),
		});
	};
	if (entries.length === 0) {
		return (
			<p className="text-ink-muted" data-testid="roles-empty">
				{t("settings.mapping.roles.empty")}
			</p>
		);
	}
	return (
		<div className="space-y-4" data-testid="roles-form">
			<p className="text-sm text-ink-muted">
				{t("settings.mapping.roles.intro")}
			</p>
			{canWrite && suggestionCount > 0 ? (
				<Button
					tone="secondary"
					size="compact"
					aria-disabled={saving || undefined}
					onClick={
						saving ? undefined : () => edit({ ...draft, ...suggestions }, true)
					}
					data-testid="roles-apply-suggestions"
				>
					{t(
						suggestionCount === 1
							? "settings.mapping.roles.applyOne"
							: "settings.mapping.roles.applyMany",
						{ count: suggestionCount },
					)}
				</Button>
			) : null}
			{groups.map((group) => (
				<section
					key={group.posAccountId}
					aria-labelledby={`roles-account-${group.posAccountId}`}
					className="rounded-xl border border-line bg-surface-raised px-4 py-1"
					data-testid="roles-account"
				>
					<h3
						id={`roles-account-${group.posAccountId}`}
						className="pt-3 text-base font-semibold"
					>
						{group.posAccountName}
					</h3>
					<ul>
						{group.entries.map((entry) => (
							<RoleRow
								key={roleKeyOf(entry)}
								entry={entry}
								role={draft[roleKeyOf(entry)] ?? null}
								usageText={usageText(entry)}
								readOnly={!canWrite}
								onChange={(role) => {
									if (!saving) {
										edit({ ...draft, [roleKeyOf(entry)]: role }, false);
									}
								}}
							/>
						))}
					</ul>
				</section>
			))}
			{canWrite ? (
				<SaveBar
					pendingCount={changes.length}
					canSave
					saving={saving}
					onSave={() => onSave(changes)}
					onCancel={() => edit(saved, false)}
					status={statusOf(t, outcome, changes.length, suggestionsApplied)}
				/>
			) : null}
		</div>
	);
}
