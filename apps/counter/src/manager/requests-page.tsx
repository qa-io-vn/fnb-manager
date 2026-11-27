import { useI18n } from "@fnb/zalo-mini/i18n";
import { ChipGroup, StatusPill } from "@fnb/zalo-mini/ui-kit";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { RpcError } from "../lib/rpc";
import { useSession } from "../lib/session";
import { useStore } from "../lib/store";
import { dayAndClock, vietnamDate } from "../lib/time";
import { useNow } from "../orders/order-bits";
import { Dialog } from "../ui/dialog";
import { button, card, field, Loading, PageTitle, PlainNote } from "../ui/kit";
import { useToast } from "../ui/toast";
import {
	type Answer,
	answerRequest,
	answersFor,
	countByKind,
	inbox,
	inboxOrder,
	isOpen,
	isUnread,
	markRead,
	minutesLeft,
	needsMessage,
	proposalProblem,
	REQUEST_KINDS,
	replyText,
	type StoreRequest,
	vietnamInstant,
} from "./requests";

/** The inbox of the device's store, shared by the page and the unread badge (one query, polled every 20 s). */
export function useInbox(enabled = true) {
	const { client } = useSession();
	const { store } = useStore();
	return useQuery({
		queryKey: ["requests", store.id],
		queryFn: () => inbox(client, store.id),
		refetchInterval: 20_000,
		enabled,
	});
}

/** The date and the clock of an instant in Vietnam time, for the proposal's inputs. */
function inputsOf(iso: string | null | undefined): {
	readonly date: string;
	readonly clock: string;
} {
	if (iso === null || iso === undefined) return { date: "", clock: "" };
	const clock = new Intl.DateTimeFormat("en-GB", {
		timeZone: "Asia/Ho_Chi_Minh",
		hour: "2-digit",
		minute: "2-digit",
		hourCycle: "h23",
	}).format(new Date(iso));
	return { date: vietnamDate(iso), clock };
}

function RequestDialog({
	request,
	onClose,
	onDone,
}: {
	readonly request: StoreRequest;
	readonly onClose: () => void;
	readonly onDone: () => void;
}) {
	const { t } = useI18n();
	const { client } = useSession();
	const { store } = useStore();
	const { show } = useToast();
	const now = useNow(30_000);
	const [answer, setAnswer] = useState<Answer | null>(null);
	const [message, setMessage] = useState("");
	const start = inputsOf(request.proposed_for ?? request.requested_for);
	const [date, setDate] = useState(start.date);
	const [clock, setClock] = useState(start.clock);
	const [failure, setFailure] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);
	const [sent, setSent] = useState<string | null>(null);
	const proposedFor =
		answer === "proposed" ? vietnamInstant(date, clock) : null;
	const problem =
		answer === "proposed" ? proposalProblem(proposedFor, request, now) : null;
	const ready =
		answer !== null &&
		!busy &&
		problem === null &&
		(!needsMessage(answer) || message.trim() !== "");
	const choices = answersFor(request);

	// M01: opening a request records the first reader (the unread mark goes); later openings change nothing
	const done = useRef(onDone);
	done.current = onDone;
	useEffect(() => {
		if (!isUnread(request)) return;
		markRead(client, request.id).then(
			() => done.current(),
			() => undefined,
		);
	}, [client, request]);

	const submit = async () => {
		if (answer === null) return;
		setBusy(true);
		setFailure(null);
		try {
			const result = await answerRequest(
				client,
				request,
				answer,
				message,
				proposedFor,
			);
			if (result.state === "answered") {
				setSent(
					replyText(request, answer, message, store.name, t, proposedFor),
				);
				onDone();
			} else {
				setFailure(
					t(
						result.state === "conflict"
							? "requests.conflict"
							: result.refusal === "time_invalid" ||
									result.refusal === "time_outside_hours"
								? `requests.refusal.${result.refusal}`
								: "requests.refused",
					),
				);
			}
		} catch (error) {
			setFailure(
				t(
					error instanceof RpcError && error.forbidden
						? "common.forbidden"
						: error instanceof RpcError && error.code === "22023"
							? "requests.invalid"
							: "common.failed",
				),
			);
		} finally {
			setBusy(false);
		}
	};
	return (
		<Dialog
			title={`${t(`requests.kind.${request.kind}`)} · ${request.contact_name}`}
			onClose={onClose}
			closeLabel={t("common.close")}
			busy={busy}
			testId="request-dialog"
		>
			<div className="flex flex-col gap-3">
				<dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
					{request.party_size === null ? null : (
						<>
							<dt className="text-ink-muted">{t("requests.party")}</dt>
							<dd className="font-bold">{request.party_size}</dd>
						</>
					)}
					{request.requested_for === null ? null : (
						<>
							<dt className="text-ink-muted">{t("requests.when")}</dt>
							<dd className="font-bold">
								{dayAndClock(request.requested_for)}
							</dd>
						</>
					)}
					{request.status === "proposed" &&
					request.proposed_for !== null &&
					request.proposed_for !== undefined ? (
						<>
							<dt className="text-ink-muted">{t("requests.proposedFor")}</dt>
							<dd className="font-bold" data-testid="request-proposed-for">
								{dayAndClock(request.proposed_for)}
							</dd>
						</>
					) : null}
					{request.subject === null ? null : (
						<>
							<dt className="text-ink-muted">{t("requests.subject")}</dt>
							<dd className="font-bold">{request.subject}</dd>
						</>
					)}
					{request.contact_phone === null ? null : (
						<>
							<dt className="text-ink-muted">{t("requests.phone")}</dt>
							<dd>
								<a
									className="font-bold text-highlight underline"
									href={`tel:${request.contact_phone}`}
								>
									{request.contact_phone}
								</a>
							</dd>
						</>
					)}
				</dl>
				{request.note === null ? null : (
					<p className="rounded-card-xl bg-surface-sunken p-3 whitespace-pre-line">
						{request.note}
					</p>
				)}
				{sent !== null ? (
					<section className="flex flex-col gap-2" data-testid="reply-text">
						<h3 className="font-extrabold">{t("requests.reply")}</h3>
						<p className="rounded-card-xl bg-positive-soft p-3 whitespace-pre-line">
							{sent}
						</p>
						<button
							type="button"
							className={button.primary}
							onClick={() => {
								void navigator.clipboard?.writeText(sent).then(
									() => show(t("requests.copied")),
									() => show(t("common.failed")),
								);
							}}
						>
							{t("requests.copy")}
						</button>
						<p className="text-sm text-ink-muted">{t("requests.zbsLater")}</p>
					</section>
				) : choices.length === 0 ? (
					<PlainNote>
						{t("requests.answered", { message: request.answer_message ?? "" })}
					</PlainNote>
				) : (
					<>
						{request.status === "proposed" ? (
							<PlainNote tone="warning" testId="request-awaiting-customer">
								{t("requests.awaitingCustomer")}
							</PlainNote>
						) : null}
						<div className="flex flex-wrap gap-2">
							{choices.map((choice) => (
								<button
									key={choice}
									type="button"
									aria-pressed={answer === choice}
									className={`${answer === choice ? button.inverse : button.secondary} flex-1`}
									onClick={() => {
										setAnswer(choice);
										setFailure(null);
									}}
									data-testid={`answer-${choice}`}
								>
									{t(
										request.status === "proposed" && choice === "confirmed"
											? "requests.answer.agreed"
											: `requests.answer.${choice}`,
									)}
								</button>
							))}
						</div>
						{answer === "proposed" ? (
							<fieldset
								className="flex flex-col gap-2"
								data-testid="propose-time"
							>
								<legend className="pb-1 font-bold">
									{t("requests.proposeLegend")}
								</legend>
								<div className="flex flex-wrap gap-2">
									<label className="flex min-w-40 flex-1 flex-col gap-1">
										<span className="text-sm text-ink-muted">
											{t("requests.proposeDate")}
										</span>
										<input
											type="date"
											className={field}
											value={date}
											onChange={(event) => setDate(event.target.value)}
											data-testid="propose-date"
										/>
									</label>
									<label className="flex min-w-32 flex-1 flex-col gap-1">
										<span className="text-sm text-ink-muted">
											{t("requests.proposeClock")}
										</span>
										<input
											type="time"
											step={900}
											className={field}
											value={clock}
											onChange={(event) => setClock(event.target.value)}
											data-testid="propose-clock"
										/>
									</label>
								</div>
								<p
									className="text-sm text-ink-muted"
									data-testid="propose-hint"
									role={problem === null ? undefined : "alert"}
								>
									{problem === null
										? t("requests.proposeHint")
										: t(`requests.proposeProblem.${problem}`)}
								</p>
							</fieldset>
						) : null}
						{answer === null ? null : (
							<label className="flex flex-col gap-1">
								<span className="font-bold">
									{needsMessage(answer)
										? t("requests.messageRequired")
										: t("requests.messageOptional")}
								</span>
								<textarea
									className={`${field} min-h-20 py-2`}
									maxLength={500}
									value={message}
									placeholder={
										answer === "proposed"
											? t("requests.proposePlaceholder")
											: undefined
									}
									onChange={(event) => setMessage(event.target.value)}
									data-testid="answer-message"
								/>
							</label>
						)}
						{failure === null ? null : (
							<PlainNote tone="negative" testId="answer-failure">
								{failure}
							</PlainNote>
						)}
						<button
							type="button"
							className={button.primary}
							disabled={!ready}
							onClick={() => void submit()}
							data-testid="answer-submit"
						>
							{answer === "proposed"
								? t("requests.proposeSend")
								: t("requests.send")}
						</button>
					</>
				)}
			</div>
		</Dialog>
	);
}

/** The row's state on the right: the answer timer, or the status in words. */
function rowState(
	request: StoreRequest,
	now: number,
	t: (key: string, params?: Record<string, string | number>) => string,
): { readonly text: string; readonly late: boolean } {
	const left = minutesLeft(request, now);
	if (left !== null)
		return left < 0
			? { text: t("requests.late", { minutes: -left }), late: true }
			: { text: t("requests.left", { minutes: left }), late: false };
	return { text: t(`requests.status.${request.status}`), late: false };
}

/** M01: one inbox for bookings, workshops, holds and applications, with the promised answer time and a reply to copy. */
export function RequestsPage() {
	const { t } = useI18n();
	const now = useNow(30_000);
	const queries = useQueryClient();
	const { store } = useStore();
	const [kind, setKind] = useState("all");
	const [open, setOpen] = useState(true);
	const [chosen, setChosen] = useState<StoreRequest | null>(null);
	const box = useInbox();
	const all = box.data?.requests ?? [];
	const counts = countByKind(all.filter((request) => isOpen(request) === open));
	const shown = inboxOrder(
		all.filter(
			(request) =>
				(kind === "all" || request.kind === kind) && isOpen(request) === open,
		),
	);
	return (
		<div className="mx-auto flex max-w-4xl flex-col gap-4">
			<PageTitle>{t("requests.title")}</PageTitle>
			{box.data === undefined ? (
				<Loading label={t("app.loading")} />
			) : (
				<>
					<div className="flex flex-wrap gap-2" data-testid="requests-summary">
						<StatusPill tone="badge">
							{t("requests.new", { count: box.data.new })}
						</StatusPill>
						<StatusPill
							tone={box.data.unread > 0 ? "warning" : "neutral"}
							testId="requests-unread"
						>
							{t("requests.unread", { count: box.data.unread })}
						</StatusPill>
						<StatusPill tone={box.data.overdue > 0 ? "negative" : "neutral"}>
							{t("requests.overdue", { count: box.data.overdue })}
						</StatusPill>
					</div>
					<p className="text-sm text-ink-muted">{t("requests.promise")}</p>
					<div className="-mx-4">
						<ChipGroup
							label={t("requests.kinds")}
							chips={[
								{
									key: "all",
									label: `${t("requests.kind.all")} · ${counts.all ?? 0}`,
								},
								...REQUEST_KINDS.map((key) => ({
									key,
									label: `${t(`requests.kind.${key}`)} · ${counts[key] ?? 0}`,
								})),
							]}
							selected={kind}
							onSelect={setKind}
							testId="request-kinds"
						/>
						<ChipGroup
							label={t("requests.state")}
							chips={[
								{ key: "open", label: t("requests.open") },
								{ key: "done", label: t("requests.done") },
							]}
							selected={open ? "open" : "done"}
							onSelect={(key) => setOpen(key === "open")}
							testId="request-states"
						/>
					</div>
					{shown.length === 0 ? (
						<PlainNote>{t("requests.empty")}</PlainNote>
					) : (
						<ul className="flex flex-col gap-2">
							{shown.map((request) => {
								const state = rowState(request, now, t);
								const unread = isUnread(request);
								return (
									<li key={request.id}>
										<button
											type="button"
											onClick={() => setChosen(request)}
											className={`${card} flex w-full flex-wrap items-center gap-2 p-4 text-left focus-visible:outline-2 focus-visible:outline-focus`}
											data-testid="request-row"
											data-status={request.status}
											data-unread={unread}
										>
											{unread ? (
												<span
													className="size-2.5 shrink-0 rounded-full bg-accent"
													data-testid="request-unread"
												>
													<span className="sr-only">
														{t("requests.unreadMark")}
													</span>
												</span>
											) : null}
											<StatusPill tone="neutral">
												{t(`requests.kind.${request.kind}`)}
											</StatusPill>
											<span className="font-extrabold">
												{request.contact_name}
											</span>
											<span className="text-sm text-ink-muted">
												{[
													request.party_size === null
														? null
														: t("reply.people", { count: request.party_size }),
													request.subject,
													request.requested_for === null
														? null
														: dayAndClock(request.requested_for),
													request.status === "proposed" &&
													request.proposed_for !== null &&
													request.proposed_for !== undefined
														? t("requests.proposedShort", {
																time: dayAndClock(request.proposed_for),
															})
														: null,
												]
													.filter((part) => part !== null)
													.join(" · ")}
											</span>
											<span
												className={`ml-auto text-sm font-bold ${state.late ? "text-negative" : ""}`}
											>
												{state.text}
											</span>
										</button>
									</li>
								);
							})}
						</ul>
					)}
				</>
			)}
			{chosen === null ? null : (
				<RequestDialog
					request={chosen}
					onClose={() => setChosen(null)}
					onDone={() =>
						void queries.invalidateQueries({ queryKey: ["requests", store.id] })
					}
				/>
			)}
		</div>
	);
}
