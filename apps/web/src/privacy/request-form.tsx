import { useId, useState } from "react";
import { Button } from "../components/ui/button";
import { type MessageKey, useT } from "../i18n";
import { controlClass, Field } from "../settings/forms/field";
import {
	checkRequest,
	isRequestType,
	type RequestIssue,
} from "./request-rules";
import { type NewRequest, REQUEST_TYPES, type RequestType } from "./source";

export const REQUEST_TYPE_KEYS: Readonly<Record<RequestType, MessageKey>> = {
	access: "loyalty.privacy.type.access",
	correction: "loyalty.privacy.type.correction",
	deletion: "loyalty.privacy.type.deletion",
	export: "loyalty.privacy.type.export",
	objection: "loyalty.privacy.type.objection",
	withdraw_consent: "loyalty.privacy.type.withdraw_consent",
};

const ISSUE_KEYS: Readonly<Record<RequestIssue, MessageKey>> = {
	type: "loyalty.privacy.form.issue.type",
	contactEmpty: "loyalty.privacy.form.issue.contactEmpty",
	contactTooLong: "loyalty.privacy.form.issue.contactTooLong",
	notesTooLong: "loyalty.privacy.form.issue.notesTooLong",
	control: "loyalty.privacy.form.issue.control",
};

export interface RequestFormProps {
	readonly subjectId: string | null;
	readonly busy: boolean;
	readonly onSubmit: (request: NewRequest) => void;
}

export function RequestForm({ subjectId, busy, onSubmit }: RequestFormProps) {
	const t = useT();
	const ids = useId();
	const [requestType, setRequestType] = useState<string>("access");
	const [contact, setContact] = useState("");
	const [usesProcessor, setUsesProcessor] = useState(false);
	const [notes, setNotes] = useState("");
	const [issues, setIssues] = useState<readonly RequestIssue[]>([]);
	const issueOf = (...wanted: RequestIssue[]): string | null => {
		const found = issues.find((issue) => wanted.includes(issue));
		return found === undefined ? null : t(ISSUE_KEYS[found]);
	};
	return (
		<form
			className="space-y-3"
			data-testid="privacy-request-form"
			noValidate
			onSubmit={(event) => {
				event.preventDefault();
				const check = checkRequest({
					requestType,
					contact,
					usesProcessor,
					notes,
					subjectId,
				});
				setIssues(check.issues);
				if (check.value !== null) onSubmit(check.value);
			}}
		>
			<h3 className="text-sm font-semibold">
				{t("loyalty.privacy.form.title")}
			</h3>
			<p className="text-sm text-ink-muted">
				{t(
					subjectId === null
						? "loyalty.privacy.form.unlinked"
						: "loyalty.privacy.form.linked",
				)}
			</p>
			<div className="grid gap-3 sm:grid-cols-2">
				<Field
					id={`${ids}-type`}
					label={t("loyalty.privacy.form.type")}
					error={issueOf("type")}
				>
					{(control) => (
						<select
							{...control}
							className={controlClass}
							value={requestType}
							onChange={(event) => setRequestType(event.target.value)}
							data-testid="privacy-form-type"
						>
							{REQUEST_TYPES.map((type) => (
								<option key={type} value={type}>
									{t(REQUEST_TYPE_KEYS[type])}
								</option>
							))}
						</select>
					)}
				</Field>
				<Field
					id={`${ids}-contact`}
					label={t("loyalty.privacy.form.contact")}
					hint={t("loyalty.privacy.form.contactHint")}
					error={issueOf("contactEmpty", "contactTooLong", "control")}
				>
					{(control) => (
						<input
							{...control}
							type="text"
							autoComplete="off"
							className={controlClass}
							value={contact}
							onChange={(event) => setContact(event.target.value)}
							data-testid="privacy-form-contact"
						/>
					)}
				</Field>
			</div>
			<label className="flex items-start gap-2 text-sm">
				<input
					type="checkbox"
					className="mt-1 size-4"
					checked={usesProcessor}
					onChange={(event) => setUsesProcessor(event.target.checked)}
					data-testid="privacy-form-processor"
				/>
				<span>{t("loyalty.privacy.form.processor")}</span>
			</label>
			<Field
				id={`${ids}-notes`}
				label={t("loyalty.privacy.form.notes")}
				error={issueOf("notesTooLong")}
			>
				{(control) => (
					<textarea
						{...control}
						rows={2}
						className={controlClass}
						value={notes}
						onChange={(event) => setNotes(event.target.value)}
						data-testid="privacy-form-notes"
					/>
				)}
			</Field>
			<Button
				type="submit"
				disabled={busy || !isRequestType(requestType)}
				data-testid="privacy-form-submit"
			>
				{t("loyalty.privacy.form.submit")}
			</Button>
		</form>
	);
}
