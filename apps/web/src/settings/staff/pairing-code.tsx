import { useEffect, useRef, useState } from "react";
import { Button } from "../../components/ui/button";
import { cn } from "../../components/ui/cn";
import { type MessageKey, useT } from "../../i18n";
import type { PairingCode } from "./source";

export const PAIRING_TICK_MS = 1000;

type CopyState = "idle" | "copied" | "failed";

const COPY_KEYS: Readonly<Record<Exclude<CopyState, "idle">, MessageKey>> = {
	copied: "settings.staff.pairing.copied",
	failed: "settings.staff.pairing.copyFailed",
};

export function remainingSeconds(expiresAt: string, now: number): number {
	return Math.max(0, Math.ceil((Date.parse(expiresAt) - now) / 1000));
}

export function countdownText(seconds: number): string {
	const minutes = Math.floor(seconds / 60);
	const rest = seconds % 60;
	return `${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
}

export async function copyPairingCode(code: string): Promise<CopyState> {
	try {
		if (typeof navigator.clipboard?.writeText !== "function") return "failed";
		await navigator.clipboard.writeText(code);
		return "copied";
	} catch {
		return "failed";
	}
}

export function PairingCodePanel({
	issued,
	memberName,
	onClose,
	now = Date.now,
}: {
	readonly issued: PairingCode;
	readonly memberName: string;
	readonly onClose: () => void;
	readonly now?: () => number;
}) {
	const t = useT();
	const [code, setCode] = useState<string | null>(issued.code);
	const [copy, setCopy] = useState<CopyState>("idle");
	const [seconds, setSeconds] = useState(() =>
		remainingSeconds(issued.expiresAt, now()),
	);
	const copyRef = useRef<HTMLButtonElement | null>(null);
	const closeRef = useRef<HTMLButtonElement | null>(null);
	useEffect(() => {
		(copyRef.current ?? closeRef.current)?.focus();
	}, []);
	useEffect(() => {
		const tick = () => {
			const left = remainingSeconds(issued.expiresAt, now());
			setSeconds(left);
			if (left === 0) {
				setCode(null);
				setCopy("idle");
			}
		};
		tick();
		const timer = window.setInterval(tick, PAIRING_TICK_MS);
		return () => window.clearInterval(timer);
	}, [issued.expiresAt, now]);
	const live = code !== null && seconds > 0;
	const copyCode = () => {
		if (code === null) return;
		void copyPairingCode(code).then(setCopy);
	};
	return (
		<fieldset
			className="min-w-0 rounded-lg border-2 border-accent bg-surface-raised p-3"
			data-testid="pairing-code"
			data-state={live ? "live" : "expired"}
			onKeyDown={(event) => {
				if (event.key === "Escape") onClose();
			}}
		>
			<legend className="float-left w-full text-sm font-semibold">
				{t("settings.staff.pairing.title", { name: memberName })}
			</legend>
			<div className="clear-left space-y-3 pt-2">
				{live ? (
					<>
						<p
							className="font-mono text-4xl font-bold tracking-[0.25em] tabular-nums sm:text-5xl"
							data-testid="pairing-code-value"
						>
							{code}
						</p>
						<p
							role="timer"
							className="text-base font-medium"
							data-testid="pairing-code-countdown"
						>
							{t("settings.staff.pairing.remaining", {
								time: countdownText(seconds),
							})}
						</p>
						<p className="text-sm text-ink-muted">
							{t("settings.staff.pairing.note", { name: memberName })}
						</p>
					</>
				) : (
					<p className="text-sm" data-testid="pairing-code-expired">
						{t("settings.staff.pairing.expired")}
					</p>
				)}
				<div className="flex flex-wrap items-center gap-2">
					{live ? (
						<Button
							ref={copyRef}
							size="compact"
							onClick={copyCode}
							data-testid="pairing-code-copy"
						>
							{t("settings.staff.pairing.copy")}
						</Button>
					) : null}
					<Button
						ref={closeRef}
						tone="secondary"
						size="compact"
						onClick={onClose}
						data-testid="pairing-code-close"
					>
						{t("settings.staff.pairing.close")}
					</Button>
					<p
						role="status"
						className={cn(
							"text-sm",
							copy === "failed" ? "text-negative" : "text-positive",
						)}
						data-testid="pairing-code-copy-status"
					>
						{copy === "idle" ? "" : t(COPY_KEYS[copy])}
					</p>
				</div>
			</div>
		</fieldset>
	);
}
