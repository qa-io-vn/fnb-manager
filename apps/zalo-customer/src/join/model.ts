import type { JoinFailure } from "@fnb/zalo-mini";

export const JOIN_SCREEN_VERSION = "join-1";

export type JoinNext = "card" | "claim";

export type JoinProblem =
	| "phone-expired"
	| "policy-outdated"
	| "phone-in-use"
	| "unknown-store"
	| "network"
	| "unknown";

export type FollowState = "idle" | "busy" | "done" | "skipped";

export type JoinState =
	| { readonly step: "purpose" }
	| {
			readonly step: "consent";
			readonly loyalty: boolean;
			readonly marketing: boolean;
			readonly shownAt: number;
			readonly busy: boolean;
			readonly problem: JoinProblem | null;
	  }
	| {
			readonly step: "joined";
			readonly welcomeStamps: number;
			readonly alreadyMember: boolean;
			readonly follow: FollowState;
	  };

export type JoinAction =
	| { readonly type: "continue"; readonly at: number }
	| { readonly type: "loyalty"; readonly value: boolean }
	| { readonly type: "marketing"; readonly value: boolean }
	| { readonly type: "submit" }
	| { readonly type: "failed"; readonly problem: JoinProblem }
	| {
			readonly type: "joined";
			readonly welcomeStamps: number;
			readonly alreadyMember: boolean;
	  }
	| { readonly type: "follow"; readonly state: FollowState };

export const initialJoinState: JoinState = { step: "purpose" };

export function joinReducer(state: JoinState, action: JoinAction): JoinState {
	switch (action.type) {
		case "continue":
			return state.step === "purpose"
				? {
						step: "consent",
						loyalty: false,
						marketing: false,
						shownAt: action.at,
						busy: false,
						problem: null,
					}
				: state;
		case "loyalty":
			return state.step === "consent" && !state.busy
				? { ...state, loyalty: action.value, problem: null }
				: state;
		case "marketing":
			return state.step === "consent" && !state.busy
				? { ...state, marketing: action.value }
				: state;
		case "submit":
			return state.step === "consent" && state.loyalty && !state.busy
				? { ...state, busy: true, problem: null }
				: state;
		case "failed":
			return state.step === "consent"
				? { ...state, busy: false, problem: action.problem }
				: state;
		case "joined":
			return {
				step: "joined",
				welcomeStamps: action.welcomeStamps,
				alreadyMember: action.alreadyMember,
				follow: "idle",
			};
		case "follow":
			return state.step === "joined"
				? { ...state, follow: action.state }
				: state;
	}
}

export function canSubmit(state: JoinState): boolean {
	return state.step === "consent" && state.loyalty && !state.busy;
}

export function problemOf(failure: JoinFailure): JoinProblem {
	switch (failure) {
		case "phone_token_used":
		case "phone_token_refused":
			return "phone-expired";
		case "policy_outdated":
			return "policy-outdated";
		case "phone_in_use":
			return "phone-in-use";
		case "unknown_store":
			return "unknown-store";
		case "network":
		case "zalo_unavailable":
			return "network";
		default:
			return "unknown";
	}
}
