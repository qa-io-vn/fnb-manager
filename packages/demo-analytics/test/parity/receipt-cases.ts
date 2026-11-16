import type { GeneratedDay } from "@fnb/connector-mock";
import type { DemoDayRewrite, DemoStoreId } from "../../src/index.js";

export const DAILY_RECEIPT_STORE: DemoStoreId = "MOCK-S1";
export const RUNNING_RECEIPT_STORE: DemoStoreId = "MOCK-S2";

export function numberedReceipts(): DemoDayRewrite {
	return (store, day: GeneratedDay) => {
		const digits = day.date.replaceAll("-", "");
		day.sales.forEach((sale, index) => {
			if (store.id === DAILY_RECEIPT_STORE) {
				sale.receiptNo = String(index + 1);
			} else if (store.id === RUNNING_RECEIPT_STORE) {
				sale.receiptNo = `${digits}${String(index + 1).padStart(4, "0")}`;
			}
		});
		return day;
	};
}
