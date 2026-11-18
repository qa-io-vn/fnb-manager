import type { DueChecklist, ShiftPhase } from "@fnb/zalo-mini";
import { useI18n } from "@fnb/zalo-mini/react";
import { useShiftEnv } from "../shift/env";
import {
	byPhase,
	type ChecklistState,
	checklistState,
	type PrimaryTarget,
} from "../shift/model";
import { Card, Chip, Hint, quietAction, type Tone } from "../shift/parts";
import { primaryButton, secondaryButton } from "../ui";
import type { RunRequest } from "./checklist-run";

const PHASE_KEYS: Readonly<Record<ShiftPhase, string>> = {
	opening: "ops.phase.opening",
	midshift: "ops.phase.midshift",
	closing: "ops.phase.closing",
};

const STATE_TONES: Readonly<Record<ChecklistState, Tone>> = {
	"not-started": "warning",
	"mine-open": "accent",
	"other-open": "neutral",
	finished: "positive",
};

function ChecklistCard({
	checklist,
	current,
	primary,
	onOpen,
}: {
	readonly checklist: DueChecklist;
	readonly current: boolean;
	readonly primary: boolean;
	readonly onOpen: (request: RunRequest) => void;
}) {
	const { t } = useI18n();
	const { memberId, formatters } = useShiftEnv();
	const state = checklistState(checklist, memberId);
	const run = checklist.run;
	const start = () =>
		onOpen({ kind: "start", templateId: checklist.templateId });
	const view = () => {
		if (run !== null) onOpen({ kind: "view", runId: run.id });
	};
	const mainLabel =
		state === "not-started"
			? t("checklist.start")
			: state === "mine-open"
				? t("checklist.continue")
				: t("checklist.view");
	const mainAction =
		state === "not-started" || state === "mine-open" ? start : view;
	return (
		<Card testId="checklist-card" state={state}>
			<div
				className="flex flex-col gap-1"
				data-template-id={checklist.templateId}
			>
				<div className="flex flex-wrap items-center gap-2">
					<Chip tone="accent">{t(PHASE_KEYS[checklist.shiftPhase])}</Chip>
					{current ? <Chip tone="warning">{t("checklist.dueNow")}</Chip> : null}
				</div>
				<h3 className="text-lg font-semibold text-ink">{checklist.title}</h3>
				<p className="text-sm text-ink-muted">
					{checklist.photoItems > 0
						? t("checklist.countsWithPhotos", {
								items: checklist.items,
								photos: checklist.photoItems,
							})
						: t("checklist.counts", { items: checklist.items })}
				</p>
				<Chip tone={STATE_TONES[state]} testId="checklist-state">
					{state === "finished" && run?.finishedAt
						? t("checklist.state.finishedAt", {
								time: formatters.time(new Date(run.finishedAt)),
							})
						: t(`checklist.state.${state}`)}
				</Chip>
			</div>
			<button
				type="button"
				onClick={mainAction}
				className={primary ? primaryButton : secondaryButton}
				{...(primary ? { "data-action": "primary" } : {})}
				aria-label={`${mainLabel}: ${checklist.title}`}
			>
				{mainLabel}
			</button>
			{state === "finished" ? (
				<button
					type="button"
					onClick={start}
					className={`${quietAction} self-start`}
				>
					{t("checklist.again")}
				</button>
			) : null}
			{state === "other-open" ? <Hint>{t("checklist.otherHint")}</Hint> : null}
		</Card>
	);
}

export function ChecklistCards({
	checklists,
	phase,
	primary,
	onOpen,
}: {
	readonly checklists: readonly DueChecklist[];
	readonly phase: ShiftPhase | null;
	readonly primary: PrimaryTarget;
	readonly onOpen: (request: RunRequest) => void;
}) {
	const { t } = useI18n();
	if (checklists.length === 0) {
		return <Hint testId="checklists-empty">{t("checklist.none")}</Hint>;
	}
	const groups = byPhase(checklists, phase);
	const card = (checklist: DueChecklist, current: boolean) => (
		<ChecklistCard
			key={checklist.templateId}
			checklist={checklist}
			current={current}
			primary={
				primary.kind === "checklist" &&
				primary.templateId === checklist.templateId
			}
			onOpen={onOpen}
		/>
	);
	return (
		<div className="flex flex-col gap-3" data-testid="checklists">
			{groups.now.map((checklist) => card(checklist, true))}
			{groups.later.length > 0 && groups.now.length > 0 ? (
				<p className="pt-1 text-sm font-semibold text-ink-muted">
					{t("checklist.otherPhases")}
				</p>
			) : null}
			{groups.later.map((checklist) => card(checklist, false))}
		</div>
	);
}
