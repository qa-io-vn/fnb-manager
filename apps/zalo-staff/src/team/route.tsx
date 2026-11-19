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
	useMemo,
	useRef,
	useState,
} from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { failureKey, useFormatters, useRecover } from "../shift/env";
import { canManage, type Failure } from "../shift/model";
import { Alert, Loading } from "../shift/parts";
import type { ShiftContext } from "../shift/source";
import { primaryButton } from "../ui";
import {
	readTeamOpen,
	type TeamEnv,
	TeamEnvProvider,
	type TeamOpen,
	type TeamPath,
	teamOpenState,
	whenIn,
} from "./env";
import {
	type TeamSource,
	type TeamSourceFactory,
	teamQuery,
	teamSourceFor,
} from "./source";

export interface TeamScreenProps {
	readonly open: TeamOpen;
}

type ContextLoad =
	| { readonly status: "loading" }
	| { readonly status: "ready"; readonly context: ShiftContext }
	| { readonly status: "failed"; readonly failure: Failure };

export function FrameMessage({
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

function ReadyTeam({
	source,
	context,
	session,
	open,
	Screen,
}: {
	readonly source: TeamSource;
	readonly context: ShiftContext;
	readonly session: StoredSession;
	readonly open: TeamOpen;
	readonly Screen: ComponentType<TeamScreenProps>;
}) {
	const navigate = useNavigate();
	const recover = useRecover(session);
	const formatters = useFormatters(context);
	const home = useCallback(() => navigate("/"), [navigate]);
	const go = useCallback(
		(path: TeamPath, target?: Partial<TeamOpen>) =>
			navigate(path, { state: teamOpenState(target ?? {}) }),
		[navigate],
	);
	const env = useMemo<TeamEnv>(
		() => ({
			client: source.client,
			context,
			memberId: source.memberId,
			role: context.role,
			manager: canManage(context.role),
			formatters,
			recover,
			storeName: (id) =>
				context.stores.find((store) => store.id === id)?.name ?? null,
			when: (iso) => whenIn(formatters, context.timeZone, iso),
			go,
			home,
		}),
		[source, context, formatters, recover, go, home],
	);
	return (
		<TeamEnvProvider value={env}>
			<Screen open={open} />
		</TeamEnvProvider>
	);
}

function SignedInTeam({
	session,
	sourceFor,
	titleKey,
	testId,
	Screen,
}: {
	readonly session: StoredSession;
	readonly sourceFor: TeamSourceFactory;
	readonly titleKey: string;
	readonly testId: string;
	readonly Screen: ComponentType<TeamScreenProps>;
}) {
	const { t } = useI18n();
	const endpoint = useDataEndpoint();
	const recover = useRecover(session);
	const location = useLocation();
	const navigate = useNavigate();
	const openRef = useRef<TeamOpen>(readTeamOpen(location.state));
	const source = useMemo(
		() => sourceFor(endpoint, session),
		[sourceFor, endpoint, session],
	);
	const [load, setLoad] = useState<ContextLoad>({ status: "loading" });
	const fetchContext = useCallback(() => {
		let active = true;
		setLoad({ status: "loading" });
		source.context(teamQuery(session), new Date()).then(
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
	}, [source, session, recover]);
	useEffect(() => fetchContext(), [fetchContext]);
	useEffect(() => {
		if (location.state !== null && location.state !== undefined)
			navigate(location.pathname, { replace: true, state: null });
	}, [location, navigate]);
	if (load.status === "ready") {
		return (
			<ReadyTeam
				source={source}
				context={load.context}
				session={session}
				open={openRef.current}
				Screen={Screen}
			/>
		);
	}
	return (
		<FrameMessage title={t(titleKey)} testId={testId} status={load.status}>
			{load.status === "loading" ? (
				<Loading label={t("team.loading")} />
			) : (
				<>
					<Alert testId="team-failed">{t(failureKey(load.failure))}</Alert>
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

export function TeamRoute({
	titleKey,
	testId,
	screen,
	sourceFor = teamSourceFor,
}: {
	readonly titleKey: string;
	readonly testId: string;
	readonly screen: ComponentType<TeamScreenProps>;
	readonly sourceFor?: TeamSourceFactory;
}) {
	const { state } = useSession();
	if (state.status !== "signed-in") return <SessionScreen />;
	return (
		<SignedInTeam
			key={`${testId}:${state.session.accessToken}`}
			session={state.session}
			sourceFor={sourceFor}
			titleKey={titleKey}
			testId={testId}
			Screen={screen}
		/>
	);
}
