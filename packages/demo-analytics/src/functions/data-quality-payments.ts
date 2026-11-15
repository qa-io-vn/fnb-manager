import { portPending } from "./port-pending.js";

export const DATA_QUALITY_PAYMENTS_MAX_DAYS = 400;

export const dataQualityPayments = portPending("data_quality_payments");
