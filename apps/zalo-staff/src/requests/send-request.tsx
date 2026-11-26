import { ResultModal, useI18n } from "@fnb/zalo-mini/react";
import { type FormEvent, useCallback, useId, useState } from "react";
import { failureKey } from "../shift/env";
import type { Failure } from "../shift/model";
import {
	Alert,
	BusyLabel,
	fieldClass,
	Hint,
	Loading,
	SubScreen,
} from "../shift/parts";
import { TEAM_PATHS, useLoad, useTeamAction, useTeamEnv } from "../team/env";
import type { TeamScreenProps } from "../team/route";
import { primaryButton, secondaryButton } from "../ui";
import { MAX_DETAILS_LENGTH, type RequestKind } from "./contract";
import { ChoiceOption } from "./parts";

export type RequestProblem = "kind" | "empty" | "long";

export function requestProblems(
	kindKey: string | null,
	details: string,
): RequestProblem[] {
	const problems: RequestProblem[] = [];
	if (kindKey === null) problems.push("kind");
	const text = details.trim();
	if (text === "") problems.push("empty");
	else if (text.length > MAX_DETAILS_LENGTH) problems.push("long");
	return problems;
}

function sendFailureKey(failure: Failure): string {
	if (failure === "invalid") return "ask.error.kind";
	if (failure === "check") return "ask.problem.empty";
	if (failure === "not-allowed") return "ask.error.notAllowed";
	return failureKey(failure);
}

function SendForm({
	kinds,
	initialStoreId,
}: {
	readonly kinds: readonly RequestKind[];
	readonly initialStoreId: string | null;
}) {
	const { t } = useI18n();
	const { client, context, go } = useTeamEnv();
	const action = useTeamAction();
	const storeId = useId();
	const legendId = useId();
	const radioName = useId();
	const detailsId = useId();
	const [store, setStore] = useState<string>(
		context.stores.find((candidate) => candidate.id === initialStoreId)?.id ??
			context.stores[0]?.id ??
			"",
	);
	const [kindKey, setKindKey] = useState<string | null>(null);
	const [details, setDetails] = useState("");
	const [problems, setProblems] = useState<readonly RequestProblem[]>([]);
	const [sent, setSent] = useState(false);
	const busy = action.busy;
	const touch = () => {
		setProblems([]);
		action.clear();
	};
	const submit = async (event: FormEvent) => {
		event.preventDefault();
		if (busy) return;
		const found = requestProblems(kindKey, details);
		if (found.length > 0 || kindKey === null) {
			setProblems(found);
			return;
		}
		const result = await action.run(() =>
			client.submit({ storeId: store, kindKey, details }),
		);
		if (result.ok) setSent(true);
	};
	return (
		<form
			className="flex flex-col gap-4"
			onSubmit={(event) => void submit(event)}
			noValidate
		>
			{context.stores.length > 1 ? (
				<div className="flex flex-col gap-1">
					<label htmlFor={storeId} className="text-sm text-ink-muted">
						{t("home.store")}
					</label>
					<select
						id={storeId}
						data-testid="ask-store"
						value={store}
						disabled={busy}
						onChange={(event) => {
							setStore(event.target.value);
							touch();
						}}
						className={fieldClass}
					>
						{context.stores.map((candidate) => (
							<option key={candidate.id} value={candidate.id}>
								{candidate.name}
							</option>
						))}
					</select>
				</div>
			) : null}
			<fieldset
				className="flex flex-col gap-2"
				aria-labelledby={legendId}
				data-testid="ask-kinds"
			>
				<legend id={legendId} className="mb-1 text-sm text-ink-muted">
					{t("ask.kind")}
				</legend>
				{kinds.map((kind) => (
					<ChoiceOption
						key={kind.key}
						name={radioName}
						value={kind.key}
						label={kind.label}
						checked={kindKey === kind.key}
						disabled={busy}
						onChoose={(value) => {
							setKindKey(value);
							touch();
						}}
					/>
				))}
			</fieldset>
			<div className="flex flex-col gap-1">
				<label htmlFor={detailsId} className="text-sm text-ink-muted">
					{t("ask.details")}
				</label>
				<textarea
					id={detailsId}
					data-testid="ask-details"
					value={details}
					disabled={busy}
					maxLength={MAX_DETAILS_LENGTH}
					rows={4}
					onChange={(event) => {
						setDetails(event.target.value);
						touch();
					}}
					className={`${fieldClass} min-h-28`}
				/>
				<Hint>{t("ask.detailsHint")}</Hint>
			</div>
			{problems.map((problem) => (
				<Alert key={problem} testId={`ask-problem-${problem}`}>
					{t(`ask.problem.${problem}`)}
				</Alert>
			))}
			{action.failure === null ? null : (
				<Alert testId="ask-failed">{t(sendFailureKey(action.failure))}</Alert>
			)}
			<button
				type="submit"
				className={primaryButton}
				data-action="primary"
				disabled={busy}
				aria-busy={busy}
			>
				<BusyLabel busy={busy} busyText={t("ask.sending")}>
					{t("ask.send")}
				</BusyLabel>
			</button>
			<button
				type="button"
				className={secondaryButton}
				disabled={busy}
				onClick={() => go(TEAM_PATHS.myRequests)}
			>
				{t("ask.mine")}
			</button>
			{sent ? (
				<ResultModal
					message={t("ask.sent")}
					onDone={() => go(TEAM_PATHS.myRequests)}
				/>
			) : null}
		</form>
	);
}

export function SendRequestScreen({ open }: TeamScreenProps) {
	const { t } = useI18n();
	const { client, context, recover, home } = useTeamEnv();
	const tenantId = context.tenantId;
	const fetchKinds = useCallback(async () => {
		if (tenantId === null) return [];
		return client.kinds(tenantId);
	}, [client, tenantId]);
	const { load, reload } = useLoad(fetchKinds, recover);
	return (
		<SubScreen
			title={t("ask.title")}
			subtitle={t("ask.subtitle")}
			onBack={home}
			testId="send-request"
		>
			{context.stores.length === 0 ? (
				<p className="text-body text-ink-muted" data-testid="ask-no-stores">
					{t("home.noStores")}
				</p>
			) : load.status === "loading" ? (
				<Loading label={t("ask.loading")} />
			) : load.status === "failed" ? (
				<div className="flex flex-col gap-2">
					<Alert testId="ask-kinds-failed">{t(failureKey(load.failure))}</Alert>
					<button
						type="button"
						className={primaryButton}
						data-action="primary"
						onClick={reload}
					>
						{t("ops.retry")}
					</button>
				</div>
			) : load.value.length === 0 ? (
				<p className="text-body text-ink-muted" data-testid="ask-no-kinds">
					{t("ask.noKinds")}
				</p>
			) : (
				<SendForm kinds={load.value} initialStoreId={open.storeId} />
			)}
		</SubScreen>
	);
}
