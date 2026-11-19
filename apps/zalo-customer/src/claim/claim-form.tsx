import {
	CLAIM_WINDOW_HOURS,
	type ClaimResult,
	type CustomerStore,
	type LoyaltyClient,
} from "@fnb/zalo-mini/loyalty";
import { useI18n } from "@fnb/zalo-mini/react";
import {
	type FormEvent,
	type ReactNode,
	useCallback,
	useId,
	useState,
} from "react";
import { useNavigate } from "react-router-dom";
import { useCustomerData, useLoad } from "../data/customer-data";
import { claimDates, shownDate } from "../data/dates";
import type { Failure } from "../data/source";
import { useStoreLink } from "../data/store-link";
import {
	BackButton,
	Badge,
	Failed,
	failureKey,
	fieldClass,
	Loading,
	primaryButton,
	Screen,
	Spinner,
	secondaryButton,
} from "../ui";
import { StorePicker } from "../wallet/member-code-screen";
import { MemberOnly } from "../wallet/wallet-screen";
import {
	type ClaimDraft,
	type ClaimField,
	claimInput,
	claimProblems,
	claimReasonKey,
	cleanAmount,
	cleanReceiptNo,
	groupedAmount,
} from "./model";

function Field({
	id,
	label,
	problem,
	children,
}: {
	readonly id: string;
	readonly label: string;
	readonly problem: string | null;
	readonly children: ReactNode;
}) {
	return (
		<div className="flex flex-col gap-1">
			<label htmlFor={id} className="text-sm text-ink-muted">
				{label}
			</label>
			{children}
			{problem === null ? null : (
				<p id={`${id}-problem`} className="text-sm text-negative">
					{problem}
				</p>
			)}
		</div>
	);
}

export function ClaimFormView({
	stores,
	initialStore,
	claimsLeft,
	dates,
	onSubmit,
}: {
	readonly stores: readonly CustomerStore[];
	readonly initialStore: string | null;
	readonly claimsLeft: number | null;
	readonly dates: readonly string[];
	readonly onSubmit: (
		draft: ClaimDraft,
	) => Promise<{ readonly failure: Failure } | null>;
}) {
	const { t } = useI18n();
	const [draft, setDraft] = useState<ClaimDraft>({
		store: initialStore,
		receiptNo: "",
		amount: "",
		businessDate: dates[0] ?? "",
	});
	const [shown, setShown] = useState(false);
	const [busy, setBusy] = useState(false);
	const [failure, setFailure] = useState<Failure | null>(null);
	const receiptId = useId();
	const amountId = useId();
	const dateId = useId();
	const problems = claimProblems(draft, dates);
	const problem = (field: ClaimField) => {
		const key = problems[field];
		return shown && key !== undefined ? t(key) : null;
	};
	const limitReached = claimsLeft !== null && claimsLeft <= 0;
	const update = (change: Partial<ClaimDraft>) =>
		setDraft((current) => ({ ...current, ...change }));
	const submit = async (event: FormEvent) => {
		event.preventDefault();
		setShown(true);
		if (busy || limitReached || claimInput(draft, dates) === null) return;
		setBusy(true);
		setFailure(null);
		const outcome = await onSubmit(draft);
		setBusy(false);
		if (outcome !== null) setFailure(outcome.failure);
	};
	return (
		<form
			className="flex flex-col gap-4"
			onSubmit={submit}
			noValidate
			data-testid="claim-form"
		>
			<StorePicker
				stores={stores}
				value={draft.store}
				onChange={(store) => update({ store })}
				label={t("claim.store")}
				testId="claim-store"
			/>
			{problem("store") === null ? null : (
				<p className="text-sm text-negative">{problem("store")}</p>
			)}
			<Field
				id={receiptId}
				label={t("claim.receiptNo")}
				problem={problem("receiptNo")}
			>
				<input
					id={receiptId}
					value={draft.receiptNo}
					onChange={(event) =>
						update({ receiptNo: cleanReceiptNo(event.target.value) })
					}
					autoCapitalize="characters"
					autoComplete="off"
					enterKeyHint="next"
					maxLength={32}
					aria-invalid={problem("receiptNo") !== null}
					aria-describedby={
						problem("receiptNo") === null
							? `${receiptId}-hint`
							: `${receiptId}-problem`
					}
					className={fieldClass}
					data-testid="claim-receipt"
				/>
				<p id={`${receiptId}-hint`} className="text-sm text-ink-muted">
					{t("claim.receiptHint")}
				</p>
			</Field>
			<Field
				id={amountId}
				label={t("claim.amount")}
				problem={problem("amount")}
			>
				<input
					id={amountId}
					value={groupedAmount(draft.amount)}
					onChange={(event) =>
						update({ amount: cleanAmount(event.target.value) })
					}
					inputMode="numeric"
					autoComplete="off"
					enterKeyHint="done"
					aria-invalid={problem("amount") !== null}
					aria-describedby={
						problem("amount") === null ? undefined : `${amountId}-problem`
					}
					className={fieldClass}
					data-testid="claim-amount"
				/>
			</Field>
			<Field
				id={dateId}
				label={t("claim.date")}
				problem={problem("businessDate")}
			>
				<select
					id={dateId}
					value={draft.businessDate}
					onChange={(event) => update({ businessDate: event.target.value })}
					className={fieldClass}
					data-testid="claim-date"
				>
					{dates.map((date, index) => (
						<option key={date} value={date}>
							{index === 0
								? t("claim.today", { date: shownDate(date) })
								: index === 1
									? t("claim.yesterday", { date: shownDate(date) })
									: shownDate(date)}
						</option>
					))}
				</select>
			</Field>
			{claimsLeft === null ? null : (
				<p
					className={`text-base ${limitReached ? "text-negative" : "text-ink"}`}
					data-testid="claims-left"
					role={limitReached ? "alert" : undefined}
				>
					{limitReached
						? t("claim.limitReached")
						: t("claim.left", { count: claimsLeft })}
				</p>
			)}
			{failure === null ? null : (
				<p role="alert" className="text-base text-negative">
					{t(failureKey(failure))}
				</p>
			)}
			<button
				type="submit"
				className={primaryButton}
				disabled={busy || limitReached}
				aria-busy={busy}
			>
				{busy ? <Spinner /> : null}
				{busy ? t("claim.sending") : t("claim.send")}
			</button>
		</form>
	);
}

export function ClaimResultView({
	result,
	onAnother,
}: {
	readonly result: ClaimResult;
	readonly onAnother: () => void;
}) {
	const { t } = useI18n();
	const navigate = useNavigate();
	const tone =
		result.state === "matched"
			? "positive"
			: result.state === "pending" || result.state === "queued"
				? "pending"
				: "negative";
	return (
		<div
			className="flex flex-col gap-4"
			data-testid="claim-result"
			data-state={result.state}
		>
			<div role="status" className="flex flex-col gap-2">
				<h2 className="text-lg font-semibold text-ink">
					{t(`claim.result.${result.state}.title`)}
				</h2>
				<Badge tone={tone}>{t(`claim.state.${result.state}`)}</Badge>
				<p className="text-base text-ink">
					{result.reason === null
						? t(`claim.result.${result.state}.body`)
						: t(claimReasonKey(result.reason))}
				</p>
			</div>
			<p className="text-base text-ink" data-testid="claims-left-after">
				{result.claimsLeftToday > 0
					? t("claim.left", { count: result.claimsLeftToday })
					: t("claim.limitReached")}
			</p>
			<button
				type="button"
				className={primaryButton}
				onClick={() => navigate("/the-thanh-vien")}
			>
				{t("home.openCard")}
			</button>
			{result.claimsLeftToday > 0 ? (
				<button type="button" className={secondaryButton} onClick={onAnother}>
					{t("claim.another")}
				</button>
			) : null}
		</div>
	);
}

function ClaimView() {
	const { t } = useI18n();
	const { home, reloadHome, client, recover } = useCustomerData();
	const { currentStore } = useStoreLink();
	const loadWallet = useCallback(
		(active: LoyaltyClient) => active.wallet(),
		[],
	);
	const wallet = useLoad(loadWallet);
	const [result, setResult] = useState<ClaimResult | null>(null);
	const [round, setRound] = useState(0);
	if (home.status === "loading") return <Loading />;
	if (home.status === "failed")
		return <Failed failure={home.failure} onRetry={reloadHome} />;
	const stores = home.data.stores;
	const dates = claimDates(
		Date.now(),
		home.data.programme?.claimWindowHours ?? CLAIM_WINDOW_HOURS,
	);
	const initialStore =
		stores.find((store) => store.code === currentStore)?.code ??
		(stores.length === 1 ? (stores[0]?.code ?? null) : null);
	const claimsLeft =
		wallet.state.status === "ready"
			? Math.max(
					0,
					wallet.state.data.claimsPerDay - wallet.state.data.claimsToday,
				)
			: null;
	const submit = async (draft: ClaimDraft) => {
		const input = claimInput(draft, dates);
		if (input === null || client === null)
			return { failure: "unknown" as const };
		try {
			setResult(await client.submitClaim(input));
			return null;
		} catch (error) {
			return { failure: recover(error) };
		}
	};
	return (
		<Screen testId="claim">
			<BackButton />
			<h1 className="text-xl font-semibold text-ink">{t("claim.title")}</h1>
			{result === null ? (
				<>
					<p className="text-base text-ink">{t("claim.intro")}</p>
					<ClaimFormView
						key={round}
						stores={stores}
						initialStore={initialStore}
						claimsLeft={claimsLeft}
						dates={dates}
						onSubmit={submit}
					/>
				</>
			) : (
				<ClaimResultView
					result={result}
					onAnother={() => {
						setResult(null);
						setRound((value) => value + 1);
						wallet.reload();
					}}
				/>
			)}
		</Screen>
	);
}

export function ClaimScreen() {
	return (
		<MemberOnly next="claim">
			<ClaimView />
		</MemberOnly>
	);
}
