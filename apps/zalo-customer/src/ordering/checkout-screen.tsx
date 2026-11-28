import { RestError } from "@fnb/zalo-mini";
import type {
	CartCheck,
	PaymentMethod,
	PlaceAnswer,
} from "@fnb/zalo-mini/ordering";
import {
	kitButton,
	PriceText,
	StickyActionBar,
	useI18n,
} from "@fnb/zalo-mini/react";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useCustomerData } from "../data/customer-data";
import { isoDateIn, shownDate } from "../data/dates";
import { useOnline } from "../data/offline";
import { useLegalPopup } from "../legal/legal-popups";
import { Loading } from "../ui";
import { requestLines } from "./cart";
import { methodSelectable, ONLINE_PAYMENT_ENABLED } from "./flag";
import { refusalBacksToCart, refusalKey } from "./order-view";
import { basketSignature, useOrdering } from "./ordering-data";
import { ClockIcon, clock, FlowBack, kicker, Panel, Problem } from "./parts";
import type { PickupLocationState } from "./pickup-screen";
import {
	type Fulfilment,
	orderingOpen,
	type PickupChoice,
	relativeDay,
	slotRefusal,
	takeawayMethods,
	vietnameseWeekday,
} from "./takeaway";

// C05 Xác nhận đơn (design spec 6.2). The server prices the basket first (customer_check_cart) and the button shows
// its total; "Đặt món" sends customer_place_order with a request_id made once for this basket, this total and this way
// to pay, so a double tap or a retry after a lost answer gives one order (criterion 3). Paying at the counter always
// works; "Ví ZaloPay" and "Chuyển khoản QR" can be chosen only in a build with VITE_ONLINE_PAYMENT=on and where the
// store offers them (its ordering state's payment_methods), otherwise they are shown disabled with a note. An order
// paid online waits for its payment (awaiting_payment) and goes to the payment step; the app sends no price.

type Check =
	| { readonly status: "checking" }
	| { readonly status: "ready"; readonly check: CartCheck }
	| { readonly status: "failed" };

type CheckoutProblem =
	| { readonly kind: "refused"; readonly answer: PlaceAnswer }
	| { readonly kind: "check"; readonly refusal: string | null }
	| { readonly kind: "network" }
	| { readonly kind: "unknown" };

const METHODS: readonly {
	readonly method: PaymentMethod;
	readonly title: string;
	readonly sub: string;
}[] = [
	{
		method: "zalo_checkout",
		title: "checkout.wallet",
		sub: "checkout.walletSub",
	},
	{ method: "vietqr", title: "checkout.transfer", sub: "checkout.transferSub" },
	{
		method: "counter",
		title: "checkout.counter",
		sub: "checkout.counterSubTable",
	},
];

/** The pick-up row of C05: "Hôm nay · 15:00", "Ngày mai · 07:30", or "Càng sớm có thể". */
function pickupRow(
	t: (
		key: string,
		params?: Readonly<Record<string, string | number>>,
	) => string,
	pickup: PickupChoice,
	now: number,
): string {
	if (pickup.kind === "asap") return t("checkout.pickupAsap");
	const time = clock(pickup.at);
	const date = isoDateIn(Date.parse(pickup.at));
	switch (relativeDay(date, now)) {
		case "today":
			return t("checkout.pickupRowToday", { time });
		case "tomorrow":
			return t("checkout.pickupRowTomorrow", { time });
		default:
			return t("checkout.pickupRowLater", {
				day: `${vietnameseWeekday(date)}, ${shownDate(date).slice(0, 5)}`,
				time,
			});
	}
}

function lostAnswer(error: unknown): boolean {
	return (
		error instanceof RestError && (error.status === 0 || error.status >= 500)
	);
}

export function CheckoutScreen() {
	const { t } = useI18n();
	const navigate = useNavigate();
	const online = useOnline();
	const { recover } = useCustomerData();
	const {
		client,
		cart,
		store,
		table,
		menu,
		placement,
		settlePlacement,
		reloadMenu,
		fulfilment,
		takeaway,
		setFulfilment,
		pickup,
	} = useOrdering();
	const forTakeaway = fulfilment === "takeaway";
	const storeAddress = menu.status === "ready" ? menu.data.store.address : null;
	const { open, popup } = useLegalPopup();
	const [check, setCheck] = useState<Check>({ status: "checking" });
	const [chosen, setChosen] = useState<PaymentMethod>("counter");
	const [sending, setSending] = useState(false);
	const [problem, setProblem] = useState<CheckoutProblem | null>(null);
	const problemRef = useRef<HTMLDivElement>(null);
	const paymentId = useId();
	const tableToken = table?.state === "ok" ? table.token : null;
	const menuVersion = menu.status === "ready" ? menu.data.menuVersion : null;

	const runCheck = useCallback(() => {
		if (client === null || store === null || cart.lines.length === 0) return;
		setCheck({ status: "checking" });
		client
			.checkCart({
				store,
				type: fulfilment,
				...(tableToken === null || fulfilment === "takeaway"
					? {}
					: { table_token: tableToken }),
				lines: requestLines(cart),
			})
			.then(
				(answer) => {
					setCheck({ status: "ready", check: answer });
					if (answer.state === "refused") {
						setProblem({ kind: "check", refusal: answer.refusal });
						reloadMenu();
					}
				},
				(error: unknown) => {
					recover(error);
					setCheck({ status: "failed" });
				},
			);
	}, [client, store, cart, tableToken, fulfilment, recover, reloadMenu]);

	useEffect(() => {
		runCheck();
	}, [runCheck]);

	useEffect(() => {
		if (problem !== null) problemRef.current?.focus();
	}, [problem]);

	if (cart.lines.length === 0 || store === null) {
		return (
			<section className="flex flex-col gap-4 px-4 py-4" data-testid="checkout">
				<FlowBack to="/gio-hang" />
				<p className="text-body text-ink">{t("cart.empty.body")}</p>
			</section>
		);
	}

	const total =
		check.status === "ready" && check.check.state === "ok"
			? check.check.total
			: null;
	// the ways the store offers now: the cart check's answer, else the menu's (both carry the ordering state)
	const offered =
		check.status === "ready"
			? check.check.ordering.paymentMethods
			: menu.status === "ready"
				? menu.data.ordering.paymentMethods
				: [];
	// a takeaway is prepaid: only the online ways, the first one the store offers chosen unless the customer chose
	const ways = METHODS.filter(
		({ method: way }) => !forTakeaway || takeawayMethods([way]).length > 0,
	);
	const firstOnline =
		takeawayMethods(offered).find((way) =>
			methodSelectable(way, offered, ONLINE_PAYMENT_ENABLED),
		) ?? null;
	// a way that stops being offered falls back to the counter (to the first online way for a takeaway)
	const method: PaymentMethod | null = forTakeaway
		? chosen !== "counter" &&
			methodSelectable(chosen, offered, ONLINE_PAYMENT_ENABLED)
			? chosen
			: firstOnline
		: methodSelectable(chosen, offered, ONLINE_PAYMENT_ENABLED)
			? chosen
			: "counter";
	const ordering =
		check.status === "ready"
			? check.check.ordering
			: menu.status === "ready"
				? menu.data.ordering
				: null;
	// a closed store takes a takeaway booked for a slot of its next opening, never "Càng sớm"
	const orderable =
		ordering === null ||
		(forTakeaway
			? orderingOpen(ordering, "takeaway", ONLINE_PAYMENT_ENABLED) &&
				(ordering.accepting || pickup?.kind === "slot")
			: ordering.accepting);
	const canSend =
		total !== null &&
		method !== null &&
		online &&
		!sending &&
		orderable &&
		(forTakeaway ? pickup !== null : tableToken !== null);

	const send = () => {
		if (client === null || total === null || method === null || sending) return;
		if (forTakeaway ? pickup === null : tableToken === null) return;
		const pickupAt =
			forTakeaway && pickup?.kind === "slot" ? pickup.at : undefined;
		const request = placement(
			basketSignature(cart, {
				store,
				type: fulfilment,
				table: forTakeaway ? null : tableToken,
				pickup: pickupAt ?? null,
				total,
				menuVersion,
				payment: method,
			}),
			(requestId) => ({
				request_id: requestId,
				store,
				type: fulfilment,
				...(forTakeaway || tableToken === null
					? {}
					: { table_token: tableToken }),
				...(pickupAt === undefined ? {} : { pickup_at: pickupAt }),
				lines: requestLines(cart),
				payment: method,
				expected_total: total,
				...(menuVersion === null ? {} : { menu_version: menuVersion }),
			}),
		);
		setSending(true);
		setProblem(null);
		client.placeOrder(request).then(
			(answer) => {
				setSending(false);
				settlePlacement(answer);
				if (answer.state !== "refused" && answer.order !== null) {
					// an order paid online waits for its payment: the payment step opens it
					navigate(
						answer.order.status === "awaiting_payment"
							? `/tra-tien/${answer.order.id}`
							: `/don/${answer.order.id}`,
						{ replace: true },
					);
					return;
				}
				// the time the customer chose filled, passed or is closed: back to C17 to choose another (frame 3)
				if (forTakeaway && slotRefusal(answer.refusal)) {
					const state: PickupLocationState = {
						problem: answer.refusal as NonNullable<
							PickupLocationState["problem"]
						>,
						at: answer.pickupAt ?? pickupAt ?? null,
					};
					navigate("/gio-lay", { state });
					return;
				}
				setProblem({ kind: "refused", answer });
				if (
					answer.refusal === "price_changed" ||
					refusalBacksToCart(answer.refusal)
				)
					reloadMenu();
				if (answer.refusal === "price_changed") runCheck();
			},
			(error: unknown) => {
				setSending(false);
				recover(error);
				// the answer may be lost after the order was made: the same request goes again on the next tap
				setProblem(
					lostAnswer(error) ? { kind: "network" } : { kind: "unknown" },
				);
			},
		);
	};

	const refusal =
		problem?.kind === "refused"
			? problem.answer.refusal
			: problem?.kind === "check"
				? problem.refusal
				: null;

	return (
		<>
			<section className="flex flex-col gap-5 px-4 py-4" data-testid="checkout">
				<FlowBack to="/gio-hang" />
				<h1 className="text-xl font-bold text-ink">{t("checkout.title")}</h1>
				{problem === null ? null : (
					<div ref={problemRef} tabIndex={-1} className="outline-none">
						<Problem
							testId="checkout-problem"
							data={{
								problem:
									problem.kind === "refused" || problem.kind === "check"
										? (refusal ?? "unknown")
										: problem.kind,
							}}
						>
							<span className="block">
								{problem.kind === "network"
									? t("order.problem.network")
									: t(refusalKey(refusal))}
							</span>
							{problem.kind === "refused" &&
							problem.answer.refusal === "price_changed" &&
							problem.answer.total !== null ? (
								<span
									className="mt-1 block font-bold"
									data-testid="checkout-new-total"
								>
									{t("checkout.newTotal")}:{" "}
									<PriceText amount={problem.answer.total} tone="inherit" />
								</span>
							) : null}
							{refusalBacksToCart(refusal) || refusal === "table_unknown" ? (
								<button
									type="button"
									className={`${kitButton.secondary} mt-3 w-full`}
									onClick={() => navigate("/gio-hang")}
									data-testid="checkout-back-to-cart"
								>
									{t("checkout.backToCart")}
								</button>
							) : null}
						</Problem>
					</div>
				)}
				<fieldset
					className="m-0 flex min-w-0 flex-col gap-2 border-0 p-0"
					data-testid="fulfilment"
					data-mode={fulfilment}
				>
					<legend className={`${kicker} pb-2`}>
						{t("checkout.fulfilment")}
					</legend>
					{takeaway ? (
						<Panel>
							<div className="flex flex-wrap gap-2">
								{(
									[
										...(table?.state === "ok" ? (["table"] as const) : []),
										"takeaway",
									] as const
								).map((mode: Fulfilment) => {
									const selected = mode === fulfilment;
									return (
										<label
											key={mode}
											className={`relative inline-flex min-h-12 items-center gap-1.5 rounded-full border-field px-4 text-[15px] font-bold has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-focus ${selected ? "border-ink bg-ink text-surface-raised" : "border-line-strong bg-surface-raised text-ink"}`}
											data-testid={`fulfilment-${mode}`}
											data-selected={selected}
										>
											<input
												type="radio"
												name={`${paymentId}-fulfilment`}
												value={mode}
												checked={selected}
												disabled={sending}
												onChange={() => setFulfilment(mode)}
												className="absolute inset-0 m-0 size-full cursor-pointer appearance-none rounded-full opacity-0"
											/>
											{mode === "table" && table?.state === "ok"
												? t("checkout.table", { table: table.label })
												: t("checkout.takeaway")}
										</label>
									);
								})}
							</div>
							{forTakeaway ? null : (
								<p className="text-[13px] text-ink-muted">
									{t("checkout.tableSub")}
								</p>
							)}
						</Panel>
					) : (
						<Panel>
							<p
								className="text-[15px] font-bold text-ink"
								data-testid="fulfilment-table"
							>
								{table?.state === "ok"
									? t("checkout.table", { table: table.label })
									: t("cart.noTable")}
							</p>
							<p className="text-[13px] text-ink-muted">
								{table?.state === "ok"
									? t("checkout.tableSub")
									: t("cart.noTableSub")}
							</p>
						</Panel>
					)}
				</fieldset>
				{forTakeaway ? (
					<section
						className="flex flex-col gap-2"
						aria-labelledby={`${paymentId}-pickup`}
					>
						<h2 id={`${paymentId}-pickup`} className={kicker}>
							{t("checkout.pickup")}
						</h2>
						<Panel testId="checkout-pickup">
							<div className="flex items-center gap-3">
								<span
									aria-hidden="true"
									className="flex size-10 shrink-0 items-center justify-center rounded-card-xl bg-surface-sunken text-highlight"
								>
									<ClockIcon />
								</span>
								<div className="flex min-w-0 flex-1 flex-col">
									<p
										className="text-[15px] font-bold text-ink"
										data-testid="checkout-pickup-when"
										data-kind={pickup?.kind ?? "none"}
									>
										{pickup === null
											? t("checkout.pickupNone")
											: pickupRow(t, pickup, Date.now())}
									</p>
									<p className="text-[13px] text-ink-muted">
										{storeAddress === null
											? t("checkout.pickupWhereShort")
											: t("checkout.pickupWhere", { address: storeAddress })}
									</p>
								</div>
								<button
									type="button"
									className={`${kitButton.quiet} shrink-0`}
									onClick={() => navigate("/gio-lay")}
									aria-label={
										pickup === null
											? undefined
											: t("checkout.pickupChangeLabel")
									}
									data-testid="checkout-pickup-change"
								>
									{pickup === null
										? t("checkout.pickupChoose")
										: t("checkout.pickupChange")}
								</button>
							</div>
							{pickup === null ? (
								<p
									className="text-[13px] text-ink"
									data-testid="checkout-pickup-needed"
								>
									{t("checkout.pickupNeeded")}
								</p>
							) : null}
						</Panel>
					</section>
				) : null}
				<fieldset className="m-0 flex min-w-0 flex-col gap-2 border-0 p-0">
					<legend className={`${kicker} pb-2`}>{t("checkout.payment")}</legend>
					{ways.map(({ method: way, title, sub }) => {
						const ready = methodSelectable(
							way,
							offered,
							ONLINE_PAYMENT_ENABLED,
						);
						const selected = way === method;
						const id = `${paymentId}-${way}`;
						return (
							<label
								key={way}
								htmlFor={id}
								className={`relative flex min-h-16 items-start gap-3 rounded-card border-field p-4 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-focus ${ready ? `cursor-pointer bg-surface-raised ${selected ? "border-accent" : "border-line-strong"}` : "border-line bg-surface-sunken"}`}
								data-testid="payment-method"
								data-method={way}
								data-ready={ready}
								data-selected={selected}
							>
								<input
									id={id}
									type="radio"
									name="payment"
									value={way}
									checked={selected}
									disabled={!ready || sending}
									onChange={() => setChosen(way)}
									aria-describedby={ready ? undefined : `${id}-note`}
									className="absolute inset-0 m-0 size-full cursor-pointer appearance-none rounded-card opacity-0 disabled:cursor-default"
								/>
								<span
									aria-hidden="true"
									className={`mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full border-2 ${selected ? "border-accent" : "border-line-strong"}`}
								>
									{selected ? (
										<span className="size-3 rounded-full bg-accent" />
									) : null}
								</span>
								<span className="flex min-w-0 flex-col gap-0.5">
									<span className="text-[15px] font-bold text-ink">
										{t(title)}
									</span>
									<span className="text-[13px] text-ink-muted">{t(sub)}</span>
									{ready ? null : (
										<span
											id={`${id}-note`}
											className="text-[13px] text-ink"
											data-testid="payment-not-ready"
										>
											{t("checkout.notReady")}
										</span>
									)}
								</span>
							</label>
						);
					})}
					{forTakeaway ? (
						<p
							className="rounded-card bg-surface-sunken px-4 py-3 text-[13px] text-ink"
							data-testid="checkout-takeaway-prepaid"
						>
							{t("checkout.takeawayPrepaid")}
						</p>
					) : null}
				</fieldset>
				<Panel testId="checkout-lines">
					<h2 className={kicker}>{t("checkout.lines")}</h2>
					{check.status === "checking" ? (
						<Loading label={t("checkout.checking")} />
					) : check.status === "failed" ? (
						<p role="alert" className="text-body text-ink">
							{t("customer.error.network")}
						</p>
					) : (
						<ul className="flex flex-col gap-2">
							{check.check.lines.map((line) => (
								<li
									key={line.lineNo}
									className="flex items-start justify-between gap-3 text-body text-ink"
									data-testid="checkout-line"
								>
									<span className="min-w-0">
										{line.itemName}
										{line.sizeLabel === null ? "" : ` (${line.sizeLabel})`} ×
										{line.quantity}
										{line.note === null ? null : (
											<span className="block text-[13px] text-ink-muted break-words">
												{line.note}
											</span>
										)}
									</span>
									<PriceText amount={line.lineTotal} tone="ink" />
								</li>
							))}
						</ul>
					)}
					{total === null ? null : (
						<div className="flex items-center justify-between border-t border-dashed border-line pt-3">
							<span className="text-[19px] font-bold text-ink">
								{t("cart.total")}
							</span>
							<PriceText amount={total} size="lead" testId="checkout-total" />
						</div>
					)}
				</Panel>
				<p
					className="text-xs leading-relaxed text-ink-muted"
					data-testid="checkout-terms"
				>
					{t("checkout.terms")}{" "}
					<button
						type="button"
						className={`${kitButton.quiet} -my-2 px-1 text-xs`}
						onClick={() => open("mini_app_terms")}
					>
						{t("checkout.termsOpen")}
					</button>
				</p>
				{!online ? (
					<p className="text-body text-ink" data-testid="cart-offline">
						{t("cart.offline")}
					</p>
				) : null}
			</section>
			<StickyActionBar testId="checkout-bar">
				<button
					type="button"
					className={`${kitButton.primary} flex-1`}
					disabled={!canSend}
					aria-busy={sending}
					onClick={send}
					data-testid="checkout-submit"
				>
					{sending ? (
						t("checkout.sending")
					) : (
						<>
							{t(forTakeaway ? "checkout.submitTakeaway" : "checkout.submit")}
							{total === null ? null : (
								<>
									<span aria-hidden="true">·</span>
									<PriceText amount={total} tone="inherit" />
								</>
							)}
						</>
					)}
				</button>
			</StickyActionBar>
			{popup}
		</>
	);
}
