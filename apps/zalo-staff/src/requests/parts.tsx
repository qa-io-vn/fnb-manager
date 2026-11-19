import { useI18n } from "@fnb/zalo-mini/react";
import { Chip, type Tone } from "../shift/parts";
import type { RequestStatus } from "./contract";

const STATUS_TONES: Readonly<Record<RequestStatus, Tone>> = {
	pending: "warning",
	approved: "positive",
	refused: "negative",
};

export function StatusChip({ status }: { readonly status: RequestStatus }) {
	const { t } = useI18n();
	return (
		<Chip tone={STATUS_TONES[status]} testId="request-status">
			{t(`ask.status.${status}`)}
		</Chip>
	);
}

export function kindName(request: {
	readonly kindLabel: string | null;
	readonly kindKey: string;
}): string {
	return request.kindLabel ?? request.kindKey;
}

export function ChoiceOption({
	name,
	value,
	checked,
	disabled,
	label,
	onChoose,
}: {
	readonly name: string;
	readonly value: string;
	readonly checked: boolean;
	readonly disabled: boolean;
	readonly label: string;
	readonly onChoose: (value: string) => void;
}) {
	return (
		<label
			className={`relative flex min-h-12 items-center gap-3 rounded-xl border px-3 py-2 text-base text-ink ${checked ? "border-accent bg-surface-sunken" : "border-line"} has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-focus`}
		>
			<input
				type="radio"
				name={name}
				value={value}
				checked={checked}
				disabled={disabled}
				onChange={() => onChoose(value)}
				className="absolute inset-0 m-0 size-full cursor-pointer appearance-none rounded-xl opacity-0 disabled:cursor-default"
			/>
			<span
				aria-hidden="true"
				className={`flex size-5 shrink-0 items-center justify-center rounded-full border-2 ${checked ? "border-accent" : "border-ink-muted"}`}
			>
				{checked ? <span className="size-2.5 rounded-full bg-accent" /> : null}
			</span>
			<span className="min-w-0 break-words">{label}</span>
		</label>
	);
}
