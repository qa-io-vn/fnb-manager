import { useI18n } from "@fnb/zalo-mini/i18n";
import { type FormEvent, useEffect, useId, useRef, useState } from "react";
import { useSession } from "../lib/session";
import { useStore } from "../lib/store";
import { button, card, field, PlainNote } from "../ui/kit";
import { useToast } from "../ui/toast";
import {
	checkTakeaway,
	formOf,
	LIMIT_MAX,
	LIMIT_MIN,
	loadTakeawaySettings,
	PREP_MAX,
	PREP_MIN,
	SLOT_MINUTES,
	saveTakeawaySettings,
	type TakeawayField,
	type TakeawayForm,
	takeawayWriteError,
} from "./takeaway-settings";

type Load =
	| { readonly status: "loading" }
	| { readonly status: "none" }
	| { readonly status: "failed" }
	| { readonly status: "ready" };

/**
 * "Mang đi hẹn giờ" on Quản lý → Thực đơn và giá (C17): the preparation time, the slot length and the orders a slot
 * takes, for the store this device works for. The design draws no manager screen for them (D9 only gives the values),
 * so this is the smallest form: three labelled fields, each refusal in words under its field, the server's refusal
 * (a store not in the person's scope, a bound) above the button. Only managers reach the page; the server is the
 * control.
 */
export function TakeawaySettingsCard() {
	const { t } = useI18n();
	const { client } = useSession();
	const { store } = useStore();
	const { show } = useToast();
	const id = useId();
	const [load, setLoad] = useState<Load>({ status: "loading" });
	const [form, setForm] = useState<TakeawayForm>({
		prep: "",
		slot: "15",
		limit: "",
	});
	const [errors, setErrors] = useState<
		Readonly<Partial<Record<TakeawayField, string>>>
	>({});
	const [message, setMessage] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);
	const fields = useRef<
		Partial<Record<TakeawayField, HTMLInputElement | HTMLSelectElement | null>>
	>({});

	useEffect(() => {
		let live = true;
		setLoad({ status: "loading" });
		loadTakeawaySettings(client, store.id).then(
			(settings) => {
				if (!live) return;
				if (settings === null) {
					setLoad({ status: "none" });
					return;
				}
				setForm(formOf(settings));
				setLoad({ status: "ready" });
			},
			() => {
				if (live) setLoad({ status: "failed" });
			},
		);
		return () => {
			live = false;
		};
	}, [client, store.id]);

	const submit = async (event: FormEvent) => {
		event.preventDefault();
		setMessage(null);
		const check = checkTakeaway(form);
		if (!check.ok) {
			setErrors(check.errors);
			const first = (["prep", "slot", "limit"] as const).find(
				(key) => check.errors[key] !== undefined,
			);
			if (first !== undefined) fields.current[first]?.focus();
			return;
		}
		setErrors({});
		setBusy(true);
		try {
			const saved = await saveTakeawaySettings(client, store.id, check.value);
			setForm(formOf(saved));
			show(t("takeaway.saved"));
		} catch (error) {
			setMessage(t(takeawayWriteError(error)));
		} finally {
			setBusy(false);
		}
	};

	const describedBy = (key: TakeawayField) =>
		errors[key] === undefined
			? `${id}-${key}-hint`
			: `${id}-${key}-hint ${id}-${key}-error`;
	const error = (key: TakeawayField) =>
		errors[key] === undefined ? null : (
			<p
				id={`${id}-${key}-error`}
				className="text-sm font-bold text-negative"
				data-testid={`takeaway-${key}-error`}
			>
				{t(errors[key] ?? "common.failed")}
			</p>
		);

	return (
		<section
			className={`${card} flex flex-col gap-3 p-4`}
			aria-labelledby={`${id}-title`}
			data-testid="takeaway-settings"
		>
			<h2 id={`${id}-title`} className="font-extrabold">
				{t("takeaway.title")}
			</h2>
			<p className="text-sm text-ink-muted">{t("takeaway.lead")}</p>
			{load.status === "loading" ? (
				<p className="text-sm text-ink-muted">{t("app.loading")}</p>
			) : load.status === "none" ? (
				<PlainNote testId="takeaway-none">{t("takeaway.none")}</PlainNote>
			) : load.status === "failed" ? (
				<PlainNote tone="negative">{t("common.failed")}</PlainNote>
			) : (
				<form
					className="flex flex-col gap-3"
					noValidate
					onSubmit={(event) => void submit(event)}
				>
					<div className="flex flex-col gap-1">
						<label htmlFor={`${id}-prep`} className="font-bold">
							{t("takeaway.prep")}
						</label>
						<input
							id={`${id}-prep`}
							ref={(node) => {
								fields.current.prep = node;
							}}
							className={field}
							inputMode="numeric"
							value={form.prep}
							aria-invalid={errors.prep !== undefined}
							aria-describedby={describedBy("prep")}
							onChange={(event) =>
								setForm({ ...form, prep: event.target.value })
							}
							data-testid="takeaway-prep"
						/>
						<p id={`${id}-prep-hint`} className="text-sm text-ink-muted">
							{t("takeaway.prepHint", { min: PREP_MIN, max: PREP_MAX })}
						</p>
						{error("prep")}
					</div>
					<div className="flex flex-col gap-1">
						<label htmlFor={`${id}-slot`} className="font-bold">
							{t("takeaway.slot")}
						</label>
						<select
							id={`${id}-slot`}
							ref={(node) => {
								fields.current.slot = node;
							}}
							className={field}
							value={form.slot}
							aria-invalid={errors.slot !== undefined}
							aria-describedby={describedBy("slot")}
							onChange={(event) =>
								setForm({ ...form, slot: event.target.value })
							}
							data-testid="takeaway-slot"
						>
							{SLOT_MINUTES.map((minutes) => (
								<option key={minutes} value={String(minutes)}>
									{t("takeaway.slotOption", { minutes })}
								</option>
							))}
						</select>
						<p id={`${id}-slot-hint`} className="text-sm text-ink-muted">
							{t("takeaway.slotHint")}
						</p>
						{error("slot")}
					</div>
					<div className="flex flex-col gap-1">
						<label htmlFor={`${id}-limit`} className="font-bold">
							{t("takeaway.limit")}
						</label>
						<input
							id={`${id}-limit`}
							ref={(node) => {
								fields.current.limit = node;
							}}
							className={field}
							inputMode="numeric"
							value={form.limit}
							aria-invalid={errors.limit !== undefined}
							aria-describedby={describedBy("limit")}
							onChange={(event) =>
								setForm({ ...form, limit: event.target.value })
							}
							data-testid="takeaway-limit"
						/>
						<p id={`${id}-limit-hint`} className="text-sm text-ink-muted">
							{t("takeaway.limitHint", { min: LIMIT_MIN, max: LIMIT_MAX })}
						</p>
						{error("limit")}
					</div>
					{message === null ? null : (
						<div role="alert">
							<PlainNote tone="negative" testId="takeaway-message">
								{message}
							</PlainNote>
						</div>
					)}
					<button
						type="submit"
						className={button.secondary}
						disabled={busy}
						data-testid="takeaway-save"
					>
						{t("takeaway.save")}
					</button>
				</form>
			)}
		</section>
	);
}
