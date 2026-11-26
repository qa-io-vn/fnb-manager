import type {
	ChecklistItem,
	ChecklistRun,
	OpsClient,
	ResizedPhoto,
} from "@fnb/zalo-mini";
import { Popup, ResultModal, useI18n } from "@fnb/zalo-mini/react";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { failureKey, useAction, useShiftEnv } from "../shift/env";
import { type Failure, failureOf } from "../shift/model";
import {
	Alert,
	BusyLabel,
	Card,
	Chip,
	fieldClass,
	Hint,
	Loading,
	OfflineBanner,
	SubScreen,
} from "../shift/parts";
import {
	capturePhoto,
	PhotoPreview,
	UploadProgress,
	usePhotoTools,
} from "../shift/photo";
import { primaryButton, Spinner, secondaryButton } from "../ui";
import {
	canSeePhotos,
	doneBlock,
	numberText,
	numberValueOf,
	readNumberInput,
	runAccess,
	runProgress,
	withAnswer,
} from "./model";

export type RunRequest =
	| { readonly kind: "start"; readonly templateId: string }
	| { readonly kind: "view"; readonly runId: string };

type Load =
	| { readonly status: "loading" }
	| { readonly status: "failed"; readonly failure: Failure }
	| {
			readonly status: "ready";
			readonly run: ChecklistRun;
			readonly mine: boolean;
	  };

const PHASE_KEYS = {
	opening: "ops.phase.opening",
	midshift: "ops.phase.midshift",
	closing: "ops.phase.closing",
} as const;

const startsInFlight = new Map<string, Promise<ChecklistRun>>();

export function startOnce(
	ops: OpsClient,
	templateId: string,
	storeId: string,
): Promise<ChecklistRun> {
	const key = `${storeId}|${templateId}`;
	const running = startsInFlight.get(key);
	if (running !== undefined) return running;
	const started = ops
		.startChecklistRun(templateId, storeId)
		.catch((error: unknown) =>
			failureOf(error) === "duplicate"
				? ops.startChecklistRun(templateId, storeId)
				: Promise.reject(error),
		)
		.finally(() => startsInFlight.delete(key));
	startsInFlight.set(key, started);
	return started;
}

function startFailureKey(failure: Failure): string {
	switch (failure) {
		case "duplicate":
			return "checklist.error.taken";
		case "state":
			return "checklist.error.retired";
		default:
			return failureKey(failure);
	}
}

function CheckIcon({ on }: { readonly on: boolean }) {
	return (
		<span
			aria-hidden="true"
			className={`flex size-6 shrink-0 items-center justify-center rounded-md border-2 ${on ? "border-accent bg-accent text-accent-ink" : "border-line bg-surface-raised text-transparent"}`}
		>
			<svg
				aria-hidden="true"
				width="16"
				height="16"
				viewBox="0 0 16 16"
				fill="none"
				stroke="currentColor"
				strokeWidth="2.4"
				strokeLinecap="round"
				strokeLinejoin="round"
			>
				<path d="M3.5 8.5l3 3 6-7" />
			</svg>
		</span>
	);
}

type PhotoStep =
	| { readonly kind: "idle" }
	| { readonly kind: "taking" }
	| { readonly kind: "uploading"; readonly fraction: number }
	| { readonly kind: "refused" }
	| { readonly kind: "none" }
	| { readonly kind: "unreadable" }
	| { readonly kind: "failed"; readonly failure: Failure };

function SavedPhoto({
	bucket,
	path,
}: {
	readonly bucket: string;
	readonly path: string;
}) {
	const { t } = useI18n();
	const { ops, recover } = useShiftEnv();
	const [open, setOpen] = useState(false);
	const [photo, setPhoto] = useState<Blob | null>(null);
	const [failed, setFailed] = useState(false);
	const show = () => {
		setOpen(true);
		setFailed(false);
		if (photo !== null) return;
		ops.photo(bucket, path).then(setPhoto, (error: unknown) => {
			recover(error);
			setFailed(true);
		});
	};
	return (
		<>
			<button
				type="button"
				onClick={show}
				className={`${secondaryButton} w-auto self-start`}
			>
				{t("ops.photo.view")}
			</button>
			{open ? (
				<Popup title={t("ops.photo.title")} onClose={() => setOpen(false)}>
					{photo !== null ? (
						<PhotoPreviewLarge photo={photo} label={t("ops.photo.title")} />
					) : failed ? (
						<Alert>{t("ops.photo.loadFailed")}</Alert>
					) : (
						<Loading label={t("ops.photo.loading")} />
					)}
				</Popup>
			) : null}
		</>
	);
}

function PhotoPreviewLarge({
	photo,
	label,
}: {
	readonly photo: Blob;
	readonly label: string;
}) {
	const [url, setUrl] = useState<string | null>(null);
	useEffect(() => {
		const created = URL.createObjectURL(photo);
		setUrl(created);
		return () => URL.revokeObjectURL(created);
	}, [photo]);
	return url === null ? null : (
		<img
			src={url}
			alt={label}
			data-testid="photo-large"
			className="w-full rounded-tile border-card border-line object-contain"
		/>
	);
}

function ItemRow({
	run,
	item,
	editable,
	showPhotos,
	onSaved,
	onStale,
}: {
	readonly run: ChecklistRun;
	readonly item: ChecklistItem;
	readonly editable: boolean;
	readonly showPhotos: boolean;
	readonly onSaved: (run: ChecklistRun) => void;
	readonly onStale: () => void;
}) {
	const { t } = useI18n();
	const { ops } = useShiftEnv();
	const tools = usePhotoTools();
	const save = useAction();
	const labelId = useId();
	const numberId = useId();
	const [number, setNumber] = useState(numberText(item.numberValue));
	const [block, setBlock] = useState<string | null>(null);
	const [photoStep, setPhotoStep] = useState<PhotoStep>({ kind: "idle" });
	const [taken, setTaken] = useState<ResizedPhoto | null>(null);
	const [pendingPath, setPendingPath] = useState<string | null>(null);
	const runRef = useRef(run);
	runRef.current = run;
	const itemRef = useRef(item);
	itemRef.current = item;
	const numberRef = useRef(number);
	numberRef.current = number;
	const desiredDone = useRef<boolean | null>(null);
	const queue = useRef<Promise<unknown>>(Promise.resolve());

	const enqueue = (work: () => Promise<boolean>): Promise<boolean> => {
		const next = queue.current.then(work, work);
		queue.current = next.catch(() => false);
		return next;
	};

	const persist = async (done: boolean, photoPath: string | null) => {
		const input = readNumberInput(numberRef.current);
		const result = await save.run(() =>
			ops.saveChecklistAnswer({
				answerId: item.answerId,
				done,
				numberValue: numberValueOf(item, input),
				photoPath,
			}),
		);
		if (result.ok) {
			setPendingPath(null);
			onSaved(withAnswer(runRef.current, result.value));
			return true;
		}
		desiredDone.current = null;
		if (result.failure === "state") onStale();
		return false;
	};

	const toggle = async () => {
		if (!editable) return;
		setBlock(null);
		const next = !(desiredDone.current ?? item.done);
		if (next) {
			const blocked = doneBlock(item, item.photoPath, readNumberInput(number));
			if (blocked !== null) {
				setBlock(`checklist.block.${blocked}`);
				return;
			}
		}
		desiredDone.current = next;
		await enqueue(() => persist(next, itemRef.current.photoPath));
	};

	const saveNumber = async () => {
		if (!editable || item.numberUnit === null) return;
		const input = readNumberInput(number);
		if (input.kind === "invalid") {
			setBlock("checklist.block.number-invalid");
			return;
		}
		const value = input.kind === "value" ? input.value : null;
		if (value === item.numberValue) return;
		setBlock(null);
		const done = (desiredDone.current ?? item.done) && value !== null;
		await enqueue(() => persist(done, itemRef.current.photoPath));
	};

	const upload = async (photo: ResizedPhoto) => {
		const target = runRef.current.photo;
		if (target === null) return;
		setPhotoStep({ kind: "uploading", fraction: 0 });
		const uploaded = await save.run(() =>
			ops.uploadPhoto(target, photo.blob, (fraction) =>
				setPhotoStep({ kind: "uploading", fraction }),
			),
		);
		if (!uploaded.ok) {
			setPhotoStep({ kind: "failed", failure: uploaded.failure });
			return;
		}
		setPendingPath(uploaded.value);
		setPhotoStep({ kind: "idle" });
		const canFinish =
			doneBlock(item, uploaded.value, readNumberInput(number)) === null;
		await persist(canFinish, uploaded.value);
	};

	const takePhoto = async () => {
		if (!editable) return;
		setBlock(null);
		save.clear();
		setPhotoStep({ kind: "taking" });
		const captured = await capturePhoto(tools);
		if (captured.kind !== "photo") {
			setPhotoStep({ kind: captured.kind });
			return;
		}
		setTaken(captured.photo);
		await upload(captured.photo);
	};

	const retry = async () => {
		if (pendingPath !== null) {
			const canFinish =
				doneBlock(item, pendingPath, readNumberInput(number)) === null;
			await persist(canFinish, pendingPath);
			return;
		}
		if (taken !== null) await upload(taken);
	};

	const photoBusy =
		photoStep.kind === "taking" || photoStep.kind === "uploading";
	const noBucket = item.requiresPhoto && run.photo === null;

	return (
		<li
			data-testid="checklist-item"
			data-position={item.position}
			data-done={item.done}
			className="flex flex-col gap-3 rounded-card-2xl border-card border-line bg-surface-raised p-4"
		>
			<div className="flex items-start gap-3">
				<span className="relative -m-2 flex size-11 shrink-0 items-center justify-center">
					<input
						type="checkbox"
						checked={item.done}
						aria-labelledby={labelId}
						aria-busy={save.busy && !photoBusy}
						disabled={!editable}
						onChange={toggle}
						data-testid="item-done"
						className="peer absolute inset-0 m-0 size-11 cursor-pointer appearance-none rounded-field opacity-0 disabled:cursor-default"
					/>
					<span className="pointer-events-none flex size-11 items-center justify-center rounded-control-xl peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-focus peer-disabled:opacity-70">
						{save.busy && !photoBusy ? (
							<span className="text-accent">
								<Spinner />
							</span>
						) : (
							<CheckIcon on={item.done} />
						)}
					</span>
				</span>
				<div className="flex min-w-0 flex-1 flex-col gap-1">
					<p id={labelId} className="text-body font-semibold text-ink">
						{item.label}
					</p>
					<div className="flex flex-wrap gap-2">
						{item.requiresPhoto ? (
							<Chip tone={item.photoPath === null ? "warning" : "positive"}>
								{item.photoPath === null
									? t("checklist.needsPhoto")
									: t("checklist.hasPhoto")}
							</Chip>
						) : null}
					</div>
				</div>
			</div>
			{item.numberUnit !== null ? (
				<div className="flex flex-col gap-1">
					<label htmlFor={numberId} className="text-sm text-ink-muted">
						{t("checklist.number", { unit: item.numberUnit })}
					</label>
					<div className="flex items-center gap-2">
						<input
							id={numberId}
							inputMode="decimal"
							enterKeyHint="done"
							autoComplete="off"
							value={number}
							disabled={!editable}
							onChange={(event) => setNumber(event.target.value)}
							onBlur={saveNumber}
							data-testid="item-number"
							className={`${fieldClass} max-w-40 tabular-nums`}
						/>
						<span className="text-body text-ink">{item.numberUnit}</span>
					</div>
				</div>
			) : null}
			{item.requiresPhoto ? (
				<div className="flex flex-col gap-2">
					{taken !== null ? (
						<PhotoPreview photo={taken} label={t("ops.photo.taken")} />
					) : null}
					{taken === null &&
					item.photoPath !== null &&
					showPhotos &&
					run.photo !== null ? (
						<SavedPhoto bucket={run.photo.bucket} path={item.photoPath} />
					) : null}
					{item.photoRemoved ? <Hint>{t("ops.photo.removed")}</Hint> : null}
					{editable && !noBucket ? (
						<>
							<Hint>{t("checklist.photoPurpose")}</Hint>
							<button
								type="button"
								onClick={takePhoto}
								disabled={photoBusy || save.busy}
								aria-busy={photoStep.kind === "taking"}
								data-testid="take-photo"
								className={secondaryButton}
							>
								<BusyLabel
									busy={photoStep.kind === "taking"}
									busyText={t("ops.photo.opening")}
								>
									{item.photoPath === null && taken === null
										? t("ops.photo.take")
										: t("ops.photo.retake")}
								</BusyLabel>
							</button>
						</>
					) : null}
					{noBucket ? <Hint>{t("ops.photo.noBucket")}</Hint> : null}
					{photoStep.kind === "uploading" ? (
						<UploadProgress fraction={photoStep.fraction} />
					) : null}
					{photoStep.kind === "refused" ? (
						<Hint testId="camera-refused">{t("ops.photo.refused")}</Hint>
					) : null}
					{photoStep.kind === "none" ? (
						<Hint>{t("ops.photo.none")}</Hint>
					) : null}
					{photoStep.kind === "unreadable" ? (
						<Alert>{t("ops.photo.unreadable")}</Alert>
					) : null}
					{photoStep.kind === "failed" ? (
						<div className="flex flex-col gap-2">
							<Alert testId="upload-failed">
								{t("ops.photo.uploadFailed")} {t(failureKey(photoStep.failure))}
							</Alert>
							<button
								type="button"
								onClick={retry}
								disabled={save.busy}
								className={secondaryButton}
							>
								{t("ops.retry")}
							</button>
						</div>
					) : null}
				</div>
			) : null}
			{block !== null ? <Alert testId="item-block">{t(block)}</Alert> : null}
			{save.failure !== null && photoStep.kind !== "failed" ? (
				<div className="flex flex-col gap-2">
					<Alert testId="item-failed">
						{t(
							save.failure === "check"
								? "checklist.error.check"
								: save.failure === "state"
									? "checklist.error.finished"
									: save.failure === "invalid"
										? "checklist.error.photo"
										: failureKey(save.failure),
						)}
					</Alert>
					{pendingPath !== null ? (
						<button
							type="button"
							onClick={retry}
							disabled={save.busy}
							className={secondaryButton}
						>
							{t("ops.retry")}
						</button>
					) : null}
				</div>
			) : null}
		</li>
	);
}

function ProgressBar({ run }: { readonly run: ChecklistRun }) {
	const { t } = useI18n();
	const progress = runProgress(run);
	return (
		<div className="flex flex-col gap-1" data-testid="checklist-progress">
			<p className="text-sm text-ink-muted">
				{t("checklist.progress", {
					done: progress.done,
					total: progress.total,
				})}
			</p>
			<div
				role="progressbar"
				aria-valuemin={0}
				aria-valuemax={progress.total}
				aria-valuenow={progress.done}
				aria-label={t("checklist.progressLabel")}
				className="h-2 w-full overflow-hidden rounded-full bg-surface-sunken"
			>
				<div
					className="h-full rounded-full bg-accent"
					style={{ width: `${progress.percent}%` }}
				/>
			</div>
		</div>
	);
}

export function ChecklistRunScreen({
	request,
	onBack,
}: {
	readonly request: RunRequest;
	readonly onBack: () => void;
}) {
	const { t } = useI18n();
	const { ops, store, recover, memberId, manager, formatters } = useShiftEnv();
	const [load, setLoad] = useState<Load>({ status: "loading" });
	const [confirming, setConfirming] = useState(false);
	const [finishedNow, setFinishedNow] = useState(false);
	const finish = useAction();

	const fetchRun = useCallback(() => {
		setLoad({ status: "loading" });
		const work =
			request.kind === "start"
				? startOnce(ops, request.templateId, store.id)
				: ops.checklistRun(request.runId);
		work.then(
			(run) =>
				setLoad(
					run === null
						? { status: "failed", failure: "not-allowed" }
						: {
								status: "ready",
								run,
								mine:
									request.kind === "start" ||
									(memberId !== null && run.startedBy === memberId),
							},
				),
			(error: unknown) =>
				setLoad({ status: "failed", failure: recover(error) }),
		);
	}, [ops, request, store.id, memberId, recover]);

	useEffect(() => {
		fetchRun();
	}, [fetchRun]);

	if (load.status !== "ready") {
		return (
			<SubScreen
				title={t("checklist.title")}
				onBack={onBack}
				testId="checklist-run"
			>
				{load.status === "loading" ? (
					<Loading label={t("checklist.loading")} />
				) : (
					<>
						<Alert testId="run-failed">
							{t(startFailureKey(load.failure))}
						</Alert>
						<button
							type="button"
							className={primaryButton}
							data-action="primary"
							onClick={load.failure === "network" ? fetchRun : onBack}
						>
							{load.failure === "network"
								? t("ops.retry")
								: t("ops.backToShift")}
						</button>
					</>
				)}
			</SubScreen>
		);
	}

	const run = load.run;
	const access =
		load.mine && run.status === "open" ? "edit" : runAccess(run, memberId);
	const editable = access === "edit";
	const progress = runProgress(run);
	const showPhotos = load.mine || canSeePhotos(run, memberId, manager);
	const update = (next: ChecklistRun) =>
		setLoad({ status: "ready", run: next, mine: load.mine });

	const doFinish = async () => {
		setConfirming(false);
		const result = await finish.run(() => ops.finishChecklistRun(run.runId));
		if (result.ok) {
			update(result.value);
			setFinishedNow(true);
		} else if (result.failure === "not-allowed" || result.failure === "state") {
			fetchRun();
		}
	};

	return (
		<SubScreen
			title={run.title}
			subtitle={t("checklist.subtitle", {
				phase: t(PHASE_KEYS[run.shiftPhase]),
				date: formatters.date(run.businessDate),
				version: run.templateVersion,
			})}
			onBack={onBack}
			backDisabled={finish.busy}
			testId="checklist-run"
		>
			<div
				data-testid="checklist-run-state"
				data-status={run.status}
				data-access={access}
				data-version={run.templateVersion}
				className="flex flex-col gap-3"
			>
				<OfflineBanner />
				{access === "finished" ? (
					<Card testId="run-finished">
						<Chip tone="positive">
							{t("checklist.finishedAt", {
								time:
									run.finishedAt === null
										? ""
										: formatters.time(new Date(run.finishedAt)),
							})}
						</Chip>
						<Hint>{t("checklist.readOnly")}</Hint>
					</Card>
				) : null}
				{access === "other" ? (
					<Card testId="run-other">
						<Chip tone="neutral">{t("checklist.otherOpen")}</Chip>
						<Hint>{t("checklist.otherHint")}</Hint>
					</Card>
				) : null}
				<ProgressBar run={run} />
			</div>
			<ol className="flex flex-col gap-3" aria-label={t("checklist.items")}>
				{run.items.map((item) => (
					<ItemRow
						key={item.answerId}
						run={run}
						item={item}
						editable={editable && !finish.busy}
						showPhotos={showPhotos}
						onSaved={update}
						onStale={fetchRun}
					/>
				))}
			</ol>
			{finish.failure !== null ? (
				<Alert testId="finish-failed">{t(failureKey(finish.failure))}</Alert>
			) : null}
			{editable ? (
				<div className="sticky bottom-[calc(56px+var(--zaui-safe-area-inset-bottom,0px))] -mx-4 border-t border-line bg-surface px-4 pt-3 pb-3">
					<button
						type="button"
						className={primaryButton}
						data-action="primary"
						data-testid="finish-run"
						disabled={finish.busy}
						aria-busy={finish.busy}
						onClick={() =>
							progress.done < progress.total ? setConfirming(true) : doFinish()
						}
					>
						<BusyLabel busy={finish.busy} busyText={t("checklist.finishing")}>
							{t("checklist.finish")}
						</BusyLabel>
					</button>
				</div>
			) : (
				<button
					type="button"
					className={primaryButton}
					data-action="primary"
					onClick={onBack}
				>
					{t("ops.backToShift")}
				</button>
			)}
			{confirming ? (
				<Popup
					title={t("checklist.confirmTitle")}
					onClose={() => setConfirming(false)}
					testId="finish-confirm"
					footer={
						<>
							<button
								type="button"
								className={primaryButton}
								data-action="primary"
								onClick={doFinish}
							>
								{t("checklist.confirmFinish")}
							</button>
							<button
								type="button"
								className={secondaryButton}
								onClick={() => setConfirming(false)}
							>
								{t("checklist.keepWorking")}
							</button>
						</>
					}
				>
					<p className="text-body text-ink">
						{t("checklist.confirmBody", {
							left: progress.total - progress.done,
						})}
					</p>
				</Popup>
			) : null}
			{finishedNow ? (
				<ResultModal
					message={t("checklist.finished")}
					onDone={() => {
						setFinishedNow(false);
						onBack();
					}}
				/>
			) : null}
		</SubScreen>
	);
}
