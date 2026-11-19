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
