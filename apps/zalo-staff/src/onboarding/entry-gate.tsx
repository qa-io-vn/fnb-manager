import config from "virtual:mini-app-config";
import type {
	NoticeAcceptance,
	SessionState,
	StoredSession,
} from "@fnb/zalo-mini";
import {
	ResultModal,
	useDataEndpoint,
	useI18n,
	useSession,
} from "@fnb/zalo-mini/react";
import {
	createContext,
	type ReactNode,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useReducer,
	useState,
} from "react";
import { useNavigate } from "react-router-dom";
import type { LegalLoader } from "../legal/legal";
import {
	type StaffAccount,
	type StaffAccountFactory,
	sessionRefused,
	staffAccountFor,
} from "./account";
import {
	type EntryResult,
	entryReducer,
	entryScreen,
	initialEntryUi,
	type MemberCheck,
	type NoticeCheck,
	RESULT_KEYS,
} from "./model";
import {
	ConnectingScreen,
	FailedScreen,
	NoNoticeScreen,
	NoticeScreen,
	OnboardingScreen,
	PairingScreen,
	RefusalScreen,
} from "./screens";

export interface EntryValue {
	readonly account: StaffAccount | null;
	readonly check: NoticeCheck | null;
	readonly loadLegal: LegalLoader;
	showResult(result: EntryResult): void;
}

const EntryContext = createContext<EntryValue>({
	account: null,
	check: null,
	loadLegal: async () => null,
	showResult: () => undefined,
});

export function useEntry(): EntryValue {
	return useContext(EntryContext);
}

interface Checked {
	readonly token: string;
	readonly check: NoticeCheck | null;
}

function useMemberCheck(
	session: StoredSession | null,
	account: StaffAccount | null,
	expire: () => void,
): readonly [MemberCheck, (check: NoticeCheck) => void] {
	const [checked, setChecked] = useState<Checked | null>(null);
	const token = session?.accessToken ?? "";
	const needed = session !== null && session.member.tenantId !== undefined;
	useEffect(() => {
		if (!needed || account === null) return;
		let active = true;
		account.noticeCheck().then(
			(check) => {
				if (active) setChecked({ token, check });
			},
			(error: unknown) => {
				if (!active) return;
				if (sessionRefused(error)) expire();
				else setChecked({ token, check: null });
			},
		);
		return () => {
			active = false;
		};
	}, [needed, account, token, expire]);
	const settle = useCallback(
		(check: NoticeCheck) => setChecked({ token, check }),
		[token],
	);
	const member: MemberCheck = !needed
		? { status: "done", check: null }
		: checked?.token === token
			? { status: "done", check: checked.check }
			: { status: "checking" };
	return [member, settle];
}

export function EntryGate({
	children,
	accountFor = staffAccountFor,
}: {
	readonly children: ReactNode;
	readonly accountFor?: StaffAccountFactory;
}) {
	const { t } = useI18n();
	const session = useSession();
	const { state, expire, texts } = session;
	const endpoint = useDataEndpoint();
	const navigate = useNavigate();
	const [ui, dispatch] = useReducer(entryReducer, initialEntryUi);
	const [memberBusy, setMemberBusy] = useState(false);
	const [memberFailed, setMemberFailed] = useState(false);
	const [answered, setAnswered] = useState<SessionState | null>(null);

	if (answered !== state) {
		setAnswered(state);
		dispatch({ type: "answer", state, at: Date.now() });
	}

	const signedIn = state.status === "signed-in" ? state.session : null;
	const account = useMemo(
		() => (signedIn === null ? null : accountFor(endpoint, signedIn)),
		[accountFor, endpoint, signedIn],
	);
	const [member, settle] = useMemberCheck(signedIn, account, expire);
	const screen = entryScreen(state, ui, member);

	useEffect(() => {
		if (ui.result === "paired") navigate("/");
	}, [ui.result, navigate]);

	const showResult = useCallback(
		(result: EntryResult) => dispatch({ type: "result", result }),
		[],
	);
	const resultShown = useCallback(() => dispatch({ type: "resultShown" }), []);
	const loadLegal = useCallback<LegalLoader>(
		() =>
			account !== null && endpoint.kind === "supabase"
				? account.legalDocuments()
				: texts().then((found) => found?.documents ?? null),
		[account, endpoint, texts],
	);
	const value = useMemo<EntryValue>(
		() => ({
			account,
			check: member.status === "done" ? member.check : null,
			loadLegal,
			showResult,
		}),
		[account, member, loadLegal, showResult],
	);

	const agree = (acceptance: NoticeAcceptance) => {
		if (screen.kind !== "notice") return;
		if (screen.via === "pairing") {
			dispatch({ type: "accept", acceptance });
			return;
		}
		if (screen.via === "session") {
			dispatch({ type: "submit", kind: "accept" });
			session.acceptNotice(acceptance);
			return;
		}
		if (account === null) return;
		const notice = screen.notice;
		setMemberBusy(true);
		setMemberFailed(false);
		account.acceptNotice(acceptance).then(
			() => {
				setMemberBusy(false);
				settle({ consent: "current", notice });
				showResult("accepted");
			},
			(error: unknown) => {
				setMemberBusy(false);
				if (sessionRefused(error)) expire();
				else setMemberFailed(true);
			},
		);
	};

	const view = (() => {
		switch (screen.kind) {
			case "app":
				return null;
			case "onboarding":
				return (
					<OnboardingScreen
						appName={config.app.title}
						onContinue={session.start}
						loadLegal={loadLegal}
					/>
				);
			case "connecting":
				return <ConnectingScreen />;
			case "failed":
				return <FailedScreen onRetry={session.retry} />;
			case "no-notice":
				return <NoNoticeScreen onRetry={session.retry} />;
			case "notice":
				return (
					<NoticeScreen
						key={`${screen.via}:${screen.notice.version}`}
						notice={screen.notice}
						updated={screen.updated}
						via={screen.via}
						busy={screen.via === "member" ? memberBusy : session.busy}
						failed={screen.via === "member" && memberFailed}
						onAgree={agree}
						onDecline={() => dispatch({ type: "decline" })}
					/>
				);
			case "pairing":
				return (
					<PairingScreen
						code={ui.code}
						refused={screen.refused}
						waitUntil={screen.waitUntil}
						busy={session.busy}
						onCode={(code) => dispatch({ type: "code", code })}
						onSubmit={(code) => {
							if (ui.accepted === null) return;
							dispatch({ type: "submit", kind: "pair" });
							session.pair(code, ui.accepted);
						}}
						onBack={() => dispatch({ type: "review" })}
					/>
				);
			case "refused":
				return (
					<RefusalScreen
						contact={screen.contact}
						onReview={() => dispatch({ type: "review" })}
					/>
				);
		}
	})();

	return (
		<EntryContext.Provider value={value}>
			{view === null ? (
				children
			) : (
				<main className="flex-1" data-testid="entry">
					{view}
				</main>
			)}
			{ui.result === null ? null : (
				<ResultModal
					key={ui.result}
					message={t(RESULT_KEYS[ui.result])}
					onDone={resultShown}
				/>
			)}
		</EntryContext.Provider>
	);
}
