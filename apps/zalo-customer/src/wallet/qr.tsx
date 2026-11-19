import { useMemo } from "react";
import { qrPath } from "./qr-path";

export { qrPath } from "./qr-path";

export function QrCode({
	payload,
	label,
	dimmed,
	testId = "member-qr",
}: {
	readonly payload: string;
	readonly label: string;
	readonly dimmed: boolean;
	readonly testId?: string;
}) {
	const { size, path } = useMemo(() => qrPath(payload), [payload]);
	return (
		<svg
			role="img"
			aria-label={label}
			viewBox={`0 0 ${size} ${size}`}
			width="216"
			height="216"
			shapeRendering="crispEdges"
			className={`rounded-xl bg-white ${dimmed ? "opacity-30" : ""}`}
			data-testid={testId}
			data-payload={payload}
		>
			<rect width={size} height={size} fill="#FFFFFF" />
			<path d={path} fill="#000000" />
		</svg>
	);
}
