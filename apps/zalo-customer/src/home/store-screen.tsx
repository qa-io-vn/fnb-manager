import type { CustomerHome, CustomerStore } from "@fnb/zalo-mini/loyalty";
import { useI18n } from "@fnb/zalo-mini/react";
import { useEffect, useId } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useCustomerData } from "../data/customer-data";
import { isoDateIn } from "../data/dates";
import { useStoreLink } from "../data/store-link";
import {
	BackButton,
	Card,
	Failed,
	Loading,
	primaryButton,
	Screen,
	secondaryButton,
} from "../ui";
import { MenuList } from "./home-screen";
import { JoinActions } from "./join-actions";
import { hoursKnown, menuAt, spansText, weekRows } from "./model";

function StoreDetails({
	home,
	store,
}: {
	readonly home: CustomerHome;
	readonly store: CustomerStore;
}) {
	const { t } = useI18n();
	const navigate = useNavigate();
	const { member } = useCustomerData();
	const { chooseStore } = useStoreLink();
	const hoursId = useId();
	const menuId = useId();
	const today = isoDateIn(Date.now());
	useEffect(() => {
		chooseStore(store.code);
	}, [chooseStore, store.code]);
	const menu = menuAt(home.menu, store.code);
	return (
		<Screen testId="store">
			<BackButton to="/" />
			<div className="flex flex-col gap-1">
				<h1 className="text-xl font-semibold text-ink">{store.name}</h1>
				{store.address === null ? null : (
					<p className="text-base text-ink" data-testid="store-address">
						{store.address}
					</p>
				)}
			</div>
			<Card labelledBy={hoursId} testId="store-hours">
				<h2 id={hoursId} className="text-lg font-semibold text-ink">
					{t("store.hours")}
				</h2>
				{hoursKnown(store) ? (
					<dl className="flex flex-col gap-1">
						{weekRows(store, today).map((row) => (
							<div
								key={row.weekday}
								className={`flex justify-between gap-3 text-base ${row.today ? "font-semibold text-ink" : "text-ink"}`}
								data-today={row.today ? "true" : undefined}
							>
								<dt>{t(`weekday.${row.weekday}`)}</dt>
								<dd>
									{row.spans.length === 0
										? t("store.closed")
										: spansText(row.spans)}
								</dd>
							</div>
						))}
					</dl>
				) : (
					<p className="text-base text-ink">{t("store.hoursUnknown")}</p>
				)}
			</Card>
			<div className="flex flex-col gap-2">
				{member ? (
					<>
						<button
							type="button"
							className={primaryButton}
							onClick={() => navigate("/ma-thanh-vien")}
						>
							{t("store.showCode")}
						</button>
						<button
							type="button"
							className={secondaryButton}
							onClick={() => navigate("/nhan-diem")}
						>
							{t("home.claim")}
						</button>
					</>
				) : (
					<JoinActions claim />
				)}
			</div>
			{menu.length === 0 ? null : (
				<section aria-labelledby={menuId} className="flex flex-col gap-2">
					<h2 id={menuId} className="text-lg font-semibold text-ink">
						{t("home.menu")}
					</h2>
					<p className="text-sm text-ink-muted">{t("home.menuNote")}</p>
					<MenuList items={menu} />
				</section>
			)}
		</Screen>
	);
}

export function StoreScreen() {
	const { t } = useI18n();
	const { code } = useParams();
	const { home, reloadHome } = useCustomerData();
	if (home.status === "loading") return <Loading />;
	if (home.status === "failed")
		return <Failed failure={home.failure} onRetry={reloadHome} />;
	const store = home.data.stores.find((entry) => entry.code === code);
	if (store === undefined) {
		return (
			<Screen testId="store-missing">
				<BackButton to="/" />
				<h1 className="text-xl font-semibold text-ink">
					{t("store.missingTitle")}
				</h1>
				<p className="text-base text-ink">{t("store.missingBody")}</p>
			</Screen>
		);
	}
	return <StoreDetails home={home.data} store={store} />;
}
