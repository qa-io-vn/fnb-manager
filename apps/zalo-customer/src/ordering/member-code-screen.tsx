import type { AttachedOrder, StampCode } from "@fnb/zalo-mini/ordering";
import { kitButton, StatusPill, useI18n } from "@fnb/zalo-mini/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { qrPath } from "../wallet/qr-path";
import { useOrdering } from "./ordering-data";
import { clock, FlowBack, kicker, Notice, Panel, Problem } from "./parts";
import { StampSlots, useStampCard } from "./stamp-card";
import { codePhase, countdown, minutesUntil, useStampCode } from "./stamp-code";

// C20 Mã thành viên (missing-screens README 5.9; native-till.md 16.5): the QR and the 8-digit number of the Zalo
// account's stamp card for the counter to scan or type, the countdown to the next code, a refresh, the code enlarged
// on a white screen, the stamp card under it, what the code does offline, and the counter's attach shown at once.
// The QR is drawn as an SVG path; the payload is in no attribute, address or log.

/** How long an attach stays announced on the code screen (frame 5). */
const ATTACH_SHOWN_MS = 30 * 60_000;
/** How often the open code screen reads the card again, to show the counter's attach. */
const CARD_POLL_MS = 10_000;

function CodeQr({
	payload,
	label,
	size,
}: {
	readonly payload: string;
	readonly label: string;
	readonly size: number;
}) {
	const { size: modules, path } = useMemo(() => qrPath(payload), [payload]);
	return (
		<svg
			role="img"
			aria-label={label}
			viewBox={`0 0 ${modules} ${modules}`}
			width={size}
			height={size}
			shapeRendering="crispEdges"
			className="rounded-tile bg-white"
			data-testid="stamp-qr"
		>
			<rect width={modules} height={modules} fill="#FFFFFF" />
			<path d={path} fill="#000000" />
		</svg>
	);
}

function Enlarged({
	code,
	onClose,
}: {
	readonly code: StampCode;
	readonly onClose: () => void;
}) {
	const { t } = useI18n();
	const closeRef = useRef<HTMLButtonElement>(null);
	useEffect(() => {
		closeRef.current?.focus();
		const onKey = (event: KeyboardEvent) => {
			if (event.key === "Escape") onClose();
		};
		document.addEventListener("keydown", onKey);
		return () => document.removeEventListener("keydown", onKey);
	}, [onClose]);
	return (
		<div
			role="dialog"
			aria-modal="true"
			aria-labelledby="code-enlarged-title"
			className="fixed inset-0 z-[1100] flex flex-col items-center justify-center gap-4 bg-white px-4 text-black"
			data-testid="code-enlarged"
		>
			<h2 id="code-enlarged-title" className="text-xl font-bold">
				{t("code.enlargedTitle")}
			</h2>
			<CodeQr
				payload={code.qrPayload}
				label={t("stampCode.qrLabel")}
				size={300}
			/>
			<p className="font-mono text-4xl font-semibold tracking-[0.2em]">
				{code.displayNumber}
			</p>
			<p className="text-body">{t("code.whiteHint")}</p>
			<button
				ref={closeRef}
				type="button"
				onClick={onClose}
				className="inline-flex min-h-12 items-center justify-center rounded-control border-2 border-black bg-white px-6 text-body font-bold text-black focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black"
				data-testid="code-shrink"
			>
				{t("code.shrink")}
			</button>
		</div>
	);
}

/** Frame 5: the counter attached an order to the card; its drinks earn when it completes. */
function AttachNotice({
	attached,
	now,
}: {
	readonly attached: readonly AttachedOrder[];
	readonly now: number;
}) {
	const { t } = useI18n();
	const latest = attached.find(
		(entry) =>
			now - Date.parse(entry.attachedAt) <= ATTACH_SHOWN_MS &&
			entry.status !== "completed" &&
			entry.status !== "cancelled",
	);
	if (latest === undefined) return null;
	return (
		<div
			role="status"
			className="flex flex-col gap-1 rounded-card bg-positive-soft px-4 py-3 text-body text-ink"
			data-testid="code-attached"
		>
			<p className="font-bold">
				{t("stampCode.attached", { order: latest.orderNo ?? "" })}
			</p>
			<p className="text-[13px]">
				{t("stampCode.attachedStamps", { count: latest.stamps })}
			</p>
		</div>
	);
}

function CardSummary({ now }: { readonly now: number }) {
	const { t } = useI18n();
	const { load, reload } = useStampCard();
	useEffect(() => {
		const timer = setInterval(reload, CARD_POLL_MS);
		return () => clearInterval(timer);
	}, [reload]);
	if (load.status !== "ready" || !load.card.enabled) return null;
	const { card } = load;
	return (
		<>
			<AttachNotice attached={card.attached} now={now} />
			<Panel testId="code-stamps">
				<p className="text-[15px] font-bold text-ink">
					{t("code.stamps", {
						stamps: card.stamps,
						total: card.stampsPerReward,
					})}
				</p>
				<StampSlots
					stamps={card.stamps}
					perReward={card.stampsPerReward}
					small
				/>
			</Panel>
		</>
	);
}

export function OrderingMemberCodeScreen() {
	const { t } = useI18n();
	const { client } = useOrdering();
	const { state, now, online, busy, kept, refresh } = useStampCode(client);
	const [large, setLarge] = useState(false);
	const code = state.status === "ready" ? state.code : null;
	const phase = code === null ? null : codePhase(code, now);
	const live = code !== null && phase !== "expired";
	return (
		<section
			className="flex flex-col gap-4 px-4 py-4"
			data-testid="member-code-screen"
			data-phase={phase ?? state.status}
		>
			<FlowBack />
			<h1 className="text-xl font-bold text-ink">{t("code.title")}</h1>
			<p className="text-body text-ink">{t("stampCode.lead")}</p>
			{!online && live && code !== null ? (
				<Notice testId="code-offline">
					{t("stampCode.offline", {
						time: clock(code.expiresAt),
						minutes: minutesUntil(code.expiresAt, now),
					})}
				</Notice>
			) : null}
			{state.status === "loading" ? (
				<p className="text-body text-ink-muted" role="status">
					{t("code.loading")}
				</p>
			) : state.status === "refused" ? (
				<Problem testId="code-refused">
					{state.refusal === "rate_limited" && state.retryAt !== null
						? t("stampCode.refusal.rate_limited", {
								time: clock(state.retryAt),
							})
						: state.refusal === "stamps_off"
							? t("stampCode.refusal.stamps_off")
							: t("stampCode.refusal.other")}
				</Problem>
			) : state.status === "failed" ? (
				<Problem testId="code-failed">
					{t(
						state.failure === "network"
							? "stampCode.failedNetwork"
							: "stampCode.failed",
					)}
				</Problem>
			) : code !== null && live ? (
				<Panel testId="code-card" className="items-center">
					<p className={kicker}>{t("stampCode.kicker")}</p>
					{kept ? (
						<StatusPill tone="warning" testId="code-kept">
							{t("stampCode.kept")}
						</StatusPill>
					) : null}
					<CodeQr
						payload={code.qrPayload}
						label={t("stampCode.qrLabel")}
						size={216}
					/>
					<p
						className="font-mono text-4xl font-semibold tracking-[0.2em] text-ink"
						data-testid="stamp-number"
					>
						{code.displayNumber}
					</p>
					<p
						className="text-[13px] text-ink"
						data-testid="code-countdown"
						aria-live="off"
					>
						{phase === "fresh"
							? t("stampCode.refreshIn", {
									time: countdown(code.refreshAt, now),
								})
							: t("code.refreshing")}
					</p>
					<p
						className="text-[13px] text-ink-muted"
						data-testid="code-valid-until"
					>
						{t("code.validUntil", { time: clock(code.expiresAt) })}
					</p>
				</Panel>
			) : (
				<Problem testId="code-expired">{t("stampCode.expired")}</Problem>
			)}
			{live && code !== null ? (
				<>
					<Notice testId="code-brightness">{t("code.brightness")}</Notice>
					<button
						type="button"
						className={`${kitButton.secondary} w-full`}
						onClick={() => setLarge(true)}
						data-testid="code-enlarge"
					>
						{t("code.enlarge")}
					</button>
				</>
			) : null}
			<button
				type="button"
				className={`${live ? kitButton.secondary : kitButton.primary} w-full`}
				onClick={refresh}
				disabled={busy || !online || client === null}
				aria-busy={busy}
				data-testid="code-refresh"
			>
				{live ? t("stampCode.refresh") : t("code.newCode")}
			</button>
			{!online ? (
				<p className="text-[13px] text-ink-muted">
					{t("stampCode.refreshOffline")}
				</p>
			) : null}
			<CardSummary now={now} />
			{large && code !== null && live ? (
				<Enlarged code={code} onClose={() => setLarge(false)} />
			) : null}
		</section>
	);
}
