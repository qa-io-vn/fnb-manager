import { portPending } from "./port-pending.js";

export const DATA_QUALITY_SUMMARY_MAX_DAYS = 400;
export const RECEIPT_LOOKBACK_DAYS = 120;

export const dataQualitySummary = portPending("data_quality_summary");
