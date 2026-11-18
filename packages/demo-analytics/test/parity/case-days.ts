import { addDays, type IsoDate } from "@fnb/reports";
import { isClosedTetDay } from "../../src/index.js";

const DAYS_IN_WEEK = 7;

export function openCaseDay(asOf: IsoDate, daysBeforeAsOf: number): IsoDate {
	let day = addDays(asOf, -daysBeforeAsOf);
	while (isClosedTetDay(day)) day = addDays(day, -DAYS_IN_WEEK);
	return day;
}
