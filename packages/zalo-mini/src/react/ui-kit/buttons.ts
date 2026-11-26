// Class strings of the kit's buttons (design spec 3.3), for the screens that adopt the new look. They read only the
// tokens and the theme's roles, so a brand's shape and colours reach them. A disabled button is drawn in the sunken
// fill and the muted ink, never with an opacity, and its reason is told in a line beside it.
const BASE =
	"inline-flex min-h-12 items-center justify-center gap-2 rounded-control px-5 text-body font-bold transition-transform active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus disabled:border-transparent disabled:bg-surface-sunken disabled:text-ink-muted disabled:shadow-none disabled:active:scale-100";

export const kitButton = {
	/** The main action: the accent with its ink. */
	primary: `${BASE} bg-accent text-accent-ink shadow-card`,
	/** The second action: an outline in the brand's outline colour on a card. */
	secondary: `${BASE} border-outline border-edge bg-surface-raised text-ink`,
	/** A quiet bar or the "send" of a flow: the inverse pair. */
	inverse: `${BASE} bg-inverse text-inverse-ink`,
	/** A shortcut that must stand out (the badge fill and its ink). */
	badge: `${BASE} bg-badge text-badge-ink`,
	/** A destructive action: the secondary shape with the negative colour. */
	danger: `${BASE} border-outline border-edge-danger bg-surface-raised text-negative`,
	/** A text action in the brand's highlight. */
	quiet:
		"inline-flex min-h-11 min-w-11 items-center justify-center rounded-control px-3 text-body font-bold text-highlight focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus disabled:text-ink-muted",
} as const;

export type KitButtonVariant = keyof typeof kitButton;
