import { useI18n } from "@fnb/zalo-mini/react";
import { useCallback, useMemo } from "react";
import { failureKey } from "../shift/env";
import { Alert, Card, Loading, SubScreen } from "../shift/parts";
import { TEAM_PATHS, useLoad, useTeamEnv } from "../team/env";
import type { TeamScreenProps } from "../team/route";
import { primaryButton, secondaryButton } from "../ui";
import { type OwnRequest, sortOwnRequests } from "./contract";
import { kindName, StatusChip } from "./parts";

function OwnRequestCard({ request }: { readonly request: OwnRequest }) {
	const { t } = useI18n();
	const { when, storeName } = useTeamEnv();
	const store = storeName(request.storeId);
	return (
		<li
			data-testid="own-request"
			data-status={request.status}
			data-id={request.id}
		>
			<Card>
				<div className="flex items-start justify-between gap-2">
					<p className="min-w-0 break-words text-base font-semibold text-ink">
						{kindName(request)}
					</p>
					<StatusChip status={request.status} />
				</div>
				<p className="whitespace-pre-line break-words text-base text-ink">
					{request.details}
				</p>
				{request.refusalReason === null ? null : (
					<p
						className="whitespace-pre-line break-words rounded-xl bg-negative-soft px-3 py-2 text-base text-negative"
						data-testid="refusal-reason"
					>
						{t("ask.refusalReason", { reason: request.refusalReason })}
					</p>
				)}
				<p className="text-sm text-ink-muted">
					{t("ask.sentAt", when(request.requestedAt))}
					{store === null ? "" : ` · ${store}`}
				</p>
				{request.decidedAt === null ? null : (
					<p className="text-sm text-ink-muted" data-testid="decided-at">
						{t(`ask.decidedAt.${request.status}`, when(request.decidedAt))}
					</p>
				)}
			</Card>
		</li>
	);
}

export function MyTeamRequestsScreen(_: TeamScreenProps) {
	const { t } = useI18n();
	const { client, recover, home, go } = useTeamEnv();
	const fetchMine = useCallback(() => client.mine(), [client]);
	const { load, reload } = useLoad(fetchMine, recover);
	const requests = useMemo(
		() => (load.status === "ready" ? sortOwnRequests(load.value) : []),
		[load],
	);
	return (
		<SubScreen
			title={t("ask.mine")}
			subtitle={t("ask.mineSubtitle")}
			onBack={home}
			testId="team-requests"
		>
			<button
				type="button"
				className={load.status === "failed" ? secondaryButton : primaryButton}
				{...(load.status === "failed" ? {} : { "data-action": "primary" })}
				onClick={() => go(TEAM_PATHS.sendRequest)}
			>
				{t("ask.title")}
			</button>
			{load.status === "loading" ? (
				<Loading label={t("ask.mineLoading")} />
			) : load.status === "failed" ? (
				<div className="flex flex-col gap-2">
					<Alert testId="own-requests-failed">
						{t(failureKey(load.failure))}
					</Alert>
					<button
						type="button"
						className={primaryButton}
						data-action="primary"
						onClick={reload}
					>
						{t("ops.retry")}
					</button>
				</div>
			) : requests.length === 0 ? (
				<p
					className="text-base text-ink-muted"
					data-testid="own-requests-empty"
				>
					{t("ask.mineEmpty")}
				</p>
			) : (
				<ul className="flex flex-col gap-3" data-testid="own-requests">
					{requests.map((request) => (
						<OwnRequestCard key={request.id} request={request} />
					))}
				</ul>
			)}
		</SubScreen>
	);
}
