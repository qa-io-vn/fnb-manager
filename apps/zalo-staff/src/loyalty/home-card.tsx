import type { StoredSession } from "@fnb/zalo-mini";
import { useDataEndpoint, useI18n, useSession } from "@fnb/zalo-mini/react";
import { useCallback, useEffect, useId, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { queueSummary } from "../approvals/loyalty-items";
import { Chip, quietAction } from "../shift/parts";
import { primaryButton, secondaryButton } from "../ui";
import { LOYALTY_PATHS, type LoyaltyPath } from "./env";
import { canManageQueue, canUseTill } from "./model";
import { type LoyaltySourceFactory, loyaltySourceFor } from "./source";

type QueueCount =
	| { readonly status: "loading" }
	| { readonly status: "failed" }
	| {
			readonly status: "ready";
			readonly open: number;
			readonly overdue: number;
	  };

function QueueRow({
	storeId,
	session,
	sourceFor,
	onOpen,
}: {
	readonly storeId: string;
	readonly session: StoredSession;
	readonly sourceFor: LoyaltySourceFactory;
	readonly onOpen: () => void;
}) {
	const { t } = useI18n();
	const endpoint = useDataEndpoint();
	const source = useMemo(
		() => sourceFor(endpoint, session),
		[sourceFor, endpoint, session],
	);
	const [count, setCount] = useState<QueueCount>({ status: "loading" });
	const fetchCount = useCallback(() => {
		let active = true;
		setCount({ status: "loading" });
		source.client.queue(storeId).then(
			(items) => {
				if (active)
					setCount({ status: "ready", ...queueSummary(items, new Date()) });
			},
			() => {
				if (active) setCount({ status: "failed" });
			},
		);
		return () => {
			active = false;
		};
	}, [source, storeId]);
	useEffect(() => fetchCount(), [fetchCount]);
	return (
		<div
			className="flex flex-col gap-2 border-t border-line pt-3"
			data-testid="home-loyalty-queue"
			data-status={count.status}
		>
			<div className="flex flex-wrap items-center justify-between gap-2">
				<p className="text-base font-semibold text-ink">{t("loyalty.queue")}</p>
				{count.status === "ready" ? (
					<div className="flex flex-wrap gap-2">
						<Chip
							tone={count.open > 0 ? "warning" : "positive"}
							testId="home-loyalty-queue-count"
						>
							{count.open > 0
								? t("loyalty.queueCount", { count: count.open })
								: t("loyalty.queueEmpty")}
						</Chip>
						{count.overdue > 0 ? (
							<Chip tone="negative" testId="home-loyalty-queue-overdue">
								{t("loyalty.queueOverdue", { count: count.overdue })}
							</Chip>
						) : null}
					</div>
				) : count.status === "loading" ? (
					<p role="status" className="text-sm text-ink-muted">
						{t("loyalty.queueLoading")}
					</p>
				) : null}
			</div>
			{count.status === "failed" ? (
				<div className="flex items-center justify-between gap-2">
					<p className="text-sm text-ink-muted">{t("loyalty.queueFailed")}</p>
					<button type="button" className={quietAction} onClick={fetchCount}>
						{t("ops.retry")}
					</button>
				</div>
			) : null}
			<button type="button" className={secondaryButton} onClick={onOpen}>
				{t("loyalty.openQueue")}
			</button>
		</div>
	);
}

export function LoyaltyHomeCard({
	storeId,
	sourceFor = loyaltySourceFor,
}: {
	readonly storeId: string;
	readonly sourceFor?: LoyaltySourceFactory;
}) {
	const { t } = useI18n();
	const { state } = useSession();
	const navigate = useNavigate();
	const headingId = useId();
	if (state.status !== "signed-in") return null;
	const role = state.session.member.role;
	if (!canUseTill(role)) return null;
	const open = (path: LoyaltyPath) =>
		navigate(path, { state: { loyalty: { storeId, membershipId: null } } });
	return (
		<section
			aria-labelledby={headingId}
			className="flex flex-col gap-3"
			data-testid="home-loyalty"
		>
			<h2 id={headingId} className="text-base font-semibold text-ink">
				{t("loyalty.section")}
			</h2>
			<div className="flex flex-col gap-3 rounded-2xl border border-line bg-surface-raised p-4">
				<p className="text-sm text-ink-muted">{t("loyalty.sectionBody")}</p>
				<button
					type="button"
					className={primaryButton}
					data-action="primary"
					onClick={() => open(LOYALTY_PATHS.checkIn)}
				>
					{t("loyalty.checkIn")}
				</button>
				<div className="grid grid-cols-2 gap-3">
					<button
						type="button"
						className={secondaryButton}
						onClick={() => open(LOYALTY_PATHS.redeem)}
					>
						{t("loyalty.redeem")}
					</button>
					<button
						type="button"
						className={secondaryButton}
						onClick={() => open(LOYALTY_PATHS.lookup)}
					>
						{t("loyalty.lookup")}
					</button>
				</div>
				{canManageQueue(role) ? (
					<QueueRow
						key={storeId}
						storeId={storeId}
						session={state.session}
						sourceFor={sourceFor}
						onOpen={() => open(LOYALTY_PATHS.queue)}
					/>
				) : null}
				<button
					type="button"
					className={quietAction}
					onClick={() => open(LOYALTY_PATHS.requests)}
				>
					{t("loyalty.myRequests")}
				</button>
			</div>
		</section>
	);
}
