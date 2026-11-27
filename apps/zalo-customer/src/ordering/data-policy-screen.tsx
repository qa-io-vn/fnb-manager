import type { DeletionRequest } from "@fnb/zalo-mini/loyalty";
import { kitButton, Popup, useI18n } from "@fnb/zalo-mini/react";
import { useId, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useCustomerData } from "../data/customer-data";
import { useLegalPopup } from "../legal/legal-popups";
import { DeletionState } from "../settings/settings-screen";
import { CheckControl } from "../ui";
import { openOrders } from "./order-view";
import { useOrdering } from "./ordering-data";
import {
	ChevronRight,
	FlowBack,
	kicker,
	Notice,
	Panel,
	Problem,
	ShieldIcon,
	TrashIcon,
} from "./parts";
import { useStampCard } from "./stamp-card";

// C19 Chính sách dữ liệu và xóa tài khoản (missing-screens README 5.8): what the shop keeps, why and for how long,
// what it never keeps, the customer's rights, and deleting the account with an honest list of what goes and what
// the law keeps. The deletion goes through the existing request (customer_request_deletion, carried out by the
// owner within the legal time) for a member; the database has no deletion of a Zalo login without a member record
// yet, so a visitor is told to ask at the counter. An open order blocks the deletion.

type Step = "summary" | "delete";

const SUMMARY = ["name", "phone", "orders", "stamps"] as const;

function Summary() {
	const { t } = useI18n();
	return (
		<Panel testId="data-summary">
			<ul className="flex flex-col divide-y divide-line">
				{SUMMARY.map((item) => (
					<li
						key={item}
						className="flex flex-col gap-0.5 py-3 first:pt-0 last:pb-0"
						data-testid="data-item"
						data-item={item}
					>
						<span className="text-[15px] font-bold text-ink">
							{t(`data.item.${item}`)}
						</span>
						<span className="text-[13px] text-ink">
							{t(`data.item.${item}Why`)}
						</span>
						<span className="text-[13px] text-ink-muted">
							{t(`data.item.${item}Keep`)}
						</span>
					</li>
				))}
			</ul>
		</Panel>
	);
}

function Rights({ onDelete }: { readonly onDelete: () => void }) {
	const { t } = useI18n();
	const { open, popup } = useLegalPopup();
	const row =
		"flex min-h-14 w-full items-center gap-3 px-4 py-3 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus";
	return (
		<>
			<section aria-labelledby="data-rights" className="flex flex-col gap-2">
				<h2 id="data-rights" className={kicker}>
					{t("data.rights")}
				</h2>
				<div className="flex flex-col divide-y divide-line rounded-card border-card border-line/60 bg-surface-raised">
					<button
						type="button"
						className={row}
						onClick={() => open("privacy_notice")}
						data-testid="data-policy"
					>
						<ShieldIcon />
						<span className="flex min-w-0 flex-1 flex-col">
							<span className="text-[15px] font-bold text-ink">
								{t("data.policy")}
							</span>
							<span className="text-[13px] text-ink-muted">
								{t("data.policySub")}
							</span>
						</span>
						<ChevronRight />
					</button>
					{(["copy", "complain", "marketing"] as const).map((item) => (
						<div key={item} className="flex flex-col gap-0.5 px-4 py-3">
							<span className="text-[15px] font-bold text-ink">
								{t(`data.${item}`)}
							</span>
							<span className="text-[13px] text-ink-muted">
								{t(`data.${item}Sub`)}
							</span>
						</div>
					))}
				</div>
			</section>
			<section aria-labelledby="data-careful" className="flex flex-col gap-2">
				<h2 id="data-careful" className={kicker}>
					{t("data.careful")}
				</h2>
				<button
					type="button"
					onClick={onDelete}
					className="flex min-h-14 items-center gap-3 rounded-card border-outline border-edge-danger bg-surface-raised px-4 py-3 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
					data-testid="data-delete"
				>
					<span className="text-negative">
						<TrashIcon />
					</span>
					<span className="flex min-w-0 flex-1 flex-col">
						<span className="text-[15px] font-bold text-negative">
							{t("data.delete")}
						</span>
						<span className="text-[13px] text-ink">{t("data.deleteSub")}</span>
					</span>
					<ChevronRight />
				</button>
			</section>
			{popup}
		</>
	);
}

function DeleteStep({ onKeep }: { readonly onKeep: () => void }) {
	const { t } = useI18n();
	const navigate = useNavigate();
	const { member, client, rememberDeletion, deletion, recover } =
		useCustomerData();
	const { orders } = useOrdering();
	const { load } = useStampCard();
	const [confirming, setConfirming] = useState(false);
	const [understood, setUnderstood] = useState(false);
	const [sending, setSending] = useState(false);
	const [failed, setFailed] = useState(false);
	const [sent, setSent] = useState<DeletionRequest | null>(null);
	const checkId = useId();
	const open = orders.status === "ready" ? openOrders(orders.data.orders) : [];
	const stamps = load.status === "ready" ? load.card.stamps : 0;
	const shown = sent ?? deletion;
	const submit = () => {
		if (client === null) return;
		setSending(true);
		setFailed(false);
		client.requestDeletion().then(
			(request) => {
				setSending(false);
				setConfirming(false);
				rememberDeletion(request);
				setSent(request);
			},
			(error: unknown) => {
				setSending(false);
				recover(error);
				setFailed(true);
			},
		);
	};
	return (
		<section className="flex flex-col gap-4" data-testid="data-delete-step">
			<p className="text-body text-ink">{t("data.deleteIntro")}</p>
			<Panel testId="data-will-delete">
				<h2 className={kicker}>{t("data.willDelete")}</h2>
				<ul className="flex list-disc flex-col gap-1 pl-5 text-body text-ink">
					{(["name", "phone", "stamps", "consents"] as const).map((item) => (
						<li key={item}>{t(`data.delete.${item}`)}</li>
					))}
				</ul>
			</Panel>
			<Panel testId="data-will-keep">
				<h2 className={kicker}>{t("data.willKeep")}</h2>
				<ul className="flex list-disc flex-col gap-1 pl-5 text-body text-ink">
					{(["invoices", "orders", "backups"] as const).map((item) => (
						<li key={item}>{t(`data.keep.${item}`)}</li>
					))}
				</ul>
			</Panel>
			<Notice testId="data-warning">{t("data.warning")}</Notice>
			{shown !== null ? (
				<div className="flex flex-col gap-2" data-testid="data-deletion-sent">
					<p role="status" className="text-body font-bold text-ink">
						{t("data.sent")}
					</p>
					<DeletionState request={shown} />
				</div>
			) : open.length > 0 ? (
				<Problem testId="data-blocked">
					{t("data.blocked", { count: open.length })}
					<button
						type="button"
						className={`${kitButton.secondary} mt-3 w-full`}
						onClick={() => navigate(`/don/${open[0]?.id ?? ""}`)}
					>
						{t("data.blockedOpen")}
					</button>
				</Problem>
			) : !member ? (
				<Notice testId="data-visitor">{t("data.visitorOnly")}</Notice>
			) : (
				<button
					type="button"
					className={`${kitButton.danger} w-full`}
					onClick={() => setConfirming(true)}
					data-testid="data-continue"
				>
					{t("data.continue")}
				</button>
			)}
			<button
				type="button"
				className={`${kitButton.secondary} w-full`}
				onClick={onKeep}
			>
				{t("data.keepAccount")}
			</button>
			{confirming ? (
				<Popup
					title={t("data.confirmTitle")}
					onClose={() => setConfirming(false)}
					testId="data-confirm"
				>
					<div className="flex flex-col gap-3">
						<p className="text-body text-ink">{t("data.confirmBody")}</p>
						<div className="flex items-start gap-3">
							<CheckControl
								id={checkId}
								kind="checkbox"
								checked={understood}
								disabled={sending}
								testId="data-confirm-check"
								onChange={setUnderstood}
							/>
							<label
								htmlFor={checkId}
								className="pt-2 text-body font-bold text-ink"
							>
								{t("data.confirmCheck", { stamps })}
							</label>
						</div>
						{failed ? (
							<p role="alert" className="text-body text-ink">
								{t("data.failed")}
							</p>
						) : null}
						<button
							type="button"
							className={`${kitButton.danger} w-full`}
							disabled={!understood || sending}
							aria-busy={sending}
							onClick={submit}
							data-testid="data-confirm-delete"
						>
							<TrashIcon />
							{sending ? t("data.sending") : t("data.confirm")}
						</button>
						<button
							type="button"
							className={`${kitButton.secondary} w-full`}
							onClick={() => setConfirming(false)}
						>
							{t("data.keepAccount")}
						</button>
					</div>
				</Popup>
			) : null}
		</section>
	);
}

export function DataPolicyScreen() {
	const { t } = useI18n();
	const [step, setStep] = useState<Step>("summary");
	return (
		<section
			className="flex flex-col gap-4 px-4 py-4"
			data-testid="data-policy-screen"
			data-step={step}
		>
			<FlowBack />
			<h1 className="text-xl font-bold text-ink">
				{step === "summary" ? t("data.title") : t("data.delete")}
			</h1>
			{step === "summary" ? (
				<>
					<p className="text-body text-ink">{t("data.intro")}</p>
					<Summary />
					<Notice testId="data-not-stored">{t("data.notStored")}</Notice>
					<Rights onDelete={() => setStep("delete")} />
				</>
			) : (
				<DeleteStep onKeep={() => setStep("summary")} />
			)}
		</section>
	);
}
