export const LOCAL_SUPABASE_PATH = "/supabase";

export type DataEndpoint =
	| {
			readonly kind: "supabase";
			readonly url: string;
			readonly publishableKey: string;
	  }
	| { readonly kind: "stand-in" };

export const STAND_IN_DATA: DataEndpoint = { kind: "stand-in" };

export interface DataEndpointSettings {
	readonly runtime: string | undefined;
	readonly session: string | undefined;
	readonly supabaseUrl: string | undefined;
	readonly publishableKey: string | undefined;
}

export function dataEndpointFrom(settings: DataEndpointSettings): DataEndpoint {
	const publishableKey = settings.publishableKey?.trim() ?? "";
	if (settings.runtime === "zalo") {
		return {
			kind: "supabase",
			url: (settings.supabaseUrl ?? "").trim().replace(/\/+$/, ""),
			publishableKey,
		};
	}
	if (settings.session === "local") {
		return { kind: "supabase", url: LOCAL_SUPABASE_PATH, publishableKey };
	}
	return STAND_IN_DATA;
}
