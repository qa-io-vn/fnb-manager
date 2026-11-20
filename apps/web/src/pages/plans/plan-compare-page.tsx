import {
	comparePlans,
	type PlanComparison,
	type PlanForComparison,
	parsePlan,
	type StoredKpi,
} from "@fnb/datapack";
import { useQuery } from "@tanstack/react-query";
import { useId } from "react";
import { useSearchParams } from "react-router-dom";
import { cn } from "../../components/ui/cn";
import { TextLink } from "../../components/ui/text-link";
import { useT } from "../../i18n";
import type { IsoDate } from "../../lib/business-dates";
import type { Formatters } from "../../lib/format";
import { formatKpiValue, storeSetKey } from "../../plans/display";
import {
	type FollowUpCall,
	liveValues,
	windowEnding,
} from "../../plans/follow-up";
import type { PlanDetail, PlanSummary } from "../../plans/source";
import {
	canReadPlans,
	type PlansContext,
	usePlansContext,
} from "../../plans/use-plans";
import { controlClass } from "../../settings/forms/field";
import { useMembership } from "../../settings/queries";
import { PageHeading } from "../../shell/page-heading";
import { useFormatters } from "../../state/formatters";
import { useReadyTenantScope } from "../../state/tenant-scope";
import { previousPlanOf } from "./plan-detail-page";

export function initiativeTitlesOf(plan: PlanDetail): string[] {
	try {
		return parsePlan(plan.content).initiatives.map(
			(initiative) => initiative.title,
		);
	} catch {
		return [];
	}
}

export function comparisonInput(plan: PlanDetail): PlanForComparison {
	return {
		id: plan.id,
		createdAt: plan.createdAt,
		asOf: plan.asOf,
		horizon: plan.horizon,
		promptVersion: plan.promptVersion,
		packId: plan.packId,
		kpis: plan.kpis,
		initiativeTitles: initiativeTitlesOf(plan),
	};
}

export function comparisonCalls(
	plans: readonly PlanDetail[],
	asOf: IsoDate,
): FollowUpCall[] {
	const sets = new Map<
		string,
		{ storeIds: string[]; metricIds: Set<string> }
	>();
	for (const plan of plans) {
		for (const [metricId, kpi] of Object.entries(plan.kpis) as [
			string,
			StoredKpi,
		][]) {
			const storeIds = [...kpi.store_ids].sort();
			const key = storeIds.join(",");
			const set = sets.get(key) ?? { storeIds, metricIds: new Set<string>() };
			set.metricIds.add(metricId);
			sets.set(key, set);
		}
	}
	const window = windowEnding(asOf);
	return [...sets.keys()].sort().map((key) => {
		const set = sets.get(key) as { storeIds: string[]; metricIds: Set<string> };
		return {
			storeIds: set.storeIds,
			metricIds: [...set.metricIds].sort(),
			fromDates: [window.from],
			toDates: [window.to],
		};
	});
}

export function orderedPair(
	left: PlanDetail,
	right: PlanDetail,
): [PlanDetail, PlanDetail] {
	return left.createdAt <= right.createdAt ? [left, right] : [right, left];
}

async function loadComparison(
	context: PlansContext,
	leftId: string,
	rightId: string,
): Promise<{
	comparison: PlanComparison;
	left: PlanDetail;
	right: PlanDetail;
} | null> {
	const [first, second] = await Promise.all([
		context.plans.get(leftId),
		context.plans.get(rightId),
	]);
	if (first === null || second === null) return null;
	const [left, right] = orderedPair(first, second);
	const asOf = context.asOfFor([
		...new Set([...left.storeIds, ...right.storeIds]),
	]);
	const values = await liveValues(
		context.reports,
		comparisonCalls([left, right], asOf),
	);
	const current = new Map([...values].map(([key, pair]) => [key, pair[0]]));
	return {
		comparison: comparePlans(comparisonInput(left), comparisonInput(right), {
			asOf,
			current,
		}),
		left,
		right,
	};
}

function Header({
	plan,
	heading,
	formatters,
}: {
	plan: PlanDetail;
	heading: string;
	formatters: Formatters;
}) {
	const t = useT();
	return (
		<div
			className="space-y-1 rounded-xl border border-line bg-surface-raised p-4"
			data-testid="compare-header"
		>
			<p className="text-sm text-ink-muted">{heading}</p>
			<TextLink
				to={`/ke-hoach/${plan.id}`}
				className="inline-flex min-h-11 items-center break-words font-semibold"
			>
				{plan.title}
			</TextLink>
			<p className="text-sm">
				{t("plans.compare.header", {
					created: formatters.date(plan.createdAt.slice(0, 10)),
					asOf: formatters.date(plan.asOf),
					horizon: t(`plans.horizon.${plan.horizon}`),
					prompt: plan.promptVersion,
					pack: plan.packId.slice(0, 8),
					initiatives: initiativeTitlesOf(plan).length,
				})}
			</p>
		</div>
	);
}

function ComparisonView({
	data,
	formatters,
}: {
	data: { comparison: PlanComparison; left: PlanDetail; right: PlanDetail };
	formatters: Formatters;
}) {
	const t = useT();
	const { comparison, left, right } = data;
	const value = (metricId: string, number: number | null | undefined) =>
		number === undefined
			? t("plans.detail.noValue")
			: (formatKpiValue(formatters, metricId, number) ??
				t("plans.detail.noValue"));
	return (
		<div className="space-y-5">
			<div className="grid gap-3 md:grid-cols-2">
				<Header
					plan={left}
					heading={t("plans.compare.left")}
					formatters={formatters}
				/>
				<Header
					plan={right}
					heading={t("plans.compare.right")}
					formatters={formatters}
				/>
			</div>
			<section className="space-y-2" aria-labelledby="compare-kpis">
				<h2 id="compare-kpis" className="text-lg font-semibold">
					{t("plans.compare.kpis")}
				</h2>
				<ul className="space-y-3" data-testid="compare-kpis">
					{comparison.kpis.map((row) => (
						<li
							key={`${row.metricId}|${row.storeIds.join(",")}`}
							className="space-y-1 rounded-xl border border-line p-3"
							data-testid="compare-kpi"
							data-change={row.change}
							data-metric={row.metricId}
						>
							<p className="font-semibold">
								{t(`metric.${row.metricId}.label` as Parameters<typeof t>[0])}{" "}
								<span className="text-xs text-ink-muted">{row.metricId}</span>{" "}
								<span className="rounded-full border border-line px-2 text-sm font-normal">
									{t(`plans.compare.change.${row.change}`)}
								</span>
							</p>
							<div className="grid gap-2 text-sm md:grid-cols-3">
								{[
									{ side: row.left, heading: t("plans.compare.left") },
									{ side: row.right, heading: t("plans.compare.right") },
								].map(({ side, heading }) => (
									<p key={heading}>
										<span className="text-ink-muted">{heading}: </span>
										{side === null
											? t("plans.detail.noValue")
											: `${value(row.metricId, side.baseline)} → ${value(row.metricId, side.target)} · ${t(`plans.status.${side.status}`)}`}
									</p>
								))}
								<p>
									<span className="text-ink-muted">
										{t("plans.compare.current")}:{" "}
									</span>
									{value(row.metricId, row.current)}
								</p>
							</div>
						</li>
					))}
				</ul>
			</section>
			<section className="space-y-2" aria-labelledby="compare-initiatives">
				<h2 id="compare-initiatives" className="text-lg font-semibold">
					{t("plans.compare.initiatives")}
				</h2>
				<ul className="space-y-1" data-testid="compare-initiatives">
					{comparison.initiatives.map((row) => (
						<li
							key={`${row.change}|${row.title}`}
							data-change={row.change}
							className="break-words"
						>
							<span className="rounded-full border border-line px-2 text-sm">
								{t(`plans.compare.change.${row.change}`)}
							</span>{" "}
							{row.title}
						</li>
					))}
				</ul>
			</section>
		</div>
	);
}

function Picker({
	plans,
	current,
	partner,
	onPick,
}: {
	plans: readonly PlanSummary[];
	current: PlanSummary;
	partner: string | null;
	onPick: (id: string) => void;
}) {
	const t = useT();
	const id = useId();
	const options = plans.filter(
		(plan) =>
			plan.id !== current.id &&
			storeSetKey(plan.storeIds) === storeSetKey(current.storeIds),
	);
	if (options.length === 0) {
		return (
			<p data-testid="compare-no-partner">{t("plans.compare.noPartner")}</p>
		);
	}
	return (
		<div className="space-y-1">
			<label htmlFor={id} className="block font-medium">
				{t("plans.compare.pick")}
			</label>
			<select
				id={id}
				value={partner ?? ""}
				onChange={(event) => onPick(event.target.value)}
				className={cn(controlClass, "w-full")}
				data-testid="compare-picker"
			>
				{options.map((plan) => (
					<option key={plan.id} value={plan.id}>
						{plan.title} · {plan.createdAt.slice(0, 10)}
					</option>
				))}
			</select>
		</div>
	);
}

function Compare({ context }: { context: PlansContext }) {
	const t = useT();
	const scope = useReadyTenantScope();
	const formatters = useFormatters(scope.tenant);
	const [params, setParams] = useSearchParams();
	const all = useQuery({
		queryKey: ["plans", context.plans.kind, scope.tenant.id, "compare-list"],
		queryFn: () =>
			context.plans.list({
				tenantId: scope.tenant.id,
				archived: true,
				after: null,
			}),
	});
	const b = params.get("b") ?? params.get("a");
	const current = all.data?.find((plan) => plan.id === b) ?? null;
	const a =
		params.get("b") === null
			? current === null
				? null
				: (previousPlanOf(current, all.data ?? [])?.id ?? null)
			: params.get("a");
	const comparison = useQuery({
		queryKey: ["plans", context.plans.kind, "compare", a, b],
		queryFn: () => loadComparison(context, a as string, b as string),
		enabled: a !== null && b !== null && a !== b,
	});
	return (
		<div className="space-y-4">
			{current === null ? null : (
				<Picker
					plans={all.data ?? []}
					current={current}
					partner={a}
					onPick={(picked) => setParams({ a: picked, b: current.id })}
				/>
			)}
			{a === null || b === null || a === b ? null : comparison.isPending ? (
				<p role="status">{t("plans.detail.loading")}</p>
			) : comparison.isError || comparison.data === null ? (
				<p role="alert" data-testid="compare-unreadable">
					{t("plans.compare.unreadable")}
				</p>
			) : (
				<ComparisonView data={comparison.data} formatters={formatters} />
			)}
		</div>
	);
}

export function PlanComparePage() {
	const t = useT();
	const membership = useMembership();
	const context = usePlansContext();
	const member =
		membership.status === "success" ? (membership.data ?? null) : null;
	return (
		<div className="space-y-4" data-testid="plan-compare">
			<PageHeading
				title={t("plans.compare.title")}
				className="text-2xl font-semibold"
			/>
			<TextLink to="/ke-hoach" className="inline-flex min-h-11 items-center">
				{t("plans.detail.back")}
			</TextLink>
			{membership.status === "pending" || context === null ? (
				<p role="status">{t("plans.detail.loading")}</p>
			) : !canReadPlans(member) ? (
				<p>{t("plans.detail.notFound")}</p>
			) : (
				<Compare context={context} />
			)}
		</div>
	);
}
