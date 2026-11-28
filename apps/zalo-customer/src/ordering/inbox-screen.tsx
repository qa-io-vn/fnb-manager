import type {
	InboxFilter,
	InboxItem,
	InboxMarketing,
	InboxPage,
} from "@fnb/zalo-mini/ordering";
import {
	ChipGroup,
	kitButton,
	Popup,
	PriceText,
	Toggle,
	useI18n,
} from "@fnb/zalo-mini/react";
import {
	type ReactNode,
	useCallback,
	useEffect,
	useRef,
	useState,
} from "react";
import { useNavigate } from "react-router-dom";
import { followOA } from "zmp-sdk";
import { useCustomerData } from "../data/customer-data";
import type { Failure } from "../data/source";
import { useNow } from "../data/use-now";
import { useLegalPopup } from "../legal/legal-popups";
import { Failed, failureKey, Loading } from "../ui";
import { inboxAgo, inboxPath, inboxText, splitAtPrice } from "./inbox";
import { useOrdering } from "./ordering-data";
import { BellIcon, CupIcon, GiftIcon, ReceiptIcon, StarIcon } from "./parts";

// C12 Thông báo (design spec C12, GA-063 to GA-066; ADR-073): the customer's own notifications, newest first, 20 a
// page, filtered by Tất cả · Đơn hàng · Ưu đãi; each row has its unread dot (8 px and the spoken "chưa đọc") and opens
// what it is about (C06 for an order, C07 for stamps, the offers). Opening a row marks it read. Below the list, "Nhận
// tin ưu đãi qua Zalo · Tối đa 2 tin mỗi tuần": turning it on opens a sheet with the purpose and the cap, records the
// marketing consent and offers to follow the shop's Zalo page; turning it off is the existing "Dừng nhận tin". The
// design draws no "mark everything read", so there is none. The last list read stays on screen while offline.

type Load =
	| { readonly status: "loading" }
	| { readonly status: "failed"; readonly failure: Failure }
	| { readonly status: "ready"; readonly page: InboxPage };

// the last first page of each filter, shown while a new one loads and while offline
const cached = new Map<InboxFilter, InboxPage>();

const FILTERS: readonly InboxFilter[] = ["all", "orders", "offers"];

function Tile({ item }: { readonly item: InboxItem }) {
	const look: { readonly icon: ReactNode; readonly tone: string } =
		item.kind === "stamp" || item.kind === "reward"
			? { icon: <StarIcon />, tone: "bg-badge text-badge-ink" }
			: item.kind === "offer"
				? { icon: <GiftIcon />, tone: "bg-positive-soft text-ink" }
				: item.kind === "order_ready"
					? { icon: <CupIcon />, tone: "bg-neutral-soft text-ink" }
					: { icon: <ReceiptIcon />, tone: "bg-neutral-soft text-ink" };
	return (
		<span
			aria-hidden="true"
			className={`flex size-11 shrink-0 items-center justify-center rounded-xl ${look.tone}`}
		>
			{look.icon}
		</span>
	);
}

function Line({
	line,
	price,
}: {
	readonly line: string;
	readonly price: number | null;
}) {
	const [before, after] = splitAtPrice(line);
	return (
		<span
			className="line-clamp-2 text-[13px] text-ink"
			data-testid="inbox-row-line"
		>
			{before}
			{after !== null && price !== null ? (
				<>
					<PriceText amount={price} tone="ink" />
					{after}
				</>
			) : null}
		</span>
	);
}

function InboxRow({
	item,
	now,
	onOpen,
}: {
	readonly item: InboxItem;
	readonly now: number;
	readonly onOpen: (item: InboxItem) => void;
}) {
	const { t } = useI18n();
	const text = inboxText(item, t);
	const ago = inboxAgo(item.createdAt, now);
	const unread = item.readAt === null;
	return (
		<li>
			<button
				type="button"
				onClick={() => onOpen(item)}
				className="flex w-full items-start gap-3 px-4 py-3 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
				data-testid="inbox-row"
				data-kind={item.kind}
				data-unread={unread}
				data-id={item.id}
			>
				<Tile item={item} />
				<span className="flex min-w-0 flex-1 flex-col gap-0.5">
					<span
						className="text-[15px] font-bold text-ink"
						data-testid="inbox-row-title"
					>
						{text.title}
					</span>
					<Line line={text.line} price={text.price} />
					<span className="text-[12px] text-ink-muted">
						{t(ago.key, ago.values)}
					</span>
				</span>
				{unread ? (
					<span className="flex shrink-0 items-center pt-1.5">
						<span
							aria-hidden="true"
							className="size-2 rounded-full bg-accent"
						/>
						<span className="sr-only">{t("inbox.unread")}</span>
					</span>
				) : null}
			</button>
		</li>
	);
}

type Sheet =
	| null
	| { readonly kind: "opt-in"; readonly shownAt: string }
	| { readonly kind: "stop" };
type Follow = "idle" | "offer" | "busy" | "done";

function MarketingCard({
	marketing,
	onChanged,
}: {
	readonly marketing: InboxMarketing;
	readonly onChanged: (consent: boolean) => void;
}) {
	const { t } = useI18n();
	const navigate = useNavigate();
	const { client: ordering } = useOrdering();
	const { client: loyalty, home, recover } = useCustomerData();
	const { open: openLegal, popup: legalPopup } = useLegalPopup();
	const [sheet, setSheet] = useState<Sheet>(null);
	const [busy, setBusy] = useState(false);
	const [problem, setProblem] = useState<string | null>(null);
	const [follow, setFollow] = useState<Follow>("idle");
	const oaId = home.status === "ready" ? home.data.oaId : null;
	const policy = home.status === "ready" ? home.data.legal.policyVersion : null;
	const close = () => {
		setSheet(null);
		setProblem(null);
		setFollow("idle");
	};

	const accept = async (shownAt: string) => {
		if (ordering === null || policy === null) {
			setProblem(t("inbox.refused.policy_outdated"));
			return;
		}
		setBusy(true);
		setProblem(null);
		try {
			const answer = await ordering.startMarketing(policy, shownAt);
			if (answer.state === "started") {
				onChanged(true);
				if (oaId === null) close();
				else setFollow("offer");
			} else {
				setProblem(
					t(
						answer.refusal === "policy_outdated" ||
							answer.refusal === "rate_limited"
							? `inbox.refused.${answer.refusal}`
							: "inbox.refused.other",
					),
				);
			}
		} catch (error) {
			setProblem(t(failureKey(recover(error))));
		} finally {
			setBusy(false);
		}
	};

	const stop = async () => {
		if (loyalty === null) return;
		setBusy(true);
		setProblem(null);
		try {
			await loyalty.stopMarketing();
			onChanged(false);
			close();
		} catch (error) {
			setProblem(t(failureKey(recover(error))));
		} finally {
			setBusy(false);
		}
	};

	const followShop = async () => {
		if (oaId === null) return;
		setFollow("busy");
		try {
			await followOA({ id: oaId });
			setFollow("done");
		} catch {
			// refused or closed: the consent stands; the customer may follow later
			close();
		}
	};

	const cap = t("inbox.marketingCap", { count: marketing.weeklyCap });
	return (
		<section
			aria-labelledby="inbox-marketing-title"
			className="mx-4 flex flex-col gap-3 rounded-card border-card border-line/60 bg-surface-raised p-4 shadow-card"
			data-testid="inbox-marketing-card"
		>
			<div className="flex items-center gap-3">
				<span
					aria-hidden="true"
					className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-neutral-soft text-ink"
				>
					<BellIcon />
				</span>
				<span className="flex min-w-0 flex-1 flex-col">
					<span
						id="inbox-marketing-title"
						className="text-[15px] font-bold text-ink"
					>
						{t("inbox.marketing")}
					</span>
					<span className="text-[13px] text-ink">{cap}</span>
				</span>
				{marketing.member ? (
					<Toggle
						label={`${t("inbox.marketing")}. ${cap}`}
						checked={marketing.consent}
						stateLabel={
							marketing.consent
								? t("inbox.marketingOn")
								: t("inbox.marketingOff")
						}
						busy={busy}
						onChange={(next) =>
							setSheet(
								next
									? { kind: "opt-in", shownAt: new Date().toISOString() }
									: { kind: "stop" },
							)
						}
						testId="inbox-marketing"
					/>
				) : null}
			</div>
			{marketing.member ? null : (
				<div className="flex flex-col gap-2" data-testid="inbox-marketing-join">
					<p className="text-[13px] text-ink">{t("inbox.marketingJoin")}</p>
					<button
						type="button"
						className={kitButton.secondary}
						onClick={() => navigate("/tham-gia")}
					>
						{t("inbox.marketingJoinAction")}
					</button>
				</div>
			)}
			{sheet?.kind === "opt-in" ? (
				<Popup
					title={t("inbox.optIn.title")}
					onClose={close}
					testId="inbox-opt-in"
					footer={
						follow === "idle" ? (
							<>
								<button
									type="button"
									className={`${kitButton.primary} w-full`}
									disabled={busy}
									aria-busy={busy}
									onClick={() => void accept(sheet.shownAt)}
									data-testid="inbox-opt-in-accept"
								>
									{t("inbox.optIn.accept")}
								</button>
								<button
									type="button"
									className={`${kitButton.secondary} w-full`}
									disabled={busy}
									onClick={close}
									data-testid="inbox-opt-in-later"
								>
									{t("inbox.optIn.later")}
								</button>
							</>
						) : (
							<>
								{follow === "done" ? null : (
									<button
										type="button"
										className={`${kitButton.primary} w-full`}
										disabled={follow === "busy"}
										aria-busy={follow === "busy"}
										onClick={() => void followShop()}
										data-testid="inbox-follow"
									>
										{t("inbox.follow.action")}
									</button>
								)}
								<button
									type="button"
									className={`${kitButton.secondary} w-full`}
									onClick={close}
									data-testid="inbox-opt-in-close"
								>
									{follow === "done"
										? t("popup.close")
										: t("inbox.optIn.later")}
								</button>
							</>
						)
					}
				>
					{follow === "idle" ? (
						<div className="flex flex-col gap-3">
							<p className="text-body text-ink">
								{t("inbox.optIn.body", { count: marketing.weeklyCap })}
							</p>
							<p className="text-body text-ink">{t("inbox.optIn.purpose")}</p>
							<button
								type="button"
								className={`${kitButton.quiet} self-start`}
								onClick={() => openLegal("privacy_notice")}
							>
								{t("inbox.optIn.policy")}
							</button>
						</div>
					) : (
						<div className="flex flex-col gap-3" role="status">
							<p className="text-body text-ink" data-testid="inbox-opt-in-done">
								{t("inbox.optIn.done")}
							</p>
							<p className="text-body text-ink">
								{follow === "done"
									? t("inbox.follow.done")
									: t("inbox.follow.body")}
							</p>
						</div>
					)}
					{problem === null ? null : (
						<p
							role="alert"
							className="pt-3 text-body text-negative"
							data-testid="inbox-opt-in-problem"
						>
							{problem}
						</p>
					)}
				</Popup>
			) : null}
			{sheet?.kind === "stop" ? (
				<Popup
					title={t("settings.stopConfirmTitle")}
					onClose={close}
					testId="inbox-stop"
					footer={
						<>
							<button
								type="button"
								className={`${kitButton.primary} w-full`}
								disabled={busy}
								aria-busy={busy}
								onClick={() => void stop()}
								data-testid="inbox-stop-confirm"
							>
								{t("settings.stopConfirm")}
							</button>
							<button
								type="button"
								className={`${kitButton.secondary} w-full`}
								disabled={busy}
								onClick={close}
							>
								{t("settings.keep")}
							</button>
						</>
					}
				>
					<p className="text-body text-ink">{t("settings.stopConfirmBody")}</p>
					{problem === null ? null : (
						<p role="alert" className="pt-3 text-body text-negative">
							{problem}
						</p>
					)}
				</Popup>
			) : null}
			{legalPopup}
		</section>
	);
}

export function InboxScreen() {
	const { t } = useI18n();
	const navigate = useNavigate();
	const { client } = useOrdering();
	const { recover } = useCustomerData();
	const [filter, setFilter] = useState<InboxFilter>("all");
	const [load, setLoad] = useState<Load>(() => {
		const known = cached.get("all");
		return known === undefined
			? { status: "loading" }
			: { status: "ready", page: known };
	});
	const [more, setMore] = useState<readonly InboxItem[]>([]);
	const [next, setNext] = useState<number | null>(null);
	const [loadingMore, setLoadingMore] = useState(false);
	const [read, setRead] = useState<ReadonlySet<string>>(new Set());
	const [marketing, setMarketing] = useState<InboxMarketing | null>(null);
	const now = useNow(30_000);
	const shown = useRef(filter);
	shown.current = filter;

	const reload = useCallback(
		(which: InboxFilter) => {
			if (client === null) return;
			const known = cached.get(which);
			setLoad(
				known === undefined
					? { status: "loading" }
					: { status: "ready", page: known },
			);
			setMore([]);
			client.inbox(which, null).then(
				(page) => {
					cached.set(which, page);
					if (shown.current !== which) return;
					setLoad({ status: "ready", page });
					setNext(page.nextBefore);
					setMarketing(page.marketing);
				},
				(error: unknown) => {
					const failure = recover(error);
					if (shown.current !== which) return;
					// offline or failing: the list read before stays on screen with the banner
					if (known === undefined) setLoad({ status: "failed", failure });
				},
			);
		},
		[client, recover],
	);

	useEffect(() => {
		reload(filter);
	}, [filter, reload]);

	const loadMore = () => {
		if (client === null || next === null) return;
		setLoadingMore(true);
		client.inbox(filter, next).then(
			(page) => {
				setLoadingMore(false);
				setMore((known) => [...known, ...page.items]);
				setNext(page.nextBefore);
			},
			(error: unknown) => {
				setLoadingMore(false);
				recover(error);
			},
		);
	};

	const open = (item: InboxItem) => {
		if (item.readAt === null && !read.has(item.id) && client !== null) {
			setRead((known) => new Set([...known, item.id]));
			// the mark is a courtesy: a lost one leaves the dot for the next visit, never the customer on this screen
			client.markInboxRead([item.id]).catch(() => undefined);
			cached.clear();
		}
		navigate(inboxPath(item));
	};

	const items =
		load.status === "ready"
			? [...load.page.items, ...more].map((item) =>
					read.has(item.id) && item.readAt === null
						? { ...item, readAt: new Date(now).toISOString() }
						: item,
				)
			: [];
	const switchState =
		marketing ?? (load.status === "ready" ? load.page.marketing : null);
	return (
		<section className="flex flex-col gap-3 py-4" data-testid="inbox">
			<h1 className="px-4 text-xl font-bold text-ink">{t("inbox.title")}</h1>
			<ChipGroup
				label={t("inbox.filters")}
				chips={FILTERS.map((key) => ({ key, label: t(`inbox.filter.${key}`) }))}
				selected={filter}
				onSelect={(key) => setFilter(key as InboxFilter)}
				testId="inbox-filter"
			/>
			{load.status === "loading" ? <Loading /> : null}
			{load.status === "failed" ? (
				<Failed failure={load.failure} onRetry={() => reload(filter)} />
			) : null}
			{load.status === "ready" && items.length === 0 ? (
				<p
					className="px-4 py-6 text-center text-body text-ink-muted"
					data-testid="inbox-empty"
					data-filter={filter}
				>
					{t("inbox.empty")}
				</p>
			) : null}
			{items.length > 0 ? (
				<ul
					className="mx-4 flex flex-col divide-y divide-line rounded-card border-card border-line/60 bg-surface-raised shadow-card"
					data-testid="inbox-list"
					data-filter={filter}
				>
					{items.map((item) => (
						<InboxRow key={item.id} item={item} now={now} onOpen={open} />
					))}
				</ul>
			) : null}
			{next !== null && load.status === "ready" ? (
				<button
					type="button"
					className={`${kitButton.secondary} mx-4`}
					onClick={loadMore}
					disabled={loadingMore}
					aria-busy={loadingMore}
					data-testid="inbox-more"
				>
					{t("inbox.more")}
				</button>
			) : null}
			{switchState === null ? null : (
				<MarketingCard
					marketing={switchState}
					onChanged={(consent) => {
						setMarketing({ ...switchState, consent });
						cached.clear();
					}}
				/>
			)}
		</section>
	);
}
