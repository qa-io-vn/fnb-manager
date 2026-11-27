import { useI18n } from "@fnb/zalo-mini/i18n";
import type { StoreChoice } from "../lib/store";
import { button, card } from "../ui/kit";

/** A member of several stores chooses the store this device serves (the full store switch, S14, comes later). */
export function StorePicker({
	stores,
	onChoose,
}: {
	readonly stores: readonly StoreChoice[];
	readonly onChoose: (id: string) => void;
}) {
	const { t } = useI18n();
	return (
		<main className="flex min-h-dvh items-center justify-center bg-surface p-6 text-ink">
			<div
				className={`${card} flex w-full max-w-md flex-col gap-4 p-6`}
				data-testid="store-picker"
			>
				<h1 className="text-2xl font-extrabold">{t("store.choose")}</h1>
				{stores.map((store) => (
					<button
						key={store.id}
						type="button"
						className={button.secondary}
						onClick={() => onChoose(store.id)}
					>
						{store.name}
					</button>
				))}
			</div>
		</main>
	);
}
