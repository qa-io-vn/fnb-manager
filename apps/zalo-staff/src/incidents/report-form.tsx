import {
	type IncidentCategory,
	type IncidentKind,
	type IncidentReceipt,
	MAX_INCIDENT_PHOTOS,
	type ResizedPhoto,
} from "@fnb/zalo-mini";
import { ResultModal, useI18n } from "@fnb/zalo-mini/react";
import { useId, useRef, useState } from "react";
import { failureKey, useAction, useShiftEnv } from "../shift/env";
import type { Failure } from "../shift/model";
import {
	Alert,
	BusyLabel,
	fieldClass,
	focusRing,
	Hint,
	OfflineBanner,
	SubScreen,
} from "../shift/parts";
import {
	type CaptureResult,
	capturePhoto,
	PhotoPreview,
	UploadProgress,
	usePhotoTools,
} from "../shift/photo";
import { primaryButton, secondaryButton } from "../ui";
import {
	activeCategories,
	defaultCategory,
	MAX_DESCRIPTION,
	MAX_ITEM,
	type ReportProblem,
	reportProblems,
} from "./model";

interface PhotoEntry {
	readonly key: number;
	readonly photo: ResizedPhoto;
}

type Sending =
	| { readonly kind: "form" }
	| {
			readonly kind: "uploading";
			readonly index: number;
			readonly count: number;
			readonly fraction: number;
	  }
	| {
			readonly kind: "photo-failed";
			readonly receipt: IncidentReceipt;
			readonly failure: Failure | "no-bucket";
	  }
	| { readonly kind: "sent" };

const TITLES: Readonly<Record<IncidentKind, string>> = {
	incident: "report.title.incident",
	stock_out: "report.title.stockOut",
};

function problemFor(
	problems: readonly ReportProblem[],
	field: "category" | "description" | "item",
): ReportProblem | undefined {
	return problems.find((problem) => problem.startsWith(field));
}

export function ReportForm({
	kind,
	categories,
	onBack,
}: {
	readonly kind: IncidentKind;
	readonly categories: readonly IncidentCategory[];
	readonly onBack: () => void;
}) {
	const { t } = useI18n();
	const { ops, store } = useShiftEnv();
	const tools = usePhotoTools();
	const send = useAction();
	const categoryId = useId();
	const itemId = useId();
	const descriptionId = useId();
	const reminderId = useId();
	const [categoryKey, setCategoryKey] = useState(() =>
		defaultCategory(kind, categories),
	);
	const [itemLabel, setItemLabel] = useState("");
	const [description, setDescription] = useState("");
	const [photos, setPhotos] = useState<readonly PhotoEntry[]>([]);
	const nextKey = useRef(0);
	const [capture, setCapture] = useState<
		CaptureResult["kind"] | "taking" | null
	>(null);
	const [problems, setProblems] = useState<readonly ReportProblem[]>([]);
	const [sending, setSending] = useState<Sending>({ kind: "form" });
	const uploaded = useRef<string[]>([]);
	const draft = { kind, categoryKey, description, itemLabel };

	const addPhoto = async () => {
		setCapture("taking");
		const result = await capturePhoto(tools);
		if (result.kind === "photo") {
			nextKey.current += 1;
			const entry = { key: nextKey.current, photo: result.photo };
			setPhotos((current) => [...current, entry].slice(0, MAX_INCIDENT_PHOTOS));
			setCapture(null);
		} else {
			setCapture(result.kind);
		}
	};

	const attachPhotos = async (receipt: IncidentReceipt) => {
		if (photos.length === 0) return true;
		const target = receipt.photo;
		if (target === null) {
			setSending({ kind: "photo-failed", receipt, failure: "no-bucket" });
			return false;
		}
		const result = await send.run(async () => {
			for (
				let index = uploaded.current.length;
				index < photos.length;
				index += 1
			) {
				const photo = photos[index]?.photo;
				if (photo === undefined) continue;
				setSending({
					kind: "uploading",
					index: index + 1,
					count: photos.length,
					fraction: 0,
				});
				const path = await ops.uploadPhoto(target, photo.blob, (fraction) =>
					setSending({
						kind: "uploading",
						index: index + 1,
						count: photos.length,
						fraction,
					}),
				);
				uploaded.current = [...uploaded.current, path];
			}
			await ops.updateIncident({
				incidentId: receipt.incidentId,
				categoryKey,
				description: description.trim(),
				itemLabel: kind === "stock_out" ? itemLabel.trim() : null,
				photoPaths: uploaded.current,
			});
		});
		if (!result.ok) {
			setSending({ kind: "photo-failed", receipt, failure: result.failure });
			return false;
		}
		return true;
	};

	const submit = async () => {
		const found = reportProblems(draft, categories);
		setProblems(found);
		if (found.length > 0) return;
		const result = await send.run(() =>
			ops.reportIncident({
				storeId: store.id,
				kind,
				categoryKey,
				description: description.trim(),
				itemLabel: kind === "stock_out" ? itemLabel.trim() : null,
			}),
		);
		if (!result.ok) return;
		if (await attachPhotos(result.value)) setSending({ kind: "sent" });
	};

	const busy = send.busy || sending.kind === "uploading";
	const descriptionProblem = problemFor(problems, "description");
	const itemProblem = problemFor(problems, "item");
	const categoryProblem = problemFor(problems, "category");

	if (sending.kind === "photo-failed") {
		const receipt = sending.receipt;
		return (
			<SubScreen
				title={t(TITLES[kind])}
				onBack={onBack}
				testId="report-photo-failed"
			>
				<OfflineBanner />
				<Alert testId="report-photo-alert">
					{t("report.photoFailed")}{" "}
					{sending.failure === "no-bucket"
						? t("ops.photo.noBucket")
						: t(failureKey(sending.failure))}
				</Alert>
				{sending.failure === "no-bucket" ? null : (
					<button
						type="button"
						className={primaryButton}
						data-action="primary"
						disabled={busy}
						aria-busy={busy}
						onClick={async () => {
							if (await attachPhotos(receipt)) setSending({ kind: "sent" });
						}}
					>
						<BusyLabel busy={busy} busyText={t("report.sending")}>
							{t("report.retryPhotos")}
						</BusyLabel>
					</button>
				)}
				<button
					type="button"
					className={
						sending.failure === "no-bucket" ? primaryButton : secondaryButton
					}
					{...(sending.failure === "no-bucket"
						? { "data-action": "primary" }
						: {})}
					disabled={busy}
					onClick={onBack}
				>
					{t("report.withoutPhotos")}
				</button>
			</SubScreen>
		);
	}

	return (
		<SubScreen
			title={t(TITLES[kind])}
			subtitle={store.name}
			onBack={onBack}
			backDisabled={busy}
			testId="report-form"
		>
			<OfflineBanner />
			<form
				className="flex flex-col gap-4"
				noValidate
				onSubmit={(event) => {
					event.preventDefault();
					submit();
				}}
			>
				<div className="flex flex-col gap-1">
					<label htmlFor={categoryId} className="text-sm text-ink-muted">
						{t("report.category")}
					</label>
					<select
						id={categoryId}
						value={categoryKey}
						onChange={(event) => setCategoryKey(event.target.value)}
						disabled={busy}
						aria-invalid={categoryProblem !== undefined}
						className={fieldClass}
					>
						{activeCategories(categories).map((category) => (
							<option key={category.key} value={category.key}>
								{category.label}
							</option>
						))}
					</select>
					{categoryProblem !== undefined ? (
						<Alert>{t(`report.problem.${categoryProblem}`)}</Alert>
					) : null}
				</div>
				{kind === "stock_out" ? (
					<div className="flex flex-col gap-1">
						<label htmlFor={itemId} className="text-sm text-ink-muted">
							{t("report.item")}
						</label>
						<input
							id={itemId}
							value={itemLabel}
							maxLength={MAX_ITEM}
							autoComplete="off"
							enterKeyHint="next"
							disabled={busy}
							aria-invalid={itemProblem !== undefined}
							onChange={(event) => setItemLabel(event.target.value)}
							data-testid="report-item"
							className={fieldClass}
						/>
						{itemProblem !== undefined ? (
							<Alert>{t(`report.problem.${itemProblem}`)}</Alert>
						) : null}
					</div>
				) : null}
				<div className="flex flex-col gap-1">
					<label htmlFor={descriptionId} className="text-sm text-ink-muted">
						{t(
							kind === "stock_out"
								? "report.descriptionStockOut"
								: "report.description",
						)}
					</label>
					<textarea
						id={descriptionId}
						rows={4}
						value={description}
						disabled={busy}
						aria-describedby={reminderId}
						aria-invalid={descriptionProblem !== undefined}
						onChange={(event) => setDescription(event.target.value)}
						data-testid="report-description"
						className={`${fieldClass} min-h-28`}
					/>
					<div className="flex justify-between gap-2">
						<p
							id={reminderId}
							className="text-sm text-ink-muted"
							data-testid="privacy-reminder"
						>
							{t("ops.noPersonalDetails")}
						</p>
						<p className="shrink-0 text-sm tabular-nums text-ink-muted">
							{t("close.noteCount", {
								count: [...description.trim()].length,
								max: MAX_DESCRIPTION,
							})}
						</p>
					</div>
					{descriptionProblem !== undefined ? (
						<Alert>{t(`report.problem.${descriptionProblem}`)}</Alert>
					) : null}
				</div>
				<div className="flex flex-col gap-2">
					<p className="text-sm text-ink-muted">
						{t("report.photos", {
							count: photos.length,
							max: MAX_INCIDENT_PHOTOS,
						})}
					</p>
					{photos.length > 0 ? (
						<ul className="flex flex-wrap gap-3">
							{photos.map((entry, index) => (
								<li
									key={entry.key}
									className="flex flex-col items-center gap-1"
								>
									<PhotoPreview
										photo={entry.photo}
										label={t("report.photoN", { n: index + 1 })}
									/>
									<button
										type="button"
										disabled={busy}
										onClick={() =>
											setPhotos((current) =>
												current.filter(
													(candidate) => candidate.key !== entry.key,
												),
											)
										}
										className={`min-h-11 min-w-11 rounded-card-xl px-2 text-sm text-negative ${focusRing}`}
									>
										{t("report.removePhoto")}
									</button>
								</li>
							))}
						</ul>
					) : null}
					{photos.length < MAX_INCIDENT_PHOTOS ? (
						<>
							<Hint>{t("report.photoPurpose")}</Hint>
							<button
								type="button"
								className={secondaryButton}
								disabled={busy || capture === "taking"}
								aria-busy={capture === "taking"}
								onClick={addPhoto}
								data-testid="take-photo"
							>
								<BusyLabel
									busy={capture === "taking"}
									busyText={t("ops.photo.opening")}
								>
									{t("report.addPhoto")}
								</BusyLabel>
							</button>
						</>
					) : null}
					{capture === "refused" ? (
						<Hint testId="camera-refused">{t("report.cameraRefused")}</Hint>
					) : null}
					{capture === "none" ? <Hint>{t("ops.photo.none")}</Hint> : null}
					{capture === "unreadable" ? (
						<Alert>{t("ops.photo.unreadable")}</Alert>
					) : null}
				</div>
				{sending.kind === "uploading" ? (
					<div className="flex flex-col gap-1">
						<p className="text-sm text-ink-muted">
							{t("report.uploadingN", {
								index: sending.index,
								count: sending.count,
							})}
						</p>
						<UploadProgress fraction={sending.fraction} />
					</div>
				) : null}
				{send.failure !== null ? (
					<Alert testId="report-failed">
						{t(
							send.failure === "check" || send.failure === "invalid"
								? "report.error.check"
								: failureKey(send.failure),
						)}
					</Alert>
				) : null}
				<button
					type="submit"
					className={primaryButton}
					data-action="primary"
					disabled={busy}
					aria-busy={busy}
				>
					<BusyLabel busy={busy} busyText={t("report.sending")}>
						{t("report.send")}
					</BusyLabel>
				</button>
			</form>
			{sending.kind === "sent" ? (
				<ResultModal message={t("report.sent")} onDone={onBack} />
			) : null}
		</SubScreen>
	);
}
