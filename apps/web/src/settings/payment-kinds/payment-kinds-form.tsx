import type { PaymentKind } from "@fnb/core";
import { type ReactNode, useId, useMemo } from "react";
import { cn } from "../../components/ui/cn";
import { useT } from "../../i18n";
import type { Formatters } from "../../lib/format";
import { AuditLine } from "../forms/audit-line";
import { useSyncedDraft } from "../forms/draft";
import { controlClass, Field } from "../forms/field";
import { SaveBar } from "../forms/save-bar";
import {
	RetrySave,
	type SaveOutcome,
	saveStatusOf,
} from "../forms/save-outcome";
import type { KindOverrideChange, PaymentMethodEntry } from "../source";
import {
	isPaymentKind,
	KIND_LABEL_KEYS,
	KIND_OPTIONS,
	type KindDraft,
	kindChangesOf,
	methodEntryKeyOf,
	methodGroupsOf,
	savedKindDraftOf,
} from "./payment-kinds";

export interface PaymentKindsFormProps {
	readonly entries: readonly PaymentMethodEntry[];
	readonly formatters: Formatters;
	readonly timeZone: string;
	readonly canWrite: boolean;
	readonly saving: boolean;
	readonly outcome: SaveOutcome;
	readonly onSave: (changes: readonly KindOverrideChange[]) => void;
	readonly onRetry: () => void;
	readonly onEdit: () => void;
}

const FOLLOW_POS = "";

interface MethodRowProps {
	readonly entry: PaymentMethodEntry;
	readonly chosen: PaymentKind | null;
	readonly formatters: Formatters;
	readonly timeZone: string;
	readonly readOnly: boolean;
	readonly onChange: (kind: PaymentKind | null) => void;
}

function MethodRow({
	entry,
	chosen,
	formatters,
	timeZone,
	readOnly,
	onChange,
}: MethodRowProps) {
	const t = useT();
	const id = `payment-kind-${methodEntryKeyOf(entry).replace(/[^A-Za-z0-9_-]/g, "-")}`;
	const followPos = t("settings.mapping.followPos");
	const hint = t("settings.mapping.kinds.state", {
		pos: t(KIND_LABEL_KEYS[entry.posKind]),
		kind: t(KIND_LABEL_KEYS[entry.kind]),
	});
	return (
		<li
			className="border-b border-line py-3 last:border-b-0"
			data-testid="payment-kind-row"
			data-method={entry.externalId}
		>
			<Field id={id} label={entry.name} hint={hint} readOnly={readOnly}>
				{(control) =>
					readOnly ? (
						<input
							{...control}
							type="text"
							value={chosen === null ? followPos : t(KIND_LABEL_KEYS[chosen])}
							className={cn(controlClass, "sm:max-w-56")}
							data-testid="payment-kind-select"
						/>
					) : (
						<select
							id={control.id}
							aria-describedby={control["aria-describedby"]}
							value={chosen ?? FOLLOW_POS}
							onChange={(event) => {
								const value = event.target.value;
								onChange(isPaymentKind(value) ? value : null);
							}}
							className={cn(controlClass, "sm:max-w-56")}
							data-testid="payment-kind-select"
						>
							<option value={FOLLOW_POS}>{followPos}</option>
							{KIND_OPTIONS.map((kind) => (
								<option key={kind} value={kind}>
									{t(KIND_LABEL_KEYS[kind])}
								</option>
							))}
						</select>
					)
				}
			</Field>
			{entry.audit === null ? null : (
				<AuditLine
					entry={entry.audit}
					formatters={formatters}
					timeZone={timeZone}
				/>
			)}
		</li>
	);
}

function AccountSection({
	name,
	children,
}: {
	readonly name: string;
	readonly children: ReactNode;
}) {
	const headingId = useId();
	return (
		<section
			aria-labelledby={headingId}
			className="rounded-xl border border-line bg-surface-raised px-4 py-1"
			data-testid="payment-kinds-account"
		>
			<h3 id={headingId} className="pt-3 text-base font-semibold">
				{name}
			</h3>
			{children}
		</section>
	);
}

export function PaymentKindsForm({
	entries,
	formatters,
	timeZone,
	canWrite,
	saving,
	outcome,
	onSave,
	onRetry,
	onEdit,
}: PaymentKindsFormProps) {
	const t = useT();
	const saved = useMemo(() => savedKindDraftOf(entries), [entries]);
	const [draft, setDraft] = useSyncedDraft(saved);
	const groups = useMemo(() => methodGroupsOf(entries), [entries]);
	const changes = kindChangesOf(entries, draft);
	const edit = (next: KindDraft) => {
		setDraft(next);
		onEdit();
	};
	if (entries.length === 0) {
		return (
			<p className="text-ink-muted" data-testid="payment-kinds-empty">
				{t("settings.mapping.kinds.empty")}
			</p>
		);
	}
	return (
		<div className="space-y-4" data-testid="payment-kinds-form">
			<p className="text-sm text-ink-muted">
				{t("settings.mapping.kinds.intro")}
			</p>
			<p
				role="note"
				className="rounded-lg border border-line bg-surface-sunken px-3 py-2 text-sm"
				data-testid="payment-kinds-drawer-note"
			>
				{t("settings.mapping.kinds.drawerNote")}
			</p>
			{groups.map((group) => (
				<AccountSection key={group.posAccountId} name={group.posAccountName}>
					<ul>
						{group.entries.map((entry) => {
							const key = methodEntryKeyOf(entry);
							return (
								<MethodRow
									key={key}
									entry={entry}
									chosen={draft[key] ?? null}
									formatters={formatters}
									timeZone={timeZone}
									readOnly={!canWrite}
									onChange={(kind) => {
										if (!saving) edit({ ...draft, [key]: kind });
									}}
								/>
							);
						})}
					</ul>
				</AccountSection>
			))}
			{canWrite ? (
				<>
					<SaveBar
						pendingCount={changes.length}
						canSave
						saving={saving}
						onSave={() => onSave(changes)}
						onCancel={() => edit(saved)}
						status={saveStatusOf(t, outcome, changes.length)}
					/>
					<RetrySave outcome={outcome} saving={saving} onRetry={onRetry} />
				</>
			) : null}
		</div>
	);
}
