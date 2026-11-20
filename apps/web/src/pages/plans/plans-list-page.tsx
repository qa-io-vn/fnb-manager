import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { useId, useMemo, useState } from "react";
import { Button } from "../../components/ui/button";
import { TextLink } from "../../components/ui/text-link";
import type { StoreRow } from "../../data/row-source";
import { useT } from "../../i18n";
import type { Formatters } from "../../lib/format";
import { storeNames, storeSetKey } from "../../plans/display";
import { planFollowUp } from "../../plans/follow-up";
import {
	PLAN_PAGE_SIZE,
	type PlanCursor,
	type PlanSummary,
} from "../../plans/source";
import {
	canReadPlans,
	type PlansContext,
	usePlansContext,
} from "../../plans/use-plans";
import { useMembership } from "../../settings/queries";
import { PageHeading } from "../../shell/page-heading";
import { useFormatters } from "../../state/formatters";
import { useReadyTenantScope } from "../../state/tenant-scope";
import { PACK_TAB_PATH, PLAN_PASTE_PATH } from "../exports/paths";

export interface PlanGroup {
	readonly key: string;
	readonly storeIds: readonly string[];
	readonly plans: readonly { plan: PlanSummary; version: number }[];
}

export function groupPlans(plans: readonly PlanSummary[]): PlanGroup[] {
	const groups = new Map<string, PlanSummary[]>();
	for (const plan of plans) {
		const key = storeSetKey(plan.storeIds);
		groups.set(key, [...(groups.get(key) ?? []), plan]);
	}
	return [...groups.entries()]
		.map(([key, members]) => {
			const oldestFirst = [...members].sort((left, right) =>
				left.createdAt === right.createdAt
					? left.id.localeCompare(right.id)
					: left.createdAt.localeCompare(right.createdAt),
			);
			const versions = new Map(
				oldestFirst.map((plan, index) => [plan.id, index + 1]),
			);
			return {
				key,
				storeIds: [...(members[0]?.storeIds ?? [])].sort(),
				plans: [...oldestFirst]
					.reverse()
					.map((plan) => ({ plan, version: versions.get(plan.id) ?? 1 })),
			};
		})
		.sort((left, right) =>
			(right.plans[0]?.plan.createdAt ?? "").localeCompare(
				left.plans[0]?.plan.createdAt ?? "",
			),
		);
}

function FollowUpSummary({
	context,
	plan,
}: {
	context: PlansContext;
	plan: PlanSummary;
}) {
	const t = useT();
	const asOf = context.asOfFor(plan.storeIds);
	const query = useQuery({
		queryKey: ["plans", "follow-up", plan.id, asOf],
		queryFn: () => planFollowUp(context.reports, plan, asOf),
	});
	const total = Object.keys(plan.kpis).length;
	if (query.isPending) {
		return (
			<p className="text-sm text-ink-muted" data-testid="plan-follow-up">
				{t("plans.list.followUpLoading")}
			</p>
		);
	}
	if (query.isError) {
		return (
			<p className="text-sm text-ink-muted" data-testid="plan-follow-up">
				{t("plans.list.followUpFailed")}
			</p>
		);
	}
	return (
		<p
			className="text-sm font-medium"
			data-testid="plan-follow-up"
			data-on-track={query.data.onTrack}
		>
			{t("plans.list.followUp", { onTrack: query.data.onTrack, total })}
		</p>
	);
}

export function PlanCard({
	plan,
	version,
	formatters,
	followUp,
}: {
	plan: PlanSummary;
	version: number;
	formatters: Formatters;
	followUp: React.ReactNode;
}) {
	const t = useT();
	const summary = plan.lint.summary ?? {};
	return (
		<li
			className="space-y-2 rounded-xl border border-line bg-surface-raised p-4"
			data-testid="plan-card"
			data-plan-id={plan.id}
		>
			<div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
				<TextLink
					to={`/ke-hoach/${plan.id}`}
					className="inline-flex min-h-11 items-center break-words font-semibold"
				>
					{plan.title}
				</TextLink>
				<span className="text-sm text-ink-muted" data-testid="plan-version">
					{t("plans.list.version", { n: version })}
				</span>
				<span
					className="rounded-full border border-line px-2 text-sm"
					data-testid="plan-via"
					data-via={plan.via}
				>
					{t(`plans.via.${plan.via}`)}
				</span>
				{plan.archivedAt === null ? null : (
					<span className="rounded-full border border-line px-2 text-sm">
						{t("plans.list.archived")}
					</span>
				)}
			</div>
			<p className="text-sm text-ink-muted">
				{[
					t("plans.list.created", {
						date: formatters.date(plan.createdAt.slice(0, 10)),
					}),
					t("plans.list.asOf", { date: formatters.date(plan.asOf) }),
					t("plans.list.horizon", {
						horizon: t(`plans.horizon.${plan.horizon}`),
					}),
					t("plans.list.kpis", { count: Object.keys(plan.kpis).length }),
					summary.initiatives === undefined
						? null
						: t("plans.list.citations", {
								cited: summary.citedInitiatives ?? 0,
								total: summary.initiatives,
							}),
				]
					.filter((part) => part !== null)
					.join(" · ")}
			</p>
			{followUp}
		</li>
	);
}

function GroupView({
	group,
	stores,
	context,
	formatters,
}: {
	group: PlanGroup;
	stores: readonly StoreRow[];
	context: PlansContext;
	formatters: Formatters;
}) {
	const t = useT();
	const id = useId();
	const newest = group.plans.find(({ plan }) => plan.archivedAt === null);
	return (
		<section
			aria-labelledby={id}
			className="space-y-3"
			data-testid="plan-group"
			data-store-set={group.key}
		>
			<h2 id={id} className="text-lg font-semibold">
				{t("plans.list.storeSet", {
					stores: storeNames(
						stores,
						group.storeIds,
						t("plans.list.unknownStore"),
					),
				})}
			</h2>
			<ul className="space-y-3">
				{group.plans.map(({ plan, version }) => (
					<PlanCard
						key={plan.id}
						plan={plan}
						version={version}
						formatters={formatters}
						followUp={
							newest?.plan.id === plan.id ? (
								<FollowUpSummary context={context} plan={plan} />
							) : null
						}
					/>
				))}
			</ul>
		</section>
	);
}

function PlanList({ context }: { context: PlansContext }) {
	const t = useT();
	const scope = useReadyTenantScope();
	const formatters = useFormatters(scope.tenant);
	const switchId = useId();
	const [archived, setArchived] = useState(false);
	const query = useInfiniteQuery({
		queryKey: ["plans", context.plans.kind, scope.tenant.id, "list", archived],
		initialPageParam: null as PlanCursor | null,
		queryFn: ({ pageParam }) =>
			context.plans.list({
				tenantId: scope.tenant.id,
				archived,
				after: pageParam,
			}),
		getNextPageParam: (page) => {
			const last = page[page.length - 1];
			return page.length < PLAN_PAGE_SIZE || last === undefined
				? null
				: { createdAt: last.createdAt, id: last.id };
		},
	});
	const plans = useMemo(() => query.data?.pages.flat() ?? [], [query.data]);
	const groups = useMemo(() => groupPlans(plans), [plans]);
	return (
		<div className="space-y-4">
			<label
				htmlFor={switchId}
				className="flex min-h-11 items-center gap-3 font-medium"
			>
				<input
					id={switchId}
					type="checkbox"
					className="size-5"
					checked={archived}
					onChange={(event) => setArchived(event.target.checked)}
					data-testid="plans-show-archived"
				/>
				{t("plans.list.showArchived")}
			</label>
			{query.isPending ? (
				<p role="status">{t("plans.list.loading")}</p>
			) : query.isError ? (
				<div className="space-y-2">
					<p role="alert" data-testid="plans-failed">
						{t("plans.list.failed")}
					</p>
					<Button tone="secondary" onClick={() => void query.refetch()}>
						{t("plans.list.retry")}
					</Button>
				</div>
			) : groups.length === 0 ? (
				<div
					className="space-y-2 rounded-xl border border-line bg-surface-raised p-5"
					data-testid="plans-empty"
				>
					<p>{t("plans.list.empty")}</p>
					<TextLink to={PACK_TAB_PATH} className="font-medium">
						{t("plans.list.pack")}
					</TextLink>
				</div>
			) : (
				<div className="space-y-6" data-testid="plans-list">
					{groups.map((group) => (
						<GroupView
							key={group.key}
							group={group}
							stores={scope.stores}
							context={context}
							formatters={formatters}
						/>
					))}
				</div>
			)}
			{query.hasNextPage ? (
				<Button
					tone="secondary"
					disabled={query.isFetchingNextPage}
					onClick={() => void query.fetchNextPage()}
					data-testid="plans-load-more"
				>
					{t("plans.list.loadMore")}
				</Button>
			) : null}
		</div>
	);
}

export function PlansListPage() {
	const t = useT();
	const membership = useMembership();
	const context = usePlansContext();
	const readable =
		membership.status === "success" && canReadPlans(membership.data ?? null);
	return (
		<div className="space-y-4" data-testid="plans-page">
			<PageHeading
				title={t("plans.title")}
				className="text-2xl font-semibold"
			/>
			<p className="text-ink-muted">{t("plans.list.intro")}</p>
			<div className="flex flex-wrap gap-x-6 gap-y-1">
				<TextLink
					to={PLAN_PASTE_PATH}
					className="inline-flex min-h-11 items-center font-medium"
				>
					{t("plans.list.paste")}
				</TextLink>
				<TextLink
					to={PACK_TAB_PATH}
					className="inline-flex min-h-11 items-center font-medium"
				>
					{t("plans.list.pack")}
				</TextLink>
			</div>
			{membership.status === "pending" || context === null ? (
				<p role="status">{t("plans.list.loading")}</p>
			) : !readable ? (
				<p data-testid="plans-denied">{t("plans.detail.notFound")}</p>
			) : (
				<PlanList context={context} />
			)}
		</div>
	);
}
