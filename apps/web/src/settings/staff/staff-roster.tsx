import { useEffect, useId, useRef, useState } from "react";
import { Button } from "../../components/ui/button";
import { cn } from "../../components/ui/cn";
import { type MessageKey, type Translate, useLanguage, useT } from "../../i18n";
import { todayIn } from "../../lib/business-dates";
import type { Formatters } from "../../lib/format";
import { useFormatters } from "../../state/formatters";
import { useReadyTenantScope } from "../../state/tenant-scope";
import { staffRowAccess } from "../access";
import { AuditLine } from "../forms/audit-line";
import type { SaveBarStatus } from "../forms/save-bar";
import { UNAVAILABLE_CLASS } from "../forms/save-bar";
import {
	useMembership,
	useStaffApps,
	useStaffRoster,
	useStoreProfiles,
} from "../queries";
import { ReadOnlyNotice } from "../read-only-notice";
import { SectionLoadState, useSectionLoad } from "../section-load";
import { useSettingsSourceState } from "../settings-source-context";
import { type StoreProfile, writeCodeOf } from "../source";
import {
	type SettingsWrite,
	useSettingsMutation,
	WRITE_ERROR_KEYS,
} from "../use-settings-mutation";
import { PairingCodePanel } from "./pairing-code";
import type { PairingCode, StaffApp, StaffChange, StaffMember } from "./source";
import { BrandsFact } from "./staff-brands";
import { StaffForm } from "./staff-form";
import {
	rosterInOrder,
	STAFF_ROLE_KEYS,
	STAFF_STATUS_KEYS,
	type StaffStoreChoices,
	staffErrorKey,
	staffStoreChoices,
	storeNamesOf,
} from "./staff-rules";

type Editor =
	| { readonly mode: "add" }
	| { readonly mode: "edit"; readonly id: string }
	| null;

type RosterAction =
	| { readonly kind: "add"; readonly change: StaffChange }
	| {
			readonly kind: "update";
			readonly member: StaffMember;
			readonly change: StaffChange;
	  }
	| { readonly kind: "deactivate"; readonly member: StaffMember }
	| { readonly kind: "reactivate"; readonly member: StaffMember };

type Pairing =
	| { readonly rosterId: string; readonly kind: "issuing" }
	| {
			readonly rosterId: string;
			readonly kind: "shown";
			readonly issued: PairingCode;
	  }
	| {
			readonly rosterId: string;
			readonly kind: "refused";
			readonly errorKey: MessageKey;
	  }
	| null;

interface UpdateArgs {
	readonly id: string;
	readonly change: StaffChange;
}

const writeAdd: SettingsWrite<StaffChange> = (
	_source,
	tenantId,
	change,
	_manual,
	staff,
) => staff.addStaff(tenantId, change);

const writeUpdate: SettingsWrite<UpdateArgs> = (
	_source,
	tenantId,
	args,
	_manual,
	staff,
) => staff.updateStaff(tenantId, args.id, args.change);

const writeDeactivate: SettingsWrite<string> = (
	_source,
	tenantId,
	id,
	_manual,
	staff,
) => staff.deactivateStaff(tenantId, id);

const writeReactivate: SettingsWrite<string> = (
	_source,
	tenantId,
	id,
	_manual,
	staff,
) => staff.reactivateStaff(tenantId, id);

const STATUS_TONES: Readonly<Record<SaveBarStatus["tone"], string>> = {
	info: "text-ink-muted",
	success: "text-positive",
	error: "text-negative",
};

interface MutationState {
	readonly saving: boolean;
	readonly saved: boolean;
	readonly errorCode: ReturnType<typeof writeCodeOf> | null;
	readonly errorKey: MessageKey | null;
	readonly canRetry: boolean;
}

function doneText(t: Translate, action: RosterAction): string {
	switch (action.kind) {
		case "add":
			return t("settings.staff.done.added", {
				name: action.change.displayName,
			});
		case "update":
			return t("settings.staff.done.updated", {
				name: action.change.displayName,
			});
		case "deactivate":
			return t("settings.staff.done.deactivated", {
				name: action.member.displayName,
			});
		default:
			return t("settings.staff.done.reactivated", {
				name: action.member.displayName,
			});
	}
}

function actionStatus(
	t: Translate,
	action: RosterAction,
	state: MutationState,
): SaveBarStatus | null {
	if (state.saving) return { tone: "info", text: t("settings.saving") };
	const errorKey = staffErrorKey(action.kind, state.errorCode, state.errorKey);
	if (errorKey !== null) return { tone: "error", text: t(errorKey) };
	return state.saved ? { tone: "success", text: doneText(t, action) } : null;
}

function dayOf(formatters: Formatters, timeZone: string, instant: string) {
	return formatters.date(todayIn(timeZone, new Date(instant)));
}

function storesText(
	t: Translate,
	storeIds: readonly string[] | null,
	profiles: readonly StoreProfile[],
): string {
	const names = storeNamesOf(storeIds, profiles);
	if (names.all) return t("settings.staff.stores.all");
	const others =
		names.others > 0
			? [t("settings.staff.stores.others", { count: names.others })]
			: [];
	return [...names.names, ...others].join(", ");
}

function ConfirmDeactivate({
	member,
	onConfirm,
	onCancel,
}: {
	readonly member: StaffMember;
	readonly onConfirm: () => void;
	readonly onCancel: () => void;
}) {
	const t = useT();
	const confirmRef = useRef<HTMLButtonElement | null>(null);
	useEffect(() => {
		confirmRef.current?.focus();
	}, []);
	return (
		<fieldset
			className="min-w-0 rounded-lg border border-warning bg-warning-soft p-3"
			data-testid="staff-confirm"
			onKeyDown={(event) => {
				if (event.key === "Escape") onCancel();
			}}
		>
			<legend className="float-left w-full text-sm">
				{t("settings.staff.confirm.deactivate", { name: member.displayName })}
			</legend>
			<div className="clear-left flex flex-wrap gap-2 pt-2">
				<Button
					ref={confirmRef}
					size="compact"
					onClick={onConfirm}
					data-testid="staff-confirm-yes"
				>
					{t("settings.staff.confirm.yes")}
				</Button>
				<Button
					tone="secondary"
					size="compact"
					onClick={onCancel}
					data-testid="staff-confirm-no"
				>
					{t("settings.staff.confirm.back")}
				</Button>
			</div>
		</fieldset>
	);
}

function MemberFacts({
	member,
	profiles,
	apps,
	formatters,
	timeZone,
}: {
	readonly member: StaffMember;
	readonly profiles: readonly StoreProfile[];
	readonly apps: readonly StaffApp[] | undefined;
	readonly formatters: Formatters;
	readonly timeZone: string;
}) {
	const t = useT();
	const status =
		member.status === "inactive" && member.deactivatedAt !== null
			? t("settings.staff.status.inactiveSince", {
					date: dayOf(formatters, timeZone, member.deactivatedAt),
				})
			: t(STAFF_STATUS_KEYS[member.status]);
	const pairing =
		member.paired && member.pairedAt !== null
			? t("settings.staff.pairing.paired", {
					date: dayOf(formatters, timeZone, member.pairedAt),
				})
			: t("settings.staff.pairing.unpaired");
	return (
		<dl className="grid grid-cols-[max-content_minmax(0,1fr)] gap-x-3 gap-y-0.5 text-sm">
			<dt className="text-ink-muted">{t("settings.staff.field.role")}</dt>
			<dd data-testid="staff-role">{t(STAFF_ROLE_KEYS[member.role])}</dd>
			<dt className="text-ink-muted">{t("settings.staff.field.stores")}</dt>
			<dd className="break-words" data-testid="staff-stores">
				{storesText(t, member.storeIds, profiles)}
			</dd>
			<BrandsFact member={member} apps={apps} />
			<dt className="text-ink-muted">{t("settings.staff.field.status")}</dt>
			<dd data-testid="staff-status">{status}</dd>
			<dt className="text-ink-muted">{t("settings.staff.field.pairing")}</dt>
			<dd data-testid="staff-pairing">{pairing}</dd>
			<dt className="text-ink-muted">{t("settings.staff.field.phone")}</dt>
			<dd data-testid="staff-phone">
				{member.phoneHint ?? t("settings.staff.phone.none")}
			</dd>
		</dl>
	);
}

interface RowProps {
	readonly member: StaffMember;
	readonly profiles: readonly StoreProfile[];
	readonly apps: readonly StaffApp[] | undefined;
	readonly formatters: Formatters;
	readonly timeZone: string;
	readonly membership: Parameters<typeof staffRowAccess>[0];
	readonly choices: StaffStoreChoices;
	readonly busy: boolean;
	readonly editing: boolean;
	readonly confirming: boolean;
	readonly pairing: Pairing;
	readonly formStatus: SaveBarStatus | null;
	readonly onFormRetry: (() => void) | null;
	readonly onEdit: (opener: HTMLElement) => void;
	readonly onSubmit: (change: StaffChange) => void;
	readonly onFormEdit: () => void;
	readonly onCloseForm: () => void;
	readonly onAskDeactivate: (opener: HTMLElement) => void;
	readonly onDeactivate: () => void;
	readonly onCancelDeactivate: () => void;
	readonly onReactivate: () => void;
	readonly onIssue: () => void;
	readonly onClosePairing: () => void;
}

function StaffRow({
	member,
	profiles,
	apps,
	formatters,
	timeZone,
	membership,
	choices,
	busy,
	editing,
	confirming,
	pairing,
	formStatus,
	onFormRetry,
	onEdit,
	onSubmit,
	onFormEdit,
	onCloseForm,
	onAskDeactivate,
	onDeactivate,
	onCancelDeactivate,
	onReactivate,
	onIssue,
	onClosePairing,
}: RowProps) {
	const t = useT();
	const access = staffRowAccess(membership, member.storeIds);
	const inactive = member.status === "inactive";
	const name = member.displayName;
	const issuing = pairing?.kind === "issuing";
	return (
		<li
			className="space-y-3 py-3"
			data-testid="staff-row"
			data-staff-id={member.id}
			data-status={member.status}
		>
			<div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
				<div className="min-w-0 flex-1 basis-56 space-y-1">
					<p className="break-words font-medium" data-testid="staff-name">
						{name}
					</p>
					<MemberFacts
						member={member}
						profiles={profiles}
						apps={apps}
						formatters={formatters}
						timeZone={timeZone}
					/>
					{member.audit === null ? null : (
						<AuditLine
							entry={member.audit}
							formatters={formatters}
							timeZone={timeZone}
						/>
					)}
				</div>
				{access.canWrite ? (
					<div className="flex flex-wrap gap-2">
						<Button
							tone="secondary"
							size="compact"
							aria-label={t("settings.staff.action.editLabel", { name })}
							aria-disabled={busy || undefined}
							onClick={(event) => {
								if (!busy) onEdit(event.currentTarget);
							}}
							className={UNAVAILABLE_CLASS}
							data-testid="staff-edit"
						>
							{t("settings.staff.action.edit")}
						</Button>
						{inactive ? null : (
							<Button
								tone="secondary"
								size="compact"
								aria-label={t("settings.staff.action.pairLabel", { name })}
								aria-disabled={busy || issuing || undefined}
								aria-busy={issuing || undefined}
								onClick={busy || issuing ? undefined : onIssue}
								className={UNAVAILABLE_CLASS}
								data-testid="staff-pair"
							>
								{t("settings.staff.action.pair")}
							</Button>
						)}
						{inactive ? (
							<Button
								tone="secondary"
								size="compact"
								aria-label={t("settings.staff.action.reactivateLabel", {
									name,
								})}
								aria-disabled={busy || undefined}
								onClick={busy ? undefined : onReactivate}
								className={UNAVAILABLE_CLASS}
								data-testid="staff-reactivate"
							>
								{t("settings.staff.action.reactivate")}
							</Button>
						) : (
							<Button
								tone="secondary"
								size="compact"
								aria-label={t("settings.staff.action.deactivateLabel", {
									name,
								})}
								aria-disabled={busy || confirming || undefined}
								onClick={(event) => {
									if (!busy && !confirming)
										onAskDeactivate(event.currentTarget);
								}}
								className={UNAVAILABLE_CLASS}
								data-testid="staff-deactivate"
							>
								{t("settings.staff.action.deactivate")}
							</Button>
						)}
					</div>
				) : null}
			</div>
			{access.canWrite ? null : (
				<ReadOnlyNotice
					access={access}
					messages={{ scope: "settings.staff.rowReadOnly" }}
					testId="staff-row-read-only"
				/>
			)}
			{confirming ? (
				<ConfirmDeactivate
					member={member}
					onConfirm={onDeactivate}
					onCancel={onCancelDeactivate}
				/>
			) : null}
			{pairing === null ? null : pairing.kind === "issuing" ? (
				<p role="status" className="text-sm" data-testid="pairing-issuing">
					{t("settings.staff.pairing.issuing")}
				</p>
			) : pairing.kind === "refused" ? (
				<p
					role="status"
					className="text-sm text-negative"
					data-testid="pairing-refused"
				>
					{t(pairing.errorKey)}
				</p>
			) : (
				<PairingCodePanel
					issued={pairing.issued}
					memberName={name}
					onClose={onClosePairing}
				/>
			)}
			{editing ? (
				<StaffForm
					member={member}
					choices={choices}
					busy={busy}
					status={formStatus}
					onRetry={onFormRetry}
					onSubmit={onSubmit}
					onEdit={onFormEdit}
					onClose={onCloseForm}
				/>
			) : null}
		</li>
	);
}

function focusSoon(target: () => HTMLElement | null) {
	window.requestAnimationFrame(() => {
		const element = target();
		if (element?.isConnected) element.focus();
	});
}

export function StaffRoster() {
	const t = useT();
	const { language } = useLanguage();
	const ids = useId();
	const { tenant } = useReadyTenantScope();
	const formatters = useFormatters(tenant);
	const sourceState = useSettingsSourceState();
	const roster = useStaffRoster();
	const profiles = useStoreProfiles();
	const staffApps = useStaffApps();
	const membership = useMembership();
	const load = useSectionLoad([roster, profiles]);
	const member = membership.status === "success" ? membership.data : undefined;
	const choices = staffStoreChoices(member, profiles.data ?? []);
	const add = useSettingsMutation(writeAdd);
	const update = useSettingsMutation(writeUpdate);
	const deactivate = useSettingsMutation(writeDeactivate);
	const reactivate = useSettingsMutation(writeReactivate);
	const [editor, setEditor] = useState<Editor>(null);
	const [confirmingId, setConfirmingId] = useState<string | null>(null);
	const [action, setAction] = useState<RosterAction | null>(null);
	const [pairing, setPairing] = useState<Pairing>(null);
	const opener = useRef<HTMLElement | null>(null);
	const addButton = useRef<HTMLButtonElement | null>(null);
	const headingRef = useRef<HTMLHeadingElement | null>(null);
	const staffSource = sourceState.status === "ready" ? sourceState.staff : null;
	const busy =
		add.saving || update.saving || deactivate.saving || reactivate.saving;
	const mutationOf = (kind: RosterAction["kind"]) =>
		kind === "add"
			? add
			: kind === "update"
				? update
				: kind === "deactivate"
					? deactivate
					: reactivate;
	const current = action === null ? null : mutationOf(action.kind);
	const status =
		action === null || current === null
			? null
			: actionStatus(t, action, current);
	const formOwnsStatus =
		editor !== null &&
		action !== null &&
		(action.kind === "add" || action.kind === "update") &&
		!(current?.saved ?? false);
	const listStatus = formOwnsStatus ? null : status;
	const formStatus = formOwnsStatus ? status : null;
	const resetAll = () => {
		for (const mutation of [add, update, deactivate, reactivate]) {
			if (!mutation.saving) mutation.reset();
		}
		setAction(null);
	};
	const focusHeadingIfLost = () => {
		window.requestAnimationFrame(() => {
			const active = document.activeElement;
			if (active === null || active === document.body) {
				headingRef.current?.focus();
			}
		});
	};
	const focusOpener = (mode: "add" | "edit") =>
		focusSoon(() => (mode === "add" ? addButton.current : opener.current));
	const closeForm = () => {
		if (editor === null) return;
		resetAll();
		setEditor(null);
		focusOpener(editor.mode);
	};
	const openAdd = () => {
		resetAll();
		setConfirmingId(null);
		setEditor({ mode: "add" });
	};
	const openEdit = (row: StaffMember, from: HTMLElement) => {
		resetAll();
		setConfirmingId(null);
		opener.current = from;
		setEditor({ mode: "edit", id: row.id });
	};
	const submit = (change: StaffChange) => {
		if (editor === null) return;
		if (editor.mode === "add") {
			const next: RosterAction = { kind: "add", change };
			setAction(next);
			void add.save(change).then((ok) => {
				if (!ok) return;
				setEditor(null);
				focusOpener("add");
			});
			return;
		}
		const row = roster.data?.find((candidate) => candidate.id === editor.id);
		if (row === undefined) return;
		setAction({ kind: "update", member: row, change });
		void update.save({ id: row.id, change }).then((ok) => {
			if (!ok) return;
			setEditor(null);
			focusOpener("edit");
		});
	};
	const retryForm = () => {
		if (action === null) return;
		if (action.kind === "add") {
			void add.retry().then((ok) => {
				if (!ok) return;
				setEditor(null);
				focusOpener("add");
			});
			return;
		}
		if (action.kind === "update") {
			void update.retry().then((ok) => {
				if (!ok) return;
				setEditor(null);
				focusOpener("edit");
			});
		}
	};
	const runRowAction = (
		kind: "deactivate" | "reactivate",
		row: StaffMember,
	) => {
		resetAll();
		setConfirmingId(null);
		setEditor(null);
		setPairing((shown) => (shown?.rosterId === row.id ? null : shown));
		setAction({ kind, member: row });
		const mutation = kind === "deactivate" ? deactivate : reactivate;
		void mutation.save(row.id).then(focusHeadingIfLost);
	};
	const retryList = () => {
		if (action === null) return;
		if (action.kind === "deactivate" || action.kind === "reactivate") {
			void mutationOf(action.kind).retry().then(focusHeadingIfLost);
		}
	};
	const issue = (row: StaffMember) => {
		if (staffSource === null) return;
		setPairing({ rosterId: row.id, kind: "issuing" });
		staffSource.issuePairingCode(tenant.id, row.id).then(
			(issued) =>
				setPairing((shown) =>
					shown?.rosterId === row.id
						? { rosterId: row.id, kind: "shown", issued }
						: shown,
				),
			(error: unknown) => {
				const code = writeCodeOf(error);
				setPairing((shown) =>
					shown?.rosterId === row.id
						? {
								rosterId: row.id,
								kind: "refused",
								errorKey:
									staffErrorKey("pairing", code, WRITE_ERROR_KEYS[code]) ??
									WRITE_ERROR_KEYS[code],
							}
						: shown,
				);
			},
		);
	};
	const rows =
		roster.data === undefined
			? undefined
			: rosterInOrder(roster.data, language);
	const listRetry =
		!formOwnsStatus &&
		current?.canRetry === true &&
		(action?.kind === "deactivate" || action?.kind === "reactivate")
			? retryList
			: null;
	return (
		<section
			aria-labelledby={`${ids}-title`}
			className="min-w-0 space-y-3 rounded-xl border border-line bg-surface-raised px-4 py-3 print:hidden"
			data-testid="staff-roster"
		>
			<h3
				ref={headingRef}
				id={`${ids}-title`}
				tabIndex={-1}
				className="text-base font-semibold"
			>
				{t("settings.staff.roster.title")}
			</h3>
			<p className="text-sm text-ink-muted" data-testid="staff-roster-note">
				{t("settings.staff.roster.note")}
			</p>
			{rows === undefined || profiles.data === undefined ? (
				<SectionLoadState load={load} failedTestId="staff-roster-load-failed" />
			) : rows.length === 0 ? (
				<p className="text-ink-muted" data-testid="staff-roster-empty">
					{t("settings.staff.roster.empty")}
				</p>
			) : (
				<ul className="divide-y divide-line" data-testid="staff-roster-list">
					{rows.map((row) => (
						<StaffRow
							key={row.id}
							member={row}
							profiles={profiles.data}
							apps={staffApps.data}
							formatters={formatters}
							timeZone={tenant.timeZone}
							membership={member}
							choices={choices}
							busy={busy}
							editing={editor?.mode === "edit" && editor.id === row.id}
							confirming={confirmingId === row.id}
							pairing={pairing?.rosterId === row.id ? pairing : null}
							formStatus={formStatus}
							onFormRetry={
								formOwnsStatus && current?.canRetry === true ? retryForm : null
							}
							onEdit={(from) => openEdit(row, from)}
							onSubmit={submit}
							onFormEdit={() => {
								if (action !== null && !busy) resetAll();
							}}
							onCloseForm={closeForm}
							onAskDeactivate={(from) => {
								resetAll();
								setEditor(null);
								opener.current = from;
								setConfirmingId(row.id);
							}}
							onDeactivate={() => runRowAction("deactivate", row)}
							onCancelDeactivate={() => {
								setConfirmingId(null);
								focusOpener("edit");
							}}
							onReactivate={() => runRowAction("reactivate", row)}
							onIssue={() => issue(row)}
							onClosePairing={() => setPairing(null)}
						/>
					))}
				</ul>
			)}
			<div className="flex flex-wrap items-center gap-2">
				<p
					role="status"
					className={cn(
						"text-sm",
						listStatus ? STATUS_TONES[listStatus.tone] : null,
					)}
					data-testid="staff-roster-status"
				>
					{listStatus?.text ?? ""}
				</p>
				{listRetry === null ? null : (
					<Button
						tone="secondary"
						size="compact"
						aria-disabled={busy || undefined}
						onClick={busy ? undefined : listRetry}
						data-testid="settings-retry-save"
					>
						{t("app.retry")}
					</Button>
				)}
			</div>
			{editor?.mode === "add" ? (
				<StaffForm
					member={null}
					choices={choices}
					busy={busy}
					status={formStatus}
					onRetry={
						formOwnsStatus && current?.canRetry === true ? retryForm : null
					}
					onSubmit={submit}
					onEdit={() => {
						if (action !== null && !busy) resetAll();
					}}
					onClose={closeForm}
				/>
			) : rows === undefined || profiles.data === undefined ? null : (
				<Button
					ref={addButton}
					size="compact"
					aria-disabled={busy || undefined}
					onClick={busy ? undefined : openAdd}
					className={UNAVAILABLE_CLASS}
					data-testid="staff-add"
				>
					{t("settings.staff.action.add")}
				</Button>
			)}
		</section>
	);
}
