import { useI18n } from "@fnb/zalo-mini/i18n";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router-dom";
import { RpcError, rpc } from "../lib/rpc";
import { useSession } from "../lib/session";
import { useStore } from "../lib/store";
import { minutesBetween } from "../lib/time";
import { useBoard } from "../orders/board-context";
import { isActive } from "../orders/board-model";
import { useNow } from "../orders/order-bits";
import { BellIcon } from "../ui/icons";
import { button, card, Loading, PageTitle, PlainNote } from "../ui/kit";
import { useToast } from "../ui/toast";

export interface MapTable {
	readonly id: string;
	readonly label: string;
	readonly area: string | null;
	readonly sort_order: number;
	readonly call: {
		readonly id: string;
		readonly called_at: string;
		readonly waiting_seconds: number;
	} | null;
	readonly open_orders: number;
}

export type TableState = "calling" | "occupied" | "free";

/** A table's state on the map: a call waiting first, then open orders, else free. */
export function tableState(
	table: MapTable,
	callIds: ReadonlySet<string>,
	ordersHere: number,
): TableState {
	if (table.call !== null && callIds.has(table.call.id)) return "calling";
	return ordersHere > 0 || table.open_orders > 0 ? "occupied" : "free";
}

/** The tables grouped by area in their order, areas in the order of their first table. */
export function byArea(tables: readonly MapTable[]): [string, MapTable[]][] {
	const groups = new Map<string, MapTable[]>();
	for (const table of [...tables].sort(
		(a, b) => a.sort_order - b.sort_order || a.label.localeCompare(b.label),
	)) {
		const area = table.area ?? "";
		groups.set(area, [...(groups.get(area) ?? []), table]);
	}
	return [...groups.entries()];
}

const TONE: Readonly<Record<TableState, string>> = {
	calling: "border-negative bg-negative-soft",
	occupied: "border-line bg-warning-soft",
	free: "border-line bg-surface-raised",
};

/** Bàn: the table map with live states and staff calls; "Tới ngay" answers a call (the plan's notification table). */
export function TablesPage() {
	const { t } = useI18n();
	const { client } = useSession();
	const { store } = useStore();
	const { state, removeCall } = useBoard();
	const { show } = useToast();
	const now = useNow(10_000);
	const [busy, setBusy] = useState<string | null>(null);
	const map = useQuery({
		queryKey: [
			"table-map",
			store.id,
			state.calls.map((call) => call.id).join(","),
		],
		queryFn: () =>
			rpc<{ tables: MapTable[] }>(client, "counter_table_map", {
				p_store: store.id,
			}),
		refetchInterval: 10_000,
	});
	const callIds = new Set(state.calls.map((call) => call.id));
	const answer = async (callId: string) => {
		setBusy(callId);
		try {
			await rpc(client, "counter_ack_call", { p_call: callId });
			removeCall(callId);
			show(t("tables.acknowledged"));
			await map.refetch();
		} catch (error) {
			show(
				t(
					error instanceof RpcError && error.network
						? "common.network"
						: "common.failed",
				),
			);
		} finally {
			setBusy(null);
		}
	};
	const ordersOf = (tableId: string) =>
		[...state.orders.values()].filter(
			(order) => order.table?.id === tableId && isActive(order),
		);
	return (
		<div className="flex flex-col gap-4">
			<PageTitle>{t("tables.title")}</PageTitle>
			{map.data === undefined ? (
				map.isError ? (
					<PlainNote tone="negative">{t("common.failed")}</PlainNote>
				) : (
					<Loading label={t("app.loading")} />
				)
			) : map.data.tables.length === 0 ? (
				<PlainNote>{t("tables.none")}</PlainNote>
			) : (
				byArea(map.data.tables).map(([area, tables]) => (
					<section key={area} className="flex flex-col gap-3">
						{area === "" ? null : (
							<h2 className="text-lg font-extrabold">{area}</h2>
						)}
						<ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
							{tables.map((table) => {
								const here = ordersOf(table.id);
								const status = tableState(table, callIds, here.length);
								const unpaid = here.some(
									(order) => order.payment_status === "unpaid",
								);
								return (
									<li
										key={table.id}
										className={`${card} flex min-h-32 flex-col gap-2 border-2 p-4 ${TONE[status]}`}
										data-testid="table-tile"
										data-table={table.label}
										data-state={status}
									>
										<p className="flex items-center gap-2 text-xl font-extrabold">
											{status === "calling" ? <BellIcon /> : null}
											{table.label}
										</p>
										<p className="text-sm font-bold">
											{status === "calling" && table.call !== null
												? t("tables.calling", {
														minutes: minutesBetween(table.call.called_at, now),
													})
												: status === "occupied"
													? t("tables.occupied", {
															count: Math.max(here.length, table.open_orders),
														})
													: t("tables.free")}
										</p>
										{unpaid ? (
											<p className="text-sm">{t("order.payment.unpaid")}</p>
										) : null}
										{here.slice(0, 2).map((order) => (
											<Link
												key={order.id}
												to={`/don/${order.id}`}
												className="text-sm underline-offset-4 hover:underline"
											>
												{order.display_no} · {t(`order.status.${order.status}`)}
											</Link>
										))}
										{status === "calling" && table.call !== null ? (
											<button
												type="button"
												className={`${button.destructive} mt-auto min-h-12`}
												disabled={busy === table.call.id}
												onClick={() => void answer(table.call?.id ?? "")}
												data-testid="ack-call"
											>
												{t("tables.comeNow")}
											</button>
										) : null}
									</li>
								);
							})}
						</ul>
					</section>
				))
			)}
		</div>
	);
}
