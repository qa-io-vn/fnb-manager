import { describe, expect, it } from "vitest";
import { createSupabaseBackend } from "../../src/backend.js";
import {
	UpstreamError,
	type ZaloFetch,
	type ZaloRequestInit,
} from "../../src/http.js";
import {
	CUSTOMER_LOGIN_DOMAIN,
	customerAppMetadata,
	customerLoginEmail,
	parseCustomerJoin,
	parseCustomerSignIn,
} from "../../src/session.js";

const URL_BASE = "http://127.0.0.1:54321";
const SECRET_KEY = "sb_secret_test";
const USER_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const TENANT = "11111111-1111-4111-8111-111111111111";
const CUSTOMER = "22222222-2222-4222-8222-222222222222";

function scripted(answers: readonly Response[]) {
	const calls: { readonly url: string; readonly init: ZaloRequestInit }[] = [];
	let index = 0;
	const send: ZaloFetch = async (url, init) => {
		calls.push({ url, init });
		const answer = answers[index];
		index += 1;
		if (answer === undefined) throw new Error("no scripted answer left");
		return answer;
	};
	return { send, calls };
}

describe("customer logins", () => {
	it("are created with the customer claims and have them changed through the Auth admin API", async () => {
		const { send, calls } = scripted([
			Response.json({ id: USER_ID }),
			Response.json({ id: USER_ID }),
			Response.json({ message: "denied" }, { status: 403 }),
		]);
		const backend = createSupabaseBackend({
			url: URL_BASE,
			key: SECRET_KEY,
			fetch: send,
		});
		const email = customerLoginEmail(USER_ID);
		expect(
			await backend.createLogin(email, customerAppMetadata(TENANT, null)),
		).toBe(USER_ID);
		expect(JSON.parse(calls[0]?.init.body ?? "")).toEqual({
			email,
			email_confirm: true,
			app_metadata: { kind: "customer", tenant_id: TENANT, customer_id: null },
		});
		await backend.setAppMetadata(
			USER_ID,
			customerAppMetadata(TENANT, CUSTOMER),
		);
		expect(calls[1]?.url).toBe(`${URL_BASE}/auth/v1/admin/users/${USER_ID}`);
		expect(calls[1]?.init.method).toBe("PUT");
		expect(calls[1]?.init.headers).toMatchObject({ apikey: SECRET_KEY });
		expect(JSON.parse(calls[1]?.init.body ?? "")).toEqual({
			app_metadata: {
				kind: "customer",
				tenant_id: TENANT,
				customer_id: CUSTOMER,
			},
		});
		await expect(
			backend.setAppMetadata(USER_ID, customerAppMetadata(TENANT, null)),
		).rejects.toMatchObject({ failure: "status" });
		await expect(backend.setAppMetadata("x", {})).rejects.toMatchObject({
			failure: "invalid_answer",
		});
		expect(calls).toHaveLength(3);
	});

	it("get an e-mail on a reserved domain that can never receive mail", () => {
		expect(customerLoginEmail(USER_ID)).toBe(
			`customer-${USER_ID}@${CUSTOMER_LOGIN_DOMAIN}`,
		);
		expect(CUSTOMER_LOGIN_DOMAIN.endsWith(".invalid")).toBe(true);
		expect(() => customerLoginEmail("customer")).toThrow();
	});
});

describe("customer sign-in and join answers", () => {
	it("parse a visitor, a member and login_needed, and refuse anything else", () => {
		expect(parseCustomerSignIn({ status: "login_needed" })).toEqual({
			status: "login_needed",
		});
		expect(
			parseCustomerSignIn({
				status: "customer",
				user_id: USER_ID,
				tenant_id: TENANT,
				customer_id: null,
				display_name: " ",
			}),
		).toEqual({
			status: "customer",
			userId: USER_ID,
			tenantId: TENANT,
			customerId: null,
			displayName: null,
		});
		expect(
			parseCustomerSignIn({
				status: "customer",
				user_id: USER_ID,
				tenant_id: TENANT,
				customer_id: CUSTOMER,
				display_name: "Khách thử",
			}),
		).toMatchObject({ customerId: CUSTOMER, displayName: "Khách thử" });
		for (const bad of [
			null,
			{ status: "bound" },
			{ status: "customer", user_id: "", tenant_id: TENANT },
		]) {
			expect(() => parseCustomerSignIn(bad)).toThrow(UpstreamError);
		}
	});

	it("parse a join and its refusals", () => {
		expect(
			parseCustomerJoin({
				status: "joined",
				customer_id: CUSTOMER,
				membership_id: "m",
				welcome_stamps: 1,
				already_member: false,
			}),
		).toEqual({
			status: "joined",
			customerId: CUSTOMER,
			membershipId: "m",
			welcomeStamps: 1,
			alreadyMember: false,
		});
		for (const reason of [
			"consent_required",
			"policy_outdated",
			"unknown_store",
			"phone_in_use",
			"no_programme",
		]) {
			expect(parseCustomerJoin({ status: "refused", reason })).toEqual({
				status: "refused",
				reason,
			});
		}
		for (const bad of [
			{ status: "refused", reason: "maybe" },
			{ status: "joined", customer_id: CUSTOMER, membership_id: "m" },
			{
				status: "joined",
				customer_id: CUSTOMER,
				membership_id: "m",
				welcome_stamps: -1,
				already_member: false,
			},
		]) {
			expect(() => parseCustomerJoin(bad)).toThrow(UpstreamError);
		}
	});
});
