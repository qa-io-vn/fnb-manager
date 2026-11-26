import { useMemo } from "react";
import { encode } from "uqr";

export interface QrPath {
	readonly size: number;
	readonly path: string;
}

/** the dark modules of a QR as one SVG path, as the customer app draws its member QR (apps/zalo-customer wallet/qr-path) */
export function qrPath(payload: string): QrPath {
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
	testId,
}: {
	readonly payload: string;
	readonly label: string;
	readonly testId: string;
}) {
	const { size, path } = useMemo(() => qrPath(payload), [payload]);
	return (
		<svg
			role="img"
			aria-label={label}
			viewBox={`0 0 ${size} ${size}`}
			width="232"
			height="232"
			shapeRendering="crispEdges"
			className="mx-auto rounded-tile bg-white"
			data-testid={testId}
			data-payload={payload}
		>
			<rect width={size} height={size} fill="#FFFFFF" />
			<path d={path} fill="#000000" />
		</svg>
	);
}
