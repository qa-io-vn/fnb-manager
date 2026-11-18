import {
	asOfDate,
	type IsoDate,
	type ReportSource,
	type RpcClient,
} from "@fnb/reports";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useAppMode } from "../../app-mode/app-mode";
import { useSession } from "../../auth/session";
import { useAnalyticsSourceState } from "../../data/analytics-source-context";
import type { StoreRow, TenantRow } from "../../data/row-source";
import type {
	BrowserPack,
	BuildBrowserPack,
} from "../../datapack/browser-pack";
import {
	rememberedOwnerNote,
	rememberOwnerNote,
	rememberPack,
} from "../../datapack/pack-cache";
import {
	bundleFileName,
	type PackFileParts,
	packFileName,
} from "../../datapack/pack-files";
import { isAbortError } from "../../exports/reader";
import { useLanguage, useT } from "../../i18n";
import { useFormatters } from "../../state/formatters";
import { useReadyTenantScope } from "../../state/tenant-scope";
import { PackForm, type PackOutcome } from "./pack-form";
import { PackProgressView } from "./pack-progress";
import {
	errorCodeOf,
	failureOf,
	type PackFormValues,
	packDefaults,
	packRequestOf,
} from "./pack-request";
import { PackResultView } from "./pack-result";

export type PackPhase =
	| { readonly kind: "idle" }
	| { readonly kind: "building"; readonly done: number; readonly total: number }
	| {
			readonly kind: "done";
			readonly pack: BrowserPack;
			readonly url: string;
			readonly files: PackFileParts;
	  }
	| { readonly kind: "settled"; readonly outcome: PackOutcome };

const loadBuild: BuildBrowserPack = (request, options) =>
	import("../../datapack/browser-pack").then((module) =>
		module.buildBrowserPack(request, options),
	);

export function hashingAvailable(): boolean {
	return typeof globalThis.crypto?.subtle?.digest === "function";
}

export function completeAsOfOf(
	stores: readonly StoreRow[],
	now: Date,
): IsoDate {
	return asOfDate(
		stores.map((store) => ({
			timeZone: store.timeZone,
			businessDayStartMinutes: store.businessDayStartMinutes,
		})),
		now,
	);
}

export interface PackWorkflowProps {
	readonly source: ReportSource;
	readonly rpc: RpcClient | null;
	readonly sample: boolean;
	readonly tenant: TenantRow;
	readonly stores: readonly StoreRow[];
	readonly allStores: boolean;
	readonly params: URLSearchParams;
	readonly language: PackFormValues["language"];
	readonly build?: BuildBrowserPack;
	readonly now?: Date;
}

export function PackWorkflow({
	source,
	rpc,
	sample,
	tenant,
	stores,
	allStores,
	params,
	language,
	build = loadBuild,
	now: fixedNow,
}: PackWorkflowProps) {
	const formatters = useFormatters(tenant);
	const [now] = useState(() => fixedNow ?? new Date());
	const completeAsOf = useMemo(
		() => completeAsOfOf(stores, now),
		[stores, now],
	);
	const [values, setValues] = useState<PackFormValues>(() =>
		packDefaults(params, {
			language,
			asOf: completeAsOf,
			ownerNote: rememberedOwnerNote(tenant.id),
		}),
	);
	const [phase, setPhase] = useState<PackPhase>({ kind: "idle" });
	const controller = useRef<AbortController | null>(null);
	useEffect(
		() => () => {
			controller.current?.abort();
		},
		[],
	);
	useEffect(() => {
		if (phase.kind !== "done") return;
		const url = phase.url;
		return () => URL.revokeObjectURL(url);
	}, [phase]);

	useEffect(() => {
		rememberOwnerNote(tenant.id, values.ownerNote);
	}, [tenant.id, values.ownerNote]);

	const changeValues = useCallback((next: PackFormValues) => {
		setValues(next);
		setPhase((current) =>
			current.kind === "settled" ? { kind: "idle" } : current,
		);
	}, []);

	const start = useCallback(async () => {
		const abort = new AbortController();
		controller.current = abort;
		setPhase({ kind: "building", done: 0, total: 0 });
		try {
			const pack = await build(
				packRequestOf(
					values,
					stores.map((store) => store.id),
					sample,
				),
				{
					source,
					rpc,
					signal: abort.signal,
					onProgress: (done, total) =>
						setPhase((current) =>
							current.kind === "building"
								? { kind: "building", done, total }
								: current,
						),
				},
			);
			rememberPack(pack.packId, pack.text);
			setPhase({
				kind: "done",
				pack,
				url: URL.createObjectURL(
					new Blob([pack.text], { type: "application/json" }),
				),
				files: {
					asOf: pack.asOf,
					labels: pack.stores.map((store) => store.label),
					allStores,
					packId: pack.packId,
				},
			});
		} catch (error) {
			setPhase({
				kind: "settled",
				outcome:
					isAbortError(error) || abort.signal.aborted
						? { kind: "stopped" }
						: {
								kind: "failed",
								failure: failureOf(error),
								code: errorCodeOf(error),
							},
			});
		} finally {
			if (controller.current === abort) controller.current = null;
		}
	}, [build, values, stores, sample, source, rpc, allStores]);

	if (phase.kind === "building") {
		return (
			<PackProgressView
				done={phase.done}
				total={phase.total}
				formatters={formatters}
				onStop={() => controller.current?.abort()}
			/>
		);
	}
	if (phase.kind === "done") {
		return (
			<PackResultView
				pack={phase.pack}
				url={phase.url}
				fileName={packFileName(phase.files)}
				bundleName={bundleFileName(phase.files)}
				stores={stores}
				formatters={formatters}
				onAgain={() => setPhase({ kind: "idle" })}
			/>
		);
	}
	return (
		<PackForm
			values={values}
			onChange={changeValues}
			stores={stores}
			completeAsOf={completeAsOf}
			formatters={formatters}
			outcome={phase.kind === "settled" ? phase.outcome : null}
			onBuild={() => void start()}
		/>
	);
}

function PackIntro() {
	const t = useT();
	return <p className="text-ink-muted">{t("exports.pack.intro")}</p>;
}

export function PackTab({ secure = hashingAvailable() }: { secure?: boolean }) {
	const t = useT();
	const { mode } = useAppMode();
	const { client } = useSession();
	const { language } = useLanguage();
	const [params] = useSearchParams();
	const scope = useReadyTenantScope();
	const sourceState = useAnalyticsSourceState();
	const demo = mode === "demo";
	const rpc = useMemo<RpcClient | null>(
		() =>
			demo || client === null
				? null
				: { rpc: (fn, args) => client.rpc(fn, args) },
		[demo, client],
	);
	if (!secure) {
		return (
			<div className="space-y-4">
				<PackIntro />
				<p
					role="alert"
					className="rounded-xl border border-line bg-surface-raised p-5"
					data-testid="pack-insecure"
				>
					{t("exports.pack.insecure")}
				</p>
			</div>
		);
	}
	if (sourceState.status === "failed") {
		return (
			<div className="space-y-4">
				<PackIntro />
				<p role="alert" data-testid="pack-source-failed">
					{t("exports.pack.error.failed")}
				</p>
			</div>
		);
	}
	if (sourceState.status === "loading" || (!demo && rpc === null)) {
		return (
			<div className="space-y-4">
				<PackIntro />
				<p role="status">{t("exports.loading")}</p>
			</div>
		);
	}
	return (
		<div className="space-y-4">
			<PackIntro />
			<PackWorkflow
				key={scope.tenant.id}
				source={sourceState.source}
				rpc={rpc}
				sample={demo}
				tenant={scope.tenant}
				stores={scope.selectedStores}
				allStores={scope.selectedStores.length === scope.stores.length}
				params={params}
				language={language}
			/>
		</div>
	);
}
