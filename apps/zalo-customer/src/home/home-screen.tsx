import type {
	CustomerHome,
	LoyaltyClient,
	MenuHighlight,
} from "@fnb/zalo-mini/loyalty";
import { BrandBanner, currentBrandTheme, useI18n } from "@fnb/zalo-mini/react";
import { useId } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useCustomerData, useLoad } from "../data/customer-data";
import { isoDateIn } from "../data/dates";
import {
	ChevronIcon,
	CupIcon,
	GiftIcon,
	PinIcon,
	QrIcon,
	ReceiptIcon,
	StoreIcon,
	TicketIcon,
} from "../icons";
import { LegalButtons } from "../legal/legal-popups";
import {
	Card,
	Failed,
	HomeSkeleton,
	IconBadge,
	Loading,
	NoStores,
	primaryButton,
	rowButton,
	SectionTitle,
	secondaryButton,
} from "../ui";
import { BillsPrompt } from "./bills-prompt";
import { CupRow, stampsProgress } from "./cup-row";
import { JoinActions } from "./join-actions";
import { hoursOn, spansText } from "./model";
import { programmeTexts } from "./programme";

export type DeclineReason = "purpose" | "phone" | "consent";

export interface HomeLocationState {
	readonly declined?: DeclineReason;
}

export function MenuList({
	items,
}: {
	readonly items: readonly MenuHighlight[];
}) {
	const { t } = useI18n();
	return (
		<ul className="flex flex-col gap-2" data-testid="menu-list">
			{items.map((item) => (
				<li
					key={item.id}
					className="flex items-center gap-3 rounded-card-2xl border-card border-line/60 bg-surface-raised px-4 py-3"
					data-testid="menu-item"
				>
					<span
						aria-hidden="true"
						className="flex size-10 shrink-0 items-center justify-center rounded-full bg-surface-sunken p-2 text-ink-muted"
					>
						<CupIcon filled={false} />
					</span>
					<div className="flex min-w-0 flex-1 flex-col gap-0.5">
						<span className="text-body font-semibold text-ink">
							{item.name}
						</span>
						{item.description === null ? null : (
							<span className="text-sm text-ink-muted">{item.description}</span>
						)}
					</div>
					<span
						className="shrink-0 rounded-full bg-neutral-soft px-2.5 py-0.5 text-xs font-medium text-ink"
						data-testid="menu-at-counter"
					>
						{t("home.atCounter")}
					</span>
				</li>
			))}
		</ul>
	);
}

function DeclinedNotice({ reason }: { readonly reason: DeclineReason }) {
	const { t } = useI18n();
	return (
		<p
			role="status"
			className="rounded-card-2xl bg-neutral-soft px-4 py-3 text-body text-ink"
			data-testid="declined-notice"
		>
			{t(`home.declined.${reason}`)}
		</p>
	);
}

const kicker =
	"text-xs font-semibold tracking-[0.14em] text-ink-muted uppercase";

const loadWallet = (client: LoyaltyClient) => client.wallet();

/**
 * The cups of the programme's card. A member sees the stamps of their first card filled and how many are left once
 * the wallet has answered; a visitor, or a member whose wallet is still loading or failed, sees an empty card.
 */
function MemberStamps({ perCard }: { readonly perCard: number }) {
	const { t } = useI18n();
	const { member } = useCustomerData();
	const { state } = useLoad(member ? loadWallet : null);
	const card =
		member && state.status === "ready"
			? (state.data.stampCards[0] ?? null)
			: null;
	if (card === null) return <CupRow total={perCard} />;
	const progress = stampsProgress(card.stamps, card.stampsPerCard);
	return (
		<div className="flex flex-col gap-2" data-testid="home-stamps">
			<CupRow total={progress.total} filled={progress.filled} />
			<p
				className="text-sm font-semibold text-ink"
				data-testid="home-stamps-left"
			>
				{progress.full
					? t("home.cardFull")
					: t("home.stampsLeft", {
							stamps: progress.filled,
							total: progress.total,
							left: progress.left,
						})}
			</p>
		</div>
	);
}

/** The first card of the home: the programme and what to do next (join, or open the card for a member). */
function ProgrammeCard({ home }: { readonly home: CustomerHome }) {
	const { t } = useI18n();
	const navigate = useNavigate();
	const { member } = useCustomerData();
	const titleId = useId();
	const programme = home.programme;
	const texts = programme === null ? null : programmeTexts(programme, t);
	return (
		<Card labelledBy={titleId} testId="programme">
			<div className="flex items-center justify-between gap-3">
				<p className={kicker}>{t("home.programmeKicker")}</p>
				{member ? (
					<span
						className="rounded-full bg-positive-soft px-2.5 py-0.5 text-xs font-semibold text-ink"
						data-testid="member-badge"
					>
						{t("home.youAreMember")}
					</span>
				) : programme === null ? (
					<span className="rounded-full bg-neutral-soft px-2.5 py-0.5 text-xs font-semibold text-ink">
						{t("home.comingSoon")}
					</span>
				) : null}
			</div>
			<h1 id={titleId} className="text-2xl font-bold leading-tight text-ink">
				{programme?.name ?? t("home.noProgrammeTitle")}
			</h1>
			{texts === null ? (
				<>
					<CupRow total={6} />
					<p className="text-body text-ink">{t("home.noProgrammeBody")}</p>
				</>
			) : (
				<>
					<p
						className="text-lg font-bold leading-snug"
						style={{ color: "var(--brand-highlight, var(--color-ink))" }}
					>
						{texts.reward}
					</p>
					<MemberStamps perCard={programme?.stampsPerCard ?? 1} />
					<p className="text-body text-ink">{texts.summary}</p>
					<details className="group rounded-card-2xl bg-surface-sunken">
						{/* the whole row is the tap target, at least 44 px high */}
						<summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 rounded-card-2xl px-4 text-sm font-semibold text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus">
							{t("home.rules")}
							<span
								aria-hidden="true"
								className="text-lg text-ink-muted transition-transform group-open:rotate-90"
							>
								›
							</span>
						</summary>
						<div className="px-4 pb-3">
							<ul className="flex list-disc flex-col gap-1 pl-5 text-sm text-ink-muted">
								{texts.rules.map((rule) => (
									<li key={rule}>{rule}</li>
								))}
							</ul>
							{texts.period === null ? null : (
								<p
									className="mt-2 text-sm text-ink-muted"
									data-testid="programme-period"
								>
									{texts.period}
								</p>
							)}
						</div>
					</details>
				</>
			)}
			{member ? (
				<div className="flex flex-col gap-2 pt-1">
					<button
						type="button"
						className={primaryButton}
						onClick={() => navigate("/the-thanh-vien")}
					>
						{t("home.openCard")}
					</button>
					<button
						type="button"
						className={secondaryButton}
						onClick={() => navigate("/nhan-diem")}
					>
						<ReceiptIcon />
						{t("home.claim")}
					</button>
				</div>
			) : (
				<JoinActions claim />
			)}
		</Card>
	);
}

/** A member's three shortcuts: the code to show at the counter, rewards and the voucher wallet. */
function Shortcuts() {
	const { t } = useI18n();
	const navigate = useNavigate();
	const tiles = [
		{ to: "/ma-thanh-vien", label: t("wallet.showCode"), icon: <QrIcon /> },
		{ to: "/doi-qua", label: t("reward.open"), icon: <GiftIcon /> },
		{ to: "/vi-voucher", label: t("voucher.wallet"), icon: <TicketIcon /> },
	];
	return (
		// a region, not a second navigation landmark: the tab bar stays the app's only navigation
		<section
			aria-label={t("home.shortcuts")}
			className="grid grid-cols-3 gap-2"
			data-testid="shortcuts"
		>
			{tiles.map((tile) => (
				<button
					key={tile.to}
					type="button"
					onClick={() => navigate(tile.to)}
					className="flex min-h-24 flex-col items-center justify-center gap-2 rounded-card-2xl border-card border-line/60 bg-surface-raised px-2 py-3 text-center text-sm font-medium text-ink transition-transform active:scale-[0.97] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
				>
					<IconBadge>{tile.icon}</IconBadge>
					{tile.label}
				</button>
			))}
		</section>
	);
}

function StoreList({ home }: { readonly home: CustomerHome }) {
	const { t } = useI18n();
	const navigate = useNavigate();
	const storesId = useId();
	const today = isoDateIn(Date.now());
	return (
		<section aria-labelledby={storesId} className="flex flex-col gap-2">
			<SectionTitle id={storesId}>{t("home.stores")}</SectionTitle>
			{home.stores.length === 0 ? (
				<NoStores />
			) : (
				<ul className="flex flex-col gap-2" data-testid="store-list">
					{home.stores.map((store) => {
						const hours = hoursOn(store, today);
						return (
							<li key={store.code}>
								<button
									type="button"
									className={rowButton}
									onClick={() => navigate(`/cua-hang/${store.code}`)}
								>
									<IconBadge>
										<StoreIcon />
									</IconBadge>
									<span className="flex min-w-0 flex-1 flex-col gap-1">
										<span className="text-body font-semibold">
											{store.name}
										</span>
										<span
											className="flex items-center gap-1.5 text-sm text-ink"
											data-hours={hours.kind}
										>
											<span
												aria-hidden="true"
												className={`size-2 shrink-0 rounded-full ${hours.kind === "open" ? "bg-positive" : hours.kind === "closed" ? "bg-negative" : "bg-line"}`}
											/>
											{hours.kind === "open"
												? t("store.todayHours", {
														hours: spansText(hours.spans),
													})
												: hours.kind === "closed"
													? t("store.closedToday")
													: t("store.hoursUnknown")}
										</span>
										{store.address === null ? null : (
											<span className="flex items-start gap-1 text-sm text-ink-muted">
												<PinIcon />
												{store.address}
											</span>
										)}
									</span>
									<ChevronIcon />
								</button>
							</li>
						);
					})}
				</ul>
			)}
		</section>
	);
}

function Greeting() {
	const { t } = useI18n();
	const { session } = useCustomerData();
	const name = session?.customer.displayName ?? null;
	return (
		<span data-testid="greeting">
			{name === null ? t("home.hello") : t("home.helloName", { name })}
		</span>
	);
}

/** The banner sits behind the first card when the brand has a theme; without one the page starts with the card. */
function overlapClass(): string {
	return currentBrandTheme() === null ? "pt-5" : "-mt-12";
}

function ReadyHome({ home }: { readonly home: CustomerHome }) {
	const { t } = useI18n();
	const location = useLocation();
	const { member } = useCustomerData();
	const declined = (location.state as HomeLocationState | null)?.declined;
	const menuId = useId();
	return (
		<section data-testid="home" className="flex flex-col pb-6">
			<BrandBanner overlap>
				<Greeting />
			</BrandBanner>
			<div className={`relative flex flex-col gap-5 px-4 ${overlapClass()}`}>
				<ProgrammeCard home={home} />
				{declined === undefined ? null : <DeclinedNotice reason={declined} />}
				<BillsPrompt home={home} />
				{member ? <Shortcuts /> : null}
				<StoreList home={home} />
				{home.menu.length === 0 ? null : (
					<section aria-labelledby={menuId} className="flex flex-col gap-2">
						<SectionTitle id={menuId}>{t("home.menu")}</SectionTitle>
						<p className="px-1 text-sm text-ink-muted">{t("home.menuNote")}</p>
						<MenuList items={home.menu} />
					</section>
				)}
				<LegalButtons />
			</div>
		</section>
	);
}

export function HomeScreen() {
	const { home, sessionState, retrySession, reloadHome } = useCustomerData();
	if (home.status === "ready") return <ReadyHome home={home.data} />;
	return (
		<div className="flex flex-col pb-6">
			<BrandBanner overlap>
				<Greeting />
			</BrandBanner>
			<div className={`relative flex flex-col gap-3 ${overlapClass()}`}>
				{home.status === "failed" ? (
					<Failed
						failure={home.failure}
						detail={home.detail}
						onRetry={
							sessionState.status === "failed" ? retrySession : reloadHome
						}
					/>
				) : (
					<>
						<HomeSkeleton />
						<Loading />
					</>
				)}
			</div>
		</div>
	);
}
