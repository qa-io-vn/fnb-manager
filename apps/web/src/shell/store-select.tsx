import { cn } from "../components/ui/cn";
import { fieldVariants } from "../components/ui/field";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "../components/ui/popover";
import type { StoreRow } from "../data/row-source";
import { useT } from "../i18n";

interface StoreSelectProps {
	stores: readonly StoreRow[];
	selected: readonly StoreRow[];
	onChange: (storeIds: string[] | null) => void;
}

export function storeSelectionLabel(
	stores: readonly StoreRow[],
	selected: readonly StoreRow[],
	t: ReturnType<typeof useT>,
): string {
	if (selected.length === stores.length) return t("shell.stores.all");
	if (selected.length === 1 && selected[0]) return selected[0].name;
	return t("shell.stores.selected", { count: selected.length });
}

export function toggledSelection(
	stores: readonly StoreRow[],
	selected: readonly StoreRow[],
	storeId: string,
): string[] | null | undefined {
	const next = new Set(selected.map((store) => store.id));
	if (next.has(storeId)) next.delete(storeId);
	else next.add(storeId);
	if (next.size === 0) return undefined;
	if (next.size === stores.length) return null;
	return stores.filter((store) => next.has(store.id)).map((store) => store.id);
}

function StoreOption({
	store,
	checked,
	onToggle,
}: {
	store: StoreRow;
	checked: boolean;
	onToggle: () => void;
}) {
	return (
		<label className="flex min-h-11 items-center gap-2 rounded px-2 hover:bg-surface-sunken">
			<input
				type="checkbox"
				checked={checked}
				onChange={onToggle}
				className="size-4 accent-accent"
				data-store-id={store.id}
			/>
			<span className="truncate">{store.name}</span>
		</label>
	);
}

export function StoreSelect({ stores, selected, onChange }: StoreSelectProps) {
	const t = useT();
	const selectedIds = new Set(selected.map((store) => store.id));
	const allSelected = selected.length === stores.length;

	const toggleStore = (storeId: string) => {
		const next = toggledSelection(stores, selected, storeId);
		if (next !== undefined) onChange(next);
	};
	return (
		<div className="relative">
			<Popover>
				<PopoverTrigger
					className={cn(fieldVariants({ kind: "trigger" }), "max-w-56")}
					data-testid="store-select"
				>
					<span className="text-ink-muted">{t("shell.stores")}</span>
					<span className="truncate font-semibold">
						{storeSelectionLabel(stores, selected, t)}
					</span>
					<span aria-hidden="true">▾</span>
				</PopoverTrigger>
				<PopoverContent label={t("shell.stores")}>
					<fieldset>
						<legend className="sr-only">{t("shell.stores")}</legend>
						<label className="flex min-h-11 items-center gap-2 rounded px-2 hover:bg-surface-sunken">
							<input
								type="checkbox"
								checked={allSelected}
								onChange={() => onChange(null)}
								className="size-4 accent-accent"
								data-store-id="all"
							/>
							<span className="font-semibold">{t("shell.stores.all")}</span>
						</label>
						{stores.map((store) => (
							<StoreOption
								key={store.id}
								store={store}
								checked={selectedIds.has(store.id)}
								onToggle={() => toggleStore(store.id)}
							/>
						))}
					</fieldset>
				</PopoverContent>
			</Popover>
		</div>
	);
}
