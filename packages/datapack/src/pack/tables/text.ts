import type { PackLanguage } from "../request.js";

export const TABLE_IDS = [
	"stores",
	"kpi",
	"weekly",
	"monthly",
	"weekday",
	"month_to_date",
	"heatmap_net",
	"heatmap_invoices",
	"hour_levels",
	"items",
	"categories",
	"sizes",
	"pairs",
	"modifiers",
	"payments",
	"promotions",
	"shifts",
	"calendar",
	"gaps",
	"metrics",
] as const;

export type TableId = (typeof TABLE_IDS)[number];

export interface TableText {
	readonly title: string;
	readonly notes: string;
}

export const TABLE_TEXT: Readonly<
	Record<TableId, Readonly<Record<PackLanguage, TableText>>>
> = {
	stores: {
		vi: {
			title: "Cửa hàng",
			notes:
				"Một hàng mỗi cửa hàng, khóa là nhãn S<n>. history_start: ngày bắt đầu lịch sử, ngày muộn hơn giữa ngày mở cửa và ngày đầu có doanh thu; history_days: số ngày từ đó đến ngày dữ liệu cuối. Các cột số ngày khác tính từ đầu ly28 đến ngày dữ liệu cuối; verified đúng khi không có ngày lệch hay ngày chưa đối soát với POS.",
		},
		en: {
			title: "Stores",
			notes:
				"One row per store, keyed by its label S<n>. history_start: the day its history starts, the later of its opening day and its first day with sales; history_days: the days from then to the as-of day. The other day counts cover the start of ly28 to the as-of day; verified is true when no day is unmatched or unchecked against the POS.",
		},
	},
	kpi: {
		vi: {
			title: "KPI theo cửa sổ 28 ngày",
			notes:
				"Hàng <phạm vi>/<mã KPI>; phạm vi ALL gộp mọi cửa hàng. Giá trị đúng như SQL, không làm tròn, theo đơn vị của KPI trong bảng metrics. w28: 28 ngày đến ngày dữ liệu cuối; p28: 28 ngày ngay trước; ly28: w28 lùi 364 ngày. p28_change, ly28_change: thay đổi tương đối, riêng KPI đơn vị fraction là chênh lệch. lo, hi, n: thấp nhất, cao nhất và số cửa sổ có giá trị trong w28 và tám cửa sổ 28 ngày lùi dần 7 ngày (b1 đến b8, cả dải là band). Một cửa sổ để trống cho cả phạm vi khi có cửa hàng của phạm vi chưa có lịch sử ở ngày đầu cửa sổ.",
		},
		en: {
			title: "KPIs over 28-day windows",
			notes:
				"Rows <scope>/<KPI id>; scope ALL adds up every store. Values are exactly as SQL gives them, unrounded, in the KPI's unit from the metrics table. w28: the 28 days to the as-of day; p28: the 28 days before; ly28: w28 moved back 364 days. p28_change, ly28_change: relative changes, differences for KPIs whose unit is fraction. lo, hi, n: the lowest, the highest and the number of windows with a value among w28 and the eight 28-day windows stepped back 7 days at a time (b1 to b8, the whole span is band). A window is null for the whole scope when a store of the scope had no history on its first day.",
		},
	},
	weekly: {
		vi: {
			title: "Doanh thu theo tuần",
			notes:
				"Hàng <phạm vi>/<năm>-W<tuần ISO>, 13 tuần ISO đầy đủ gần nhất. net: doanh thu thuần; avg_ticket: giá trị trung bình một hóa đơn; store_days: số ngày-cửa hàng có doanh thu; holiday_days: số ngày lễ và Tết.",
		},
		en: {
			title: "Weekly sales",
			notes:
				"Rows <scope>/<year>-W<ISO week>, the last 13 complete ISO weeks. net: net sales; avg_ticket: the average invoice; store_days: store-days with sales; holiday_days: holiday and Tết days.",
		},
	},
	monthly: {
		vi: {
			title: "Doanh thu theo tháng",
			notes:
				"Hàng <phạm vi>/<năm>-<tháng>, 27 tháng đầy đủ gần nhất; các cột như bảng weekly.",
		},
		en: {
			title: "Monthly sales",
			notes:
				"Rows <scope>/<year>-<month>, the last 27 complete months; columns as in weekly.",
		},
	},
	weekday: {
		vi: {
			title: "Theo thứ trong tuần",
			notes:
				"Hàng <phạm vi>/<thứ> (mon đến sun) trên 84 ngày gần nhất (w84), gồm cả ngày lễ. store_days: số ngày-cửa hàng có doanh thu; share: phần doanh thu thuần của thứ đó trong cả tuần.",
		},
		en: {
			title: "By weekday",
			notes:
				"Rows <scope>/<weekday> (mon to sun) over the last 84 days (w84), holidays included. store_days: store-days with sales; share: the weekday's part of the week's net sales.",
		},
	},
	month_to_date: {
		vi: {
			title: "Tháng này đến nay",
			notes:
				"Một hàng mỗi phạm vi. net, invoices: từ đầu tháng đến ngày dữ liệu cuối; elapsed_days, remaining_days: số ngày đã qua và còn lại; target: mục tiêu tháng đã nhập, cộng các cửa hàng, trống khi có cửa hàng chưa có mục tiêu; target_share: net chia target; forecast_profile, forecast_naive: dự báo cả tháng theo hồ sơ thứ trong tuần và theo cùng thứ tuần trước.",
		},
		en: {
			title: "Month to date",
			notes:
				"One row per scope. net, invoices: from the first of the month to the as-of day; elapsed_days, remaining_days: the days gone and left; target: the monthly target entered, summed over stores, null when a store has none; target_share: net divided by target; forecast_profile, forecast_naive: whole-month forecasts by the weekday profile and by the same weekday a week earlier.",
		},
	},
	heatmap_net: {
		vi: {
			title: "Doanh thu trung bình theo giờ",
			notes:
				"Hàng <phạm vi>/<thứ>; cột hHH là giờ địa phương kể từ giờ đầu ngày kinh doanh, chỉ những giờ có bán. Giá trị: doanh thu thuần trung bình mỗi ngày của thứ đó trên w84, đơn vị nghìn của tiền tệ trong gói; 0 là thứ đó có bán nhưng giờ đó không.",
		},
		en: {
			title: "Average net sales by hour",
			notes:
				"Rows <scope>/<weekday>; columns hHH are local hours from the start of the business day, only hours with sales. Values: the mean net sales per day of that weekday over w84, in thousands of the pack's currency; 0 means sales on that weekday but none in that hour.",
		},
	},
	heatmap_invoices: {
		vi: {
			title: "Số hóa đơn trung bình theo giờ",
			notes: "Như heatmap_net; giá trị là số hóa đơn trung bình mỗi ngày.",
		},
		en: {
			title: "Average invoices by hour",
			notes: "As heatmap_net; values are the mean invoices per day.",
		},
	},
	hour_levels: {
		vi: {
			title: "Mức bận theo giờ",
			notes:
				"Hàng <phạm vi>/all, /weekdays (thứ hai đến thứ sáu) và /weekend trên w84; cột hHH như heatmap_net. all: peak là các giờ doanh thu lớn nhất, dead là giờ dưới ngưỡng vắng; weekdays, weekend: busy hoặc quiet theo số hóa đơn mỗi ngày; normal là còn lại. peak_share, dead_share: phần doanh thu của giờ peak và giờ dead.",
		},
		en: {
			title: "Hour levels",
			notes:
				"Rows <scope>/all, /weekdays (Monday to Friday) and /weekend over w84; columns hHH as in heatmap_net. all: peak marks the hours with the largest net sales, dead the hours below the quiet threshold; weekdays, weekend: busy or quiet by invoices per day; normal otherwise. peak_share, dead_share: the part of net sales in peak and dead hours.",
		},
	},
	items: {
		vi: {
			title: "Món bán chạy",
			notes:
				"Hàng <phạm vi>/r<hạng>: 10 món doanh thu thuần lớn nhất trong w28, xếp theo doanh thu, số lượng, rồi tên. share: phần trong doanh thu món; net_change: so với p28; first_sold: ngày bán đầu tiên ở các cửa hàng của phạm vi; margin_rate: biên lợi nhuận gộp trên phần đã có giá vốn, trống khi chưa có.",
		},
		en: {
			title: "Top items",
			notes:
				"Rows <scope>/r<rank>: the 10 items with the largest net sales in w28, ranked by net sales, quantity, then name. share: the part of item net sales; net_change: against p28; first_sold: the first day it sold at the scope's stores; margin_rate: the gross margin on the costed part, null without costs.",
		},
	},
	categories: {
		vi: {
			title: "Nhóm món",
			notes:
				"Hàng <phạm vi>/r<hạng> theo doanh thu thuần trong w28, tối đa 10 nhóm; nhóm là loại món trên POS hoặc nhóm đã sửa trong cài đặt. items: số món đã bán; share: phần trong doanh thu món; net_change: so với p28.",
		},
		en: {
			title: "Categories",
			notes:
				"Rows <scope>/r<rank> by net sales in w28, at most 10; a category is the POS item type or the one set in settings. items: the items sold; share: the part of item net sales; net_change: against p28.",
		},
	},
	sizes: {
		vi: {
			title: "Cỡ món",
			notes:
				"Hàng <phạm vi>/r<hạng> theo số lượng trong w28, chỉ các món có cỡ. qty_share: phần số lượng trong mọi món có cỡ; qty_share_change: chênh lệch so với p28.",
		},
		en: {
			title: "Sizes",
			notes:
				"Rows <scope>/r<rank> by quantity in w28, sized items only. qty_share: the part of the quantity of all sized items; qty_share_change: the difference against p28.",
		},
	},
	pairs: {
		vi: {
			title: "Cặp món hay mua cùng",
			notes:
				"Hàng <phạm vi>/r<hạng>: 8 cặp có nhiều hóa đơn chung nhất trong w28. invoices: số hóa đơn có cả hai món; confidence_ab: phần hóa đơn có item_a cũng có item_b; lift: trên 1 là mua cùng nhiều hơn ngẫu nhiên.",
		},
		en: {
			title: "Items bought together",
			notes:
				"Rows <scope>/r<rank>: the 8 pairs with the most shared invoices in w28. invoices: invoices with both items; confidence_ab: the part of invoices with item_a that also have item_b; lift: above 1 means bought together more often than by chance.",
		},
	},
	modifiers: {
		vi: {
			title: "Tùy chọn món",
			notes:
				"Hàng <phạm vi>/r<hạng>: 10 tùy chọn dùng nhiều nhất trong w28; family: sugar, ice hoặc other. share: phần trong mọi dòng tùy chọn; share_change: chênh lệch so với p28.",
		},
		en: {
			title: "Modifiers",
			notes:
				"Rows <scope>/r<rank>: the 10 most used options in w28; family: sugar, ice or other. share: the part of all modifier lines; share_change: the difference against p28.",
		},
	},
	payments: {
		vi: {
			title: "Phương thức thanh toán",
			notes:
				"Hàng <phạm vi>/r<hạng> theo số tiền trong w28, tối đa 8. share: phần số tiền; share_change: chênh lệch so với p28; fee: phí ước tính theo biểu phí đã nhập, trống khi có cửa hàng chưa có biểu phí.",
		},
		en: {
			title: "Payment methods",
			notes:
				"Rows <scope>/r<rank> by amount in w28, at most 8. share: the part of the amount; share_change: the difference against p28; fee: the fee estimated from the fee rates entered, null when a store has none.",
		},
	},
	promotions: {
		vi: {
			title: "Khuyến mãi và giảm giá",
			notes:
				"Hàng <phạm vi>/r<hạng>: 8 chương trình giảm nhiều tiền nhất trong w28. kind: item (giảm món), bill (giảm hóa đơn) hoặc voucher; days: số ngày có dùng.",
		},
		en: {
			title: "Promotions and discounts",
			notes:
				"Rows <scope>/r<rank>: the 8 promotions with the largest discount in w28. kind: item, bill or voucher; days: the days it was used.",
		},
	},
	shifts: {
		vi: {
			title: "Ca bán hàng",
			notes:
				"Hàng <phạm vi>/<khung giờ mở ca> trong w28, theo giờ địa phương: morning 05–11, midday 11–17, evening 17–23, night 23–05. avg_hours: độ dài trung bình của các ca đã đóng; flagged: số ca có chênh lệch két vượt ngưỡng; avg_abs_variance: chênh lệch két tuyệt đối trung bình.",
		},
		en: {
			title: "Shifts",
			notes:
				"Rows <scope>/<opening band> in w28, by local time: morning 05–11, midday 11–17, evening 17–23, night 23–05. avg_hours: the mean length of closed shifts; flagged: shifts whose cash variance passed a threshold; avg_abs_variance: the mean absolute cash variance.",
		},
	},
	calendar: {
		vi: {
			title: "Ngày lễ trong kỳ kế hoạch",
			notes:
				"Hàng ALL/<ngày> cho ngày lễ, Tết và ngày riêng của cửa hàng trong horizon; các tên cùng ngày được gộp. kind: tet, public hoặc custom; days_away: số ngày sau ngày dữ liệu cuối.",
		},
		en: {
			title: "Holidays in the plan horizon",
			notes:
				"Rows ALL/<date> for public holidays, Tết and the tenant's own days in horizon; names on one date are merged. kind: tet, public or custom; days_away: the days after the as-of day.",
		},
	},
	gaps: {
		vi: {
			title: "Dữ liệu còn thiếu",
			notes:
				"Hàng <mã>/<phạm vi>, chỉ có khi điều kiện đúng. value: số đếm của mã (ngày, cửa sổ, món hoặc KPI), trống khi chỉ là thiếu cài đặt; severity: high, medium hoặc low; setting: phần cài đặt sửa được, trống khi không có.",
		},
		en: {
			title: "Missing data",
			notes:
				"Rows <code>/<scope>, present only when the condition holds. value: the code's count (days, windows, items or KPIs), null when a setting is simply missing; severity: high, medium or low; setting: the settings page that fixes it, null when none does.",
		},
	},
	metrics: {
		vi: {
			title: "Danh mục chỉ số",
			notes:
				"Hàng <mã chỉ số> cho các chỉ số metric_value tính được. trackable: dùng được làm KPI của kế hoạch; superseded_by: chỉ số thay thế; formula: cách tính (tiếng Anh).",
		},
		en: {
			title: "Metric registry",
			notes:
				"Rows <metric id> for the metrics metric_value computes. trackable: usable as a plan KPI; superseded_by: the metric that replaces it; formula: how it is computed.",
		},
	},
};
