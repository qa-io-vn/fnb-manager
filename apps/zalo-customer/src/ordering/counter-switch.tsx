import { RestError } from "@fnb/zalo-mini";
import type { Order } from "@fnb/zalo-mini/ordering";
import { kitButton, useI18n } from "@fnb/zalo-mini/react";
import { useId, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useOrdering } from "./ordering-data";
import { Problem } from "./parts";
import {
	basketLinesOf,
	canSwitchToCounter,
	counterRequest,
} from "./payment-step";

// "Trả tại quầy" of an online order that was not paid (C11, and the transfer screen): the unpaid order is cancelled
// (customer_cancel_order; an expired one already is) and the same lines are placed again to pay at the counter, with a
// request of their own, so a lost answer and a second tap give one order (criterion 3). The cancellation goes first:
// if the money arrived at the last moment the order is paid, the cancellation is refused and nothing is placed twice.
// When the new order cannot be placed (a price changed, an item sold out), its lines go back to the basket.

type SwitchState =
	| { readonly state: "idle" }
	| { readonly state: "busy" }
	| {
			readonly state: "failed";
			readonly reason: "network" | "basket" | "other";
	  };

function lost(error: unknown): boolean {
	return (
		error instanceof RestError && (error.status === 0 || error.status >= 500)
	);
}

export function CounterSwitch({
	order,
	onOrder,
}: {
	readonly order: Order;
	/** the order as the cancellation answered it */
	readonly onOrder?: (order: Order) => void;
}) {
	const { t } = useI18n();
	const navigate = useNavigate();
	const { client, store, table, placement, settlePlacement, add } =
		useOrdering();
	const [run, setRun] = useState<SwitchState>({ state: "idle" });
	const noteId = useId();
	if (!canSwitchToCounter(order)) return null;
	const tableToken =
		table?.state === "ok" && table.store === store ? table.token : null;
	const ready = client !== null && store !== null && tableToken !== null;

	const go = async () => {
		if (!ready || run.state === "busy") return;
		setRun({ state: "busy" });
		try {
			if (order.status !== "cancelled") {
				const cancel = await client.cancelOrder(order.id);
				if (cancel.state === "refused") {
					// the order moved on (paid at the last moment, or taken by staff): it is shown as it is
					navigate(`/don/${order.id}`, { replace: true });
					return;
				}
				onOrder?.(cancel.order);
			}
			const request = placement(`counter-for:${order.id}`, (requestId) =>
				counterRequest(order, { requestId, store, tableToken }),
			);
			const answer = await client.placeOrder(request);
			settlePlacement(answer, { keepCart: true });
			if (answer.state !== "refused" && answer.order !== null) {
				navigate(`/don/${answer.order.id}`, { replace: true });
				return;
			}
			for (const line of basketLinesOf(order)) add(line);
			setRun({ state: "failed", reason: "basket" });
		} catch (error) {
			setRun({ state: "failed", reason: lost(error) ? "network" : "other" });
		}
	};

	return (
		<div className="flex w-full flex-col gap-2" data-testid="counter-switch">
			{run.state === "failed" ? (
				<Problem testId="counter-switch-problem" data={{ reason: run.reason }}>
					<span className="block">{t(`pay.counterFailed.${run.reason}`)}</span>
					{run.reason === "basket" ? (
						<button
							type="button"
							className={`${kitButton.secondary} mt-3 w-full`}
							onClick={() => navigate("/gio-hang")}
							data-testid="counter-switch-basket"
						>
							{t("pay.toBasket")}
						</button>
					) : null}
				</Problem>
			) : null}
			<button
				type="button"
				className={`${kitButton.secondary} w-full`}
				disabled={!ready || run.state === "busy"}
				aria-busy={run.state === "busy"}
				aria-describedby={noteId}
				onClick={() => void go()}
				data-testid="pay-counter"
			>
				{t("pay.counter")}
			</button>
			<p id={noteId} className="text-[13px] text-ink">
				{tableToken === null ? t("pay.counterNoTable") : t("pay.counterNote")}
			</p>
		</div>
	);
}
