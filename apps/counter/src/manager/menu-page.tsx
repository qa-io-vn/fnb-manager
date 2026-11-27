import { formatVnd } from "@fnb/zalo-mini/format";
import { useI18n } from "@fnb/zalo-mini/i18n";
import type { SupabaseClient } from "@supabase/supabase-js";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { parseAmount } from "../lib/cash";
import { query, RpcError } from "../lib/rpc";
import { useMember, useSession } from "../lib/session";
import { useStore } from "../lib/store";
import { dayAndClock } from "../lib/time";
import { rosterNames } from "../orders/api";
import { PlusIcon } from "../ui/icons";
import { button, card, field, Loading, PageTitle, PlainNote } from "../ui/kit";
import { useToast } from "../ui/toast";

interface Category {
	readonly id: string;
	readonly name: string;
	readonly sort_order: number;
	readonly visible: boolean;
}
interface Item {
	readonly id: string;
	readonly category_id: string;
	readonly name: string;
	readonly visible: boolean;
	readonly sort_order: number;
}
interface Size {
	readonly id: string;
	readonly item_id: string;
	readonly label: string | null;
	readonly price: number | string;
	readonly is_default: boolean;
	readonly active: boolean;
	readonly sort_order: number;
}
interface PriceChange {
	readonly id: number;
	readonly subject_name: string;
	readonly old_price: number | string | null;
	readonly new_price: number | string;
	readonly changed_by: string | null;
	readonly changed_at: string;
}

async function loadMenu(
	client: SupabaseClient,
	tenantId: string,
	storeId: string,
) {
	const brands = await query<{ id: string; store_ids: string[] | null }[]>(
		client.from("brands").select("id, store_ids").eq("tenant_id", tenantId),
	);
	const brand = brands.find(
		(candidate) =>
			candidate.store_ids === null || candidate.store_ids.includes(storeId),
	);
	if (brand === undefined) return null;
	const [categories, items, sizes, changes, names] = await Promise.all([
		query<Category[]>(
			client
				.from("menu_categories")
				.select("id, name, sort_order, visible")
				.eq("brand_id", brand.id)
				.order("sort_order"),
		),
		query<Item[]>(
			client
				.from("menu_items")
				.select("id, category_id, name, visible, sort_order")
				.eq("brand_id", brand.id)
				.eq("restricted", false)
				.order("sort_order"),
		),
		query<Size[]>(
			client
				.from("menu_item_sizes")
				.select("id, item_id, label, price, is_default, active, sort_order")
				.eq("brand_id", brand.id)
				.order("sort_order"),
		),
		query<PriceChange[]>(
			client
				.from("menu_price_changes")
				.select(
					"id, subject_name, old_price, new_price, changed_by, changed_at",
				)
				.eq("brand_id", brand.id)
				.order("changed_at", { ascending: false })
				.limit(30),
		),
		rosterNames(client),
	]);
	return { brandId: brand.id, categories, items, sizes, changes, names };
}

/** RLS refuses a writer whose scope does not hold every store of the brand: say so in words. */
function writeError(error: unknown, t: (key: string) => string): string {
	if (
		error instanceof RpcError &&
		(error.code === "42501" || /row-level security/i.test(error.message))
	)
		return t("menuEdit.scope");
	if (error instanceof RpcError && error.code === "23514")
		return t("menuEdit.invalid");
	return t("common.failed");
}

function PriceField({
	size,
	onSave,
}: {
	readonly size: Size;
	readonly onSave: (size: Size, price: number) => Promise<void>;
}) {
	const { t } = useI18n();
	const [text, setText] = useState(String(Math.round(Number(size.price))));
	const price = parseAmount(text);
	const changed = price !== null && price !== Math.round(Number(size.price));
	return (
		<span className="flex items-center gap-2">
			<span className="min-w-12 text-sm text-ink-muted">
				{size.label ?? t("menuEdit.oneSize")}
			</span>
			<input
				className={`${field} w-32`}
				inputMode="numeric"
				aria-label={t("menuEdit.priceOf", {
					size: size.label ?? t("menuEdit.oneSize"),
				})}
				value={text}
				onChange={(event) => setText(event.target.value)}
				data-testid="price-input"
			/>
			<button
				type="button"
				className={button.quiet}
				disabled={!changed || price === null || price < 1}
				onClick={() => price !== null && void onSave(size, price)}
				data-testid="price-save"
			>
				{t("menuEdit.save")}
			</button>
		</span>
	);
}

/** Quản lý → Thực đơn và giá: categories, items, sizes and prices, written under RLS; every price change is in the log. */
export function MenuEditorPage() {
	const { t } = useI18n();
	const { client } = useSession();
	const { member, userId } = useMember();
	const { store } = useStore();
	const { show } = useToast();
	const [newItem, setNewItem] = useState({ name: "", category: "", price: "" });
	const [newCategory, setNewCategory] = useState("");
	const [message, setMessage] = useState<string | null>(null);
	const menu = useQuery({
		queryKey: ["menu-editor", store.id],
		queryFn: () => loadMenu(client, member.tenant_id, store.id),
	});
	const run = async (work: () => PromiseLike<unknown>, done: string) => {
		setMessage(null);
		try {
			const rows = await query<unknown>(
				work() as PromiseLike<{
					data: unknown;
					error: { code?: string; message: string } | null;
				}>,
			);
			// RLS lets an update that is not allowed touch no row, without an error: a write that changed nothing is refused
			if (Array.isArray(rows) && rows.length === 0)
				throw new RpcError("42501", "no row written");
			show(done);
			await menu.refetch();
		} catch (error) {
			setMessage(writeError(error, t));
		}
	};
	if (menu.data === undefined) return <Loading label={t("app.loading")} />;
	if (menu.data === null) return <PlainNote>{t("menuEdit.noBrand")}</PlainNote>;
	const data = menu.data;
	const price = parseAmount(newItem.price);
	return (
		<div className="mx-auto flex max-w-5xl flex-col gap-4">
			<PageTitle>{t("menuEdit.title")}</PageTitle>
			{message === null ? null : (
				<PlainNote tone="negative" testId="menu-edit-message">
					{message}
				</PlainNote>
			)}
			<div className="grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
				<section className="flex flex-col gap-4">
					{data.categories.map((category) => (
						<section key={category.id} className={`${card} p-4`}>
							<h2 className="pb-2 text-lg font-extrabold">{category.name}</h2>
							<ul className="divide-y divide-line">
								{data.items
									.filter((item) => item.category_id === category.id)
									.map((item) => (
										<li
											key={item.id}
											className="flex flex-col gap-2 py-3"
											data-testid="edit-item"
											data-item={item.name}
										>
											<div className="flex flex-wrap items-center gap-2">
												<span className="flex-1 font-extrabold">
													{item.name}
												</span>
												<label className="flex min-h-11 items-center gap-2 text-sm font-bold">
													<input
														type="checkbox"
														className="size-6"
														checked={item.visible}
														onChange={(event) =>
															void run(
																() =>
																	client
																		.from("menu_items")
																		.update({ visible: event.target.checked })
																		.eq("id", item.id)
																		.select("id"),
																t("menuEdit.saved"),
															)
														}
														data-testid="item-visible"
													/>
													{t("menuEdit.onSale")}
												</label>
											</div>
											<div className="flex flex-wrap gap-3">
												{data.sizes
													.filter(
														(size) => size.item_id === item.id && size.active,
													)
													.map((size) => (
														<PriceField
															key={`${size.id}-${size.price}`}
															size={size}
															onSave={(target, value) =>
																run(
																	() =>
																		client
																			.from("menu_item_sizes")
																			.update({ price: value })
																			.eq("id", target.id)
																			.select("id"),
																	t("menuEdit.priceSaved", {
																		amount: formatVnd(value),
																	}),
																)
															}
														/>
													))}
											</div>
										</li>
									))}
							</ul>
						</section>
					))}
				</section>
				<aside className="flex flex-col gap-4">
					<section className={`${card} flex flex-col gap-2 p-4`}>
						<h2 className="font-extrabold">{t("menuEdit.addItem")}</h2>
						<input
							className={field}
							placeholder={t("menuEdit.itemName")}
							aria-label={t("menuEdit.itemName")}
							maxLength={60}
							value={newItem.name}
							onChange={(event) =>
								setNewItem({ ...newItem, name: event.target.value })
							}
							data-testid="new-item-name"
						/>
						<select
							className={field}
							aria-label={t("menuEdit.category")}
							value={newItem.category}
							onChange={(event) =>
								setNewItem({ ...newItem, category: event.target.value })
							}
							data-testid="new-item-category"
						>
							<option value="">{t("menuEdit.category")}</option>
							{data.categories.map((category) => (
								<option key={category.id} value={category.id}>
									{category.name}
								</option>
							))}
						</select>
						<input
							className={field}
							inputMode="numeric"
							placeholder={t("menuEdit.price")}
							aria-label={t("menuEdit.price")}
							value={newItem.price}
							onChange={(event) =>
								setNewItem({ ...newItem, price: event.target.value })
							}
							data-testid="new-item-price"
						/>
						<button
							type="button"
							className={button.primary}
							disabled={
								newItem.name.trim() === "" ||
								newItem.category === "" ||
								price === null ||
								price < 1
							}
							data-testid="new-item-save"
							onClick={() => {
								const id = crypto.randomUUID();
								void run(async () => {
									const created = await client.from("menu_items").insert({
										id,
										tenant_id: member.tenant_id,
										brand_id: data.brandId,
										category_id: newItem.category,
										name: newItem.name.trim(),
									});
									if (created.error !== null) return created;
									const sized = await client.from("menu_item_sizes").insert({
										tenant_id: member.tenant_id,
										brand_id: data.brandId,
										item_id: id,
										price,
										is_default: true,
									});
									if (sized.error === null)
										setNewItem({
											name: "",
											category: newItem.category,
											price: "",
										});
									return sized;
								}, t("menuEdit.added"));
							}}
						>
							<PlusIcon />
							{t("menuEdit.addItem")}
						</button>
					</section>
					<section className={`${card} flex flex-col gap-2 p-4`}>
						<h2 className="font-extrabold">{t("menuEdit.addCategory")}</h2>
						<input
							className={field}
							maxLength={40}
							placeholder={t("menuEdit.categoryName")}
							aria-label={t("menuEdit.categoryName")}
							value={newCategory}
							onChange={(event) => setNewCategory(event.target.value)}
						/>
						<button
							type="button"
							className={button.secondary}
							disabled={newCategory.trim() === ""}
							onClick={() =>
								void run(async () => {
									const answer = await client.from("menu_categories").insert({
										tenant_id: member.tenant_id,
										brand_id: data.brandId,
										name: newCategory.trim(),
										sort_order: data.categories.length + 1,
									});
									if (answer.error === null) setNewCategory("");
									return answer;
								}, t("menuEdit.added"))
							}
						>
							{t("menuEdit.addCategory")}
						</button>
					</section>
					<section
						className={`${card} flex flex-col gap-2 p-4`}
						data-testid="price-log"
					>
						<h2 className="font-extrabold">{t("menuEdit.log")}</h2>
						{data.changes.length === 0 ? (
							<PlainNote>{t("menuEdit.noChanges")}</PlainNote>
						) : (
							<ul className="flex flex-col gap-1 text-sm">
								{data.changes.map((change) => (
									<li key={change.id} data-testid="price-log-line">
										{dayAndClock(change.changed_at)} · {change.subject_name} ·{" "}
										{change.old_price === null
											? ""
											: `${formatVnd(Math.round(Number(change.old_price)))} → `}
										{formatVnd(Math.round(Number(change.new_price)))} ·{" "}
										{change.changed_by === null
											? t("audit.staff")
											: change.changed_by === userId
												? member.display_name
												: (data.names.get(change.changed_by) ??
													t("menuEdit.someone"))}
									</li>
								))}
							</ul>
						)}
					</section>
				</aside>
			</div>
		</div>
	);
}
