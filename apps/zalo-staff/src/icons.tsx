import type { ReactNode } from "react";

function TabIcon({ children }: { readonly children: ReactNode }) {
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
			{children}
		</svg>
	);
}

export function HomeIcon() {
	return (
		<TabIcon>
			<path d="M3 11.5 12 4l9 7.5" />
			<path d="M5.5 10v9.5h13V10" />
		</TabIcon>
	);
}

export function ShiftIcon() {
	return (
		<TabIcon>
			<circle cx="12" cy="12" r="8.5" />
			<path d="M12 7.5V12l3 2" />
		</TabIcon>
	);
}

export function NoticeIcon() {
	return (
		<TabIcon>
			<path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 2h-15z" />
			<path d="M10 20.5h4" />
		</TabIcon>
	);
}

export function ProfileIcon() {
	return (
		<TabIcon>
			<circle cx="12" cy="8.5" r="3.5" />
			<path d="M5 20c1-3.5 3.8-5.5 7-5.5s6 2 7 5.5" />
		</TabIcon>
	);
}
