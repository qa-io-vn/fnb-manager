import type {
	CashCountRecord,
	CashCountRow,
	DueChecklist,
	Handover,
	Incident,
	IncidentCategory,
	IncidentKind,
	StoredSession,
} from "@fnb/zalo-mini";
import {
	SessionScreen,
	useDataEndpoint,
	useI18n,
	useSession,
} from "@fnb/zalo-mini/react";
import {
	type ReactNode,
	useCallback,
	useEffect,
	useId,
	useMemo,
	useRef,
	useState,
} from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { ChecklistCards } from "../checklists/checklist-cards";
import {
	ChecklistRunScreen,
	type RunRequest,
} from "../checklists/checklist-run";
import { ReportForm } from "../incidents/report-form";
import { HandoverList, IncidentList } from "../incidents/review-lists";
import { CashReview } from "../shift-close/cash-review";
import { CloseFlow } from "../shift-close/close-flow";
import { primaryButton, secondaryButton } from "../ui";
import { failureKey, ShiftEnvProvider, useRecover, useShiftEnv } from "./env";
import {
	canManage,
	type Failure,
	isoDateShift,
	phaseAt,
	primaryTarget,
} from "./model";
import {
	Alert,
	Card,
	Chip,
	focusRing,
	Loading,
	OfflineBanner,
	Panel,
} from "./parts";
import {
	type ShiftContext,
	type ShiftSource,
	type ShiftSourceFactory,
	type ShiftStore,
	shiftSourceFor,
} from "./source";

export const SHIFT_STALE_MS = 60_000;

export type ShiftOpen =
	| {
			readonly kind: "checklist";
			readonly storeId: string;
			readonly templateId: string;
	  }
	| { readonly kind: "close"; readonly storeId: string }
	| { readonly kind: "board"; readonly storeId: string };

export function readShiftOpen(state: unknown): ShiftOpen | null {
	if (typeof state !== "object" || state === null) return null;
	const open = (state as { readonly shiftOpen?: unknown }).shiftOpen;
	if (typeof open !== "object" || open === null) return null;
	const value = open as Readonly<Record<string, unknown>>;
	if (typeof value.storeId !== "string") return null;
	if (value.kind === "checklist" && typeof value.templateId === "string")
		return {
			kind: "checklist",
			storeId: value.storeId,
			templateId: value.templateId,
		};
	if (value.kind === "close") return { kind: "close", storeId: value.storeId };
	if (value.kind === "board") return { kind: "board", storeId: value.storeId };
	return null;
}

type Part<T> =
	| { readonly ok: true; readonly data: T }
	| { readonly ok: false; readonly failure: Failure };

interface Board {
	readonly checklists: Part<DueChecklist[]>;
	readonly handovers: Part<Handover[]>;
	readonly incidents: Part<Incident[]>;
	readonly categories: Part<IncidentCategory[]>;
	readonly counts: Part<CashCountRecord[]>;
	readonly cash: Part<CashCountRow[]> | null;
}

type BoardLoad =
	| { readonly status: "loading" }
	| { readonly status: "ready"; readonly board: Board };

type View =
	| { readonly kind: "board" }
	| { readonly kind: "run"; readonly request: RunRequest }
	| { readonly kind: "close" }
	| { readonly kind: "report"; readonly incidentKind: IncidentKind };

function part<T>(
	work: Promise<T>,
	recover: (error: unknown) => Failure,
): Promise<Part<T>> {
	return work.then(
		(data) => ({ ok: true, data }),
		(error: unknown) => ({ ok: false, failure: recover(error) }),
	);
}

function useBoard(): { readonly load: BoardLoad; reload(): void } {
	const { ops, store, context, recover } = useShiftEnv();
	const [load, setLoad] = useState<BoardLoad>({ status: "loading" });
	const generation = useRef(0);
	const loadedAt = useRef(0);
	const manager = canManage(context.role);
	const reload = useCallback(() => {
		generation.current += 1;
		const current = generation.current;
		const since = isoDateShift(store.today, -1);
		Promise.all([
			part(ops.dueChecklists(store.id), recover),
			part(ops.handovers([store.id], since), recover),
			part(ops.incidents([store.id]), recover),
			part(
				context.tenantId === null
					? Promise.resolve([])
					: ops.incidentCategories(context.tenantId),
				recover,
			),
			part(ops.cashCounts(store.id, store.today), recover),
			manager
				? part(ops.cashCountReview([store.id], since, store.today), recover)
				: Promise.resolve(null),
		]).then(([checklists, handovers, incidents, categories, counts, cash]) => {
			if (generation.current !== current) return;
			loadedAt.current = Date.now();
			setLoad({
				status: "ready",
				board: { checklists, handovers, incidents, categories, counts, cash },
			});
		});
	}, [ops, store.id, store.today, context.tenantId, manager, recover]);
	useEffect(() => {
		setLoad({ status: "loading" });
		reload();
		const onVisible = () => {
			if (
				document.visibilityState === "visible" &&
				Date.now() - loadedAt.current > SHIFT_STALE_MS
			)
				reload();
		};
		document.addEventListener("visibilitychange", onVisible);
		return () => {
			generation.current += 1;
			document.removeEventListener("visibilitychange", onVisible);
		};
	}, [reload]);
	return { load, reload };
}

function PartFailed({
	failure,
	onRetry,
}: {
	readonly failure: Failure;
	readonly onRetry: () => void;
}) {
	const { t } = useI18n();
	return (
		<div className="flex flex-col gap-2">
			<Alert>{t(failureKey(failure))}</Alert>
			<button type="button" className={secondaryButton} onClick={onRetry}>
				{t("ops.retry")}
			</button>
		</div>
	);
}

function Section<T>({
	value,
	onRetry,
	children,
}: {
	readonly value: Part<T>;
	readonly onRetry: () => void;
	readonly children: (data: T) => ReactNode;
}) {
	return value.ok ? (
		children(value.data)
	) : (
		<PartFailed failure={value.failure} onRetry={onRetry} />
	);
}

const PHASE_KEYS = {
	opening: "ops.phase.opening",
	midshift: "ops.phase.midshift",
	closing: "ops.phase.closing",
} as const;

function StoreChooser({
	stores,
	selected,
	onSelect,
}: {
	readonly stores: readonly ShiftStore[];
	readonly selected: ShiftStore;
	readonly onSelect: (id: string) => void;
}) {
	const { t } = useI18n();
	const pickerId = useId();
	if (stores.length === 1) return null;
	return (
		<div className="flex flex-col gap-1">
			<label htmlFor={pickerId} className="text-sm text-ink-muted">
				{t("home.store")}
			</label>
			<select
				id={pickerId}
				data-testid="shift-store-picker"
				value={selected.id}
				onChange={(event) => onSelect(event.target.value)}
				className={`min-h-11 w-full rounded-field border-field border-line-strong bg-surface-raised px-4 py-2 text-base font-semibold text-ink ${focusRing}`}
			>
				{stores.map((store) => (
					<option key={store.id} value={store.id}>
						{store.name}
					</option>
				))}
			</select>
		</div>
	);
}

function latestCount(
	records: readonly CashCountRecord[],
): CashCountRecord | undefined {
	return records
		.filter((record) => record.status === "active")
		.sort((a, b) => b.countedAt.localeCompare(a.countedAt))[0];
}

function BoardView({
	board,
	onOpen,
	onReload,
}: {
	readonly board: Board;
	readonly onOpen: (view: View) => void;
	readonly onReload: () => void;
}) {
	const { t } = useI18n();
	const { store, memberId, manager, formatters } = useShiftEnv();
	const phase = phaseAt(store.openingHours, new Date(), store);
	const primary = board.checklists.ok
		? primaryTarget(board.checklists.data, phase, memberId)
		: ({ kind: "close" } as const);
	const categories = board.categories.ok ? board.categories.data : [];
	const counted = board.counts.ok ? latestCount(board.counts.data) : undefined;
	return (
		<div
			className="flex flex-col gap-6"
			data-testid="shift-board"
			data-phase={phase ?? "none"}
		>
			<Panel
				title={t("shift.checklists")}
				testId="panel-checklists"
				aside={
					phase === null ? null : (
						<Chip tone="accent" testId="shift-phase">
							{t("shift.phaseNow", { phase: t(PHASE_KEYS[phase]) })}
						</Chip>
					)
				}
			>
				<Section value={board.checklists} onRetry={onReload}>
					{(checklists) => (
						<ChecklistCards
							checklists={checklists}
							phase={phase}
							primary={primary}
							onOpen={(request) => onOpen({ kind: "run", request })}
						/>
					)}
				</Section>
			</Panel>
			<Panel title={t("shift.close")} testId="panel-close">
				<Card
					testId="close-card"
					state={counted === undefined ? "open" : "counted"}
				>
					<p className="text-body text-ink">{t("shift.closeBody")}</p>
					{counted !== undefined ? (
						<Chip tone="positive" testId="close-counted">
							{t("shift.countedAt", {
								time: formatters.time(new Date(counted.countedAt)),
							})}
						</Chip>
					) : null}
					<button
						type="button"
						className={
							primary.kind === "close" ? primaryButton : secondaryButton
						}
						{...(primary.kind === "close" ? { "data-action": "primary" } : {})}
						onClick={() => onOpen({ kind: "close" })}
						data-testid="open-close"
					>
						{t("shift.closeAction")}
					</button>
				</Card>
			</Panel>
			<Panel title={t("shift.reports")} testId="panel-reports">
				<div className="grid grid-cols-2 gap-3">
					<button
						type="button"
						className={secondaryButton}
						disabled={!board.categories.ok}
						onClick={() => onOpen({ kind: "report", incidentKind: "incident" })}
					>
						{t("shift.reportIncident")}
					</button>
					<button
						type="button"
						className={secondaryButton}
						disabled={!board.categories.ok}
						onClick={() =>
							onOpen({ kind: "report", incidentKind: "stock_out" })
						}
					>
						{t("shift.reportStockOut")}
					</button>
				</div>
				{board.categories.ok ? null : (
					<PartFailed failure={board.categories.failure} onRetry={onReload} />
				)}
				<Section value={board.incidents} onRetry={onReload}>
					{(incidents) => (
						<IncidentList
							incidents={incidents}
							categories={categories}
							onChanged={onReload}
						/>
					)}
				</Section>
			</Panel>
			<Panel title={t("shift.handovers")} testId="panel-handovers">
				<Section value={board.handovers} onRetry={onReload}>
					{(handovers) => (
						<HandoverList
							handovers={handovers.slice(0, 5)}
							onChanged={onReload}
						/>
					)}
				</Section>
			</Panel>
			{manager && board.cash !== null ? (
				<Panel title={t("shift.cash")} testId="panel-cash">
					<Section value={board.cash} onRetry={onReload}>
						{(rows) => <CashReview rows={rows} onChanged={onReload} />}
					</Section>
				</Panel>
			) : null}
		</div>
	);
}

function StoreShift({
	stores,
	initialView,
	onStore,
}: {
	readonly stores: readonly ShiftStore[];
	readonly initialView: View;
	readonly onStore: (id: string) => void;
}) {
	const { t } = useI18n();
	const { store, formatters } = useShiftEnv();
	const [view, setView] = useState<View>(initialView);
	const { load, reload } = useBoard();
	const headingId = useId();
	const back = useCallback(() => {
		setView({ kind: "board" });
		reload();
	}, [reload]);
	if (view.kind === "run")
		return <ChecklistRunScreen request={view.request} onBack={back} />;
	if (view.kind === "close") return <CloseFlow onBack={back} />;
	if (view.kind === "report") {
		const categories =
			load.status === "ready" && load.board.categories.ok
				? load.board.categories.data
				: [];
		return (
			<ReportForm
				kind={view.incidentKind}
				categories={categories}
				onBack={back}
			/>
		);
	}
	return (
		<section
			aria-labelledby={headingId}
			className="flex flex-col gap-5 px-4 pt-5 pb-8"
			data-testid="shift"
			data-status={load.status}
			data-store-id={store.id}
		>
			<header className="flex flex-col gap-0.5">
				<h1 id={headingId} className="text-xl font-semibold text-ink">
					{t("shift.title")}
				</h1>
				<p className="text-sm text-ink-muted">
					{t("shift.subtitle", {
						store: store.name,
						date: formatters.date(store.today),
					})}
				</p>
			</header>
			<StoreChooser stores={stores} selected={store} onSelect={onStore} />
			<OfflineBanner />
			{load.status === "loading" ? (
				<Loading label={t("shift.loading")} />
			) : (
				<BoardView board={load.board} onOpen={setView} onReload={reload} />
			)}
		</section>
	);
}

function viewFor(open: ShiftOpen | null): View {
	if (open?.kind === "checklist")
		return {
			kind: "run",
			request: { kind: "start", templateId: open.templateId },
		};
	if (open?.kind === "close") return { kind: "close" };
	return { kind: "board" };
}

function ReadyShift({
	source,
	context,
	session,
	open,
}: {
	readonly source: ShiftSource;
	readonly context: ShiftContext;
	readonly session: StoredSession;
	readonly open: ShiftOpen | null;
}) {
	const { t } = useI18n();
	const recover = useRecover(session);
	const [storeId, setStoreId] = useState<string | null>(open?.storeId ?? null);
	const [pending, setPending] = useState(open);
	useEffect(() => {
		setPending(null);
	}, []);
	const store =
		context.stores.find((candidate) => candidate.id === storeId) ??
		context.stores[0];
	if (store === undefined) {
		return (
			<section
				className="flex flex-col gap-3 px-4 pt-5 pb-8"
				data-testid="shift"
				data-status="no-stores"
			>
				<h1 className="text-xl font-semibold text-ink">{t("shift.title")}</h1>
				<p className="text-body text-ink-muted">{t("home.noStores")}</p>
			</section>
		);
	}
	const initialView =
		pending !== null && pending.storeId === store.id
			? viewFor(pending)
			: ({ kind: "board" } as const);
	return (
		<ShiftEnvProvider
			ops={source.ops}
			context={context}
			store={store}
			recover={recover}
		>
			<StoreShift
				key={store.id}
				stores={context.stores}
				initialView={initialView}
				onStore={setStoreId}
			/>
		</ShiftEnvProvider>
	);
}

type ContextLoad =
	| { readonly status: "loading" }
	| { readonly status: "ready"; readonly context: ShiftContext }
	| { readonly status: "failed"; readonly failure: Failure };

function SignedInShift({
	session,
	sourceFor,
}: {
	readonly session: StoredSession;
	readonly sourceFor: ShiftSourceFactory;
}) {
	const { t } = useI18n();
	const endpoint = useDataEndpoint();
	const recover = useRecover(session);
	const location = useLocation();
	const navigate = useNavigate();
	const openRef = useRef<ShiftOpen | null>(readShiftOpen(location.state));
	const member = session.member;
	const source = useMemo(
		() => sourceFor(endpoint, session),
		[sourceFor, endpoint, session],
	);
	const [load, setLoad] = useState<ContextLoad>({ status: "loading" });
	const fetchContext = useCallback(() => {
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
			.then(
				(context) => setLoad({ status: "ready", context }),
				(error: unknown) =>
					setLoad({ status: "failed", failure: recover(error) }),
			);
	}, [source, member, recover]);
	useEffect(() => {
		fetchContext();
	}, [fetchContext]);
	useEffect(() => {
		if (location.state !== null && location.state !== undefined)
			navigate(location.pathname, { replace: true, state: null });
	}, [location, navigate]);
	if (load.status === "ready") {
		return (
			<ReadyShift
				source={source}
				context={load.context}
				session={session}
				open={openRef.current}
			/>
		);
	}
	return (
		<section
			className="flex flex-col gap-4 px-4 pt-5 pb-8"
			data-testid="shift"
			data-status={load.status}
		>
			<h1 className="text-xl font-semibold text-ink">{t("shift.title")}</h1>
			{load.status === "loading" ? (
				<Loading label={t("shift.loading")} />
			) : (
				<>
					<Alert testId="shift-failed">{t(failureKey(load.failure))}</Alert>
					<button
						type="button"
						className={primaryButton}
						data-action="primary"
						onClick={fetchContext}
					>
						{t("ops.retry")}
					</button>
				</>
			)}
		</section>
	);
}

export function ShiftScreen({
	sourceFor = shiftSourceFor,
}: {
	readonly sourceFor?: ShiftSourceFactory;
}) {
	const { state } = useSession();
	if (state.status !== "signed-in") return <SessionScreen />;
	return (
		<SignedInShift
			key={state.session.accessToken}
			session={state.session}
			sourceFor={sourceFor}
		/>
	);
}
