import type { RestClient } from "@fnb/zalo-mini";
import {
	ANNOUNCEMENT_FUNCTIONS,
	type AnnouncementDraft,
	type AnnouncementsApi,
	feedArgs,
	publishArgs,
	readFeed,
	readPublishReceipt,
	readReaders,
	readReadRate,
	readReadReceipt,
} from "../announcements/contract";
import {
	DESTINATION_TABLE,
	destinationQuery,
	type NotificationsApi,
	readDestinations,
} from "../notifications/contract";
import {
	decideArgs,
	REQUEST_FUNCTIONS,
	type RequestsApi,
	readDecisionReceipt,
	readKinds,
	readOwnRequests,
	readQueue,
	readSubmitReceipt,
	submitArgs,
} from "../requests/contract";

export interface TeamClient
	extends Omit<AnnouncementsApi, "publish">,
		Omit<RequestsApi, "kinds">,
		NotificationsApi {
	publish(
		tenantId: string,
		draft: AnnouncementDraft,
	): ReturnType<AnnouncementsApi["publish"]>;
	kinds(tenantId: string): ReturnType<RequestsApi["kinds"]>;
}

export function createRestTeamClient(
	rest: RestClient,
	memberId: string | null,
): TeamClient {
	const a = ANNOUNCEMENT_FUNCTIONS;
	const r = REQUEST_FUNCTIONS;
	return {
		async feed(storeId) {
			return readFeed(await rest.rpc(a.feed, feedArgs(storeId)));
		},
		async markRead(id) {
			return readReadReceipt(
				await rest.rpc(a.markRead, { p_announcement_id: id }),
			);
		},
		async publish(tenantId, draft) {
			return readPublishReceipt(
				await rest.rpc(a.publish, publishArgs(tenantId, draft)),
			);
		},
		async readRate(id) {
			return readReadRate(
				await rest.rpc(a.readRate, { p_announcement_id: id }),
			);
		},
		async readers(id) {
			return readReaders(await rest.rpc(a.readers, { p_announcement_id: id }));
		},
		async kinds(tenantId) {
			return readKinds(await rest.rpc(r.kinds, { p_tenant_id: tenantId }));
		},
		async submit(input) {
			return readSubmitReceipt(await rest.rpc(r.submit, submitArgs(input)));
		},
		async mine() {
			return readOwnRequests(await rest.rpc(r.mine));
		},
		async queue() {
			return readQueue(await rest.rpc(r.queue, { p_store_id: null }));
		},
		async decide(id, input) {
			return readDecisionReceipt(
				await rest.rpc(r.decide, decideArgs(id, input)),
			);
		},
		async destinations() {
			if (memberId === null) return [];
			return readDestinations(
				await rest.select(DESTINATION_TABLE, destinationQuery(memberId)),
			);
		},
		async followTarget() {
			return null;
		},
	};
}
