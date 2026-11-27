import { MAX_LINE_QUANTITY } from "@fnb/zalo-mini/ordering";
import {
	kitButton,
	PriceText,
	Stepper,
	StickyActionBar,
	useI18n,
} from "@fnb/zalo-mini/react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useOnline } from "../data/offline";
import {
	type CartLine,
	cartSubtotal,
	lineTotal,
	unavailableLines,
} from "./cart";
import { closedKind } from "./order-view";
import { useMenuPoll, useOrdering } from "./ordering-data";
import {
	FlowBack,
	MenuIcon,
	Notice,
	Panel,
	PlusIcon,
	Problem,
	TableIcon,
} from "./parts";
import { useTableScan } from "./states";

// C04 Giỏ của bạn and C10 Giỏ trống (design spec 6.2). The basket shows the lines with the menu's prices, flags a line
// whose item just sold out (the version poll, criterion 2) and refuses to go on until it is removed, and goes on to
// the confirmation only with a table the server named, a shop that takes orders and a network.

export function EmptyCart() {
	const { t } = useI18n();
	const navigate = useNavigate();
	return (
		<section
			className="flex flex-col items-center gap-3 px-4 py-10 text-center"
			data-testid="cart-empty"
		>
			<span
				aria-hidden="true"
				className="flex size-18 items-center justify-center rounded-full bg-surface-sunken text-ink-muted"
			>
				<MenuIcon />
			</span>
			<h1 className="text-[22px] font-bold text-ink">
				{t("cart.empty.title")}
			</h1>
			<p className="max-w-[300px] text-body text-ink-muted">
				{t("cart.empty.body")}
			</p>
			<button
				type="button"
				className={`${kitButton.primary} w-full`}
				onClick={() => navigate("/thuc-don")}
				data-testid="cart-empty-menu"
			>
				{t("cart.empty.menu")}
			</button>
		</section>
	);
}

function ContextCard() {
	const { t } = useI18n();
	const { table } = useOrdering();
	const { scan, problem } = useTableScan();
	return (
		<Panel testId="cart-context">
			<div className="flex items-center gap-3">
				<span className="text-highlight">
					<TableIcon />
				</span>
				<div className="flex min-w-0 flex-1 flex-col">
					{table?.state === "ok" ? (
						<>
							<p
								className="text-[15px] font-bold text-ink"
								data-testid="cart-table"
							>
								{t("cart.tableContext", { table: table.label })}
							</p>
							<p className="text-[13px] text-ink-muted">
								{t("cart.tableContextSub")}
							</p>
						</>
					) : (
						<>
							<p className="text-[15px] font-bold text-ink">
								{t("cart.noTable")}
							</p>
							<p className="text-[13px] text-ink-muted">
								{t("cart.noTableSub")}
							</p>
						</>
					)}
				</div>
				{table?.state === "ok" ? null : (
					<button
						type="button"
						className={kitButton.quiet}
						onClick={scan}
						data-testid="cart-context-change"
					>
						{t("cart.scan")}
					</button>
				)}
			</div>
			{problem === null ? null : (
				<p role="alert" className="text-body text-ink">
					{t(problem)}
				</p>
			)}
		</Panel>
	);
}

function LineCard({
	line,
	soldOut,
}: {
	readonly line: CartLine;
	readonly soldOut: boolean;
}) {
	const { t } = useI18n();
	const navigate = useNavigate();
	const { setQuantity, remove } = useOrdering();
	const details = [line.sizeLabel, ...line.options.map((option) => option.name)]
		.filter((part): part is string => part !== null)
		.join(" · ");
	return (
		<li
			className="flex flex-col gap-2 rounded-card-2xl border-card border-line/60 bg-surface-raised p-3"
			data-testid="cart-line"
			data-item-id={line.itemId}
			data-sold-out={soldOut}
		>
			<div className="flex items-start gap-3">
				<span
					aria-hidden="true"
					className="flex size-14 shrink-0 items-center justify-center rounded-card-xl bg-surface-sunken text-ink-muted"
				>
					<MenuIcon />
				</span>
				<div className="flex min-w-0 flex-1 flex-col gap-0.5">
					<button
						type="button"
						onClick={() =>
							navigate(`/mon/${line.itemId}`, { state: { lineKey: line.key } })
						}
						aria-label={t("cart.edit", { name: line.itemName })}
						className="min-h-11 self-start text-left text-[15px] font-bold text-ink underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
						disabled={soldOut}
					>
						{line.itemName}
					</button>
					{details === "" ? null : (
						<p
							className="text-[13px] text-ink-muted"
							data-testid="cart-line-options"
						>
							{details}
						</p>
					)}
					{line.note === null ? null : (
						// the note is the customer's own text, shown as text (never as markup)
						<p
							className="text-[13px] text-ink break-words"
							data-testid="cart-line-note"
						>
							{line.note}
						</p>
					)}
					<PriceText
						amount={lineTotal(line)}
						size="list"
						testId="cart-line-price"
					/>
				</div>
			</div>
			{soldOut ? (
				<div className="flex flex-col gap-2">
					<Problem testId="cart-removed">
						{t("cart.soldOut", { name: line.itemName })}
					</Problem>
					<button
						type="button"
						className={`${kitButton.danger} w-full`}
						onClick={() => remove(line.key)}
						data-testid="cart-line-remove"
					>
						{t("cart.removeNamed", { name: line.itemName })}
					</button>
				</div>
			) : (
				<fieldset className="m-0 flex justify-end border-0 p-0">
					<legend className="sr-only">
						{t("cart.lineQuantity", { name: line.itemName })}
					</legend>
					<Stepper
						value={line.quantity}
						min={1}
						max={MAX_LINE_QUANTITY}
						onChange={(next) => setQuantity(line.key, next)}
						onRemove={() => remove(line.key)}
						decreaseLabel={t("item.less")}
						increaseLabel={t("item.more")}
						removeLabel={t("cart.removeNamed", { name: line.itemName })}
						testId="cart-line-qty"
					/>
				</fieldset>
			)}
		</li>
	);
}

export function CartScreen() {
	const { t } = useI18n();
	const navigate = useNavigate();
	const online = useOnline();
	const {
		cart,
		store,
		unavailable,
		table,
		menu,
		priceChanges,
		acknowledgePriceChanges,
	} = useOrdering();
	const [announce, setAnnounce] = useState("");
	useMenuPoll();
	if (cart.store !== store || cart.lines.length === 0)
		return (
			<section className="flex flex-col px-4 pt-4" data-testid="cart">
				<FlowBack />
				<EmptyCart />
			</section>
		);
	const soldOut = unavailableLines(cart, unavailable);
	const ordering = menu.status === "ready" ? menu.data.ordering : null;
	const held = ordering !== null && closedKind(ordering) !== null;
	const reason = !online
		? t("cart.offline")
		: soldOut.length > 0
			? t("cart.blockedSoldOut")
			: table?.state !== "ok"
				? t("cart.blockedNoTable")
				: held && ordering !== null
					? t(`order.reason.${ordering.reason ?? "ordering_off"}`)
					: null;
	return (
		<>
			<section className="flex flex-col gap-4 px-4 py-4" data-testid="cart">
				<FlowBack />
				<h1 className="text-xl font-bold text-ink">{t("cart.title")}</h1>
				<ContextCard />
				{priceChanges.length === 0 ? null : (
					<Notice testId="cart-price-changed">
						{priceChanges.map((change) => (
							<span key={change.key} className="block">
								{t("cart.priceChanged", { name: change.itemName })}{" "}
								<PriceText amount={change.after} tone="inherit" />.
							</span>
						))}
						<span className="block">{t("cart.priceChangedCheck")}</span>
					</Notice>
				)}
				<ul className="flex flex-col gap-2" aria-label={t("cart.title")}>
					{cart.lines.map((line) => (
						<LineCard
							key={line.key}
							line={line}
							soldOut={soldOut.some((entry) => entry.key === line.key)}
						/>
					))}
				</ul>
				<p className="sr-only" aria-live="polite">
					{announce}
				</p>
				<button
					type="button"
					className={`${kitButton.quiet} self-start`}
					onClick={() => navigate("/thuc-don")}
					data-testid="cart-add-more"
				>
					<PlusIcon />
					{t("cart.addMore")}
				</button>
				<Panel testId="cart-summary">
					<div className="flex items-center justify-between text-body text-ink">
						<span>{t("cart.subtotal")}</span>
						<PriceText
							amount={cartSubtotal(cart)}
							tone="ink"
							testId="cart-subtotal"
						/>
					</div>
					<p
						className="text-[13px] text-ink-muted"
						data-testid="cart-voucher-note"
					>
						{t("cart.voucherAtCounter")}
					</p>
					<div className="flex items-center justify-between border-t border-dashed border-line pt-3">
						<span className="text-[19px] font-bold text-ink">
							{t("cart.total")}
						</span>
						<PriceText
							amount={cartSubtotal(cart)}
							size="lead"
							testId="cart-total"
						/>
					</div>
				</Panel>
				{reason === null ? null : (
					<p
						className="text-body text-ink"
						data-testid={online ? "cart-blocked" : "cart-offline"}
					>
						{reason}
					</p>
				)}
			</section>
			<StickyActionBar testId="cart-bar-action">
				<button
					type="button"
					className={`${kitButton.primary} flex-1`}
					disabled={reason !== null}
					onClick={() => {
						acknowledgePriceChanges();
						setAnnounce("");
						navigate("/dat-mon");
					}}
					data-testid="cart-continue"
				>
					{t("cart.continue")}
				</button>
			</StickyActionBar>
		</>
	);
}
