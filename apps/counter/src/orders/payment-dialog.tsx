import { formatVnd } from "@fnb/zalo-mini/format";
import { useI18n } from "@fnb/zalo-mini/i18n";
import { PriceText } from "@fnb/zalo-mini/ui-kit";
import { useState } from "react";
import { changeDue, parseAmount, quickAmounts } from "../lib/cash";
import { RpcError } from "../lib/rpc";
import { useSession } from "../lib/session";
import { useShift } from "../shift/shift-context";
import { Dialog } from "../ui/dialog";
import { button, field, PlainNote } from "../ui/kit";
import { useToast } from "../ui/toast";
import { recordPayment } from "./api";
import type { Order } from "./types";

type Method = "cash" | "card";

/**
 * "Thu tiền" (Q01 frames 4 and the card tab): cash with the amount given and the change, or a card taken on the
 * separate terminal and confirmed here. The server records the full total; the client never sends a price. Cash needs
 * the cashier's open shift, because the drawer count compares with the cash they recorded.
 */
export function PaymentDialog({
	order,
	onClose,
	onPaid,
}: {
	readonly order: Order;
	readonly onClose: () => void;
	readonly onPaid: (order: Order) => void;
}) {
	const { t } = useI18n();
	const { client } = useSession();
	const { current } = useShift();
	const { show } = useToast();
	const [method, setMethod] = useState<Method>("cash");
	const [given, setGiven] = useState("");
	const [busy, setBusy] = useState(false);
	const [message, setMessage] = useState<string | null>(null);
	const tendered = parseAmount(given);
	const change =
		tendered === null || given === "" ? null : changeDue(order.total, tendered);
	const onShift = current !== null && current.status === "open";
	const ready = method === "card" || (change !== null && onShift);
	const submit = async () => {
		setBusy(true);
		setMessage(null);
		try {
			const answer = await recordPayment(client, order, method);
			if (answer.state === "paid") {
				show(t("pay.done", { amount: formatVnd(order.total) }));
				onPaid(answer.order);
				return;
			}
			setMessage(
				t(
					answer.state === "conflict"
						? "order.conflict"
						: `pay.refusal.${answer.refusal ?? "failed"}`,
				),
			);
			if (answer.state === "conflict") onPaid(answer.order);
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
	const tab = (value: Method) => (
		<button
			type="button"
			role="tab"
			aria-selected={method === value}
			onClick={() => setMethod(value)}
			data-testid={`pay-${value}`}
			className={`min-h-12 flex-1 rounded-control px-4 font-bold focus-visible:outline-2 focus-visible:outline-focus ${
				method === value
					? "bg-inverse text-inverse-ink"
					: "bg-surface-sunken text-ink"
			}`}
		>
			{t(`pay.${value}`)}
		</button>
	);
	return (
		<Dialog
			title={t("pay.title", { amount: formatVnd(order.total) })}
			onClose={onClose}
			closeLabel={t("common.close")}
			busy={busy}
			testId="payment-dialog"
			footer={
				<button
					type="button"
					className={`${button.primary} w-full sm:w-auto`}
					disabled={!ready || busy}
					onClick={() => void submit()}
					data-testid="pay-submit"
				>
					{method === "cash"
						? t("pay.cashDone", { amount: formatVnd(order.total) })
						: t("pay.cardDone", { amount: formatVnd(order.total) })}
				</button>
			}
		>
			<div className="flex flex-col gap-4">
				<div role="tablist" aria-label={t("pay.method")} className="flex gap-2">
					{tab("cash")}
					{tab("card")}
				</div>
				{method === "cash" ? (
					<>
						{onShift ? null : (
							<PlainNote tone="warning">{t("pay.needShift")}</PlainNote>
						)}
						<label className="flex flex-col gap-1">
							<span className="font-bold">{t("pay.given")}</span>
							<input
								className={`${field} text-2xl font-bold`}
								inputMode="numeric"
								value={given}
								onChange={(event) => setGiven(event.target.value)}
								data-testid="pay-given"
								data-autofocus
							/>
						</label>
						<fieldset
							className="flex flex-wrap gap-2"
							aria-label={t("pay.quick")}
						>
							{quickAmounts(order.total).map((amount) => (
								<button
									key={amount}
									type="button"
									className="min-h-12 rounded-control border-outline border-edge bg-surface-raised px-4 font-bold focus-visible:outline-2 focus-visible:outline-focus"
									onClick={() => setGiven(String(amount))}
									data-testid={`pay-quick-${amount}`}
								>
									{amount === order.total ? t("pay.exact") : formatVnd(amount)}
								</button>
							))}
						</fieldset>
						<div
							className="rounded-card-xl bg-surface-sunken p-4"
							role="status"
							data-testid="pay-change"
						>
							{given === "" ? (
								<p className="text-ink-muted">{t("pay.enterGiven")}</p>
							) : change === null ? (
								<p className="font-bold">{t("pay.notEnough")}</p>
							) : (
								<p className="flex items-baseline justify-between gap-3">
									<span className="font-bold">{t("pay.change")}</span>
									<PriceText amount={change} size="lead" tone="ink" />
								</p>
							)}
						</div>
					</>
				) : (
					<p className="text-body">{t("pay.cardLead")}</p>
				)}
				{message === null ? null : (
					<PlainNote tone="negative" testId="pay-message">
						{message}
					</PlainNote>
				)}
			</div>
		</Dialog>
	);
}
