import type { CheckoutParams } from "@fnb/zalo-mini/ordering";
import { CheckoutSDK, EventName, events, Payment } from "zmp-sdk";
import type { ZaloCheckoutSdk } from "./payment-port";

// Zalo's Checkout SDK (zmp-sdk 2.53.3), loaded only inside the Zalo runtime (payment-port.ts imports it lazily behind
// VITE_ZALO_RUNTIME). The parameters go to createOrder exactly as the server signed them: the MAC is the server's, the
// app holds no key and changes nothing.

function checkoutArgs(params: CheckoutParams) {
	return {
		amount: params.amount,
		desc: params.desc,
		item: params.item.map((entry) => ({ id: entry.id, amount: entry.amount })),
		extradata: params.extradata,
		...(params.method === null ? {} : { method: params.method }),
		mac: params.mac,
	};
}

export const zaloCheckoutSdk: ZaloCheckoutSdk = {
	createOrder: (params) => CheckoutSDK.createOrder(checkoutArgs(params)),
	checkTransaction: (platformOrderId) =>
		CheckoutSDK.checkTransaction({ data: { orderId: platformOrderId } }),
	openCheckoutPopup: (input) => Payment.openCheckoutPopup(input),
	onPaymentEnd(listener) {
		const once = () => listener();
		events.on(EventName.PaymentDone, once);
		events.on(EventName.PaymentClose, once);
		return () => {
			events.off(EventName.PaymentDone, once);
			events.off(EventName.PaymentClose, once);
		};
	},
};
