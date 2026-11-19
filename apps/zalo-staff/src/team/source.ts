import {
	createRestClient,
	type DataEndpoint,
	type StoredSession,
	tokenSubject,
} from "@fnb/zalo-mini";
import { sampleLoyaltyContext } from "../loyalty/source";
import { SAMPLE_MEMBER_ID } from "../shift/sample";
import {
	loadShiftContext,
	type ShiftContext,
	type ShiftQuery,
} from "../shift/source";
import { createRestTeamClient, type TeamClient } from "./client";
import {
	createDemoTeamClient,
	type DemoTeamClient,
	type TeamDemoSettings,
	teamDemoSettingsFrom,
} from "./demo";

export interface TeamSource {
	readonly client: TeamClient;
	readonly memberId: string | null;
	context(query: ShiftQuery, now: Date): Promise<ShiftContext>;
}

export type TeamSourceFactory = (
	endpoint: DataEndpoint,
	session: StoredSession,
) => TeamSource;

export function teamQuery(session: StoredSession): ShiftQuery {
	const member = session.member;
	return {
		role: member.role,
		tenantId: member.tenantId ?? null,
		storeIds: member.storeIds ?? null,
		storeNames: member.stores,
	};
}

export function createDemoTeamSource(
	settings: TeamDemoSettings,
	session: StoredSession,
	clock?: () => Date,
): TeamSource & { readonly client: DemoTeamClient } {
	const client = createDemoTeamClient({
		settings,
		role: session.member.role,
		...(clock === undefined ? {} : { clock }),
	});
	const scope = sampleLoyaltyContext(teamQuery(session), new Date());
	client.scopeStores(scope.stores.map((store) => store.id));
	return {
		client,
		memberId: SAMPLE_MEMBER_ID,
		async context(query, now) {
			const loaded = sampleLoyaltyContext(query, now);
			client.scopeStores(loaded.stores.map((store) => store.id));
			return loaded;
		},
	};
}

export function createRestTeamSource(
	endpoint: Extract<DataEndpoint, { kind: "supabase" }>,
	session: StoredSession,
): TeamSource {
	const rest = createRestClient({
		url: endpoint.url,
		publishableKey: endpoint.publishableKey,
		accessToken: session.accessToken,
	});
	const memberId = tokenSubject(session.accessToken);
	return {
		client: createRestTeamClient(rest),
		memberId,
		context: (query, now) => loadShiftContext(rest, query, now),
	};
}

const sources = new WeakMap<StoredSession, TeamSource>();

export function teamSourceFor(
	endpoint: DataEndpoint,
	session: StoredSession,
): TeamSource {
	const known = sources.get(session);
	if (known !== undefined) return known;
	const created =
		endpoint.kind === "stand-in"
			? createDemoTeamSource(
					teamDemoSettingsFrom(
						typeof window === "undefined" ? "" : window.location.search,
					),
					session,
				)
			: createRestTeamSource(endpoint, session);
	sources.set(session, created);
	return created;
}
