import { useI18n } from "@fnb/zalo-mini/i18n";
import { PriceText } from "@fnb/zalo-mini/ui-kit";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { RpcError } from "../lib/rpc";
import { isManager, useMember, useSession } from "../lib/session";
import { useStore } from "../lib/store";
import { clockOf } from "../lib/time";
import { useBoard } from "../orders/board-context";
import { SearchIcon } from "../ui/icons";
import { button, card, field, Loading, PageTitle, PlainNote } from "../ui/kit";
import { useToast } from "../ui/toast";
import {
	byCategory,
	counterMenu,
	matches,
	setPause,
	setSoldOut,
} from "./menu-api";

const PAUSES = [15, 30, 60] as const;

function PausePanel() {
	const { t } = useI18n();
	const { client } = useSession();
	const { store } = useStore();
	const { member } = useMember();
	const { state, refresh } = useBoard();
	const { show } = useToast();
	const [reason, setReason] = useState("");
	const pausedUntil = state.ordering?.paused_until ?? null;
	const paused = state.ordering?.reason === "paused" && pausedUntil !== null;
	const run = async (minutes: number) => {
		try {
			await setPause(
				client,
				store.id,
				minutes,
				minutes === 0 || reason.trim() === "" ? null : reason.trim(),
			);
			show(minutes === 0 ? t("pause.resumed") : t("pause.paused", { minutes }));
			await refresh();
		} catch (error) {
			show(
				t(
					error instanceof RpcError && error.forbidden
						? "pause.tooLong"
						: "common.failed",
				),
			);
		}
	};
	return (
		<section
			className={`${card} flex flex-col gap-3 p-5`}
			data-testid="pause-panel"
		>
			<h2 className="text-lg font-extrabold">{t("pause.title")}</h2>
			{paused ? (
				<>
					<PlainNote tone="warning" testId="paused-note">
						{t("pause.until", { time: clockOf(pausedUntil) })}
					</PlainNote>
					<button
						type="button"
						className={button.primary}
						onClick={() => void run(0)}
						data-testid="resume"
					>
						{t("pause.resume")}
					</button>
				</>
			) : (
				<>
					<p className="text-sm text-ink-muted">{t("pause.lead")}</p>
					<input
						className={field}
						maxLength={80}
						placeholder={t("pause.reason")}
						aria-label={t("pause.reason")}
						value={reason}
						onChange={(event) => setReason(event.target.value)}
					/>
					<div className="flex flex-wrap gap-2">
						{(isManager(member) ? [...PAUSES, 120] : PAUSES).map((minutes) => (
							<button
								key={minutes}
								type="button"
								className={button.secondary}
								onClick={() => void run(minutes)}
								data-testid={`pause-${minutes}`}
							>
								{t("pause.minutes", { minutes })}
							</button>
						))}
					</div>
				</>
			)}
		</section>
	);
}

/** Món: switch an item sold out (S05) so the customer app hides it within seconds, and pause new app orders. */
export function SoldOutPage() {
	const { t } = useI18n();
	const { client } = useSession();
	const { store } = useStore();
	const { show } = useToast();
	const queries = useQueryClient();
	const [search, setSearch] = useState("");
	const [busy, setBusy] = useState<string | null>(null);
	const menu = useQuery({
		queryKey: ["counter-menu", store.id],
		queryFn: () => counterMenu(client, store.id),
		refetchInterval: 30_000,
	});
	const toggle = async (item: string, soldOut: boolean, name: string) => {
		setBusy(item);
		try {
			await setSoldOut(client, store.id, item, soldOut);
			show(soldOut ? t("soldOut.off", { name }) : t("soldOut.on", { name }));
			await queries.invalidateQueries({ queryKey: ["counter-menu", store.id] });
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
	const items = (menu.data?.items ?? []).filter((item) =>
		matches(item, search),
	);
	return (
		<div className="flex flex-col gap-4">
			<PageTitle>{t("soldOut.title")}</PageTitle>
			<div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
				<section className="flex flex-col gap-4">
					<label className="relative">
						<span className="sr-only">{t("soldOut.search")}</span>
						<span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-ink-muted">
							<SearchIcon />
						</span>
						<input
							className={`${field} pl-11`}
							placeholder={t("soldOut.search")}
							value={search}
							onChange={(event) => setSearch(event.target.value)}
							data-testid="menu-search"
						/>
					</label>
					{menu.data === undefined ? (
						<Loading label={t("app.loading")} />
					) : items.length === 0 ? (
						<PlainNote>{t("soldOut.none")}</PlainNote>
					) : (
						byCategory(items).map(([category, list]) => (
							<section key={category} className={`${card} p-4`}>
								<h2 className="pb-2 text-lg font-extrabold">{category}</h2>
								<ul className="divide-y divide-line">
									{list.map((item) => {
										const price =
											item.sizes.find((size) => size.is_default)?.price ??
											item.sizes[0]?.price ??
											0;
										return (
											<li
												key={item.id}
												className="flex min-h-16 items-center gap-3 py-2"
												data-testid="menu-row"
												data-item={item.name}
											>
												<div className="min-w-0 flex-1">
													<p
														className={`font-bold ${item.available ? "" : "text-ink-muted line-through"}`}
													>
														{item.name}
													</p>
													<p className="text-sm text-ink-muted">
														{item.available ? (
															<PriceText amount={price} tone="muted" />
														) : item.sold_out_until === null ? (
															t("soldOut.notOffered")
														) : (
															t("soldOut.until", {
																time: clockOf(item.sold_out_until),
															})
														)}
													</p>
												</div>
												<label className="flex min-h-11 items-center gap-2 font-bold">
													<span>
														{item.available
															? t("soldOut.available")
															: t("soldOut.soldOut")}
													</span>
													<input
														type="checkbox"
														role="switch"
														aria-checked={item.available}
														className="size-7 accent-[var(--positive)]"
														checked={item.available}
														disabled={
															busy === item.id ||
															(!item.available && item.sold_out_until === null)
														}
														aria-label={t("soldOut.switch", {
															name: item.name,
														})}
														onChange={(event) =>
															void toggle(
																item.id,
																!event.target.checked,
																item.name,
															)
														}
														data-testid="sold-out-switch"
													/>
												</label>
											</li>
										);
									})}
								</ul>
							</section>
						))
					)}
				</section>
				<PausePanel />
			</div>
		</div>
	);
}
