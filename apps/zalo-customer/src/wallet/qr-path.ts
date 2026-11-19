import { encode, type QrCodeGenerateOptions } from "uqr";

export interface QrPath {
	readonly size: number;
	readonly path: string;
}

export function qrPath(
	payload: string,
	{ ecc = "M", border = 2 }: Pick<QrCodeGenerateOptions, "ecc" | "border"> = {},
): QrPath {
	const { size, data } = encode(payload, { ecc, border });
	const parts: string[] = [];
	data.forEach((row, y) => {
		row.forEach((dark, x) => {
			if (dark) parts.push(`M${x} ${y}h1v1h-1z`);
		});
	});
	return { size, path: parts.join("") };
}
