import type { Menu, MenuItem } from "@fnb/zalo-mini/ordering";
import {
	ChipGroup,
	FloatingBar,
	PriceText,
	StatusPill,
	Toast,
	useI18n,
} from "@fnb/zalo-mini/react";
import { useId, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useOnline } from "../data/offline";
import { Failed } from "../ui";
import {
	cartCount,
	cartSubtotal,
	defaultChoice,
	groupsOf,
	selectionProblem,
} from "./cart";
import { ONLINE_PAYMENT_ENABLED } from "./flag";
import { closedKind } from "./order-view";
import { useMenuPoll, useOrdering } from "./ordering-data";
import { MenuIcon, PlusIcon, SearchIcon } from "./parts";
import { searchMenu } from "./search";
import {
	ClosedState,
	OfflineState,
	OrderingHeld,
	TableContextNote,
} from "./states";
import { orderingOpen, preOrderOpen } from "./takeaway";

// C02 Thực đơn (design spec 6.2): search with or without marks, a sticky row of sections, the items with their
// lowest price, an add button when the shop takes orders, and the basket bar. Sold-out items are not listed (the
// server leaves them out and the version poll removes them within 5 seconds); C15 sits on top when the shop is
// closed, C16 replaces the screen offline with nothing to show.

/** The lowest price of an item: its only size, or "from" the cheapest. */
function ItemPrice({ item }: { readonly item: MenuItem }) {
	const { t } = useI18n();
	const prices = item.sizes.map((size) => size.price);
	const lowest = Math.min(...prices);
	return (
		<span className="flex items-baseline gap-1">
			{prices.length > 1 ? (
				<span className="text-sm text-ink-muted">{t("menu.fromPrice")}</span>
			) : null}
			<PriceText amount={lowest} size="list" testId="menu-item-price" />
		</span>
	);
}

function ItemRow({
	item,
	canAdd,
	onAdd,
}: {
	readonly item: MenuItem;
	readonly canAdd: boolean;
	readonly onAdd: (item: MenuItem) => void;
}) {
	const { t } = useI18n();
	const navigate = useNavigate();
	return (
		<li
			className="flex items-center gap-3 rounded-card-2xl border-card border-line/60 bg-surface-raised p-3"
			data-testid="menu-item"
			data-item-id={item.id}
		>
			<button
				type="button"
				onClick={() => navigate(`/mon/${item.id}`)}
				className="flex min-h-14 min-w-0 flex-1 items-center gap-3 rounded-control text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
			>
				<span
					aria-hidden="true"
					className="flex size-14 shrink-0 items-center justify-center rounded-card-xl bg-surface-sunken text-ink-muted"
				>
					<MenuIcon />
				</span>
				<span className="flex min-w-0 flex-col gap-0.5">
					<span className="flex flex-wrap items-center gap-2">
						<span className="text-[15px] font-bold text-ink">{item.name}</span>
						{item.labels
							.filter((label) => label === "best_seller" || label === "new")
							.map((label) => (
								<span
									key={label}
									data-testid="menu-item-badge"
									data-badge={label}
								>
									<StatusPill tone="badge">
										{t(`menu.badge.${label}`)}
									</StatusPill>
								</span>
							))}
					</span>
					{item.description === null ? null : (
						<span className="text-sm text-ink-muted">{item.description}</span>
					)}
					<ItemPrice item={item} />
				</span>
			</button>
			{canAdd ? (
				<button
					type="button"
					aria-label={t("menu.add", { name: item.name })}
					onClick={() => onAdd(item)}
					className="flex size-11 shrink-0 items-center justify-center rounded-control bg-accent text-accent-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
					data-testid="menu-item-add"
				>
					<PlusIcon />
				</button>
			) : null}
		</li>
	);
}

function ReadyMenu({ menu }: { readonly menu: Menu }) {
	const { t } = useI18n();
	const navigate = useNavigate();
	const { add, cart, store, unavailable, fulfilment, setFulfilment } =
		useOrdering();
	const [query, setQuery] = useState("");
	const [toast, setToast] = useState<string | null>(null);
	const searchId = useId();
	const sectionRefs = useRef(new Map<string, HTMLElement>());
	const visible = useMemo(
		() =>
			menu.categories
				.map((category) => ({
					...category,
					items: category.items.filter((item) => !unavailable.has(item.id)),
				}))
				.filter((category) => category.items.length > 0),
		[menu, unavailable],
	);
	const shown = useMemo(() => searchMenu(visible, query), [visible, query]);
	const [selected, setSelected] = useState(visible[0]?.id ?? "");
	const kind = closedKind(menu.ordering);
	// a closed store that books the next morning takes a takeaway's items (C15 with D7, C17)
	const preOrder = preOrderOpen(menu.ordering, ONLINE_PAYMENT_ENABLED);
	const canAdd = orderingOpen(
		menu.ordering,
		fulfilment,
		ONLINE_PAYMENT_ENABLED,
	);
	const inCart = cart.store === store ? cartCount(cart) : 0;

	const onAdd = (item: MenuItem) => {
		const groups = groupsOf(item, menu.optionGroups);
		const choice = defaultChoice(item, groups);
		const ready =
			item.sizes.length === 1 &&
			groups.every(
				(group) =>
					selectionProblem(group, choice.options[group.id] ?? []) === null,
			);
		if (!ready) {
			navigate(`/mon/${item.id}`);
			return;
		}
		const size = item.sizes[0];
		if (size === undefined) return;
		const options = groups.flatMap((group) =>
			(choice.options[group.id] ?? []).flatMap((id) => {
				const option = group.options.find((entry) => entry.id === id);
				return option === undefined
					? []
					: [
							{
								id,
								name: option.name,
								groupName: group.name,
								price: option.priceDelta,
							},
						];
			}),
		);
		const outcome = add({
			itemId: item.id,
			itemName: item.name,
			sizeId: size.id,
			sizeLabel: size.label,
			unitPrice: size.price,
			options,
			quantity: 1,
			note: null,
			countsForStamps: item.countsForStamps,
		});
		const count = inCart + 1;
		setToast(
			outcome === "full"
				? t("menu.addFull")
				: outcome === "capped"
					? t("menu.addCapped", { count: inCart })
					: t("menu.added", { name: item.name, count }),
		);
	};

	const jump = (id: string) => {
		setSelected(id);
		const section = sectionRefs.current.get(id);
		if (section === undefined) return;
		const reduced = window.matchMedia?.(
			"(prefers-reduced-motion: reduce)",
		).matches;
		section.scrollIntoView?.({
			behavior: reduced ? "auto" : "smooth",
			block: "start",
		});
		section.querySelector<HTMLElement>("h2")?.focus();
	};

	return (
		<>
			<div className="flex flex-col gap-3 px-4 pt-4">
				<TableContextNote />
				{kind === "closed" ? (
					<ClosedState
						menu={menu}
						preOrder={preOrder}
						onPreorder={
							preOrder && fulfilment !== "takeaway"
								? () => setFulfilment("takeaway")
								: null
						}
					/>
				) : null}
				<OrderingHeld ordering={menu.ordering} />
				<label htmlFor={searchId} className="sr-only">
					{t("menu.searchLabel")}
				</label>
				<span className="relative flex items-center">
					<span className="pointer-events-none absolute left-3 text-ink-muted">
						<SearchIcon />
					</span>
					<input
						id={searchId}
						type="search"
						value={query}
						onChange={(event) => setQuery(event.target.value)}
						placeholder={t("menu.search")}
						className="min-h-12 w-full rounded-field border-field border-line-strong bg-surface-raised pr-4 pl-11 text-base text-ink"
						data-testid="menu-search"
					/>
				</span>
			</div>
			{query.trim() === "" && visible.length > 1 ? (
				<div className="sticky top-0 z-20 bg-surface">
					<ChipGroup
						label={t("menu.groups")}
						chips={visible.map((category) => ({
							key: category.id,
							label: category.name,
						}))}
						selected={selected}
						onSelect={jump}
						testId="menu-chips"
					/>
				</div>
			) : null}
			<div className="flex flex-col gap-5 px-4 pt-2 pb-6">
				{visible.length === 0 ? (
					<p className="text-body text-ink" data-testid="menu-empty">
						{t("menu.empty")}
					</p>
				) : shown.length === 0 ? (
					<p className="text-body text-ink" data-testid="menu-no-results">
						{t("menu.noResults", { query: query.trim() })}
					</p>
				) : (
					shown.map((category) => (
						<section
							key={category.id}
							ref={(element) => {
								if (element === null) sectionRefs.current.delete(category.id);
								else sectionRefs.current.set(category.id, element);
							}}
							aria-labelledby={`section-${category.id}`}
							className="flex scroll-mt-16 flex-col gap-2"
							data-testid="menu-section"
							data-section={category.id}
						>
							<h2
								id={`section-${category.id}`}
								tabIndex={-1}
								className="text-[15px] font-bold text-ink"
							>
								{category.name}
							</h2>
							<ul className="flex flex-col gap-2">
								{category.items.map((item) => (
									<ItemRow
										key={item.id}
										item={item}
										canAdd={canAdd}
										onAdd={onAdd}
									/>
								))}
							</ul>
						</section>
					))
				)}
			</div>
			<FloatingBar kind="cart" testId="cart-bar" show={inCart > 0}>
				<button
					type="button"
					onClick={() => navigate("/gio-hang")}
					className="flex min-h-14 w-full items-center justify-between gap-3 rounded-control bg-inverse px-4 text-inverse-ink shadow-card focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
				>
					<span className="flex items-center gap-2 text-[15px] font-bold">
						<span data-testid="cart-bar-count">
							{t("menu.cartBar", { count: inCart })}
						</span>
						<span aria-hidden="true">·</span>
						<PriceText
							amount={cartSubtotal(cart)}
							size="list"
							tone="inherit"
							testId="cart-bar-total"
						/>
					</span>
					<span className="text-[15px] font-bold">
						{t("menu.cartBarOpen")} ›
					</span>
				</button>
			</FloatingBar>
			{toast === null ? null : (
				<Toast
					message={toast}
					onDone={() => setToast(null)}
					testId="menu-toast"
				/>
			)}
		</>
	);
}

export function MenuScreen() {
	const { t } = useI18n();
	const { menu, reloadMenu, cart } = useOrdering();
	const online = useOnline();
	useMenuPoll();
	return (
		<section data-testid="ordering-menu" className="flex flex-col">
			<h1 className="px-4 pt-4 text-xl font-bold text-ink">
				{t("menu.title")}
			</h1>
			{menu.status === "ready" ? (
				<ReadyMenu menu={menu.data} />
			) : !online ? (
				<OfflineState hasCart={cart.lines.length > 0} onRetry={reloadMenu} />
			) : menu.status === "failed" ? (
				<Failed failure={menu.failure} onRetry={reloadMenu} />
			) : (
				<div
					aria-hidden="true"
					className="flex animate-pulse flex-col gap-3 px-4 pt-4"
					data-testid="menu-skeleton"
				>
					<div className="h-12 rounded-field bg-surface-raised" />
					<div className="h-20 rounded-card-2xl bg-surface-raised" />
					<div className="h-20 rounded-card-2xl bg-surface-raised" />
				</div>
			)}
		</section>
	);
}
