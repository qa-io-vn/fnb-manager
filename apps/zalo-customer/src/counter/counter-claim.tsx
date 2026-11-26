import { refusalCode } from "@fnb/zalo-mini";
import {
	type CounterClaimResult,
	type CounterQr,
	REFUSAL_INVALID,
} from "@fnb/zalo-mini/loyalty";
import { useI18n } from "@fnb/zalo-mini/react";
import { type FormEvent, useId, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
	billNoProblem,
	counterRefusalKey,
	readScan,
	rescanAfter,
	totalProblem,
	typedTotal,
} from "../bills/model";
import { cleanAmount, cleanReceiptNo, groupedAmount } from "../claim/model";
import { useCustomerData } from "../data/customer-data";
import { shownInstant } from "../data/dates";
import {
	BackButton,
	Badge,
	failureKey,
	fieldClass,
	primaryButton,
	Screen,
	Spinner,
	secondaryButton,
} from "../ui";
import { MemberOnly } from "../wallet/wallet-screen";
import { deviceScan, type Scan } from "./scan";

type Step =
	| { readonly kind: "scan"; readonly notice: string | null }
	| { readonly kind: "form"; readonly qr: CounterQr }
	| {
			readonly kind: "result";
			readonly billNo: string;
			readonly result: CounterClaimResult;
	  };

const STATE_TONES = {
	confirmed: "positive",
	awaiting_staff: "pending",
	refused: "negative",
} as const;

function signed(value: number): string {
	return value > 0 ? `+${value}` : String(value);
}

function at(instant: number | null): string {
	return instant === null ? "" : shownInstant(new Date(instant).toISOString());
}

function ScanStep({
	scan,
	notice,
	onScanned,
}: {
	readonly scan: Scan;
	readonly notice: string | null;
	readonly onScanned: (qr: CounterQr | null, refused: boolean) => void;
}) {
	const { t } = useI18n();
	const [busy, setBusy] = useState(false);
	const start = async () => {
		if (busy) return;
		setBusy(true);
		const scanned = await scan();
		setBusy(false);
		if (scanned.kind === "cancelled") return;
		if (scanned.kind === "refused") {
			onScanned(null, true);
			return;
		}
		const reading = readScan(scanned.content);
		onScanned(reading.kind === "counter" ? reading.qr : null, false);
	};
	return (
		<div className="flex flex-col gap-4" data-testid="counter-scan">
			<p className="text-body text-ink">{t("counter.intro")}</p>
			{notice === null ? null : (
				<p
					role="alert"
					className="rounded-card-xl bg-negative-soft px-3 py-2 text-body text-ink"
					data-testid="counter-notice"
				>
					{t(notice)}
				</p>
			)}
			<button
				type="button"
				className={primaryButton}
				onClick={() => void start()}
				disabled={busy}
				aria-busy={busy}
				data-testid="counter-scan-button"
			>
				{busy ? <Spinner /> : null}
				{busy ? t("counter.scanning") : t("counter.scan")}
			</button>
		</div>
	);
}

function FormStep({
	qr,
	onRescan,
	onResult,
}: {
	readonly qr: CounterQr;
	readonly onRescan: () => void;
	readonly onResult: (billNo: string, result: CounterClaimResult) => void;
}) {
	const { t } = useI18n();
	const { home, client, recover } = useCustomerData();
	const [billNo, setBillNo] = useState("");
	const [digits, setDigits] = useState("");
	const [shown, setShown] = useState(false);
	const [busy, setBusy] = useState(false);
	const [failure, setFailure] = useState<string | null>(null);
	const billId = useId();
	const totalId = useId();
	const store =
		home.status === "ready"
			? home.data.stores.find((candidate) => candidate.code === qr.storeCode)
			: undefined;
	const billProblem = shown ? billNoProblem(billNo) : null;
	const amountProblem = shown ? totalProblem(digits) : null;
	const submit = async (event: FormEvent) => {
		event.preventDefault();
		setShown(true);
		const total = typedTotal(digits);
		if (
			busy ||
			client === null ||
			total === null ||
			billNoProblem(billNo) !== null
		)
			return;
		setBusy(true);
		setFailure(null);
		try {
			const result = await client.submitCounterClaim({
				qr: qr.payload,
				billNo,
				total,
			});
			setBusy(false);
			onResult(billNo, result);
		} catch (error) {
			setBusy(false);
			setFailure(
				refusalCode(error) === REFUSAL_INVALID
					? "counter.invalid"
					: failureKey(recover(error)),
			);
		}
	};
	return (
		<form
			className="flex flex-col gap-4"
			onSubmit={submit}
			noValidate
			data-testid="counter-form"
		>
			<p
				className="rounded-card-xl bg-positive-soft px-3 py-2 text-body text-ink"
				data-testid="counter-store"
			>
				{t("counter.scanned", {
					store: store?.name ?? t("counter.unknownStore"),
				})}
			</p>
			<div className="flex flex-col gap-1">
				<label htmlFor={billId} className="text-sm text-ink-muted">
					{t("counter.billNo")}
				</label>
				<input
					id={billId}
					value={billNo}
					onChange={(event) => setBillNo(cleanReceiptNo(event.target.value))}
					autoCapitalize="characters"
					autoComplete="off"
					enterKeyHint="next"
					aria-invalid={billProblem !== null}
					aria-describedby={
						billProblem === null ? undefined : `${billId}-problem`
					}
					className={fieldClass}
					data-testid="counter-bill-no"
				/>
				{billProblem === null ? null : (
					<p id={`${billId}-problem`} className="text-sm text-negative">
						{t(billProblem)}
					</p>
				)}
			</div>
			<div className="flex flex-col gap-1">
				<label htmlFor={totalId} className="text-sm text-ink-muted">
					{t("counter.total")}
				</label>
				<input
					id={totalId}
					value={groupedAmount(digits)}
					onChange={(event) => setDigits(cleanAmount(event.target.value))}
					inputMode="numeric"
					autoComplete="off"
					enterKeyHint="done"
					aria-invalid={amountProblem !== null}
					aria-describedby={
						amountProblem === null ? undefined : `${totalId}-problem`
					}
					className={fieldClass}
					data-testid="counter-total"
				/>
				{amountProblem === null ? null : (
					<p id={`${totalId}-problem`} className="text-sm text-negative">
						{t(amountProblem)}
					</p>
				)}
			</div>
			{failure === null ? null : (
				<p role="alert" className="text-body text-negative">
					{t(failure)}
				</p>
			)}
			<button
				type="submit"
				className={primaryButton}
				disabled={busy}
				aria-busy={busy}
			>
				{busy ? <Spinner /> : null}
				{busy ? t("counter.sending") : t("counter.send")}
			</button>
			<button
				type="button"
				className={secondaryButton}
				disabled={busy}
				onClick={onRescan}
			>
				{t("counter.rescan")}
			</button>
		</form>
	);
}

export function CounterResultView({
	billNo,
	result,
	onAnother,
}: {
	readonly billNo: string;
	readonly result: CounterClaimResult;
	readonly onAnother: () => void;
}) {
	const { t } = useI18n();
	const navigate = useNavigate();
	const earned = [
		result.stampsEarned === null || result.stampsEarned === 0
			? null
			: t("wallet.stampsDelta", { count: signed(result.stampsEarned) }),
		result.pointsEarned === null || result.pointsEarned === 0
			? null
			: t("wallet.pointsDelta", { count: signed(result.pointsEarned) }),
	].filter((part): part is string => part !== null);
	const body =
		result.state === "refused"
			? t(counterRefusalKey(result.refusal), { time: at(result.retryAt) })
			: t(`counter.result.${result.state}.body`, {
					bill: billNo,
					time: at(result.expiresAt),
				});
	return (
		<div
			className="flex flex-col gap-4"
			data-testid="counter-result"
			data-state={result.state}
			data-refusal={result.refusal ?? undefined}
		>
			<div role="status" className="flex flex-col gap-2">
				<h2 className="text-lg font-semibold text-ink">
					{t(`counter.result.${result.state}.title`)}
				</h2>
				<Badge tone={STATE_TONES[result.state]}>
					{result.state === "confirmed"
						? t("claim.state.matched")
						: result.state === "awaiting_staff"
							? t("claim.state.pending")
							: t("claim.state.rejected")}
				</Badge>
				<p className="text-body text-ink" data-testid="counter-result-body">
					{body}
				</p>
				{earned.length === 0 ? null : (
					<p className="text-body text-ink" data-testid="counter-earned">
						{earned.join(" · ")}
					</p>
				)}
			</div>
			<button
				type="button"
				className={primaryButton}
				onClick={() => navigate("/the-thanh-vien")}
			>
				{t("home.openCard")}
			</button>
			<button type="button" className={secondaryButton} onClick={onAnother}>
				{rescanAfter(result) ? t("counter.rescan") : t("counter.another")}
			</button>
		</div>
	);
}

export function CounterClaimView({ scan }: { readonly scan?: Scan }) {
	const { t } = useI18n();
	const device = useMemo(() => scan ?? deviceScan(), [scan]);
	const [step, setStep] = useState<Step>({ kind: "scan", notice: null });
	return (
		<Screen testId="counter-claim">
			<BackButton />
			<h1 className="text-xl font-semibold text-ink">{t("counter.title")}</h1>
			{step.kind === "scan" ? (
				<ScanStep
					scan={device}
					notice={step.notice}
					onScanned={(qr, refused) =>
						setStep(
							qr !== null
								? { kind: "form", qr }
								: {
										kind: "scan",
										notice: refused
											? "counter.scanRefused"
											: "counter.notCounter",
									},
						)
					}
				/>
			) : step.kind === "form" ? (
				<FormStep
					qr={step.qr}
					onRescan={() => setStep({ kind: "scan", notice: null })}
					onResult={(billNo, result) =>
						setStep({ kind: "result", billNo, result })
					}
				/>
			) : (
				<CounterResultView
					billNo={step.billNo}
					result={step.result}
					onAnother={() => setStep({ kind: "scan", notice: null })}
				/>
			)}
		</Screen>
	);
}

export function CounterClaimScreen() {
	return (
		<MemberOnly next="claim">
			<CounterClaimView />
		</MemberOnly>
	);
}
