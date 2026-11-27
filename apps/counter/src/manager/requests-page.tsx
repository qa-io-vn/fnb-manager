import { useI18n } from "@fnb/zalo-mini/i18n";
import { ChipGroup, StatusPill } from "@fnb/zalo-mini/ui-kit";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { RpcError, rpc } from "../lib/rpc";
import { useSession } from "../lib/session";
import { useStore } from "../lib/store";
import { dayAndClock } from "../lib/time";
import { useNow } from "../orders/order-bits";
import { Dialog } from "../ui/dialog";
import { button, card, field, Loading, PageTitle, PlainNote } from "../ui/kit";
import { useToast } from "../ui/toast";
import {
	countByKind,
	inboxOrder,
	minutesLeft,
	REQUEST_KINDS,
	replyText,
	type StoreRequest,
} from "./requests";

type Answer = "confirmed" | "declined" | "cancelled";

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
	const [answer, setAnswer] = useState<Answer | null>(null);
	const [message, setMessage] = useState("");
	const [failure, setFailure] = useState<string | null>(null);
	const [sent, setSent] = useState<string | null>(null);
	const needsMessage = answer === "declined" || answer === "cancelled";
	const ready = answer !== null && (!needsMessage || message.trim() !== "");
	const choices: Answer[] =
		request.status === "new"
			? ["confirmed", "declined"]
			: request.status === "confirmed"
				? ["cancelled"]
				: [];
	const submit = async () => {
		if (answer === null) return;
		try {
			const result = await rpc<{ state: string; refusal: string | null }>(
				client,
				"manager_answer_request",
				{
					p_request: request.id,
					p_status: answer,
					p_message: message.trim() === "" ? null : message.trim(),
					p_expected_version: request.version,
				},
			);
			if (result.state === "answered") {
				setSent(replyText(request, answer, message, store.name, t));
				onDone();
			} else {
				setFailure(
					t(
						result.state === "conflict"
							? "requests.conflict"
							: "requests.refused",
					),
				);
			}
		} catch (error) {
			setFailure(
				t(
					error instanceof RpcError && error.forbidden
						? "common.forbidden"
						: "common.failed",
				),
			);
		}
	};
	return (
		<Dialog
			title={`${t(`requests.kind.${request.kind}`)} · ${request.contact_name}`}
			onClose={onClose}
			closeLabel={t("common.close")}
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
						<div className="flex flex-wrap gap-2">
							{choices.map((choice) => (
								<button
									key={choice}
									type="button"
									aria-pressed={answer === choice}
									className={`${answer === choice ? button.inverse : button.secondary} flex-1`}
									onClick={() => setAnswer(choice)}
									data-testid={`answer-${choice}`}
								>
									{t(`requests.answer.${choice}`)}
								</button>
							))}
						</div>
						{answer === null ? null : (
							<label className="flex flex-col gap-1">
								<span className="font-bold">
									{needsMessage
										? t("requests.messageRequired")
										: t("requests.messageOptional")}
								</span>
								<textarea
									className={`${field} min-h-20 py-2`}
									maxLength={500}
									value={message}
									onChange={(event) => setMessage(event.target.value)}
									data-testid="answer-message"
								/>
							</label>
						)}
						{failure === null ? null : (
							<PlainNote tone="negative">{failure}</PlainNote>
						)}
						<button
							type="button"
							className={button.primary}
							disabled={!ready}
							onClick={() => void submit()}
							data-testid="answer-submit"
						>
							{t("requests.send")}
						</button>
					</>
				)}
			</div>
		</Dialog>
	);
}

/** M01: one inbox for bookings, workshops, holds and applications, with the promised answer time and a reply to copy. */
export function RequestsPage() {
	const { t } = useI18n();
	const { client } = useSession();
	const { store } = useStore();
	const now = useNow(30_000);
	const [kind, setKind] = useState("all");
	const [open, setOpen] = useState(true);
	const [chosen, setChosen] = useState<StoreRequest | null>(null);
	const inbox = useQuery({
		queryKey: ["requests", store.id],
		queryFn: () =>
			rpc<{ requests: StoreRequest[]; new: number; overdue: number }>(
				client,
				"manager_requests",
				{ p_store: store.id, p_status: null, p_limit: 200 },
			),
		refetchInterval: 20_000,
	});
	const all = inbox.data?.requests ?? [];
	const counts = countByKind(
		all.filter((request) => (request.status === "new") === open),
	);
	const shown = inboxOrder(
		all.filter(
			(request) =>
				(kind === "all" || request.kind === kind) &&
				(request.status === "new") === open,
		),
	);
	return (
		<div className="mx-auto flex max-w-4xl flex-col gap-4">
			<PageTitle>{t("requests.title")}</PageTitle>
			{inbox.data === undefined ? (
				<Loading label={t("app.loading")} />
			) : (
				<>
					<div className="flex flex-wrap gap-2" data-testid="requests-summary">
						<StatusPill tone="badge">
							{t("requests.new", { count: inbox.data.new })}
						</StatusPill>
						<StatusPill tone={inbox.data.overdue > 0 ? "negative" : "neutral"}>
							{t("requests.overdue", { count: inbox.data.overdue })}
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
						/>
					</div>
					{shown.length === 0 ? (
						<PlainNote>{t("requests.empty")}</PlainNote>
					) : (
						<ul className="flex flex-col gap-2">
							{shown.map((request) => {
								const left = minutesLeft(request, now);
								return (
									<li key={request.id}>
										<button
											type="button"
											onClick={() => setChosen(request)}
											className={`${card} flex w-full flex-wrap items-center gap-2 p-4 text-left focus-visible:outline-2 focus-visible:outline-focus`}
											data-testid="request-row"
										>
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
												]
													.filter((part) => part !== null)
													.join(" · ")}
											</span>
											<span
												className={`ml-auto text-sm font-bold ${left !== null && left < 0 ? "text-negative" : ""}`}
											>
												{left === null
													? t(`requests.status.${request.status}`)
													: left < 0
														? t("requests.late", { minutes: -left })
														: t("requests.left", { minutes: left })}
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
					onDone={() => void inbox.refetch()}
				/>
			)}
		</div>
	);
}
