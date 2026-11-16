import type { ReportCallSpec } from "@fnb/reports";
import { notImplemented } from "./errors.js";
import type { ResolvedPackRequest } from "./request.js";

export type PackCallSpec = ReportCallSpec;

export function packCalls(
	_request: ResolvedPackRequest,
): readonly PackCallSpec[] {
	return notImplemented("packCalls");
}
