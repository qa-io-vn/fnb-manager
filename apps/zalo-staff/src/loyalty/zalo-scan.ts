import { scanQRCode } from "zmp-sdk";

export async function scanContent(): Promise<string> {
	const result = await scanQRCode({});
	return typeof result?.content === "string" ? result.content : "";
}
