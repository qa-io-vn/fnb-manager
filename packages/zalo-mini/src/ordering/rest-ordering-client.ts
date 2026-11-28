import type { RestClient } from "../data/rest-client";
import {
	ACCOUNT_FUNCTIONS,
	acceptProposalArgs,
	readAcceptProposalAnswer,
	readCancelRequestAnswer,
	readCustomerRequests,
	readDataExport,
	readDeleteAccountAnswer,
	readStampCodeAnswer,
	requestIdArgs,
} from "./account-contract";
import {
	menuArgs,
	ORDERING_FUNCTIONS,
	type OrderingClient,
	orderArgs,
	ordersArgs,
	pickupArgs,
	readCallAnswer,
	readCancelAnswer,
	readCartCheck,
	readMenu,
	readMenuVersion,
	readOrderAnswer,
	readOrderList,
	readPickupChangeAnswer,
	readPlaceAnswer,
	readStampCard,
	readTableAnswer,
	readTakeawaySlots,
	requestArgs,
	storeArgs,
	tableArgs,
} from "./contract";
import {
	INBOX_FUNCTIONS,
	inboxArgs,
	inboxReadArgs,
	readInboxPage,
	readInboxReadAnswer,
	readInboxUnread,
	readStartMarketingAnswer,
	startMarketingArgs,
} from "./inbox-contract";
import {
	INVOICE_FUNCTIONS,
	invoiceStatusArgs,
	readDeleteSavedCompanyAnswer,
	readInvoiceStatus,
	readRequestInvoiceAnswer,
	readSavedCompanies,
	requestInvoiceArgs,
	savedCompanyArgs,
} from "./invoice-contract";

/** The native till's customer functions through the Data API, with the customer's session. */
export function createRestOrderingClient(rest: RestClient): OrderingClient {
	return {
		async menu(store, type) {
			return readMenu(
				await rest.rpc(ORDERING_FUNCTIONS.menu, menuArgs(store, type)),
			);
		},
		async menuVersion(store) {
			return readMenuVersion(
				await rest.rpc(ORDERING_FUNCTIONS.menuVersion, storeArgs(store)),
			);
		},
		async table(store, token) {
			return readTableAnswer(
				await rest.rpc(ORDERING_FUNCTIONS.table, tableArgs(store, token)),
			);
		},
		async callStaff(store, token) {
			return readCallAnswer(
				await rest.rpc(ORDERING_FUNCTIONS.callStaff, tableArgs(store, token)),
			);
		},
		async checkCart(request) {
			return readCartCheck(
				await rest.rpc(ORDERING_FUNCTIONS.checkCart, requestArgs(request)),
			);
		},
		async placeOrder(request) {
			return readPlaceAnswer(
				await rest.rpc(ORDERING_FUNCTIONS.placeOrder, requestArgs(request)),
			);
		},
		async order(id) {
			return readOrderAnswer(
				await rest.rpc(ORDERING_FUNCTIONS.order, orderArgs(id)),
			);
		},
		async orders(before) {
			return readOrderList(
				await rest.rpc(ORDERING_FUNCTIONS.orders, ordersArgs(before)),
			);
		},
		async cancelOrder(id) {
			return readCancelAnswer(
				await rest.rpc(ORDERING_FUNCTIONS.cancelOrder, orderArgs(id)),
			);
		},
		async takeawaySlots(store) {
			return readTakeawaySlots(
				await rest.rpc(ORDERING_FUNCTIONS.takeawaySlots, storeArgs(store)),
			);
		},
		async changePickup(orderId, pickupAt) {
			return readPickupChangeAnswer(
				await rest.rpc(
					ORDERING_FUNCTIONS.changePickup,
					pickupArgs(orderId, pickupAt),
				),
			);
		},
		async stampCard() {
			return readStampCard(await rest.rpc(ORDERING_FUNCTIONS.stampCard));
		},
		async stampCode() {
			return readStampCodeAnswer(await rest.rpc(ACCOUNT_FUNCTIONS.stampCode));
		},
		async deleteAccount() {
			return readDeleteAccountAnswer(
				await rest.rpc(ACCOUNT_FUNCTIONS.deleteAccount, { p_confirm: true }),
			);
		},
		async exportData() {
			return readDataExport(await rest.rpc(ACCOUNT_FUNCTIONS.exportData));
		},
		async requests() {
			return readCustomerRequests(await rest.rpc(ACCOUNT_FUNCTIONS.requests));
		},
		async cancelRequest(id) {
			return readCancelRequestAnswer(
				await rest.rpc(ACCOUNT_FUNCTIONS.cancelRequest, requestIdArgs(id)),
			);
		},
		async acceptProposal(id, attemptId) {
			return readAcceptProposalAnswer(
				await rest.rpc(
					ACCOUNT_FUNCTIONS.acceptProposal,
					acceptProposalArgs(id, attemptId),
				),
			);
		},
		async invoiceStatus(orderId) {
			return readInvoiceStatus(
				await rest.rpc(INVOICE_FUNCTIONS.status, invoiceStatusArgs(orderId)),
			);
		},
		async requestInvoice(request) {
			return readRequestInvoiceAnswer(
				await rest.rpc(INVOICE_FUNCTIONS.request, requestInvoiceArgs(request)),
			);
		},
		async savedCompanies() {
			return readSavedCompanies(
				await rest.rpc(INVOICE_FUNCTIONS.savedCompanies),
			);
		},
		async deleteSavedCompany(id) {
			return readDeleteSavedCompanyAnswer(
				await rest.rpc(
					INVOICE_FUNCTIONS.deleteSavedCompany,
					savedCompanyArgs(id),
				),
			);
		},
		async inbox(filter, before) {
			return readInboxPage(
				await rest.rpc(INBOX_FUNCTIONS.inbox, inboxArgs(filter, before)),
			);
		},
		async inboxUnread() {
			return readInboxUnread(await rest.rpc(INBOX_FUNCTIONS.unread));
		},
		async markInboxRead(ids) {
			return readInboxReadAnswer(
				await rest.rpc(INBOX_FUNCTIONS.read, inboxReadArgs(ids)),
			);
		},
		async startMarketing(policyVersion, shownAt) {
			return readStartMarketingAnswer(
				await rest.rpc(
					INBOX_FUNCTIONS.startMarketing,
					startMarketingArgs(policyVersion, shownAt),
				),
			);
		},
	};
}
