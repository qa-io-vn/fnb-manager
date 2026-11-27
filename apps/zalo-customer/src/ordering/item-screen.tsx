import {
	LINE_NOTE_MAX,
	MAX_LINE_QUANTITY,
	type Menu,
	type MenuItem,
} from "@fnb/zalo-mini/ordering";
import {
	kitButton,
	OptionPills,
	PriceText,
	StatusPill,
	Stepper,
	StickyActionBar,
	useI18n,
} from "@fnb/zalo-mini/react";
import { useId, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { Failed, Loading } from "../ui";
import {
	characterCount,
	cleanNote,
	defaultChoice,
	groupsOf,
	lineUnit,
	noteProblem,
	selectionProblem,
} from "./cart";
import { closedKind } from "./order-view";
import { useMenuPoll, useOrdering } from "./ordering-data";
import { FlowBack, MenuIcon, Problem } from "./parts";

// C03 Chi tiết món (design spec 6.2): the size with its price, each option group with its limits, a note of at most
// 100 characters and the quantity, then "Thêm vào giỏ · {price}". The price on the button is the menu's, shown to
// help; the server prices the order again at placement. Opened from a basket line, it edits that line.

export interface ItemLocationState {
	readonly lineKey?: string;
}

function ItemView({
	menu,
	item,
}: {
	readonly menu: Menu;
	readonly item: MenuItem;
}) {
	const { t } = useI18n();
	const navigate = useNavigate();
	const location = useLocation();
	const { add, replace, cart } = useOrdering();
	const lineKey = (location.state as ItemLocationState | null)?.lineKey;
	const editing = cart.lines.find((line) => line.key === lineKey) ?? null;
	const groups = useMemo(() => groupsOf(item, menu.optionGroups), [item, menu]);
	const start = useMemo(() => defaultChoice(item, groups), [item, groups]);
	const [sizeId, setSizeId] = useState(editing?.sizeId ?? start.sizeId);
	const [chosen, setChosen] = useState<
		Readonly<Record<string, readonly string[]>>
	>(() => {
		if (editing === null) return start.options;
		const ids = editing.options.map((option) => option.id);
		return Object.fromEntries(
			groups.map((group) => [
				group.id,
				group.options
					.filter((option) => ids.includes(option.id))
					.map((option) => option.id),
			]),
		);
	});
	const [note, setNote] = useState(editing?.note ?? "");
	const [quantity, setQuantity] = useState(editing?.quantity ?? 1);
	const [tried, setTried] = useState(false);
	const problemRef = useRef<HTMLDivElement>(null);
	const noteId = useId();
	const noteCountId = useId();
	const size = item.sizes.find((entry) => entry.id === sizeId) ?? item.sizes[0];
	const options = groups.flatMap((group) =>
		(chosen[group.id] ?? []).flatMap((id) => {
			const option = group.options.find((entry) => entry.id === id);
			return option === undefined
				? []
				: [
						{
							id,
							name: option.name,
							groupName: group.name,
							price: option.priceDelta,
						},
					];
		}),
	);
	const unit = lineUnit({ unitPrice: size?.price ?? 0, options });
	const missing = groups.find(
		(group) => selectionProblem(group, chosen[group.id] ?? []) !== null,
	);
	const noteIssue = noteProblem(note);
	const open = closedKind(menu.ordering) === null;

	const submit = () => {
		setTried(true);
		if (size === undefined || missing !== undefined || noteIssue !== null) {
			requestAnimationFrame(() => problemRef.current?.focus());
			return;
		}
		const line = {
			itemId: item.id,
			itemName: item.name,
			sizeId: size.id,
			sizeLabel: size.label,
			unitPrice: size.price,
			options,
			quantity,
			note: cleanNote(note),
			countsForStamps: item.countsForStamps,
		};
		if (editing !== null) {
			replace(editing.key, line);
			navigate("/gio-hang", { replace: true });
			return;
		}
		add(line);
		navigate(-1);
	};

	return (
		<>
			<div className="flex flex-col gap-4 px-4 py-4" data-testid="item">
				<FlowBack />
				<div
					aria-hidden="true"
					className="flex aspect-[16/10] items-center justify-center rounded-card bg-surface-sunken text-ink-muted"
					data-testid="item-photo"
				>
					<span className="scale-[2.5]">
						<MenuIcon />
					</span>
				</div>
				<div className="flex items-start justify-between gap-3">
					<div className="flex min-w-0 flex-col gap-1">
						<h1
							className="text-[22px] font-bold leading-tight text-ink"
							data-testid="item-name"
						>
							{item.name}
						</h1>
						{item.labels.includes("best_seller") ? (
							<span className="self-start">
								<StatusPill tone="badge">
									{t("menu.badge.best_seller")}
								</StatusPill>
							</span>
						) : null}
					</div>
					<PriceText amount={unit} size="lead" testId="item-price" />
				</div>
				{item.description === null ? null : (
					<p className="text-[13px] text-ink-muted">{item.description}</p>
				)}
				{item.sizes.length > 1 ? (
					<OptionPills
						legend={t("item.size")}
						name={`size-${item.id}`}
						value={sizeId}
						onChange={setSizeId}
						testId="item-group"
						options={item.sizes.map((entry) => ({
							value: entry.id,
							label: entry.label ?? item.name,
							note: (
								<PriceText amount={entry.price} size="note" tone="inherit" />
							),
						}))}
					/>
				) : null}
				{groups.map((group) =>
					group.maxSelect > 1 ? (
						<OptionPills
							key={group.id}
							multiple
							legend={`${group.name} · ${t("item.groupLimit", { max: group.maxSelect })}`}
							name={`group-${group.id}`}
							value={chosen[group.id] ?? []}
							onChange={(next) =>
								setChosen((previous) => ({ ...previous, [group.id]: next }))
							}
							testId="item-group"
							options={group.options.map((option) => ({
								value: option.id,
								label: option.name,
								...(option.priceDelta > 0
									? {
											note: (
												<PriceText
													amount={option.priceDelta}
													kind="delta"
													size="note"
													tone="inherit"
												/>
											),
										}
									: {}),
							}))}
						/>
					) : (
						<OptionPills
							key={group.id}
							legend={group.name}
							name={`group-${group.id}`}
							value={chosen[group.id]?.[0] ?? null}
							onChange={(next) =>
								setChosen((previous) => ({ ...previous, [group.id]: [next] }))
							}
							testId="item-group"
							options={group.options.map((option) => ({
								value: option.id,
								label: option.name,
								...(option.priceDelta > 0
									? {
											note: (
												<PriceText
													amount={option.priceDelta}
													kind="delta"
													size="note"
													tone="inherit"
												/>
											),
										}
									: {}),
							}))}
						/>
					),
				)}
				<div className="flex flex-col gap-2">
					<label htmlFor={noteId} className="text-[15px] font-bold text-ink">
						{t("item.note")}
					</label>
					<textarea
						id={noteId}
						rows={2}
						value={note}
						maxLength={LINE_NOTE_MAX * 2}
						onChange={(event) =>
							setNote(event.target.value.replace(/[\r\n]+/g, " "))
						}
						placeholder={t("item.notePlaceholder")}
						aria-describedby={noteCountId}
						aria-invalid={noteIssue !== null}
						className="min-h-12 w-full resize-none rounded-field border-field border-line-strong bg-surface-raised px-4 py-3 text-base text-ink"
						data-testid="item-note"
					/>
					<p
						id={noteCountId}
						className={`text-sm ${noteIssue === null ? "text-ink-muted" : "text-negative"}`}
						data-testid="item-note-count"
					>
						{noteIssue === "too_long"
							? t("item.noteTooLong", { max: LINE_NOTE_MAX })
							: noteIssue === "control"
								? t("item.noteControl")
								: t("item.noteCount", {
										count: characterCount(note.trim()),
										max: LINE_NOTE_MAX,
									})}
					</p>
				</div>
				{tried && missing !== undefined ? (
					<div ref={problemRef} tabIndex={-1}>
						<Problem testId="item-missing-required">
							{selectionProblem(missing, chosen[missing.id] ?? []) ===
							"too_many"
								? t("item.tooMany", {
										group: missing.name,
										max: missing.maxSelect,
									})
								: t("item.missingRequired", {
										group: missing.name.toLowerCase(),
									})}
						</Problem>
					</div>
				) : null}
			</div>
			<StickyActionBar testId="item-bar">
				{open ? (
					<>
						<Stepper
							value={quantity}
							min={1}
							max={MAX_LINE_QUANTITY}
							onChange={setQuantity}
							decreaseLabel={t("item.less")}
							increaseLabel={t("item.more")}
							testId="item-qty"
						/>
						<button
							type="button"
							className={`${kitButton.primary} flex-1`}
							onClick={submit}
							data-testid="item-add"
						>
							{t(editing === null ? "item.add" : "item.update")}
							<span aria-hidden="true">·</span>
							<PriceText amount={unit * quantity} tone="inherit" />
						</button>
					</>
				) : (
					<p className="py-2 text-body text-ink" data-testid="item-closed">
						{t("item.closed")}
					</p>
				)}
			</StickyActionBar>
		</>
	);
}

export function ItemScreen() {
	const { t } = useI18n();
	const { id } = useParams();
	const { menu, reloadMenu, unavailable } = useOrdering();
	const navigate = useNavigate();
	useMenuPoll();
	if (menu.status === "loading") return <Loading />;
	if (menu.status === "failed")
		return <Failed failure={menu.failure} onRetry={reloadMenu} />;
	const item = menu.data.categories
		.flatMap((category) => category.items)
		.find((entry) => entry.id === id);
	const soldOut =
		id !== undefined &&
		(unavailable.has(id) || menu.data.unavailableItems.includes(id));
	if (item === undefined || soldOut)
		return (
			<section className="flex flex-col gap-4 px-4 py-4">
				<FlowBack />
				<Problem testId={soldOut ? "item-sold-out" : "item-missing"}>
					{soldOut && item !== undefined
						? t("item.soldOut", { name: item.name })
						: t("item.missing")}
				</Problem>
				<button
					type="button"
					className={`${kitButton.primary} w-full`}
					onClick={() => navigate("/thuc-don")}
				>
					{t("item.backToMenu")}
				</button>
			</section>
		);
	return <ItemView key={item.id} menu={menu.data} item={item} />;
}
