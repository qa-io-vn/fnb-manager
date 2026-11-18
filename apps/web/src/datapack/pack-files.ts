export const PACK_ID_SHOWN = 8;
export const ALL_STORES_PART = "tat-ca";

export interface PackFileParts {
	readonly asOf: string;
	readonly labels: readonly string[];
	readonly allStores: boolean;
	readonly packId: string;
}

function baseName(prefix: string, parts: PackFileParts): string {
	const stores = parts.allStores
		? ALL_STORES_PART
		: parts.labels.map((label) => label.toLowerCase()).join("-");
	return `${prefix}_${parts.asOf}_${stores}_${parts.packId.slice(0, PACK_ID_SHOWN)}`;
}

export function packFileName(parts: PackFileParts): string {
	return `${baseName("goi-du-lieu", parts)}.json`;
}

export function bundleFileName(parts: PackFileParts): string {
	return `${baseName("goi-du-lieu-kem-prompt", parts)}.txt`;
}
