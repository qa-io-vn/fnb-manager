import {
	type RefObject,
	useCallback,
	useEffect,
	useId,
	useRef,
	useState,
} from "react";
import type { StoreRow } from "../data/row-source";
import { useT } from "../i18n";

interface StoreSelectProps {
	stores: readonly StoreRow[];
	selected: readonly StoreRow[];
	onChange: (storeIds: string[] | null) => void;
}

function useDismiss(
	open: boolean,
	close: (returnFocus: boolean) => void,
	container: RefObject<HTMLElement | null>,
) {
	useEffect(() => {
		if (!open) return;
		const isOutside = (target: EventTarget | null) =>
			container.current !== null &&
			target instanceof Node &&
			!container.current.contains(target);
		const onPointer = (event: PointerEvent) => {
			if (isOutside(event.target)) close(false);
		};
		const onFocus = (event: FocusEvent) => {
			if (isOutside(event.target)) close(false);
		};
		const onKey = (event: KeyboardEvent) => {
			if (event.key === "Escape") close(true);
		};
		document.addEventListener("pointerdown", onPointer);
		document.addEventListener("keydown", onKey);
		document.addEventListener("focusin", onFocus);
		return () => {
			document.removeEventListener("focusin", onFocus);
			document.removeEventListener("pointerdown", onPointer);
			document.removeEventListener("keydown", onKey);
		};
	}, [open, close, container]);
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
	const panelId = useId();
	const [open, setOpen] = useState(false);
	const container = useRef<HTMLDivElement>(null);
	const trigger = useRef<HTMLButtonElement>(null);
	const close = useCallback((returnFocus: boolean) => {
		setOpen(false);
		if (returnFocus) trigger.current?.focus();
	}, []);
	useDismiss(open, close, container);
	const selectedIds = new Set(selected.map((store) => store.id));
	const allSelected = selected.length === stores.length;

	const toggleStore = (storeId: string) => {
		const next = toggledSelection(stores, selected, storeId);
		if (next !== undefined) onChange(next);
	};
	return (
		<div ref={container} className="relative">
			<button
				ref={trigger}
				type="button"
				aria-expanded={open}
				aria-controls={panelId}
				onClick={() => setOpen((value) => !value)}
				className="inline-flex min-h-11 max-w-56 items-center gap-2 rounded-lg border border-line bg-surface-raised px-3 text-sm"
				data-testid="store-select"
			>
				<span className="text-ink-muted">{t("shell.stores")}</span>
				<span className="truncate font-semibold">
					{storeSelectionLabel(stores, selected, t)}
				</span>
				<span aria-hidden="true">▾</span>
			</button>
			{open ? (
				<fieldset
					id={panelId}
					className="absolute left-0 z-30 mt-1 w-64 max-w-[calc(100vw-2rem)] rounded-lg border border-line bg-surface-raised p-2 shadow-lg"
				>
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
			) : null}
		</div>
	);
}
