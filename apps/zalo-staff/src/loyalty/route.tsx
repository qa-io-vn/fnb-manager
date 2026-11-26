import type { StoredSession } from "@fnb/zalo-mini";
import {
	SessionScreen,
	useDataEndpoint,
	useI18n,
	useSession,
} from "@fnb/zalo-mini/react";
import {
	type ComponentType,
	type ReactNode,
	useCallback,
	useEffect,
	useId,
	useMemo,
	useRef,
	useState,
} from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { BillTexts } from "../bills/texts";
import { failureKey, useFormatters, useRecover } from "../shift/env";
import type { Failure } from "../shift/model";
import {
	Alert,
	Chip,
	focusRing,
	Loading,
	OfflineBanner,
	SubScreen,
} from "../shift/parts";
import type { ShiftContext } from "../shift/source";
import { primaryButton } from "../ui";
import {
	type LoyaltyEnv,
	LoyaltyEnvProvider,
	type LoyaltyOpen,
	type LoyaltyPath,
	readLoyaltyOpen,
	useLoyaltyEnv,
} from "./env";
import { canManageQueue, canUseTill } from "./model";
import {
	type LoyaltySource,
	type LoyaltySourceFactory,
	loyaltySourceFor,
} from "./source";

export interface LoyaltyScreenProps {
	readonly open: LoyaltyOpen;
}

type ContextLoad =
	| { readonly status: "loading" }
	| { readonly status: "ready"; readonly context: ShiftContext }
	| { readonly status: "failed"; readonly failure: Failure };

export function LoyaltyFrame({
	title,
	testId,
	onBack,
	backDisabled = false,
	children,
}: {
	readonly title: string;
	readonly testId: string;
	readonly onBack?: () => void;
	readonly backDisabled?: boolean;
	readonly children: ReactNode;
}) {
	const { t } = useI18n();
	const env = useLoyaltyEnv();
	const pickerId = useId();
	return (
		<SubScreen
			title={title}
			subtitle={env.store.name}
			onBack={onBack ?? env.home}
			backDisabled={backDisabled}
			testId={testId}
		>
			{env.context.stores.length > 1 ? (
				<div className="flex flex-col gap-1">
					<label htmlFor={pickerId} className="text-sm text-ink-muted">
						{t("home.store")}
					</label>
					<select
						id={pickerId}
						data-testid="loyalty-store-picker"
						value={env.store.id}
						disabled={backDisabled}
						onChange={(event) => env.selectStore(event.target.value)}
						className={`min-h-11 w-full rounded-field border-field border-line-strong bg-surface-raised px-4 py-2 text-base font-semibold text-ink ${focusRing}`}
					>
						{env.context.stores.map((store) => (
							<option key={store.id} value={store.id}>
								{store.name}
							</option>
						))}
					</select>
				</div>
			) : null}
			{env.sampleBadge ? (
				<Chip tone="warning" testId="loyalty-sample">
					{t("loyalty.sample")}
				</Chip>
			) : null}
			<OfflineBanner />
			{children}
		</SubScreen>
	);
}

function FrameMessage({
	title,
	testId,
	status,
	children,
}: {
	readonly title: string;
	readonly testId: string;
	readonly status: string;
	readonly children: ReactNode;
}) {
	return (
		<section
			className="flex flex-col gap-4 px-4 pt-5 pb-8"
			data-testid={testId}
			data-status={status}
		>
			<h1 className="text-xl font-semibold text-ink">{title}</h1>
			{children}
		</section>
	);
}

function ReadyLoyalty({
	source,
	context,
	session,
	open,
	titleKey,
	testId,
	Screen,
}: {
	readonly source: LoyaltySource;
	readonly context: ShiftContext;
	readonly session: StoredSession;
	readonly open: LoyaltyOpen;
	readonly titleKey: string;
	readonly testId: string;
	readonly Screen: ComponentType<LoyaltyScreenProps>;
}) {
	const { t } = useI18n();
	const navigate = useNavigate();
	const recover = useRecover(session);
	const formatters = useFormatters(context);
	const [storeId, setStoreId] = useState<string | null>(open.storeId);
	const store =
		context.stores.find((candidate) => candidate.id === storeId) ??
		context.stores[0];
	const home = useCallback(() => navigate("/"), [navigate]);
	const go = useCallback(
		(path: LoyaltyPath, membershipId?: string) =>
			navigate(path, {
				state: {
					loyalty: {
						storeId: store?.id ?? null,
						membershipId: membershipId ?? null,
					},
				},
			}),
		[navigate, store?.id],
	);
	const env = useMemo<LoyaltyEnv | null>(
		() =>
			store === undefined
				? null
				: {
						client: source.client,
						bills: source.bills,
						context,
						store,
						role: context.role,
						manager: canManageQueue(context.role),
						formatters,
						sampleBadge: source.sampleBadge,
						recover,
						selectStore: setStoreId,
						open: go,
						home,
					},
		[source, context, store, formatters, recover, go, home],
	);
	if (env === null || !canUseTill(context.role)) {
		return (
			<FrameMessage title={t(titleKey)} testId={testId} status="no-stores">
				<p className="text-body text-ink-muted">
					{env === null ? t("home.noStores") : t("loyalty.notForRole")}
				</p>
				<button
					type="button"
					className={primaryButton}
					data-action="primary"
					onClick={home}
				>
					{t("loyalty.backHome")}
				</button>
			</FrameMessage>
		);
	}
	return (
		<LoyaltyEnvProvider value={env}>
			<Screen
				key={env.store.id}
				open={
					open.storeId === null || open.storeId === env.store.id
						? open
						: { storeId: env.store.id, membershipId: null }
				}
			/>
		</LoyaltyEnvProvider>
	);
}

function SignedInLoyalty({
	session,
	sourceFor,
	titleKey,
	testId,
	Screen,
}: {
	readonly session: StoredSession;
	readonly sourceFor: LoyaltySourceFactory;
	readonly titleKey: string;
	readonly testId: string;
	readonly Screen: ComponentType<LoyaltyScreenProps>;
}) {
	const { t } = useI18n();
	const endpoint = useDataEndpoint();
	const recover = useRecover(session);
	const location = useLocation();
	const navigate = useNavigate();
	const openRef = useRef<LoyaltyOpen>(readLoyaltyOpen(location.state));
	const member = session.member;
	const source = useMemo(
		() => sourceFor(endpoint, session),
		[sourceFor, endpoint, session],
	);
	const [load, setLoad] = useState<ContextLoad>({ status: "loading" });
	const fetchContext = useCallback(() => {
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
			.then(
				(context) => {
					if (active) setLoad({ status: "ready", context });
				},
				(error: unknown) => {
					if (active) setLoad({ status: "failed", failure: recover(error) });
				},
			);
		return () => {
			active = false;
		};
	}, [source, member, recover]);
	useEffect(() => fetchContext(), [fetchContext]);
	useEffect(() => {
		if (location.state !== null && location.state !== undefined)
			navigate(location.pathname, { replace: true, state: null });
	}, [location, navigate]);
	if (load.status === "ready") {
		return (
			<ReadyLoyalty
				source={source}
				context={load.context}
				session={session}
				open={openRef.current}
				titleKey={titleKey}
				testId={testId}
				Screen={Screen}
			/>
		);
	}
	return (
		<FrameMessage title={t(titleKey)} testId={testId} status={load.status}>
			{load.status === "loading" ? (
				<Loading label={t("loyalty.loading")} />
			) : (
				<>
					<Alert testId="loyalty-failed">{t(failureKey(load.failure))}</Alert>
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
		</FrameMessage>
	);
}

export function LoyaltyRoute({
	titleKey,
	testId,
	screen,
	sourceFor = loyaltySourceFor,
}: {
	readonly titleKey: string;
	readonly testId: string;
	readonly screen: ComponentType<LoyaltyScreenProps>;
	readonly sourceFor?: LoyaltySourceFactory;
}) {
	const { state } = useSession();
	if (state.status !== "signed-in") return <SessionScreen />;
	return (
		<BillTexts>
			<SignedInLoyalty
				key={`${testId}:${state.session.accessToken}`}
				session={state.session}
				sourceFor={sourceFor}
				titleKey={titleKey}
				testId={testId}
				Screen={screen}
			/>
		</BillTexts>
	);
}
