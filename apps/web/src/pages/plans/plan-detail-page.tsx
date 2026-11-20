import {
	canonicalJson,
	type DataPack,
	lintPlan,
	sha256Hex,
} from "@fnb/datapack";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useId, useMemo, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { Button } from "../../components/ui/button";
import { cn } from "../../components/ui/cn";
import { TextLink } from "../../components/ui/text-link";
import { type Translate, useT } from "../../i18n";
import type { Formatters } from "../../lib/format";
import { PlanMarkdown } from "../../plans/cite-plugin";
import {
	formatKpiChange,
	formatKpiValue,
	reportLinkOf,
	storeSetKey,
} from "../../plans/display";
import { type KpiFollowUp, planFollowUp } from "../../plans/follow-up";
import type { PlanDetail, PlanSummary } from "../../plans/source";
import {
	canManagePlan,
	canReadPlans,
	type PlansContext,
	usePlansContext,
} from "../../plans/use-plans";
import { useMembership } from "../../settings/queries";
import type { Membership } from "../../settings/source";
import { PageHeading } from "../../shell/page-heading";
import { useFormatters } from "../../state/formatters";
import { useReadyTenantScope } from "../../state/tenant-scope";

export async function packIdMatches(pack: DataPack): Promise<boolean> {
	const text = canonicalJson({ ...pack, pack_id: "", generated_at: "" });
	return (await sha256Hex(text)) === pack.pack_id;
}

export function previousPlanOf(
	plan: PlanSummary,
	plans: readonly PlanSummary[],
): PlanSummary | null {
	const key = storeSetKey(plan.storeIds);
	const older = plans
		.filter(
			(other) =>
				other.id !== plan.id &&
				storeSetKey(other.storeIds) === key &&
				(other.createdAt < plan.createdAt ||
					(other.createdAt === plan.createdAt && other.id < plan.id)),
		)
		.sort((left, right) =>
			left.createdAt === right.createdAt
				? right.id.localeCompare(left.id)
				: right.createdAt.localeCompare(left.createdAt),
		);
	return older[0] ?? null;
}

function StatusChip({ kpi, t }: { kpi: KpiFollowUp; t: Translate }) {
	return (
		<span
			className="space-x-1"
			data-testid="kpi-status"
			data-status={kpi.status}
		>
			<span className="rounded-full border border-line px-2 text-sm font-medium">
				{t(`plans.status.${kpi.status}`)}
			</span>
			{kpi.withinBand ? (
				<span className="text-sm text-ink-muted">{t("plans.status.band")}</span>
			) : null}
		</span>
	);
}

interface KpiRowView {
	readonly kpi: KpiFollowUp;
	readonly label: string;
	readonly scope: string;
	readonly baseline: string;
	readonly target: string;
	readonly current: string;
	readonly change: string;
	readonly report: string | null;
}

export function kpiRowView(
	kpi: KpiFollowUp,
	formatters: Formatters,
	t: Translate,
	scopeLabel: (storeIds: readonly string[], scope: string) => string,
): KpiRowView {
	const dash = t("plans.detail.noValue");
	const baseline =
		formatKpiValue(formatters, kpi.metricId, kpi.kpi.baseline) ?? dash;
	const remeasured =
		kpi.baselineChanged && kpi.remeasured !== null
			? formatKpiValue(formatters, kpi.metricId, kpi.remeasured)
			: null;
	return {
		kpi,
		label: t(`metric.${kpi.metricId}.label` as Parameters<Translate>[0]),
		scope: scopeLabel(kpi.kpi.store_ids, kpi.kpi.scope),
		baseline: remeasured === null ? baseline : `${baseline} ≠ ${remeasured}`,
		target: formatKpiValue(formatters, kpi.metricId, kpi.kpi.target) ?? dash,
		current: formatKpiValue(formatters, kpi.metricId, kpi.current) ?? dash,
		change:
			formatKpiChange(
				formatters,
				kpi.metricId,
				kpi.kpi.baseline,
				kpi.current,
			) ?? dash,
		report: reportLinkOf(kpi.metricId, kpi.kpi.store_ids),
	};
}

function KpiTable({
	rows,
	dueOn,
	asOf,
	formatters,
}: {
	rows: readonly KpiRowView[];
	dueOn: string;
	asOf: string;
	formatters: Formatters;
}) {
	const t = useT();
	const headings = [
		t("plans.detail.col.metric"),
		t("plans.detail.col.scope"),
		t("plans.detail.col.baseline"),
		t("plans.detail.col.target", { date: formatters.date(dueOn) }),
		t("plans.detail.col.current", { date: formatters.date(asOf) }),
		t("plans.detail.col.change"),
		t("plans.detail.col.status"),
		t("plans.detail.col.report"),
	];
	const reportCell = (row: KpiRowView) =>
		row.report === null ? (
			t("plans.detail.noValue")
		) : (
			<TextLink to={row.report} className="inline-flex min-h-11 items-center">
				{row.label}
			</TextLink>
		);
	return (
		<>
			<div className="hidden overflow-x-auto md:block print:block">
				<table
					className="w-full text-left text-sm"
					data-testid="kpi-table"
					data-as-of={asOf}
				>
					<thead>
						<tr>
							{headings.map((heading) => (
								<th
									key={heading}
									scope="col"
									className="border-b border-line p-2"
								>
									{heading}
								</th>
							))}
						</tr>
					</thead>
					<tbody>
						{rows.map((row) => (
							<tr
								key={row.kpi.key}
								data-testid="kpi-row"
								data-metric={row.kpi.metricId}
							>
								<th
									scope="row"
									className="border-b border-line p-2 font-medium"
								>
									{row.label}
									<span className="block text-xs text-ink-muted">
										{row.kpi.metricId}
									</span>
								</th>
								<td className="border-b border-line p-2">{row.scope}</td>
								<td
									className="border-b border-line p-2"
									data-testid="kpi-baseline"
								>
									{row.baseline}
								</td>
								<td className="border-b border-line p-2">{row.target}</td>
								<td
									className="border-b border-line p-2"
									data-testid="kpi-current"
									data-value={
										row.kpi.current === null ? "" : String(row.kpi.current)
									}
								>
									{row.current}
								</td>
								<td className="border-b border-line p-2">{row.change}</td>
								<td className="border-b border-line p-2">
									<StatusChip kpi={row.kpi} t={t} />
								</td>
								<td className="border-b border-line p-2">{reportCell(row)}</td>
							</tr>
						))}
					</tbody>
				</table>
			</div>
			<ul className="space-y-3 md:hidden print:hidden" data-testid="kpi-cards">
				{rows.map((row) => (
					<li
						key={row.kpi.key}
						className="space-y-1 rounded-xl border border-line bg-surface-raised p-4"
						data-testid="kpi-card"
						data-metric={row.kpi.metricId}
					>
						<p className="font-semibold">
							{row.label}{" "}
							<span className="text-xs text-ink-muted">{row.kpi.metricId}</span>
						</p>
						<dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
							{[
								[headings[1], row.scope],
								[headings[2], row.baseline],
								[headings[3], row.target],
								[headings[4], row.current],
								[headings[5], row.change],
							].map(([term, value]) => (
								<div key={term} className="contents">
									<dt className="text-ink-muted">{term}</dt>
									<dd>{value}</dd>
								</div>
							))}
						</dl>
						<StatusChip kpi={row.kpi} t={t} />
						<div>{reportCell(row)}</div>
					</li>
				))}
			</ul>
		</>
	);
}

function Actions({
	plan,
	context,
	membership,
}: {
	plan: PlanDetail;
	context: PlansContext;
	membership: Membership | null;
}) {
	const t = useT();
	const id = useId();
	const navigate = useNavigate();
	const client = useQueryClient();
	const [renaming, setRenaming] = useState(false);
	const [title, setTitle] = useState(plan.title);
	const [confirming, setConfirming] = useState(false);
	const [failed, setFailed] = useState(false);
	const [busy, setBusy] = useState(false);
	if (!canManagePlan(membership, plan.storeIds)) return null;
	const run = async (action: () => Promise<void>, after?: () => void) => {
		setBusy(true);
		setFailed(false);
		try {
			await action();
			await client.invalidateQueries({ queryKey: ["plans"] });
			after?.();
		} catch {
			setFailed(true);
		} finally {
			setBusy(false);
		}
	};
	const rename = (event: FormEvent) => {
		event.preventDefault();
		const next = title.trim();
		if (next.length < 1 || next.length > 120) return;
		void run(
			() => context.plans.rename(plan.id, next),
			() => setRenaming(false),
		);
	};
	return (
		<div className="space-y-3 print:hidden" data-testid="plan-actions">
			<div className="flex flex-wrap gap-2">
				<Button
					tone="secondary"
					disabled={busy}
					onClick={() => setRenaming(true)}
					data-testid="plan-rename"
				>
					{t("plans.detail.rename")}
				</Button>
				<Button
					tone="secondary"
					disabled={busy}
					onClick={() =>
						void run(() =>
							context.plans.setArchived(plan.id, plan.archivedAt === null),
						)
					}
					data-testid="plan-archive"
				>
					{plan.archivedAt === null
						? t("plans.detail.archive")
						: t("plans.detail.unarchive")}
				</Button>
				<Button
					tone="warning"
					disabled={busy}
					onClick={() => setConfirming(true)}
					data-testid="plan-delete"
				>
					{t("plans.detail.delete")}
				</Button>
			</div>
			{renaming ? (
				<form className="space-y-2" onSubmit={rename}>
					<label htmlFor={`${id}-title`} className="block font-medium">
						{t("plans.detail.renameLabel")}
					</label>
					<input
						id={`${id}-title`}
						value={title}
						maxLength={120}
						onChange={(event) => setTitle(event.target.value)}
						className="min-h-11 w-full rounded-lg border border-line bg-surface px-3"
						data-testid="plan-title-input"
					/>
					<div className="flex gap-2">
						<Button type="submit" disabled={busy} data-testid="plan-title-save">
							{t("plans.detail.save")}
						</Button>
						<Button
							tone="secondary"
							type="button"
							onClick={() => setRenaming(false)}
						>
							{t("plans.detail.cancel")}
						</Button>
					</div>
				</form>
			) : null}
			{confirming ? (
				<div
					role="alertdialog"
					aria-labelledby={`${id}-confirm`}
					className="space-y-2 rounded-xl border border-negative p-4"
				>
					<p id={`${id}-confirm`}>{t("plans.detail.deleteConfirm")}</p>
					<div className="flex gap-2">
						<Button
							tone="warning"
							disabled={busy}
							onClick={() =>
								void run(
									() => context.plans.remove(plan.id),
									() => navigate("/ke-hoach"),
								)
							}
							data-testid="plan-delete-confirm"
						>
							{t("plans.detail.deleteYes")}
						</Button>
						<Button tone="secondary" onClick={() => setConfirming(false)}>
							{t("plans.detail.cancel")}
						</Button>
					</div>
				</div>
			) : null}
			{failed ? (
				<p role="alert" className="text-negative">
					{t("plans.detail.actionFailed")}
				</p>
			) : null}
		</div>
	);
}

function DetailView({
	plan,
	context,
	membership,
}: {
	plan: PlanDetail;
	context: PlansContext;
	membership: Membership | null;
}) {
	const t = useT();
	const scope = useReadyTenantScope();
	const formatters = useFormatters(scope.tenant);
	const asOf = context.asOfFor(plan.storeIds);
	const followUp = useQuery({
		queryKey: ["plans", "follow-up", plan.id, asOf],
		queryFn: () => planFollowUp(context.reports, plan, asOf),
	});
	const packCheck = useQuery({
		queryKey: ["plans", "pack-id", plan.id],
		queryFn: () => packIdMatches(plan.pack),
	});
	const siblings = useQuery({
		queryKey: [
			"plans",
			context.plans.kind,
			scope.tenant.id,
			"siblings",
			plan.id,
		],
		queryFn: () =>
			context.plans.list({
				tenantId: scope.tenant.id,
				archived: true,
				after: null,
			}),
	});
	const location = useLocation();
	const arrived = (location.state ?? null) as {
		saved?: boolean;
		alreadySaved?: boolean;
	} | null;
	const lint = useMemo(() => lintPlan(plan.content, plan.pack), [plan]);
	const errors = lint.issues.filter((issue) => issue.level === "error").length;
	const names = new Map(scope.stores.map((store) => [store.id, store.name]));
	const labels = plan.pack.request.stores.map((store) => ({
		label: store.label,
		name: names.get(store.id) ?? t("plans.list.unknownStore"),
	}));
	const scopeLabel = (storeIds: readonly string[], kpiScope: string) =>
		kpiScope === "ALL" || storeIds.length !== 1
			? t("plans.detail.scopeAll")
			: (labels.find((entry) => entry.label === kpiScope)?.name ?? kpiScope);
	const previous =
		siblings.data === undefined ? null : previousPlanOf(plan, siblings.data);
	const dueOn = Object.values(plan.kpis)[0]?.due_on ?? plan.asOf;
	const rows =
		followUp.data?.kpis.map((kpi) =>
			kpiRowView(kpi, formatters, t, scopeLabel),
		) ?? [];
	return (
		<article className="space-y-5 print:space-y-3" data-testid="plan-detail">
			<header className="space-y-2">
				<PageHeading
					title={plan.title}
					className="break-words text-2xl font-semibold"
				/>
				<p className="text-sm text-ink-muted">
					{[
						t("plans.list.created", {
							date: formatters.date(plan.createdAt.slice(0, 10)),
						}),
						t("plans.list.asOf", { date: formatters.date(plan.asOf) }),
						t("plans.list.horizon", {
							horizon: t(`plans.horizon.${plan.horizon}`),
						}),
						t("plans.detail.prompt", { version: plan.promptVersion }),
						t("plans.detail.pack", { id: plan.packId.slice(0, 8) }),
						t(`plans.via.${plan.via}`),
					].join(" · ")}
				</p>
				<ul
					className="flex flex-wrap gap-x-4 text-sm"
					data-testid="plan-stores"
				>
					{labels.map((entry) => (
						<li key={entry.label}>
							{t("plans.detail.storeLabel", {
								label: entry.label,
								name: entry.name,
							})}
						</li>
					))}
				</ul>
				<p className="text-sm">
					<span
						className={cn(
							"rounded-full border px-2",
							packCheck.data === false ? "border-negative" : "border-line",
						)}
						title={t("plans.detail.packHint")}
						data-testid="plan-pack-badge"
						data-match={
							packCheck.data === undefined ? undefined : String(packCheck.data)
						}
					>
						{packCheck.data === undefined
							? t("plans.detail.packChecking")
							: packCheck.data
								? t("plans.detail.packMatch")
								: t("plans.detail.packMismatch")}
					</span>{" "}
					<span className="text-ink-muted">{t("plans.detail.packHint")}</span>
				</p>
				{arrived?.saved === true ? (
					<p
						role="status"
						className="font-medium"
						data-testid="plan-saved-note"
						data-already={String(arrived.alreadySaved === true)}
					>
						{arrived.alreadySaved === true
							? t("plans.paste.alreadySaved")
							: t("plans.paste.saved")}
					</p>
				) : null}
				{plan.archivedAt === null ? null : (
					<p className="text-sm font-medium">
						{t("plans.detail.archivedNote")}
					</p>
				)}
				<div className="flex flex-wrap gap-x-6 print:hidden">
					<TextLink
						to="/ke-hoach"
						className="inline-flex min-h-11 items-center"
					>
						{t("plans.detail.back")}
					</TextLink>
					{previous === null ? null : (
						<>
							<TextLink
								to={`/ke-hoach/${previous.id}`}
								className="inline-flex min-h-11 items-center"
								data-testid="plan-previous"
							>
								{t("plans.detail.previous")}
							</TextLink>
							<TextLink
								to={`/ke-hoach/so-sanh?a=${previous.id}&b=${plan.id}`}
								className="inline-flex min-h-11 items-center"
								data-testid="plan-compare"
							>
								{t("plans.detail.compare")}
							</TextLink>
						</>
					)}
					<button
						type="button"
						className="min-h-11 underline"
						onClick={() => window.print()}
					>
						{t("plans.detail.print")}
					</button>
				</div>
				<Actions plan={plan} context={context} membership={membership} />
			</header>
			<section className="space-y-3" aria-labelledby="plan-kpi-title">
				<h2 id="plan-kpi-title" className="text-lg font-semibold">
					{t("plans.detail.kpiTitle")}
				</h2>
				{followUp.isPending ? (
					<p role="status">{t("plans.list.followUpLoading")}</p>
				) : followUp.isError ? (
					<p role="alert">{t("plans.list.followUpFailed")}</p>
				) : (
					<KpiTable
						rows={rows}
						dueOn={dueOn}
						asOf={asOf}
						formatters={formatters}
					/>
				)}
			</section>
			<section className="space-y-3" aria-labelledby="plan-body-title">
				<h2 id="plan-body-title" className="text-lg font-semibold">
					{t("plans.detail.bodyTitle")}
				</h2>
				<p className="text-sm text-ink-muted" data-testid="plan-lint-note">
					{t("plans.detail.lintNote", {
						errors,
						warnings: lint.issues.length - errors,
					})}
				</p>
				<PlanMarkdown
					content={plan.content}
					pack={plan.pack}
					formatters={formatters}
				/>
			</section>
		</article>
	);
}

export function PlanDetailPage() {
	const t = useT();
	const { planId: id = "" } = useParams();
	const membership = useMembership();
	const context = usePlansContext();
	const query = useQuery({
		queryKey: ["plans", context?.plans.kind, "detail", id],
		queryFn: () => (context === null ? null : context.plans.get(id)),
		enabled: context !== null,
	});
	const member =
		membership.status === "success" ? (membership.data ?? null) : null;
	if (membership.status === "pending" || context === null || query.isPending) {
		return <p role="status">{t("plans.detail.loading")}</p>;
	}
	if (
		!canReadPlans(member) ||
		query.isError ||
		query.data === null ||
		query.data === undefined
	) {
		return (
			<div className="space-y-3">
				<PageHeading
					title={t("plans.title")}
					className="text-2xl font-semibold"
				/>
				<p data-testid="plan-not-found">{t("plans.detail.notFound")}</p>
				<TextLink to="/ke-hoach">{t("plans.detail.back")}</TextLink>
			</div>
		);
	}
	return <DetailView plan={query.data} context={context} membership={member} />;
}
