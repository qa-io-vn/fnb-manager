import { RestError } from "@fnb/zalo-mini";
import {
	COMPANY_FIELDS,
	type Company,
	type CompanyField,
	type CompanyInput,
	type CompanyProblem,
	checkCompany,
	type EInvoicePill,
	type InvoiceRequest,
	type InvoiceStatus,
	normalizeTaxCode,
	type SavedCompany,
} from "@fnb/zalo-mini/ordering";
import { ChipGroup, kitButton, PriceText, useI18n } from "@fnb/zalo-mini/react";
import {
	type ReactNode,
	useCallback,
	useEffect,
	useId,
	useRef,
	useState,
} from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useCustomerData } from "../data/customer-data";
import { isoDateIn, shownDate } from "../data/dates";
import { CheckControl, Failed, fieldClass, Loading } from "../ui";
import {
	EMPTY_COMPANY,
	FIELD_KEYS,
	inputOf,
	problemMessage,
	refusalKey,
	requestSteps,
	slowRequest,
} from "./company-invoice";
import { newRequestId, useOrdering } from "./ordering-data";
import {
	CheckIcon,
	clock,
	FlowBack,
	ListIcon,
	Notice,
	Panel,
	Problem,
	ShieldIcon,
} from "./parts";

// C18 Xin hóa đơn có mã số thuế công ty (missing-screens README 5.7; native-till.md 17.5; ADR-070), reached from an
// order of the history (C06 under C14) or the order a payment just paid, once customer_invoice_status allows it:
// 1 the form with the saved companies as chips, 2 the fields in error (each linked to its input), 3 the review with the
// warning that an invoice cannot be changed once issued, 4 "Đã nhận yêu cầu" with its three steps. An order that
// already has a request shows it read only; after the window it says so; a provider that keeps failing reads "slower
// than expected". The form's checks mirror the server's (checkCompany); the server checks everything again. One
// request id per attempt: a double tap, or a retry after a lost answer, sends the same id and makes one request. No
// tax code, name, address or email goes into an address, an attribute or a log.

type Load =
	| { readonly status: "loading" }
	| { readonly status: "failed" }
	| { readonly status: "ready"; readonly invoice: InvoiceStatus };

type Step = "form" | "review";

const NEW_COMPANY = "new";

function WarnIcon() {
	return (
		<svg
			aria-hidden="true"
			width="18"
			height="18"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth="2"
			strokeLinecap="round"
			strokeLinejoin="round"
			className="shrink-0"
		>
			<path d="M12 4l9 16H3zM12 10v4M12 17.5h.01" />
		</svg>
	);
}

function paidDay(invoice: InvoiceStatus & { readonly state: "known" }): string {
	return invoice.paidAt === null
		? ""
		: shownDate(isoDateIn(Date.parse(invoice.paidAt)));
}

/** The order the invoice is for: its number and payment day, the amount paid and the last day to ask. */
function OrderCard({
	invoice,
}: {
	readonly invoice: InvoiceStatus & { readonly state: "known" };
}) {
	const { t } = useI18n();
	return (
		<Panel testId="invoice-order">
			<div className="flex items-start gap-3">
				<span
					aria-hidden="true"
					className="flex size-11 shrink-0 items-center justify-center rounded-tile bg-surface-sunken text-highlight"
				>
					<ListIcon />
				</span>
				<div className="flex min-w-0 flex-col gap-0.5">
					<p className="text-[15px] font-bold text-ink">
						{t("invoice.order", {
							number: invoice.displayNo ?? "",
							date: paidDay(invoice),
						})}
					</p>
					<p className="text-[13px] text-ink">
						{t("invoice.orderPaid")}{" "}
						<PriceText amount={invoice.total} tone="ink" />
						{invoice.lastDay === null
							? null
							: ` · ${t("invoice.orderUntil", { date: shownDate(invoice.lastDay) })}`}
					</p>
				</div>
			</div>
		</Panel>
	);
}

function Field({
	field,
	label,
	value,
	placeholder,
	hint,
	problem,
	serverRefused,
	shownValid,
	inputMode,
	autoComplete,
	type = "text",
	inputRef,
	onChange,
	onBlur,
}: {
	readonly field: CompanyField;
	readonly label: string;
	readonly value: string;
	readonly placeholder?: string;
	readonly hint?: string;
	readonly problem: CompanyProblem | null;
	readonly serverRefused: boolean;
	readonly shownValid: boolean;
	readonly inputMode?: "numeric" | "email" | "text";
	readonly autoComplete?: string;
	readonly type?: "text" | "email";
	readonly inputRef: (element: HTMLInputElement | null) => void;
	readonly onChange: (value: string) => void;
	readonly onBlur: () => void;
}) {
	const { t } = useI18n();
	const id = useId();
	const hintId = `${id}-hint`;
	const errorId = `${id}-error`;
	const message =
		problem !== null
			? (() => {
					const words = problemMessage(problem);
					return t(words.key, words.params);
				})()
			: serverRefused
				? t("invoice.error.server")
				: null;
	const describedBy = [
		hint === undefined ? null : hintId,
		message === null ? null : errorId,
	]
		.filter((part) => part !== null)
		.join(" ");
	return (
		<div className="flex flex-col gap-1">
			<label htmlFor={id} className="text-[15px] font-bold text-ink">
				{label}
			</label>
			<div className="relative">
				<input
					id={id}
					ref={inputRef}
					type={type}
					value={value}
					placeholder={placeholder}
					inputMode={inputMode}
					autoComplete={autoComplete ?? "off"}
					spellCheck={false}
					aria-invalid={message !== null}
					aria-describedby={describedBy === "" ? undefined : describedBy}
					onChange={(event) => onChange(event.target.value)}
					onBlur={onBlur}
					className={`${fieldClass} pr-11 ${message === null ? "" : "border-2 border-negative"}`}
					data-testid={`invoice-${field}`}
				/>
				{message !== null ? (
					<span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-negative">
						<WarnIcon />
					</span>
				) : shownValid ? (
					<span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-positive">
						<CheckIcon />
					</span>
				) : null}
			</div>
			{hint === undefined ? null : (
				<p id={hintId} className="text-[13px] text-ink-muted">
					{hint}
				</p>
			)}
			<div aria-live="polite">
				{message === null ? null : (
					<p
						id={errorId}
						className="flex items-start gap-1 text-[13px] font-bold text-negative"
						data-testid={`invoice-${field}-error`}
					>
						<WarnIcon />
						<span>{message}</span>
					</p>
				)}
			</div>
		</div>
	);
}

/** Frames 1 and 2: the saved companies, the four fields, keeping the company for next time. */
function CompanyForm({
	companies,
	input,
	savedId,
	save,
	touched,
	serverFields,
	notice,
	onPick,
	onChange,
	onTouch,
	onSave,
	onReview,
	focusField,
	onFocused,
}: {
	readonly companies: readonly SavedCompany[];
	readonly input: CompanyInput;
	readonly savedId: string | null;
	readonly save: boolean;
	readonly touched: ReadonlySet<CompanyField>;
	readonly serverFields: ReadonlySet<CompanyField>;
	readonly notice: ReactNode;
	readonly onPick: (company: SavedCompany | null) => void;
	readonly onChange: (field: CompanyField, value: string) => void;
	readonly onTouch: (field: CompanyField) => void;
	readonly onSave: (save: boolean) => void;
	readonly onReview: () => void;
	/** a field to take the focus (the first in error), once */
	readonly focusField: CompanyField | null;
	readonly onFocused: () => void;
}) {
	const { t } = useI18n();
	const saveId = useId();
	const inputs = useRef(new Map<CompanyField, HTMLInputElement>());
	useEffect(() => {
		if (focusField === null) return;
		inputs.current.get(focusField)?.focus();
		onFocused();
	}, [focusField, onFocused]);
	const problems = checkCompany(input).problems;
	const problemOf = (field: CompanyField) =>
		touched.has(field)
			? (problems.find((problem) => problem.field === field) ?? null)
			: null;
	const refusedOf = (field: CompanyField) =>
		serverFields.has(field) &&
		!problems.some((problem) => problem.field === field);
	const validOf = (field: CompanyField) =>
		touched.has(field) &&
		!problems.some((problem) => problem.field === field) &&
		!serverFields.has(field);
	const field = (name: CompanyField) => ({
		field: name,
		value: input[FIELD_KEYS[name]],
		problem: problemOf(name),
		serverRefused: refusedOf(name),
		shownValid: validOf(name),
		inputRef: (element: HTMLInputElement | null) => {
			if (element === null) inputs.current.delete(name);
			else inputs.current.set(name, element);
		},
		onChange: (value: string) => onChange(name, value),
		onBlur: () => onTouch(name),
	});
	return (
		<form
			className="flex flex-col gap-4"
			data-testid="company-invoice-form"
			noValidate
			onSubmit={(event) => {
				event.preventDefault();
				onReview();
			}}
		>
			{companies.length === 0 ? null : (
				<div className="-mx-4 flex flex-col gap-1">
					<p
						className="px-4 text-[15px] font-bold text-ink"
						id={`${saveId}-companies`}
					>
						{t("invoice.companies")}
					</p>
					<ChipGroup
						label={t("invoice.companies")}
						chips={[
							...companies.map((company) => ({
								key: company.id,
								label: `${company.companyName} · ${company.taxCode}`,
							})),
							{ key: NEW_COMPANY, label: t("invoice.newCompany") },
						]}
						selected={savedId ?? NEW_COMPANY}
						onSelect={(key) =>
							onPick(companies.find((company) => company.id === key) ?? null)
						}
						testId="invoice-companies"
					/>
				</div>
			)}
			<Field
				{...field("tax_code")}
				label={t("invoice.taxCode")}
				placeholder={t("invoice.taxCodePlaceholder")}
				hint={t("invoice.taxCodeHint")}
				inputMode="numeric"
			/>
			<Field
				{...field("company_name")}
				label={t("invoice.companyName")}
				placeholder={t("invoice.companyNamePlaceholder")}
				autoComplete="organization"
			/>
			<Field
				{...field("address")}
				label={t("invoice.address")}
				placeholder={t("invoice.addressPlaceholder")}
				autoComplete="street-address"
			/>
			<Field
				{...field("email")}
				label={t("invoice.email")}
				hint={t("invoice.emailHint")}
				inputMode="email"
				type="email"
				autoComplete="email"
			/>
			{savedId === null ? (
				<div className="flex items-start gap-3">
					<CheckControl
						id={saveId}
						kind="checkbox"
						checked={save}
						disabled={false}
						describedBy={`${saveId}-sub`}
						testId="invoice-save"
						onChange={onSave}
					/>
					<span className="flex flex-col pt-2">
						<label htmlFor={saveId} className="text-[15px] font-bold text-ink">
							{t("invoice.save")}
						</label>
						<span id={`${saveId}-sub`} className="text-[13px] text-ink-muted">
							{t("invoice.saveSub")}
						</span>
					</span>
				</div>
			) : null}
			{notice}
			<button
				type="submit"
				className={`${kitButton.primary} w-full`}
				data-testid="invoice-review"
			>
				{t("invoice.review")}
			</button>
		</form>
	);
}

/** Frame 3: what will be on the invoice, the warning that it cannot be changed, and the send. */
function Review({
	company,
	busy,
	notice,
	onSend,
	onEdit,
}: {
	readonly company: Company;
	readonly busy: boolean;
	readonly notice: ReactNode;
	readonly onSend: () => void;
	readonly onEdit: () => void;
}) {
	const { t } = useI18n();
	return (
		<div className="flex flex-col gap-4" data-testid="company-invoice-review">
			<CompanyList company={company} taxCodeOk />
			<div
				className="flex items-start gap-2 rounded-card bg-warning-soft px-4 py-3 text-body text-ink"
				data-testid="invoice-immutable"
			>
				<WarnIcon />
				<p>
					<strong>{t("invoice.immutable")}</strong> {t("invoice.immutableBody")}
				</p>
			</div>
			<p className="flex items-center gap-2 text-[13px] text-ink-muted">
				<ShieldIcon />
				{t("invoice.onlyUse")}
			</p>
			{notice}
			<button
				type="button"
				className={`${kitButton.primary} w-full`}
				onClick={onSend}
				disabled={busy}
				aria-busy={busy}
				data-testid="invoice-send"
			>
				{busy ? t("invoice.sending") : t("invoice.send")}
			</button>
			<button
				type="button"
				className={`${kitButton.quiet} self-center`}
				onClick={onEdit}
				disabled={busy}
				data-testid="invoice-edit"
			>
				{t("invoice.edit")}
			</button>
		</div>
	);
}

/** The company as it goes on the invoice: a definition list (the review and the read-only status). */
function CompanyList({
	company,
	taxCodeOk = false,
}: {
	readonly company: Company;
	readonly taxCodeOk?: boolean;
}) {
	const { t } = useI18n();
	const rows: readonly [string, string, string][] = [
		["tax_code", t("invoice.taxCode"), company.taxCode],
		["company_name", t("invoice.companyName"), company.companyName],
		["address", t("invoice.address"), company.address],
		["email", t("invoice.email"), company.email],
	];
	return (
		<Panel testId="invoice-company">
			<dl className="flex flex-col divide-y divide-line">
				{rows.map(([key, label, value]) => (
					<div
						key={key}
						className="flex flex-col gap-0.5 py-2 first:pt-0 last:pb-0"
					>
						<dt className="text-[13px] font-bold text-ink-muted">{label}</dt>
						<dd
							className="text-[15px] font-bold break-words text-ink"
							data-testid={`invoice-value-${key}`}
						>
							{value}
							{key === "tax_code" && taxCodeOk ? " " : null}
							{key === "tax_code" && taxCodeOk ? (
								<span className="ml-1 inline-flex items-center gap-1 text-[13px] font-normal text-positive">
									<CheckIcon />
									{t("invoice.taxCodeOk")}
								</span>
							) : null}
						</dd>
					</div>
				))}
			</dl>
		</Panel>
	);
}

/** Frame 4 and the read-only status: the three steps, the slow provider, the replaced sale invoice. */
function RequestView({
	request,
	pill,
	fresh,
}: {
	readonly request: InvoiceRequest;
	readonly pill: EInvoicePill | null;
	readonly fresh: boolean;
}) {
	const { t } = useI18n();
	const navigate = useNavigate();
	const titleRef = useRef<HTMLHeadingElement>(null);
	useEffect(() => {
		titleRef.current?.focus();
	}, []);
	const steps = requestSteps(request);
	const slow = slowRequest(request, pill);
	const saleNumber =
		pill?.invoice?.kind === "sale" ? pill.invoice.invoiceNo : null;
	const when = (at: string) =>
		`${clock(at)} · ${shownDate(isoDateIn(Date.parse(at)))}`;
	return (
		<section
			className="flex flex-col gap-4"
			data-testid="company-invoice-status"
			data-status={request.status}
			data-fresh={fresh}
		>
			<div className="flex flex-col items-center gap-3 text-center">
				<span
					aria-hidden="true"
					className="flex size-18 items-center justify-center rounded-full bg-positive-soft text-positive"
				>
					<CheckIcon />
				</span>
				<h1
					ref={titleRef}
					tabIndex={-1}
					className="text-[22px] font-bold text-ink"
				>
					{fresh ? t("invoice.received") : t("invoice.requested")}
				</h1>
				<p className="text-body text-ink" data-testid="invoice-received-body">
					{t("invoice.receivedBody", {
						company: request.companyName,
						email: request.email,
					})}
				</p>
			</div>
			<Panel testId="invoice-steps">
				<h2 className="sr-only">{t("invoice.steps")}</h2>
				<ol className="flex flex-col gap-3">
					{steps.map((step) => (
						<li
							key={step.key}
							className="flex items-start gap-3"
							data-testid="invoice-step"
							data-step={step.key}
							data-state={step.state}
							aria-current={step.state === "current" ? "step" : undefined}
						>
							<span
								aria-hidden="true"
								className={`flex size-7 shrink-0 items-center justify-center rounded-full border-2 ${step.state === "done" ? "border-positive bg-positive text-surface-raised" : step.state === "current" ? "border-accent bg-surface-raised" : "border-line-strong bg-surface-raised"}`}
							>
								{step.state === "done" ? <CheckIcon /> : null}
							</span>
							<span className="flex flex-col">
								<span
									className={`text-[15px] ${step.state === "todo" ? "text-ink-muted" : "font-bold text-ink"}`}
								>
									{t(
										step.key === "issuing" && step.state === "done"
											? "invoice.step.issued"
											: `invoice.step.${step.key}`,
									)}
								</span>
								<span className="text-[13px] text-ink-muted">
									{step.state === "done" && step.at !== null
										? when(step.at)
										: step.key === "issuing" && step.state === "current"
											? t(slow ? "invoice.slow" : "invoice.step.issuingSub")
											: step.key === "emailed"
												? t("invoice.step.emailedSub")
												: null}
								</span>
							</span>
						</li>
					))}
				</ol>
			</Panel>
			{slow ? <Notice testId="invoice-slow">{t("invoice.slow")}</Notice> : null}
			{request.status === "cancelled" ? (
				<Notice testId="invoice-cancelled">{t("invoice.cancelled")}</Notice>
			) : null}
			<p
				className="flex items-start gap-2 rounded-card bg-surface-sunken px-4 py-3 text-body text-ink"
				data-testid="invoice-replaces"
			>
				<ListIcon />
				<span>
					{saleNumber === null
						? t("invoice.replacesNoNumber")
						: t("invoice.replaces", { number: `#${saleNumber}` })}
				</span>
			</p>
			{fresh ? null : (
				<CompanyList
					company={{
						taxCode: request.taxCode,
						companyName: request.companyName,
						address: request.address,
						email: request.email,
					}}
				/>
			)}
			<button
				type="button"
				className={`${kitButton.primary} w-full`}
				onClick={() => navigate("/don-hang")}
				data-testid="invoice-to-orders"
			>
				{t("invoice.toOrders")}
			</button>
		</section>
	);
}

function Missing() {
	const { t } = useI18n();
	const navigate = useNavigate();
	return (
		<section className="flex flex-col gap-4" data-testid="invoice-missing">
			<Problem testId="invoice-missing-note">{t("order.missing")}</Problem>
			<button
				type="button"
				className={`${kitButton.primary} w-full`}
				onClick={() => navigate("/don-hang")}
			>
				{t("order.toOrders")}
			</button>
		</section>
	);
}

/** The asking itself: the form, the review and the send, for an order the server allows. */
function Ask({
	invoice,
	companies,
	onReceived,
	onRefused,
	reloadCompanies,
}: {
	readonly invoice: InvoiceStatus & { readonly state: "known" };
	readonly companies: readonly SavedCompany[];
	readonly onReceived: (request: InvoiceRequest, fresh: boolean) => void;
	readonly onRefused: (refusal: string, lastDay: string | null) => void;
	readonly reloadCompanies: () => void;
}) {
	const { t } = useI18n();
	const { client } = useOrdering();
	const { recover } = useCustomerData();
	const titleRef = useRef<HTMLHeadingElement>(null);
	const [step, setStep] = useState<Step>("form");
	const [input, setInput] = useState<CompanyInput>(EMPTY_COMPANY);
	const [savedId, setSavedId] = useState<string | null>(null);
	const [save, setSave] = useState(true);
	const [touched, setTouched] = useState<ReadonlySet<CompanyField>>(new Set());
	const [serverFields, setServerFields] = useState<ReadonlySet<CompanyField>>(
		new Set(),
	);
	const [problem, setProblem] = useState<{
		readonly key: string;
		readonly params?: Readonly<Record<string, string>>;
	} | null>(null);
	const [busy, setBusy] = useState(false);
	// one request id per attempt: made when the review opens, kept for every send of it (a retry replays it)
	const attempt = useRef<string | null>(null);
	const sending = useRef(false);
	// the field to focus once the form shows it (the first in error); the title takes the focus otherwise
	const [focusField, setFocusField] = useState<CompanyField | null>(null);
	const focused = useCallback(() => setFocusField(null), []);
	const focusPending = useRef(false);
	focusPending.current = focusField !== null;

	useEffect(() => {
		void step;
		if (!focusPending.current) titleRef.current?.focus();
	}, [step]);

	const check = checkCompany(input);
	const pick = (company: SavedCompany | null) => {
		setProblem(null);
		setServerFields(new Set());
		if (company === null) {
			setSavedId(null);
			setInput(EMPTY_COMPANY);
			setTouched(new Set());
			return;
		}
		setSavedId(company.id);
		setInput(inputOf(company));
		setTouched(new Set(COMPANY_FIELDS));
	};
	const change = (field: CompanyField, value: string) => {
		setInput((current) => ({ ...current, [FIELD_KEYS[field]]: value }));
		// a saved company that is changed becomes a company typed here
		setSavedId(null);
		setServerFields((current) => {
			if (!current.has(field)) return current;
			const next = new Set(current);
			next.delete(field);
			return next;
		});
		if (field === "tax_code" && normalizeTaxCode(value) !== null)
			setTouched((current) => new Set([...current, field]));
	};
	const review = () => {
		setTouched(new Set(COMPANY_FIELDS));
		const first = check.problems[0]?.field ?? [...serverFields][0];
		if (first !== undefined) {
			setProblem({
				key: "invoice.formHasErrors",
				params: {
					count: String(
						new Set([
							...check.problems.map((entry) => entry.field),
							...serverFields,
						]).size,
					),
				},
			});
			setFocusField(first);
			return;
		}
		setProblem(null);
		attempt.current = newRequestId();
		setStep("review");
	};
	const send = () => {
		const company = check.company;
		const requestId = attempt.current;
		if (client === null || company === null || requestId === null) return;
		if (sending.current) return;
		sending.current = true;
		setBusy(true);
		setProblem(null);
		client
			.requestInvoice(
				savedId === null
					? { requestId, orderId: invoice.orderId, save, company }
					: {
							requestId,
							orderId: invoice.orderId,
							save: true,
							savedCompany: savedId,
						},
			)
			.then(
				(answer) => {
					sending.current = false;
					setBusy(false);
					if (answer.state === "received") {
						if (answer.saved === true || savedId !== null) reloadCompanies();
						onReceived(answer.request, true);
						return;
					}
					switch (answer.refusal) {
						case "invalid":
							setServerFields(new Set(answer.fields));
							setTouched(new Set(COMPANY_FIELDS));
							setFocusField(answer.fields[0] ?? null);
							setProblem({ key: "invoice.error.serverForm" });
							setStep("form");
							return;
						case "already_requested":
							if (answer.request !== null) onReceived(answer.request, false);
							else onRefused("already_requested", null);
							return;
						case "unknown_order":
						case "window_passed":
						case "einvoice_off":
						case "not_paid":
						case "refunded":
						case "nothing_to_invoice":
							onRefused(answer.refusal, answer.lastDay);
							return;
						case "unknown_company":
							reloadCompanies();
							pick(null);
							setProblem({ key: refusalKey(answer.refusal) });
							setStep("form");
							return;
						case "request_conflict":
							attempt.current = newRequestId();
							setProblem({ key: refusalKey(answer.refusal) });
							return;
						case "rate_limited":
							setProblem({
								key: refusalKey(answer.refusal),
								params: {
									time: answer.retryAt === null ? "" : clock(answer.retryAt),
								},
							});
							return;
						default:
							setProblem({ key: refusalKey(answer.refusal) });
					}
				},
				(error: unknown) => {
					sending.current = false;
					setBusy(false);
					// the same id goes again with the next tap: the server answers the first request if it was made
					if (error instanceof RestError) recover(error);
					setProblem({ key: "invoice.network" });
				},
			);
	};
	const notice =
		problem === null ? null : (
			<Problem testId="invoice-problem">
				{t(problem.key, problem.params)}
			</Problem>
		);
	return (
		<>
			<h1
				ref={titleRef}
				tabIndex={-1}
				className="text-xl font-bold text-ink"
				data-testid="invoice-title"
			>
				{step === "form" ? t("invoice.title") : t("invoice.reviewTitle")}
			</h1>
			<OrderCard invoice={invoice} />
			{step === "form" ? (
				<CompanyForm
					companies={companies}
					input={input}
					savedId={savedId}
					save={save}
					touched={touched}
					serverFields={serverFields}
					notice={notice}
					onPick={pick}
					onChange={change}
					onTouch={(field) =>
						setTouched((current) => new Set([...current, field]))
					}
					onSave={setSave}
					onReview={review}
					focusField={focusField}
					onFocused={focused}
				/>
			) : check.company === null ? null : (
				<Review
					company={check.company}
					busy={busy}
					notice={notice}
					onSend={send}
					onEdit={() => {
						setProblem(null);
						attempt.current = null;
						setStep("form");
					}}
				/>
			)}
		</>
	);
}

export function CompanyInvoiceScreen() {
	const { t } = useI18n();
	const { id } = useParams();
	const { client } = useOrdering();
	const { recover } = useCustomerData();
	const [load, setLoad] = useState<Load>({ status: "loading" });
	const [companies, setCompanies] = useState<readonly SavedCompany[]>([]);
	const [shown, setShown] = useState<{
		readonly request: InvoiceRequest;
		readonly fresh: boolean;
	} | null>(null);
	const [refused, setRefused] = useState<{
		readonly refusal: string;
		readonly lastDay: string | null;
	} | null>(null);

	const reloadCompanies = useCallback(() => {
		if (client === null) return;
		client.savedCompanies().then(
			(answer) => setCompanies(answer.companies),
			() => undefined,
		);
	}, [client]);
	const reload = useCallback(() => {
		if (client === null || id === undefined) return;
		setLoad({ status: "loading" });
		client.invoiceStatus(id).then(
			(invoice) => setLoad({ status: "ready", invoice }),
			(error: unknown) => {
				// an id that is not an order's (a hand-made link) is an unknown order, and says nothing more
				if (error instanceof Error && !(error instanceof RestError)) {
					setLoad({
						status: "ready",
						invoice: { state: "unknown_order", orderId: "" },
					});
					return;
				}
				recover(error);
				setLoad({ status: "failed" });
			},
		);
		reloadCompanies();
	}, [client, id, recover, reloadCompanies]);
	useEffect(() => {
		reload();
	}, [reload]);

	let body: ReactNode;
	if (load.status === "loading") body = <Loading />;
	else if (load.status === "failed")
		body = <Failed failure="network" onRetry={reload} />;
	else {
		const invoice = load.invoice;
		const refusal =
			refused?.refusal ?? (invoice.state === "known" ? invoice.refusal : null);
		if (invoice.state === "unknown_order" || refusal === "unknown_order")
			body = <Missing />;
		else if (shown !== null)
			body = (
				<RequestView
					request={shown.request}
					pill={invoice.einvoice}
					fresh={shown.fresh}
				/>
			);
		else if (invoice.request !== null)
			body = (
				<RequestView
					request={invoice.request}
					pill={invoice.einvoice}
					fresh={false}
				/>
			);
		else if (refusal === "window_passed")
			body = (
				<>
					<h1 className="text-xl font-bold text-ink">{t("invoice.title")}</h1>
					<OrderCard
						invoice={{
							...invoice,
							lastDay: refused?.lastDay ?? invoice.lastDay,
						}}
					/>
					<Notice testId="invoice-late">{t("invoice.late")}</Notice>
				</>
			);
		else if (refusal !== null)
			body = (
				<>
					<h1 className="text-xl font-bold text-ink">{t("invoice.title")}</h1>
					<Notice testId="invoice-refused" data={{ refusal }}>
						{t(refusalKey(refusal))}
					</Notice>
				</>
			);
		else
			body = (
				<Ask
					invoice={invoice}
					companies={companies}
					reloadCompanies={reloadCompanies}
					onReceived={(request, fresh) => setShown({ request, fresh })}
					onRefused={(next, lastDay) => setRefused({ refusal: next, lastDay })}
				/>
			);
	}
	return (
		<section
			className="flex flex-col gap-4 px-4 py-4"
			data-testid="company-invoice-screen"
		>
			<FlowBack />
			{body}
		</section>
	);
}
