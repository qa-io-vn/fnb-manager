import type { ReactNode } from "react";

/** Line icons in the style of the tab bar (24 px box, 1.8 stroke); decorative, so hidden from assistive technology. */
function Icon({
	children,
	size = 24,
}: {
	readonly children: ReactNode;
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
			strokeWidth={1.8}
			strokeLinecap="round"
			strokeLinejoin="round"
			className="shrink-0"
		>
			{children}
		</svg>
	);
}

type P = { readonly size?: number };

export const ReceiptIcon = (p: P) => (
	<Icon {...p}>
		<path d="M6 3h12v18l-3-2-3 2-3-2-3 2z" />
		<path d="M9 8h6M9 12h6M9 16h3" />
	</Icon>
);
export const TableIcon = (p: P) => (
	<Icon {...p}>
		<path d="M4 8h16M6 8v11M18 8v11M4 5h16" />
	</Icon>
);
export const CupIcon = (p: P) => (
	<Icon {...p}>
		<path d="M5 9h11v5a5 5 0 0 1-5 5h-1a5 5 0 0 1-5-5z" />
		<path d="M16 10h1.5a2.5 2.5 0 0 1 0 5H16M9 3v3M12 3v3" />
	</Icon>
);
export const ClockIcon = (p: P) => (
	<Icon {...p}>
		<circle cx="12" cy="12" r="8.5" />
		<path d="M12 7v5l3 2" />
	</Icon>
);
export const ChartIcon = (p: P) => (
	<Icon {...p}>
		<path d="M4 20h16M7 16v-5M12 16V7M17 16v-8" />
	</Icon>
);
export const BellIcon = (p: P) => (
	<Icon {...p}>
		<path d="M6 16V11a6 6 0 1 1 12 0v5l1.5 2h-15z" />
		<path d="M10 20a2 2 0 0 0 4 0" />
	</Icon>
);
export const BellOffIcon = (p: P) => (
	<Icon {...p}>
		<path d="M6 16V11a6 6 0 0 1 9.5-4.9M18 11v5l1.5 2h-15" />
		<path d="M4 4l16 16" />
	</Icon>
);
export const PrinterIcon = (p: P) => (
	<Icon {...p}>
		<path d="M7 9V4h10v5M7 17H5a1 1 0 0 1-1-1v-6a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1h-2" />
		<path d="M7 14h10v6H7z" />
	</Icon>
);
export const PlusIcon = (p: P) => (
	<Icon {...p}>
		<path d="M12 5v14M5 12h14" />
	</Icon>
);
export const CheckIcon = (p: P) => (
	<Icon {...p}>
		<path d="M5 12.5l4.5 4.5L19 7.5" />
	</Icon>
);
export const CloseIcon = (p: P) => (
	<Icon {...p}>
		<path d="M6 6l12 12M18 6L6 18" />
	</Icon>
);
export const BackIcon = (p: P) => (
	<Icon {...p}>
		<path d="M15 5l-7 7 7 7" />
	</Icon>
);
export const SearchIcon = (p: P) => (
	<Icon {...p}>
		<circle cx="11" cy="11" r="6.5" />
		<path d="M16 16l4 4" />
	</Icon>
);
export const AlertIcon = (p: P) => (
	<Icon {...p}>
		<path d="M12 4l9 16H3z" />
		<path d="M12 10v4M12 17v.5" />
	</Icon>
);
export const LockIcon = (p: P) => (
	<Icon {...p}>
		<rect x="5" y="11" width="14" height="9" rx="2" />
		<path d="M8 11V8a4 4 0 0 1 8 0v3" />
	</Icon>
);
export const UserIcon = (p: P) => (
	<Icon {...p}>
		<circle cx="12" cy="8" r="3.5" />
		<path d="M5 20a7 7 0 0 1 14 0" />
	</Icon>
);
export const QrIcon = (p: P) => (
	<Icon {...p}>
		<path d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h2v2h-2zM18 18h2v2h-2zM14 18h2" />
	</Icon>
);
export const TrashIcon = (p: P) => (
	<Icon {...p}>
		<path d="M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13" />
	</Icon>
);
export const WifiOffIcon = (p: P) => (
	<Icon {...p}>
		<path d="M4 9a12 12 0 0 1 16 0M7 12.5a7.5 7.5 0 0 1 10 0M10 16a3 3 0 0 1 4 0M12 19.5v.5" />
		<path d="M4 4l16 16" />
	</Icon>
);
export const NoteIcon = (p: P) => (
	<Icon {...p}>
		<path d="M5 19l1-4L15.5 5.5a2 2 0 0 1 3 3L9 18z" />
	</Icon>
);
export const LogoutIcon = (p: P) => (
	<Icon {...p}>
		<path d="M14 4h4a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-4M10 8l-4 4 4 4M6 12h9" />
	</Icon>
);
