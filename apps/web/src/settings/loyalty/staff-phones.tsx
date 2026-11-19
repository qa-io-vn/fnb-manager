import { normalizeLoyaltyPhone } from "@fnb/core";
import { useCallback, useId, useState } from "react";
import { Button } from "../../components/ui/button";
import { cn } from "../../components/ui/cn";
import { type MessageKey, useT } from "../../i18n";
import { todayIn } from "../../lib/business-dates";
import type { Formatters } from "../../lib/format";
import { maskPhone } from "../../loyalty/mask-phone";
import type {
	LoyaltySource,
	StaffPhoneChange,
	StaffPhoneRow,
} from "../../loyalty/source";
import { controlClass, Field } from "../forms/field";
import { UNAVAILABLE_CLASS } from "../forms/save-bar";
import { useLoyaltyStaffPhones } from "../queries";
import { SectionLoadState, useSectionLoad } from "../section-load";
import { type SettingsWriteCode, SettingsWriteError } from "../source";
import {
	useSettingsMutation,
	WRITE_ERROR_KEYS,
} from "../use-settings-mutation";

export const STAFF_PHONE_LABEL_MAX = 100;

type PhoneAction =
	| { readonly kind: "add"; readonly change: StaffPhoneChange }
	| { readonly kind: "remove"; readonly row: StaffPhoneRow };

export function staffPhoneErrorKey(
	kind: PhoneAction["kind"],
	code: SettingsWriteCode,
): MessageKey {
	if (kind === "add" && code === "duplicate") {
		return "settings.loyalty.phones.duplicate";
	}
	if (kind === "add" && code === "invalid") {
		return "settings.loyalty.phones.invalid";
	}
	return WRITE_ERROR_KEYS[code];
}

export function readStaffPhone(
	phone: string,
	label: string,
): {
	change: StaffPhoneChange | null;
	phoneKey: MessageKey | null;
	labelKey: MessageKey | null;
} {
	const normalized = normalizeLoyaltyPhone(phone);
	const trimmed = label.trim();
	const phoneKey: MessageKey | null =
		phone.trim() === ""
			? "settings.validation.required"
			: normalized === null
				? "settings.loyalty.phones.invalid"
				: null;
	const labelKey: MessageKey | null =
		[...trimmed].length > STAFF_PHONE_LABEL_MAX
			? "settings.loyalty.phones.labelTooLong"
			: null;
	return {
		change:
			normalized === null || labelKey !== null
				? null
				: { phone: normalized, label: trimmed === "" ? null : trimmed },
		phoneKey,
		labelKey,
	};
}

function loyaltyOf(loyalty: LoyaltySource | null): LoyaltySource {
	if (loyalty === null) throw new SettingsWriteError("network");
	return loyalty;
}

export function StaffPhones({
	loyalty,
	canWrite,
	formatters,
	timeZone,
}: {
	readonly loyalty: LoyaltySource | null;
	readonly canWrite: boolean;
	readonly formatters: Formatters;
	readonly timeZone: string;
}) {
	const t = useT();
	const ids = useId();
	const phones = useLoyaltyStaffPhones(true);
	const load = useSectionLoad([phones]);
	const [phone, setPhone] = useState("");
	const [label, setLabel] = useState("");
	const [tried, setTried] = useState(false);
	const [last, setLast] = useState<PhoneAction | null>(null);
	const write = useCallback(
		async (_source: unknown, tenantId: string, action: PhoneAction) => {
			const target = loyaltyOf(loyalty);
			if (action.kind === "add") {
				await target.addStaffPhone(tenantId, action.change);
			} else {
				await target.removeStaffPhone(tenantId, action.row.id);
			}
		},
		[loyalty],
	);
	const mutation = useSettingsMutation(write);
	const draft = readStaffPhone(phone, label);
	const status =
		last === null
			? null
			: mutation.saving
				? { tone: "text-ink-muted", text: t("settings.saving") }
				: mutation.errorCode !== null
					? {
							tone: "text-negative",
							text: t(staffPhoneErrorKey(last.kind, mutation.errorCode)),
						}
					: mutation.saved
						? {
								tone: "text-positive",
								text: t(
									last.kind === "add"
										? "settings.loyalty.phones.added"
										: "settings.loyalty.phones.removed",
									{
										phone:
											maskPhone(
												last.kind === "add"
													? last.change.phone
													: last.row.phone,
											) ?? "",
									},
								),
							}
						: null;
	const run = (action: PhoneAction) => {
		setLast(action);
		void mutation.save(action).then((ok) => {
			if (ok && action.kind === "add") {
				setPhone("");
				setLabel("");
				setTried(false);
			}
		});
	};
	const rows = phones.data;
	return (
		<section
			aria-labelledby={`${ids}-heading`}
			className="min-w-0 space-y-3 rounded-xl border border-line bg-surface-raised p-4"
			data-testid="loyalty-staff-phones"
		>
			<h3 id={`${ids}-heading`} className="text-base font-semibold">
				{t("settings.loyalty.phones.title")}
			</h3>
			<p className="text-sm text-ink-muted">
				{t("settings.loyalty.phones.intro")}
			</p>
			{rows === undefined ? (
				<SectionLoadState load={load} failedTestId="loyalty-phones-failed" />
			) : rows.length === 0 ? (
				<p className="text-sm" data-testid="loyalty-phones-none">
					{t("settings.loyalty.phones.none")}
				</p>
			) : (
				<ul className="divide-y divide-line" data-testid="loyalty-phones-list">
					{rows.map((row) => {
						const masked =
							maskPhone(row.phone) ?? t("settings.loyalty.phones.unreadable");
						return (
							<li
								key={row.id}
								className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2"
								data-testid="loyalty-phone"
							>
								<span
									className="font-medium tabular-nums"
									data-testid="loyalty-phone-masked"
								>
									{masked}
								</span>
								<span className="text-sm text-ink-muted">
									{[
										row.label,
										t("settings.loyalty.phones.addedOn", {
											date: formatters.date(
												todayIn(timeZone, new Date(row.createdAt)),
											),
										}),
									]
										.filter((part) => part !== null)
										.join(" · ")}
								</span>
								{canWrite ? (
									<Button
										tone="secondary"
										size="compact"
										className={cn("ml-auto", UNAVAILABLE_CLASS)}
										aria-label={t("settings.loyalty.phones.removeLabel", {
											phone: masked,
										})}
										aria-disabled={mutation.saving || undefined}
										onClick={
											mutation.saving
												? undefined
												: () => run({ kind: "remove", row })
										}
										data-testid="loyalty-phone-remove"
									>
										{t("settings.loyalty.phones.remove")}
									</Button>
								) : null}
							</li>
						);
					})}
				</ul>
			)}
			{canWrite ? (
				<form
					className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end"
					data-testid="loyalty-phone-form"
					onSubmit={(event) => {
						event.preventDefault();
						setTried(true);
						if (draft.change === null || mutation.saving) return;
						run({ kind: "add", change: draft.change });
					}}
				>
					<Field
						id={`${ids}-phone`}
						label={t("settings.loyalty.phones.phone")}
						hint={t("settings.loyalty.phones.phoneHint")}
						error={tried && draft.phoneKey !== null ? t(draft.phoneKey) : null}
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
									if (last !== null && !mutation.saving) {
										mutation.reset();
										setLast(null);
									}
								}}
								className={controlClass}
								data-testid="loyalty-phone-input"
							/>
						)}
					</Field>
					<Field
						id={`${ids}-label`}
						label={t("settings.loyalty.phones.label")}
						hint={t("settings.loyalty.phones.labelHint")}
						error={draft.labelKey === null ? null : t(draft.labelKey)}
					>
						{(control) => (
							<input
								{...control}
								type="text"
								autoComplete="off"
								value={label}
								onChange={(event) => setLabel(event.target.value)}
								className={controlClass}
								data-testid="loyalty-phone-label"
							/>
						)}
					</Field>
					<Button
						type="submit"
						size="compact"
						aria-disabled={mutation.saving || undefined}
						className={UNAVAILABLE_CLASS}
						data-testid="loyalty-phone-add"
					>
						{t("settings.loyalty.phones.add")}
					</Button>
				</form>
			) : null}
			<div className="flex flex-wrap items-center gap-2">
				<p
					role="status"
					className={cn("text-sm", status?.tone ?? null)}
					data-testid="loyalty-phones-status"
				>
					{status?.text ?? ""}
				</p>
				{mutation.canRetry ? (
					<Button
						tone="secondary"
						size="compact"
						onClick={() => void mutation.retry()}
						data-testid="loyalty-phones-retry"
					>
						{t("app.retry")}
					</Button>
				) : null}
			</div>
		</section>
	);
}
