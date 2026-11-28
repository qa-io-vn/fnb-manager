import { useI18n } from "@fnb/zalo-mini/i18n";
import { StatusPill } from "@fnb/zalo-mini/ui-kit";
import { Link } from "react-router-dom";
import { card, PageTitle } from "../ui/kit";
import { useEInvoiceAttention } from "./einvoices-page";
import {
	PAYMENT_EXCEPTIONS_PATH,
	useOpenPaymentExceptions,
} from "./payment-exceptions-page";
import { unreadCount } from "./requests";
import { useInbox } from "./requests-page";

export const MANAGER_SECTIONS = [
	{ to: "/quan-ly/tong-quan", key: "overview" },
	{ to: "/quan-ly/thuc-don", key: "menu" },
	{ to: "/quan-ly/yeu-cau", key: "requests" },
	{ to: "/quan-ly/nhan-su", key: "staff" },
	{ to: "/quan-ly/ca-lam", key: "shifts" },
	{ to: "/quan-ly/hoa-don-dien-tu", key: "einvoices" },
	{ to: PAYMENT_EXCEPTIONS_PATH, key: "paymentExceptions" },
	{ to: "/quan-ly/ma-qr", key: "qr" },
] as const;

/**
 * Quản lý: the manager's sections, on the tablet and on the phone; the inbox says how many are unread (M01: the new
 * requests nobody opened and the customers' acceptances nobody saw), the e-invoices how many failed (ADR-069) and the
 * money a provider reported that the server did not apply how much waits for a manager (ADR-068).
 */
export function ManagerHome() {
	const { t } = useI18n();
	const unread = unreadCount(useInbox().data);
	const failing = useEInvoiceAttention(true);
	const held = useOpenPaymentExceptions(true);
	return (
		<div className="mx-auto flex max-w-5xl flex-col gap-4">
			<PageTitle>{t("nav.manager")}</PageTitle>
			<ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
				{MANAGER_SECTIONS.map((section) => (
					<li key={section.key}>
						<Link
							to={section.to}
							className={`${card} flex min-h-24 flex-col justify-center gap-1 p-5 hover:bg-surface-sunken focus-visible:outline-2 focus-visible:outline-focus`}
							data-testid={`manager-${section.key}`}
						>
							<span className="flex flex-wrap items-center gap-2 text-lg font-extrabold">
								{t(`manager.${section.key}.title`)}
								{section.key === "requests" && unread > 0 ? (
									<StatusPill tone="warning" testId="manager-requests-unread">
										{t("requests.unread", { count: unread })}
									</StatusPill>
								) : null}
								{section.key === "einvoices" && failing > 0 ? (
									<StatusPill
										tone="negative"
										testId="manager-einvoices-failing"
									>
										{t("einvoices.failingBadge", { count: failing })}
									</StatusPill>
								) : null}
								{section.key === "paymentExceptions" && held > 0 ? (
									<StatusPill
										tone="warning"
										testId="manager-paymentExceptions-open"
									>
										{t("paymentExceptions.openBadge", { count: held })}
									</StatusPill>
								) : null}
							</span>
							<span className="text-sm text-ink-muted">
								{t(`manager.${section.key}.lead`)}
							</span>
						</Link>
					</li>
				))}
			</ul>
		</div>
	);
}
