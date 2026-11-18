import {
	createRestClient,
	type DataEndpoint,
	isSessionFresh,
	type StoredSession,
} from "@fnb/zalo-mini";
import {
	SessionScreen,
	useDataEndpoint,
	useI18n,
	useSession,
} from "@fnb/zalo-mini/react";
import {
	type ReactNode,
	useEffect,
	useId,
	useMemo,
	useRef,
	useState,
} from "react";
import { HomeTaskSlot } from "../shift/home-slot";
import { createHomeFormatters, type HomeFormatters } from "./format";
import { type HomeCard, type HoursToday, homeCards } from "./model";
import { createSampleHomeSource, sampleSettingsFrom } from "./sample";
import {
	createRestHomeSource,
	type DayTotals,
	type Freshness,
	freshnessMessage,
	type HomeData,
	type HomeQuery,
	type HomeSource,
	type HomeStore,
} from "./source";
import { useHomeData } from "./use-home-data";

export type HomeSourceFactory = (
	endpoint: DataEndpoint,
	session: StoredSession,
) => HomeSource;

export function homeSourceFor(
	endpoint: DataEndpoint,
	session: StoredSession,
): HomeSource {
	if (endpoint.kind === "stand-in") {
		return createSampleHomeSource(sampleSettingsFrom(window.location.search));
	}
	return createRestHomeSource(
		createRestClient({
			url: endpoint.url,
			publishableKey: endpoint.publishableKey,
			accessToken: session.accessToken,
		}),
	);
}

const UNAUTHORIZED = 401;
const FORBIDDEN = 403;

const primaryButton =
	"min-h-11 w-full rounded-xl bg-accent px-4 text-base font-semibold text-accent-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus";

const focusRing =
	"focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus";

function Card({
	testId,
	label,
	wide,
	state,
	children,
}: {
	readonly testId: string;
	readonly label: string;
	readonly wide?: boolean;
	readonly state?: string;
	readonly children: ReactNode;
}) {
	return (
		<div
			data-testid={testId}
			data-state={state}
			className={`flex min-w-0 flex-col gap-1 rounded-2xl border border-line bg-surface-raised p-4 ${wide ? "col-span-2" : ""}`}
		>
			<p className="text-sm text-ink-muted">{label}</p>
			{children}
		</div>
	);
}

function NoData() {
	const { t } = useI18n();
	return <p className="py-1 text-base text-ink-muted">{t("home.noData")}</p>;
}

function MoneyValue({
	value,
	formatters,
	testId,
}: {
	readonly value: number;
	readonly formatters: HomeFormatters;
	readonly testId: string;
}) {
	const { t } = useI18n();
	const [open, setOpen] = useState(false);
	const exactId = useId();
	const hintId = useId();
	const compact = formatters.moneyCompact(value);
	const exact = formatters.moneyExact(value);
	if (compact === exact) {
		return (
			<p
				className="text-3xl font-semibold tabular-nums text-ink"
				data-testid={testId}
				data-exact={exact}
			>
				{compact}
			</p>
		);
	}
	return (
		<>
			<button
				type="button"
				data-testid={testId}
				data-exact={exact}
				aria-expanded={open}
				aria-controls={exactId}
				aria-describedby={hintId}
				onClick={() => setOpen((current) => !current)}
				className={`min-h-11 self-start rounded-lg text-left text-3xl font-semibold tabular-nums text-ink underline decoration-line decoration-dotted decoration-2 underline-offset-8 ${focusRing}`}
			>
				{compact}
			</button>
			<span id={hintId} className="sr-only">
				{t("home.exactHint")}
			</span>
			<p
				id={exactId}
				hidden={!open}
				className="text-sm text-ink-muted tabular-nums"
				data-testid={`${testId}-exact`}
			>
				{t("home.exactValue", { value: exact })}
			</p>
		</>
	);
}

function counted(totals: DayTotals | null): DayTotals | null {
	return totals === null || totals.invoices === 0 ? null : totals;
}

function NetRevenueCard({
	totals,
	formatters,
}: {
	readonly totals: DayTotals | null;
	readonly formatters: HomeFormatters;
}) {
	const { t } = useI18n();
	const shown = counted(totals);
	return (
		<Card
			testId="home-card-net-revenue"
			label={t("home.netRevenue")}
			state={shown === null ? "empty" : "value"}
			wide
		>
			{shown === null ? (
				<NoData />
			) : (
				<MoneyValue
					value={shown.net}
					formatters={formatters}
					testId="home-net-revenue"
				/>
			)}
		</Card>
	);
}

function InvoicesCard({
	totals,
	formatters,
	wide,
}: {
	readonly totals: DayTotals | null;
	readonly formatters: HomeFormatters;
	readonly wide: boolean;
}) {
	const { t } = useI18n();
	const shown = counted(totals);
	return (
		<Card
			testId="home-card-invoices"
			label={t("home.invoices")}
			state={shown === null ? "empty" : "value"}
			wide={wide}
		>
			{shown === null ? (
				<NoData />
			) : (
				<p
					className="text-3xl font-semibold tabular-nums text-ink"
					data-testid="home-invoices"
				>
					{formatters.count(shown.invoices)}
				</p>
			)}
		</Card>
	);
}

function YesterdayCard({
	store,
	formatters,
}: {
	readonly store: HomeStore;
	readonly formatters: HomeFormatters;
}) {
	const { t } = useI18n();
	const verified = store.yesterdayVerified;
	return (
		<Card
			testId="home-card-yesterday"
			label={t("home.yesterday", { date: formatters.date(store.yesterday) })}
			state={verified === null ? "empty" : verified ? "verified" : "unverified"}
		>
			{verified === null ? (
				<NoData />
			) : (
				<p
					className={`mt-1 inline-flex w-fit items-center rounded-full px-3 py-1 text-sm font-semibold ${verified ? "bg-positive-soft text-positive" : "bg-warning-soft text-warning"}`}
					data-testid="home-verified"
				>
					{verified ? t("home.verified") : t("home.unverified")}
				</p>
			)}
		</Card>
	);
}

function OpeningHoursCard({ hours }: { readonly hours: HoursToday }) {
	const { t } = useI18n();
	return (
		<Card
			testId="home-card-opening-hours"
			label={t("home.openingHours")}
			state={hours.kind}
			wide
		>
			{hours.kind === "open" ? (
				<ul className="flex flex-col gap-1">
					{hours.spans.map(([open, close]) => (
						<li
							key={`${open}-${close}`}
							className="text-xl font-semibold tabular-nums text-ink"
						>
							{`${open}–${close}`}
						</li>
					))}
				</ul>
			) : (
				<p className="py-1 text-base text-ink-muted">
					{hours.kind === "closed"
						? t("home.closedToday")
						: t("home.noOpeningHours")}
				</p>
			)}
		</Card>
	);
}

function FreshnessStamp({
	freshness,
	timeZone,
	formatters,
}: {
	readonly freshness: Freshness;
	readonly timeZone: string;
	readonly formatters: HomeFormatters;
}) {
	const { t } = useI18n();
	const message = freshnessMessage(freshness, new Date(), timeZone, formatters);
	return (
		<p
			className="inline-flex w-fit items-center gap-2 rounded-full bg-surface-sunken px-3 py-1.5 text-sm text-ink-muted"
			data-testid="home-freshness"
			data-state={freshness.kind}
		>
			<span
				aria-hidden="true"
				className={`size-2 shrink-0 rounded-full ${freshness.kind === "synced" ? "bg-accent" : "bg-warning"}`}
			/>
			{t(message.key, message.params)}
		</p>
	);
}

function ChevronIcon() {
	return (
		<svg
			aria-hidden="true"
			width="20"
			height="20"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth="2"
			strokeLinecap="round"
			strokeLinejoin="round"
			className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-ink-muted"
		>
			<path d="m6 9 6 6 6-6" />
		</svg>
	);
}

function StorePicker({
	stores,
	selected,
	onSelect,
}: {
	readonly stores: readonly HomeStore[];
	readonly selected: HomeStore;
	readonly onSelect: (id: string) => void;
}) {
	const { t } = useI18n();
	const pickerId = useId();
	if (stores.length === 1) {
		return (
			<div className="flex flex-col gap-0.5">
				<p className="text-sm text-ink-muted">{t("home.store")}</p>
				<p
					className="text-base font-semibold text-ink"
					data-testid="home-store"
				>
					{selected.name}
				</p>
			</div>
		);
	}
	return (
		<div className="flex flex-col gap-1">
			<label htmlFor={pickerId} className="text-sm text-ink-muted">
				{t("home.store")}
			</label>
			<div className="relative">
				<select
					id={pickerId}
					data-testid="store-picker"
					value={selected.id}
					onChange={(event) => onSelect(event.target.value)}
					className={`min-h-11 w-full appearance-none rounded-xl border border-line bg-surface-raised py-2 pr-10 pl-4 text-base font-semibold text-ink ${focusRing}`}
				>
					{stores.map((store) => (
						<option key={store.id} value={store.id}>
							{store.name}
						</option>
					))}
				</select>
				<ChevronIcon />
			</div>
		</div>
	);
}

function TodaySection({
	store,
	data,
	cards,
	formatters,
}: {
	readonly store: HomeStore;
	readonly data: HomeData;
	readonly cards: readonly HomeCard[];
	readonly formatters: HomeFormatters;
}) {
	const { t } = useI18n();
	const headingId = useId();
	const withYesterday = cards.includes("yesterday");
	return (
		<section
			aria-labelledby={headingId}
			className="flex flex-col gap-3"
			data-testid="home-today"
		>
			<h2 id={headingId} className="text-base font-semibold text-ink">
				{t("home.today", {
					time: formatters.time(data.loadedAt),
					date: formatters.date(store.today),
				})}
			</h2>
			<div className="grid grid-cols-2 gap-3">
				<NetRevenueCard totals={store.totals} formatters={formatters} />
				<InvoicesCard
					totals={store.totals}
					formatters={formatters}
					wide={!withYesterday}
				/>
				{withYesterday ? (
					<YesterdayCard store={store} formatters={formatters} />
				) : null}
			</div>
		</section>
	);
}

function TasksSection({
	store,
	formatters,
}: {
	readonly store: HomeStore;
	readonly formatters: HomeFormatters;
}) {
	const { t } = useI18n();
	const headingId = useId();
	return (
		<section
			aria-labelledby={headingId}
			className="flex flex-col gap-3"
			data-testid="home-tasks"
		>
			<h2 id={headingId} className="text-base font-semibold text-ink">
				{t("home.tasks", { date: formatters.date(store.today) })}
			</h2>
			<div className="grid grid-cols-2 gap-3">
				<HomeTaskSlot storeId={store.id} />
				<OpeningHoursCard hours={store.hours} />
			</div>
		</section>
	);
}

function HomeReady({
	data,
	refreshFailed,
	onRetry,
}: {
	readonly data: HomeData;
	readonly refreshFailed: boolean;
	readonly onRetry: () => void;
}) {
	const { t, language } = useI18n();
	const [selectedId, setSelectedId] = useState<string | null>(null);
	const million = t("home.money.million");
	const billion = t("home.money.billion");
	const formatters = useMemo(
		() =>
			createHomeFormatters({
				currencyCode: data.currencyCode,
				language,
				timeZone: data.timeZone,
				million,
				billion,
			}),
		[data.currencyCode, data.timeZone, language, million, billion],
	);
	const store =
		data.stores.find((candidate) => candidate.id === selectedId) ??
		data.stores[0];
	const cards = homeCards(data.access);
	return (
		<>
			{store === undefined ? (
				<p className="text-base text-ink-muted" data-testid="home-no-stores">
					{t("home.noStores")}
				</p>
			) : (
				<StorePicker
					stores={data.stores}
					selected={store}
					onSelect={setSelectedId}
				/>
			)}
			<FreshnessStamp
				freshness={data.freshness}
				timeZone={data.timeZone}
				formatters={formatters}
			/>
			{refreshFailed ? (
				<div className="flex items-center justify-between gap-3 rounded-xl bg-warning-soft py-1 pr-1 pl-3">
					<p role="alert" className="text-sm text-warning">
						{t("home.refreshFailed")}
					</p>
					<button
						type="button"
						onClick={onRetry}
						className={`min-h-11 min-w-11 shrink-0 rounded-lg px-3 text-sm font-semibold text-warning ${focusRing}`}
					>
						{t("home.retry")}
					</button>
				</div>
			) : null}
			{store === undefined ? null : (
				<div
					className="flex flex-col gap-5"
					data-testid="home-store-view"
					data-store-id={store.id}
					data-today={store.today}
					data-access={data.access}
				>
					{cards.includes("net-revenue") ? (
						<TodaySection
							store={store}
							data={data}
							cards={cards}
							formatters={formatters}
						/>
					) : null}
					<TasksSection store={store} formatters={formatters} />
				</div>
			)}
		</>
	);
}

function HomeLoading() {
	const { t } = useI18n();
	return (
		<>
			<div
				role="status"
				aria-live="polite"
				className="flex items-center gap-3 text-base text-ink"
				data-testid="home-loading"
			>
				<span
					aria-hidden="true"
					className="size-5 animate-spin rounded-full border-2 border-line border-t-accent"
				/>
				{t("home.loading")}
			</div>
			<div aria-hidden="true" className="grid grid-cols-2 gap-3">
				<div className="col-span-2 h-28 animate-pulse rounded-2xl bg-surface-sunken" />
				<div className="h-24 animate-pulse rounded-2xl bg-surface-sunken" />
				<div className="h-24 animate-pulse rounded-2xl bg-surface-sunken" />
			</div>
		</>
	);
}

function HomeFailed({ onRetry }: { readonly onRetry: () => void }) {
	const { t } = useI18n();
	return (
		<div className="flex flex-col gap-3" data-testid="home-failed">
			<p role="alert" className="text-base text-ink">
				{t("home.failed")}
			</p>
			<button type="button" className={primaryButton} onClick={onRetry}>
				{t("home.retry")}
			</button>
		</div>
	);
}

function SignedInHome({
	session,
	sourceFor,
}: {
	readonly session: StoredSession;
	readonly sourceFor: HomeSourceFactory;
}) {
	const { t } = useI18n();
	const { retry, expire } = useSession();
	const endpoint = useDataEndpoint();
	const headingId = useId();
	const member = session.member;
	const source = useMemo(
		() => sourceFor(endpoint, session),
		[sourceFor, endpoint, session],
	);
	const query = useMemo<HomeQuery>(
		() => ({
			role: member.role,
			tenantId: member.tenantId ?? null,
			storeIds: member.storeIds ?? null,
			storeNames: member.stores,
		}),
		[member],
	);
	const { load, reload } = useHomeData(source, query);
	const handled = useRef<unknown>(null);
	useEffect(() => {
		if (load.status !== "failed" || handled.current === load) return;
		if (load.httpStatus !== UNAUTHORIZED && load.httpStatus !== FORBIDDEN)
			return;
		handled.current = load;
		if (isSessionFresh(session, Date.now())) expire();
		else retry();
	}, [load, session, retry, expire]);
	return (
		<section
			aria-labelledby={headingId}
			className="flex flex-col gap-5 px-4 pt-5 pb-8"
			data-testid="home"
			data-status={load.status}
		>
			<header className="flex flex-col gap-0.5">
				<h1 id={headingId} className="text-xl font-semibold text-ink">
					{t("session.greeting", { name: member.displayName })}
				</h1>
				<p className="text-sm text-ink-muted" data-testid="member-role">
					{t(`role.${member.role}`)}
				</p>
			</header>
			{load.status === "loading" ? (
				<HomeLoading />
			) : load.status === "failed" ? (
				<HomeFailed
					onRetry={load.httpStatus === UNAUTHORIZED ? retry : reload}
				/>
			) : (
				<HomeReady
					data={load.data}
					refreshFailed={load.refreshFailed}
					onRetry={reload}
				/>
			)}
		</section>
	);
}

export function HomeScreen({
	sourceFor = homeSourceFor,
}: {
	readonly sourceFor?: HomeSourceFactory;
}) {
	const { state } = useSession();
	if (state.status !== "signed-in") return <SessionScreen />;
	return (
		<SignedInHome
			key={state.session.accessToken}
			session={state.session}
			sourceFor={sourceFor}
		/>
	);
}
