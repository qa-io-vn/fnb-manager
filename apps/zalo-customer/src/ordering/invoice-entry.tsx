import type { InvoiceStatus, Order } from "@fnb/zalo-mini/ordering";
import { kitButton, useI18n } from "@fnb/zalo-mini/react";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { shownDate } from "../data/dates";
import { invoiceEntry, statusKey } from "./company-invoice";
import { useOrdering } from "./ordering-data";
import { Notice, Panel } from "./parts";

// The way into C18 from an order (C06, reached from the history C14 or after a payment): only once the order is paid,
// and only what customer_invoice_status allows: "Xin hóa đơn công ty" inside the window, the request already made, or
// "Đã quá hạn…" after it. An order the server says nothing about (e-invoicing off, refunded, another customer's) shows
// nothing here.

export function InvoiceEntryCard({ order }: { readonly order: Order }) {
	const { t } = useI18n();
	const navigate = useNavigate();
	const { client } = useOrdering();
	const [status, setStatus] = useState<InvoiceStatus | null>(null);
	const paid = order.paymentStatus !== "unpaid";
	// biome-ignore lint/correctness/useExhaustiveDependencies: read again when the money of the order changes (paid, refunded)
	useEffect(() => {
		if (!paid || client === null) {
			setStatus(null);
			return;
		}
		let live = true;
		client.invoiceStatus(order.id).then(
			(answer) => {
				if (live) setStatus(answer);
			},
			() => undefined,
		);
		return () => {
			live = false;
		};
	}, [client, order.id, paid, order.paymentStatus]);
	const entry = status === null ? null : invoiceEntry(status);
	if (entry === null || status === null || status.state !== "known")
		return null;
	if (entry.kind === "late")
		return <Notice testId="order-invoice-late">{t("invoice.late")}</Notice>;
	const open = () => navigate(`/hoa-don-cong-ty/${order.id}`);
	return (
		<Panel testId="order-invoice" labelledBy="order-invoice-title">
			<div className="flex flex-col gap-0.5">
				<h2 id="order-invoice-title" className="text-[15px] font-bold text-ink">
					{t("invoice.entry.title")}
				</h2>
				<p className="text-[13px] text-ink" data-testid="order-invoice-line">
					{entry.kind === "ask"
						? entry.lastDay === null
							? t("invoice.entry.lead")
							: t("invoice.entry.until", { date: shownDate(entry.lastDay) })
						: t(statusKey(entry.request, status.einvoice))}
				</p>
			</div>
			<button
				type="button"
				className={`${kitButton.secondary} w-full`}
				onClick={open}
				data-testid={
					entry.kind === "ask" ? "order-invoice-ask" : "order-invoice-view"
				}
			>
				{entry.kind === "ask"
					? t("invoice.entry.ask")
					: t("invoice.entry.view")}
			</button>
		</Panel>
	);
}
