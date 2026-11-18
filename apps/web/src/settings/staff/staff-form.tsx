import { type FormEvent, useEffect, useId, useRef, useState } from "react";
import { Button } from "../../components/ui/button";
import { cn } from "../../components/ui/cn";
import { useT } from "../../i18n";
import { controlClass, Field } from "../forms/field";
import { issueText } from "../forms/issue-text";
import type { SaveBarStatus } from "../forms/save-bar";
import { UNAVAILABLE_CLASS } from "../forms/save-bar";
import { SelectField } from "../forms/select-field";
import {
	STAFF_ROLES,
	type StaffChange,
	type StaffMember,
	type StaffRole,
} from "./source";
import {
	readStaffDraft,
	STAFF_NAME_MAX_LENGTH,
	STAFF_ROLE_KEYS,
	type StaffDraft,
	type StaffStoreChoices,
	sameStaffChange,
	staffDraftOf,
} from "./staff-rules";

const STATUS_TONES: Readonly<Record<SaveBarStatus["tone"], string>> = {
	info: "text-ink-muted",
	success: "text-positive",
	error: "text-negative",
};

export interface StaffFormProps {
	readonly member: StaffMember | null;
	readonly choices: StaffStoreChoices;
	readonly busy: boolean;
	readonly status: SaveBarStatus | null;
	readonly onRetry: (() => void) | null;
	readonly onSubmit: (change: StaffChange) => void;
	readonly onEdit: () => void;
	readonly onClose: () => void;
}

const UNTOUCHED = { name: false, stores: false } as const;

export function StaffForm({
	member,
	choices,
	busy,
	status,
	onRetry,
	onSubmit,
	onEdit,
	onClose,
}: StaffFormProps) {
	const t = useT();
	const ids = useId();
	const nameRef = useRef<HTMLInputElement | null>(null);
	const [draft, setDraft] = useState<StaffDraft>(() =>
		staffDraftOf(member, choices),
	);
	const [touched, setTouched] = useState<{
		readonly name: boolean;
		readonly stores: boolean;
	}>(UNTOUCHED);
	const [submitted, setSubmitted] = useState(false);
	useEffect(() => {
		nameRef.current?.focus();
	}, []);
	const reading = readStaffDraft(draft, choices);
	const unchanged =
		member !== null &&
		reading.change !== null &&
		sameStaffChange(member, reading.change);
	const nameIssue = reading.nameIssue;
	const nameError =
		nameIssue === null
			? null
			: nameIssue.kind === "control"
				? t("settings.staff.form.nameControl")
				: issueText(t, nameIssue.issue);
	const showName = submitted || touched.name;
	const showStores = submitted || touched.stores;
	const edit = (next: StaffDraft) => {
		setDraft(next);
		onEdit();
	};
	const toggleStore = (storeId: string, checked: boolean) => {
		setTouched({ ...touched, stores: true });
		edit({
			...draft,
			storeIds: checked
				? [...draft.storeIds, storeId]
				: draft.storeIds.filter((candidate) => candidate !== storeId),
		});
	};
	const submit = (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		setSubmitted(true);
		if (busy || reading.change === null || unchanged) return;
		onSubmit(reading.change);
	};
	const title =
		member === null
			? t("settings.staff.form.addTitle")
			: t("settings.staff.form.editTitle", { name: member.displayName });
	const storesErrorId = `${ids}-stores-error`;
	return (
		<form
			noValidate
			aria-labelledby={`${ids}-title`}
			onSubmit={submit}
			onKeyDown={(event) => {
				if (event.key === "Escape" && !busy) onClose();
			}}
			className="min-w-0 space-y-3 rounded-lg border border-line bg-surface p-3"
			data-testid="staff-form"
			data-mode={member === null ? "add" : "edit"}
		>
			<h4 id={`${ids}-title`} className="text-sm font-semibold">
				{title}
			</h4>
			<Field
				id={`${ids}-name`}
				label={t("settings.staff.form.name")}
				hint={t("settings.staff.form.nameHint", { max: STAFF_NAME_MAX_LENGTH })}
				error={showName ? nameError : null}
			>
				{(control) => (
					<input
						{...control}
						ref={nameRef}
						type="text"
						autoComplete="off"
						value={draft.name}
						onChange={(event) => edit({ ...draft, name: event.target.value })}
						onBlur={() => setTouched({ ...touched, name: true })}
						className={controlClass}
						data-testid="staff-form-name"
					/>
				)}
			</Field>
			<SelectField<StaffRole>
				id={`${ids}-role`}
				testId="staff-form-role"
				label={t("settings.staff.form.role")}
				hint={t("settings.staff.form.roleHint")}
				value={draft.role}
				options={STAFF_ROLES.map((role) => ({
					value: role,
					label: t(STAFF_ROLE_KEYS[role]),
				}))}
				onChange={(role) => edit({ ...draft, role })}
			/>
			<fieldset
				className="min-w-0 space-y-1"
				aria-describedby={
					showStores && reading.storesIssue
						? `${ids}-stores-hint ${storesErrorId}`
						: `${ids}-stores-hint`
				}
				data-testid="staff-form-stores"
			>
				<legend className="text-sm font-medium">
					{t("settings.staff.form.stores")}
				</legend>
				<p id={`${ids}-stores-hint`} className="text-xs text-ink-muted">
					{t("settings.staff.form.storesHint")}
				</p>
				{choices.allStores ? (
					<label className="flex min-h-11 items-center gap-3">
						<input
							type="checkbox"
							checked={draft.allStores}
							onChange={(event) => {
								setTouched({ ...touched, stores: true });
								edit({ ...draft, allStores: event.target.checked });
							}}
							className="size-5 shrink-0 accent-accent"
							data-testid="staff-form-all-stores"
						/>
						<span>{t("settings.staff.form.allStores")}</span>
					</label>
				) : null}
				{draft.allStores && choices.allStores
					? null
					: choices.stores.map((store) => (
							<label
								key={store.storeId}
								className="flex min-h-11 items-center gap-3"
							>
								<input
									type="checkbox"
									checked={draft.storeIds.includes(store.storeId)}
									onChange={(event) =>
										toggleStore(store.storeId, event.target.checked)
									}
									className="size-5 shrink-0 accent-accent"
									data-testid="staff-form-store"
									data-store-id={store.storeId}
								/>
								<span className="min-w-0 break-words">{store.name}</span>
							</label>
						))}
				{showStores && reading.storesIssue ? (
					<p
						id={storesErrorId}
						className="text-sm text-negative"
						data-testid="settings-field-error"
					>
						{t("settings.staff.form.storesRequired")}
					</p>
				) : null}
			</fieldset>
			<div className="flex flex-wrap items-center gap-2">
				<Button
					type="submit"
					size="compact"
					aria-disabled={busy || unchanged || undefined}
					aria-busy={busy || undefined}
					className={UNAVAILABLE_CLASS}
					data-testid="staff-form-submit"
				>
					{member === null
						? t("settings.staff.form.submitAdd")
						: t("settings.staff.form.submitEdit")}
				</Button>
				<Button
					tone="secondary"
					size="compact"
					aria-disabled={busy || undefined}
					onClick={busy ? undefined : onClose}
					className={UNAVAILABLE_CLASS}
					data-testid="staff-form-close"
				>
					{t("settings.staff.form.close")}
				</Button>
			</div>
			<div className="flex flex-wrap items-center gap-2">
				<p
					role="status"
					className={cn("text-sm", status ? STATUS_TONES[status.tone] : null)}
					data-testid="staff-form-status"
				>
					{status?.text ?? (unchanged ? t("settings.saveBar.none") : "")}
				</p>
				{onRetry === null ? null : (
					<Button
						tone="secondary"
						size="compact"
						aria-disabled={busy || undefined}
						onClick={busy ? undefined : onRetry}
						data-testid="settings-retry-save"
					>
						{t("app.retry")}
					</Button>
				)}
			</div>
		</form>
	);
}
