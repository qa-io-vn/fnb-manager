import type { ThemeRow } from "../../../../src/themes/contract.js";
import { STORE_A } from "../../fixtures.js";

export type AdjustmentRow = ThemeRow<"shift_adjustments">;

export const EMAIL_LIKE = /[^\s@]+@[^\s@]+\.[^\s@]+/;
export const LOGIN = "lan.nguyen@example.com";

export function adjustmentRow(
	overrides: Partial<AdjustmentRow>,
): AdjustmentRow {
	return {
		store_id: STORE_A,
		shift_id: "shift-1",
		shift_external_id: "S1",
		shift_name: "Ca sáng",
		business_date: "2026-10-20",
		cashier_name: "Lan",
		opened_at: "2026-10-20T00:30:00Z",
		closed_at: "2026-10-20T07:30:00Z",
		orders: 120,
		item_lines: 180,
		voids: 0,
		void_amount: 0,
		edits: 0,
		removed_lines: 0,
		removed_amount: 0,
		edits_after_close: 0,
		changed_after_close: false,
		void_rate: 0,
		removed_line_rate: 0,
		trailing_shifts: 20,
		void_z_score: 0,
		removed_z_score: 0,
		flagged: false,
		reasons: [],
		...overrides,
	};
}

export {
	cardInput,
	settingsRow,
	shiftRow,
} from "../payments/support.js";
