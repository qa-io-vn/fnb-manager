import { kitButton, useI18n } from "@fnb/zalo-mini/react";
import { useEffect, useRef, useState } from "react";
import { MemberCodeView } from "../wallet/member-code-screen";
import { qrPath } from "../wallet/qr";
import { MemberOnly } from "../wallet/wallet-screen";
import { Notice, Panel } from "./parts";
import { StampSlots, useStampCard } from "./stamp-card";

// C20 Mã thành viên (missing-screens README 5.9), built on the member code that exists: the points programme's code
// that the counter types or scans (customer_member_code, 6 digits, 2 minutes, per store), with what C20 adds: the
// brightness hint, the code enlarged on a white screen and the stamp card under it. The database has no member code
// of the Zalo account's stamp card yet, nor the counter's lookup and attach, so the code still needs the membership.

function Enlarged({
	code,
	payload,
	onClose,
}: {
	readonly code: string;
	readonly payload: string;
	readonly onClose: () => void;
}) {
	const { t } = useI18n();
	const closeRef = useRef<HTMLButtonElement>(null);
	const { size, path } = qrPath(payload);
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
			<svg
				role="img"
				aria-label={t("code.enlargedTitle")}
				viewBox={`0 0 ${size} ${size}`}
				width="300"
				height="300"
				shapeRendering="crispEdges"
			>
				<rect width={size} height={size} fill="#FFFFFF" />
				<path d={path} fill="#000000" />
			</svg>
			<p className="font-mono text-4xl font-semibold tracking-[0.3em]">
				{code}
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

function CodeTools({
	code,
	payload,
	expired,
}: {
	readonly code: string;
	readonly payload: string;
	readonly expired: boolean;
}) {
	const { t } = useI18n();
	const [large, setLarge] = useState(false);
	if (expired) return null;
	return (
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
			{large ? (
				<Enlarged
					code={code}
					payload={payload}
					onClose={() => setLarge(false)}
				/>
			) : null}
		</>
	);
}

function StampSummary() {
	const { t } = useI18n();
	const { load } = useStampCard();
	if (load.status !== "ready" || !load.card.enabled) return null;
	const { card } = load;
	return (
		<Panel testId="code-stamps">
			<p className="text-[15px] font-bold text-ink">
				{t("code.stamps", { stamps: card.stamps, total: card.stampsPerReward })}
			</p>
			<StampSlots stamps={card.stamps} perReward={card.stampsPerReward} small />
		</Panel>
	);
}

export function OrderingMemberCodeScreen() {
	return (
		<MemberOnly next="card">
			<MemberCodeView
				extras={({ code, qrPayload, expired }) => (
					<CodeTools code={code} payload={qrPayload} expired={expired} />
				)}
				after={<StampSummary />}
			/>
		</MemberOnly>
	);
}
