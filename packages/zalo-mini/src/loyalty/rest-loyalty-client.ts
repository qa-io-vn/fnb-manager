import type { RestClient } from "../data/rest-client";
import {
	CUSTOMER_FUNCTIONS,
	claimArgs,
	type LoyaltyClient,
	memberCodeArgs,
	readClaimResult,
	readCustomerHome,
	readDeletionRequest,
	readMarketingStop,
	readMemberCode,
	readWallet,
} from "./contract";

export function createRestLoyaltyClient(rest: RestClient): LoyaltyClient {
	return {
		async home() {
			return readCustomerHome(await rest.rpc(CUSTOMER_FUNCTIONS.home));
		},
		async wallet() {
			return readWallet(await rest.rpc(CUSTOMER_FUNCTIONS.wallet));
		},
		async memberCode(store) {
			return readMemberCode(
				await rest.rpc(CUSTOMER_FUNCTIONS.memberCode, memberCodeArgs(store)),
			);
		},
		async submitClaim(input) {
			return readClaimResult(
				await rest.rpc(CUSTOMER_FUNCTIONS.submitClaim, claimArgs(input)),
			);
		},
		async stopMarketing() {
			return readMarketingStop(
				await rest.rpc(CUSTOMER_FUNCTIONS.stopMarketing),
			);
		},
		async requestDeletion() {
			return readDeletionRequest(
				await rest.rpc(CUSTOMER_FUNCTIONS.requestDeletion),
			);
		},
	};
}
