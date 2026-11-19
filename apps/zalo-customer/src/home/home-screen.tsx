import type { CustomerHome, MenuHighlight } from "@fnb/zalo-mini/loyalty";
import { useI18n } from "@fnb/zalo-mini/react";
import { useId } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useCustomerData } from "../data/customer-data";
import { isoDateIn } from "../data/dates";
import { LegalButtons } from "../legal/legal-popups";
import {
	Card,
	Failed,
	Loading,
	primaryButton,
	rowButton,
	Screen,
	secondaryButton,
} from "../ui";
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
					className="flex items-start justify-between gap-3 rounded-xl bg-surface-raised px-4 py-3"
					data-testid="menu-item"
				>
					<div className="flex min-w-0 flex-col gap-0.5">
						<span className="text-base font-semibold text-ink">
							{item.name}
						</span>
						{item.description === null ? null : (
							<span className="text-sm text-ink-muted">{item.description}</span>
						)}
					</div>
					<span
						className="shrink-0 rounded-full bg-neutral-soft px-2 py-0.5 text-sm text-ink"
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
			className="rounded-xl bg-neutral-soft px-4 py-3 text-base text-ink"
			data-testid="declined-notice"
		>
			{t(`home.declined.${reason}`)}
		</p>
	);
}

function ReadyHome({ home }: { readonly home: CustomerHome }) {
	const { t } = useI18n();
	const navigate = useNavigate();
	const location = useLocation();
	const { member } = useCustomerData();
	const declined = (location.state as HomeLocationState | null)?.declined;
	const today = isoDateIn(Date.now());
	const titleId = useId();
	const storesId = useId();
	const menuId = useId();
	const texts = programmeTexts(home.programme, t);
	return (
		<Screen testId="home">
			{declined === undefined ? null : <DeclinedNotice reason={declined} />}
			<Card labelledBy={titleId} testId="programme">
				<h1 id={titleId} className="text-xl font-semibold text-ink">
					{home.programme.name}
				</h1>
				<p className="text-base text-ink">{texts.summary}</p>
				<p className="text-base font-semibold text-ink">{texts.reward}</p>
				<ul className="flex list-disc flex-col gap-1 pl-5 text-sm text-ink-muted">
					{texts.rules.map((rule) => (
						<li key={rule}>{rule}</li>
					))}
				</ul>
				{texts.period === null ? null : (
					<p className="text-sm text-ink-muted" data-testid="programme-period">
						{texts.period}
					</p>
				)}
				{member ? (
					<div className="flex flex-col gap-2">
						<p className="text-base text-ink" data-testid="member-badge">
							{t("home.youAreMember")}
						</p>
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
							{t("home.claim")}
						</button>
					</div>
				) : (
					<div className="flex flex-col gap-2">
						<button
							type="button"
							className={primaryButton}
							onClick={() => navigate("/tham-gia")}
						>
							{t("home.join")}
						</button>
						<button
							type="button"
							className={secondaryButton}
							onClick={() =>
								navigate("/tham-gia", { state: { next: "claim" } })
							}
						>
							{t("home.claim")}
						</button>
					</div>
				)}
			</Card>
			<section aria-labelledby={storesId} className="flex flex-col gap-2">
				<h2 id={storesId} className="text-lg font-semibold text-ink">
					{t("home.stores")}
				</h2>
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
									<span className="flex min-w-0 flex-1 flex-col gap-0.5">
										<span className="text-base font-semibold">
											{store.name}
										</span>
										{store.address === null ? null : (
											<span className="text-sm text-ink-muted">
												{store.address}
											</span>
										)}
										<span className="text-sm text-ink-muted">
											{hours.kind === "open"
												? t("store.todayHours", {
														hours: spansText(hours.spans),
													})
												: hours.kind === "closed"
													? t("store.closedToday")
													: t("store.hoursUnknown")}
										</span>
									</span>
									<svg
										aria-hidden="true"
										width="20"
										height="20"
										viewBox="0 0 20 20"
										fill="none"
										stroke="currentColor"
										strokeWidth="1.8"
										strokeLinecap="round"
										strokeLinejoin="round"
									>
										<path d="M7.5 4.5L13 10l-5.5 5.5" />
									</svg>
								</button>
							</li>
						);
					})}
				</ul>
			</section>
			{home.menu.length === 0 ? null : (
				<section aria-labelledby={menuId} className="flex flex-col gap-2">
					<h2 id={menuId} className="text-lg font-semibold text-ink">
						{t("home.menu")}
					</h2>
					<p className="text-sm text-ink-muted">{t("home.menuNote")}</p>
					<MenuList items={home.menu} />
				</section>
			)}
			<LegalButtons />
		</Screen>
	);
}

export function HomeScreen() {
	const { home, sessionState, retrySession, reloadHome } = useCustomerData();
	if (home.status === "ready") return <ReadyHome home={home.data} />;
	if (home.status === "failed") {
		return (
			<Failed
				failure={home.failure}
				onRetry={sessionState.status === "failed" ? retrySession : reloadHome}
			/>
		);
	}
	return <Loading />;
}
