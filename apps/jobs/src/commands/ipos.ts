import { isAbsolute, join, relative, sep } from "node:path";
import {
	type AccountEntry,
	guardIposTenant,
	type IposApiMode,
	type IposSnapshots,
	iposApiMode,
	iposModeLine,
	SNAPSHOT_TENANT_SLUG,
	snapshotCoverage,
	usesIpos,
} from "@fnb/runner";
import {
	createFileSnapshots,
	DEFAULT_SNAPSHOT_DIRECTORY,
	IPOS_SNAPSHOT_DIR_VARIABLE,
	snapshotDirectory,
} from "@fnb/runner/snapshot-files";
import { ConfigError } from "../config/errors.js";
import type { CommandContext } from "../context.js";

const snapshotsOfContext = new WeakMap<CommandContext, IposSnapshots>();
const modePrinted = new WeakSet<CommandContext>();

export function iposMode(context: Pick<CommandContext, "env">): IposApiMode {
	return iposApiMode(context.env);
}

const PRIVATE_FOLDERS = [DEFAULT_SNAPSHOT_DIRECTORY, join("docs", "private")];

export function snapshotRoot(
	context: Pick<CommandContext, "env" | "rootDir">,
): string {
	const root = snapshotDirectory(context.env, context.rootDir);
	const local = relative(context.rootDir, root);
	const outside = local.startsWith("..") || isAbsolute(local);
	const ignored = PRIVATE_FOLDERS.some(
		(folder) => local === folder || local.startsWith(`${folder}${sep}`),
	);
	if (!outside && !ignored) {
		throw new ConfigError(
			`${IPOS_SNAPSHOT_DIR_VARIABLE} must point outside the repository, at ${DEFAULT_SNAPSHOT_DIRECTORY} or below docs/private/, which git ignores: the snapshot holds real business data`,
		);
	}
	return root;
}

export function iposSnapshots(context: CommandContext): IposSnapshots {
	const known = snapshotsOfContext.get(context);
	if (known) {
		return known;
	}
	const printed = new Set<string>();
	const snapshots = createFileSnapshots(snapshotRoot(context), (line) => {
		if (!printed.has(line)) {
			printed.add(line);
			context.output.error(`warning: ${line}`);
		}
	});
	snapshotsOfContext.set(context, snapshots);
	return snapshots;
}

export async function iposModeText(
	context: CommandContext,
	entries: readonly AccountEntry[],
): Promise<string> {
	const mode = iposMode(context);
	return iposModeLine(
		mode,
		mode === "snapshot"
			? await snapshotCoverage(iposSnapshots(context), entries)
			: null,
	);
}

export async function printIposMode(
	context: CommandContext,
	entries: readonly AccountEntry[],
): Promise<void> {
	if (usesIpos(entries) && !modePrinted.has(context)) {
		modePrinted.add(context);
		context.output.line(await iposModeText(context, entries));
	}
}

export function tenantFor(
	context: CommandContext,
	entry: AccountEntry,
	explicit: string | undefined,
): string | undefined {
	if (explicit !== undefined) {
		return explicit;
	}
	return entry.connector === "ipos-fabi" && iposMode(context) === "snapshot"
		? SNAPSHOT_TENANT_SLUG
		: undefined;
}

export async function guardTenant(
	context: CommandContext,
	entries: readonly AccountEntry[],
	tenantId: string,
	options: { claim: boolean },
): Promise<void> {
	if (usesIpos(entries)) {
		await guardIposTenant(
			context.services.db().runner,
			tenantId,
			iposMode(context),
			options,
		);
	}
}
