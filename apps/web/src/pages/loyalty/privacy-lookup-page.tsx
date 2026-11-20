import { normalizeLoyaltyPhone } from "@fnb/core";
import { useId, useState } from "react";
import { Button } from "../../components/ui/button";
import { useT } from "../../i18n";
import { todayIn } from "../../lib/business-dates";
import { useLoyaltyAction } from "../../loyalty/queries";
import { privacyAccess } from "../../privacy/access";
import { ActionDone, ActionError } from "../../privacy/action-notice";
import { useSubjectLookup } from "../../privacy/queries";
import { RequestForm } from "../../privacy/request-form";
import {
	type ConsentPurpose,
	type ConsentRow,
	REVOCABLE_PURPOSES,
	type SubjectSummary,
} from "../../privacy/source";
import { controlClass, Field } from "../../settings/forms/field";
import { useMembership } from "../../settings/queries";
import { useFormatters } from "../../state/formatters";
import { useReadyTenantScope } from "../../state/tenant-scope";
import { CustomersLayout, Notice } from "./customers-layout";

const PURPOSE_KEYS = {
	loyalty: "loyalty.privacy.consent.purpose.loyalty",
	marketing: "loyalty.privacy.consent.purpose.marketing",
	staff_ops: "loyalty.privacy.consent.purpose.staff_ops",
} as const;

function ConsentList({
	consents,
	onRevoked,
}: {
	readonly consents: readonly ConsentRow[];
	readonly onRevoked: () => void;
}) {
	const t = useT();
	const { tenant } = useReadyTenantScope();
	const formatters = useFormatters(tenant);
	const [confirming, setConfirming] = useState<string | null>(null);
	const [revokedPurpose, setRevokedPurpose] = useState<ConsentPurpose | null>(
		null,
	);
	const revoke = useLoyaltyAction((source, consentId: string) =>
		source.privacy.revokeConsent(consentId),
	);
	const day = (iso: string) =>
		formatters.date(todayIn(tenant.timeZone, new Date(iso)));
	if (consents.length === 0) {
		return (
			<p className="text-sm text-ink-muted" data-testid="privacy-consent-none">
				{t("loyalty.privacy.consent.none")}
			</p>
		);
	}
	return (
		<div className="space-y-2" data-testid="privacy-consents">
			<h4 className="text-sm font-semibold">
				{t("loyalty.privacy.consent.title")}
			</h4>
			<ul className="divide-y divide-line">
				{consents.map((consent) => {
					const purpose = t(PURPOSE_KEYS[consent.purpose]);
					const canRevoke =
						consent.active && REVOCABLE_PURPOSES.includes(consent.purpose);
					return (
						<li
							key={consent.id}
							className="space-y-2 py-2"
							data-testid="privacy-consent"
							data-purpose={consent.purpose}
							data-active={consent.active ? "true" : "false"}
						>
							<div className="flex flex-wrap items-center gap-x-3 gap-y-1">
								<span className="font-medium">{purpose}</span>
								<span className="text-sm text-ink-muted">
									{consent.revokedAt === null
										? t("loyalty.privacy.consent.active", {
												date: day(consent.grantedAt),
												channel: consent.channel,
											})
										: t("loyalty.privacy.consent.revoked", {
												date: day(consent.revokedAt),
											})}
								</span>
								{canRevoke && confirming !== consent.id ? (
									<Button
										tone="secondary"
										size="compact"
										onClick={() => setConfirming(consent.id)}
										data-testid="privacy-revoke"
									>
										{t("loyalty.privacy.consent.revoke", { purpose })}
									</Button>
								) : null}
							</div>
							{confirming === consent.id ? (
								<fieldset
									className="min-w-0 rounded-lg border border-warning bg-warning-soft p-3"
									data-testid="privacy-revoke-confirm"
								>
									<legend className="float-left w-full text-sm">
										{t("loyalty.privacy.consent.revokeConfirm", { purpose })}
									</legend>
									<div className="clear-left flex flex-wrap gap-2 pt-2">
										<Button
											size="compact"
											disabled={revoke.running}
											onClick={() => {
												void revoke.run(consent.id).then((done) => {
													setConfirming(null);
													if (done !== null) {
														setRevokedPurpose(consent.purpose);
														onRevoked();
													}
												});
											}}
											data-testid="privacy-revoke-yes"
										>
											{t("loyalty.privacy.consent.revokeYes")}
										</Button>
										<Button
											tone="secondary"
											size="compact"
											onClick={() => setConfirming(null)}
										>
											{t("loyalty.privacy.consent.cancel")}
										</Button>
									</div>
								</fieldset>
							) : null}
						</li>
					);
				})}
			</ul>
			<ActionError code={revoke.errorCode} testId="privacy-revoke-error" />
			<ActionDone
				testId="privacy-revoke-done"
				message={
					revokedPurpose === null
						? null
						: t("loyalty.privacy.consent.revoked.done", {
								purpose: t(PURPOSE_KEYS[revokedPurpose]),
							})
				}
			/>
		</div>
	);
}

function SubjectCard({
	subject,
	canRecord,
	onChanged,
}: {
	readonly subject: SubjectSummary;
	readonly canRecord: boolean;
	readonly onChanged: () => void;
}) {
	const t = useT();
	const record = useLoyaltyAction(
		(source, request: Parameters<typeof source.privacy.recordRequest>[1]) =>
			source.privacy.recordRequest(subject.tenantId, request),
	);
	const [recorded, setRecorded] = useState(false);
	return (
		<li
			className="space-y-3 py-4"
			data-testid="privacy-subject"
			data-customer={subject.customerId}
		>
			<div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
				<span className="font-medium" data-testid="privacy-subject-name">
					{subject.name === null
						? t("loyalty.privacy.lookup.noName")
						: t("loyalty.privacy.lookup.name", { name: subject.name })}
				</span>
				<span className="tabular-nums" data-testid="privacy-subject-phone">
					{subject.phoneMasked}
				</span>
			</div>
			<p
				className="text-sm text-ink-muted"
				data-testid="privacy-subject-counts"
			>
				{t("loyalty.privacy.lookup.counts", {
					memberships: subject.memberships,
					entries: subject.ledgerEntries,
					stamps: subject.stampTotal,
					points: subject.pointTotal,
					messages: subject.messages,
					open: subject.openRequests,
				})}
			</p>
			<ConsentList consents={subject.consents} onRevoked={onChanged} />
			{canRecord ? (
				<div className="space-y-2 rounded-lg border border-line p-3">
					<RequestForm
						subjectId={subject.customerId}
						busy={record.running}
						onSubmit={(request) => {
							setRecorded(false);
							void record.run(request).then((done) => {
								if (done !== null) {
									setRecorded(true);
									onChanged();
								}
							});
						}}
					/>
					<ActionError code={record.errorCode} testId="privacy-record-error" />
					<ActionDone
						testId="privacy-record-done"
						message={recorded ? t("loyalty.privacy.form.recorded") : null}
					/>
				</div>
			) : null}
		</li>
	);
}

function LookupSection() {
	const t = useT();
	const ids = useId();
	const lookup = useSubjectLookup();
	const [phone, setPhone] = useState("");
	const [invalid, setInvalid] = useState(false);
	const [shown, setShown] = useState<SubjectSummary[] | null>(null);
	const submit = (value: string, fresh: boolean) => {
		if (fresh) setShown(null);
		lookup.mutate(value, { onSuccess: (rows) => setShown(rows) });
	};
	return (
		<section
			aria-labelledby={`${ids}-heading`}
			className="space-y-3 rounded-xl border border-line bg-surface-raised p-4 print:hidden"
			data-testid="privacy-lookup"
		>
			<h2 id={`${ids}-heading`} className="text-base font-semibold">
				{t("loyalty.privacy.lookup.title")}
			</h2>
			<p className="text-sm text-ink-muted">
				{t("loyalty.privacy.lookup.hint")}
			</p>
			<form
				className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end"
				onSubmit={(event) => {
					event.preventDefault();
					const ok = normalizeLoyaltyPhone(phone) !== null;
					setInvalid(!ok);
					if (!ok) {
						setShown(null);
						lookup.reset();
						return;
					}
					submit(phone, true);
				}}
			>
				<Field
					id={`${ids}-phone`}
					label={t("loyalty.privacy.lookup.phone")}
					error={invalid ? t("loyalty.privacy.lookup.invalid") : null}
				>
					{(control) => (
						<input
							{...control}
							type="tel"
							inputMode="tel"
							autoComplete="off"
							value={phone}
							onChange={(event) => {
								setPhone(event.target.value);
								setInvalid(false);
							}}
							className={controlClass}
							data-testid="privacy-lookup-input"
						/>
					)}
				</Field>
				<Button
					type="submit"
					size="compact"
					aria-disabled={lookup.isPending || undefined}
					data-testid="privacy-lookup-submit"
				>
					{t("loyalty.privacy.lookup.submit")}
				</Button>
			</form>
			<div aria-live="polite">
				{lookup.isError ? (
					<p role="alert" className="text-sm text-negative">
						{t("loyalty.privacy.lookup.failed")}
					</p>
				) : shown !== null ? (
					shown.length === 0 ? (
						<p className="text-sm" data-testid="privacy-lookup-none">
							{t("loyalty.privacy.lookup.none")}
						</p>
					) : (
						<ul className="divide-y divide-line" data-testid="privacy-subjects">
							{shown.map((subject) => (
								<SubjectCard
									key={subject.customerId}
									subject={subject}
									canRecord
									onChanged={() => submit(phone, false)}
								/>
							))}
						</ul>
					)
				) : lookup.isPending ? (
					<p role="status" className="text-sm text-ink-muted">
						{t("app.loading")}
					</p>
				) : null}
			</div>
		</section>
	);
}

export function PrivacyLookupPage() {
	const t = useT();
	const membership = useMembership();
	const access = privacyAccess(
		membership.status === "success" ? membership.data : undefined,
	);
	return (
		<CustomersLayout page="tra-cuu-du-lieu">
			{() =>
				access.canHandle ? (
					<LookupSection />
				) : (
					<Notice testId="privacy-no-access">
						{t("loyalty.privacy.noAccess")}
					</Notice>
				)
			}
		</CustomersLayout>
	);
}
