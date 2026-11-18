import type { RunnerDatabase } from "./database.js";
import type { IposApiMode } from "./ipos-mode.js";

export type IposDataSource = "api" | "snapshot";

export const SNAPSHOT_TENANT_SLUG = "mock-local";

export class IposSourceError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "IposSourceError";
	}
}

export function iposDataSource(mode: IposApiMode): IposDataSource {
	return mode === "real" ? "api" : "snapshot";
}

export function sourceConflict(
	mode: IposApiMode,
	recorded: IposDataSource | null,
): string | null {
	if (recorded === null || recorded === iposDataSource(mode)) {
		return null;
	}
	return mode === "snapshot"
		? `this tenant holds data from the real iPOS API; IPOS_REAL_API=off writes only into a tenant loaded from the iPOS snapshot (by default ${SNAPSHOT_TENANT_SLUG})`
		: "this tenant was loaded from the iPOS snapshot; IPOS_REAL_API=on never writes real iPOS data into it: pass another tenant, or delete this one";
}

export async function guardIposTenant(
	database: Pick<RunnerDatabase, "iposSource" | "claimIposSource">,
	tenantId: string,
	mode: IposApiMode,
	options: { claim: boolean },
): Promise<void> {
	if (!options.claim) {
		const conflict = sourceConflict(mode, await database.iposSource(tenantId));
		if (conflict !== null) {
			throw new IposSourceError(conflict);
		}
		return;
	}
	const claimed = await database.claimIposSource(
		tenantId,
		iposDataSource(mode),
	);
	if (claimed === null) {
		if (mode === "snapshot") {
			throw new IposSourceError(
				"IPOS_REAL_API=off needs the table app.tenant_ipos_sources to keep snapshot data apart from real data; apply the migrations first",
			);
		}
		return;
	}
	const conflict = sourceConflict(mode, claimed);
	if (conflict !== null) {
		throw new IposSourceError(conflict);
	}
}
