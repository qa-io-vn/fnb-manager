import { useI18n } from "@fnb/zalo-mini/react";
import { useEffect, useId, useReducer, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { followOA, getPhoneNumber } from "zmp-sdk";
import { useCustomerData } from "../data/customer-data";
import { isoDateIn } from "../data/dates";
import { useStoreLink } from "../data/store-link";
import type { DeclineReason, HomeLocationState } from "../home/home-screen";
import { JoinClosedNote } from "../home/join-actions";
import {
	type JoinableHome,
	type JoinBlock,
	joinableHome,
	joinBlock,
	storeByCode,
} from "../home/model";
import { retentionText } from "../home/programme";
import { useLegalPopup } from "../legal/legal-popups";
import {
	BackButton,
	Card,
	CheckControl,
	Failed,
	Loading,
	primaryButton,
	quietButton,
	Screen,
	Spinner,
	secondaryButton,
} from "../ui";
import {
	canSubmit,
	initialJoinState,
	JOIN_SCREEN_VERSION,
	type JoinNext,
	type JoinState,
	joinReducer,
	problemOf,
} from "./model";

export interface JoinLocationState {
	readonly next?: JoinNext;
}

export type PhoneRequest = () => Promise<{ readonly token?: string }>;

const defaultPhoneRequest: PhoneRequest = () => getPhoneNumber();

function PurposeScreen({
	home,
	next,
	onContinue,
	onLater,
}: {
	readonly home: JoinableHome;
	readonly next: JoinNext;
	readonly onContinue: () => void;
	readonly onLater: () => void;
}) {
	const { t } = useI18n();
	const { open, popup } = useLegalPopup();
	return (
		<Screen testId="join-purpose">
			<BackButton to="/" />
			<h1 className="text-xl font-semibold text-ink">
				{t(next === "claim" ? "join.purpose.titleClaim" : "join.purpose.title")}
			</h1>
			<p className="text-base text-ink">
				{t("join.purpose.intro", { programme: home.programme.name })}
			</p>
			<dl className="flex flex-col gap-3 rounded-2xl bg-surface-raised p-4">
				<div className="flex flex-col gap-0.5">
					<dt className="text-sm text-ink-muted">
						{t("join.purpose.whatLabel")}
					</dt>
					<dd className="text-base text-ink">{t("join.purpose.what")}</dd>
				</div>
				<div className="flex flex-col gap-0.5">
					<dt className="text-sm text-ink-muted">
						{t("join.purpose.whyLabel")}
					</dt>
					<dd className="text-base text-ink">{t("join.purpose.why")}</dd>
				</div>
				<div className="flex flex-col gap-0.5">
					<dt className="text-sm text-ink-muted">
						{t("join.purpose.howLongLabel")}
					</dt>
					<dd className="text-base text-ink">
						{retentionText(home.programme, t)}
					</dd>
				</div>
				<div className="flex flex-col gap-0.5">
					<dt className="text-sm text-ink-muted">
						{t("join.purpose.whoLabel")}
					</dt>
					<dd className="text-base text-ink">
						{home.legal.entityName ?? t("join.entityUnknown")}
					</dd>
				</div>
			</dl>
			<p className="text-sm text-ink-muted">{t("join.purpose.zaloAsks")}</p>
			<button
				type="button"
				className={quietButton}
				onClick={() => open("privacy_notice")}
			>
				{t("join.purpose.readPrivacy")}
			</button>
			<div className="flex flex-col gap-2">
				<button type="button" className={primaryButton} onClick={onContinue}>
					{t("join.purpose.continue")}
				</button>
				<button type="button" className={secondaryButton} onClick={onLater}>
					{t("join.purpose.later")}
				</button>
			</div>
			{popup}
		</Screen>
	);
}

function ConsentScreen({
	home,
	state,
	onLoyalty,
	onMarketing,
	onSubmit,
	onCancel,
}: {
	readonly home: JoinableHome;
	readonly state: Extract<JoinState, { step: "consent" }>;
	readonly onLoyalty: (value: boolean) => void;
	readonly onMarketing: (value: boolean) => void;
	readonly onSubmit: () => void;
	readonly onCancel: () => void;
}) {
	const { t } = useI18n();
	const { open, popup } = useLegalPopup();
	const loyaltyId = useId();
	const marketingId = useId();
	const marketingHint = useId();
	return (
		<Screen testId="join-consent">
			<h1 className="text-xl font-semibold text-ink">
				{t("join.consent.title")}
			</h1>
			<Card>
				<div className="flex items-start gap-3">
					<CheckControl
						id={loyaltyId}
						kind="checkbox"
						checked={state.loyalty}
						disabled={state.busy}
						onChange={onLoyalty}
						testId="consent-loyalty"
					/>
					<label htmlFor={loyaltyId} className="pt-2 text-base text-ink">
						{t("join.consent.loyalty", {
							entity: home.legal.entityName ?? t("join.entityUnknown"),
						})}
					</label>
				</div>
				<div className="flex items-start gap-3">
					<CheckControl
						id={marketingId}
						kind="switch"
						checked={state.marketing}
						disabled={state.busy}
						describedBy={marketingHint}
						onChange={onMarketing}
						testId="consent-marketing"
					/>
					<div className="flex flex-col gap-0.5 pt-2">
						<label htmlFor={marketingId} className="text-base text-ink">
							{t("join.consent.marketing")}
						</label>
						<p id={marketingHint} className="text-sm text-ink-muted">
							{t("join.consent.marketingHint")}
						</p>
					</div>
				</div>
			</Card>
			<p className="text-sm text-ink-muted" data-testid="policy-version">
				{t("join.consent.policyVersion", { version: home.legal.policyVersion })}
			</p>
			<button
				type="button"
				className={quietButton}
				onClick={() => open("privacy_notice")}
			>
				{t("join.purpose.readPrivacy")}
			</button>
			{state.problem === null ? null : (
				<p
					role="alert"
					className="text-base text-negative"
					data-testid="join-problem"
				>
					{t(`join.problem.${state.problem}`)}
				</p>
			)}
			<div className="flex flex-col gap-2">
				<button
					type="button"
					className={primaryButton}
					disabled={!canSubmit(state)}
					aria-busy={state.busy}
					onClick={onSubmit}
				>
					{state.busy ? <Spinner /> : null}
					{state.busy ? t("join.consent.joining") : t("join.consent.join")}
				</button>
				<button
					type="button"
					className={secondaryButton}
					disabled={state.busy}
					onClick={onCancel}
				>
					{t("join.consent.cancel")}
				</button>
			</div>
			{popup}
		</Screen>
	);
}

function JoinClosedScreen({ block }: { readonly block: JoinBlock }) {
	const { t } = useI18n();
	return (
		<Screen testId="join-unavailable">
			<BackButton to="/" />
			<h1 className="text-xl font-semibold text-ink">
				{t("join.closed.title")}
			</h1>
			<JoinClosedNote block={block} />
		</Screen>
	);
}

function JoinedScreen({
	home,
	state,
	onFollow,
	onDone,
}: {
	readonly home: JoinableHome;
	readonly state: Extract<JoinState, { step: "joined" }>;
	readonly onFollow: () => void;
	readonly onDone: () => void;
}) {
	const { t } = useI18n();
	const followed = state.follow === "done";
	const showFollow = home.oaId !== null && state.follow !== "skipped";
	return (
		<Screen testId="join-done">
			<div role="status" className="flex flex-col gap-2">
				<h1 className="text-xl font-semibold text-ink">
					{state.alreadyMember
						? t("join.done.alreadyTitle")
						: t("join.done.title")}
				</h1>
				{state.welcomeStamps > 0 ? (
					<p className="text-base text-ink" data-testid="welcome-stamps">
						{t("join.done.welcome", { count: state.welcomeStamps })}
					</p>
				) : null}
			</div>
			{showFollow ? (
				<Card testId="follow-oa">
					<h2 className="text-lg font-semibold text-ink">
						{t("join.follow.title")}
					</h2>
					<p className="text-base text-ink">{t("join.follow.body")}</p>
					{followed ? (
						<p className="text-base text-positive" data-testid="follow-done">
							{t("join.follow.done")}
						</p>
					) : (
						<button
							type="button"
							className={primaryButton}
							disabled={state.follow === "busy"}
							aria-busy={state.follow === "busy"}
							onClick={onFollow}
						>
							{state.follow === "busy" ? <Spinner /> : null}
							{t("join.follow.action")}
						</button>
					)}
				</Card>
			) : null}
			<button
				type="button"
				className={showFollow && !followed ? secondaryButton : primaryButton}
				onClick={onDone}
			>
				{showFollow && !followed
					? t("join.follow.skip")
					: t("join.done.continue")}
			</button>
		</Screen>
	);
}

export function JoinFlow({
	requestPhone,
}: {
	readonly requestPhone?: PhoneRequest;
}) {
	const navigate = useNavigate();
	const location = useLocation();
	const next = (location.state as JoinLocationState | null)?.next ?? "card";
	const { home, reloadHome, join, member } = useCustomerData();
	const { currentStore } = useStoreLink();
	const [state, dispatch] = useReducer(joinReducer, initialJoinState);
	const phone = requestPhone ?? defaultPhoneRequest;
	const mounted = useRef(true);
	useEffect(() => {
		mounted.current = true;
		return () => {
			mounted.current = false;
		};
	}, []);

	useEffect(() => {
		if (member && state.step === "purpose") {
			navigate(next === "claim" ? "/nhan-diem" : "/the-thanh-vien", {
				replace: true,
			});
		}
	}, [member, state.step, next, navigate]);

	if (home.status === "loading") return <Loading />;
	if (home.status === "failed")
		return <Failed failure={home.failure} onRetry={reloadHome} />;
	const today = isoDateIn(Date.now());
	const data = joinableHome(home.data, today);
	if (data === null || (member && state.step !== "joined")) {
		return member ? (
			<Loading />
		) : (
			<JoinClosedScreen block={joinBlock(home.data, today) ?? "no-programme"} />
		);
	}

	const decline = (reason: DeclineReason) => {
		const homeState: HomeLocationState = { declined: reason };
		navigate("/", { state: homeState, replace: true });
	};

	const submit = async () => {
		if (state.step !== "consent" || !canSubmit(state)) return;
		dispatch({ type: "submit" });
		let token: string | undefined;
		try {
			token = (await phone()).token;
		} catch {
			token = undefined;
		}
		if (!mounted.current) return;
		if (token === undefined || token === "") {
			decline("phone");
			return;
		}
		const result = await join({
			phoneToken: token,
			loyaltyConsent: true,
			marketingConsent: state.marketing,
			policyVersion: data.legal.policyVersion,
			screenVersion: JOIN_SCREEN_VERSION,
			store: storeByCode(data.stores, currentStore)?.code ?? null,
			shownAt: state.shownAt,
		});
		if (!mounted.current) return;
		if (result.ok) {
			dispatch({
				type: "joined",
				welcomeStamps: result.joined.welcomeStamps,
				alreadyMember: result.joined.alreadyMember,
			});
			return;
		}
		const problem = problemOf(result.failure);
		if (
			problem === "policy-outdated" ||
			problem === "no-programme" ||
			problem === "unknown"
		)
			reloadHome();
		dispatch({ type: "failed", problem });
	};

	const follow = async () => {
		if (data.oaId === null) return;
		dispatch({ type: "follow", state: "busy" });
		try {
			await followOA({ id: data.oaId });
			if (mounted.current) dispatch({ type: "follow", state: "done" });
		} catch {
			if (mounted.current) dispatch({ type: "follow", state: "skipped" });
		}
	};

	switch (state.step) {
		case "purpose":
			return (
				<PurposeScreen
					home={data}
					next={next}
					onContinue={() => dispatch({ type: "continue", at: Date.now() })}
					onLater={() => decline("purpose")}
				/>
			);
		case "consent":
			return (
				<ConsentScreen
					home={data}
					state={state}
					onLoyalty={(value) => dispatch({ type: "loyalty", value })}
					onMarketing={(value) => dispatch({ type: "marketing", value })}
					onSubmit={submit}
					onCancel={() => decline("consent")}
				/>
			);
		case "joined":
			return (
				<JoinedScreen
					home={data}
					state={state}
					onFollow={follow}
					onDone={() =>
						navigate(next === "claim" ? "/nhan-diem" : "/the-thanh-vien", {
							replace: true,
						})
					}
				/>
			);
	}
}
