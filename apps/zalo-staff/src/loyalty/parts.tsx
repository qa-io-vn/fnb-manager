import { useI18n } from "@fnb/zalo-mini/react";
import { useCallback, useRef, useState } from "react";
import { failureKey } from "../shift/env";
import type { Failure } from "../shift/model";
import { Alert, BusyLabel, Chip, Hint, type Tone } from "../shift/parts";
import { secondaryButton } from "../ui";
import type { CheckinState, RequestState, VisitState } from "./contract";
import type { ScanPurpose } from "./model";
import { type ScanResult, useScanTools } from "./scan";

export type ScanState = "idle" | "scanning" | "refused" | "unreadable";

export function useScanner(purpose: ScanPurpose) {
	const tools = useScanTools();
	const [state, setState] = useState<ScanState>("idle");
	const busy = useRef(false);
	const scan = useCallback(async (): Promise<ScanResult | null> => {
		if (busy.current) return null;
		busy.current = true;
		setState("scanning");
		try {
			const result = await tools.scan(purpose);
			setState(result.kind === "refused" ? "refused" : "idle");
			return result;
		} catch {
			setState("idle");
			return { kind: "cancelled" };
		} finally {
			busy.current = false;
		}
	}, [tools, purpose]);
	const unreadable = useCallback(() => setState("unreadable"), []);
	const reset = useCallback(() => setState("idle"), []);
	return { state, scan, unreadable, reset };
}

function ScanIcon() {
	return (
		<svg
			aria-hidden="true"
			width="20"
			height="20"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth="1.8"
			strokeLinecap="round"
			strokeLinejoin="round"
		>
			<path d="M4 8V5.5A1.5 1.5 0 0 1 5.5 4H8M16 4h2.5A1.5 1.5 0 0 1 20 5.5V8M20 16v2.5a1.5 1.5 0 0 1-1.5 1.5H16M8 20H5.5A1.5 1.5 0 0 1 4 18.5V16M4 12h16" />
		</svg>
	);
}

export function ScanButton({
	state,
	disabled,
	label,
	onScan,
}: {
	readonly state: ScanState;
	readonly disabled: boolean;
	readonly label: string;
	readonly onScan: () => void;
}) {
	const { t } = useI18n();
	const scanning = state === "scanning";
	return (
		<button
			type="button"
			className={secondaryButton}
			disabled={disabled || scanning}
			aria-busy={scanning}
			onClick={onScan}
			data-testid="scan"
		>
			<BusyLabel busy={scanning} busyText={t("loyalty.scanning")}>
				<ScanIcon />
				{label}
			</BusyLabel>
		</button>
	);
}

export function ScanNotice({
	state,
	refusedKey,
	unreadableKey,
}: {
	readonly state: ScanState;
	readonly refusedKey: string;
	readonly unreadableKey: string;
}) {
	const { t } = useI18n();
	if (state === "refused")
		return <Hint testId="scan-refused">{t(refusedKey)}</Hint>;
	if (state === "unreadable")
		return <Alert testId="scan-unreadable">{t(unreadableKey)}</Alert>;
	return null;
}

export function FailureAlert({
	failure,
	invalidKey,
}: {
	readonly failure: Failure;
	readonly invalidKey?: string;
}) {
	const { t } = useI18n();
	if (failure === "duplicate") return null;
	return (
		<Alert testId="loyalty-error">
			{t(
				(failure === "invalid" || failure === "check") &&
					invalidKey !== undefined
					? invalidKey
					: failureKey(failure),
			)}
		</Alert>
	);
}

const STATE_TONES: Readonly<Record<VisitState, Tone>> = {
	pending: "warning",
	confirmed: "positive",
	queued: "neutral",
	rejected: "negative",
};

export function visitStateOf(state: CheckinState): VisitState {
	if (state === "matched") return "confirmed";
	return state;
}

export function VisitChip({
	state,
	testId,
}: {
	readonly state: VisitState;
	readonly testId?: string;
}) {
	const { t } = useI18n();
	return (
		<Chip tone={STATE_TONES[state]} {...(testId ? { testId } : {})}>
			{t(`loyalty.state.${state}`)}
		</Chip>
	);
}

const REQUEST_TONES: Readonly<Record<RequestState, Tone>> = {
	pending: "warning",
	applied: "positive",
	approved: "positive",
	refused: "negative",
};

export function RequestChip({ state }: { readonly state: RequestState }) {
	const { t } = useI18n();
	return (
		<Chip tone={REQUEST_TONES[state]} testId="request-state">
			{t(`requests.state.${state}`)}
		</Chip>
	);
}
