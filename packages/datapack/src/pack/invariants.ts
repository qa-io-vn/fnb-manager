import { notImplemented } from "./errors.js";
import type { DataPack } from "./schema.js";

export interface PackIssue {
	readonly code: string;
	readonly path: string | null;
	readonly detail: string | null;
}

export interface PackValidation {
	readonly valid: boolean;
	readonly pack: DataPack | null;
	readonly issues: readonly PackIssue[];
}

export interface PackParseResult extends PackValidation {
	readonly packId: string | null;
}

export interface PackComparison {
	readonly valid: boolean;
	readonly identical_apart_from_generated_at: boolean;
	readonly pack_id_equal: boolean;
	readonly tables_differing: readonly string[];
}

export async function parsePack(_text: string): Promise<PackParseResult> {
	return notImplemented("parsePack");
}

export async function validatePack(_value: unknown): Promise<PackValidation> {
	return notImplemented("validatePack");
}

export async function comparePackTexts(
	_left: string,
	_right: string,
): Promise<PackComparison> {
	return notImplemented("comparePackTexts");
}
