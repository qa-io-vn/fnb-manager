import type { SupabaseClient } from "@supabase/supabase-js";
import { rpc } from "../lib/rpc";

/** counter_menu: every item on sale at the store with its sizes, its sold-out state and its option groups. */
export interface CounterMenuItem {
	readonly id: string;
	readonly brand_id: string;
	readonly category: string;
	readonly name: string;
	readonly order_types: readonly string[];
	readonly available: boolean;
	readonly sold_out_until: string | null;
	readonly sizes: readonly {
		readonly id: string;
		readonly label: string | null;
		readonly price: number;
		readonly is_default: boolean;
	}[];
	readonly option_group_ids: readonly string[];
	/** whether a unit of it earns a stamp when an order of a member completes (migration counter_menu_stamp_flag) */
	readonly counts_for_stamps: boolean;
}

/** A brand's stamp card as counter_menu answers it: on or off, and how many stamps make a reward. */
export interface StampCardSetting {
	readonly brand_id: string;
	readonly enabled: boolean;
	readonly stamps_per_reward: number;
}

export interface OptionGroup {
	readonly id: string;
	readonly name: string;
	readonly min_select: number;
	readonly max_select: number;
	readonly options: readonly {
		readonly id: string;
		readonly name: string;
		readonly price_delta: number;
		readonly is_default: boolean;
	}[];
}

export interface CounterMenu {
	readonly store_id: string;
	readonly business_date: string;
	readonly day_ends_at: string;
	readonly ordering: {
		readonly accepting: boolean;
		readonly reason: string | null;
		readonly paused_until?: string | null;
	};
	readonly items: readonly CounterMenuItem[];
	readonly option_groups: readonly OptionGroup[];
	/** the stamp card of each brand covering the store */
	readonly stamp_cards: readonly StampCardSetting[];
}

export const counterMenu = (client: SupabaseClient, store: string) =>
	rpc<CounterMenu>(client, "counter_menu", { p_store: store });

export const setSoldOut = (
	client: SupabaseClient,
	store: string,
	item: string,
	soldOut: boolean,
) =>
	rpc<{ item_id: string; sold_out: boolean; sold_out_until: string | null }>(
		client,
		"counter_set_sold_out",
		{
			p_store: store,
			p_item: item,
			p_sold_out: soldOut,
			p_until: null,
		},
	);

export const setPause = (
	client: SupabaseClient,
	store: string,
	minutes: number,
	reason: string | null,
) =>
	rpc<{ paused_until: string | null; paused_reason: string | null }>(
		client,
		"counter_set_pause",
		{
			p_store: store,
			p_minutes: minutes,
			p_reason: reason,
		},
	);

/** The items grouped by category, in the order the menu answered them. */
export function byCategory(
	items: readonly CounterMenuItem[],
): [string, CounterMenuItem[]][] {
	const groups = new Map<string, CounterMenuItem[]>();
	for (const item of items)
		groups.set(item.category, [...(groups.get(item.category) ?? []), item]);
	return [...groups.entries()];
}

/** A search over names without accents and case ("ca phe" finds "Cà phê"). */
export function folded(text: string): string {
	return text
		.normalize("NFD")
		.replace(/\p{M}/gu, "")
		.replace(/đ/g, "d")
		.replace(/Đ/g, "D")
		.toLowerCase()
		.trim();
}

export function matches(item: CounterMenuItem, search: string): boolean {
	const query = folded(search);
	return (
		query === "" ||
		folded(item.name).includes(query) ||
		folded(item.category).includes(query)
	);
}
