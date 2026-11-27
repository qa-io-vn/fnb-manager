import type { DeletionRequest } from "@fnb/zalo-mini/loyalty";
import type { DataExport } from "@fnb/zalo-mini/ordering";
import { kitButton, Popup, useI18n } from "@fnb/zalo-mini/react";
import { useId, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useCustomerData } from "../data/customer-data";
import { addDays, isoDateIn, shownDate } from "../data/dates";
import { useLegalPopup } from "../legal/legal-popups";
import { DeletionState } from "../settings/settings-screen";
import { CheckControl } from "../ui";
import { ExportView, exportText } from "./data-export";
import { openOrders } from "./order-view";
import { useOrdering } from "./ordering-data";
import {
	ChevronRight,
	clock,
	FlowBack,
	kicker,
	Notice,
	Panel,
	Problem,
	ShieldIcon,
	TrashIcon,
} from "./parts";
import { SavedCompaniesPanel } from "./saved-companies";
import { useStampCard } from "./stamp-card";
import { forgetStampCode } from "./stamp-code";

// C19 Chính sách dữ liệu và xóa tài khoản (missing-screens README 5.8; native-till.md 16.6): what the shop keeps, why
// and for how long, what it never keeps, the customer's rights, a copy of everything held shown in the app, and
// deleting the account with an honest list of what goes and what the law keeps. A login that never joined with a phone
// is deleted at once (customer_delete_account); a member's deletion goes through the request the owner carries out
// (customer_request_deletion). An open order or a refund owed blocks the deletion, and the screen says which.

type Step = "summary" | "export" | "delete" | "deleted";

const SUMMARY = ["name", "phone", "orders", "stamps", "company"] as const;

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

const row =
	"flex min-h-14 w-full items-center gap-3 px-4 py-3 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus";

function Rights({
	onDelete,
	onExport,
}: {
	readonly onDelete: () => void;
	readonly onExport: () => void;
}) {
	const { t } = useI18n();
	const { open, popup } = useLegalPopup();
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
						onClick={onExport}
						data-testid="data-export"
					>
						<ShieldIcon />
						<span className="flex min-w-0 flex-1 flex-col">
							<span className="text-[15px] font-bold text-ink">
								{t("data.copy")}
							</span>
							<span className="text-[13px] text-ink-muted">
								{t("dataExport.rowSub")}
							</span>
						</span>
						<ChevronRight />
					</button>
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
					{(["complain", "marketing"] as const).map((item) => (
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

/** "Tải bản sao dữ liệu": the copy of everything held, shown section by section, and copied as one JSON text. */
function ExportStep() {
	const { t } = useI18n();
	const { client } = useOrdering();
	const { recover } = useCustomerData();
	const [data, setData] = useState<DataExport | null>(null);
	const [state, setState] = useState<"idle" | "loading" | "failed">("idle");
	const [copied, setCopied] = useState<"done" | "failed" | null>(null);
	const load = () => {
		if (client === null) return;
		setState("loading");
		client.exportData().then(
			(answer) => {
				setData(answer);
				setState("idle");
			},
			(error: unknown) => {
				recover(error);
				setState("failed");
			},
		);
	};
	const copy = () => {
		if (data === null) return;
		const clipboard =
			typeof navigator === "undefined" ? undefined : navigator.clipboard;
		if (clipboard === undefined) {
			setCopied("failed");
			return;
		}
		clipboard.writeText(exportText(data)).then(
			() => setCopied("done"),
			() => setCopied("failed"),
		);
	};
	return (
		<section className="flex flex-col gap-4" data-testid="data-export-step">
			<p className="text-body text-ink">{t("dataExport.intro")}</p>
			<Notice testId="data-export-how">{t("dataExport.noFile")}</Notice>
			{data === null ? (
				<>
					{state === "failed" ? (
						<Problem testId="data-export-failed">
							{t("dataExport.failed")}
						</Problem>
					) : null}
					<button
						type="button"
						className={`${kitButton.primary} w-full`}
						onClick={load}
						disabled={state === "loading" || client === null}
						aria-busy={state === "loading"}
						data-testid="data-export-load"
					>
						{state === "loading"
							? t("dataExport.loading")
							: t("dataExport.show")}
					</button>
				</>
			) : (
				<>
					<button
						type="button"
						className={`${kitButton.primary} w-full`}
						onClick={copy}
						data-testid="data-export-copy"
					>
						{t("dataExport.copy")}
					</button>
					{copied === null ? null : (
						<p
							role="status"
							className="text-body text-ink"
							data-testid="data-export-copied"
						>
							{copied === "done"
								? t("dataExport.copied")
								: t("dataExport.copyFailed")}
						</p>
					)}
					<ExportView data={data} />
				</>
			)}
		</section>
	);
}

type DeleteRefusal =
	| "open_orders"
	| "refund_pending"
	| "member_request"
	| "other";

function DeleteStep({
	onKeep,
	onDeleted,
}: {
	readonly onKeep: () => void;
	readonly onDeleted: (at: string) => void;
}) {
	const { t } = useI18n();
	const navigate = useNavigate();
	const { member, client, rememberDeletion, deletion, recover } =
		useCustomerData();
	const ordering = useOrdering();
	const { orders } = ordering;
	const { load } = useStampCard();
	const [confirming, setConfirming] = useState(false);
	const [understood, setUnderstood] = useState(false);
	const [sending, setSending] = useState(false);
	const [failed, setFailed] = useState(false);
	const [sent, setSent] = useState<DeletionRequest | null>(null);
	const [refused, setRefused] = useState<{
		readonly refusal: DeleteRefusal;
		readonly orders: number;
	} | null>(null);
	const checkId = useId();
	const open = orders.status === "ready" ? openOrders(orders.data.orders) : [];
	const stamps = load.status === "ready" ? load.card.stamps : 0;
	const shown = sent ?? deletion;
	// a member's deletion is a request the owner carries out; a visitor's login goes at once
	const submitRequest = () => {
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
	const deleteNow = () => {
		const orderingClient = ordering.client;
		if (orderingClient === null) return;
		setSending(true);
		setFailed(false);
		orderingClient.deleteAccount().then(
			(answer) => {
				setSending(false);
				setConfirming(false);
				if (answer.state === "deleted") {
					forgetStampCode(orderingClient);
					onDeleted(answer.deletedAt);
					return;
				}
				setRefused({
					refusal:
						answer.refusal === "open_orders" ||
						answer.refusal === "refund_pending" ||
						answer.refusal === "member_request"
							? answer.refusal
							: "other",
					orders: answer.orders ?? 0,
				});
			},
			(error: unknown) => {
				setSending(false);
				recover(error);
				setFailed(true);
			},
		);
	};
	const blockedCount =
		refused?.refusal === "open_orders" ? refused.orders : open.length;
	return (
		<section className="flex flex-col gap-4" data-testid="data-delete-step">
			<p className="text-body text-ink">{t("data.deleteIntro")}</p>
			<Panel testId="data-will-delete">
				<h2 className={kicker}>{t("data.willDelete")}</h2>
				<ul className="flex list-disc flex-col gap-1 pl-5 text-body text-ink">
					{(["name", "phone", "stamps", "companies", "consents"] as const).map(
						(item) => (
							<li key={item}>{t(`data.delete.${item}`)}</li>
						),
					)}
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
			) : blockedCount > 0 ? (
				<Problem testId="data-blocked">
					{t("data.blocked", { count: blockedCount })}
					{open[0] === undefined ? null : (
						<button
							type="button"
							className={`${kitButton.secondary} mt-3 w-full`}
							onClick={() => navigate(`/don/${open[0]?.id ?? ""}`)}
						>
							{t("data.blockedOpen")}
						</button>
					)}
				</Problem>
			) : refused?.refusal === "refund_pending" ? (
				<Problem testId="data-refund-owed">
					{t("dataDelete.refundOwed", { count: refused.orders })}
				</Problem>
			) : refused?.refusal === "member_request" ? (
				<Notice testId="data-member-request">
					{t("dataDelete.memberRequest")}
				</Notice>
			) : refused?.refusal === "other" ? (
				<Problem testId="data-delete-refused">
					{t("dataDelete.refused")}
				</Problem>
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
						<p className="text-body text-ink">
							{member ? t("data.confirmBody") : t("dataDelete.confirmNow")}
						</p>
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
								{t(member ? "data.failed" : "dataDelete.failed")}
							</p>
						) : null}
						<button
							type="button"
							className={`${kitButton.danger} w-full`}
							disabled={!understood || sending}
							aria-busy={sending}
							onClick={member ? submitRequest : deleteNow}
							data-testid="data-confirm-delete"
						>
							<TrashIcon />
							{sending
								? t(member ? "data.sending" : "dataDelete.deleting")
								: t("data.confirm")}
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

/** Frame 6: the login is gone; when, when the backups are cleared, what the law keeps; then a fresh start. */
function Deleted({ at }: { readonly at: string }) {
	const { t } = useI18n();
	const navigate = useNavigate();
	const { startOver, session } = useCustomerData();
	// the session of the deleted login: the app may already have signed in again as a new visitor meanwhile
	const deletedToken = useRef(session?.accessToken ?? null);
	const day = isoDateIn(Date.parse(at));
	return (
		<section
			className="flex flex-col gap-4"
			data-testid="data-deleted"
			aria-labelledby="data-deleted-title"
		>
			<h2 id="data-deleted-title" className="text-xl font-bold text-ink">
				{t("dataDelete.doneTitle")}
			</h2>
			<p className="text-body text-ink">{t("dataDelete.doneBody")}</p>
			<Panel testId="data-deleted-facts">
				<ul className="flex flex-col divide-y divide-line text-body text-ink">
					<li className="py-2 first:pt-0">
						{t("dataDelete.doneAt", { time: clock(at), date: shownDate(day) })}
					</li>
					<li className="py-2">
						{t("dataDelete.backups", { date: shownDate(addDays(day, 30)) })}
					</li>
					<li className="py-2 last:pb-0">{t("dataDelete.invoices")}</li>
				</ul>
			</Panel>
			<button
				type="button"
				className={`${kitButton.primary} w-full`}
				onClick={() => {
					if (session?.accessToken === deletedToken.current) startOver();
					navigate("/thuc-don");
				}}
				data-testid="data-deleted-menu"
			>
				{t("dataDelete.toMenu")}
			</button>
		</section>
	);
}

export function DataPolicyScreen() {
	const { t } = useI18n();
	const [step, setStep] = useState<Step>("summary");
	const [deletedAt, setDeletedAt] = useState<string | null>(null);
	return (
		<section
			className="flex flex-col gap-4 px-4 py-4"
			data-testid="data-policy-screen"
			data-step={step}
		>
			{step === "deleted" ? null : <FlowBack />}
			{step === "deleted" ? null : (
				<h1 className="text-xl font-bold text-ink">
					{step === "summary"
						? t("data.title")
						: step === "export"
							? t("data.copy")
							: t("data.delete")}
				</h1>
			)}
			{step === "summary" ? (
				<>
					<p className="text-body text-ink">{t("data.intro")}</p>
					<Summary />
					<Notice testId="data-not-stored">{t("data.notStored")}</Notice>
					<SavedCompaniesPanel />
					<Rights
						onDelete={() => setStep("delete")}
						onExport={() => setStep("export")}
					/>
				</>
			) : step === "export" ? (
				<>
					<ExportStep />
					<button
						type="button"
						className={`${kitButton.secondary} w-full`}
						onClick={() => setStep("summary")}
					>
						{t("dataExport.back")}
					</button>
				</>
			) : step === "delete" ? (
				<DeleteStep
					onKeep={() => setStep("summary")}
					onDeleted={(at) => {
						setDeletedAt(at);
						setStep("deleted");
					}}
				/>
			) : (
				<Deleted at={deletedAt ?? new Date().toISOString()} />
			)}
		</section>
	);
}
