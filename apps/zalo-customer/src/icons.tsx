function Icon({ path }: { readonly path: string }) {
	return (
		<svg
			aria-hidden="true"
			width="24"
			height="24"
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

export function HomeIcon() {
	return (
		<Icon path="M4 10.5L12 4l8 6.5V20a1 1 0 0 1-1 1h-4.5v-6h-5v6H5a1 1 0 0 1-1-1z" />
	);
}

export function CardIcon() {
	return (
		<Icon path="M3.5 7A1.5 1.5 0 0 1 5 5.5h14A1.5 1.5 0 0 1 20.5 7v10a1.5 1.5 0 0 1-1.5 1.5H5A1.5 1.5 0 0 1 3.5 17zM3.5 10h17M7 14.5h4" />
	);
}

export function AccountIcon() {
	return (
		<Icon path="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4.5 20.5c1.2-3.5 4-5 7.5-5s6.3 1.5 7.5 5" />
	);
}

export function QrIcon() {
	return (
		<Icon path="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h2.5M19.5 14H20v2.5M14 17.5V20h3M20 19.5V20" />
	);
}

export function GiftIcon() {
	return (
		<Icon path="M4 10h16v10H4zM3 7h18v3H3zM12 7v13M12 7c-1.5-3-5.5-3.5-5.5-1S10 7 12 7zm0 0c1.5-3 5.5-3.5 5.5-1S14 7 12 7z" />
	);
}

export function TicketIcon() {
	return (
		<Icon path="M3.5 8.5V6.5a1 1 0 0 1 1-1h15a1 1 0 0 1 1 1v2a3.5 3.5 0 0 0 0 7v2a1 1 0 0 1-1 1h-15a1 1 0 0 1-1-1v-2a3.5 3.5 0 0 0 0-7zM14.5 6v12" />
	);
}

export function ReceiptIcon() {
	return (
		<Icon path="M6 3.5h12v17l-2-1.3-2 1.3-2-1.3-2 1.3-2-1.3-2 1.3zM9 8h6M9 11.5h6M9 15h3.5" />
	);
}

export function StoreIcon() {
	return (
		<Icon path="M4 9.5l1.5-5h13L20 9.5M4 9.5a2.7 2.7 0 0 0 5.3 0 2.7 2.7 0 0 0 5.4 0 2.7 2.7 0 0 0 5.3 0M5 11.5V20h14v-8.5M10 20v-5h4v5" />
	);
}

export function PinIcon() {
	return (
		<svg
			aria-hidden="true"
			width="16"
			height="16"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth="2"
			strokeLinecap="round"
			strokeLinejoin="round"
			className="mt-0.5 shrink-0"
		>
			<path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0C18.5 15.4 12 21 12 21zM12 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z" />
		</svg>
	);
}

export function ChevronIcon() {
	return (
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
			className="shrink-0 text-ink-muted"
		>
			<path d="M7.5 4.5L13 10l-5.5 5.5" />
		</svg>
	);
}

/** A coffee cup, the stamp of a loyalty card: filled when earned, outlined when still to come. */
export function CupIcon({ filled }: { readonly filled: boolean }) {
	return (
		<svg
			aria-hidden="true"
			viewBox="0 0 24 24"
			className="size-full"
			fill={filled ? "currentColor" : "none"}
			stroke="currentColor"
			strokeWidth="1.6"
			strokeLinecap="round"
			strokeLinejoin="round"
		>
			<path d="M5 9h11v5.5A4.5 4.5 0 0 1 11.5 19h-2A4.5 4.5 0 0 1 5 14.5z" />
			<path d="M16 10.5h1.5a2.5 2.5 0 0 1 0 5H16" fill="none" />
			<path
				d="M8.5 3.5c-.6.8-.6 1.7 0 2.5M12 3.5c-.6.8-.6 1.7 0 2.5"
				fill="none"
			/>
		</svg>
	);
}

export function AlertIcon() {
	return (
		<Icon path="M12 8v5M12 16.5v.01M10.3 4.2L2.8 17.5A2 2 0 0 0 4.5 20.5h15a2 2 0 0 0 1.7-3L13.7 4.2a2 2 0 0 0-3.4 0z" />
	);
}
