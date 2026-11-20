import { type PlanPublishInput, planRecord } from "@fnb/datapack";
import { useQueryClient } from "@tanstack/react-query";
import { type ReactNode, useId, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "../../components/ui/button";
import { cn } from "../../components/ui/cn";
import { TextLink } from "../../components/ui/text-link";
import { PACK_ID_SHOWN } from "../../datapack/pack-files";
import { type Translate, useLanguage, useT } from "../../i18n";
import type { Formatters } from "../../lib/format";
import { PlanMarkdown } from "../../plans/cite-plugin";
import {
	type CheckedPlan,
	checkPlan,
	findPack,
	issueLabel,
	issueListText,
	issueMessage,
	keepPack,
	type LoadedPack,
	type PlanIssueView,
	planPackId,
	readPackText,
} from "../../plans/paste-check";
import { PlanSourceError } from "../../plans/source";
import { canPublishPlans, usePlansContext } from "../../plans/use-plans";
import { controlClass } from "../../settings/forms/field";
import { useMembership } from "../../settings/queries";
import { PageHeading } from "../../shell/page-heading";
import { useFormatters } from "../../state/formatters";
import { useReadyTenantScope } from "../../state/tenant-scope";
import { FIELDSET } from "../exports/export-form";
import { PACK_TAB_PATH } from "../exports/paths";

export const SAVING_PHASE = "11b";

type CheckPhase =
	| { readonly kind: "idle" }
	| { readonly kind: "empty" }
	| { readonly kind: "checking" }
	| { readonly kind: "missing"; readonly planPackId: string | null }
	| {
			readonly kind: "checked";
			readonly checked: CheckedPlan;
			readonly serial: number;
	  };

type AttachState =
	| { readonly kind: "idle" }
	| { readonly kind: "reading" }
	| { readonly kind: "refused"; readonly codes: readonly string[] };

type CopyState = "idle" | "copied" | "manual";

export interface PlanPasteBoxProps {
	readonly formatters: Formatters;
	readonly now?: () => Date;
	readonly onSave?: ((checked: CheckedPlan) => void) | undefined;
	readonly saving?: boolean;
	readonly preview?: (checked: CheckedPlan) => ReactNode;
}

function shortId(packId: string): string {
	return packId.slice(0, PACK_ID_SHOWN);
}

function IssueItem({ issue }: { issue: PlanIssueView }) {
	const t = useT();
	const { language } = useLanguage();
	return (
		<li
			className={cn(
				"space-y-1 rounded-lg border p-3",
				issue.level === "error" ? "border-negative" : "border-line",
			)}
			data-code={issue.code}
			data-level={issue.level}
			data-line={issue.line ?? undefined}
		>
			<p className="text-sm">
				<span className="font-semibold">
					{t(`plans.result.level.${issue.level}`)}
				</span>
				{" · "}
				<span data-testid="plan-issue-line">{issueLabel(t, issue)}</span>
			</p>
			<p className="break-words" data-testid="plan-issue-message">
				{issueMessage(t, language, issue.code)}
			</p>
			<p className="break-words text-sm text-ink-muted">
				{t("plans.result.code", { code: issue.code })}
			</p>
			{issue.detail === null ? null : (
				<p
					className="break-words text-sm text-ink-muted"
					data-testid="plan-issue-detail"
				>
					{t("plans.result.detail", { detail: issue.detail })}
				</p>
			)}
			{issue.excerpt === null ? null : (
				<p className="whitespace-pre-wrap break-words rounded bg-surface-sunken px-2 py-1 font-mono text-sm">
					{issue.excerpt}
				</p>
			)}
		</li>
	);
}

function CheckedView({
	checked,
	formatters,
}: {
	checked: CheckedPlan;
	formatters: Formatters;
}) {
	const t = useT();
	const { language } = useLanguage();
	const titleId = useId();
	const issuesId = useId();
	const copyBoxId = useId();
	const [copy, setCopy] = useState<CopyState>("idle");
	const { lint, pack } = checked;
	const packShown = shortId(pack.packId);
	const listText = issueListText(t, language, checked, packShown);
	const copyList = async () => {
		try {
			if (typeof navigator.clipboard?.writeText !== "function") {
				throw new Error("no clipboard");
			}
			await navigator.clipboard.writeText(listText);
			setCopy("copied");
		} catch {
			setCopy("manual");
		}
	};
	return (
		<section
			aria-labelledby={titleId}
			className="space-y-3 rounded-xl border border-line bg-surface-raised p-4"
			data-testid="plan-result"
			data-ok={lint.ok ? "true" : "false"}
		>
			<h2 id={titleId} className="text-lg font-semibold">
				{t("plans.result.title")}
			</h2>
			<p
				className={cn(
					"font-medium",
					lint.ok ? "text-positive" : "text-negative",
				)}
				data-testid="plan-summary"
			>
				{lint.ok
					? t("plans.result.valid", {
							sections: formatters.count(checked.sections),
							initiatives: formatters.count(lint.summary.initiatives),
							citations: formatters.count(lint.summary.validCitations),
							kpis: formatters.count(lint.summary.kpis),
						})
					: t("plans.result.invalid", {
							errors: formatters.count(checked.errors),
							warnings: formatters.count(checked.warnings),
						})}
			</p>
			{lint.ok && checked.warnings > 0 ? (
				<p data-testid="plan-warnings">
					{t("plans.result.warnings", {
						warnings: formatters.count(checked.warnings),
					})}
				</p>
			) : null}
			<p className="text-sm" data-testid="plan-pack">
				{t("plans.pack.used", {
					pack: packShown,
					date: formatters.date(pack.pack.request.as_of),
				})}
			</p>
			{checked.planPackId !== null && checked.planPackId !== pack.packId ? (
				<p className="text-sm" data-testid="plan-pack-other">
					{t("plans.pack.other", {
						plan: shortId(checked.planPackId),
						pack: packShown,
					})}
				</p>
			) : null}
			{pack.pack.sample ? (
				<p
					className="rounded-lg border border-line bg-surface-sunken p-3 text-sm"
					data-testid="plan-sample"
				>
					{t("plans.pack.sample")}
				</p>
			) : null}
			{checked.issues.length === 0 ? null : (
				<section aria-labelledby={issuesId} className="space-y-2">
					<h3 id={issuesId} className="font-semibold">
						{t("plans.result.issues")}
					</h3>
					<p className="text-sm text-ink-muted">{t("plans.result.lineNote")}</p>
					<ul className="space-y-2" data-testid="plan-issues">
						{checked.issues.map((issue) => (
							<IssueItem
								key={`${issue.code}/${issue.line}/${issue.detail}`}
								issue={issue}
							/>
						))}
					</ul>
					<Button
						tone="secondary"
						onClick={() => void copyList()}
						data-testid="plan-copy"
					>
						{t("plans.result.copy")}
					</Button>
					<p
						role="status"
						aria-live="polite"
						className={copy === "manual" ? "text-negative" : undefined}
						data-testid="plan-copy-status"
					>
						{copy === "copied"
							? t("plans.result.copied")
							: copy === "manual"
								? t("plans.result.copyManual")
								: ""}
					</p>
					{copy === "manual" ? (
						<div className="space-y-1">
							<label htmlFor={copyBoxId} className="text-sm font-medium">
								{t("plans.result.copyBox")}
							</label>
							<textarea
								id={copyBoxId}
								readOnly
								rows={8}
								value={listText}
								onFocus={(event) => event.currentTarget.select()}
								className={cn(controlClass, "py-2")}
								data-testid="plan-copy-text"
							/>
						</div>
					) : null}
				</section>
			)}
			<details
				className="rounded-lg border border-line"
				data-testid="plan-normalized"
			>
				<summary className="flex min-h-11 cursor-pointer items-center px-3 font-medium">
					{t("plans.result.text")}
				</summary>
				<ol className="list-decimal space-y-0.5 py-2 pr-3 pl-12 font-mono text-sm">
					{checked.lines
						.map((text, index) => ({ text, number: index + 1 }))
						.map((line) => (
							<li key={line.number} className="whitespace-pre-wrap break-words">
								{line.text}
							</li>
						))}
				</ol>
			</details>
		</section>
	);
}

function MissingPack({
	planPackIdValue,
	attach,
	onFile,
}: {
	planPackIdValue: string | null;
	attach: AttachState;
	onFile: (file: File) => void;
}) {
	const t = useT();
	const input = useRef<HTMLInputElement>(null);
	return (
		<div
			className="space-y-3 rounded-xl border border-warning bg-warning-soft p-4"
			data-testid="plan-pack-missing"
			data-pack={planPackIdValue ?? undefined}
		>
			<p className="font-medium">
				{planPackIdValue === null
					? t("plans.pack.noId")
					: t("plans.pack.missing", { pack: shortId(planPackIdValue) })}
			</p>
			<p className="text-sm">{t("plans.pack.noBuild")}</p>
			<input
				ref={input}
				type="file"
				accept=".json,application/json"
				hidden
				onChange={(event) => {
					const file = event.currentTarget.files?.[0];
					event.currentTarget.value = "";
					if (file !== undefined) onFile(file);
				}}
				data-testid="plan-pack-file"
			/>
			<Button
				tone="secondary"
				disabled={attach.kind === "reading"}
				onClick={() => input.current?.click()}
				data-testid="plan-pack-attach"
			>
				{t("plans.pack.attach")}
			</Button>
			{attach.kind === "reading" ? (
				<p data-testid="plan-pack-reading">{t("plans.pack.reading")}</p>
			) : null}
			{attach.kind === "refused" ? (
				<div
					className="space-y-1 rounded-lg border border-negative bg-negative-soft p-3"
					data-testid="plan-pack-refused"
				>
					<p>{t("plans.pack.refused")}</p>
					<p className="break-words text-sm">
						{t("plans.pack.refusedCodes", { codes: attach.codes.join(", ") })}
					</p>
				</div>
			) : null}
		</div>
	);
}

function announcementOf(
	phase: CheckPhase,
	attach: AttachState,
	t: Translate,
	formatters: Formatters,
): string {
	if (attach.kind === "reading") return t("plans.pack.reading");
	if (attach.kind === "refused") return t("plans.pack.refused");
	switch (phase.kind) {
		case "checking":
			return t("plans.paste.checking");
		case "missing":
			return phase.planPackId === null
				? t("plans.pack.noId")
				: t("plans.pack.missing", { pack: shortId(phase.planPackId) });
		case "checked": {
			const { checked } = phase;
			return checked.lint.ok
				? t("plans.result.valid", {
						sections: formatters.count(checked.sections),
						initiatives: formatters.count(checked.lint.summary.initiatives),
						citations: formatters.count(checked.lint.summary.validCitations),
						kpis: formatters.count(checked.lint.summary.kpis),
					})
				: t("plans.result.invalid", {
						errors: formatters.count(checked.errors),
						warnings: formatters.count(checked.warnings),
					});
		}
		default:
			return "";
	}
}

export function PlanPasteBox({
	formatters,
	now = () => new Date(),
	onSave,
	saving = false,
	preview,
}: PlanPasteBoxProps) {
	const t = useT();
	const id = useId();
	const [text, setText] = useState("");
	const [phase, setPhase] = useState<CheckPhase>({ kind: "idle" });
	const [attach, setAttach] = useState<AttachState>({ kind: "idle" });
	const attached = useRef(new Map<string, LoadedPack>());
	const run = useRef(0);
	const checks = useRef(0);

	const lintAgainst = (
		value: string,
		pack: LoadedPack,
		planPackIdValue: string | null,
	) => {
		checks.current += 1;
		setPhase({
			kind: "checked",
			checked: checkPlan(value, pack, planPackIdValue),
			serial: checks.current,
		});
	};

	const check = async () => {
		const current = run.current + 1;
		run.current = current;
		setAttach({ kind: "idle" });
		if (text.trim() === "") {
			setPhase({ kind: "empty" });
			return;
		}
		const value = text;
		const packId = planPackId(value);
		if (packId === null) {
			setPhase({ kind: "missing", planPackId: null });
			return;
		}
		setPhase({ kind: "checking" });
		const pack = await findPack(packId, attached.current, now());
		if (run.current !== current) return;
		if (pack === null) {
			setPhase({ kind: "missing", planPackId: packId });
			return;
		}
		lintAgainst(value, pack, packId);
	};

	const attachFile = async (file: File) => {
		const current = run.current + 1;
		run.current = current;
		setAttach({ kind: "reading" });
		let read: Awaited<ReturnType<typeof readPackText>>;
		try {
			read = await readPackText(await file.text());
		} catch {
			read = { ok: false, codes: ["not_json"] };
		}
		if (run.current !== current) return;
		if (!read.ok) {
			setAttach({ kind: "refused", codes: read.codes });
			return;
		}
		attached.current.set(read.pack.packId, read.pack);
		keepPack(read.pack, now());
		setAttach({ kind: "idle" });
		lintAgainst(text, read.pack, planPackId(text));
	};

	const changeText = (value: string) => {
		setText(value);
		run.current += 1;
		setAttach({ kind: "idle" });
		setPhase({ kind: "idle" });
	};

	const checked = phase.kind === "checked" ? phase.checked : null;
	const canSave = checked?.lint.ok === true && onSave !== undefined;
	const saveNote =
		onSave === undefined
			? t("plans.paste.saveLater", { phase: SAVING_PHASE })
			: checked === null
				? t("plans.paste.saveFirst")
				: checked.lint.ok
					? null
					: t("plans.paste.saveBlocked");

	return (
		<div className="space-y-4" data-testid="plan-paste">
			<PageHeading
				title={t("plans.paste.title")}
				className="text-2xl font-semibold"
			/>
			<p>{t("plans.paste.intro")}</p>
			<p className="text-sm">
				{t("plans.paste.noPack")}{" "}
				<TextLink to={PACK_TAB_PATH}>{t("plans.paste.packLink")}</TextLink>
			</p>
			<form
				className={cn(FIELDSET, "space-y-3")}
				data-testid="plan-form"
				onSubmit={(event) => {
					event.preventDefault();
					void check();
				}}
			>
				<div className="flex min-w-0 flex-col gap-1">
					<label htmlFor={`${id}-plan`} className="font-semibold">
						{t("plans.paste.label")}
					</label>
					<p id={`${id}-hint`} className="text-sm text-ink-muted">
						{t("plans.paste.hint")}
					</p>
					<textarea
						id={`${id}-plan`}
						rows={12}
						value={text}
						spellCheck={false}
						aria-describedby={
							phase.kind === "empty" ? `${id}-hint ${id}-empty` : `${id}-hint`
						}
						aria-invalid={phase.kind === "empty" ? true : undefined}
						onChange={(event) => changeText(event.target.value)}
						className={cn(controlClass, "py-2 text-base")}
						data-testid="plan-text"
					/>
					{phase.kind === "empty" ? (
						<p
							id={`${id}-empty`}
							role="alert"
							className="text-sm font-medium text-negative"
							data-testid="plan-empty"
						>
							{t("plans.paste.empty")}
						</p>
					) : null}
				</div>
				<Button
					type="submit"
					disabled={phase.kind === "checking"}
					data-testid="plan-check"
				>
					{t("plans.paste.check")}
				</Button>
			</form>
			{phase.kind === "missing" ? (
				<MissingPack
					planPackIdValue={phase.planPackId}
					attach={attach}
					onFile={(file) => void attachFile(file)}
				/>
			) : null}
			{phase.kind !== "checked" ? null : (
				<CheckedView
					key={phase.serial}
					checked={phase.checked}
					formatters={formatters}
				/>
			)}
			{phase.kind === "checked" &&
			phase.checked.lint.ok &&
			preview !== undefined
				? preview(phase.checked)
				: null}
			<div className="space-y-1">
				<Button
					disabled={!canSave || saving}
					aria-describedby={saveNote === null ? undefined : `${id}-save`}
					onClick={() => {
						if (canSave && checked !== null) onSave?.(checked);
					}}
					data-testid="plan-save"
				>
					{t("plans.paste.save")}
				</Button>
				{saveNote === null ? null : (
					<p
						id={`${id}-save`}
						className="text-sm text-ink-muted"
						data-testid="plan-save-note"
					>
						{saveNote}
					</p>
				)}
			</div>
			<p className="sr-only" role="status" aria-live="polite">
				{announcementOf(phase, attach, t, formatters)}
			</p>
		</div>
	);
}

export type SaveState =
	| { readonly kind: "idle" }
	| { readonly kind: "saving" }
	| { readonly kind: "sample" }
	| { readonly kind: "denied" }
	| { readonly kind: "rejected"; readonly codes: string }
	| { readonly kind: "limited" }
	| { readonly kind: "failed" };

export function saveStateOf(error: unknown): SaveState {
	if (error instanceof PlanSourceError) {
		if (error.code === "42501") return { kind: "denied" };
		if (error.code === "22023") {
			const codes = error.details ?? "";
			return codes.includes("plan_rate_limited")
				? { kind: "limited" }
				: { kind: "rejected", codes };
		}
	}
	return { kind: "failed" };
}

export function publishInput(
	checked: CheckedPlan,
	demo: boolean,
): PlanPublishInput | null {
	const plan = checked.lint.plan;
	if (plan === null || !checked.lint.ok) return null;
	const pack = checked.pack.pack;
	if (pack.sample && !demo) return null;
	const record = planRecord(
		plan,
		pack.sample ? { ...pack, sample: false } : pack,
		checked.lint,
		"pasted",
	);
	return { ...record, p_data_pack: pack };
}

function SaveMessage({ state, t }: { state: SaveState; t: Translate }) {
	if (state.kind === "idle") return null;
	const text =
		state.kind === "saving"
			? t("plans.paste.saving")
			: state.kind === "sample"
				? t("plans.paste.samplePack")
				: state.kind === "denied"
					? t("plans.paste.scopeDenied")
					: state.kind === "rejected"
						? t("plans.paste.rejected", { codes: state.codes })
						: state.kind === "limited"
							? t("plans.paste.rateLimited")
							: t("plans.paste.saveFailed");
	return (
		<p
			role={state.kind === "saving" ? "status" : "alert"}
			data-testid="plan-save-result"
			data-state={state.kind}
		>
			{text}
		</p>
	);
}

export function PastePage() {
	const t = useT();
	const scope = useReadyTenantScope();
	const formatters = useFormatters(scope.tenant);
	const membership = useMembership();
	const context = usePlansContext();
	const navigate = useNavigate();
	const client = useQueryClient();
	const [state, setState] = useState<SaveState>({ kind: "idle" });
	const member =
		membership.status === "success" ? (membership.data ?? null) : null;
	const demo = context?.plans.kind === "demo";
	const save = async (checked: CheckedPlan) => {
		if (context === null) return;
		const input = publishInput(checked, demo);
		if (input === null) {
			setState({ kind: "sample" });
			return;
		}
		setState({ kind: "saving" });
		try {
			const outcome = await context.plans.publish(input);
			await client.invalidateQueries({ queryKey: ["plans"] });
			navigate(`/ke-hoach/${outcome.planId}`, {
				state: { alreadySaved: outcome.alreadyPublished, saved: true },
			});
		} catch (error) {
			setState(saveStateOf(error));
		}
	};
	return (
		<div className="space-y-3">
			<PlanPasteBox
				formatters={formatters}
				onSave={
					canPublishPlans(member) && context !== null
						? (checked) => void save(checked)
						: undefined
				}
				saving={state.kind === "saving"}
				preview={(checked) => (
					<section
						className="space-y-2 rounded-xl border border-line p-4"
						aria-label={t("plans.paste.preview")}
						data-testid="plan-preview"
					>
						<h2 className="text-lg font-semibold">
							{t("plans.paste.preview")}
						</h2>
						<PlanMarkdown
							content={checked.lint.normalized}
							pack={checked.pack.pack}
							formatters={formatters}
						/>
					</section>
				)}
			/>
			<SaveMessage state={state} t={t} />
			{demo ? (
				<p className="text-sm text-ink-muted" data-testid="plan-demo-note">
					{t("plans.paste.demoNote")}
				</p>
			) : null}
		</div>
	);
}
