/** An order as the counter functions answer it (native-till.md section 5, docs/api.md 3.27). */
export type OrderStatus =
	| "awaiting_payment"
	| "accepted"
	| "preparing"
	| "ready"
	| "serving"
	| "completed"
	| "cancelled";

export type PaymentStatus =
	| "unpaid"
	| "paid"
	| "refund_pending"
	| "refunded"
	| "partially_refunded";

export interface OrderLine {
	readonly line_no: number;
	readonly item_id: string;
	readonly size_id: string;
	readonly item_name: string;
	readonly size_label: string | null;
	readonly quantity: number;
	readonly unit_price: number;
	readonly options: readonly {
		readonly group_id: string;
		readonly group: string;
		readonly option_id: string;
		readonly name: string;
		readonly price: number;
	}[];
	readonly options_amount: number;
	readonly line_total: number;
	readonly counts_for_stamps: boolean;
	readonly note: string | null;
}

export interface TimelineEvent {
	readonly kind: string;
	readonly action: string;
	readonly from: string | null;
	readonly to: string | null;
	readonly actor: string;
	readonly actor_user_id?: string | null;
	readonly reason_code: string | null;
	readonly reason_text?: string | null;
	readonly amount: number | null;
	readonly at: string;
}

export interface Money {
	readonly paid: number;
	readonly refunded: number;
	readonly refund_open: number;
	readonly payments: readonly {
		readonly id: string;
		readonly method: string;
		readonly amount: number;
		readonly status: string;
		readonly settled_at: string | null;
		readonly recorded_by?: string | null;
	}[];
	readonly refunds: readonly {
		readonly id: string;
		readonly method: string;
		readonly amount: number;
		readonly status: string;
		readonly reason?: string | null;
		readonly requested_at: string;
		readonly settled_at: string | null;
		readonly recorded_by?: string | null;
	}[];
}

export interface Order {
	readonly id: string;
	readonly order_no: number | null;
	readonly display_no: string | null;
	readonly business_date: string;
	readonly source: string;
	readonly type: "table" | "takeaway";
	readonly table: {
		readonly id?: string | null;
		readonly label: string;
	} | null;
	readonly pickup_at: string | null;
	readonly status: OrderStatus;
	readonly payment_status: PaymentStatus;
	readonly payment_method: string | null;
	readonly version: number;
	readonly subtotal: number;
	readonly discount_amount: number;
	readonly total: number;
	readonly note: string | null;
	readonly placed_at: string;
	readonly accepted_at: string | null;
	readonly preparing_at: string | null;
	readonly done_at: string | null;
	readonly completed_at: string | null;
	readonly paid_at: string | null;
	readonly cancelled_at: string | null;
	readonly cancel_reason: string | null;
	readonly late?: boolean;
	readonly lines: readonly OrderLine[];
	readonly timeline?: readonly TimelineEvent[];
	readonly money?: Money;
}

export interface Ordering {
	readonly accepting: boolean;
	readonly reason: string | null;
	readonly paused_until?: string | null;
}

export interface BoardCall {
	readonly id: string;
	readonly table_id: string;
	readonly label: string;
	readonly area: string | null;
	readonly called_at: string;
}

export interface BoardAnswer {
	readonly store_id: string;
	readonly business_date: string;
	readonly ordering: Ordering;
	readonly cursor: number;
	readonly counts: {
		readonly accepted: number;
		readonly preparing: number;
		readonly ready: number;
		readonly serving: number;
		readonly unpaid: number;
		readonly completed_today: number;
		readonly cancelled_today: number;
	};
	readonly orders: readonly Order[];
	readonly calls: readonly BoardCall[];
}

export type ActAnswer = {
	readonly state: "ok" | "conflict" | "refused";
	readonly refusal: string | null;
	readonly replayed: boolean;
	readonly order: Order;
};

export type PayAnswer = {
	readonly state: "paid" | "conflict" | "refused";
	readonly refusal: string | null;
	readonly replayed: boolean;
	readonly payment_id?: string;
	readonly total?: number;
	readonly order: Order;
};

export type RefundAnswer = {
	readonly state: "succeeded" | "pending" | "refused";
	readonly refusal: string | null;
	readonly refundable?: number;
	readonly refund_id?: string;
	readonly amount?: number;
	readonly order: Order;
};
