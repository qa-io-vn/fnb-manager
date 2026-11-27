import { useI18n } from "@fnb/zalo-mini/i18n";
import {
	COMPANY_FIELDS,
	type Company,
	type CompanyField,
	type CompanyInput,
	checkCompany,
	type InvoiceRequest,
} from "@fnb/zalo-mini/ordering";
import { StatusPill } from "@fnb/zalo-mini/ui-kit";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useId, useRef, useState } from "react";
import { RpcError } from "../lib/rpc";
import { useSession } from "../lib/session";
import { clockOf } from "../lib/time";
import { Dialog } from "../ui/dialog";
import { AlertIcon, CheckIcon, ReceiptIcon } from "../ui/icons";
import { button, card, field, PlainNote } from "../ui/kit";
import { useToast } from "../ui/toast";
import {
	type CounterEInvoice,
	companyRowOpen,
	counterProblem,
	counterRefusalKey,
	EMPTY_INPUT,
	INPUT_KEYS,
	orderEInvoice,
	PILL_TONE,
	requestCompanyInvoice,
	stillMoving,
} from "./einvoice";
import type { Order } from "./types";

// Q01's e-invoice on the counter: the pill of an order ("Đang xuất…", "Đã xuất", "Chưa xuất được. Hệ thống tự thử lại,
// đơn vẫn hoàn tất."), read with the order and again every 15 seconds while the job may change it, the company
// invoice the order carries, and the company row for a counter order (the same fields and checks as C18). The server
// decides every state; a company typed here is checked again there.

/**
 * The query of an order's e-invoice: read again whenever the board sees a new version of the order, and when the
 * caller says something changed it (`refresh`: a company request sent while the first read was on its way).
 */
export function useOrderEInvoice(order: Order | null, refresh = 0) {
	const { client } = useSession();
	return useQuery({
		queryKey: [
			"einvoice",
			order?.id ?? "",
			order?.version ?? 0,
			order?.payment_status ?? "",
			refresh,
		],
		queryFn: () => orderEInvoice(client, order?.id ?? ""),
		enabled: order !== null && order.payment_status !== "unpaid",
		// the last answer stays on screen while a new version of the order is read (no flicker, an open form stays)
		placeholderData: (previous) =>
			previous?.orderId === order?.id ? previous : undefined,
		retry: (count, error) =>
			!(error instanceof RpcError && error.forbidden) && count < 1,
		refetchInterval: (query) =>
			stillMoving(query.state.data) ? 15_000 : false,
	});
}

export function EInvoicePill({
	einvoice,
}: {
	readonly einvoice: CounterEInvoice;
}) {
	const { t } = useI18n();
	const tone = PILL_TONE[einvoice.state];
	if (tone === null) return null;
	return (
		<StatusPill tone={tone} testId="einvoice-pill">
			{einvoice.state === "issued" ? (
				<span className="inline-flex items-center gap-1">
					<CheckIcon size={14} />
					{t("einvoice.pill.issued")}
				</span>
			) : (
				t(`einvoice.pill.${einvoice.state}`)
			)}
		</StatusPill>
	);
}

function pillLine(
	einvoice: CounterEInvoice,
	t: (key: string, params?: Record<string, string | number>) => string,
): string | null {
	switch (einvoice.state) {
		case "issued": {
			const issued = einvoice.invoice?.issuedAt ?? null;
			const time = issued === null ? "" : clockOf(issued);
			return einvoice.invoice?.invoiceNo === null ||
				einvoice.invoice?.invoiceNo === undefined
				? t("einvoice.line.issuedNoNumber", { time })
				: t("einvoice.line.issued", {
						number: einvoice.invoice.invoiceNo,
						time,
					});
		}
		case "pending":
		case "retrying":
		case "failed":
		case "cancelled":
			return t(`einvoice.line.${einvoice.state}`);
		default:
			return null;
	}
}

/** The company request an order carries: whose name, and how far it got. */
function RequestLine({ request }: { readonly request: InvoiceRequest }) {
	const { t } = useI18n();
	return (
		<div
			className="flex flex-col gap-0.5 rounded-card-xl bg-surface-sunken px-3 py-2"
			data-testid="einvoice-company"
			data-status={request.status}
		>
			<p className="text-sm font-bold">{t("einvoice.company")}</p>
			<p className="text-sm break-words">
				{t("einvoice.companyFor", {
					company: request.companyName,
					taxCode: request.taxCode,
				})}
			</p>
			<p className="text-sm text-ink-muted">
				{t(`einvoice.requestStatus.${request.status}`)}
			</p>
		</div>
	);
}

/**
 * The e-invoice card of an order (the order detail, the payment-confirmed state): the pill and its line, the company
 * request, and "Hóa đơn công ty" while a counter order may still take one.
 */
export function EInvoiceCard({
	order,
	testId = "einvoice-card",
	companyRow = true,
	refresh = 0,
}: {
	readonly order: Order;
	readonly testId?: string;
	/** whether the card offers the company row (not inside another dialog: the order detail offers it) */
	readonly companyRow?: boolean;
	/** a count the caller moves when it changed the e-invoice (a request sent after the payment) */
	readonly refresh?: number;
}) {
	const { t } = useI18n();
	const { client } = useSession();
	const queryClient = useQueryClient();
	const { show } = useToast();
	const einvoice = useOrderEInvoice(order, refresh);
	const [open, setOpen] = useState(false);
	const data = einvoice.data;
	if (order.payment_status === "unpaid" || data === undefined) return null;
	const line = pillLine(data, t);
	const showPill = PILL_TONE[data.state] !== null;
	const canAsk = companyRow && companyRowOpen(order, data);
	if (!showPill && data.request === null && !canAsk) return null;
	return (
		<section
			className={`${card} flex flex-col gap-2 p-4`}
			data-testid={testId}
			data-state={data.state}
			aria-labelledby={`${testId}-title`}
		>
			<div className="flex flex-wrap items-center gap-2">
				<h2 id={`${testId}-title`} className="flex-1 text-base font-extrabold">
					{t("einvoice.title")}
				</h2>
				<EInvoicePill einvoice={data} />
			</div>
			{line === null ? null : (
				<p className="text-sm" data-testid="einvoice-line">
					{line}
				</p>
			)}
			{data.state === "issued" && data.invoice?.lookupCode ? (
				<p className="text-sm text-ink-muted" data-testid="einvoice-lookup">
					{t("einvoice.lookup", { code: data.invoice.lookupCode })}
				</p>
			) : null}
			{data.replacing ? (
				<p className="text-sm text-ink-muted">{t("einvoice.replacing")}</p>
			) : null}
			{data.request === null ? null : <RequestLine request={data.request} />}
			{canAsk ? (
				<button
					type="button"
					className={`${button.secondary} min-h-12`}
					onClick={() => setOpen(true)}
					data-testid="company-open"
				>
					<ReceiptIcon />
					{t("company.open")}
				</button>
			) : null}
			{open ? (
				<CompanyDialog
					orderNo={order.display_no ?? ""}
					onClose={() => setOpen(false)}
					send={(requestId, company) =>
						requestCompanyInvoice(client, order.id, requestId, company)
					}
					onSent={() => {
						setOpen(false);
						show(t("company.sent", { order: order.display_no ?? "" }));
						void queryClient.invalidateQueries({
							queryKey: ["einvoice", order.id],
						});
					}}
				/>
			) : null}
		</section>
	);
}

type Sender = (
	requestId: string,
	company: Company,
) => ReturnType<typeof requestCompanyInvoice>;

/**
 * The company row's form (Q01, the same fields and checks as C18): a field in error says why under it, linked by
 * aria-describedby, with aria-invalid; "Gửi" moves the focus to the first one. With `send` the request goes at once
 * (one request id per opening, so a retry or a double tap makes one request); with `onHold` the company is kept for a
 * ticket and sent once the order is paid.
 */
export function CompanyDialog({
	orderNo,
	initial = EMPTY_INPUT,
	onClose,
	send,
	onSent,
	onHold,
}: {
	readonly orderNo: string;
	readonly initial?: CompanyInput;
	readonly onClose: () => void;
	readonly send?: Sender;
	readonly onSent?: () => void;
	readonly onHold?: (company: Company) => void;
}) {
	const { t } = useI18n();
	const id = useId();
	const [input, setInput] = useState<CompanyInput>(initial);
	const [touched, setTouched] = useState<ReadonlySet<CompanyField>>(new Set());
	const [serverFields, setServerFields] = useState<ReadonlySet<CompanyField>>(
		new Set(),
	);
	const [message, setMessage] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);
	const requestId = useRef(crypto.randomUUID());
	const sending = useRef(false);
	const inputs = useRef(new Map<CompanyField, HTMLInputElement>());
	const check = checkCompany(input);
	const problemOf = (name: CompanyField) =>
		touched.has(name)
			? (check.problems.find((problem) => problem.field === name) ?? null)
			: null;
	const words = (name: CompanyField): string | null => {
		const problem = problemOf(name);
		if (problem !== null) {
			const said = counterProblem(problem);
			return t(said.key, said.params);
		}
		return serverFields.has(name) ? t("company.error.server") : null;
	};
	const submit = () => {
		setTouched(new Set(COMPANY_FIELDS));
		const wrong = [
			...new Set([
				...check.problems.map((problem) => problem.field),
				...serverFields,
			]),
		];
		if (check.company === null || wrong.length > 0) {
			setMessage(t("company.formHasErrors", { count: wrong.length }));
			const first = COMPANY_FIELDS.find((name) => wrong.includes(name));
			if (first !== undefined) inputs.current.get(first)?.focus();
			return;
		}
		const company = check.company;
		if (onHold !== undefined) {
			onHold(company);
			return;
		}
		if (send === undefined || sending.current) return;
		sending.current = true;
		setBusy(true);
		setMessage(null);
		send(requestId.current, company).then(
			(answer) => {
				sending.current = false;
				setBusy(false);
				if (answer.state === "received") {
					onSent?.();
					return;
				}
				if (answer.refusal === "invalid") {
					setServerFields(new Set(answer.fields));
					const first = answer.fields[0];
					if (first !== undefined) inputs.current.get(first)?.focus();
				}
				if (answer.refusal === "request_conflict")
					requestId.current = crypto.randomUUID();
				setMessage(t(counterRefusalKey(answer.refusal)));
			},
			(error: unknown) => {
				sending.current = false;
				setBusy(false);
				// the same id goes with the next try: the server answers the first request if it was made
				setMessage(
					t(
						error instanceof RpcError && error.network
							? "common.network"
							: error instanceof RpcError && error.forbidden
								? "common.forbidden"
								: "common.failed",
					),
				);
			},
		);
	};
	const fieldOf = (
		name: CompanyField,
		label: string,
		extra: {
			readonly hint?: string;
			readonly inputMode?: "numeric" | "email";
			readonly autoComplete?: string;
		} = {},
	) => {
		const said = words(name);
		const inputId = `${id}-${name}`;
		const hintId = `${inputId}-hint`;
		const errorId = `${inputId}-error`;
		const describedBy = [
			extra.hint === undefined ? null : hintId,
			said === null ? null : errorId,
		]
			.filter((part) => part !== null)
			.join(" ");
		return (
			<div className="flex flex-col gap-1">
				<label htmlFor={inputId} className="font-bold">
					{label}
				</label>
				<input
					id={inputId}
					ref={(element) => {
						if (element === null) inputs.current.delete(name);
						else inputs.current.set(name, element);
					}}
					className={`${field} ${said === null ? "" : "border-2 border-negative"}`}
					value={input[INPUT_KEYS[name]]}
					inputMode={extra.inputMode}
					autoComplete={extra.autoComplete ?? "off"}
					spellCheck={false}
					aria-invalid={said !== null}
					aria-describedby={describedBy === "" ? undefined : describedBy}
					onChange={(event) => {
						const value = event.target.value;
						setInput((current) => ({ ...current, [INPUT_KEYS[name]]: value }));
						setServerFields((current) => {
							if (!current.has(name)) return current;
							const next = new Set(current);
							next.delete(name);
							return next;
						});
					}}
					onBlur={() => setTouched((current) => new Set([...current, name]))}
					data-testid={`company-${name}`}
					{...(name === "tax_code" ? { "data-autofocus": true } : {})}
				/>
				{extra.hint === undefined ? null : (
					<p id={hintId} className="text-sm text-ink-muted">
						{extra.hint}
					</p>
				)}
				<div aria-live="polite">
					{said === null ? null : (
						<p
							id={errorId}
							className="flex items-start gap-1 text-sm font-bold text-negative"
							data-testid={`company-${name}-error`}
						>
							<AlertIcon size={16} />
							<span>{said}</span>
						</p>
					)}
				</div>
			</div>
		);
	};
	return (
		<Dialog
			title={t("company.title")}
			onClose={onClose}
			closeLabel={t("common.close")}
			busy={busy}
			testId="company-dialog"
			footer={
				<button
					type="submit"
					form={`${id}-form`}
					className={`${button.primary} w-full sm:w-auto`}
					disabled={busy}
					aria-busy={busy}
					data-testid="company-submit"
				>
					{busy
						? t("company.sending")
						: onHold === undefined
							? t("company.submit")
							: t("company.hold")}
				</button>
			}
		>
			<form
				id={`${id}-form`}
				className="flex flex-col gap-3"
				noValidate
				onSubmit={(event) => {
					event.preventDefault();
					submit();
				}}
			>
				<p className="text-body">
					{onHold === undefined
						? t("company.lead", { order: orderNo })
						: t("company.leadTicket")}
				</p>
				<div className="grid gap-3 md:grid-cols-2">
					{fieldOf("tax_code", t("company.taxCode"), {
						hint: t("company.taxCodeHint"),
						inputMode: "numeric",
					})}
					{fieldOf("email", t("company.email"), {
						inputMode: "email",
						autoComplete: "email",
					})}
				</div>
				{fieldOf("company_name", t("company.name"))}
				{fieldOf("address", t("company.address"))}
				<p className="rounded-card-xl bg-warning-soft px-3 py-2 text-sm">
					{t("company.immutable")}
				</p>
				{message === null ? null : (
					<PlainNote tone="negative" testId="company-message">
						{message}
					</PlainNote>
				)}
			</form>
		</Dialog>
	);
}
