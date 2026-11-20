import type { CustomerHome, LoyaltyClient } from "@fnb/zalo-mini/loyalty";
import { useI18n } from "@fnb/zalo-mini/react";
import { useNavigate } from "react-router-dom";
import { useCustomerData, useLoad } from "../data/customer-data";
import { secondaryButton } from "../ui";

const loadWallet = (client: LoyaltyClient) => client.wallet();

/**
 * A compact "bills to confirm" prompt on the home screen for a member. It reads the wallet only when a store of the
 * app runs in staff mode, so a brand on POS sync pays nothing for it.
 */
export function BillsPrompt({ home }: { readonly home: CustomerHome }) {
	const { t } = useI18n();
	const navigate = useNavigate();
	const { member } = useCustomerData();
	const staff = home.stores.some((store) => store.confirmation === "staff");
	const { state } = useLoad(member && staff ? loadWallet : null);
	if (!member || !staff || state.status !== "ready") return null;
	const count = state.data.billsToConfirm.length;
	if (count === 0) return null;
	return (
		<div
			role="status"
			className="flex flex-col gap-2 rounded-xl bg-warning-soft px-4 py-3"
			data-testid="bills-prompt"
		>
			<p className="text-base text-ink">{t("bill.prompt", { count })}</p>
			<button
				type="button"
				className={secondaryButton}
				onClick={() => navigate("/the-thanh-vien")}
			>
				{t("bill.promptOpen")}
			</button>
		</div>
	);
}
