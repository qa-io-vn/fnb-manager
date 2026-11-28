import { formatVnd } from "@fnb/zalo-mini/format";
import { useI18n } from "@fnb/zalo-mini/i18n";
import { ChipGroup, PriceText, StatusPill } from "@fnb/zalo-mini/ui-kit";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useId, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { RpcError } from "../lib/rpc";
import { useMember, useSession } from "../lib/session";
import { useStore } from "../lib/store";
import { dayAndClock } from "../lib/time";
import { rosterNames } from "../orders/api";
import { Dialog } from "../ui/dialog";
import { AlertIcon } from "../ui/icons";
import { button, card, field, Loading, PageTitle, PlainNote } from "../ui/kit";
import { useToast } from "../ui/toast";
import {
	checkNote,
	EXCEPTION_FILTERS,
	type ExceptionFilter,
	exceptionsFor,
	failureKey,
	LIST_LIMIT,
	managerPaymentExceptions,
	mayHoldMore,
	methodKey,
	NOTE_MAX,
	noteProblemWords,
	openCount,
	type PaymentException,
	RESOLUTIONS,
	type Resolution,
	reasonDetailKey,
	reasonKey,
	resolvable,
	resolveOutcome,
	resolvePaymentException,
	resolverName,
	statusTone,
} from "./payment-exceptions";

// Quản lý → Tiền chờ xử lý (ADR-068; docs/api.md 3.29): the money a verified provider reported that the server did not
// apply to an order (another amount, late, a second payment, a reference nobody issued), newest first, open by
// default; a manager resolves an open one as handed back or dismissed, with a note, after confirming (both are final).
// None of it is in the day's revenue: Đối soát ngày links here while any is open. Owners and managers of the store
// only: the database refuses staff (and another store's or tenant's exception) with 42501.

export const PAYMENT_EXCEPTIONS_PATH = "/quan-ly/tien-cho-xu-ly";

/** The store's open count for the badges and Đối soát ngày (one small read, every minute). */
export function usePaymentExceptionCounts(enabled = true) {
	const { client } = useSession();
	const { store } = useStore();
	return useQuery({
		queryKey: ["payment-exceptions", store.id, "counts"],
		queryFn: () => managerPaymentExceptions(client, store.id, "open", 1),
		refetchInterval: 60_000,
		retry: (count, error) =>
			!(error instanceof RpcError && error.forbidden) && count < 1,
		enabled,
	});
}

/** How many payment exceptions wait for a manager, for the badges where the other counts show. */
export function useOpenPaymentExceptions(enabled: boolean): number {
	return openCount(usePaymentExceptionCounts(enabled).data);
}

/** Đối soát ngày's line: the money the day does not count, with the way to it; nothing while none is open. */
export function PaymentExceptionsLine() {
	const { t } = useI18n();
	const open = useOpenPaymentExceptions(true);
	if (open === 0) return null;
	return (
		<Link
			to={PAYMENT_EXCEPTIONS_PATH}
			className="font-bold text-highlight underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-focus"
			data-testid="reconciliation-payment-exceptions"
		>
			{t("paymentExceptions.reconciliationLine", { count: open })}
		</Link>
	);
}

function Row({
	exception,
	resolver,
	onResolve,
}: {
	readonly exception: PaymentException;
	readonly resolver: string;
	readonly onResolve: () => void;
}) {
	const { t } = useI18n();
	const received = dayAndClock(exception.received_at);
	return (
		<li
			className={`${card} flex flex-col gap-2 p-4 md:flex-row md:items-center`}
			data-testid="payment-exception-row"
			data-exception={exception.id}
			data-status={exception.status}
			data-reason={exception.reason}
		>
			<div className="flex min-w-0 flex-1 flex-col gap-1">
				<p className="flex flex-wrap items-center gap-2">
					<PriceText
						amount={exception.amount}
						size="lead"
						tone="ink"
						testId="payment-exception-amount"
					/>
					<span className="font-extrabold" data-testid="payment-exception-kind">
						{t(reasonKey(exception.reason))}
					</span>
					<StatusPill
						tone={statusTone(exception.status)}
						testId="payment-exception-status"
					>
						{t(`paymentExceptions.status.${exception.status}`)}
					</StatusPill>
				</p>
				<p className="text-sm text-ink-muted">
					{t(reasonDetailKey(exception.reason))}
					{exception.expected_amount === null ||
					exception.expected_amount === exception.amount ? null : (
						<>
							{" "}
							<span data-testid="payment-exception-expected">
								{t("paymentExceptions.expected")}{" "}
								<PriceText
									amount={exception.expected_amount}
									tone="ink"
									className="font-bold"
								/>
							</span>
						</>
					)}
				</p>
				<p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
					<span data-testid="payment-exception-method">
						{t(methodKey(exception.method))}
					</span>
					<span aria-hidden="true">·</span>
					<span
						className="min-w-0 break-all"
						data-testid="payment-exception-reference"
					>
						{exception.reference === null ? (
							t("paymentExceptions.noReference")
						) : (
							<>
								{t("paymentExceptions.referenceLabel")}{" "}
								<span className="font-mono font-bold">
									{exception.reference}
								</span>
							</>
						)}
					</span>
					<span aria-hidden="true">·</span>
					{exception.order_id === null ? (
						<span data-testid="payment-exception-order">
							{t("paymentExceptions.noOrder")}
						</span>
					) : (
						<Link
							to={`/don/${exception.order_id}`}
							className="font-bold text-highlight underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-focus"
							data-testid="payment-exception-order"
						>
							{t("paymentExceptions.order", {
								order: exception.order_no ?? "",
							})}
						</Link>
					)}
					<span aria-hidden="true">·</span>
					<span data-testid="payment-exception-time">
						{t("paymentExceptions.receivedAt", { time: received })}
					</span>
				</p>
				{exception.status === "open" ||
				exception.resolved_at === null ? null : (
					<div
						className="flex flex-col gap-1 rounded-card-xl bg-surface-sunken p-3 text-sm"
						data-testid="payment-exception-resolution"
					>
						<p className="font-bold">
							{t("paymentExceptions.resolvedLine", {
								status: t(`paymentExceptions.status.${exception.status}`),
								name: resolver,
								time: dayAndClock(exception.resolved_at),
							})}
						</p>
						{exception.resolution_note === null ? null : (
							<p className="break-words" data-testid="payment-exception-note">
								{t("paymentExceptions.noteShown", {
									note: exception.resolution_note,
								})}
							</p>
						)}
					</div>
				)}
			</div>
			{resolvable(exception) ? (
				<button
					type="button"
					className={`${button.secondary} md:w-auto`}
					aria-label={t("paymentExceptions.resolveLabel", {
						amount: formatVnd(exception.amount),
						time: received,
					})}
					onClick={onResolve}
					data-testid="payment-exception-resolve"
				>
					{t("paymentExceptions.resolve")}
				</button>
			) : null}
		</li>
	);
}

/** How long the confirmation ignores taps, so a double tap on "Tiếp tục" never confirms. */
export const CONFIRM_ARMING_MS = 500;

/**
 * The resolution of one open exception: the way (handed back or dismissed) and the note the server needs, checked as
 * the server checks it, each problem said under its field (aria-invalid, aria-describedby) with the focus on it; then
 * a confirmation, since the server never changes a resolution. One call per confirmation, whatever the taps.
 */
export function ResolveDialog({
	exception,
	onClose,
	onResolved,
	onAlready,
}: {
	readonly exception: PaymentException;
	readonly onClose: () => void;
	readonly onResolved: (message: string) => void;
	readonly onAlready: (message: string) => void;
}) {
	const { t } = useI18n();
	const { client } = useSession();
	const id = useId();
	const [resolution, setResolution] = useState<Resolution | null>(null);
	const [note, setNote] = useState("");
	const [noteTouched, setNoteTouched] = useState(false);
	const [tried, setTried] = useState(false);
	const [serverRefusedNote, setServerRefusedNote] = useState(false);
	const [stage, setStage] = useState<"form" | "confirm">("form");
	const [armed, setArmed] = useState(false);
	const [busy, setBusy] = useState(false);
	const [message, setMessage] = useState<string | null>(null);
	const sending = useRef(false);
	const returning = useRef(false);
	const firstChoice = useRef<HTMLInputElement>(null);
	const noteInput = useRef<HTMLInputElement>(null);
	const question = useRef<HTMLParagraphElement>(null);
	const checked = checkNote(note);
	const amount = formatVnd(exception.amount);
	const noteWords =
		(noteTouched || tried) && checked.problem !== null
			? (() => {
					const said = noteProblemWords(checked.problem);
					return t(said.key, said.params);
				})()
			: serverRefusedNote
				? t("paymentExceptions.refusal.invalid")
				: null;
	const choiceWords =
		tried && resolution === null ? t("paymentExceptions.choiceMissing") : null;
	const noteId = `${id}-note`;
	const hintId = `${noteId}-hint`;
	const noteErrorId = `${noteId}-error`;
	const choiceErrorId = `${id}-choice-error`;

	useEffect(() => {
		if (stage !== "confirm") {
			// back from the confirmation (by hand or after the server refused the note): the focus goes to the note
			if (returning.current) noteInput.current?.focus();
			returning.current = false;
			return;
		}
		question.current?.focus();
		setArmed(false);
		const timer = window.setTimeout(() => setArmed(true), CONFIRM_ARMING_MS);
		return () => window.clearTimeout(timer);
	}, [stage]);

	const back = () => {
		returning.current = true;
		setStage("form");
	};

	const next = () => {
		setTried(true);
		setMessage(null);
		if (resolution === null) {
			firstChoice.current?.focus();
			return;
		}
		if (checked.note === null || serverRefusedNote) {
			noteInput.current?.focus();
			return;
		}
		setStage("confirm");
	};

	const submit = () => {
		if (
			!armed ||
			sending.current ||
			resolution === null ||
			checked.note === null
		)
			return;
		sending.current = true;
		setBusy(true);
		setMessage(null);
		const chosen = resolution;
		resolvePaymentException(client, exception.id, chosen, checked.note).then(
			(answer) => {
				sending.current = false;
				setBusy(false);
				const outcome = resolveOutcome(answer, chosen);
				const words = t(`paymentExceptions.resolution.${chosen}`);
				if (outcome.kind === "resolved") {
					onResolved(
						t(
							outcome.replayed
								? "paymentExceptions.replayed"
								: "paymentExceptions.done",
							{ amount, resolution: words },
						),
					);
					return;
				}
				onAlready(
					t("paymentExceptions.already", {
						status: t(
							outcome.state === "refunded" || outcome.state === "dismissed"
								? `paymentExceptions.status.${outcome.state}`
								: "paymentExceptions.status.resolved",
						),
					}),
				);
			},
			(error: unknown) => {
				sending.current = false;
				setBusy(false);
				if (error instanceof RpcError && error.code === "22023") {
					// the server refused the note: back to the form, the note marked
					setServerRefusedNote(true);
					back();
					return;
				}
				// a lost answer is tried again from the same confirmation: the server answers a replay
				setMessage(t(failureKey(error)));
			},
		);
	};

	const summary = (
		<p className="flex flex-wrap items-center gap-2 rounded-card-xl bg-surface-sunken p-3">
			<PriceText amount={exception.amount} size="list" tone="ink" />
			<span className="font-bold">{t(reasonKey(exception.reason))}</span>
			<span className="text-sm text-ink-muted">
				{t(methodKey(exception.method))} ·{" "}
				{exception.order_id === null
					? t("paymentExceptions.noOrder")
					: t("paymentExceptions.order", {
							order: exception.order_no ?? "",
						})}{" "}
				·{" "}
				{t("paymentExceptions.receivedAt", {
					time: dayAndClock(exception.received_at),
				})}
			</span>
		</p>
	);

	return (
		<Dialog
			title={t("paymentExceptions.dialogTitle")}
			onClose={onClose}
			closeLabel={t("common.close")}
			busy={busy}
			testId="resolve-dialog"
			footer={
				stage === "form" ? (
					<>
						<button
							type="button"
							className={button.secondary}
							onClick={onClose}
						>
							{t("common.cancel")}
						</button>
						<button
							type="button"
							className={button.primary}
							onClick={next}
							data-testid="resolve-next"
						>
							{t("paymentExceptions.next")}
						</button>
					</>
				) : (
					<>
						<button
							type="button"
							className={button.secondary}
							onClick={back}
							disabled={busy}
							data-testid="resolve-back"
						>
							{t("common.back")}
						</button>
						<button
							type="button"
							className={button.primary}
							onClick={submit}
							disabled={!armed || busy}
							aria-busy={busy}
							data-testid="resolve-confirm"
						>
							{busy
								? t("paymentExceptions.sending")
								: t("paymentExceptions.confirm")}
						</button>
					</>
				)
			}
		>
			<div className="flex flex-col gap-4">
				{summary}
				{stage === "form" ? (
					<>
						<fieldset className="flex flex-col gap-1">
							<legend className="pb-2 font-extrabold">
								{t("paymentExceptions.choice")}
							</legend>
							{RESOLUTIONS.map((value, index) => {
								const name = `${id}-${value}-name`;
								const hint = `${id}-${value}-hint`;
								return (
									<label
										key={value}
										className="flex min-h-12 items-start gap-3 rounded-card-xl px-2 py-2 hover:bg-surface-sunken"
									>
										<input
											ref={index === 0 ? firstChoice : undefined}
											type="radio"
											name={`${id}-resolution`}
											className="mt-1 size-6 shrink-0"
											checked={resolution === value}
											onChange={() => setResolution(value)}
											aria-labelledby={name}
											aria-invalid={choiceWords !== null}
											aria-describedby={
												choiceWords === null ? hint : `${hint} ${choiceErrorId}`
											}
											data-testid={`resolve-${value}`}
											{...(index === 0 ? { "data-autofocus": true } : {})}
										/>
										<span className="flex flex-col">
											<span id={name} className="font-semibold">
												{t(`paymentExceptions.resolution.${value}`)}
											</span>
											<span id={hint} className="text-sm text-ink-muted">
												{t(`paymentExceptions.resolutionHint.${value}`)}
											</span>
										</span>
									</label>
								);
							})}
							<div aria-live="polite">
								{choiceWords === null ? null : (
									<p
										id={choiceErrorId}
										className="flex items-start gap-1 text-sm font-bold text-negative"
										data-testid="resolve-choice-error"
									>
										<AlertIcon size={16} />
										<span>{choiceWords}</span>
									</p>
								)}
							</div>
						</fieldset>
						<div className="flex flex-col gap-1">
							<label htmlFor={noteId} className="font-bold">
								{t("paymentExceptions.noteLabel")}
							</label>
							<input
								id={noteId}
								ref={noteInput}
								className={`${field} ${noteWords === null ? "" : "border-2 border-negative"}`}
								value={note}
								autoComplete="off"
								aria-invalid={noteWords !== null}
								aria-describedby={
									noteWords === null ? hintId : `${hintId} ${noteErrorId}`
								}
								onChange={(event) => {
									setNote(event.target.value);
									setServerRefusedNote(false);
								}}
								onBlur={() => setNoteTouched(true)}
								onKeyDown={(event) => {
									if (event.key === "Enter") {
										event.preventDefault();
										next();
									}
								}}
								data-testid="resolve-note"
							/>
							<p id={hintId} className="text-sm text-ink-muted">
								{t("paymentExceptions.noteHint", { max: NOTE_MAX })}
							</p>
							<div aria-live="polite">
								{noteWords === null ? null : (
									<p
										id={noteErrorId}
										className="flex items-start gap-1 text-sm font-bold text-negative"
										data-testid="resolve-note-error"
									>
										<AlertIcon size={16} />
										<span>{noteWords}</span>
									</p>
								)}
							</div>
						</div>
					</>
				) : (
					<div
						className="flex flex-col gap-2"
						data-testid="resolve-confirmation"
					>
						<p
							ref={question}
							tabIndex={-1}
							className="text-lg font-extrabold focus-visible:outline-2 focus-visible:outline-focus"
							data-testid="resolve-question"
						>
							{t("paymentExceptions.confirmQuestion", {
								amount,
								resolution:
									resolution === null
										? ""
										: t(`paymentExceptions.resolution.${resolution}`),
							})}
						</p>
						<p
							className="break-words text-body"
							data-testid="resolve-note-shown"
						>
							{t("paymentExceptions.noteShown", { note: checked.note ?? "" })}
						</p>
						<p className="text-body font-bold">
							{t("paymentExceptions.confirmFinal")}
						</p>
					</div>
				)}
				{message === null ? null : (
					<PlainNote tone="negative" testId="resolve-message">
						{message}
					</PlainNote>
				)}
			</div>
		</Dialog>
	);
}

export function PaymentExceptionsPage() {
	const { t } = useI18n();
	const { client } = useSession();
	const { store } = useStore();
	const { member, userId } = useMember();
	const { show } = useToast();
	const queryClient = useQueryClient();
	const [filter, setFilter] = useState<ExceptionFilter>("open");
	const [resolving, setResolving] = useState<PaymentException | null>(null);
	const [message, setMessage] = useState<string | null>(null);
	const list = useQuery({
		queryKey: ["payment-exceptions", store.id, "list", filter],
		queryFn: () => exceptionsFor(client, store.id, filter, LIST_LIMIT),
		refetchInterval: 30_000,
	});
	const data = list.data;
	const anyResolved =
		data?.exceptions.some((exception) => exception.status !== "open") ?? false;
	const names = useQuery({
		queryKey: ["roster-names", member.tenant_id],
		queryFn: () => rosterNames(client),
		enabled: anyResolved,
		staleTime: 300_000,
	});
	const reload = () =>
		void queryClient.invalidateQueries({
			queryKey: ["payment-exceptions", store.id],
		});
	const nameOf = (exception: PaymentException) =>
		resolverName(
			exception.resolved_by,
			{ userId, name: member.display_name },
			names.data ?? new Map(),
		) ?? t("paymentExceptions.someone");
	return (
		<div
			className="mx-auto flex max-w-5xl flex-col gap-4"
			data-testid="payment-exceptions-page"
		>
			<PageTitle>{t("paymentExceptions.title")}</PageTitle>
			{data === undefined ? (
				list.isError ? (
					<PlainNote tone="negative" testId="payment-exceptions-failed">
						{t(
							list.error instanceof RpcError && list.error.forbidden
								? "manager.only"
								: "common.failed",
						)}
					</PlainNote>
				) : (
					<Loading label={t("app.loading")} />
				)
			) : (
				<>
					<p className="text-body">{t("paymentExceptions.lead")}</p>
					<dl className="grid grid-cols-2 gap-3 md:grid-cols-4">
						<div className={`${card} flex flex-col gap-1 p-4`}>
							<dt className="text-sm font-bold text-ink-muted">
								{t("paymentExceptions.openCount")}
							</dt>
							<dd
								className="text-[19px] font-bold"
								data-testid="payment-exceptions-open"
							>
								{data.open}
							</dd>
						</div>
					</dl>
					<div className="-mx-4">
						<ChipGroup
							label={t("paymentExceptions.filters")}
							chips={EXCEPTION_FILTERS.map((key) => ({
								key,
								label: t(`paymentExceptions.filter.${key}`),
							}))}
							selected={filter}
							onSelect={(key) => {
								setFilter(key as ExceptionFilter);
								setMessage(null);
							}}
							testId="payment-exceptions-filter"
						/>
					</div>
					{message === null ? null : (
						<PlainNote tone="warning" testId="payment-exceptions-message">
							{message}
						</PlainNote>
					)}
					{data.exceptions.length === 0 ? (
						<PlainNote testId="payment-exceptions-empty">
							{t(`paymentExceptions.empty.${filter}`)}
						</PlainNote>
					) : (
						<ul
							className="flex flex-col gap-3"
							data-testid="payment-exceptions-list"
						>
							{data.exceptions.map((exception) => (
								<Row
									key={exception.id}
									exception={exception}
									resolver={nameOf(exception)}
									onResolve={() => {
										setMessage(null);
										setResolving(exception);
									}}
								/>
							))}
						</ul>
					)}
					{mayHoldMore(data) ? (
						<p
							className="text-sm text-ink-muted"
							data-testid="payment-exceptions-limited"
						>
							{t("paymentExceptions.limited", { count: LIST_LIMIT })}
						</p>
					) : null}
					<p className="text-sm text-ink-muted">
						{t("paymentExceptions.privacy")}
					</p>
				</>
			)}
			{resolving === null ? null : (
				<ResolveDialog
					exception={resolving}
					onClose={() => setResolving(null)}
					onResolved={(words) => {
						setResolving(null);
						show(words);
						reload();
					}}
					onAlready={(words) => {
						setResolving(null);
						setMessage(words);
						reload();
					}}
				/>
			)}
		</div>
	);
}
