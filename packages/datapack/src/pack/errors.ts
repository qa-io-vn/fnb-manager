export const NOT_IMPLEMENTED = "not_implemented";

export const PACK_ERROR_CODES = [
	NOT_IMPLEMENTED,
	"pack_stores_invalid",
	"pack_as_of_not_complete",
	"pack_text_contact_details",
	"pack_text_too_long",
	"pack_data_changed",
	"pack_not_aggregate",
	"pack_over_budget",
	"pack_invalid",
	"pack_id_mismatch",
	"sample_pack_not_publishable",
	"front_matter_missing",
	"front_matter_invalid",
] as const;

export type PackErrorCode = (typeof PACK_ERROR_CODES)[number];

export class DataPackError extends Error {
	readonly code: PackErrorCode;

	constructor(code: PackErrorCode, message: string) {
		super(`${code}: ${message}`);
		this.name = "DataPackError";
		this.code = code;
	}
}

export function notImplemented(name: string): never {
	throw new DataPackError(NOT_IMPLEMENTED, `${name} is not built yet`);
}
