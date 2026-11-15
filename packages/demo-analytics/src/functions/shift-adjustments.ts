import { portPending } from "./port-pending.js";

export const SHIFT_ADJUSTMENTS_MAX_DAYS = 92;
export const SHIFT_ADJUSTMENTS_TRAILING_DAYS = 56;

export const shiftAdjustments = portPending("shift_adjustments");
