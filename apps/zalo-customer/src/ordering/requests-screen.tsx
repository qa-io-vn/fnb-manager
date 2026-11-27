import type {
	AcceptProposalAnswer,
	CustomerRequest,
} from "@fnb/zalo-mini/ordering";
import {
	kitButton,
	Popup,
	StatusPill,
	type StatusPillTone,
	useI18n,
} from "@fnb/zalo-mini/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { type Load, useCustomerData } from "../data/customer-data";
import { isoDateIn, shownDate } from "../data/dates";
import { Failed, Loading } from "../ui";
import { newRequestId, useOrdering } from "./ordering-data";
import { clock, FlowBack, Notice, Panel, Problem } from "./parts";

// The customer's own requests (bookings, holds, workshops; native-till.md 12, 16.8 and 18.2), reached from Tôi: each
// with its time and its state; when the store proposed another time, that time and the store's message, with
// "Đồng ý giờ mới" (customer_accept_proposal: the request is confirmed at the time proposed) or a cancel. A new,
// proposed or confirmed request can be cancelled (customer_cancel_request); the server answers another customer's id
// as unknown. An acceptance sends one request id per attempt: a double tap, or a retry after a lost answer, is one
// acceptance; the id is dropped once the server has answered.

/** Whether the customer may still cancel a request (the database's rule: new, proposed or confirmed). */
export function cancellableRequest(request: Pick<CustomerRequest, "status">) {
	return (
		request.status === "new" ||
		request.status === "proposed" ||
		request.status === "confirmed"
	);
}

/** The words of an acceptance the server refused (any refusal it may add later is worded generally). */
export function acceptRefusalKey(refusal: string): string {
	switch (refusal) {
		case "proposal_expired":
		case "not_allowed":
		case "unknown_request":
		case "request_conflict":
			return `myRequests.acceptRefusal.${refusal}`;
		default:
			return "myRequests.acceptRefusal.other";
	}
}

const TONE: Readonly<Record<CustomerRequest["status"], StatusPillTone>> = {
	new: "badge",
	proposed: "warning",
	confirmed: "positive",
	declined: "negative",
	cancelled: "neutral",
};

function when(iso: string): string {
	return `${clock(iso)} ${shownDate(isoDateIn(Date.parse(iso)))}`;
}

function RequestCard({
	request,
	busy,
	onAccept,
	onCancel,
}: {
	readonly request: CustomerRequest;
	readonly busy: boolean;
	readonly onAccept: (request: CustomerRequest) => void;
	readonly onCancel: (request: CustomerRequest) => void;
}) {
	const { t } = useI18n();
	const proposed =
		request.status === "proposed" && request.proposedFor !== null
			? request.proposedFor
			: null;
	return (
		<li>
			<Panel testId="my-request">
				<div className="flex flex-wrap items-center justify-between gap-2">
					<span className="text-[15px] font-bold text-ink">
						{t(`myRequests.kind.${request.kind}`)}
						{request.partySize === null
							? ""
							: ` · ${t("myRequests.party", { count: request.partySize })}`}
					</span>
					<StatusPill tone={TONE[request.status]} testId="my-request-status">
						{t(`myRequests.status.${request.status}`)}
					</StatusPill>
				</div>
				{request.requestedFor === null ? null : (
					<p className="text-body text-ink" data-testid="my-request-asked">
						{t(
							request.status === "confirmed"
								? "myRequests.confirmedFor"
								: "myRequests.asked",
							{ when: when(request.requestedFor) },
						)}
					</p>
				)}
				{request.status === "confirmed" &&
				request.customerAcceptedAt !== null ? (
					<p
						className="text-[13px] text-ink-muted"
						data-testid="my-request-accepted"
					>
						{t("myRequests.acceptedNote")}
					</p>
				) : null}
				{request.subject === null ? null : (
					<p className="text-body text-ink break-words">{request.subject}</p>
				)}
				{proposed !== null ? (
					<div
						className="flex flex-col gap-2 rounded-card bg-warning-soft px-4 py-3 text-body text-ink"
						data-testid="my-request-proposed"
					>
						<p className="font-bold">
							{t("myRequests.proposed", { when: when(proposed) })}
						</p>
						{request.answerMessage === null ? null : (
							<p className="break-words">{request.answerMessage}</p>
						)}
						<p className="text-[13px]">{t("myRequests.howToAgree")}</p>
						<button
							type="button"
							className={`${kitButton.primary} w-full`}
							onClick={() => onAccept(request)}
							disabled={busy}
							aria-busy={busy}
							data-testid="my-request-accept"
						>
							{t("myRequests.accept")}
						</button>
					</div>
				) : request.answerMessage !== null &&
					(request.status === "declined" || request.status === "confirmed") ? (
					<p className="text-[13px] text-ink-muted break-words">
						{request.answerMessage}
					</p>
				) : null}
				{cancellableRequest(request) ? (
					<button
						type="button"
						className={`${kitButton.secondary} w-full`}
						onClick={() => onCancel(request)}
						disabled={busy}
						data-testid="my-request-cancel"
					>
						{t(
							request.status === "proposed"
								? "myRequests.declineProposal"
								: "myRequests.cancel",
						)}
					</button>
				) : null}
			</Panel>
		</li>
	);
}

export function MyRequestsScreen() {
	const { t } = useI18n();
	const { client } = useOrdering();
	const { recover } = useCustomerData();
	const [load, setLoad] = useState<
		Load<{ readonly requests: readonly CustomerRequest[] }>
	>({ status: "loading" });
	const [asking, setAsking] = useState<CustomerRequest | null>(null);
	const [busy, setBusy] = useState(false);
	const [problem, setProblem] = useState<string | null>(null);
	const [done, setDone] = useState<string | null>(null);
	// one acceptance id per request until the server answers it: a retry after a lost answer sends the same id again
	const attempts = useRef(new Map<string, string>());
	const sending = useRef(false);
	const reload = useCallback(() => {
		if (client === null) return;
		client.requests().then(
			(data) => setLoad({ status: "ready", data }),
			(error: unknown) =>
				setLoad({ status: "failed", failure: recover(error) }),
		);
	}, [client, recover]);
	useEffect(() => {
		reload();
	}, [reload]);
	const accepted = (answer: AcceptProposalAnswer) => {
		if (answer.state === "accepted") {
			const at = answer.request.requestedFor;
			setDone(
				at === null
					? t("myRequests.acceptedNoTime")
					: t("myRequests.accepted", { when: when(at) }),
			);
			return;
		}
		setProblem(t(acceptRefusalKey(answer.refusal)));
	};
	const accept = (request: CustomerRequest) => {
		// the server decides whether the time proposed is still ahead (proposal_expired): the phone's clock is not asked
		if (client === null || sending.current) return;
		const attempt = attempts.current.get(request.id) ?? newRequestId();
		attempts.current.set(request.id, attempt);
		sending.current = true;
		setBusy(true);
		setProblem(null);
		setDone(null);
		client.acceptProposal(request.id, attempt).then(
			(answer) => {
				sending.current = false;
				setBusy(false);
				// answered: the next tap (another proposal, or after a conflict) is a new attempt
				attempts.current.delete(request.id);
				accepted(answer);
				reload();
			},
			(error: unknown) => {
				sending.current = false;
				setBusy(false);
				recover(error);
				setProblem(t("myRequests.acceptFailed"));
			},
		);
	};
	const cancel = () => {
		if (client === null || asking === null) return;
		setBusy(true);
		setProblem(null);
		setDone(null);
		client.cancelRequest(asking.id).then(
			(answer) => {
				setBusy(false);
				setAsking(null);
				if (answer.state === "refused")
					setProblem(
						t(
							answer.refusal === "unknown_request"
								? "myRequests.refusal.unknown_request"
								: "myRequests.refusal.not_allowed",
						),
					);
				reload();
			},
			(error: unknown) => {
				setBusy(false);
				recover(error);
				setProblem(t("myRequests.failed"));
			},
		);
	};
	return (
		<section
			className="flex flex-col gap-4 px-4 py-4"
			data-testid="my-requests"
		>
			<FlowBack />
			<h1 className="text-xl font-bold text-ink">{t("myRequests.title")}</h1>
			{problem === null ? null : (
				<Problem testId="my-requests-problem">{problem}</Problem>
			)}
			{done === null ? null : (
				<p
					role="status"
					className="rounded-card bg-positive-soft px-4 py-3 text-body text-ink"
					data-testid="my-requests-done"
				>
					{done}
				</p>
			)}
			{load.status === "loading" ? (
				<Loading />
			) : load.status === "failed" ? (
				<Failed failure={load.failure} onRetry={reload} />
			) : load.data.requests.length === 0 ? (
				<Notice testId="my-requests-empty">{t("myRequests.empty")}</Notice>
			) : (
				<ul className="flex flex-col gap-3">
					{load.data.requests.map((request) => (
						<RequestCard
							key={request.id}
							request={request}
							busy={busy}
							onAccept={accept}
							onCancel={setAsking}
						/>
					))}
				</ul>
			)}
			{asking === null ? null : (
				<Popup
					title={t("myRequests.confirmTitle")}
					onClose={() => setAsking(null)}
					testId="my-request-confirm"
				>
					<div className="flex flex-col gap-3">
						<p className="text-body text-ink">
							{asking.requestedFor === null
								? t("myRequests.confirmBodyNoTime")
								: t("myRequests.confirmBody", {
										when: when(asking.requestedFor),
									})}
						</p>
						<button
							type="button"
							className={`${kitButton.danger} w-full`}
							onClick={cancel}
							disabled={busy}
							aria-busy={busy}
							data-testid="my-request-confirm-cancel"
						>
							{t("myRequests.confirmCancel")}
						</button>
						<button
							type="button"
							className={`${kitButton.secondary} w-full`}
							onClick={() => setAsking(null)}
						>
							{t("myRequests.keep")}
						</button>
					</div>
				</Popup>
			)}
		</section>
	);
}
