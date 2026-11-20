import { useId, useState } from "react";
import { Button } from "../../components/ui/button";
import { cn } from "../../components/ui/cn";
import { type MessageKey, useT } from "../../i18n";
import { todayIn } from "../../lib/business-dates";
import { downloadTextFile } from "../../lib/csv";
import { useLoyaltyAction } from "../../loyalty/queries";
import { privacyAccess } from "../../privacy/access";
import { ActionDone, ActionError } from "../../privacy/action-notice";
import { useDueSoon, useRequests } from "../../privacy/queries";
import {
	DEADLINE_TONES,
	type Deadline,
	deadlineOf,
} from "../../privacy/request-deadline";
import { REQUEST_TYPE_KEYS, RequestForm } from "../../privacy/request-form";
import { checkName } from "../../privacy/request-rules";
import {
	type DataRequestRow,
	DELETION_TABLES,
	type DeletionPreview,
	type DeletionResult,
	DUE_SOON_DAYS,
	EXPORT_TABLES,
	type NewRequest,
	PREVIEW_TABLES,
	type RequestStatus,
} from "../../privacy/source";
import { controlClass, Field } from "../../settings/forms/field";
import { useMembership } from "../../settings/queries";
import { useFormatters } from "../../state/formatters";
import { useReadyTenantScope } from "../../state/tenant-scope";
import { CustomersLayout, Notice } from "./customers-layout";

const STATUS_KEYS: Readonly<Record<RequestStatus, MessageKey>> = {
	received: "loyalty.privacy.status.received",
	in_progress: "loyalty.privacy.status.in_progress",
	completed: "loyalty.privacy.status.completed",
	rejected: "loyalty.privacy.status.rejected",
};

const TABLE_KEYS: Readonly<Record<string, MessageKey>> = {
	memberships: "loyalty.privacy.table.memberships",
	loyalty_ledger: "loyalty.privacy.table.loyalty_ledger",
	stamps: "loyalty.privacy.table.stamps",
	redemptions: "loyalty.privacy.table.redemptions",
	receipt_claims: "loyalty.privacy.table.receipt_claims",
	consent_records: "loyalty.privacy.table.consent_records",
	outbound_messages: "loyalty.privacy.table.outbound_messages",
	invoices_unlinked: "loyalty.privacy.table.invoices_unlinked",
	pending_checkins: "loyalty.privacy.table.pending_checkins",
	loyalty_queue: "loyalty.privacy.table.loyalty_queue",
	loyalty_refusals: "loyalty.privacy.table.loyalty_refusals",
	loyalty_requests: "loyalty.privacy.table.loyalty_requests",
	coupon_codes_quarantined: "loyalty.privacy.table.coupon_codes_quarantined",
	redemption_invoices_settled:
		"loyalty.privacy.table.redemption_invoices_settled",
	outbound_messages_redacted:
		"loyalty.privacy.table.outbound_messages_redacted",
	customer_logins: "loyalty.privacy.table.customer_logins",
	auth_users: "loyalty.privacy.table.auth_users",
	customers: "loyalty.privacy.table.customers",
};

const OPEN: readonly RequestStatus[] = ["received", "in_progress"];

function DeadlineBadge({
	label,
	deadline,
	testId,
}: {
	readonly label: string;
	readonly deadline: Deadline;
	readonly testId: string;
}) {
	const t = useT();
	const text =
		deadline.state === "done"
			? t("loyalty.privacy.deadline.done")
			: deadline.state === "overdue"
				? t("loyalty.privacy.deadline.overdue", {
						days: Math.max(1, -deadline.daysLeft),
					})
				: deadline.daysLeft <= 0
					? t("loyalty.privacy.deadline.today")
					: t("loyalty.privacy.deadline.left", { days: deadline.daysLeft });
	return (
		<span
			className={cn(
				"inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-xs font-medium",
				DEADLINE_TONES[deadline.state],
			)}
			data-testid={testId}
			data-state={deadline.state}
		>
			{label}: {text}
		</span>
	);
}

function CountList({
	counts,
	tables,
	testId,
}: {
	readonly counts: Readonly<Record<string, number>>;
	readonly tables: readonly string[];
	readonly testId: string;
}) {
	const t = useT();
	return (
		<ul className="list-disc pl-5 text-sm" data-testid={testId}>
			{tables.map((table) => (
				<li key={table} data-table={table}>
					{t("loyalty.privacy.action.deleteCount", {
						label: t(TABLE_KEYS[table] ?? "loyalty.privacy.error.other"),
						count: counts[table] ?? 0,
					})}
				</li>
			))}
		</ul>
	);
}

function ExportAction({ request }: { readonly request: DataRequestRow }) {
	const t = useT();
	const [rows, setRows] = useState<number | null>(null);
	const exporter = useLoyaltyAction((source, requestId: string) =>
		source.privacy.exportSubject(requestId),
	);
	return (
		<div className="space-y-1">
			<Button
				tone="secondary"
				size="compact"
				disabled={exporter.running}
				onClick={() => {
					setRows(null);
					void exporter.run(request.id).then((done) => {
						if (done === null) return;
						downloadTextFile(
							`yeu-cau-${request.id.slice(0, 8)}-du-lieu.json`,
							done.json,
							"application/json",
						);
						setRows(
							EXPORT_TABLES.reduce((sum, table) => sum + done.counts[table], 0),
						);
					});
				}}
				data-testid="privacy-export"
			>
				{t("loyalty.privacy.action.export")}
			</Button>
			<ActionError code={exporter.errorCode} testId="privacy-export-error" />
			<ActionDone
				testId="privacy-export-done"
				message={
					rows === null
						? null
						: t("loyalty.privacy.action.exported", { count: rows })
				}
			/>
		</div>
	);
}

function CorrectAction({ request }: { readonly request: DataRequestRow }) {
	const t = useT();
	const ids = useId();
	const [name, setName] = useState("");
	const [issue, setIssue] = useState<ReturnType<typeof checkName>>(null);
	const [message, setMessage] = useState<string | null>(null);
	const correct = useLoyaltyAction((source, value: string) =>
		source.privacy.correctName(request.id, value),
	);
	return (
		<form
			className="space-y-2"
			data-testid="privacy-correct"
			onSubmit={(event) => {
				event.preventDefault();
				setMessage(null);
				const found = checkName(name);
				setIssue(found);
				if (found !== null) return;
				void correct.run(name.trim()).then((done) => {
					if (done === null) return;
					setMessage(
						t(
							done.changed
								? "loyalty.privacy.action.corrected"
								: "loyalty.privacy.action.unchanged",
						),
					);
				});
			}}
		>
			<Field
				id={`${ids}-name`}
				label={t("loyalty.privacy.action.correctLabel")}
				hint={t("loyalty.privacy.action.correctHint")}
				error={
					issue === null
						? null
						: t(`loyalty.privacy.action.nameIssue.${issue}` as const)
				}
			>
				{(control) => (
					<input
						{...control}
						type="text"
						autoComplete="off"
						className={controlClass}
						value={name}
						onChange={(event) => setName(event.target.value)}
						data-testid="privacy-correct-input"
					/>
				)}
			</Field>
			<Button
				type="submit"
				tone="secondary"
				size="compact"
				disabled={correct.running}
				data-testid="privacy-correct-save"
			>
				{t("loyalty.privacy.action.correctSave")}
			</Button>
			<ActionError code={correct.errorCode} testId="privacy-correct-error" />
			<ActionDone testId="privacy-correct-done" message={message} />
		</form>
	);
}

function DeletionSummary({ result }: { readonly result: DeletionResult }) {
	const t = useT();
	const yesNo = (value: boolean) =>
		t(value ? "loyalty.privacy.action.yes" : "loyalty.privacy.action.no");
	return (
		<div className="space-y-1" data-testid="privacy-deleted">
			<p role="status" className="text-sm">
				{t("loyalty.privacy.action.deleted")}
			</p>
			<CountList
				counts={result.counts}
				tables={DELETION_TABLES}
				testId="privacy-deleted-counts"
			/>
			<p className="text-sm text-ink-muted">
				{t("loyalty.privacy.action.deletedOnTime", {
					response: yesNo(result.respondedOnTime),
					completion: yesNo(result.completedOnTime),
				})}
			</p>
		</div>
	);
}

function DeleteAction({
	request,
	result,
	onResult,
}: {
	readonly request: DataRequestRow;
	readonly result: DeletionResult | null;
	readonly onResult: (result: DeletionResult) => void;
}) {
	const t = useT();
	const [preview, setPreview] = useState<DeletionPreview | null>(null);
	const previewing = useLoyaltyAction((source, requestId: string) =>
		source.privacy.deletionPreview(requestId),
	);
	const deleting = useLoyaltyAction((source, requestId: string) =>
		source.privacy.deleteSubject(requestId),
	);
	return (
		<div className="space-y-2" data-testid="privacy-delete">
			{preview === null && result === null ? (
				<Button
					tone="warning"
					size="compact"
					disabled={previewing.running}
					onClick={() => {
						void previewing.run(request.id).then((counts) => {
							if (counts !== null) setPreview(counts);
						});
					}}
					data-testid="privacy-delete-start"
				>
					{t("loyalty.privacy.action.delete")}
				</Button>
			) : null}
			<ActionError code={previewing.errorCode} testId="privacy-preview-error" />
			{preview !== null && result === null ? (
				<fieldset
					className="min-w-0 rounded-lg border border-warning bg-warning-soft p-3"
					data-testid="privacy-delete-confirm"
				>
					<legend className="float-left w-full text-sm">
						{t("loyalty.privacy.action.deleteConfirm")}
					</legend>
					<div className="clear-left space-y-2 pt-2">
						<CountList
							counts={preview}
							tables={PREVIEW_TABLES}
							testId="privacy-delete-counts"
						/>
						<div className="flex flex-wrap gap-2">
							<Button
								size="compact"
								disabled={deleting.running}
								onClick={() => {
									void deleting.run(request.id).then((done) => {
										if (done !== null) onResult(done);
									});
								}}
								data-testid="privacy-delete-yes"
							>
								{t("loyalty.privacy.action.deleteYes")}
							</Button>
							<Button
								tone="secondary"
								size="compact"
								onClick={() => setPreview(null)}
							>
								{t("loyalty.privacy.action.cancel")}
							</Button>
						</div>
					</div>
				</fieldset>
			) : null}
			<ActionError code={deleting.errorCode} testId="privacy-delete-error" />
		</div>
	);
}

function CloseAction({ request }: { readonly request: DataRequestRow }) {
	const t = useT();
	const ids = useId();
	const [notes, setNotes] = useState(request.notes ?? "");
	const [closed, setClosed] = useState(false);
	const close = useLoyaltyAction(
		(source, args: { readonly status: "completed" | "rejected" }) =>
			source.privacy.closeRequest({
				requestId: request.id,
				status: args.status,
				notes: notes.trim() === "" ? null : notes.trim(),
			}),
	);
	const run = (status: "completed" | "rejected") => {
		void close.run({ status }).then((done) => {
			if (done !== null || close.errorCode === null) setClosed(true);
		});
	};
	return (
		<div className="space-y-2" data-testid="privacy-close">
			<Field id={`${ids}-notes`} label={t("loyalty.privacy.action.closeNotes")}>
				{(control) => (
					<textarea
						{...control}
						rows={2}
						className={controlClass}
						value={notes}
						onChange={(event) => setNotes(event.target.value)}
						data-testid="privacy-close-notes"
					/>
				)}
			</Field>
			<div className="flex flex-wrap gap-2">
				<Button
					size="compact"
					disabled={close.running}
					onClick={() => run("completed")}
					data-testid="privacy-complete"
				>
					{t("loyalty.privacy.action.complete")}
				</Button>
				<Button
					tone="secondary"
					size="compact"
					disabled={close.running}
					onClick={() => run("rejected")}
					data-testid="privacy-reject"
				>
					{t("loyalty.privacy.action.reject")}
				</Button>
			</div>
			<ActionError code={close.errorCode} testId="privacy-close-error" />
			<ActionDone
				testId="privacy-close-done"
				message={
					closed && close.errorCode === null
						? t("loyalty.privacy.action.closed")
						: null
				}
			/>
		</div>
	);
}

function RequestItem({
	request,
	canDelete,
}: {
	readonly request: DataRequestRow;
	readonly canDelete: boolean;
}) {
	const t = useT();
	const { tenant } = useReadyTenantScope();
	const formatters = useFormatters(tenant);
	const [open, setOpen] = useState(false);
	const [deleted, setDeleted] = useState<DeletionResult | null>(null);
	const now = new Date();
	const isOpen = OPEN.includes(request.status);
	const linked =
		request.subjectType === "customer" && request.subjectId !== null;
	const response = deadlineOf(
		now,
		request.firstResponseDueAt,
		request.respondedAt !== null || !isOpen,
	);
	const completion = deadlineOf(
		now,
		request.completionDueAt,
		request.status === "completed" || request.status === "rejected",
	);
	return (
		<li
			className="space-y-2 py-3"
			data-testid="privacy-request"
			data-request={request.id}
			data-type={request.requestType}
			data-status={request.status}
		>
			<div className="flex flex-wrap items-center gap-x-3 gap-y-1">
				<span className="font-medium" data-testid="privacy-request-type">
					{t(REQUEST_TYPE_KEYS[request.requestType])}
				</span>
				<span className="text-sm" data-testid="privacy-request-status">
					{t(STATUS_KEYS[request.status])}
				</span>
				<span className="text-sm text-ink-muted">
					{t("loyalty.privacy.requests.received", {
						date: formatters.date(
							todayIn(tenant.timeZone, new Date(request.receivedAt)),
						),
					})}
				</span>
				{linked ? null : (
					<span className="text-sm text-ink-muted">
						{t("loyalty.privacy.requests.noCustomer")}
					</span>
				)}
			</div>
			<div className="flex flex-wrap gap-2">
				<DeadlineBadge
					label={t("loyalty.privacy.deadline.response")}
					deadline={response}
					testId="privacy-deadline-response"
				/>
				<DeadlineBadge
					label={t("loyalty.privacy.deadline.completion")}
					deadline={completion}
					testId="privacy-deadline-completion"
				/>
			</div>
			{deleted === null ? null : <DeletionSummary result={deleted} />}
			{isOpen ? (
				<div className="space-y-2">
					<Button
						tone="secondary"
						size="compact"
						aria-expanded={open}
						onClick={() => setOpen(!open)}
						data-testid="privacy-request-toggle"
					>
						{t("loyalty.privacy.action.close")}
					</Button>
					{open ? (
						<div className="space-y-3 rounded-lg border border-line p-3">
							{linked ? <ExportAction request={request} /> : null}
							{linked && request.requestType === "correction" ? (
								<CorrectAction request={request} />
							) : null}
							{linked && request.requestType === "deletion" ? (
								canDelete ? (
									<DeleteAction
										request={request}
										result={deleted}
										onResult={setDeleted}
									/>
								) : (
									<p
										className="text-sm text-ink-muted"
										data-testid="privacy-no-delete"
									>
										{t("loyalty.privacy.action.managerNoDelete")}
									</p>
								)
							) : null}
							<CloseAction request={request} />
						</div>
					) : null}
				</div>
			) : null}
		</li>
	);
}

function DueBanner({ enabled }: { readonly enabled: boolean }) {
	const t = useT();
	const due = useDueSoon(enabled);
	if (due.data === undefined) return null;
	const overdue = due.data.filter(
		(row) =>
			row.firstResponseState === "overdue" || row.completionState === "overdue",
	).length;
	const soon = due.data.length - overdue;
	return (
		<p
			role="status"
			className={cn(
				"rounded-lg border px-3 py-2 text-sm",
				overdue > 0
					? "border-negative bg-negative-soft"
					: soon > 0
						? "border-warning bg-warning-soft"
						: "border-line bg-surface-raised",
			)}
			data-testid="privacy-due-banner"
			data-overdue={overdue}
			data-soon={soon}
		>
			{due.data.length === 0
				? t("loyalty.privacy.requests.dueNone", { days: DUE_SOON_DAYS })
				: t("loyalty.privacy.requests.due", {
						overdue,
						soon,
						days: DUE_SOON_DAYS,
					})}
		</p>
	);
}

function RecordSection() {
	const t = useT();
	const { tenant } = useReadyTenantScope();
	const [recorded, setRecorded] = useState(false);
	const record = useLoyaltyAction((source, request: NewRequest) =>
		source.privacy.recordRequest(tenant.id, request),
	);
	return (
		<section
			className="space-y-3 rounded-xl border border-line bg-surface-raised p-4 print:hidden"
			data-testid="privacy-record"
		>
			<RequestForm
				subjectId={null}
				busy={record.running}
				onSubmit={(request) => {
					setRecorded(false);
					void record.run(request).then((done) => {
						if (done !== null) setRecorded(true);
					});
				}}
			/>
			<ActionError code={record.errorCode} testId="privacy-record-error" />
			<ActionDone
				testId="privacy-record-done"
				message={recorded ? t("loyalty.privacy.form.recorded") : null}
			/>
		</section>
	);
}

function RequestsSection({ canDelete }: { readonly canDelete: boolean }) {
	const t = useT();
	const requests = useRequests(true);
	return (
		<div className="space-y-4">
			<DueBanner enabled />
			<section
				className="space-y-3 rounded-xl border border-line bg-surface-raised p-4"
				data-testid="privacy-queue"
			>
				<h2 className="text-base font-semibold">
					{t("loyalty.privacy.requests.title")}
				</h2>
				{requests.isPending ? (
					<p role="status">{t("app.loading")}</p>
				) : requests.isError ? (
					<p role="alert" className="text-negative">
						{t("loyalty.privacy.requests.failed")}
					</p>
				) : requests.data.length === 0 ? (
					<p className="text-sm" data-testid="privacy-queue-none">
						{t("loyalty.privacy.requests.none")}
					</p>
				) : (
					<ul className="divide-y divide-line" data-testid="privacy-requests">
						{requests.data.map((request) => (
							<RequestItem
								key={request.id}
								request={request}
								canDelete={canDelete}
							/>
						))}
					</ul>
				)}
			</section>
			<RecordSection />
		</div>
	);
}

export function PrivacyRequestsPage() {
	const t = useT();
	const membership = useMembership();
	const access = privacyAccess(
		membership.status === "success" ? membership.data : undefined,
	);
	return (
		<CustomersLayout
			page="yeu-cau-du-lieu"
			subtitle={t("loyalty.privacy.requests.title")}
		>
			{() =>
				access.canHandle ? (
					<div className="space-y-3">
						<p className="text-sm text-ink-muted">
							{t("loyalty.privacy.requests.intro")}
						</p>
						<RequestsSection canDelete={access.canDelete} />
					</div>
				) : (
					<Notice testId="privacy-no-access">
						{t("loyalty.privacy.noAccess")}
					</Notice>
				)
			}
		</CustomersLayout>
	);
}
