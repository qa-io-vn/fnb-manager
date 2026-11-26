import { ResultModal, useI18n } from "@fnb/zalo-mini/react";
import {
	type FormEvent,
	useCallback,
	useEffect,
	useId,
	useMemo,
	useState,
} from "react";
import {
	MAX_REASON_LENGTH,
	type QueueItem,
	type QueueOutcomeState,
} from "../loyalty/contract";
import { useLoyaltyAction, useLoyaltyEnv } from "../loyalty/env";
import {
	isOverdue,
	isoDayIn,
	shownPhone,
	signed,
	sortQueue,
} from "../loyalty/model";
import { FailureAlert } from "../loyalty/parts";
import { LoyaltyFrame, type LoyaltyScreenProps } from "../loyalty/route";
import { AdjustmentField } from "../member-lookup/adjustment-field";
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
import { primaryButton, secondaryButton } from "../ui";
import {
	ageHours,
	choiceKey,
	choicesOf,
	initialDraft,
	needsAmount,
	outcomeKey,
	type QueueDraft,
	type QueueProblem,
	queueAction,
} from "./loyalty-items";

type QueueLoad =
	| { readonly status: "loading" }
	| { readonly status: "ready"; readonly items: readonly QueueItem[] }
	| { readonly status: "failed"; readonly failure: Failure };

function useWhen() {
	const { formatters, context } = useLoyaltyEnv();
	return useCallback(
		(iso: string) => {
			const instant = new Date(iso);
			return {
				time: formatters.time(instant),
				date: formatters.date(isoDayIn(instant, context.timeZone)),
			};
		},
		[formatters, context.timeZone],
	);
}

function ItemSummary({
	item,
	now,
}: {
	readonly item: QueueItem;
	readonly now: Date;
}) {
	const { t } = useI18n();
	const when = useWhen();
	const overdue = isOverdue(item, now);
	return (
		<>
			<div className="flex flex-wrap items-center gap-2">
				<Chip tone={item.kind === "match" ? "neutral" : "accent"}>
					{t(`queue.kind.${item.kind}`)}
				</Chip>
				{overdue ? (
					<Chip tone="negative" testId="queue-overdue">
						{t("queue.overdue", { hours: ageHours(item, now) })}
					</Chip>
				) : null}
			</div>
			<p
				className="text-body font-semibold text-ink"
				data-testid="queue-member"
			>
				{t("loyalty.member", { phone: shownPhone(item.phoneMasked) })}
			</p>
			{item.kind === "match" ? null : (
				<p className="text-body text-ink tabular-nums">
					{t("queue.amounts", {
						stamps: signed(item.stamps),
						points: signed(item.points),
					})}
				</p>
			)}
			{item.reason === null ? null : (
				<p className="whitespace-pre-line text-body text-ink">{item.reason}</p>
			)}
			<p className="text-sm text-ink-muted">
				{item.requestedBy === null
					? t("queue.createdAt", when(item.createdAt))
					: t("queue.createdBy", {
							...when(item.createdAt),
							name: item.requestedBy,
						})}
			</p>
		</>
	);
}

function problemKey(problem: QueueProblem): string {
	if (problem.field === "choice") return "queue.problem.choice";
	if (problem.field === "reason")
		return problem.problem === "long"
			? "request.problem.reasonLong"
			: "queue.problem.reason";
	return `request.problem.${problem.problem}`;
}

function ChoiceOption({
	name,
	value,
	checked,
	disabled,
	label,
	onChoose,
}: {
	readonly name: string;
	readonly value: string;
	readonly checked: boolean;
	readonly disabled: boolean;
	readonly label: string;
	readonly onChoose: (value: string) => void;
}) {
	return (
		<label
			className={`relative flex min-h-12 items-center gap-3 rounded-control-xl border-field px-3 py-2 text-body text-ink ${checked ? "border-accent bg-surface-sunken" : "border-line-strong"} has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-focus`}
		>
			<input
				type="radio"
				name={name}
				value={value}
				checked={checked}
				disabled={disabled}
				onChange={() => onChoose(value)}
				className="absolute inset-0 m-0 size-full cursor-pointer appearance-none rounded-field opacity-0 disabled:cursor-default"
			/>
			<span
				aria-hidden="true"
				className={`flex size-5 shrink-0 items-center justify-center rounded-full border-2 ${checked ? "border-accent" : "border-ink-muted"}`}
			>
				{checked ? <span className="size-2.5 rounded-full bg-accent" /> : null}
			</span>
			<span className="tabular-nums">{label}</span>
		</label>
	);
}

function ItemDetail({
	item,
	now,
	onBack,
	onDone,
}: {
	readonly item: QueueItem;
	readonly now: Date;
	readonly onBack: () => void;
	readonly onDone: () => void;
}) {
	const { t } = useI18n();
	const { client, formatters } = useLoyaltyEnv();
	const action = useLoyaltyAction();
	const name = useId();
	const legendId = useId();
	const reasonId = useId();
	const [draft, setDraft] = useState<QueueDraft>(() => initialDraft(item));
	const [problems, setProblems] = useState<readonly QueueProblem[]>([]);
	const [done, setDone] = useState<QueueOutcomeState | null>(null);
	const busy = action.busy;
	const change = (patch: Partial<QueueDraft>) => {
		setDraft((current) => ({ ...current, ...patch }));
		setProblems([]);
	};
	const submit = async (event: FormEvent) => {
		event.preventDefault();
		if (busy) return;
		const check = queueAction(item, draft);
		if (!check.ok) {
			setProblems(check.problems);
			return;
		}
		const result = await action.run(() => client.act(check.action));
		if (result.ok) setDone(result.value.state);
	};
	const candidateLabel = (invoiceId: string) => {
		const candidate = item.match?.candidates.find(
			(entry) => entry.invoiceId === invoiceId,
		);
		if (candidate === undefined) return t("queue.match.none");
		return t("queue.match.candidate", {
			receipt: candidate.receiptNo ?? t("queue.match.noReceipt"),
			time: formatters.time(new Date(candidate.soldAt)),
			amount: formatters.moneyExact(candidate.amount),
		});
	};
	const closed = action.failure === "invalid" || action.failure === "state";
	return (
		<SubScreen
			title={t(`queue.kind.${item.kind}`)}
			subtitle={t("loyalty.member", { phone: shownPhone(item.phoneMasked) })}
			onBack={onBack}
			backDisabled={busy}
			testId="queue-item"
		>
			<Card testId="queue-item-summary" state={item.kind}>
				<ItemSummary item={item} now={now} />
				{item.kind === "match" && item.match !== null ? (
					<Hint>
						{t("queue.match.body", {
							time:
								item.match.recordedAt === null
									? "—"
									: formatters.time(new Date(item.match.recordedAt)),
						})}
					</Hint>
				) : null}
			</Card>
			<form
				className="flex flex-col gap-4"
				onSubmit={(event) => void submit(event)}
				noValidate
			>
				<fieldset
					className="flex flex-col gap-2"
					aria-labelledby={legendId}
					data-testid="queue-choices"
				>
					<legend id={legendId} className="mb-1 text-sm text-ink-muted">
						{item.kind === "match"
							? t("queue.match.choose")
							: t("queue.decision")}
					</legend>
					{choicesOf(item).map((choice) => (
						<ChoiceOption
							key={choice}
							name={name}
							value={choice}
							checked={draft.choice === choice}
							disabled={busy}
							label={
								item.kind === "match" && choice !== "none"
									? candidateLabel(choice)
									: t(choiceKey(item.kind, choice))
							}
							onChoose={(value) => change({ choice: value })}
						/>
					))}
				</fieldset>
				{needsAmount(item, draft) ? (
					<div className="grid grid-cols-1 gap-3">
						<AdjustmentField
							label={t("request.stamps")}
							value={draft.stamps}
							disabled={busy}
							testId="queue-stamps"
							onChange={(stamps) => change({ stamps })}
						/>
						<AdjustmentField
							label={t("request.points")}
							value={draft.points}
							disabled={busy}
							testId="queue-points"
							onChange={(points) => change({ points })}
						/>
					</div>
				) : null}
				<div className="flex flex-col gap-1">
					<label htmlFor={reasonId} className="text-sm text-ink-muted">
						{t("queue.reason")}
					</label>
					<textarea
						id={reasonId}
						data-testid="queue-reason"
						value={draft.reason}
						disabled={busy}
						onChange={(event) => change({ reason: event.target.value })}
						maxLength={MAX_REASON_LENGTH}
						rows={3}
						className={`${fieldClass} min-h-24`}
					/>
					<Hint>{t("queue.reasonHint")}</Hint>
				</div>
				{problems.map((problem) => (
					<Alert key={problem.field} testId={`queue-problem-${problem.field}`}>
						{t(problemKey(problem))}
					</Alert>
				))}
				{action.failure === null ? null : closed ? (
					<Alert testId="queue-closed">{t("queue.error.closed")}</Alert>
				) : (
					<FailureAlert failure={action.failure} />
				)}
				<button
					type="submit"
					className={primaryButton}
					data-action="primary"
					disabled={busy}
					aria-busy={busy}
				>
					<BusyLabel busy={busy} busyText={t("queue.confirming")}>
						{t("queue.confirm")}
					</BusyLabel>
				</button>
			</form>
			{done === null ? null : (
				<ResultModal message={t(outcomeKey(done))} onDone={onDone} />
			)}
		</SubScreen>
	);
}

function QueueList({
	items,
	now,
	onOpen,
	onHome,
}: {
	readonly items: readonly QueueItem[];
	readonly now: Date;
	readonly onOpen: (item: QueueItem) => void;
	readonly onHome: () => void;
}) {
	const { t } = useI18n();
	const sorted = useMemo(() => sortQueue(items, now), [items, now]);
	if (sorted.length === 0) {
		return (
			<div className="flex flex-col gap-3" data-testid="queue-empty">
				<p className="text-body text-ink-muted">{t("queue.empty")}</p>
				<button
					type="button"
					className={primaryButton}
					data-action="primary"
					onClick={onHome}
				>
					{t("loyalty.backHome")}
				</button>
			</div>
		);
	}
	return (
		<ul className="flex flex-col gap-3" data-testid="queue-list">
			{sorted.map((item, index) => (
				<li
					key={item.id}
					data-testid="queue-card"
					data-kind={item.kind}
					data-overdue={isOverdue(item, now)}
				>
					<Card>
						<ItemSummary item={item} now={now} />
						<button
							type="button"
							className={index === 0 ? primaryButton : secondaryButton}
							{...(index === 0 ? { "data-action": "primary" } : {})}
							onClick={() => onOpen(item)}
							aria-label={t("queue.openItem", {
								kind: t(`queue.kind.${item.kind}`),
								phone: shownPhone(item.phoneMasked),
							})}
						>
							{t("queue.open")}
						</button>
					</Card>
				</li>
			))}
		</ul>
	);
}

export function LoyaltyQueueScreen(_: LoyaltyScreenProps) {
	const { t } = useI18n();
	const { client, store, manager, recover, home } = useLoyaltyEnv();
	const [load, setLoad] = useState<QueueLoad>({ status: "loading" });
	const [open, setOpen] = useState<QueueItem | null>(null);
	const [now, setNow] = useState(() => new Date());
	const reload = useCallback(() => {
		let active = true;
		setLoad((current) =>
			current.status === "ready" ? current : { status: "loading" },
		);
		client.queue(store.id).then(
			(items) => {
				if (!active) return;
				setNow(new Date());
				setLoad({ status: "ready", items });
			},
			(error: unknown) => {
				if (active) setLoad({ status: "failed", failure: recover(error) });
			},
		);
		return () => {
			active = false;
		};
	}, [client, store.id, recover]);
	useEffect(() => {
		if (manager) return reload();
	}, [manager, reload]);

	if (!manager) {
		return (
			<LoyaltyFrame title={t("queue.title")} testId="loyalty-queue">
				<div data-testid="queue-refused" className="flex flex-col gap-3">
					<p className="text-body text-ink">{t("queue.managersOnly")}</p>
					<button
						type="button"
						className={primaryButton}
						data-action="primary"
						onClick={home}
					>
						{t("loyalty.backHome")}
					</button>
				</div>
			</LoyaltyFrame>
		);
	}

	if (open !== null) {
		return (
			<ItemDetail
				key={open.id}
				item={open}
				now={now}
				onBack={() => setOpen(null)}
				onDone={() => {
					setOpen(null);
					reload();
				}}
			/>
		);
	}

	return (
		<LoyaltyFrame title={t("queue.title")} testId="loyalty-queue">
			<div data-testid="queue" data-status={load.status} className="contents">
				{load.status === "loading" ? (
					<Loading label={t("queue.loading")} />
				) : load.status === "failed" ? (
					<div className="flex flex-col gap-2">
						<Alert testId="queue-failed">{t(failureKey(load.failure))}</Alert>
						<button
							type="button"
							className={primaryButton}
							data-action="primary"
							onClick={reload}
						>
							{t("ops.retry")}
						</button>
					</div>
				) : (
					<QueueList
						items={load.items}
						now={now}
						onOpen={setOpen}
						onHome={home}
					/>
				)}
			</div>
		</LoyaltyFrame>
	);
}
