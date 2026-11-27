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
import { useOnline } from "../data/offline";
import { useLegalPopup } from "../legal/legal-popups";
import { Loading } from "../ui";
import { requestLines } from "./cart";
import { methodSelectable, ONLINE_PAYMENT_ENABLED } from "./flag";
import { refusalBacksToCart, refusalKey } from "./order-view";
import { basketSignature, useOrdering } from "./ordering-data";
import { FlowBack, kicker, Panel, Problem } from "./parts";

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
	} = useOrdering();
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
				type: "table",
				...(tableToken === null ? {} : { table_token: tableToken }),
				lines: requestLines(cart),
				payment: "counter",
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
	}, [client, store, cart, tableToken, recover, reloadMenu]);

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
	// a way that stops being offered falls back to the counter
	const method: PaymentMethod = methodSelectable(
		chosen,
		offered,
		ONLINE_PAYMENT_ENABLED,
	)
		? chosen
		: "counter";
	const canSend =
		total !== null &&
		tableToken !== null &&
		online &&
		!sending &&
		(check.status !== "ready" || check.check.ordering.accepting);

	const send = () => {
		if (client === null || total === null || tableToken === null || sending)
			return;
		const request = placement(
			basketSignature(cart, {
				store,
				table: tableToken,
				total,
				menuVersion,
				payment: method,
			}),
			(requestId) => ({
				request_id: requestId,
				store,
				type: "table",
				table_token: tableToken,
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
					data-mode="table"
				>
					<legend className={`${kicker} pb-2`}>
						{t("checkout.fulfilment")}
					</legend>
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
				</fieldset>
				<fieldset className="m-0 flex min-w-0 flex-col gap-2 border-0 p-0">
					<legend className={`${kicker} pb-2`}>{t("checkout.payment")}</legend>
					{METHODS.map(({ method: way, title, sub }) => {
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
							{t("checkout.submit")}
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
