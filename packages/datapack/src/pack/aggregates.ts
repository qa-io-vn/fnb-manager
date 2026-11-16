import { notImplemented } from "./errors.js";
import type { PackIssue } from "./invariants.js";
import type { DataPack } from "./schema.js";

export function aggregatesOnlyIssues(_pack: DataPack): readonly PackIssue[] {
	return notImplemented("aggregatesOnlyIssues");
}
