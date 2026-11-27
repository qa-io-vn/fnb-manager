import { useMemo } from "react";
import { encode } from "uqr";

/** The dark modules of a QR code as one SVG path (as the Mini Apps draw theirs): black on a white plate, in any theme. */
export function qrPath(payload: string): {
	readonly size: number;
	readonly path: string;
} {
	const { size, data } = encode(payload, { ecc: "M", border: 2 });
	const parts: string[] = [];
	data.forEach((row, y) => {
		row.forEach((dark, x) => {
			if (dark) parts.push(`M${x} ${y}h1v1h-1z`);
		});
	});
	return { size, path: parts.join("") };
}

export function QrCode({
	payload,
	label,
	size = 200,
	testId,
}: {
	readonly payload: string;
	readonly label: string;
	readonly size?: number;
	readonly testId?: string;
}) {
	const qr = useMemo(() => qrPath(payload), [payload]);
	return (
		<svg
			role="img"
			aria-label={label}
			viewBox={`0 0 ${qr.size} ${qr.size}`}
			width={size}
			height={size}
			shapeRendering="crispEdges"
			className="rounded-tile bg-white"
			data-testid={testId}
			data-payload={payload}
		>
			<rect width={qr.size} height={qr.size} fill="#FFFFFF" />
			<path d={qr.path} fill="#000000" />
		</svg>
	);
}
