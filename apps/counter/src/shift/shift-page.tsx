import { formatVnd } from "@fnb/zalo-mini/format";
import { useI18n } from "@fnb/zalo-mini/i18n";
import { PriceText, StatusPill } from "@fnb/zalo-mini/ui-kit";
import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { type Counts, countTotal, differenceOf } from "../lib/cash";
import { RpcError } from "../lib/rpc";
import { useSession } from "../lib/session";
import { useStore } from "../lib/store";
import { clockOf, dayAndClock } from "../lib/time";
import { AlertIcon, ClockIcon, LockIcon } from "../ui/icons";
import { button, card, field, Loading, PageTitle, PlainNote } from "../ui/kit";
import { useToast } from "../ui/toast";
import {
	type ClockAnswer,
	clockIn,
	clockOut,
	counterCodeOf,
	type Shift,
} from "./api";
import { CashCounter } from "./cash-counter";
import { QrScanButton } from "./qr-scan";
import { useShift } from "./shift-context";

function refusalKey(answer: ClockAnswer): string | null {
	if (answer.state !== "refused") return null;
	return `shift.refusal.${answer.refusal}`;
}

function ClockIn() {
	const { t } = useI18n();
	const { client } = useSession();
	const { store } = useStore();
	const { refresh } = useShift();
	const { show } = useToast();
	const [params] = useSearchParams();
	const [code, setCode] = useState(
		() => counterCodeOf(params.get("ma") ?? "") ?? "",
	);
	const [counts, setCounts] = useState<Counts>({});
	const [busy, setBusy] = useState(false);
	const [message, setMessage] = useState<string | null>(null);
	const token = counterCodeOf(code);
	const opening = countTotal(counts);
	const submit = async () => {
		if (token === null) {
			setMessage(t("shift.codeInvalid"));
			return;
		}
		setBusy(true);
		setMessage(null);
		try {
			const answer = await clockIn(client, store.id, token, opening);
			const key = refusalKey(answer);
			if (key !== null) {
				setMessage(
					answer.state === "refused" && answer.retry_at !== undefined
						? t(key, { time: clockOf(answer.retry_at) })
						: t(key),
				);
			} else {
				show(t("shift.clockedIn"));
				await refresh();
			}
		} catch (error) {
			setMessage(
				t(
					error instanceof RpcError && error.network
						? "common.network"
						: "common.failed",
				),
			);
		} finally {
			setBusy(false);
		}
	};
	return (
		<section
			className={`${card} flex flex-col gap-4 p-5`}
			data-testid="clock-in"
		>
			<h2 className="flex items-center gap-2 text-xl font-extrabold">
				<ClockIcon />
				{t("shift.clockIn")}
			</h2>
			<p className="text-body text-ink-muted">{t("shift.clockInLead")}</p>
			<div className="flex flex-wrap items-end gap-3">
				<label className="flex min-w-64 flex-1 flex-col gap-1">
					<span className="font-bold">{t("shift.counterCode")}</span>
					<input
						className={field}
						value={code}
						autoComplete="off"
						spellCheck={false}
						onChange={(event) => setCode(event.target.value.trim())}
						data-testid="counter-code"
					/>
				</label>
				<QrScanButton onCode={(text) => setCode(counterCodeOf(text) ?? text)} />
			</div>
			<div>
				<h3 className="pb-1 font-bold">{t("shift.openingCash")}</h3>
				<CashCounter counts={counts} onChange={setCounts} testId="opening" />
			</div>
			{message === null ? null : (
				<PlainNote tone="negative" testId="clock-in-message">
					{message}
				</PlainNote>
			)}
			<button
				type="button"
				className={button.primary}
				disabled={busy || code === ""}
				onClick={() => void submit()}
				data-testid="clock-in-submit"
			>
				<ClockIcon />
				{t("shift.clockInButton")}
			</button>
		</section>
	);
}

function DifferenceBox({ shift }: { readonly shift: Shift }) {
	const { t } = useI18n();
	const difference = differenceOf(shift.cash_difference ?? 0);
	return (
		<div
			role="status"
			className={`flex items-start gap-3 rounded-card-xl p-4 ${difference.kind === "matched" ? "bg-positive-soft" : "bg-negative-soft"}`}
			data-testid="cash-difference"
		>
			{difference.kind === "matched" ? null : <AlertIcon />}
			<div className="flex-1">
				<p className="text-lg font-extrabold">
					{difference.kind === "matched"
						? t("shift.matched")
						: t(`shift.${difference.kind}`)}
					{difference.kind === "matched" ? null : (
						<>
							{" "}
							<PriceText amount={difference.amount} tone="ink" />
						</>
					)}
				</p>
				<p className="text-sm">
					{t("shift.expected")}{" "}
					<PriceText amount={shift.expected_cash ?? 0} tone="ink" /> ·{" "}
					{t("shift.counted")}{" "}
					<PriceText amount={shift.counted_cash ?? 0} tone="ink" />
				</p>
			</div>
		</div>
	);
}

function OpenShift({ shift }: { readonly shift: Shift }) {
	const { t } = useI18n();
	const { client } = useSession();
	const { store } = useStore();
	const { refresh } = useShift();
	const { show } = useToast();
	const [counting, setCounting] = useState(false);
	const [counts, setCounts] = useState<Counts>({});
	const [busy, setBusy] = useState(false);
	const [message, setMessage] = useState<string | null>(null);
	const counted = countTotal(counts);
	const awaiting = shift.status === "awaiting_confirmation";
	const submit = async () => {
		setBusy(true);
		setMessage(null);
		try {
			const answer = await clockOut(client, counted);
			const key = refusalKey(answer);
			if (key !== null) {
				setMessage(t(key));
			} else if (answer.state === "closed") {
				show(t("shift.closed"));
				setCounting(false);
			} else {
				setCounting(false);
			}
			await refresh();
		} catch (error) {
			setMessage(
				t(
					error instanceof RpcError && error.network
						? "common.network"
						: "common.failed",
				),
			);
		} finally {
			setBusy(false);
		}
	};
	return (
		<section
			className={`${card} flex flex-col gap-4 p-5`}
			data-testid="open-shift"
		>
			<div className="flex flex-wrap items-center gap-3">
				<h2 className="text-xl font-extrabold">
					{awaiting
						? t("shift.awaitingTitle")
						: t("shift.openTitle", { time: clockOf(shift.clock_in_at) })}
				</h2>
				<StatusPill
					tone={awaiting ? "warning" : "positive"}
					testId="shift-status"
				>
					{t(`shift.status.${shift.status}`)}
				</StatusPill>
			</div>
			<p className="text-body">
				{t("shift.openingCash")}:{" "}
				<PriceText amount={shift.opening_cash} tone="ink" />
				{shift.store_id === store.id ? null : (
					<span className="block text-ink-muted">{t("shift.otherStore")}</span>
				)}
			</p>
			{awaiting ? (
				<>
					<DifferenceBox shift={shift} />
					<div
						className="flex gap-3 rounded-card-xl bg-warning-soft p-4"
						data-testid="manager-needed"
					>
						<LockIcon />
						<div>
							<p className="font-extrabold">{t("shift.managerNeeded")}</p>
							<p className="text-body">{t("shift.managerNeededBody")}</p>
						</div>
					</div>
				</>
			) : null}
			{counting ? (
				<div className="flex flex-col gap-3">
					<h3 className="font-extrabold">{t("shift.countTitle")}</h3>
					<p className="text-sm text-ink-muted">{t("shift.blind")}</p>
					<CashCounter counts={counts} onChange={setCounts} testId="closing" />
					{message === null ? null : (
						<PlainNote tone="negative">{message}</PlainNote>
					)}
					<div className="flex flex-wrap gap-3">
						<button
							type="button"
							className={button.secondary}
							onClick={() => setCounting(false)}
						>
							{t("common.cancel")}
						</button>
						<button
							type="button"
							className={`${button.primary} flex-1`}
							disabled={busy}
							onClick={() => void submit()}
							data-testid="clock-out-submit"
						>
							{t("shift.clockOutWith", { amount: formatVnd(counted) })}
						</button>
					</div>
				</div>
			) : (
				<button
					type="button"
					className={button.primary}
					onClick={() => setCounting(true)}
					data-testid="clock-out"
				>
					{awaiting ? t("shift.recount") : t("shift.clockOut")}
				</button>
			)}
		</section>
	);
}

function MonthAndRecent() {
	const { t } = useI18n();
	const { data } = useShift();
	const { store } = useStore();
	if (data === null) return null;
	const month =
		data.months.find((entry) => entry.store_id === store.id) ?? data.months[0];
	const me = month?.people[0];
	return (
		<section
			className={`${card} flex flex-col gap-3 p-5`}
			data-testid="my-shifts"
		>
			<h2 className="text-lg font-extrabold">{t("shift.month")}</h2>
			<p className="text-2xl font-extrabold" data-testid="worked-days">
				{t("shift.workedDays", {
					days: me?.worked_days ?? 0,
					standard: month?.standard_days ?? 28,
				})}
			</p>
			<h3 className="pt-2 font-bold">{t("shift.recent")}</h3>
			{data.recent.length === 0 ? (
				<PlainNote>{t("shift.noRecent")}</PlainNote>
			) : (
				<ul className="divide-y divide-line">
					{data.recent.map((shift) => (
						<li
							key={shift.id}
							className="flex flex-wrap items-center gap-2 py-2"
						>
							<span className="font-bold">
								{dayAndClock(shift.clock_in_at)}
							</span>
							<span className="text-ink-muted">
								→{" "}
								{shift.clock_out_at === null
									? "…"
									: clockOf(shift.clock_out_at)}
							</span>
							{shift.hours === null ? null : (
								<span className="text-ink-muted">
									{t("shift.hours", { hours: shift.hours })}
								</span>
							)}
							<span className="ml-auto">
								<StatusPill
									tone={shift.status === "closed" ? "neutral" : "warning"}
								>
									{t(`shift.status.${shift.status}`)}
								</StatusPill>
							</span>
						</li>
					))}
				</ul>
			)}
		</section>
	);
}

/** Ca làm: clock in with the counter's QR code and the opening cash; clock out with a blind count (Q02); my month. */
export function ShiftPage() {
	const { t } = useI18n();
	const { data, current, error } = useShift();
	return (
		<div className="mx-auto flex max-w-5xl flex-col gap-4">
			<PageTitle>{t("nav.shift")}</PageTitle>
			{error !== null && data === null ? (
				<PlainNote tone="negative">{t("common.failed")}</PlainNote>
			) : null}
			{data === null ? (
				error === null ? (
					<Loading label={t("app.loading")} />
				) : null
			) : (
				<div className="grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
					{current === null ? (
						<ClockIn />
					) : (
						<OpenShift
							key={`${current.id}-${current.version}`}
							shift={current}
						/>
					)}
					<MonthAndRecent />
				</div>
			)}
		</div>
	);
}
