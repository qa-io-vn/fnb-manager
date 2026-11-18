import { ConnectorRegistry, type PosConnector } from "@fnb/connector-core";
import {
	type FetchLike,
	iposConnectorFactory,
	type TokenStore,
	toStoredToken,
} from "@fnb/connector-ipos";
import {
	createRecordingFetch,
	createSnapshotReplay,
} from "@fnb/connector-ipos/snapshot";
import { mockConnectorFactory } from "@fnb/connector-mock";
import type { SyncRepository } from "@fnb/sync";
import { AccountConfigError, type AccountEntry } from "./accounts.js";
import {
	type IposApiMode,
	type IposSnapshots,
	iposApiMode,
} from "./ipos-mode.js";

export type RunnerEnvironment = Readonly<Record<string, string | undefined>>;

export const IPOS_APP_KEY_VARIABLE = "IPOS_APP_KEY";
export const SNAPSHOT_APP_KEY = "0123456789abcdef0123456789abcdef";

export interface ConnectorSession {
	connector: PosConnector;
	httpRequests: () => number;
	ipos: IposApiMode | null;
}

export function createConnectorRegistry(): ConnectorRegistry {
	return new ConnectorRegistry()
		.register(iposConnectorFactory)
		.register(mockConnectorFactory);
}

export function credentialsFor(
	entry: AccountEntry,
	environment: RunnerEnvironment,
	mode: IposApiMode = "real",
): unknown {
	if (entry.connector === "mock") {
		return {
			seed: entry.seed ?? 1,
			...(entry.storeCount === undefined
				? {}
				: { storeCount: entry.storeCount }),
			...(entry.rejectLogin === true ? { rejectLogin: true } : {}),
		};
	}
	const appAccessToken =
		entry.appAccessToken ??
		(environment[IPOS_APP_KEY_VARIABLE] || undefined) ??
		(mode === "snapshot" ? SNAPSHOT_APP_KEY : undefined);
	if (!appAccessToken) {
		throw new AccountConfigError(
			`an ipos-fabi account needs the iPOS application key: set ${IPOS_APP_KEY_VARIABLE} or add appAccessToken to its entry`,
		);
	}
	return { email: entry.email, password: entry.password, appAccessToken };
}

export function repositoryTokenStore(
	repository: Pick<SyncRepository, "readToken" | "writeToken">,
	accountId: string,
): TokenStore {
	return {
		async get() {
			const stored = await repository.readToken(accountId);
			if (!stored) {
				return null;
			}
			try {
				return toStoredToken(stored.token);
			} catch {
				return null;
			}
		},
		async set(_key, token) {
			await repository.writeToken(accountId, {
				token: token.token,
				expires_at: new Date(token.expiresAt).toISOString(),
			});
		},
	};
}

export function readOnlyTokenStore(
	repository: Pick<SyncRepository, "readToken" | "writeToken">,
	accountId: string,
): TokenStore {
	const stored = repositoryTokenStore(repository, accountId);
	return {
		get: stored.get,
		async set() {},
	};
}

export interface ConnectOptions {
	tokenStore?: TokenStore;
	fetch?: FetchLike;
	snapshots?: IposSnapshots;
}

async function iposTransport(
	entry: AccountEntry,
	mode: IposApiMode,
	options: ConnectOptions,
): Promise<FetchLike> {
	const snapshots = options.snapshots;
	if (mode === "snapshot") {
		if (!snapshots) {
			throw new AccountConfigError(
				"IPOS_REAL_API=off, but this runner has no iPOS snapshot to answer from; it never calls the real API in that mode",
			);
		}
		const storage = snapshots.open(entry.key);
		if (!(await storage.readManifest())) {
			throw new AccountConfigError(
				"IPOS_REAL_API=off, but this account has no iPOS snapshot yet: build it with fnb ipos-snapshot from-db --tenant <slug>, or record it with IPOS_REAL_API=on",
			);
		}
		return createSnapshotReplay(storage, {
			onWarning: (line) => snapshots.warn(line),
		});
	}
	const network: FetchLike =
		options.fetch ?? ((input, init) => fetch(input, init));
	const recording = snapshots?.recordTo(entry.key) ?? null;
	return recording === null
		? network
		: createRecordingFetch(network, recording, {
				onWarning: (line) => snapshots?.warn(line),
			});
}

export async function connectAccount(
	entry: AccountEntry,
	environment: RunnerEnvironment,
	options: ConnectOptions = {},
): Promise<ConnectorSession> {
	const mode = iposApiMode(environment);
	const ipos = entry.connector === "ipos-fabi";
	let requests = 0;
	const transport = ipos ? await iposTransport(entry, mode, options) : null;
	const counted =
		(inner: FetchLike): FetchLike =>
		(input, init) => {
			requests += 1;
			return inner(input, init);
		};
	const connectorOptions =
		transport === null
			? {}
			: {
					fetch: counted(transport),
					...(options.tokenStore ? { tokenStore: options.tokenStore } : {}),
				};
	const connector = createConnectorRegistry().create(
		entry.connector,
		connectorOptions,
	);
	await connector.authenticate(credentialsFor(entry, environment, mode));
	return {
		connector,
		httpRequests: () => requests,
		ipos: ipos ? mode : null,
	};
}
