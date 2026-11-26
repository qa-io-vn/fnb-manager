import { ResultModal, useI18n } from "@fnb/zalo-mini/react";
import { type FormEvent, useCallback, useId, useMemo, useState } from "react";
import { failureKey } from "../shift/env";
import type { Failure } from "../shift/model";
import {
	Alert,
	BusyLabel,
	Card,
	Chip,
	fieldClass,
	Hint,
	Loading,
	SubScreen,
} from "../shift/parts";
import { useLoad, useTeamAction, useTeamEnv } from "../team/env";
import type { TeamScreenProps } from "../team/route";
import { primaryButton, secondaryButton } from "../ui";
import {
	MAX_REFUSAL_LENGTH,
	type PendingRequest,
	type RequestDecision,
	sortQueue,
} from "./contract";
import { kindName } from "./parts";

export type RefusalProblem = "empty" | "long";

export function refusalProblem(reason: string): RefusalProblem | null {
	const text = reason.trim();
	if (text === "") return "empty";
	if (text.length > MAX_REFUSAL_LENGTH) return "long";
	return null;
}

function decideFailureKey(failure: Failure): string {
	if (failure === "state") return "approvals.error.decided";
	if (failure === "invalid") return "approvals.problem.empty";
	if (failure === "not-allowed") return "approvals.error.notAllowed";
	return failureKey(failure);
}

function RequestSummary({ request }: { readonly request: PendingRequest }) {
	const { t } = useI18n();
	const { when, storeName } = useTeamEnv();
	const store = storeName(request.storeId);
	return (
		<>
			<div className="flex flex-wrap items-center gap-2">
				<Chip tone="accent">{kindName(request)}</Chip>
				{store === null ? null : (
					<span className="text-sm text-ink-muted">{store}</span>
				)}
			</div>
			<p className="text-body font-semibold text-ink" data-testid="requester">
				{request.requesterName ?? t("approvals.unnamed")}
			</p>
			<p className="whitespace-pre-line break-words text-body text-ink">
				{request.details}
			</p>
			<p className="text-sm text-ink-muted">
				{t("ask.sentAt", when(request.requestedAt))}
			</p>
		</>
	);
}

function DecideRequest({
	request,
	onBack,
	onDone,
}: {
	readonly request: PendingRequest;
	readonly onBack: () => void;
	readonly onDone: (closed: boolean) => void;
}) {
	const { t } = useI18n();
	const { client } = useTeamEnv();
	const action = useTeamAction();
	const reasonId = useId();
	const [mode, setMode] = useState<"choose" | "refuse">("choose");
	const [reason, setReason] = useState("");
	const [problem, setProblem] = useState<RefusalProblem | null>(null);
	const [done, setDone] = useState<RequestDecision | null>(null);
	const busy = action.busy;
	const approve = async () => {
		const result = await action.run(() =>
			client.decide(request.id, { decision: "approved" }),
		);
		if (result.ok) setDone("approved");
	};
	const refuse = async (event: FormEvent) => {
		event.preventDefault();
		if (busy) return;
		const found = refusalProblem(reason);
		if (found !== null) {
			setProblem(found);
			return;
		}
		const result = await action.run(() =>
			client.decide(request.id, { decision: "refused", reason }),
		);
		if (result.ok) setDone("refused");
	};
	const closed = action.failure === "state";
	return (
		<SubScreen
			title={kindName(request)}
			subtitle={request.requesterName ?? t("approvals.unnamed")}
			onBack={onBack}
			backDisabled={busy}
			testId="approval-detail"
		>
			<Card testId="approval-summary">
				<RequestSummary request={request} />
			</Card>
			{action.failure === null ? null : (
				<Alert testId="approval-failed">
					{t(decideFailureKey(action.failure))}
				</Alert>
			)}
			{closed ? (
				<button
					type="button"
					className={primaryButton}
					data-action="primary"
					onClick={() => onDone(true)}
				>
					{t("approvals.backToQueue")}
				</button>
			) : mode === "choose" ? (
				<div className="flex flex-col gap-3">
					<button
						type="button"
						className={primaryButton}
						data-action="primary"
						disabled={busy}
						aria-busy={busy}
						onClick={() => void approve()}
					>
						<BusyLabel busy={busy} busyText={t("approvals.approving")}>
							{t("approvals.approve")}
						</BusyLabel>
					</button>
					<button
						type="button"
						className={secondaryButton}
						disabled={busy}
						onClick={() => {
							action.clear();
							setMode("refuse");
						}}
					>
						{t("approvals.refuse")}
					</button>
				</div>
			) : (
				<form
					className="flex flex-col gap-3"
					onSubmit={(event) => void refuse(event)}
					noValidate
				>
					<div className="flex flex-col gap-1">
						<label htmlFor={reasonId} className="text-sm text-ink-muted">
							{t("approvals.reason")}
						</label>
						<textarea
							id={reasonId}
							data-testid="refusal-input"
							value={reason}
							disabled={busy}
							maxLength={MAX_REFUSAL_LENGTH}
							rows={3}
							onChange={(event) => {
								setReason(event.target.value);
								setProblem(null);
								action.clear();
							}}
							className={`${fieldClass} min-h-24`}
						/>
						<Hint>{t("approvals.reasonHint")}</Hint>
					</div>
					{problem === null ? null : (
						<Alert testId="refusal-problem">
							{t(`approvals.problem.${problem}`)}
						</Alert>
					)}
					<button
						type="submit"
						className={primaryButton}
						data-action="primary"
						disabled={busy}
						aria-busy={busy}
					>
						<BusyLabel busy={busy} busyText={t("approvals.refusing")}>
							{t("approvals.confirmRefusal")}
						</BusyLabel>
					</button>
					<button
						type="button"
						className={secondaryButton}
						disabled={busy}
						onClick={() => {
							setMode("choose");
							setProblem(null);
							action.clear();
						}}
					>
						{t("approvals.cancelRefusal")}
					</button>
				</form>
			)}
			{done === null ? null : (
				<ResultModal
					message={t(`approvals.done.${done}`)}
					onDone={() => onDone(false)}
				/>
			)}
		</SubScreen>
	);
}

function QueueList({
	requests,
	onOpen,
}: {
	readonly requests: readonly PendingRequest[];
	readonly onOpen: (request: PendingRequest) => void;
}) {
	const { t } = useI18n();
	return (
		<ul className="flex flex-col gap-3" data-testid="approval-list">
			{requests.map((request, index) => (
				<li key={request.id} data-testid="approval-card" data-id={request.id}>
					<Card>
						<RequestSummary request={request} />
						<button
							type="button"
							className={index === 0 ? primaryButton : secondaryButton}
							{...(index === 0 ? { "data-action": "primary" } : {})}
							aria-label={t("approvals.openItem", {
								kind: kindName(request),
								name: request.requesterName ?? t("approvals.unnamed"),
							})}
							onClick={() => onOpen(request)}
						>
							{t("approvals.open")}
						</button>
					</Card>
				</li>
			))}
		</ul>
	);
}

export function ApprovalQueueScreen(_: TeamScreenProps) {
	const { t } = useI18n();
	const { client, recover, manager, home } = useTeamEnv();
	const [open, setOpen] = useState<PendingRequest | null>(null);
	const fetchQueue = useCallback(() => client.queue(), [client]);
	const { load, reload } = useLoad(fetchQueue, recover, manager);
	const requests = useMemo(
		() => (load.status === "ready" ? sortQueue(load.value) : []),
		[load],
	);
	if (!manager) {
		return (
			<SubScreen title={t("approvals.title")} onBack={home} testId="approvals">
				<p className="text-body text-ink" data-testid="approvals-refused">
					{t("approvals.managersOnly")}
				</p>
				<button
					type="button"
					className={primaryButton}
					data-action="primary"
					onClick={home}
				>
					{t("team.backHome")}
				</button>
			</SubScreen>
		);
	}
	if (open !== null) {
		return (
			<DecideRequest
				key={open.id}
				request={open}
				onBack={() => setOpen(null)}
				onDone={() => {
					setOpen(null);
					reload();
				}}
			/>
		);
	}
	return (
		<SubScreen
			title={t("approvals.title")}
			subtitle={t("approvals.subtitle")}
			onBack={home}
			testId="approvals"
		>
			<div
				data-testid="approval-queue"
				data-status={load.status}
				className="contents"
			>
				{load.status === "loading" ? (
					<Loading label={t("approvals.loading")} />
				) : load.status === "failed" ? (
					<div className="flex flex-col gap-2">
						<Alert testId="approvals-failed">
							{t(failureKey(load.failure))}
						</Alert>
						<button
							type="button"
							className={primaryButton}
							data-action="primary"
							onClick={reload}
						>
							{t("ops.retry")}
						</button>
					</div>
				) : requests.length === 0 ? (
					<div className="flex flex-col gap-3" data-testid="approvals-empty">
						<p className="text-body text-ink-muted">{t("approvals.empty")}</p>
						<button
							type="button"
							className={primaryButton}
							data-action="primary"
							onClick={home}
						>
							{t("team.backHome")}
						</button>
					</div>
				) : (
					<QueueList requests={requests} onOpen={setOpen} />
				)}
			</div>
		</SubScreen>
	);
}
