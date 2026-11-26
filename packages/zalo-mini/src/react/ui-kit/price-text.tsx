import { formatCount, formatVnd, formatVndDelta } from "../../format/index";
import { useI18n } from "../i18n";

export type PriceTextSize = "inline" | "list" | "lead" | "note";
export type PriceTextTone = "highlight" | "ink" | "muted";

export interface PriceTextProps {
	/** Whole đồng. A price is 0 or more; a change of price ("delta") may be negative. */
	readonly amount: number;
	/** "price" writes 35.000đ; "delta" writes the sign: +5.000đ or −5.000đ. */
	readonly kind?: "price" | "delta";
	/** inline: the size around it; list: 15 bold; lead: 19 bold (an item's price, a total); note: 13 semibold. */
	readonly size?: PriceTextSize;
	/** highlight: the brand's price colour (the accent without a brand theme); ink; muted: secondary text. */
	readonly tone?: PriceTextTone;
	readonly className?: string;
	readonly testId?: string;
}

const SIZES: Readonly<Record<PriceTextSize, string>> = {
	inline: "",
	list: "text-[15px] font-bold",
	lead: "text-[19px] font-bold",
	note: "text-[13px] font-semibold",
};

const TONES: Readonly<Record<PriceTextTone, string>> = {
	highlight: "",
	ink: "text-ink",
	muted: "text-ink-muted",
};

/**
 * A price, the only way a Mini App writes one. The element carries `data-price` (its value is the amount in đồng), so a
 * check can find every price on a screen and see that no other text looks like one. Sighted users read "35.000đ"; a
 * screen reader gets "35.000 đồng" and never hears the "đ" as a letter.
 */
export function PriceText({
	amount,
	kind = "price",
	size = "inline",
	tone = "highlight",
	className,
	testId,
}: PriceTextProps) {
	const { t } = useI18n();
	const written = kind === "delta" ? formatVndDelta(amount) : formatVnd(amount);
	const spoken =
		kind === "delta" && amount !== 0
			? t(amount > 0 ? "price.spokenPlus" : "price.spokenMinus", {
					amount: formatCount(Math.abs(amount)),
				})
			: t("price.spoken", { amount: formatCount(Math.abs(amount)) });
	const classes = [SIZES[size], TONES[tone], className]
		.filter((part) => part !== undefined && part !== "")
		.join(" ");
	return (
		<span
			data-price={amount}
			data-testid={testId}
			className={classes === "" ? undefined : classes}
			style={
				tone === "highlight"
					? { color: "var(--brand-highlight, var(--accent))" }
					: undefined
			}
		>
			<span aria-hidden="true">{written}</span>
			<span className="sr-only">{spoken}</span>
		</span>
	);
}
