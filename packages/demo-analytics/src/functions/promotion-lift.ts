import { portPending } from "./port-pending.js";

export const PROMOTION_LIFT_MAX_DAYS = 92;
export const PROMOTION_LIFT_LOOKBACK_DAYS = 56;

export const promotionLift = portPending("promotion_lift");
