import type { TakeawaySlot, TakeawaySlots } from "@fnb/zalo-mini/ordering";
import { kitButton, StickyActionBar, useI18n } from "@fnb/zalo-mini/react";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { useCustomerData } from "../data/customer-data";
import { isoDateIn, weekdayOf } from "../data/dates";
import { useNow } from "../data/use-now";
import { spansText } from "../home/model";
import { Loading } from "../ui";
import { refusalKey } from "./order-view";
import { useOrdering } from "./ordering-data";
import { ClockIcon, clock, FlowBack, Notice, Panel, Problem } from "./parts";
import {
	choiceStillFree,
	dateLine,
	groupSlots,
	minutesUntil,
	nearestFree,
	type PickupChoice,
	pickupWords,
	relativeDay,
	shownSlots,
} from "./takeaway";

// C17 Chọn giờ lấy món (missing-screens 5.6; ADR-072). The server answers the slots of the one day a customer may book,
// on its own clock: today from now plus the preparation time while the store is open, else from its next opening (the
// closed frame, C15's pattern without the art); a full slot stays in place, marked "Hết chỗ" in words, and cannot be
// chosen. "Tiếp tục thanh toán" takes the choice back to C05, which places the order; the server checks the time again
// and, when the slot filled meanwhile or the time passed, the customer comes back here with the reason (frame 3). With
// an order id the screen moves that unpaid order to another slot instead (the time passed while paying).

/** Why the customer was sent back here: the server's refusal of the time they chose, and that time. */
export interface PickupLocationState {
	readonly problem?:
		| "slot_full"
		| "slot_passed"
		| "closed"
		| "pickup_time_invalid";
	readonly at?: string | null;
}

type SlotsLoad =
	| { readonly status: "loading" }
	| { readonly status: "ready"; readonly slots: TakeawaySlots }
	| { readonly status: "failed" };

/** How often the slots are asked again while the screen is open (a slot can fill, or pass). */
const SLOTS_POLL_MS = 30_000;

function sameInstant(a: string, b: string): boolean {
	return Date.parse(a) === Date.parse(b);
}

function SlotChip({
	slot,
	name,
	selected,
	onChoose,
}: {
	readonly slot: TakeawaySlot;
	readonly name: string;
	readonly selected: boolean;
	readonly onChoose: () => void;
}) {
	const { t } = useI18n();
	const full = !slot.available;
	const time = clock(slot.start);
	return (
		<label
			className={`relative flex min-h-12 flex-col items-center justify-center rounded-full border-field px-2 text-center leading-tight has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-focus ${
				full
					? "border-line bg-surface-sunken text-ink-muted"
					: selected
						? "cursor-pointer border-ink bg-ink text-surface-raised"
						: "cursor-pointer border-line-strong bg-surface-raised text-ink"
			}`}
			data-testid="pickup-slot"
			data-at={slot.start}
			data-full={full}
			data-selected={selected}
		>
			<input
				type="radio"
				name={name}
				value={slot.start}
				checked={selected}
				aria-disabled={full || undefined}
				aria-label={full ? t("pickup.slotFullName", { time }) : time}
				onChange={() => {
					if (!full) onChoose();
				}}
				className="absolute inset-0 m-0 size-full cursor-pointer appearance-none rounded-full opacity-0"
			/>
			<span aria-hidden="true" className="text-[15px] font-bold tabular-nums">
				{time}
			</span>
			{full ? (
				<span aria-hidden="true" className="text-xs font-bold">
					{t("pickup.full")}
				</span>
			) : null}
		</label>
	);
}

export function PickupScreen() {
	const { t } = useI18n();
	const navigate = useNavigate();
	const location = useLocation();
	const { id = "" } = useParams();
	const { recover } = useCustomerData();
	const { client, store, menu, pickup, setPickup } = useOrdering();
	const now = useNow(15_000);
	const given = (location.state as PickupLocationState | null) ?? {};
	const [problem, setProblem] = useState<PickupLocationState>(given);
	const [load, setLoad] = useState<SlotsLoad>({ status: "loading" });
	const [choice, setChoice] = useState<PickupChoice | null>(
		given.problem === undefined ? pickup : null,
	);
	const [expanded, setExpanded] = useState(false);
	const [saving, setSaving] = useState(false);
	const [saveFailed, setSaveFailed] = useState(false);
	const name = useId();
	const alertRef = useRef<HTMLDivElement>(null);
	const reslot = id !== "";

	const reload = useCallback(() => {
		if (client === null || store === null) return;
		client.takeawaySlots(store).then(
			(slots) => setLoad({ status: "ready", slots }),
			(error: unknown) => {
				recover(error);
				setLoad((previous) =>
					previous.status === "ready" ? previous : { status: "failed" },
				);
			},
		);
	}, [client, store, recover]);
	useEffect(() => {
		reload();
		const timer = setInterval(reload, SLOTS_POLL_MS);
		return () => clearInterval(timer);
	}, [reload]);
	useEffect(() => {
		if (problem.problem !== undefined) alertRef.current?.focus();
	}, [problem]);

	const slots = load.status === "ready" ? load.slots : null;
	// a choice the server no longer offers free (it filled, or passed) is no choice: the bar asks again
	const chosen =
		slots !== null &&
		choice !== null &&
		choiceStillFree(choice, slots.slots, slots.asapAt)
			? choice
			: null;
	const shown = slots === null ? [] : shownSlots(slots.slots, expanded);
	const hidden =
		slots === null
			? 0
			: slots.slots.filter((slot) => slot.reason !== "passed").length -
				shown.length;
	const storeInfo = menu.status === "ready" ? menu.data.store : null;
	const today = isoDateIn(now);
	const todaySpans = storeInfo?.openingHours[weekdayOf(today)] ?? [];
	const hours = todaySpans.length > 0 ? spansText(todaySpans) : null;
	const fullAt =
		problem.problem === "slot_full" && problem.at ? problem.at : null;
	const nearest =
		fullAt === null || slots === null ? [] : nearestFree(slots.slots, fullAt);
	const anyFull = shown.some((slot) => !slot.available);
	const day = slots?.date ? relativeDay(slots.date, now) : "today";

	const words = (value: PickupChoice | null) =>
		value === null
			? t("pickup.barNone")
			: value.kind === "asap"
				? t("pickup.asap")
				: pickupWords(t, value.at, now);

	const go = () => {
		if (chosen === null || saving) return;
		if (!reslot) {
			setPickup(chosen);
			navigate("/dat-mon");
			return;
		}
		if (client === null || chosen.kind !== "slot") return;
		setSaving(true);
		setSaveFailed(false);
		client.changePickup(id, chosen.at).then(
			(answer) => {
				setSaving(false);
				if (answer.state === "changed") {
					navigate(`/tra-tien/${id}`, { replace: true });
					return;
				}
				if (
					answer.refusal === "slot_full" ||
					answer.refusal === "slot_passed" ||
					answer.refusal === "closed" ||
					answer.refusal === "pickup_time_invalid"
				) {
					setProblem({ problem: answer.refusal, at: chosen.at });
					setChoice(null);
					reload();
					return;
				}
				// the order moved on (paid, cancelled, its hold passed): it is shown as it is
				navigate(`/don/${id}`, { replace: true });
			},
			(error: unknown) => {
				setSaving(false);
				recover(error);
				setSaveFailed(true);
			},
		);
	};

	return (
		<>
			<section
				className="flex flex-col gap-4 px-4 py-4"
				data-testid="pickup"
				data-state={
					fullAt !== null
						? "full"
						: problem.problem !== undefined
							? "problem"
							: slots?.preOrder
								? "closed"
								: "open"
				}
				data-date={slots?.date ?? ""}
			>
				<FlowBack to={reslot ? `/tra-tien/${id}` : "/dat-mon"} />
				<h1 className="text-xl font-bold text-ink">{t("pickup.title")}</h1>
				{problem.problem === undefined ? null : (
					<div ref={alertRef} tabIndex={-1} className="outline-none">
						<Problem
							testId="pickup-problem"
							data={{ problem: problem.problem }}
						>
							{fullAt !== null ? (
								<>
									<b>{t("pickup.fullAlert", { time: clock(fullAt) })}</b>{" "}
									{t("pickup.fullAlertBody")}
									{nearest.length === 0 ? null : (
										<>
											{" "}
											{nearest.length === 1
												? t("pickup.fullNearestOne", {
														time: clock(nearest[0] ?? ""),
													})
												: t("pickup.fullNearest", {
														times: nearest
															.map(clock)
															.join(` ${t("pickup.and")} `),
													})}
										</>
									)}
								</>
							) : problem.problem === "closed" ? (
								t("pickup.closedAlert")
							) : (
								t("pickup.passedAlert")
							)}
						</Problem>
					</div>
				)}
				{slots?.preOrder ? (
					<Panel testId="pickup-closed">
						<h2 className="text-lg font-bold text-ink">
							{t("pickup.closedTitle")}
						</h2>
						<p className="text-body text-ink">
							{day === "tomorrow" && hours !== null
								? t("pickup.closedBody", { hours })
								: t("pickup.closedBodyLater")}
						</p>
					</Panel>
				) : storeInfo === null ? null : (
					<Panel testId="pickup-where">
						<div className="flex items-center gap-3">
							<span
								aria-hidden="true"
								className="flex size-10 shrink-0 items-center justify-center rounded-card-xl bg-surface-sunken text-highlight"
							>
								<ClockIcon />
							</span>
							<div className="flex min-w-0 flex-col">
								<p className="text-[15px] font-bold text-ink">
									{t("pickup.where", { store: storeInfo.name })}
								</p>
								{hours === null ? null : (
									<p className="text-[13px] text-ink-muted">
										{storeInfo.address === null
											? t("pickup.whereSubNoAddress", { hours })
											: t("pickup.whereSub", {
													address: storeInfo.address,
													hours,
												})}
									</p>
								)}
							</div>
						</div>
					</Panel>
				)}
				{load.status === "loading" ? (
					<Loading label={t("pickup.loading")} />
				) : load.status === "failed" || slots === null ? (
					<Problem testId="pickup-failed">
						{t("customer.error.network")}
						<button
							type="button"
							className={`${kitButton.secondary} mt-3 w-full`}
							onClick={reload}
						>
							{t("customer.retry")}
						</button>
					</Problem>
				) : slots.state === "refused" ? (
					<Notice
						testId="pickup-refused"
						data={{ refusal: slots.refusal ?? "" }}
					>
						{slots.refusal === "no_slots"
							? t("pickup.noSlots")
							: t(refusalKey(slots.refusal))}
					</Notice>
				) : (
					<div
						role="radiogroup"
						aria-label={t("pickup.slotsLabel")}
						className="flex flex-col gap-4"
						data-testid="pickup-slots"
					>
						{slots.asapAt === null || slots.preOrder ? null : (
							<label
								className={`relative flex min-h-16 items-center gap-3 rounded-card border-field p-4 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-focus ${chosen?.kind === "asap" ? "border-accent bg-surface-raised" : "border-line-strong bg-surface-raised"}`}
								data-testid="pickup-asap"
								data-selected={chosen?.kind === "asap"}
							>
								<input
									type="radio"
									name={name}
									value="asap"
									checked={chosen?.kind === "asap"}
									onChange={() => setChoice({ kind: "asap" })}
									aria-describedby={`${name}-asap`}
									className="absolute inset-0 m-0 size-full cursor-pointer appearance-none rounded-card opacity-0"
								/>
								<span className="text-highlight" aria-hidden="true">
									<ClockIcon />
								</span>
								<span className="flex min-w-0 flex-1 flex-col">
									<span className="text-[15px] font-bold text-ink">
										{t("pickup.asap")}
									</span>
									<span
										id={`${name}-asap`}
										className="text-[13px] text-ink-muted"
									>
										{t("pickup.asapSub", {
											time: clock(slots.asapAt),
											minutes: minutesUntil(slots.asapAt, now),
										})}
									</span>
								</span>
								<span
									aria-hidden="true"
									className={`flex size-6 shrink-0 items-center justify-center rounded-full border-2 ${chosen?.kind === "asap" ? "border-accent" : "border-line-strong"}`}
								>
									{chosen?.kind === "asap" ? (
										<span className="size-3 rounded-full bg-accent" />
									) : null}
								</span>
							</label>
						)}
						<div className="flex flex-col gap-0.5">
							<p
								className="text-xs font-bold tracking-[0.12em] text-highlight uppercase"
								data-testid="pickup-kicker"
							>
								{slots.asapAt !== null && !slots.preOrder
									? t("pickup.or")
									: day === "tomorrow"
										? t("pickup.kickerTomorrow")
										: t("pickup.kicker")}
							</p>
							{slots.date === null ? null : (
								<p
									className="text-[15px] font-bold text-ink"
									data-testid="pickup-date"
								>
									{day === "today"
										? dateLine(t, slots.date, now)
										: slots.opensAt === null
											? dateLine(t, slots.date, now)
											: t("pickup.dateOpens", {
													date: dateLine(t, slots.date, now),
													time: clock(slots.opensAt),
												})}
								</p>
							)}
						</div>
						{groupSlots(shown).map((group) => (
							<div
								key={`${group.period}-${group.slots[0]?.start ?? ""}`}
								className="flex flex-col gap-2"
							>
								<p className="text-[13px] font-bold text-ink-muted">
									{t(`pickup.period.${group.period}`)}
								</p>
								<div className="grid grid-cols-3 gap-2">
									{group.slots.map((slot) => (
										<SlotChip
											key={slot.start}
											slot={slot}
											name={name}
											selected={
												chosen?.kind === "slot" &&
												sameInstant(chosen.at, slot.start)
											}
											onChoose={() => {
												setChoice({ kind: "slot", at: slot.start });
											}}
										/>
									))}
								</div>
							</div>
						))}
						{hidden <= 0 || slots.lastPickupAt === null ? null : (
							<button
								type="button"
								className={`${kitButton.secondary} w-full`}
								aria-expanded={expanded}
								onClick={() => setExpanded(true)}
								data-testid="pickup-more"
							>
								{t("pickup.more", { time: clock(slots.lastPickupAt) })}
							</button>
						)}
						{anyFull ? (
							<p
								className="text-[13px] text-ink-muted"
								data-testid="pickup-full-hint"
							>
								{t("pickup.fullHint", { minutes: slots.slotMinutes })}
							</p>
						) : null}
					</div>
				)}
				<p
					className="rounded-card bg-surface-sunken px-4 py-3 text-[13px] text-ink"
					data-testid="pickup-prepay"
				>
					<b>{t("pickup.prepay")}</b> {t("pickup.prepayBody")}
				</p>
				{saveFailed ? (
					<Problem testId="pickup-save-failed">
						{t("pickup.changeFailed")}
					</Problem>
				) : null}
			</section>
			<StickyActionBar testId="pickup-bar">
				<p className="flex min-w-0 flex-1 flex-col" aria-live="polite">
					<span className="text-xs text-ink-muted">{t("pickup.bar")}</span>
					<span
						className="text-base font-bold text-ink"
						data-testid="pickup-chosen"
					>
						{words(chosen)}
					</span>
				</p>
				<button
					type="button"
					className={`${kitButton.primary} shrink-0 px-5`}
					disabled={chosen === null || saving}
					aria-busy={saving}
					onClick={go}
					data-testid="pickup-continue"
				>
					{saving
						? t("pickup.changing")
						: chosen === null
							? t("pickup.choose")
							: reslot
								? t("pickup.save")
								: t("pickup.continue")}
				</button>
			</StickyActionBar>
		</>
	);
}
