import type {
	CashCountRecord,
	DueChecklist,
	StoredSession,
} from "@fnb/zalo-mini";
import { useDataEndpoint, useI18n, useSession } from "@fnb/zalo-mini/react";
import {
	type ReactNode,
	useCallback,
	useEffect,
	useMemo,
	useState,
} from "react";
import { useNavigate } from "react-router-dom";
import { secondaryButton } from "../ui";
import { useFormatters } from "./env";
import { byPhase, checklistState, phaseAt, primaryTarget } from "./model";
import { Chip, quietAction } from "./parts";
import type { ShiftOpen } from "./shift-screen";
import {
	type ShiftContext,
	type ShiftSourceFactory,
	type ShiftStore,
	shiftSourceFor,
} from "./source";

type CardsLoad =
	| { readonly status: "loading" }
	| { readonly status: "failed" }
	| {
			readonly status: "ready";
			readonly context: ShiftContext;
			readonly store: ShiftStore | undefined;
			readonly checklists: readonly DueChecklist[];
			readonly counts: readonly CashCountRecord[];
	  };

const PHASE_KEYS = {
	opening: "ops.phase.opening",
	midshift: "ops.phase.midshift",
	closing: "ops.phase.closing",
} as const;

function TaskCard({
	testId,
	label,
	aside,
	children,
}: {
	readonly testId: string;
	readonly label: string;
	readonly aside?: ReactNode;
	readonly children: ReactNode;
}) {
	return (
		<div
			data-testid={testId}
			className="col-span-2 flex min-w-0 flex-col gap-2 rounded-2xl border border-line bg-surface-raised p-4"
		>
			<div className="flex items-center justify-between gap-2">
				<p className="text-sm text-ink-muted">{label}</p>
				{aside}
			</div>
			{children}
		</div>
	);
}

function ReadyCards({
	load,
	memberId,
	onOpen,
}: {
	readonly load: Extract<CardsLoad, { status: "ready" }>;
	readonly memberId: string | null;
	readonly onOpen: (open: ShiftOpen) => void;
}) {
	const { t } = useI18n();
	const formatters = useFormatters(load.context);
	const store = load.store;
	if (store === undefined) return null;
	const phase = phaseAt(store.openingHours, new Date(), store);
	const target = primaryTarget(load.checklists, phase, memberId);
	const due =
		target.kind === "checklist"
			? load.checklists.find(
					(checklist) => checklist.templateId === target.templateId,
				)
			: byPhase(load.checklists, phase).now[0];
	const counted = load.counts
		.filter((record) => record.status === "active")
		.sort((a, b) => b.countedAt.localeCompare(a.countedAt))[0];
	return (
		<>
			<TaskCard
				testId="home-card-checklist"
				label={t("homeTasks.checklist")}
				aside={
					phase === null ? null : (
						<Chip tone="accent">{t(PHASE_KEYS[phase])}</Chip>
					)
				}
			>
				{due === undefined ? (
					<p className="text-base text-ink-muted">{t("homeTasks.noneDue")}</p>
				) : (
					<div className="flex flex-col gap-1">
						<p className="text-lg font-semibold text-ink">{due.title}</p>
						<Chip
							tone={
								checklistState(due, memberId) === "finished"
									? "positive"
									: "warning"
							}
							testId="home-checklist-state"
						>
							{t(`checklist.state.${checklistState(due, memberId)}`)}
						</Chip>
					</div>
				)}
				<button
					type="button"
					className={secondaryButton}
					onClick={() =>
						onOpen(
							due !== undefined && target.kind === "checklist"
								? {
										kind: "checklist",
										storeId: store.id,
										templateId: due.templateId,
									}
								: { kind: "board", storeId: store.id },
						)
					}
				>
					{due !== undefined && target.kind === "checklist"
						? t("homeTasks.openChecklist")
						: t("homeTasks.openShift")}
				</button>
			</TaskCard>
			<TaskCard testId="home-card-close" label={t("homeTasks.close")}>
				<p className="text-base text-ink" data-testid="home-close-state">
					{counted === undefined
						? t("homeTasks.notCounted")
						: t("shift.countedAt", {
								time: formatters.time(new Date(counted.countedAt)),
							})}
				</p>
				<button
					type="button"
					className={secondaryButton}
					onClick={() => onOpen({ kind: "close", storeId: store.id })}
				>
					{t("shift.closeAction")}
				</button>
			</TaskCard>
		</>
	);
}

export function ShiftTaskCards({
	storeId,
	sourceFor = shiftSourceFor,
}: {
	readonly storeId: string;
	readonly sourceFor?: ShiftSourceFactory;
}) {
	const { state } = useSession();
	if (state.status !== "signed-in") return null;
	return (
		<SignedInCards
			storeId={storeId}
			session={state.session}
			sourceFor={sourceFor}
		/>
	);
}

function SignedInCards({
	storeId,
	session,
	sourceFor,
}: {
	readonly storeId: string;
	readonly session: StoredSession;
	readonly sourceFor: ShiftSourceFactory;
}) {
	const { t } = useI18n();
	const endpoint = useDataEndpoint();
	const navigate = useNavigate();
	const source = useMemo(
		() => sourceFor(endpoint, session),
		[sourceFor, endpoint, session],
	);
	const [load, setLoad] = useState<CardsLoad>({ status: "loading" });
	const member = session.member;
	const fetchCards = useCallback(() => {
		let active = true;
		setLoad({ status: "loading" });
		source
			.context(
				{
					role: member.role,
					tenantId: member.tenantId ?? null,
					storeIds: member.storeIds ?? null,
					storeNames: member.stores,
				},
				new Date(),
			)
			.then(async (context) => {
				const store = context.stores.find(
					(candidate) => candidate.id === storeId,
				);
				if (store === undefined)
					return {
						status: "ready" as const,
						context,
						store,
						checklists: [],
						counts: [],
					};
				const [checklists, counts] = await Promise.all([
					source.ops.dueChecklists(store.id),
					source.ops.cashCounts(store.id, store.today),
				]);
				return { status: "ready" as const, context, store, checklists, counts };
			})
			.then(
				(ready) => {
					if (active) setLoad(ready);
				},
				() => {
					if (active) setLoad({ status: "failed" });
				},
			);
		return () => {
			active = false;
		};
	}, [source, member, storeId]);
	useEffect(() => fetchCards(), [fetchCards]);
	const open = (target: ShiftOpen) =>
		navigate("/ca-lam", { state: { shiftOpen: target } });
	if (load.status === "loading") {
		return (
			<div
				role="status"
				aria-live="polite"
				className="col-span-2 rounded-2xl border border-line bg-surface-raised p-4 text-base text-ink-muted"
				data-testid="home-tasks-loading"
			>
				{t("homeTasks.loading")}
			</div>
		);
	}
	if (load.status === "failed") {
		return (
			<div
				className="col-span-2 flex items-center justify-between gap-2 rounded-2xl border border-line bg-surface-raised py-2 pr-2 pl-4"
				data-testid="home-tasks-failed"
			>
				<p className="text-base text-ink-muted">{t("homeTasks.failed")}</p>
				<button type="button" className={quietAction} onClick={fetchCards}>
					{t("ops.retry")}
				</button>
			</div>
		);
	}
	return (
		<ReadyCards load={load} memberId={source.ops.memberId} onOpen={open} />
	);
}
