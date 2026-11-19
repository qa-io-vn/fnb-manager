import { useI18n } from "@fnb/zalo-mini/react";
import {
	type FormEvent,
	useCallback,
	useEffect,
	useId,
	useRef,
	useState,
} from "react";
import type {
	LookupAnswer,
	LookupQuery,
	MemberCard,
	RequestKind,
	Visit,
} from "../loyalty/contract";
import { useLoyaltyAction, useLoyaltyEnv } from "../loyalty/env";
import {
	ENTRY_MAX_DIGITS,
	entryDigits,
	nationalPhone,
	shownPhone,
	signed,
} from "../loyalty/model";
import { FailureAlert, VisitChip } from "../loyalty/parts";
import { LoyaltyFrame, type LoyaltyScreenProps } from "../loyalty/route";
import {
	BusyLabel,
	Card,
	Chip,
	fieldClass,
	Hint,
	Loading,
} from "../shift/parts";
import { primaryButton, secondaryButton } from "../ui";
import { RequestForm } from "./request-form";

type Found = Extract<LookupAnswer, { found: true }>;

function MemberCardView({ card }: { readonly card: MemberCard }) {
	const { t } = useI18n();
	const { formatters } = useLoyaltyEnv();
	return (
		<Card testId="member-card" state={card.status}>
			<div className="flex items-start justify-between gap-2">
				<div className="flex min-w-0 flex-col gap-0.5">
					<p className="text-sm text-ink-muted">{t("lookup.card")}</p>
					<p
						className="text-xl font-semibold tabular-nums text-ink"
						data-testid="member-phone"
					>
						{shownPhone(card.phoneMasked)}
					</p>
					{card.displayName === null ? null : (
						<p className="text-base text-ink">{card.displayName}</p>
					)}
				</div>
				{card.status === "active" ? (
					card.tierName === null ? null : (
						<Chip tone="accent" testId="member-tier">
							{t("lookup.tier", { tier: card.tierName })}
						</Chip>
					)
				) : (
					<Chip tone="negative" testId="member-status">
						{t(`lookup.status.${card.status}`)}
					</Chip>
				)}
			</div>
			<dl className="grid grid-cols-2 gap-3">
				<div className="flex flex-col gap-0.5 rounded-xl bg-surface-sunken p-3">
					<dt className="text-sm text-ink-muted">{t("lookup.stamps")}</dt>
					<dd
						className="text-2xl font-semibold tabular-nums text-ink"
						data-testid="member-stamps"
					>
						{t("lookup.stampsValue", {
							stamps: card.stamps,
							perCard: card.stampsPerCard,
						})}
					</dd>
					{card.stampsPending > 0 ? (
						<dd className="text-sm text-warning">
							{t("lookup.pendingCount", { count: card.stampsPending })}
						</dd>
					) : null}
				</div>
				<div className="flex flex-col gap-0.5 rounded-xl bg-surface-sunken p-3">
					<dt className="text-sm text-ink-muted">{t("lookup.points")}</dt>
					<dd
						className="text-2xl font-semibold tabular-nums text-ink"
						data-testid="member-points"
					>
						{formatters.count(card.points)}
					</dd>
					{card.pointsPending > 0 ? (
						<dd className="text-sm text-warning">
							{t("lookup.pendingCount", { count: card.pointsPending })}
						</dd>
					) : null}
				</div>
			</dl>
			{card.memberSince === null ? null : (
				<p className="text-sm text-ink-muted">
					{t("lookup.since", { date: formatters.date(card.memberSince) })}
				</p>
			)}
		</Card>
	);
}

function VisitRow({ visit }: { readonly visit: Visit }) {
	const { t } = useI18n();
	const { formatters } = useLoyaltyEnv();
	return (
		<li
			className="flex items-start justify-between gap-3 py-3"
			data-testid="visit"
			data-state={visit.state}
		>
			<div className="flex min-w-0 flex-col gap-0.5">
				<p className="text-base font-semibold tabular-nums text-ink">
					{formatters.time(new Date(visit.at))}
					{" · "}
					{t(`lookup.path.${visit.path}`)}
				</p>
				<p className="text-sm text-ink-muted tabular-nums">
					{t("lookup.gain", {
						stamps: signed(visit.stamps),
						points: signed(visit.points),
					})}
					{visit.receiptNo === null
						? ""
						: ` · ${t("lookup.receipt", { receipt: visit.receiptNo })}`}
				</p>
			</div>
			<VisitChip state={visit.state} />
		</li>
	);
}

function FoundView({
	answer,
	onRequest,
	onAnother,
}: {
	readonly answer: Found;
	readonly onRequest: (kind: RequestKind) => void;
	readonly onAnother: () => void;
}) {
	const { t } = useI18n();
	const { store } = useLoyaltyEnv();
	const headingId = useId();
	return (
		<div className="flex flex-col gap-4" data-testid="lookup-found">
			<MemberCardView card={answer.card} />
			<section aria-labelledby={headingId} className="flex flex-col gap-1">
				<h2 id={headingId} className="text-base font-semibold text-ink">
					{t("lookup.today", { store: answer.storeName ?? store.name })}
				</h2>
				{answer.today.length === 0 ? (
					<p className="text-base text-ink-muted" data-testid="visits-none">
						{t("lookup.todayNone")}
					</p>
				) : (
					<ul className="divide-y divide-line" data-testid="visits">
						{answer.today.map((visit) => (
							<VisitRow
								key={`${visit.at}-${visit.path}-${visit.receiptNo ?? ""}`}
								visit={visit}
							/>
						))}
					</ul>
				)}
			</section>
			{answer.card.status === "active" ? (
				<div className="grid grid-cols-2 gap-3">
					<button
						type="button"
						className={secondaryButton}
						onClick={() => onRequest("dispute")}
					>
						{t("lookup.dispute")}
					</button>
					<button
						type="button"
						className={secondaryButton}
						onClick={() => onRequest("adjustment")}
					>
						{t("lookup.adjust")}
					</button>
				</div>
			) : null}
			<button
				type="button"
				className={primaryButton}
				data-action="primary"
				onClick={onAnother}
			>
				{t("lookup.another")}
			</button>
		</div>
	);
}

export function MemberLookupScreen({ open }: LoyaltyScreenProps) {
	const { t } = useI18n();
	const { client, store } = useLoyaltyEnv();
	const action = useLoyaltyAction();
	const inputId = useId();
	const problemId = useId();
	const inputRef = useRef<HTMLInputElement>(null);
	const [value, setValue] = useState("");
	const [problem, setProblem] = useState(false);
	const [answer, setAnswer] = useState<LookupAnswer | null>(null);
	const [request, setRequest] = useState<RequestKind | null>(null);
	const busy = action.busy;
	const { run, clear } = action;

	const lookup = useCallback(
		async (query: LookupQuery) => {
			setProblem(false);
			const result = await run(() => client.lookupMember(store.id, query));
			if (!result.ok) return;
			setAnswer(result.value);
			if (result.value.found) setValue("");
		},
		[run, client, store.id],
	);

	const initial = useRef(open.membershipId);
	useEffect(() => {
		const membershipId = initial.current;
		initial.current = null;
		if (membershipId !== null)
			void lookup({ kind: "membership", membershipId });
	}, [lookup]);

	const submit = (event: FormEvent) => {
		event.preventDefault();
		if (busy) return;
		const phone = nationalPhone(value);
		if (phone === null) {
			setProblem(true);
			setAnswer(null);
			clear();
			inputRef.current?.focus();
			return;
		}
		void lookup({ kind: "phone", phone });
	};

	const another = () => {
		setAnswer(null);
		clear();
		requestAnimationFrame(() => inputRef.current?.focus());
	};

	if (request !== null && answer?.found === true) {
		const card = answer.card;
		return (
			<RequestForm
				kind={request}
				membershipId={card.membershipId}
				phoneMasked={card.phoneMasked}
				limits={answer.limits}
				onBack={() => setRequest(null)}
				onDone={() => {
					setRequest(null);
					void lookup({ kind: "membership", membershipId: card.membershipId });
				}}
			/>
		);
	}

	const found = answer?.found === true ? answer : null;

	return (
		<LoyaltyFrame
			title={t("lookup.title")}
			testId="member-lookup"
			backDisabled={busy}
		>
			{found !== null ? (
				<FoundView answer={found} onRequest={setRequest} onAnother={another} />
			) : busy && open.membershipId !== null && answer === null ? (
				<Loading label={t("lookup.submitting")} />
			) : (
				<form className="flex flex-col gap-3" onSubmit={submit} noValidate>
					<label htmlFor={inputId} className="text-sm text-ink-muted">
						{t("lookup.label")}
					</label>
					<input
						ref={inputRef}
						id={inputId}
						data-testid="lookup-phone"
						value={value}
						onChange={(event) => {
							setValue(entryDigits(event.target.value));
							setProblem(false);
							setAnswer(null);
						}}
						inputMode="numeric"
						pattern="[0-9]*"
						enterKeyHint="search"
						autoComplete="off"
						maxLength={ENTRY_MAX_DIGITS}
						aria-invalid={problem}
						aria-describedby={problem ? problemId : undefined}
						className={`${fieldClass} text-xl tracking-wider tabular-nums`}
					/>
					<Hint>{t("lookup.hint")}</Hint>
					{problem ? (
						<p
							id={problemId}
							role="alert"
							className="rounded-xl bg-negative-soft px-3 py-2 text-base text-negative"
						>
							{t("checkin.problem.phone")}
						</p>
					) : null}
					{answer?.found === false ? (
						<p
							role="alert"
							data-testid="lookup-not-found"
							className="rounded-xl bg-warning-soft px-3 py-2 text-base text-warning"
						>
							{t("lookup.notFound")}
						</p>
					) : null}
					{action.failure === null ? null : (
						<FailureAlert failure={action.failure} />
					)}
					<button
						type="submit"
						className={primaryButton}
						data-action="primary"
						disabled={busy}
						aria-busy={busy}
					>
						<BusyLabel busy={busy} busyText={t("lookup.submitting")}>
							{t("lookup.submit")}
						</BusyLabel>
					</button>
				</form>
			)}
		</LoyaltyFrame>
	);
}
