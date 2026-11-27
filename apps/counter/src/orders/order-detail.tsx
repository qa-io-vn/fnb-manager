import { formatVnd } from "@fnb/zalo-mini/format";
import { useI18n } from "@fnb/zalo-mini/i18n";
import { PriceText } from "@fnb/zalo-mini/ui-kit";
import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { RpcError } from "../lib/rpc";
import { isManager, useMember, useSession } from "../lib/session";
import { clockOf, dayAndClock } from "../lib/time";
import { usePrinter } from "../print/printer";
import { BackIcon, NoteIcon, PrinterIcon } from "../ui/icons";
import { button, card, Loading, PlainNote } from "../ui/kit";
import { useToast } from "../ui/toast";
import {
	act,
	type CounterAction,
	orderDetail,
	refundable,
	rosterNames,
} from "./api";
import { useBoard } from "./board-context";
import { cancellable, nextAction, payable } from "./board-model";
import { CancelDialog, RefundDialog } from "./cancel-dialog";
import { LineList, PaymentLabel, placeOf, StatusLabel } from "./order-bits";
import { PaymentDialog } from "./payment-dialog";
import type { Order, TimelineEvent } from "./types";

const ACTION_STYLE: Readonly<Record<Exclude<CounterAction, "cancel">, string>> =
	{
		start: button.warning,
		done: button.positive,
		complete: button.primary,
	};

function actionLabel(
	order: Order,
	action: Exclude<CounterAction, "cancel">,
	t: (key: string) => string,
): string {
	if (action === "done")
		return t(
			order.type === "table"
				? "order.action.doneTable"
				: "order.action.doneTakeaway",
		);
	return t(`order.action.${action}`);
}

/** One line of the order's log: "27/11 14:36 · Minh · hủy đơn · lý do … · 167.000đ" (Q03's audit line). */
export function auditLine(
	event: TimelineEvent,
	names: ReadonlyMap<string, string>,
	t: (key: string, params?: Record<string, string | number>) => string,
): string {
	const who =
		event.actor === "staff"
			? ((event.actor_user_id === null || event.actor_user_id === undefined
					? undefined
					: names.get(event.actor_user_id)) ?? t("audit.staff"))
			: t(`audit.actor.${event.actor}`);
	const what = t(`audit.action.${event.action}`);
	const reason =
		event.reason_code === null
			? null
			: event.reason_code.startsWith("other:")
				? event.reason_code.slice(6)
				: (event.reason_text ?? t(`cancel.reason.${event.reason_code}`));
	return [
		dayAndClock(event.at),
		who,
		what,
		reason,
		event.amount === null ? null : formatVnd(Math.abs(event.amount)),
	]
		.filter((part): part is string => part !== null && part !== "")
		.join(" · ");
}

export function OrderDetailPage() {
	const { t } = useI18n();
	const { id = "" } = useParams();
	const { client } = useSession();
	const { member, userId } = useMember();
	const { state, update } = useBoard();
	const { show } = useToast();
	const printer = usePrinter();
	const [order, setOrder] = useState<Order | null>(null);
	const [missing, setMissing] = useState(false);
	const [names, setNames] = useState<ReadonlyMap<string, string>>(new Map());
	const [dialog, setDialog] = useState<"pay" | "cancel" | "refund" | null>(
		null,
	);
	const [busy, setBusy] = useState(false);
	const [message, setMessage] = useState<string | null>(null);
	const boardVersion = state.orders.get(id)?.version;

	const load = useCallback(async () => {
		try {
			setOrder(await orderDetail(client, id));
		} catch (error) {
			if (error instanceof RpcError && error.forbidden) setMissing(true);
		}
	}, [client, id]);

	// biome-ignore lint/correctness/useExhaustiveDependencies: the detail is read again when the board sees a new version
	useEffect(() => {
		void load();
	}, [load, boardVersion]);
	useEffect(() => {
		rosterNames(client).then((map) =>
			setNames(new Map([...map, [userId, member.display_name]])),
		);
	}, [client, userId, member.display_name]);

	const changed = (next: Order, text?: string) => {
		update(next);
		void load();
		if (text !== undefined) show(text);
	};

	const run = async (action: Exclude<CounterAction, "cancel">) => {
		if (order === null) return;
		setBusy(true);
		setMessage(null);
		try {
			const answer = await act(client, order, action);
			if (answer.state === "ok") {
				changed(answer.order);
			} else if (answer.state === "conflict") {
				show(t("order.conflict"));
				changed(answer.order);
			} else {
				setMessage(t(`order.refusal.${answer.refusal ?? "failed"}`));
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

	if (missing)
		return <PlainNote tone="negative">{t("order.unknown")}</PlainNote>;
	if (order === null) return <Loading label={t("app.loading")} />;
	const next = nextAction(order);
	const manager = isManager(member);
	const due = refundable(order);
	const canRefund =
		due > 0 &&
		(order.payment_status === "refund_pending" ||
			(manager && order.status === "completed"));
	return (
		<div
			className="mx-auto flex max-w-5xl flex-col gap-4"
			data-testid="order-detail"
			data-order-status={order.status}
		>
			<Link
				to="/don"
				className={`${button.quiet} self-start`}
				data-testid="back-to-queue"
			>
				<BackIcon />
				{t("order.backToQueue")}
			</Link>
			<section className={`${card} flex flex-col gap-2 p-5`}>
				<div className="flex flex-wrap items-center gap-3">
					<h1 className="text-3xl font-extrabold">{placeOf(order, t)}</h1>
					<span className="text-lg font-bold text-ink-muted">
						{order.display_no}
					</span>
					<span className="ml-auto flex gap-2">
						<StatusLabel order={order} />
						<PaymentLabel order={order} />
					</span>
				</div>
				<p className="text-sm text-ink-muted">
					{t("order.placedAt", { time: clockOf(order.placed_at) })} ·{" "}
					{t(`order.source.${order.source}`)}
				</p>
			</section>
			<div className="grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
				<section className={`${card} flex flex-col gap-3 p-5`}>
					<LineList order={order} />
					{order.note === null ? null : (
						<p className="flex gap-2 rounded-card-xl bg-warning-soft p-3 text-body">
							<NoteIcon />
							<span>
								<span className="font-bold">{t("order.customerNote")}</span> “
								{order.note}”
							</span>
						</p>
					)}
					<p className="flex items-baseline justify-between border-t border-line pt-3 text-lg font-extrabold">
						<span>{t("order.total")}</span>
						<PriceText amount={order.total} size="lead" testId="order-total" />
					</p>
				</section>
				<section className="flex flex-col gap-3">
					{next === null ? null : (
						<button
							type="button"
							className={ACTION_STYLE[next]}
							disabled={busy}
							onClick={() => void run(next)}
							data-testid={`act-${next}`}
						>
							{actionLabel(order, next, t)}
						</button>
					)}
					{next === "complete" && order.payment_status === "unpaid" ? (
						<PlainNote tone="warning">{t("order.payFirst")}</PlainNote>
					) : null}
					{payable(order) ? (
						<button
							type="button"
							className={button.inverse}
							onClick={() => setDialog("pay")}
							data-testid="open-pay"
						>
							{t("order.pay", { amount: formatVnd(order.total) })}
						</button>
					) : null}
					{canRefund ? (
						<button
							type="button"
							className={button.danger}
							onClick={() => setDialog("refund")}
							data-testid="open-refund"
						>
							{t("order.refund", { amount: formatVnd(due) })}
						</button>
					) : null}
					{cancellable(order) ? (
						<button
							type="button"
							className={button.danger}
							onClick={() => setDialog("cancel")}
							data-testid="open-cancel"
						>
							{t("order.cancel")}
						</button>
					) : null}
					<button
						type="button"
						className={button.secondary}
						onClick={() => void printer.print(order)}
						data-testid="print-ticket"
					>
						<PrinterIcon />
						{t("print.ticket")}
					</button>
					{message === null ? null : (
						<PlainNote tone="negative" testId="order-message">
							{message}
						</PlainNote>
					)}
				</section>
			</div>
			<section
				className={`${card} flex flex-col gap-2 p-5`}
				data-testid="order-log"
			>
				<h2 className="text-lg font-extrabold">{t("order.log")}</h2>
				<ol className="flex flex-col gap-1 text-sm">
					{(order.timeline ?? []).map((event, index) => (
						// the log is append-only and in order, so the position is stable
						// biome-ignore lint/suspicious/noArrayIndexKey: an append-only log
						<li key={index} data-testid="audit-line">
							{auditLine(event, names, t)}
						</li>
					))}
				</ol>
			</section>
			{dialog === "pay" ? (
				<PaymentDialog
					order={order}
					onClose={() => setDialog(null)}
					onPaid={(paid) => {
						setDialog(null);
						changed(paid);
					}}
				/>
			) : null}
			{dialog === "cancel" ? (
				<CancelDialog
					order={order}
					onClose={() => setDialog(null)}
					onDone={(done, text) => {
						setDialog(null);
						changed(done, text);
					}}
				/>
			) : null}
			{dialog === "refund" ? (
				<RefundDialog
					order={order}
					onClose={() => setDialog(null)}
					onDone={(done, text) => {
						setDialog(null);
						changed(done, text);
					}}
				/>
			) : null}
		</div>
	);
}
