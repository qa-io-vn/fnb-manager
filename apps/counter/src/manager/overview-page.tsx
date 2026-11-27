import { useI18n } from "@fnb/zalo-mini/i18n";
import { PriceText } from "@fnb/zalo-mini/ui-kit";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router-dom";
import { query } from "../lib/rpc";
import { useSession } from "../lib/session";
import { useStore } from "../lib/store";
import { vietnamDate } from "../lib/time";
import { card, field, Loading, PageTitle, PlainNote } from "../ui/kit";
import { type InvoiceRow, type LineRow, summarizeDay } from "./overview";

/** Quản lý → Tổng quan ngày: revenue, orders, the average order, by hour and the best sellers of a business day. */
export function OverviewPage() {
	const { t } = useI18n();
	const { client } = useSession();
	const { store } = useStore();
	const [date, setDate] = useState(() => vietnamDate(Date.now()));
	const day = useQuery({
		queryKey: ["overview", store.id, date],
		refetchInterval: 30_000,
		queryFn: async () => {
			const invoices = await query<InvoiceRow[]>(
				client
					.from("invoices")
					.select("id, sold_at, net_amount, status")
					.eq("store_id", store.id)
					.eq("business_date", date)
					.limit(5000),
			);
			const ids = invoices.map((invoice) => invoice.id);
			const lines =
				ids.length === 0
					? []
					: await query<LineRow[]>(
							client
								.from("invoice_lines")
								.select("invoice_id, item_name, base_name, quantity, line_kind")
								.in("invoice_id", ids)
								.limit(20000),
						);
			return summarizeDay(invoices, lines);
		},
	});
	const top = Math.max(
		1,
		...(day.data?.byHour ?? []).map((hour) => hour.revenue),
	);
	return (
		<div className="mx-auto flex max-w-5xl flex-col gap-4">
			<PageTitle
				aside={
					<input
						type="date"
						className={`${field} w-auto`}
						value={date}
						aria-label={t("managerShifts.date")}
						onChange={(event) =>
							event.target.value !== "" && setDate(event.target.value)
						}
					/>
				}
			>
				{t("overview.title")}
			</PageTitle>
			{day.data === undefined ? (
				day.isError ? (
					<PlainNote tone="negative">{t("common.failed")}</PlainNote>
				) : (
					<Loading label={t("app.loading")} />
				)
			) : (
				<>
					<div
						className="grid gap-3 sm:grid-cols-3"
						data-testid="overview-tiles"
					>
						<div className={`${card} p-4`}>
							<p className="text-sm font-bold text-ink-muted">
								{t("overview.revenue")}
							</p>
							<PriceText
								amount={day.data.revenue}
								size="lead"
								testId="overview-revenue"
							/>
						</div>
						<div className={`${card} p-4`}>
							<p className="text-sm font-bold text-ink-muted">
								{t("overview.orders")}
							</p>
							<p
								className="text-[19px] font-bold"
								data-testid="overview-orders"
							>
								{day.data.orders}
							</p>
						</div>
						<div className={`${card} p-4`}>
							<p className="text-sm font-bold text-ink-muted">
								{t("overview.average")}
							</p>
							<PriceText amount={day.data.average} size="lead" tone="ink" />
						</div>
					</div>
					<div className="grid gap-4 lg:grid-cols-2">
						<section className={`${card} flex flex-col gap-2 p-5`}>
							<h2 className="text-lg font-extrabold">{t("overview.byHour")}</h2>
							{day.data.byHour.length === 0 ? (
								<PlainNote>{t("overview.none")}</PlainNote>
							) : (
								<ul
									className="flex flex-col gap-1.5"
									data-testid="overview-hours"
								>
									{day.data.byHour.map((hour) => (
										<li
											key={hour.hour}
											className="grid grid-cols-[3.5rem_1fr_auto] items-center gap-2 text-sm"
										>
											<span className="font-bold tabular-nums">{`${String(hour.hour).padStart(2, "0")}:00`}</span>
											<span
												className="h-3 rounded-full bg-surface-sunken"
												aria-hidden="true"
											>
												<span
													className="block h-3 rounded-full bg-accent"
													style={{
														width: `${Math.max(4, (hour.revenue / top) * 100)}%`,
													}}
												/>
											</span>
											<span className="text-right tabular-nums">
												<PriceText amount={hour.revenue} tone="ink" /> ·{" "}
												{t("overview.ordersShort", { count: hour.orders })}
											</span>
										</li>
									))}
								</ul>
							)}
						</section>
						<section className={`${card} flex flex-col gap-2 p-5`}>
							<h2 className="text-lg font-extrabold">{t("overview.best")}</h2>
							{day.data.best.length === 0 ? (
								<PlainNote>{t("overview.none")}</PlainNote>
							) : (
								<ol className="flex flex-col gap-1" data-testid="overview-best">
									{day.data.best.map((item, index) => (
										<li key={item.name} className="flex justify-between gap-2">
											<span>
												{index + 1}. {item.name}
											</span>
											<span className="font-bold tabular-nums">
												{item.quantity}
											</span>
										</li>
									))}
								</ol>
							)}
						</section>
					</div>
					<Link
						to="/quan-ly/ca-lam"
						className="text-highlight underline-offset-4 hover:underline"
					>
						{t("overview.reconciliation")}
					</Link>
				</>
			)}
		</div>
	);
}
