import { formatVnd, formatVndDelta } from "@fnb/zalo-mini/format";
import { useI18n } from "@fnb/zalo-mini/i18n";
import { ChipGroup, PriceText, Stepper } from "@fnb/zalo-mini/ui-kit";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { RpcError, rpc } from "../lib/rpc";
import { useSession } from "../lib/session";
import { useStore } from "../lib/store";
import {
	type CounterMenuItem,
	counterMenu,
	matches,
	type OptionGroup,
} from "../menu/menu-api";
import { useBoard } from "../orders/board-context";
import { attachMember, shortName } from "../orders/member";
import { MemberDialog, type PickedMember } from "../orders/member-dialog";
import { PaymentDialog } from "../orders/payment-dialog";
import type { Order } from "../orders/types";
import { usePrinter } from "../print/printer";
import type { MapTable } from "../tables/tables-page";
import { Dialog } from "../ui/dialog";
import {
	BackIcon,
	CupIcon,
	PrinterIcon,
	SearchIcon,
	TrashIcon,
} from "../ui/icons";
import { button, card, field, Loading, PlainNote } from "../ui/kit";
import { useToast } from "../ui/toast";
import {
	addLine,
	type Draft,
	defaultOptions,
	draftReady,
	draftTotal,
	emptyDraft,
	itemCount,
	lineTotal,
	MAX_QTY,
	needsChoices,
	optionsValid,
	requestOf,
	setQty,
	setType,
	toggleOption,
} from "./draft";

type CreateAnswer = {
	readonly state: "placed" | "refused";
	readonly refusal: string | null;
	readonly replayed?: boolean;
	readonly order?: Order;
	readonly total?: number;
};

function OptionsDialog({
	item,
	groups,
	onClose,
	onAdd,
}: {
	readonly item: CounterMenuItem;
	readonly groups: readonly OptionGroup[];
	readonly onClose: () => void;
	readonly onAdd: (line: Parameters<typeof addLine>[1]) => void;
}) {
	const { t } = useI18n();
	const [sizeId, setSizeId] = useState(
		item.sizes.find((size) => size.is_default)?.id ?? item.sizes[0]?.id ?? "",
	);
	const [chosen, setChosen] = useState(() => defaultOptions(groups));
	const [qty, setQtyValue] = useState(1);
	const [note, setNote] = useState("");
	const size = item.sizes.find((candidate) => candidate.id === sizeId);
	const options = groups.flatMap((group) =>
		group.options
			.filter((option) => chosen.has(option.id))
			.map((option) => ({
				id: option.id,
				name: option.name,
				price: option.price_delta,
			})),
	);
	const valid = size !== undefined && optionsValid(groups, chosen);
	const total =
		size === undefined ? 0 : lineTotal({ qty, unitPrice: size.price, options });
	return (
		<Dialog
			title={item.name}
			onClose={onClose}
			closeLabel={t("common.close")}
			testId="options-dialog"
			footer={
				<button
					type="button"
					className={`${button.primary} w-full`}
					disabled={!valid}
					data-testid="options-add"
					onClick={() => {
						if (size === undefined) return;
						onAdd({
							itemId: item.id,
							itemName: item.name,
							sizeId: size.id,
							sizeLabel: size.label,
							unitPrice: size.price,
							options,
							qty,
							note,
						});
					}}
				>
					{t("create.add", { amount: formatVnd(total) })}
				</button>
			}
		>
			<div className="flex flex-col gap-4">
				{item.sizes.length > 1 ? (
					<fieldset className="flex flex-col gap-2">
						<legend className="pb-1 font-extrabold">{t("create.size")}</legend>
						<div className="flex flex-wrap gap-2">
							{item.sizes.map((candidate) => (
								<label
									key={candidate.id}
									className={`flex min-h-12 cursor-pointer items-center gap-2 rounded-control px-4 font-bold ${sizeId === candidate.id ? "bg-inverse text-inverse-ink" : "border-outline border-edge bg-surface-raised"}`}
								>
									<input
										type="radio"
										name="size"
										className="sr-only"
										checked={sizeId === candidate.id}
										onChange={() => setSizeId(candidate.id)}
										data-testid={`size-${candidate.label ?? "one"}`}
									/>
									{candidate.label ?? item.name} · {formatVnd(candidate.price)}
								</label>
							))}
						</div>
					</fieldset>
				) : null}
				{groups.map((group) => (
					<fieldset key={group.id} className="flex flex-col gap-2">
						<legend className="pb-1 font-extrabold">
							{group.name}
							<span className="pl-2 text-sm font-semibold text-ink-muted">
								{group.min_select > 0
									? t("create.required")
									: t("create.optional")}
							</span>
						</legend>
						<div className="flex flex-wrap gap-2">
							{group.options.map((option) => {
								const on = chosen.has(option.id);
								return (
									<button
										key={option.id}
										type="button"
										aria-pressed={on}
										onClick={() =>
											setChosen(toggleOption(group, chosen, option.id))
										}
										className={`min-h-12 rounded-control px-4 font-bold focus-visible:outline-2 focus-visible:outline-focus ${on ? "bg-inverse text-inverse-ink" : "border-outline border-edge bg-surface-raised"}`}
										data-testid={`option-${option.name}`}
									>
										{option.name}
										{option.price_delta === 0
											? null
											: ` ${formatVndDelta(option.price_delta)}`}
									</button>
								);
							})}
						</div>
					</fieldset>
				))}
				<label className="flex flex-col gap-1">
					<span className="font-bold">{t("create.lineNote")}</span>
					<input
						className={field}
						maxLength={100}
						value={note}
						onChange={(event) => setNote(event.target.value)}
					/>
				</label>
				<div className="flex items-center justify-between">
					<span className="font-bold">{t("create.quantity")}</span>
					<Stepper
						value={qty}
						min={1}
						max={MAX_QTY}
						onChange={setQtyValue}
						decreaseLabel={t("create.less")}
						increaseLabel={t("create.more")}
					/>
				</div>
			</div>
		</Dialog>
	);
}

function MenuGrid({
	items,
	draft,
	onPick,
}: {
	readonly items: readonly CounterMenuItem[];
	readonly draft: Draft;
	readonly onPick: (item: CounterMenuItem) => void;
}) {
	const { t } = useI18n();
	return (
		<ul className="grid grid-cols-2 gap-3 xl:grid-cols-3">
			{items.map((item) => {
				const count = itemCount(draft, item.id);
				const price =
					item.sizes.find((size) => size.is_default)?.price ??
					item.sizes[0]?.price ??
					0;
				return (
					<li key={item.id}>
						<button
							type="button"
							disabled={!item.available}
							onClick={() => onPick(item)}
							className={`${card} relative flex min-h-[92px] w-full items-center gap-3 p-3 text-left focus-visible:outline-2 focus-visible:outline-focus disabled:bg-surface-sunken`}
							data-testid="menu-tile"
							data-item={item.name}
						>
							<span
								aria-hidden="true"
								className="flex size-14 shrink-0 items-center justify-center rounded-tile bg-surface-sunken text-highlight"
							>
								<CupIcon />
							</span>
							<span className="min-w-0 flex-1">
								<span className="block font-extrabold">{item.name}</span>
								{item.available ? (
									<PriceText amount={price} size="list" />
								) : (
									<span className="block text-sm font-bold">
										{t("create.soldOut")}
									</span>
								)}
							</span>
							{count === 0 ? null : (
								<span
									className="absolute -top-2 -right-2 rounded-full bg-warning px-2 py-0.5 text-sm font-extrabold text-ink"
									data-testid="tile-count"
								>
									×{count}
								</span>
							)}
						</button>
					</li>
				);
			})}
		</ul>
	);
}

/** Q01: an order keyed at the counter for a customer without the app, paid at once (cash with change, or card), printed. */
export function CreateOrderPage() {
	const { t } = useI18n();
	const { client } = useSession();
	const { store } = useStore();
	const { update } = useBoard();
	const { show } = useToast();
	const printer = usePrinter();
	const [draft, setDraft] = useState<Draft>(() =>
		emptyDraft(crypto.randomUUID()),
	);
	const [category, setCategory] = useState("all");
	const [search, setSearch] = useState("");
	const [picking, setPicking] = useState<CounterMenuItem | null>(null);
	const [paying, setPaying] = useState<Order | null>(null);
	const [done, setDone] = useState<Order | null>(null);
	const [busy, setBusy] = useState(false);
	const [message, setMessage] = useState<string | null>(null);
	// the stamp card picked for this ticket: in memory only, attached once the order is created
	const [member, setMember] = useState<PickedMember | null>(null);
	const [memberOpen, setMemberOpen] = useState(false);
	const menu = useQuery({
		queryKey: ["counter-menu", store.id],
		queryFn: () => counterMenu(client, store.id),
	});
	const tables = useQuery({
		queryKey: ["table-map", store.id, "create"],
		queryFn: () =>
			rpc<{ tables: MapTable[] }>(client, "counter_table_map", {
				p_store: store.id,
			}),
	});
	const items = useMemo(
		() =>
			(menu.data?.items ?? []).filter(
				(item) =>
					item.order_types.includes(draft.type) &&
					(category === "all" || item.category === category) &&
					matches(item, search),
			),
		[menu.data, draft.type, category, search],
	);
	const categories = [
		...new Set((menu.data?.items ?? []).map((item) => item.category)),
	];
	const groupsOf = (item: CounterMenuItem) =>
		item.option_group_ids
			.map((id) => menu.data?.option_groups.find((group) => group.id === id))
			.filter((group): group is OptionGroup => group !== undefined);
	const pick = (item: CounterMenuItem) => {
		if (needsChoices(item)) {
			setPicking(item);
			return;
		}
		const size = item.sizes[0];
		if (size === undefined) return;
		setDraft((current) =>
			addLine(current, {
				itemId: item.id,
				itemName: item.name,
				sizeId: size.id,
				sizeLabel: size.label,
				unitPrice: size.price,
				options: [],
				qty: 1,
				note: "",
			}),
		);
	};
	const total = draftTotal(draft);
	/**
	 * The card picked for the ticket is attached once the order exists (counter_attach_member with its version); a
	 * refusal (the code expired meanwhile) is said, and the payment goes on with the order as it is.
	 */
	const withMember = async (order: Order): Promise<Order> => {
		if (member === null) return order;
		try {
			const answer = await attachMember(client, order, member.code);
			if (answer.state === "attached") {
				update(answer.order);
				show(
					t("member.attachedToast", {
						order: answer.order.display_no ?? "",
						count: answer.stamps ?? 0,
					}),
				);
				return answer.order;
			}
			show(
				t("member.attachLater", {
					reason: t(`member.refusal.${answer.refusal ?? "failed"}`),
				}),
			);
			return answer.order;
		} catch {
			show(t("member.attachLater", { reason: t("common.failed") }));
			return order;
		} finally {
			setMember(null);
		}
	};
	const submit = async () => {
		setBusy(true);
		setMessage(null);
		try {
			const answer = await rpc<CreateAnswer>(client, "counter_create_order", {
				p_store: store.id,
				p_request: requestOf(draft),
			});
			if (answer.state === "placed" && answer.order !== undefined) {
				update(answer.order);
				setPaying(await withMember(answer.order));
			} else if (answer.refusal === "price_changed") {
				setMessage(
					t("create.priceChanged", { amount: formatVnd(answer.total ?? 0) }),
				);
				await menu.refetch();
			} else {
				setMessage(t(`create.refusal.${answer.refusal ?? "failed"}`));
				await menu.refetch();
			}
		} catch (error) {
			setMessage(
				t(
					error instanceof RpcError && error.network
						? "create.offline"
						: "common.failed",
				),
			);
		} finally {
			setBusy(false);
		}
	};
	const reset = () => {
		setDraft(emptyDraft(crypto.randomUUID()));
		setDone(null);
		setMessage(null);
		setMember(null);
	};
	const memberName = member === null ? null : shortName(member.member.name);
	return (
		<div className="flex flex-col gap-4 lg:h-full">
			<div className="flex flex-wrap items-center gap-3">
				<Link to="/don" className={button.quiet}>
					<BackIcon />
					{t("order.backToQueue")}
				</Link>
				<h1 className="text-2xl font-extrabold">{t("create.title")}</h1>
				<span className="ml-auto rounded-full bg-surface-sunken px-3 py-1 text-sm font-bold">
					{t("create.walkIn")}
				</span>
			</div>
			<div className="grid min-h-0 flex-1 gap-4 md:grid-cols-[minmax(0,1fr)_minmax(300px,380px)]">
				<section className="flex min-w-0 flex-col gap-3">
					<label className="relative">
						<span className="sr-only">{t("soldOut.search")}</span>
						<span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-ink-muted">
							<SearchIcon />
						</span>
						<input
							className={`${field} pl-11`}
							placeholder={t("soldOut.search")}
							value={search}
							onChange={(event) => setSearch(event.target.value)}
							data-testid="create-search"
						/>
					</label>
					<div className="-mx-4">
						<ChipGroup
							label={t("create.categories")}
							chips={[
								{ key: "all", label: t("create.all") },
								...categories.map((name) => ({ key: name, label: name })),
							]}
							selected={category}
							onSelect={setCategory}
							testId="create-categories"
						/>
					</div>
					{menu.data === undefined ? (
						<Loading label={t("app.loading")} />
					) : (
						<MenuGrid items={items} draft={draft} onPick={pick} />
					)}
				</section>
				<section
					className={`${card} flex min-h-0 flex-col gap-3 p-4`}
					data-testid="ticket"
				>
					<div
						role="tablist"
						aria-label={t("create.type")}
						className="flex gap-2 rounded-control bg-surface-sunken p-1"
					>
						{(["table", "takeaway"] as const).map((type) => (
							<button
								key={type}
								type="button"
								role="tab"
								aria-selected={draft.type === type}
								onClick={() => setDraft((current) => setType(current, type))}
								className={`min-h-12 flex-1 rounded-control font-bold focus-visible:outline-2 focus-visible:outline-focus ${draft.type === type ? "bg-inverse text-inverse-ink" : ""}`}
								data-testid={`type-${type}`}
							>
								{t(`create.${type}`)}
							</button>
						))}
					</div>
					{draft.type === "table" ? (
						<label className="flex items-center gap-2">
							<span className="font-bold">{t("create.table")}</span>
							<select
								className={field}
								value={draft.tableId ?? ""}
								onChange={(event) =>
									setDraft((current) => ({
										...current,
										tableId:
											event.target.value === "" ? null : event.target.value,
									}))
								}
								data-testid="create-table"
							>
								<option value="">{t("create.chooseTable")}</option>
								{(tables.data?.tables ?? []).map((table) => (
									<option key={table.id} value={table.id}>
										{table.label}
										{table.area === null ? "" : ` · ${table.area}`}
										{table.open_orders > 0 ? ` · ${t("create.tableBusy")}` : ""}
									</option>
								))}
							</select>
						</label>
					) : null}
					<ul
						className="flex min-h-24 flex-1 flex-col divide-y divide-line overflow-y-auto"
						data-testid="ticket-lines"
					>
						{draft.lines.length === 0 ? (
							<li className="py-6 text-center text-ink-muted">
								{t("create.empty")}
							</li>
						) : (
							draft.lines.map((line) => (
								<li
									key={line.key}
									className="flex flex-col gap-1 py-2"
									data-testid="ticket-line"
								>
									<p className="flex justify-between gap-2 font-bold">
										<span>
											<span className="text-highlight">{line.qty}×</span>{" "}
											{line.itemName}
										</span>
										<PriceText amount={lineTotal(line)} tone="ink" />
									</p>
									<div className="flex items-center justify-between gap-2">
										<span className="text-sm text-ink-muted">
											{[
												line.sizeLabel,
												...line.options.map((option) => option.name),
												line.note,
											]
												.filter((part) => part !== null && part !== "")
												.join(" · ")}
										</span>
										<Stepper
											value={line.qty}
											min={1}
											max={MAX_QTY}
											onChange={(next) =>
												setDraft((current) => setQty(current, line.key, next))
											}
											onRemove={() =>
												setDraft((current) => setQty(current, line.key, 0))
											}
											decreaseLabel={t("create.less")}
											increaseLabel={t("create.more")}
											removeLabel={t("create.remove")}
										/>
									</div>
								</li>
							))
						)}
					</ul>
					<div
						className="flex min-h-14 items-center gap-2 rounded-control bg-surface-sunken px-3 py-2"
						data-testid="ticket-member"
					>
						<span className="min-w-0 flex-1 text-sm">
							{member === null ? (
								<>
									<span className="block font-bold">
										{t("member.ticketTitle")}
									</span>
									<span className="text-ink-muted">
										{t("member.ticketLead")}
									</span>
								</>
							) : (
								<span className="font-bold" data-testid="ticket-member-name">
									{memberName === null
										? t("member.foundNoName")
										: t("member.found", { name: memberName })}{" "}
									·{" "}
									{t("member.stamps", {
										stamps: member.member.stamps,
										total: member.member.stamps_per_reward,
									})}
								</span>
							)}
						</span>
						{member === null ? (
							<button
								type="button"
								className={`${button.secondary} min-h-12`}
								onClick={() => setMemberOpen(true)}
								data-testid="ticket-member-scan"
							>
								{t("member.scanShort")}
							</button>
						) : (
							<button
								type="button"
								className={`${button.quiet} min-h-12`}
								onClick={() => setMember(null)}
								data-testid="ticket-member-remove"
							>
								{t("member.remove")}
							</button>
						)}
					</div>
					<input
						className={field}
						maxLength={200}
						placeholder={t("create.note")}
						aria-label={t("create.note")}
						value={draft.note}
						onChange={(event) =>
							setDraft((current) => ({ ...current, note: event.target.value }))
						}
					/>
					<p className="flex items-baseline justify-between text-lg font-extrabold">
						<span>{t("order.total")}</span>
						<PriceText amount={total} size="lead" testId="ticket-total" />
					</p>
					{message === null ? null : (
						<PlainNote tone="negative" testId="create-message">
							{message}
						</PlainNote>
					)}
					<div className="flex gap-2">
						<button
							type="button"
							className={button.secondary}
							onClick={reset}
							aria-label={t("create.clear")}
							disabled={draft.lines.length === 0}
						>
							<TrashIcon />
							<span className="hidden xl:inline">{t("create.clear")}</span>
						</button>
						<button
							type="button"
							className={`${button.primary} flex-1`}
							disabled={!draftReady(draft) || busy}
							onClick={() => void submit()}
							data-testid="create-pay"
						>
							{t("order.pay", { amount: formatVnd(total) })}
						</button>
					</div>
				</section>
			</div>
			{picking === null ? null : (
				<OptionsDialog
					item={picking}
					groups={groupsOf(picking)}
					onClose={() => setPicking(null)}
					onAdd={(line) => {
						setDraft((current) => addLine(current, line));
						setPicking(null);
					}}
				/>
			)}
			{memberOpen ? (
				<MemberDialog
					store={store.id}
					order={null}
					onClose={() => setMemberOpen(false)}
					onPicked={(picked) => {
						setMember(picked);
						setMemberOpen(false);
					}}
				/>
			) : null}
			{paying === null ? null : (
				<PaymentDialog
					order={paying}
					onClose={() => {
						show(t("create.leftUnpaid"));
						setPaying(null);
						reset();
					}}
					onPaid={(paid) => {
						setPaying(null);
						update(paid);
						setDone(paid);
						void printer.print(paid);
					}}
				/>
			)}
			{done === null ? null : (
				<Dialog
					title={t("create.doneTitle", { order: done.display_no ?? "" })}
					onClose={reset}
					closeLabel={t("common.close")}
					size="sm"
					testId="create-done"
					footer={
						<>
							<button
								type="button"
								className={button.secondary}
								onClick={() => void printer.print(done)}
								data-testid="reprint"
							>
								<PrinterIcon />
								{t("create.reprint")}
							</button>
							<button
								type="button"
								className={button.primary}
								onClick={reset}
								data-testid="create-next"
							>
								{t("create.next")}
							</button>
						</>
					}
				>
					<p className="text-body">
						{t("create.doneBody", { amount: formatVnd(done.total) })}
					</p>
				</Dialog>
			)}
		</div>
	);
}
