import { useMemo } from "react";
import { encodeQr, QR_QUIET_ZONE, qrPathOf } from "./qr-code";

export function QrImage({
	text,
	label,
	testId = "qr-image",
}: {
	readonly text: string;
	readonly label: string;
	readonly testId?: string;
}) {
	const drawn = useMemo(() => {
		const code = encodeQr(text);
		return {
			path: qrPathOf(code),
			span: code.size + QR_QUIET_ZONE * 2,
			version: code.version,
		};
	}, [text]);
	return (
		<svg
			role="img"
			aria-label={label}
			viewBox={`0 0 ${drawn.span} ${drawn.span}`}
			shapeRendering="crispEdges"
			className="block aspect-square w-full max-w-56"
			data-testid={testId}
			data-version={drawn.version}
		>
			<rect width={drawn.span} height={drawn.span} className="fill-white" />
			<path d={drawn.path} className="fill-black" />
		</svg>
	);
}
