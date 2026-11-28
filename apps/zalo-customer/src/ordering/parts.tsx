import { kitButton, useI18n } from "@fnb/zalo-mini/react";
import type { ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { shownTime } from "../data/dates";

// Small pieces the ordering screens share (design spec 3.3, 6.0): icons, the kicker, the card, the alert and the back
// row of a flow screen. Prices are never written here: PriceText writes every one.

function Icon({
	path,
	size = 24,
}: {
	readonly path: string;
	readonly size?: number;
}) {
	return (
		<svg
			aria-hidden="true"
			width={size}
			height={size}
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth="1.8"
			strokeLinecap="round"
			strokeLinejoin="round"
		>
			<path d={path} />
		</svg>
	);
}

export const MenuIcon = () => (
	<Icon path="M5 9h12v5a5 5 0 0 1-5 5h-2a5 5 0 0 1-5-5zM17 10h1.5a2.5 2.5 0 0 1 0 5H17M8 3.5c0 1 1 1.5 1 2.5M12 3.5c0 1 1 1.5 1 2.5" />
);
export const StarIcon = () => (
	<Icon path="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z" />
);
export const TableIcon = () => (
	<Icon path="M3.5 8h17M5.5 8v11M18.5 8v11M8 8V5h8v3M3.5 8l2-3h13l2 3" />
);
export const BellIcon = () => (
	<Icon path="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15zM10 20.5a2 2 0 0 0 4 0" />
);
export const SearchIcon = () => (
	<Icon path="M10.5 17a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13zM15.5 15.5L20 20" />
);
export const ScanIcon = () => (
	<Icon path="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3M4 12h16" />
);
export const BagIcon = () => (
	<Icon path="M5 8h14l-1 12H6zM9 8V6a3 3 0 0 1 6 0v2" />
);
export const CalendarIcon = () => (
	<Icon path="M4.5 6.5h15v13h-15zM4.5 10.5h15M8.5 4v4M15.5 4v4" />
);
export const ClockIcon = () => (
	<Icon path="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7.5V12l3 2" />
);
export const WifiOffIcon = () => (
	<Icon path="M3 3l18 18M8.5 16.5a5 5 0 0 1 7 0M5 12.5a10 10 0 0 1 4-2.4M19 12.5a10 10 0 0 0-3.2-2.1M2 9a15 15 0 0 1 4.5-2.8M22 9a15 15 0 0 0-10-3.9M12 20h.01" />
);
export const ShieldIcon = () => (
	<Icon path="M12 3.5l7 2.5v5.5c0 4.5-3 7.8-7 9-4-1.2-7-4.5-7-9V6z" />
);
export const ListIcon = () => (
	<Icon path="M6 4h12a1 1 0 0 1 1 1v15l-3-2-3 2-3-2-3 2V5a1 1 0 0 1 1-1zM9 9h6M9 13h6" />
);
export const TrashIcon = () => (
	<Icon path="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3" />
);
export const CheckIcon = () => <Icon path="M5 12.5l4.5 4.5L19 7.5" />;
export const PlusIcon = () => <Icon path="M12 5v14M5 12h14" />;
export const ChevronRight = () => (
	<Icon path="M9.5 5.5L16 12l-6.5 6.5" size={20} />
);
export const CupIcon = () => (
	<Icon path="M5.5 8h11l-1.2 11a1.5 1.5 0 0 1-1.5 1.3H8.2A1.5 1.5 0 0 1 6.7 19zM16.5 10h1.5a2.5 2.5 0 0 1 0 5h-2M8.5 4.5c0 1 .8 1.5.8 2.3M12 3.5c0 1 .8 1.5.8 2.5" />
);
export const ReceiptIcon = () => (
	<Icon path="M6 3.5h12v17l-2.5-1.5-2 1.5-1.5-1.5-1.5 1.5-2-1.5L6 20.5zM9 8h6M9 11.5h6M9 15h3" />
);
export const GiftIcon = () => (
	<Icon path="M4 9h16v4H4zM5.5 13h13v7.5h-13zM12 9v11.5M12 9c-1.5-3.5-5-4-5-1.7C7 9 12 9 12 9zM12 9c1.5-3.5 5-4 5-1.7C17 9 12 9 12 9z" />
);
export const BuildingIcon = () => (
	<Icon path="M4.5 20V5a1 1 0 0 1 1-1h7a1 1 0 0 1 1 1v15M13.5 9h5a1 1 0 0 1 1 1v10M3 20h18M8 8h2M8 12h2M8 16h2M16.5 13h.01M16.5 16.5h.01" />
);

export const kicker =
	"text-xs font-bold tracking-[0.12em] text-highlight uppercase";

/** A card of the ordering screens: raised, radius 18, a hairline. */
export function Panel({
	children,
	testId,
	labelledBy,
	className = "",
}: {
	readonly children: ReactNode;
	readonly testId?: string;
	readonly labelledBy?: string;
	readonly className?: string;
}) {
	return (
		<section
			data-testid={testId}
			aria-labelledby={labelledBy}
			className={`flex flex-col gap-3 rounded-card border-card border-line/60 bg-surface-raised p-4 shadow-card ${className}`}
		>
			{children}
		</section>
	);
}

/** An inline problem: the negative soft card with an alert role (focus moves to it where a screen asks). */
export function Problem({
	children,
	testId,
	data,
}: {
	readonly children: ReactNode;
	readonly testId: string;
	readonly data?: Readonly<Record<string, string>>;
}) {
	return (
		<div
			role="alert"
			tabIndex={-1}
			data-testid={testId}
			{...Object.fromEntries(
				Object.entries(data ?? {}).map(([key, value]) => [
					`data-${key}`,
					value,
				]),
			)}
			className="rounded-card bg-negative-soft px-4 py-3 text-body text-ink"
		>
			{children}
		</div>
	);
}

/** A notice that holds something back (a pause, a missing table): the warning soft card. */
export function Notice({
	children,
	testId,
	data,
}: {
	readonly children: ReactNode;
	readonly testId: string;
	readonly data?: Readonly<Record<string, string>>;
}) {
	return (
		<p
			role="status"
			data-testid={testId}
			{...Object.fromEntries(
				Object.entries(data ?? {}).map(([key, value]) => [
					`data-${key}`,
					value,
				]),
			)}
			className="rounded-card bg-warning-soft px-4 py-3 text-body text-ink"
		>
			{children}
		</p>
	);
}

/** The back row of a flow screen (the native header has the chevron in Zalo; the stand-in browser needs one). */
export function FlowBack({ to }: { readonly to?: string }) {
	const { t } = useI18n();
	const navigate = useNavigate();
	return (
		<button
			type="button"
			onClick={() => (to === undefined ? navigate(-1) : navigate(to))}
			className={`${kitButton.quiet} -ml-3 self-start text-ink`}
		>
			<svg
				aria-hidden="true"
				width="20"
				height="20"
				viewBox="0 0 20 20"
				fill="none"
				stroke="currentColor"
				strokeWidth="1.8"
				strokeLinecap="round"
				strokeLinejoin="round"
			>
				<path d="M12.5 4.5L7 10l5.5 5.5" />
			</svg>
			{t("customer.back")}
		</button>
	);
}

/** A time of day in the shop's time zone, "14:05". */
export function clock(iso: string): string {
	return shownTime(Date.parse(iso)).slice(0, 5);
}
