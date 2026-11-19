import { useId, useState } from "react";
import { Button } from "../components/ui/button";
import { type Translate, useT } from "../i18n";
import type { Formatters } from "../lib/format";
import { actorName, moment, PHASE_LABEL_KEYS, storeNameOf } from "./labels";
import { PhotoThumbnail } from "./operations-ui";
import { useRunDetail } from "./queries";
import type {
	Actors,
	AnswerValues,
	ChecklistRun,
	RunDetail,
	RunDetailItem,
} from "./source";

interface DetailContext {
	readonly formatters: Formatters;
	readonly actors: Actors | undefined;
	readonly timeZone: string;
}

function valueText(
	t: Translate,
	values: AnswerValues,
	unit: string | null,
): string {
	const parts = [
		values.done === true
			? t("operations.run.value.done")
			: t("operations.run.value.notDone"),
		values.numberValue === null
			? null
			: `${values.numberValue}${unit === null ? "" : ` ${unit}`}`,
		values.photoPath === null ? null : t("operations.run.value.photo"),
	].filter((part) => part !== null);
	return parts.join(", ");
}

function ItemAnswer({
	item,
	bucket,
	context,
}: {
	readonly item: RunDetailItem;
	readonly bucket: string | null;
	readonly context: DetailContext;
}) {
	const t = useT();
	const answered =
		item.answeredBy === null
			? null
			: t("operations.run.answeredBy", {
					actor: actorName(t, context.actors, item.answeredBy) ?? "",
					time:
						moment(context.formatters, item.answeredAt, context.timeZone) ?? "",
				});
	return (
		<li className="space-y-1 py-2" data-testid="run-item">
			<p className="break-words text-sm">
				<span className="font-medium">{item.position}. </span>
				<span data-testid="run-item-label">{item.label}</span>
			</p>
			<p className="text-sm text-ink-muted">
				<span data-testid="run-item-done">
					{item.done
						? t("operations.run.itemDone")
						: t("operations.run.itemNotDone")}
				</span>
				{item.numberValue === null ? null : (
					<span>
						{" · "}
						{t("operations.run.number", {
							value: context.formatters.decimalExact(item.numberValue),
							unit: item.numberUnit ?? "",
						})}
					</span>
				)}
				{answered === null ? null : <span>{` · ${answered}`}</span>}
			</p>
			{item.photoPath === null ? (
				item.requiresPhoto ? (
					<p className="text-sm text-ink-muted">
						{t("operations.run.photoMissing")}
					</p>
				) : null
			) : item.photoRemoved || bucket === null ? (
				<p className="text-sm text-ink-muted" data-testid="photo-removed">
					{t("operations.run.photoRemoved")}
				</p>
			) : (
				<PhotoThumbnail
					bucket={bucket}
					path={item.photoPath}
					alt={t("operations.run.photo", { label: item.label })}
				/>
			)}
		</li>
	);
}

function DetailBody({
	detail,
	context,
}: {
	readonly detail: RunDetail;
	readonly context: DetailContext;
}) {
	const t = useT();
	const positions = new Map(
		detail.items.map((item) => [item.answerId, item] as const),
	);
	const done = detail.items.filter((item) => item.done).length;
	return (
		<div className="space-y-2" data-testid="run-detail">
			<p className="text-sm text-ink-muted" data-testid="run-detail-version">
				{t("operations.run.version", {
					version: detail.templateVersion,
					status:
						detail.status === "finished"
							? t("operations.run.finished")
							: t("operations.run.open"),
					done,
					total: detail.items.length,
				})}
			</p>
			<p className="text-sm text-ink-muted">
				{[
					t("operations.run.startedBy", {
						actor:
							actorName(t, context.actors, detail.startedBy) ??
							t("operations.actor.unknown"),
						time:
							moment(context.formatters, detail.startedAt, context.timeZone) ??
							"",
					}),
					detail.finishedAt === null
						? null
						: t("operations.run.finishedAt", {
								time:
									moment(
										context.formatters,
										detail.finishedAt,
										context.timeZone,
									) ?? "",
							}),
				]
					.filter((part) => part !== null)
					.join(", ")}
			</p>
			<ol className="divide-y divide-line">
				{detail.items.map((item) => (
					<ItemAnswer
						key={item.answerId}
						item={item}
						bucket={detail.photoBucket}
						context={context}
					/>
				))}
			</ol>
			{detail.corrections.length === 0 ? null : (
				<div className="space-y-1" data-testid="run-corrections">
					<p className="text-sm font-medium">
						{t("operations.run.corrections")}
					</p>
					<ul className="space-y-1 text-sm">
						{detail.corrections.map((correction) => {
							const item = positions.get(correction.answerId);
							return (
								<li key={correction.id}>
									{t("operations.run.correction", {
										actor:
											actorName(t, context.actors, correction.by) ??
											t("operations.actor.unknown"),
										position: item?.position ?? "",
										time:
											moment(
												context.formatters,
												correction.at,
												context.timeZone,
											) ?? "",
										before: valueText(
											t,
											correction.before,
											item?.numberUnit ?? null,
										),
										after: valueText(
											t,
											correction.after,
											item?.numberUnit ?? null,
										),
									})}
								</li>
							);
						})}
					</ul>
				</div>
			)}
		</div>
	);
}

function LoadedDetail({
	runId,
	context,
}: {
	readonly runId: string;
	readonly context: DetailContext;
}) {
	const t = useT();
	const detail = useRunDetail(runId);
	if (detail.status === "pending") {
		return (
			<p role="status" className="text-sm">
				{t("operations.run.loading")}
			</p>
		);
	}
	if (detail.status === "error" || detail.data === null) {
		return (
			<div role="alert" className="space-y-2">
				<p className="text-sm">{t("operations.run.gone")}</p>
				<Button
					tone="secondary"
					size="compact"
					onClick={() => void detail.refetch()}
				>
					{t("app.retry")}
				</Button>
			</div>
		);
	}
	return <DetailBody detail={detail.data} context={context} />;
}

function RunEntry({
	run,
	storeName,
	context,
}: {
	readonly run: ChecklistRun;
	readonly storeName: string;
	readonly context: DetailContext;
}) {
	const t = useT();
	const ids = useId();
	const [open, setOpen] = useState(false);
	const date = context.formatters.date(run.businessDate);
	return (
		<li className="space-y-2 py-3" data-testid="run-entry" data-run-id={run.id}>
			<div className="flex flex-wrap items-center justify-between gap-2">
				<div className="min-w-0">
					<p className="break-words font-medium">
						{t("operations.runs.summary", {
							title: run.title,
							store: storeName,
							date,
						})}
					</p>
					<p className="text-sm text-ink-muted">
						{[
							t(PHASE_LABEL_KEYS[run.phase]),
							run.status === "finished"
								? t("operations.run.finished")
								: t("operations.run.open"),
							t("operations.checklist.itemsDone", {
								done: run.itemsDone,
								total: run.itemsTotal,
							}),
						].join(" · ")}
					</p>
				</div>
				<Button
					tone="secondary"
					size="compact"
					aria-expanded={open}
					aria-controls={`${ids}-detail`}
					aria-label={
						open
							? undefined
							: t("operations.runs.openLabel", {
									title: run.title,
									store: storeName,
									date,
								})
					}
					onClick={() => setOpen(!open)}
					data-testid="run-toggle"
				>
					{open ? t("operations.runs.close") : t("operations.runs.open")}
				</Button>
			</div>
			<div id={`${ids}-detail`}>
				{open ? <LoadedDetail runId={run.id} context={context} /> : null}
			</div>
		</li>
	);
}

export function RunDetails({
	runs,
	stores,
	context,
}: {
	readonly runs: readonly ChecklistRun[];
	readonly stores: readonly { readonly id: string; readonly name: string }[];
	readonly context: DetailContext;
}) {
	const t = useT();
	const ids = useId();
	const ordered = [...runs].sort((left, right) =>
		left.startedAt === right.startedAt
			? left.id < right.id
				? -1
				: 1
			: left.startedAt < right.startedAt
				? 1
				: -1,
	);
	return (
		<section
			aria-labelledby={`${ids}-heading`}
			className="space-y-2 rounded-xl border border-line bg-surface-raised p-4 print:hidden"
			data-testid="run-details"
		>
			<h2 id={`${ids}-heading`} className="text-base font-semibold">
				{t("operations.runs.title")}
			</h2>
			<p className="text-sm text-ink-muted">{t("operations.runs.hint")}</p>
			{ordered.length === 0 ? (
				<p className="text-sm" data-testid="runs-none">
					{t("operations.runs.none")}
				</p>
			) : (
				<ul className="divide-y divide-line">
					{ordered.map((run) => (
						<RunEntry
							key={run.id}
							run={run}
							storeName={storeNameOf(stores, run.storeId)}
							context={context}
						/>
					))}
				</ul>
			)}
		</section>
	);
}
