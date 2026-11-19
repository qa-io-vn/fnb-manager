import { ResultModal, useI18n } from "@fnb/zalo-mini/react";
import { type FormEvent, useId, useState } from "react";
import { failureKey } from "../shift/env";
import type { Failure } from "../shift/model";
import { Alert, BusyLabel, fieldClass, Hint, SubScreen } from "../shift/parts";
import { useTeamAction, useTeamEnv } from "../team/env";
import { primaryButton } from "../ui";
import {
	MAX_BODY_LENGTH,
	MAX_TITLE_LENGTH,
	PIN_DAYS,
	type PinDays,
} from "./contract";
import { type DraftProblem, draftProblems, pinEnd } from "./model";

export function CheckOption({
	checked,
	disabled,
	label,
	testId,
	onChange,
}: {
	readonly checked: boolean;
	readonly disabled: boolean;
	readonly label: string;
	readonly testId?: string;
	readonly onChange: (checked: boolean) => void;
}) {
	return (
		<label
			className={`relative flex min-h-12 items-center gap-3 rounded-xl border px-3 py-2 text-base text-ink ${checked ? "border-accent bg-surface-sunken" : "border-line"} has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-focus`}
		>
			<input
				type="checkbox"
				checked={checked}
				disabled={disabled}
				data-testid={testId}
				onChange={(event) => onChange(event.target.checked)}
				className="absolute inset-0 m-0 size-full cursor-pointer appearance-none rounded-xl opacity-0 disabled:cursor-default"
			/>
			<span
				aria-hidden="true"
				className={`flex size-5 shrink-0 items-center justify-center rounded-md border-2 ${checked ? "border-accent bg-accent text-accent-ink" : "border-ink-muted"}`}
			>
				{checked ? (
					<svg
						aria-hidden="true"
						width="14"
						height="14"
						viewBox="0 0 14 14"
						fill="none"
						stroke="currentColor"
						strokeWidth="2.2"
						strokeLinecap="round"
						strokeLinejoin="round"
					>
						<path d="M3 7.5l2.5 2.5L11 4.5" />
					</svg>
				) : null}
			</span>
			<span className="min-w-0 break-words">{label}</span>
		</label>
	);
}

function problemKey(problem: DraftProblem): string {
	return `notices.problem.${problem.field}.${problem.problem}`;
}

function publishFailureKey(failure: Failure): string {
	if (failure === "invalid" || failure === "check")
		return "notices.error.invalid";
	if (failure === "not-allowed") return "notices.error.notAllowed";
	return failureKey(failure);
}

export function ComposeAnnouncement({
	onBack,
	onPublished,
}: {
	readonly onBack: () => void;
	readonly onPublished: () => void;
}) {
	const { t } = useI18n();
	const { client, context } = useTeamEnv();
	const action = useTeamAction();
	const titleId = useId();
	const bodyId = useId();
	const storesId = useId();
	const pinId = useId();
	const [title, setTitle] = useState("");
	const [body, setBody] = useState("");
	const [storeIds, setStoreIds] = useState<readonly string[]>(() =>
		context.stores.map((store) => store.id),
	);
	const [pinDays, setPinDays] = useState<PinDays | null>(null);
	const [problems, setProblems] = useState<readonly DraftProblem[]>([]);
	const [published, setPublished] = useState<number | null>(null);
	const busy = action.busy;
	const touch = () => {
		setProblems([]);
		action.clear();
	};
	const submit = async (event: FormEvent) => {
		event.preventDefault();
		if (busy) return;
		const draft = {
			title,
			body,
			storeIds,
			pinnedUntil: pinEnd(pinDays, new Date()),
		};
		const found = draftProblems(draft);
		if (found.length > 0) {
			setProblems(found);
			return;
		}
		const tenantId = context.tenantId;
		const result = await action.run(async () => {
			if (tenantId === null) throw new Error("no tenant");
			return client.publish(tenantId, draft);
		});
		if (result.ok) setPublished(result.value.recipients);
	};
	return (
		<SubScreen
			title={t("notices.compose")}
			onBack={onBack}
			backDisabled={busy}
			testId="notice-compose"
		>
			<form
				className="flex flex-col gap-4"
				onSubmit={(event) => void submit(event)}
				noValidate
			>
				<div className="flex flex-col gap-1">
					<label htmlFor={titleId} className="text-sm text-ink-muted">
						{t("notices.field.title")}
					</label>
					<input
						id={titleId}
						data-testid="notice-title"
						value={title}
						disabled={busy}
						maxLength={MAX_TITLE_LENGTH}
						onChange={(event) => {
							setTitle(event.target.value);
							touch();
						}}
						className={fieldClass}
					/>
				</div>
				<div className="flex flex-col gap-1">
					<label htmlFor={bodyId} className="text-sm text-ink-muted">
						{t("notices.field.body")}
					</label>
					<textarea
						id={bodyId}
						data-testid="notice-text"
						value={body}
						disabled={busy}
						maxLength={MAX_BODY_LENGTH}
						rows={6}
						onChange={(event) => {
							setBody(event.target.value);
							touch();
						}}
						className={`${fieldClass} min-h-32`}
					/>
					<Hint>{t("notices.field.bodyHint")}</Hint>
				</div>
				<fieldset
					className="flex flex-col gap-2"
					aria-labelledby={storesId}
					data-testid="notice-stores"
				>
					<legend id={storesId} className="mb-1 text-sm text-ink-muted">
						{t("notices.field.stores")}
					</legend>
					{context.stores.map((store) => (
						<CheckOption
							key={store.id}
							label={store.name}
							checked={storeIds.includes(store.id)}
							disabled={busy}
							onChange={(checked) => {
								setStoreIds((current) =>
									checked
										? [...current, store.id]
										: current.filter((id) => id !== store.id),
								);
								touch();
							}}
						/>
					))}
				</fieldset>
				<div className="flex flex-col gap-1">
					<label htmlFor={pinId} className="text-sm text-ink-muted">
						{t("notices.field.pin")}
					</label>
					<select
						id={pinId}
						data-testid="notice-pin"
						value={pinDays === null ? "none" : String(pinDays)}
						disabled={busy}
						onChange={(event) => {
							const days = PIN_DAYS.find(
								(candidate) => String(candidate) === event.target.value,
							);
							setPinDays(days ?? null);
							touch();
						}}
						className={fieldClass}
					>
						<option value="none">{t("notices.pin.none")}</option>
						{PIN_DAYS.map((days) => (
							<option key={days} value={String(days)}>
								{t("notices.pin.days", { days })}
							</option>
						))}
					</select>
				</div>
				{problems.map((problem) => (
					<Alert key={problem.field} testId={`notice-problem-${problem.field}`}>
						{t(problemKey(problem))}
					</Alert>
				))}
				{action.failure === null ? null : (
					<Alert testId="notice-publish-failed">
						{t(publishFailureKey(action.failure))}
					</Alert>
				)}
				<button
					type="submit"
					className={primaryButton}
					data-action="primary"
					disabled={busy}
					aria-busy={busy}
				>
					<BusyLabel busy={busy} busyText={t("notices.publishing")}>
						{t("notices.publish")}
					</BusyLabel>
				</button>
			</form>
			{published === null ? null : (
				<ResultModal
					message={t("notices.published", { count: published })}
					onDone={onPublished}
				/>
			)}
		</SubScreen>
	);
}
