import { useI18n } from "@fnb/zalo-mini/react";
import { useCallback, useEffect, useState } from "react";
import type { MyRequest } from "../loyalty/contract";
import { useLoyaltyEnv } from "../loyalty/env";
import { isoDayIn, shownPhone, signed } from "../loyalty/model";
import { RequestChip } from "../loyalty/parts";
import { LoyaltyFrame, type LoyaltyScreenProps } from "../loyalty/route";
import { failureKey } from "../shift/env";
import type { Failure } from "../shift/model";
import { Alert, Card, Loading } from "../shift/parts";
import { primaryButton } from "../ui";

type RequestsLoad =
	| { readonly status: "loading" }
	| { readonly status: "ready"; readonly requests: readonly MyRequest[] }
	| { readonly status: "failed"; readonly failure: Failure };

function RequestCard({ request }: { readonly request: MyRequest }) {
	const { t } = useI18n();
	const { formatters, context } = useLoyaltyEnv();
	const when = (iso: string) => {
		const instant = new Date(iso);
		return {
			time: formatters.time(instant),
			date: formatters.date(isoDayIn(instant, context.timeZone)),
		};
	};
	return (
		<li
			data-testid="my-request"
			data-kind={request.kind}
			data-state={request.state}
		>
			<Card>
				<div className="flex items-start justify-between gap-2">
					<p className="text-body font-semibold text-ink">
						{t(`queue.kind.${request.kind}`)}
					</p>
					<RequestChip state={request.state} />
				</div>
				<p className="text-body text-ink">
					{t("loyalty.member", { phone: shownPhone(request.phoneMasked) })}
					{" · "}
					<span className="tabular-nums">
						{t("queue.amounts", {
							stamps: signed(request.stamps),
							points: signed(request.points),
						})}
					</span>
				</p>
				<p className="whitespace-pre-line text-body text-ink">
					{request.reason}
				</p>
				{request.decisionReason === null ? null : (
					<p
						className="rounded-card-xl bg-surface-sunken px-3 py-2 text-body text-ink"
						data-testid="decision-reason"
					>
						{t("requests.decisionReason", { reason: request.decisionReason })}
					</p>
				)}
				<p className="text-sm text-ink-muted">
					{t("requests.sentAt", when(request.createdAt))}
					{request.storeName === null ? "" : ` · ${request.storeName}`}
				</p>
			</Card>
		</li>
	);
}

export function MyRequestsScreen(_: LoyaltyScreenProps) {
	const { t } = useI18n();
	const { client, recover, home } = useLoyaltyEnv();
	const [load, setLoad] = useState<RequestsLoad>({ status: "loading" });
	const reload = useCallback(() => {
		let active = true;
		setLoad({ status: "loading" });
		client.myRequests().then(
			(requests) => {
				if (active) setLoad({ status: "ready", requests });
			},
			(error: unknown) => {
				if (active) setLoad({ status: "failed", failure: recover(error) });
			},
		);
		return () => {
			active = false;
		};
	}, [client, recover]);
	useEffect(() => reload(), [reload]);
	return (
		<LoyaltyFrame title={t("requests.title")} testId="my-requests">
			{load.status === "loading" ? (
				<Loading label={t("requests.loading")} />
			) : load.status === "failed" ? (
				<div className="flex flex-col gap-2">
					<Alert testId="requests-failed">{t(failureKey(load.failure))}</Alert>
					<button
						type="button"
						className={primaryButton}
						data-action="primary"
						onClick={reload}
					>
						{t("ops.retry")}
					</button>
				</div>
			) : load.requests.length === 0 ? (
				<div className="flex flex-col gap-3">
					<p className="text-body text-ink-muted" data-testid="requests-empty">
						{t("requests.empty")}
					</p>
					<button
						type="button"
						className={primaryButton}
						data-action="primary"
						onClick={home}
					>
						{t("loyalty.backHome")}
					</button>
				</div>
			) : (
				<ul className="flex flex-col gap-3" data-testid="my-requests-list">
					{load.requests.map((request) => (
						<RequestCard key={request.id} request={request} />
					))}
				</ul>
			)}
		</LoyaltyFrame>
	);
}
