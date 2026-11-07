import { type ZodType, z } from "zod";
import type { QueryParams } from "../http.js";
import { dataEnvelope } from "../schemas/envelope.js";
import {
	customizationSchema,
	itemClassSchema,
	itemSchema,
	itemTypeSchema,
	packageSchema,
	paymentMethodSchema,
	promotionSchema,
	sourceSchema,
	storeSchema,
	unitSchema,
	userSchema,
} from "../schemas/master-data.js";
import {
	type ApiCall,
	type BrandScope,
	brandScopeQuery,
	requireUid,
} from "./shared.js";

const MASTER_DATA_ROOT = "/api/mdata/v1";
const USERS_PATH = "/api/accounts/v1/users";

export interface StoreScope extends BrandScope {
	storeUid: string;
}

export function createMasterDataEndpoints(call: ApiCall) {
	async function listResource<T>(
		path: string,
		scope: BrandScope,
		rowSchema: ZodType<T>,
		extraQuery: QueryParams = {},
	): Promise<T[]> {
		const envelope = await call({
			path,
			query: { skip_limit: true, ...brandScopeQuery(scope), ...extraQuery },
			schema: dataEnvelope(z.array(rowSchema)),
			signal: scope.signal,
		});
		return envelope.data;
	}

	function masterData<T>(
		resource: string,
		scope: BrandScope,
		rowSchema: ZodType<T>,
		extraQuery: QueryParams = {},
	) {
		return listResource(
			`${MASTER_DATA_ROOT}/${resource}`,
			scope,
			rowSchema,
			extraQuery,
		);
	}

	return {
		listStores: (scope: BrandScope) => masterData("stores", scope, storeSchema),
		listItems: async (scope: StoreScope) =>
			masterData("items", scope, itemSchema, {
				list_store_uid: requireUid(scope.storeUid, "storeUid"),
			}),
		listItemTypes: (scope: BrandScope) =>
			masterData("item-types", scope, itemTypeSchema),
		listItemClasses: (scope: BrandScope) =>
			masterData("item-classes", scope, itemClassSchema),
		listUnits: (scope: BrandScope) => masterData("units", scope, unitSchema),
		listCustomizations: async (scope: StoreScope) =>
			masterData("customizations", scope, customizationSchema, {
				store_uid: requireUid(scope.storeUid, "storeUid"),
			}),
		listSources: (scope: BrandScope) =>
			masterData("sources", scope, sourceSchema),
		listPaymentMethods: (scope: BrandScope) =>
			masterData("payment-methods", scope, paymentMethodSchema),
		listPromotions: (scope: BrandScope) =>
			masterData("promotions", scope, promotionSchema, { aggregate: true }),
		listPackages: async (scope: StoreScope) =>
			masterData("packages", scope, packageSchema, {
				list_store_uid: requireUid(scope.storeUid, "storeUid"),
			}),
		listUsers: async (scope: BrandScope) => {
			const envelope = await call({
				path: USERS_PATH,
				query: brandScopeQuery(scope),
				schema: dataEnvelope(z.array(userSchema)),
				signal: scope.signal,
			});
			return envelope.data;
		},
	};
}

export type MasterDataEndpoints = ReturnType<typeof createMasterDataEndpoints>;
