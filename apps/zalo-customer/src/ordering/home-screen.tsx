import { kitButton, StatusPill, useI18n } from "@fnb/zalo-mini/react";
import { useNavigate } from "react-router-dom";
import { useCustomerData } from "../data/customer-data";
import { LegalButtons } from "../legal/legal-popups";
import { Failed } from "../ui";
import { closedKind } from "./order-view";
import { useOrdering } from "./ordering-data";
import { ChevronRight, MenuIcon, ScanIcon, StarIcon, TableIcon } from "./parts";
import { useStampCard } from "./stamp-card";
import { ClosedState, useTableScan } from "./states";

// C01 Trang chủ of the ordering build (design spec 6.2): the greeting with the table the server named for the
// scanned QR, two tiles (order at the table, or scan its code; the menu), the stamp card's progress and the shop's
// legal texts. No price on this screen. The points programme stays reachable from Tích điểm.

function Hero() {
	const { t } = useI18n();
	const { session } = useCustomerData();
	const { table } = useOrdering();
	const name = session?.customer.displayName ?? null;
	const greeting =
		table?.state === "ok"
			? t("ordering.helloTable", { table: table.label })
			: name === null
				? t("ordering.hello")
				: t("ordering.helloName", { name });
	return (
		<header
			className="flex min-h-36 flex-col justify-end gap-2 rounded-card bg-accent p-5 text-accent-ink shadow-card"
			data-testid="brand-hero"
		>
			<h1
				className="text-[24px] font-bold leading-tight"
				data-testid="greeting"
			>
				{greeting}
			</h1>
			<p className="text-[15px]">
				{table?.state === "ok"
					? t("ordering.heroLineTable")
					: t("ordering.heroLine")}
			</p>
		</header>
	);
}

function Tiles() {
	const { t } = useI18n();
	const navigate = useNavigate();
	const { table, menu } = useOrdering();
	const { scan, problem } = useTableScan();
	const paused =
		menu.status === "ready" && closedKind(menu.data.ordering) === "paused";
	const tableSub =
		table?.state === "ok"
			? table.area === null
				? t("ordering.tileTableOnly", { table: table.label })
				: t("ordering.tileTableSub", { table: table.label, area: table.area })
			: t("ordering.tileScan");
	const tile =
		"flex min-h-28 flex-col items-start justify-between gap-2 rounded-card border-card border-line/60 bg-surface-raised p-4 text-left shadow-card focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus";
	return (
		<>
			<div className="grid grid-cols-2 gap-3">
				<button
					type="button"
					className={tile}
					onClick={() =>
						table?.state === "ok" ? navigate("/thuc-don") : scan()
					}
					aria-label={`${t("ordering.tileTable")}, ${tableSub}`}
					data-testid="home-tile-table"
					data-state={table?.state === "ok" ? "table" : "scan"}
				>
					<span className="text-highlight">
						{table?.state === "ok" ? <TableIcon /> : <ScanIcon />}
					</span>
					<span className="flex flex-col gap-0.5">
						<span className="text-[15px] font-bold text-ink">
							{t("ordering.tileTable")}
						</span>
						<span className="text-[13px] text-ink-muted">{tableSub}</span>
					</span>
					{paused ? (
						<StatusPill tone="warning">{t("ordering.tilePaused")}</StatusPill>
					) : null}
				</button>
				<button
					type="button"
					className={tile}
					onClick={() => navigate("/thuc-don")}
					data-testid="home-tile-menu"
				>
					<span className="text-highlight">
						<MenuIcon />
					</span>
					<span className="flex flex-col gap-0.5">
						<span className="text-[15px] font-bold text-ink">
							{t("ordering.tileMenu")}
						</span>
						<span className="text-[13px] text-ink-muted">
							{t("ordering.tileMenuSub")}
						</span>
					</span>
				</button>
			</div>
			{problem === null ? null : (
				<p
					role="alert"
					className="text-body text-ink"
					data-testid="scan-problem"
				>
					{t(problem)}
				</p>
			)}
		</>
	);
}

function StampStrip() {
	const { t } = useI18n();
	const navigate = useNavigate();
	const { load } = useStampCard();
	if (load.status !== "ready" || !load.card.enabled) return null;
	const { card } = load;
	const left = Math.max(0, card.stampsPerReward - card.stamps);
	const percent = Math.round((card.stamps / card.stampsPerReward) * 100);
	return (
		<button
			type="button"
			onClick={() => navigate("/the-thanh-vien")}
			className="flex items-center gap-3 rounded-card border-card border-line/60 bg-surface-raised p-4 text-left shadow-card focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
			data-testid="loyalty-strip"
			data-stamps={card.stamps}
			data-total={card.stampsPerReward}
		>
			<span
				aria-hidden="true"
				className="flex size-12 shrink-0 items-center justify-center rounded-full bg-badge text-badge-ink"
			>
				<StarIcon />
			</span>
			<span className="flex min-w-0 flex-1 flex-col gap-1">
				<span className="text-[15px] font-bold text-ink">
					{t("stampStrip.title")}
				</span>
				<span className="text-[13px] text-ink">
					{card.rewards.length > 0
						? t("stampStrip.full", { reward: card.rewardName })
						: t("stampStrip.left", {
								stamps: card.stamps,
								total: card.stampsPerReward,
								left,
							})}
				</span>
				<span
					role="progressbar"
					aria-valuemin={0}
					aria-valuemax={card.stampsPerReward}
					aria-valuenow={card.stamps}
					aria-valuetext={t("stampStrip.progress", {
						stamps: card.stamps,
						total: card.stampsPerReward,
					})}
					className="h-2 overflow-hidden rounded-full bg-surface-sunken"
				>
					<span
						className="block h-full rounded-full bg-accent"
						style={{ width: `${percent}%` }}
					/>
				</span>
			</span>
			<ChevronRight />
		</button>
	);
}

export function OrderingHomeScreen() {
	const { home, sessionState, retrySession, reloadHome } = useCustomerData();
	const { menu } = useOrdering();
	const navigate = useNavigate();
	const { t } = useI18n();
	return (
		<section className="flex flex-col gap-4 px-4 py-5" data-testid="home">
			<Hero />
			{home.status === "failed" ? (
				<Failed
					failure={home.failure}
					detail={home.detail}
					onRetry={sessionState.status === "failed" ? retrySession : reloadHome}
				/>
			) : null}
			{menu.status === "ready" &&
			closedKind(menu.data.ordering) === "closed" ? (
				<>
					<ClosedState menu={menu.data} />
					<button
						type="button"
						className={`${kitButton.primary} w-full`}
						onClick={() => navigate("/thuc-don")}
						data-testid="closed-menu"
					>
						{t("closed.menu")}
					</button>
				</>
			) : (
				<Tiles />
			)}
			<StampStrip />
			<LegalButtons />
		</section>
	);
}
