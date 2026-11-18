import { createTranslator } from "@fnb/zalo-mini";
import { useI18n } from "@fnb/zalo-mini/react";
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { getPhoneNumber } from "zmp-sdk";
import { probeCatalogs } from "./messages";

export interface ProbeOutcome {
	readonly consented: boolean;
	readonly errorCode: number | null;
}

export type PhoneNumberRequest = () => Promise<{ token?: string }>;

function errorCodeOf(error: unknown): number | null {
	if (typeof error !== "object" || error === null || !("code" in error)) {
		return null;
	}
	return typeof error.code === "number" ? error.code : null;
}

export async function runPhoneConsentProbe(
	request: PhoneNumberRequest = () => getPhoneNumber(),
): Promise<ProbeOutcome> {
	try {
		const result = await request();
		const consented = typeof result.token === "string" && result.token !== "";
		return { consented, errorCode: null };
	} catch (error) {
		return { consented: false, errorCode: errorCodeOf(error) };
	}
}

function useProbeText() {
	const { language } = useI18n();
	return useMemo(() => createTranslator(probeCatalogs[language]), [language]);
}

export function ProbeEntry() {
	const t = useProbeText();
	const navigate = useNavigate();
	return (
		<div className="px-4 pb-6">
			<button
				type="button"
				onClick={() => navigate("/probe")}
				className="min-h-11 w-full rounded-xl border border-line px-4 text-base text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
			>
				{t("probe.open")}
			</button>
		</div>
	);
}

export function ProbeScreen() {
	const t = useProbeText();
	const [running, setRunning] = useState(false);
	const [outcome, setOutcome] = useState<ProbeOutcome | null>(null);
	const start = () => {
		setRunning(true);
		runPhoneConsentProbe().then((result) => {
			setOutcome(result);
			setRunning(false);
		});
	};
	return (
		<section
			data-testid="phone-probe"
			className="flex flex-col gap-4 px-4 py-6"
		>
			<h1 className="text-xl font-semibold text-ink">{t("probe.title")}</h1>
			<p className="text-base text-ink">{t("probe.purpose")}</p>
			<button
				type="button"
				onClick={start}
				disabled={running}
				aria-busy={running}
				className="min-h-11 w-full rounded-xl bg-accent px-4 text-base font-semibold text-accent-ink disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
			>
				{running ? t("probe.running") : t("probe.start")}
			</button>
			{outcome ? (
				<dl
					data-testid="probe-outcome"
					className="flex flex-col gap-3 rounded-xl bg-surface-raised p-4"
				>
					<div>
						<dt className="text-sm text-ink-muted">{t("probe.consented")}</dt>
						<dd className="text-base text-ink">
							{outcome.consented ? t("probe.yes") : t("probe.no")}
						</dd>
					</div>
					<div>
						<dt className="text-sm text-ink-muted">{t("probe.errorCode")}</dt>
						<dd className="text-base text-ink">
							{outcome.errorCode === null
								? t("probe.noError")
								: String(outcome.errorCode)}
						</dd>
					</div>
				</dl>
			) : null}
		</section>
	);
}
