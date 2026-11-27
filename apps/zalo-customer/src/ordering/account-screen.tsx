import { useI18n } from "@fnb/zalo-mini/react";
import type { ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { SettingsScreen } from "../settings/settings-screen";
import { ChevronRight, ListIcon, ScanIcon, ShieldIcon } from "./parts";

// C08 Tôi of the ordering build (design spec 6.2 and the missing-screens addendum): the rows that lead to the order
// history (C14), the member code (C20) and the customer's data (C19), above the account settings that exist
// (marketing stop, the deletion request, the legal texts).

function Row({
	icon,
	title,
	sub,
	to,
	row,
}: {
	readonly icon: ReactNode;
	readonly title: string;
	readonly sub: string;
	readonly to: string;
	readonly row: string;
}) {
	const navigate = useNavigate();
	return (
		<li>
			<button
				type="button"
				onClick={() => navigate(to)}
				className="flex min-h-14 w-full items-center gap-3 px-4 py-3 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
				data-testid="account-row"
				data-row={row}
			>
				<span className="text-highlight">{icon}</span>
				<span className="flex min-w-0 flex-1 flex-col">
					<span className="text-[15px] font-bold text-ink">{title}</span>
					<span className="text-[13px] text-ink-muted">{sub}</span>
				</span>
				<ChevronRight />
			</button>
		</li>
	);
}

export function OrderingAccountScreen() {
	const { t } = useI18n();
	return (
		<>
			<div className="px-4 pt-5" data-testid="account">
				<ul className="flex flex-col divide-y divide-line rounded-card border-card border-line/60 bg-surface-raised shadow-card">
					<Row
						icon={<ListIcon />}
						title={t("me.orders")}
						sub={t("me.ordersSub")}
						to="/don-hang"
						row="orders"
					/>
					<Row
						icon={<ScanIcon />}
						title={t("me.code")}
						sub={t("me.codeSub")}
						to="/ma-thanh-vien"
						row="code"
					/>
					<Row
						icon={<ShieldIcon />}
						title={t("me.data")}
						sub={t("me.dataSub")}
						to="/du-lieu"
						row="data"
					/>
				</ul>
			</div>
			<SettingsScreen />
		</>
	);
}
