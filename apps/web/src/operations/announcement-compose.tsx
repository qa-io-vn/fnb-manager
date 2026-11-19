import { useId, useState } from "react";
import { Button } from "../components/ui/button";
import { cn } from "../components/ui/cn";
import { type MessageKey, useT } from "../i18n";
import { todayIn } from "../lib/business-dates";
import { DateField } from "../settings/forms/date-field";
import { controlClass, Field } from "../settings/forms/field";
import { UNAVAILABLE_CLASS } from "../settings/forms/save-bar";
import type { SettingsWriteCode } from "../settings/source";
import { WRITE_ERROR_KEYS } from "../settings/use-settings-mutation";
import { useFormatters } from "../state/formatters";
import { useReadyTenantScope } from "../state/tenant-scope";
import {
	type ComposeValues,
	composeIssues,
	composeRequest,
	emptyCompose,
	hasIssues,
	normalisedBody,
	type PinIssue,
	pinBounds,
	type StoresIssue,
	type TextIssue,
	textLength,
} from "./announcements";
import {
	ANNOUNCEMENT_BODY_MAX,
	ANNOUNCEMENT_STORES_MAX,
	ANNOUNCEMENT_TITLE_MAX,
	type AnnouncementDraft,
} from "./announcements-source";
import { useOperationsAction } from "./use-operations-action";

export const CHECK_ROW =
	"flex min-h-11 items-center gap-3 rounded-lg px-2 hover:bg-surface-sunken";
export const CHECK_INPUT = "size-5 shrink-0 accent-accent";

const TITLE_ISSUE_KEYS: Readonly<Record<TextIssue, MessageKey>> = {
	required: "operations.announcements.issue.title.required",
	tooLong: "operations.announcements.issue.title.tooLong",
	control: "operations.announcements.issue.title.control",
};

const BODY_ISSUE_KEYS: Readonly<Record<TextIssue, MessageKey>> = {
	required: "operations.announcements.issue.body.required",
	tooLong: "operations.announcements.issue.body.tooLong",
	control: "operations.announcements.issue.body.control",
};

const STORES_ISSUE_KEYS: Readonly<Record<StoresIssue, MessageKey>> = {
	none: "operations.announcements.issue.stores.none",
	tooMany: "operations.announcements.issue.stores.tooMany",
};

export const PIN_ISSUE_KEYS: Readonly<Record<PinIssue, MessageKey>> = {
	required: "operations.announcements.issue.pin.required",
	range: "operations.announcements.issue.pin.range",
	afterExpiry: "operations.announcements.issue.pin.afterExpiry",
};

function publishErrorKey(code: SettingsWriteCode): MessageKey {
	return code === "forbidden"
		? "operations.announcements.compose.forbidden"
		: WRITE_ERROR_KEYS[code];
}

function shownIssue<Issue extends string>(
	issue: Issue | null,
	attempted: boolean,
): Issue | null {
	if (issue === null) return null;
	return attempted || issue !== "required" ? issue : null;
}

function toggled(
	list: readonly string[],
	item: string,
	on: boolean,
): readonly string[] {
	return on
		? [...list.filter((value) => value !== item), item]
		: list.filter((value) => value !== item);
}

export function AnnouncementCompose({
	stores,
	everyAllowed,
}: {
	readonly stores: readonly { readonly id: string; readonly name: string }[];
	readonly everyAllowed: boolean;
}) {
	const t = useT();
	const ids = useId();
	const { tenant } = useReadyTenantScope();
	const formatters = useFormatters(tenant);
	const today = todayIn(tenant.timeZone, new Date());
	const bounds = pinBounds(today);
	const blank = () =>
		emptyCompose(
			everyAllowed ? "every" : "chosen",
			stores.map((store) => store.id),
		);
	const [values, setValues] = useState<ComposeValues>(blank);
	const [attempted, setAttempted] = useState(false);
	const [recipients, setRecipients] = useState<number | null>(null);
	const action = useOperationsAction<AnnouncementDraft>(
		async (source, draft) => {
			const published = await source.publishAnnouncement(tenant.id, draft);
			setRecipients(published.recipients);
		},
	);
	const issues = composeIssues(values, today, tenant.timeZone);
	const invalid = hasIssues(issues);
	const titleIssue = shownIssue(issues.title, attempted);
	const bodyIssue = shownIssue(issues.body, attempted);
	const storesIssue = attempted ? issues.stores : null;
	const pinIssue = issues.pin;
	const edit = (change: Partial<ComposeValues>) => {
		setValues((current) => ({ ...current, ...change }));
		if (action.done || action.errorCode !== null) action.reset();
	};
	const submit = async () => {
		setAttempted(true);
		if (invalid || action.running) return;
		const ok = await action.run(composeRequest(values, tenant.timeZone));
		if (ok) {
			setValues(blank());
			setAttempted(false);
		}
	};
	const status = action.running
		? {
				tone: "text-ink-muted",
				text: t("operations.announcements.compose.publishing"),
			}
		: action.errorCode !== null
			? { tone: "text-negative", text: t(publishErrorKey(action.errorCode)) }
			: action.done && recipients !== null
				? {
						tone: "text-positive",
						text:
							recipients === 0
								? t("operations.announcements.compose.publishedNone")
								: t("operations.announcements.compose.published", {
										count: formatters.count(recipients),
									}),
					}
				: attempted && invalid
					? {
							tone: "text-negative",
							text: t("operations.announcements.compose.fix"),
						}
					: null;
	const showStores = !everyAllowed || values.storeChoice === "chosen";
	return (
		<section
			aria-labelledby={`${ids}-heading`}
			className="min-w-0 space-y-3 rounded-xl border border-line bg-surface-raised p-4 print:hidden"
			data-testid="announcement-compose"
		>
			<h2 id={`${ids}-heading`} className="text-base font-semibold">
				{t("operations.announcements.compose.title")}
			</h2>
			<p className="text-sm text-ink-muted">
				{t("operations.announcements.compose.note")}
			</p>
			<form
				noValidate
				className="space-y-3"
				onSubmit={(event) => {
					event.preventDefault();
					void submit();
				}}
			>
				<Field
					id={`${ids}-title`}
					label={t("operations.announcements.compose.titleLabel")}
					hint={t("operations.announcements.compose.titleHint", {
						max: ANNOUNCEMENT_TITLE_MAX,
					})}
					error={
						titleIssue === null
							? null
							: t(TITLE_ISSUE_KEYS[titleIssue], { max: ANNOUNCEMENT_TITLE_MAX })
					}
				>
					{(control) => (
						<input
							{...control}
							type="text"
							autoComplete="off"
							value={values.title}
							readOnly={action.running}
							onChange={(event) => edit({ title: event.target.value })}
							className={controlClass}
							data-testid="announcement-title"
						/>
					)}
				</Field>
				<Field
					id={`${ids}-body`}
					label={t("operations.announcements.compose.bodyLabel")}
					hint={`${t("operations.announcements.compose.bodyHint", { max: ANNOUNCEMENT_BODY_MAX })} ${t(
						"operations.announcements.compose.count",
						{
							count: formatters.count(textLength(normalisedBody(values.body))),
							max: formatters.count(ANNOUNCEMENT_BODY_MAX),
						},
					)}`}
					error={
						bodyIssue === null
							? null
							: t(BODY_ISSUE_KEYS[bodyIssue], { max: ANNOUNCEMENT_BODY_MAX })
					}
				>
					{(control) => (
						<textarea
							{...control}
							rows={6}
							value={values.body}
							readOnly={action.running}
							onChange={(event) => edit({ body: event.target.value })}
							className={`${controlClass} py-2`}
							data-testid="announcement-body-input"
						/>
					)}
				</Field>
				<fieldset
					className="min-w-0 space-y-1 rounded-lg border border-line p-3"
					aria-describedby={
						storesIssue === null ? undefined : `${ids}-stores-error`
					}
					data-testid="announcement-store-choice"
				>
					<legend className="px-1 text-sm font-medium">
						{t("operations.announcements.compose.stores")}
					</legend>
					{everyAllowed ? (
						<>
							<label className={CHECK_ROW}>
								<input
									type="radio"
									name={`${ids}-scope`}
									className={CHECK_INPUT}
									checked={values.storeChoice === "every"}
									disabled={action.running}
									onChange={() => edit({ storeChoice: "every" })}
									data-testid="announcement-every-store"
								/>
								<span>{t("operations.announcements.compose.every")}</span>
							</label>
							<label className={CHECK_ROW}>
								<input
									type="radio"
									name={`${ids}-scope`}
									className={CHECK_INPUT}
									checked={values.storeChoice === "chosen"}
									disabled={action.running}
									onChange={() => edit({ storeChoice: "chosen" })}
									data-testid="announcement-chosen-stores"
								/>
								<span>{t("operations.announcements.compose.chosen")}</span>
							</label>
						</>
					) : (
						<p className="px-1 text-xs text-ink-muted">
							{t("operations.announcements.compose.limitedHint")}
						</p>
					)}
					{showStores ? (
						<div className={everyAllowed ? "ps-6" : undefined}>
							{stores.map((store) => (
								<label key={store.id} className={CHECK_ROW}>
									<input
										type="checkbox"
										className={CHECK_INPUT}
										checked={values.storeIds.includes(store.id)}
										disabled={action.running}
										onChange={(event) =>
											edit({
												storeIds: toggled(
													values.storeIds,
													store.id,
													event.target.checked,
												),
											})
										}
										data-store-id={store.id}
									/>
									<span className="min-w-0 break-words">{store.name}</span>
								</label>
							))}
						</div>
					) : null}
					<p className="px-1 text-xs text-ink-muted">
						{t("operations.announcements.compose.audience")}
					</p>
					{storesIssue === null ? null : (
						<p
							id={`${ids}-stores-error`}
							className="px-1 text-sm text-negative"
							data-testid="settings-field-error"
						>
							{t(STORES_ISSUE_KEYS[storesIssue], {
								max: ANNOUNCEMENT_STORES_MAX,
							})}
						</p>
					)}
				</fieldset>
				<DateField
					id={`${ids}-pin`}
					label={t("operations.announcements.compose.pinLabel")}
					hint={t("operations.announcements.compose.pinHint")}
					error={
						pinIssue === null
							? null
							: t(PIN_ISSUE_KEYS[pinIssue], {
									min: formatters.date(bounds.min),
									max: formatters.date(bounds.max),
								})
					}
					value={values.pinDate}
					onChange={(text) => edit({ pinDate: text })}
					today={today}
					bounds={bounds}
					readOnly={action.running}
					testId="announcement-pin-date"
				/>
				<div className="flex flex-wrap items-center gap-3">
					<Button
						type="submit"
						aria-disabled={action.running || undefined}
						className={UNAVAILABLE_CLASS}
						data-testid="announcement-publish"
					>
						{t("operations.announcements.compose.publish")}
					</Button>
					<p
						role="status"
						className={cn("text-sm", status?.tone ?? null)}
						data-testid="announcement-publish-status"
					>
						{status?.text ?? ""}
					</p>
					{action.canRetry ? (
						<Button
							tone="secondary"
							size="compact"
							onClick={() => void submit()}
							data-testid="announcement-publish-retry"
						>
							{t("app.retry")}
						</Button>
					) : null}
				</div>
			</form>
		</section>
	);
}
