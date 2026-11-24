import { type BrandTheme, brandThemeCss } from "../app-config";
import { useI18n } from "./i18n";

export const BRAND_THEME_STYLE_ID = "fnb-brand-theme";

let current: BrandTheme | null = null;

/**
 * Applies a brand's palette to the whole Mini App. Zalo does not upload index.html, so the style sheet is added at
 * start-up by the app itself. Without a theme the design tokens apply unchanged.
 */
export function applyBrandTheme(
	theme: BrandTheme | null | undefined,
	target: Document = document,
): void {
	current = theme ?? null;
	target.getElementById(BRAND_THEME_STYLE_ID)?.remove();
	if (current === null) return;
	const style = target.createElement("style");
	style.id = BRAND_THEME_STYLE_ID;
	style.textContent = brandThemeCss(current);
	target.head.append(style);
}

export function currentBrandTheme(): BrandTheme | null {
	return current;
}

// tiles alternate a light and a coloured tile; four letters sit in a 2x2 grid with the light tiles on a diagonal
function tileTone(index: number, count: number): "light" | "colour" {
	if (count === 4) return index === 0 || index === 3 ? "light" : "colour";
	return index % 2 === 0 ? "light" : "colour";
}

export function BrandWordmark({
	letters,
	size = "large",
}: {
	readonly letters: string;
	readonly size?: "large" | "small";
}) {
	const chars = [...letters];
	const grid = chars.length === 4;
	const tile =
		size === "large"
			? "size-12 rounded-xl text-2xl"
			: "size-7 rounded-md text-sm";
	return (
		<span
			aria-hidden="true"
			className={`grid shrink-0 gap-1.5 ${grid ? "grid-cols-2" : "grid-flow-col"}`}
			data-testid="brand-wordmark"
		>
			{chars.map((char, index) => (
				<span
					// the letters of a wordmark repeat rarely and never move, so the position is a stable key
					// biome-ignore lint/suspicious/noArrayIndexKey: a fixed, ordered wordmark
					key={index}
					className={`flex items-center justify-center font-black leading-none ${tile}`}
					style={{
						background:
							tileTone(index, chars.length) === "light"
								? "var(--brand-hero-ink)"
								: "var(--brand-tile)",
						color: "var(--brand-hero)",
					}}
				>
					{char}
				</span>
			))}
		</span>
	);
}

/** The brand banner of a home screen: the tile wordmark and the tagline, or nothing when the brand has neither. */
export function BrandHero({
	className = "",
}: {
	readonly className?: string;
} = {}) {
	const { language } = useI18n();
	const theme = current;
	if (theme === null) return null;
	const tagline = language === "en" ? theme.taglineEn : theme.taglineVi;
	if (theme.wordmark === null && tagline === null) return null;
	return (
		<section
			className={`flex items-center gap-4 rounded-2xl px-5 py-5 ${className}`}
			style={{
				background: "var(--brand-hero)",
				color: "var(--brand-hero-ink)",
			}}
			data-testid="brand-hero"
		>
			{theme.wordmark === null ? null : (
				<BrandWordmark letters={theme.wordmark} />
			)}
			{tagline === null ? null : (
				<div className="flex min-w-0 flex-col gap-2">
					<p className="text-xl font-extrabold leading-snug">{tagline}</p>
					{theme.kicker === null ? null : (
						<p
							className="flex items-center gap-2 text-xs font-semibold tracking-[0.2em] uppercase"
							style={{ color: "var(--brand-tile)" }}
						>
							<span
								aria-hidden="true"
								className="h-0.5 w-5 rounded-full"
								style={{ background: "var(--brand-tile)" }}
							/>
							{theme.kicker}
						</p>
					)}
				</div>
			)}
		</section>
	);
}
