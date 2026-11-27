import type { NativeStampCard } from "@fnb/zalo-mini/ordering";
import { useCallback, useEffect, useState } from "react";
import { useCustomerData } from "../data/customer-data";
import { useOrdering } from "./ordering-data";
import { StarIcon } from "./parts";

// The stamp card of the Zalo account (customer_stamp_card), read by the home strip, C07 and C20, and its slots.

type CardLoad =
	| { readonly status: "loading" }
	| { readonly status: "ready"; readonly card: NativeStampCard }
	| { readonly status: "failed" };

export function useStampCard(): {
	readonly load: CardLoad;
	readonly reload: () => void;
} {
	const { client } = useOrdering();
	const { recover } = useCustomerData();
	const [load, setLoad] = useState<CardLoad>({ status: "loading" });
	const reload = useCallback(() => {
		if (client === null) return;
		client.stampCard().then(
			(card) => setLoad({ status: "ready", card }),
			(error: unknown) => {
				recover(error);
				setLoad((previous) =>
					previous.status === "ready" ? previous : { status: "failed" },
				);
			},
		);
	}, [client, recover]);
	useEffect(() => {
		reload();
	}, [reload]);
	return { load, reload };
}

/** The card's slots: the stamps filled, the empty ones dashed, the last one the gift; hidden from assistive tech. */
export function StampSlots({
	stamps,
	perReward,
	small = false,
}: {
	readonly stamps: number;
	readonly perReward: number;
	readonly small?: boolean;
}) {
	const size = small ? "size-6" : "size-11";
	const slots = Array.from({ length: perReward + 1 }, (_, index) => ({
		position: index + 1,
		gift: index === perReward,
		on: index < stamps,
	}));
	return (
		<div
			aria-hidden="true"
			className={`grid ${small ? "grid-cols-10 gap-1" : "grid-cols-5 gap-2"} justify-items-center`}
		>
			{slots.map((slot) => (
				<span
					key={slot.position}
					data-testid="stamp-slot"
					data-on={slot.on}
					data-gift={slot.gift}
					className={`flex ${size} items-center justify-center rounded-full ${slot.gift ? "bg-badge text-badge-ink" : slot.on ? "bg-accent text-accent-ink" : "border-2 border-dashed border-line-strong"}`}
				>
					{slot.gift || slot.on ? <StarIcon /> : null}
				</span>
			))}
		</div>
	);
}
