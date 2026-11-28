import { formatVnd } from "@fnb/zalo-mini/format";
import { useI18n } from "@fnb/zalo-mini/i18n";
import { ChipGroup } from "@fnb/zalo-mini/ui-kit";
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { RpcError } from "../lib/rpc";
import { useSession } from "../lib/session";
import { AlertIcon, ClockIcon, PlusIcon, WifiOffIcon } from "../ui/icons";
import { button, card, Loading, PageTitle, PlainNote } from "../ui/kit";
import { useToast } from "../ui/toast";
import { act } from "./api";
import { useBoard } from "./board-context";
import {
	closedOrders,
	isScheduled,
	type Lane,
	laneOrders,
	nextAction,
	payable,
	scheduledOrders,
	waitingMinutes,
} from "./board-model";
import {
	LineList,
	PaymentLabel,
	PickupLabel,
	pickupWords,
	placeOf,
	StatusLabel,
	useNow,
} from "./order-bits";
import { PaymentDialog } from "./payment-dialog";
import type { Order } from "./types";

const LANES: readonly Lane[] = ["new", "making", "done"];

function OrderCard({
	order,
	now,
	onPay,
}: {
	readonly order: Order;
	readonly now: number;
	readonly onPay: (order: Order) => void;
}) {
	const { t } = useI18n();
	const { client } = useSession();
	const { update } = useBoard();
	const { show } = useToast();
	const navigate = useNavigate();
	const [busy, setBusy] = useState(false);
	const next = nextAction(order);
	const minutes = waitingMinutes(order, now);
	// a booking whose preparation start is ahead is never late and says when to start instead of how long it waited
	const booked = isScheduled(order, now);
	const late = order.late === true && !booked;
	const start = booked ? pickupWords(order, now, t)?.start : null;
	const quick = async () => {
		if (next === null) return;
		if (next === "complete" && order.payment_status === "unpaid") {
			onPay(order);
			return;
		}
		setBusy(true);
		try {
			const answer = await act(client, order, next);
			if (answer.state === "ok") update(answer.order);
			else if (answer.state === "conflict") {
				show(t("order.conflict"));
				update(answer.order);
			} else show(t(`order.refusal.${answer.refusal ?? "failed"}`));
		} catch (error) {
			show(
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
		<li
			className={`${card} flex flex-col gap-2 border-l-[6px] p-4 ${late ? "border-negative bg-negative-soft" : booked ? "border-l-line-strong" : order.status === "preparing" ? "border-l-warning" : "border-l-accent"}`}
			data-testid="order-card"
			data-order-id={order.id}
			data-late={late ? "true" : "false"}
			data-scheduled={booked ? "true" : "false"}
		>
			<div className="flex flex-wrap items-center gap-2">
				<button
					type="button"
					onClick={() => navigate(`/don/${order.id}`)}
					className="text-left text-xl font-extrabold underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-focus"
					data-testid="open-order"
				>
					{placeOf(order, t)}{" "}
					<span className="text-base font-bold text-ink-muted">
						{order.display_no}
					</span>
				</button>
				<PickupLabel order={order} now={now} />
				<span
					className={`ml-auto flex items-center gap-1 text-sm font-bold ${late ? "text-negative" : "text-ink-muted"}`}
					data-testid={start ? "start-time" : undefined}
				>
					<ClockIcon size={16} />
					{start
						? start
						: late
							? t("queue.late", { minutes })
							: t("queue.minutes", { minutes })}
				</span>
			</div>
			<LineList order={order} compact />
			<div className="flex flex-wrap items-center gap-2">
				<StatusLabel order={order} />
				{order.payment_status === "unpaid" ? (
					<PaymentLabel order={order} />
				) : null}
				{order.note === null ? null : (
					<span className="text-sm text-ink-muted">“{order.note}”</span>
				)}
			</div>
			<div className="flex flex-wrap gap-2">
				{payable(order) ? (
					<button
						type="button"
						className={`${button.inverse} min-h-12 flex-1`}
						onClick={() => onPay(order)}
						data-testid="card-pay"
					>
						{t("order.pay", { amount: formatVnd(order.total) })}
					</button>
				) : null}
				{next === null ? null : (
					<button
						type="button"
						className={`${next === "start" ? button.warning : next === "done" ? button.positive : button.primary} min-h-12 flex-1`}
						disabled={busy}
						onClick={() => void quick()}
						data-testid={`card-${next}`}
					>
						{next === "done"
							? t(
									order.type === "table"
										? "order.action.doneTable"
										: "order.action.doneTakeaway",
								)
							: t(`order.action.${next}`)}
					</button>
				)}
			</div>
		</li>
	);
}

function Banners() {
	const { t } = useI18n();
	const { state, dismissResynced } = useBoard();
	const kept = [...state.orders.values()].filter(
		(order) => order.status !== "completed" && order.status !== "cancelled",
	).length;
	return (
		<div className="flex flex-col gap-2">
			{state.offline ? (
				<p
					className="flex items-center gap-3 rounded-card-xl bg-negative-soft p-3 font-bold"
					role="alert"
					data-testid="offline-banner"
				>
					<WifiOffIcon />
					{t("queue.offline", { count: kept })}
				</p>
			) : null}
			{state.resynced === null ? null : (
				<p
					className="flex items-center gap-3 rounded-card-xl bg-positive-soft p-3 font-bold"
					role="status"
					data-testid="resynced-banner"
				>
					{t("queue.resynced", { count: state.resynced })}
					<button
						type="button"
						className={`${button.quiet} ml-auto`}
						onClick={dismissResynced}
					>
						{t("common.close")}
					</button>
				</p>
			)}
			{state.ordering !== null && !state.ordering.accepting ? (
				<p
					className="flex items-center gap-3 rounded-card-xl bg-warning-soft p-3"
					data-testid="ordering-closed"
				>
					<AlertIcon />
					{t(`ordering.${state.ordering.reason ?? "closed"}`)}
				</p>
			) : null}
		</div>
	);
}

/**
 * Đơn: the queue in three lanes (S02), newest on top, late ones in red with words, "Chưa thu tiền" on unpaid ones; above
 * them, the takeaway orders booked for later (C17) as "Hẹn giờ", the next to start first, each joining Mới at its start.
 */
export function QueuePage() {
	const { t } = useI18n();
	const { state } = useBoard();
	// every answer of the board (2 s) moves the clock too, so a booking joins Mới within a poll of its start
	const now = Math.max(useNow(), state.lastOkAt ?? 0);
	const [lane, setLane] = useState<Lane>("new");
	const [paying, setPaying] = useState<Order | null>(null);
	const { update } = useBoard();
	const closed = closedOrders(state);
	const booked = scheduledOrders(state, now);
	const column = (key: Lane, visible: boolean) => {
		const orders = laneOrders(state, key, now);
		return (
			<section
				key={key}
				className={`${visible ? "flex" : "hidden"} min-w-0 flex-col gap-3 md:flex`}
				data-testid={`lane-${key}`}
			>
				<h2 className="hidden text-lg font-extrabold md:block">
					{t(`queue.lane.${key}`)} · {orders.length}
				</h2>
				{orders.length === 0 ? (
					<PlainNote>{t("queue.empty")}</PlainNote>
				) : (
					<ul className="flex flex-col gap-3">
						{orders.map((order) => (
							<OrderCard
								key={order.id}
								order={order}
								now={now}
								onPay={setPaying}
							/>
						))}
					</ul>
				)}
			</section>
		);
	};
	return (
		<div className="flex flex-col gap-4">
			<PageTitle
				aside={
					<Link
						to="/tao-don"
						className={button.primary}
						data-testid="new-counter-order"
					>
						<PlusIcon />
						{t("queue.newOrder")}
					</Link>
				}
			>
				{t("queue.title")}
			</PageTitle>
			<Banners />
			{!state.loaded ? (
				<Loading label={t("app.loading")} />
			) : (
				<>
					{booked.length === 0 ? null : (
						<section
							className="flex flex-col gap-3"
							aria-labelledby="lane-scheduled-title"
							data-testid="lane-scheduled"
						>
							<h2 id="lane-scheduled-title" className="text-lg font-extrabold">
								{t("queue.lane.scheduled")} · {booked.length}
							</h2>
							<p className="text-sm text-ink-muted">
								{t("queue.scheduledLead")}
							</p>
							<ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
								{booked.map((order) => (
									<OrderCard
										key={order.id}
										order={order}
										now={now}
										onPay={setPaying}
									/>
								))}
							</ul>
						</section>
					)}
					<div className="md:hidden">
						<ChipGroup
							label={t("queue.lanes")}
							chips={LANES.map((key) => ({
								key,
								label: `${t(`queue.lane.${key}`)} · ${laneOrders(state, key, now).length}`,
							}))}
							selected={lane}
							onSelect={(key) => setLane(key as Lane)}
							testId="lane-tabs"
						/>
					</div>
					<div className="grid gap-4 md:grid-cols-3">
						{LANES.map((key) => column(key, key === lane))}
					</div>
					<details className={`${card} p-4`} data-testid="closed-today">
						<summary className="min-h-11 cursor-pointer font-bold">
							{t("queue.closedToday", { count: closed.length })}
						</summary>
						<ul className="divide-y divide-line">
							{closed.map((order) => (
								<li
									key={order.id}
									className="flex flex-wrap items-center gap-3 py-2"
								>
									<Link
										to={`/don/${order.id}`}
										className="font-bold underline-offset-4 hover:underline"
										data-testid="closed-order"
									>
										{placeOf(order, t)} {order.display_no}
									</Link>
									<StatusLabel order={order} />
									<PaymentLabel order={order} />
									<span className="ml-auto font-bold">
										{formatVnd(order.total)}
									</span>
								</li>
							))}
						</ul>
					</details>
				</>
			)}
			{paying === null ? null : (
				<PaymentDialog
					order={paying}
					onClose={() => setPaying(null)}
					onPaid={(paid) => {
						setPaying(null);
						update(paid);
					}}
				/>
			)}
		</div>
	);
}
