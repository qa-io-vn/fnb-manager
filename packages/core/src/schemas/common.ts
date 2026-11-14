import { z } from "zod";
import { ISO_DATE_PATTERN } from "./iso-date-pattern.js";

export const externalId = z.string().min(1);
export const isoDate = z.string().regex(ISO_DATE_PATTERN);
export const money = z.number().finite();
export const nonNegativeMoney = z.number().finite().min(0);
export const optionalText = z.string().optional();
export const optionalMoney = money.optional();
export const timezoneName = z.string().min(1);
export const minutesOfDay = z.number().int().min(0).max(1439);
export const rawPayload = z.unknown();

export type IsoDate = z.infer<typeof isoDate>;
