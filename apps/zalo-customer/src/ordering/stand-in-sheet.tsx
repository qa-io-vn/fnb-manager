import { kitButton, Popup, PriceText, useI18n } from "@fnb/zalo-mini/react";
import { useSyncExternalStore } from "react";
import type { StandInCheckoutPort } from "./payment-port";

// The browser's stand-in of Zalo's checkout sheet: what createOrder opens outside Zalo. "Thanh toán thử" asks the
// stand-in gateway to report the payment (the demo till) and "Hủy" leaves, as a customer closing Zalo's sheet does.
// It says nothing about the order: the payment step still waits for the server's order.

export function StandInCheckoutSheet({
	port,
}: {
	readonly port: StandInCheckoutPort;
}) {
	const { t } = useI18n();
	const sheet = useSyncExternalStore(port.subscribe, port.sheet, port.sheet);
	if (sheet === null) return null;
	return (
		<Popup
			title={t("standIn.title")}
			onClose={() => port.choose("cancel")}
			testId="stand-in-sheet"
		>
			<div className="flex flex-col gap-3">
				<p className="text-body text-ink">{sheet.desc}</p>
				<PriceText amount={sheet.amount} size="lead" testId="stand-in-amount" />
				<p className="text-[13px] text-ink">{t("standIn.body")}</p>
				<button
					type="button"
					className={`${kitButton.primary} w-full`}
					onClick={() => port.choose("pay")}
					data-testid="stand-in-pay"
				>
					{t("standIn.pay")}
				</button>
				<button
					type="button"
					className={`${kitButton.secondary} w-full`}
					onClick={() => port.choose("cancel")}
					data-testid="stand-in-cancel"
				>
					{t("standIn.cancel")}
				</button>
			</div>
		</Popup>
	);
}
