import { z } from "zod";

export const uid = z.string().min(1);
export const epochMs = z.number().int();
export const money = z.number();
export const optionalText = z.string().nullable().optional();
export const optionalNumber = z.number().nullable().optional();
export const optionalMoney = z.number().nullable().optional();
export const optionalEpochMs = z.number().int().nullable().optional();
export const activeFlag = z.number().int().nullable().optional();
