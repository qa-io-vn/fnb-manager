import type { SavedCompany } from "@fnb/zalo-mini/ordering";
import { kitButton, Popup, useI18n } from "@fnb/zalo-mini/react";
import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useCustomerData } from "../data/customer-data";
import { useOrdering } from "./ordering-data";
import { FlowBack, Panel, Problem, TrashIcon } from "./parts";

// The companies the customer saved for a company invoice (C18 "Lưu công ty này cho lần sau"), on "Dữ liệu của bạn"
// (C19) and behind Tôi → Hóa đơn công ty: each can be forgotten (customer_delete_saved_company); a request already
// made with it stays. Only the customer's own companies are ever listed: the server answers nothing else.

export function SavedCompaniesPanel() {
	const { t } = useI18n();
	const { client } = useOrdering();
	const { recover } = useCustomerData();
	const [companies, setCompanies] = useState<
		readonly SavedCompany[] | "loading" | "failed"
	>("loading");
	const [asking, setAsking] = useState<SavedCompany | null>(null);
	const [busy, setBusy] = useState(false);
	const [message, setMessage] = useState<"deleted" | "failed" | null>(null);
	const load = useCallback(() => {
		if (client === null) return;
		client.savedCompanies().then(
			(answer) => setCompanies(answer.companies),
			(error: unknown) => {
				recover(error);
				setCompanies("failed");
			},
		);
	}, [client, recover]);
	useEffect(() => {
		load();
	}, [load]);
	const remove = (company: SavedCompany) => {
		if (client === null || busy) return;
		setBusy(true);
		client.deleteSavedCompany(company.id).then(
			() => {
				setBusy(false);
				setAsking(null);
				setMessage("deleted");
				load();
			},
			(error: unknown) => {
				setBusy(false);
				recover(error);
				setMessage("failed");
			},
		);
	};
	return (
		<Panel testId="saved-companies" labelledBy="saved-companies-title">
			<h2 id="saved-companies-title" className="text-[15px] font-bold text-ink">
				{t("invoice.saved.title")}
			</h2>
			{companies === "loading" ? (
				<p className="text-[13px] text-ink-muted">{t("customer.loading")}</p>
			) : companies === "failed" ? (
				<Problem testId="saved-companies-failed">
					{t("invoice.saved.loadFailed")}
				</Problem>
			) : companies.length === 0 ? (
				<p
					className="text-[13px] text-ink-muted"
					data-testid="saved-companies-empty"
				>
					{t("invoice.saved.empty")}
				</p>
			) : (
				<ul className="flex flex-col divide-y divide-line">
					{companies.map((company) => (
						<li
							key={company.id}
							className="flex items-center gap-2 py-2 first:pt-0 last:pb-0"
							data-testid="saved-company"
						>
							<span className="flex min-w-0 flex-1 flex-col">
								<span className="text-[15px] font-bold break-words text-ink">
									{company.companyName}
								</span>
								<span className="text-[13px] break-all text-ink-muted">
									{t("invoice.saved.line", {
										taxCode: company.taxCode,
										email: company.email,
									})}
								</span>
							</span>
							<button
								type="button"
								className={`${kitButton.quiet} shrink-0 text-negative`}
								onClick={() => {
									setMessage(null);
									setAsking(company);
								}}
								aria-label={t("invoice.saved.deleteLabel", {
									name: company.companyName,
								})}
								data-testid="saved-company-delete"
							>
								<TrashIcon />
							</button>
						</li>
					))}
				</ul>
			)}
			{message === null ? null : (
				<p
					role="status"
					className="text-body text-ink"
					data-testid="saved-companies-message"
				>
					{t(
						message === "deleted"
							? "invoice.saved.deleted"
							: "invoice.saved.failed",
					)}
				</p>
			)}
			{asking === null ? null : (
				<Popup
					title={t("invoice.saved.confirmTitle")}
					onClose={() => setAsking(null)}
					testId="saved-company-confirm"
				>
					<div className="flex flex-col gap-3">
						<p className="text-body font-bold break-words text-ink">
							{asking.companyName} · {asking.taxCode}
						</p>
						<p className="text-body text-ink">
							{t("invoice.saved.confirmBody")}
						</p>
						<button
							type="button"
							className={`${kitButton.danger} w-full`}
							onClick={() => remove(asking)}
							disabled={busy}
							aria-busy={busy}
							data-testid="saved-company-confirm-delete"
						>
							<TrashIcon />
							{t("invoice.saved.delete")}
						</button>
						<button
							type="button"
							className={`${kitButton.secondary} w-full`}
							onClick={() => setAsking(null)}
						>
							{t("invoice.saved.keep")}
						</button>
					</div>
				</Popup>
			)}
		</Panel>
	);
}

/** Tôi → Hóa đơn công ty: how to ask for one (from an order in the history) and the saved companies. */
export function CompanyHubScreen() {
	const { t } = useI18n();
	const navigate = useNavigate();
	return (
		<section
			className="flex flex-col gap-4 px-4 py-4"
			data-testid="company-hub"
		>
			<FlowBack />
			<h1 className="text-xl font-bold text-ink">{t("invoice.title")}</h1>
			<p className="text-body text-ink">{t("invoice.hub.lead")}</p>
			<button
				type="button"
				className={`${kitButton.primary} w-full`}
				onClick={() => navigate("/don-hang")}
				data-testid="company-hub-orders"
			>
				{t("invoice.hub.orders")}
			</button>
			<SavedCompaniesPanel />
		</section>
	);
}
