import type { Handover, Incident, IncidentCategory } from "@fnb/zalo-mini";
import { Popup, ResultModal, useI18n } from "@fnb/zalo-mini/react";
import { useEffect, useState } from "react";
import { failureKey, useAction, useShiftEnv } from "../shift/env";
import { Alert, BusyLabel, Card, Chip, Hint, Loading } from "../shift/parts";
import { PhotoPreview } from "../shift/photo";
import { secondaryButton } from "../ui";
import {
	canAcknowledgeHandover,
	categoryLabel,
	incidentActions,
} from "./model";

function when(
	iso: string,
	formatters: { time(instant: Date): string; date(iso: string): string },
): string {
	const instant = new Date(iso);
	return `${formatters.time(instant)} · ${formatters.date(iso.slice(0, 10))}`;
}

function NoteText({ text }: { readonly text: string }) {
	return (
		<p className="whitespace-pre-line break-words text-base text-ink">{text}</p>
	);
}

function HandoverCard({
	handover,
	onChanged,
}: {
	readonly handover: Handover;
	readonly onChanged: (message: string) => void;
}) {
	const { t } = useI18n();
	const { ops, memberId, manager, formatters } = useShiftEnv();
	const action = useAction();
	const own = memberId !== null && handover.createdBy === memberId;
	const acknowledge = async () => {
		const result = await action.run(() => ops.acknowledgeHandover(handover.id));
		if (result.ok) onChanged(t("review.handoverSeen"));
	};
	return (
		<Card
			testId="handover"
			state={handover.acknowledgedAt === null ? "unread" : "seen"}
		>
			<div className="flex flex-wrap items-center gap-2">
				<Chip tone="accent">
					{t("review.shiftToShift", {
						from: t("ops.shift", { n: handover.fromShift }),
						to: t("ops.shift", { n: handover.toShift }),
					})}
				</Chip>
				<Chip tone={handover.acknowledgedAt === null ? "warning" : "positive"}>
					{handover.acknowledgedAt === null
						? t("review.unread")
						: t("review.seen")}
				</Chip>
				{own ? <Chip tone="neutral">{t("review.yours")}</Chip> : null}
			</div>
			<p className="text-sm text-ink-muted">
				{when(handover.createdAt, formatters)}
			</p>
			<NoteText text={handover.note} />
			{canAcknowledgeHandover(handover, memberId, manager) ? (
				<button
					type="button"
					className={secondaryButton}
					disabled={action.busy}
					aria-busy={action.busy}
					onClick={acknowledge}
				>
					<BusyLabel busy={action.busy} busyText={t("review.saving")}>
						{t("review.markSeen")}
					</BusyLabel>
				</button>
			) : null}
			{action.failure !== null ? (
				<Alert>{t(failureKey(action.failure))}</Alert>
			) : null}
		</Card>
	);
}

function IncidentPhotos({ incident }: { readonly incident: Incident }) {
	const { t } = useI18n();
	const { ops, recover } = useShiftEnv();
	const [photos, setPhotos] = useState<Blob[] | null>(null);
	const [failed, setFailed] = useState(false);
	const bucket = incident.photoBucket;
	useEffect(() => {
		if (bucket === null) return;
		let active = true;
		Promise.all(
			incident.photoPaths.map((path) => ops.photo(bucket, path)),
		).then(
			(blobs) => {
				if (active) setPhotos(blobs);
			},
			(error: unknown) => {
				recover(error);
				if (active) setFailed(true);
			},
		);
		return () => {
			active = false;
		};
	}, [ops, bucket, incident.photoPaths, recover]);
	if (failed) return <Alert>{t("ops.photo.loadFailed")}</Alert>;
	if (photos === null) return <Loading label={t("ops.photo.loading")} />;
	return (
		<ul className="flex flex-wrap gap-3">
			{photos.map((photo, index) => (
				<li key={incident.photoPaths[index]}>
					<PhotoPreview
						photo={photo}
						label={t("report.photoN", { n: index + 1 })}
						testId="incident-photo"
					/>
				</li>
			))}
		</ul>
	);
}

function IncidentCard({
	incident,
	categories,
	onChanged,
}: {
	readonly incident: Incident;
	readonly categories: readonly IncidentCategory[];
	readonly onChanged: (message: string) => void;
}) {
	const { t } = useI18n();
	const { ops, memberId, manager, formatters } = useShiftEnv();
	const action = useAction();
	const [photosOpen, setPhotosOpen] = useState(false);
	const actions = incidentActions(incident, memberId, manager);
	const own = memberId !== null && incident.createdBy === memberId;
	const mayView = manager || own;
	const act = async (kind: "acknowledge" | "resolve") => {
		const result = await action.run(() =>
			kind === "acknowledge"
				? ops.acknowledgeIncident(incident.id)
				: ops.resolveIncident(incident.id),
		);
		if (result.ok)
			onChanged(
				t(
					result.value === "resolved"
						? "review.resolved"
						: "review.incidentSeen",
				),
			);
	};
	return (
		<Card testId="incident" state={incident.status}>
			<div className="flex flex-wrap items-center gap-2">
				<Chip tone={incident.kind === "stock_out" ? "neutral" : "accent"}>
					{t(
						incident.kind === "stock_out"
							? "review.kind.stockOut"
							: "review.kind.incident",
					)}
				</Chip>
				<Chip tone={incident.status === "open" ? "warning" : "positive"}>
					{t(`review.status.${incident.status}`)}
				</Chip>
				{own ? <Chip tone="neutral">{t("review.yours")}</Chip> : null}
			</div>
			<p className="text-sm text-ink-muted">
				{categoryLabel(categories, incident.categoryKey)} ·{" "}
				{when(incident.occurredAt, formatters)}
			</p>
			{incident.itemLabel !== null ? (
				<p className="text-base font-semibold text-ink">
					{t("review.item", { item: incident.itemLabel })}
				</p>
			) : null}
			<NoteText text={incident.description} />
			{incident.photoPaths.length > 0 && mayView ? (
				<button
					type="button"
					className={`${secondaryButton} w-auto self-start`}
					onClick={() => setPhotosOpen(true)}
				>
					{t("review.photos", { count: incident.photoPaths.length })}
				</button>
			) : null}
			{actions.acknowledge || actions.resolve ? (
				<div className="grid grid-cols-2 gap-2">
					{actions.acknowledge ? (
						<button
							type="button"
							className={secondaryButton}
							disabled={action.busy}
							aria-busy={action.busy}
							onClick={() => act("acknowledge")}
						>
							{t("review.markSeen")}
						</button>
					) : null}
					{actions.resolve ? (
						<button
							type="button"
							className={`${secondaryButton} ${actions.acknowledge ? "" : "col-span-2"}`}
							disabled={action.busy}
							aria-busy={action.busy}
							onClick={() => act("resolve")}
						>
							{t("review.markResolved")}
						</button>
					) : null}
				</div>
			) : null}
			{actions.waitingForAnother ? (
				<Hint>{t("review.waitingForAnother")}</Hint>
			) : null}
			{action.busy ? <Loading label={t("review.saving")} /> : null}
			{action.failure !== null ? (
				<Alert>{t(failureKey(action.failure))}</Alert>
			) : null}
			{photosOpen ? (
				<Popup
					title={t("ops.photo.title")}
					onClose={() => setPhotosOpen(false)}
				>
					<IncidentPhotos incident={incident} />
				</Popup>
			) : null}
		</Card>
	);
}

function ChangeModal({
	message,
	onDone,
}: {
	readonly message: string | null;
	readonly onDone: () => void;
}) {
	return message === null ? null : (
		<ResultModal message={message} onDone={onDone} />
	);
}

export function HandoverList({
	handovers,
	onChanged,
}: {
	readonly handovers: readonly Handover[];
	readonly onChanged: () => void;
}) {
	const { t } = useI18n();
	const [message, setMessage] = useState<string | null>(null);
	return (
		<>
			{handovers.length === 0 ? (
				<Hint testId="handovers-empty">{t("review.noHandovers")}</Hint>
			) : (
				<div className="flex flex-col gap-3" data-testid="handovers">
					{handovers.map((handover) => (
						<HandoverCard
							key={handover.id}
							handover={handover}
							onChanged={setMessage}
						/>
					))}
				</div>
			)}
			<ChangeModal
				message={message}
				onDone={() => {
					setMessage(null);
					onChanged();
				}}
			/>
		</>
	);
}

export function IncidentList({
	incidents,
	categories,
	onChanged,
}: {
	readonly incidents: readonly Incident[];
	readonly categories: readonly IncidentCategory[];
	readonly onChanged: () => void;
}) {
	const { t } = useI18n();
	const [message, setMessage] = useState<string | null>(null);
	return (
		<>
			{incidents.length === 0 ? (
				<Hint testId="incidents-empty">{t("review.noIncidents")}</Hint>
			) : (
				<div className="flex flex-col gap-3" data-testid="incidents">
					{incidents.map((incident) => (
						<IncidentCard
							key={incident.id}
							incident={incident}
							categories={categories}
							onChanged={setMessage}
						/>
					))}
				</div>
			)}
			<ChangeModal
				message={message}
				onDone={() => {
					setMessage(null);
					onChanged();
				}}
			/>
		</>
	);
}
