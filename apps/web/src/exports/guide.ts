import type { CsvDialect } from "../lib/csv";
import { columnsFor } from "./columns";
import {
	EXPORT_TABLES,
	type ExportFormat,
	type ExportTableId,
	FILE_STEMS,
	type MonthKey,
} from "./plan";

const TABLE_TITLES: Readonly<Record<ExportTableId, string>> = {
	invoices: "Hóa đơn: mỗi dòng là một hóa đơn, mọi trạng thái",
	invoice_lines:
		"Dòng hóa đơn: mỗi dòng là một món, topping hoặc dịch vụ trên hóa đơn",
	invoice_payments: "Thanh toán: mỗi dòng là một lần trả tiền của hóa đơn",
	shifts:
		"Ca: mỗi dòng là một ca bán hàng, tính vào ngày kinh doanh của giờ mở ca",
	daily_summary:
		"Tổng hợp ngày: số liệu báo cáo theo ngày, cho tất cả cửa hàng (ALL) và từng cửa hàng",
};

const SHARED_MEANINGS: Readonly<Record<string, string>> = {
	store_name: "Tên cửa hàng",
	business_date: "Ngày kinh doanh, tính theo giờ bắt đầu ngày của cửa hàng",
	invoice_id: "Mã hóa đơn trong ứng dụng (UUID)",
	invoice_external_id: "Mã hóa đơn trên máy bán hàng",
	external_id: "Mã trên máy bán hàng",
	device_code: "Mã thiết bị bán hàng",
	status: "Trạng thái",
	gross_amount: "Tiền hàng trước giảm giá (₫)",
	net_amount: "Doanh thu thuần sau giảm giá (₫)",
};

const TABLE_MEANINGS: Readonly<
	Record<ExportTableId, Readonly<Record<string, string>>>
> = {
	invoices: {
		id: "Mã hóa đơn trong ứng dụng (UUID)",
		external_id: "Mã hóa đơn trên máy bán hàng",
		receipt_no: "Số hóa đơn in trên phiếu, có thể bắt đầu bằng số 0",
		sold_at: "Thời điểm bán, giờ quốc tế UTC (ISO 8601)",
		sold_at_local: "Thời điểm bán theo giờ cửa hàng (YYYY-MM-DD HH:MM:SS)",
		opened_at: "Thời điểm mở hóa đơn, giờ UTC",
		closed_at: "Thời điểm đóng hóa đơn, giờ UTC",
		status:
			"Trạng thái: completed (hoàn tất), edited (đã sửa), voided (đã hủy)",
		table_name: "Tên bàn",
		area_name: "Khu vực",
		sale_type: "Hình thức bán (tại chỗ, mang đi, giao hàng…)",
		source_name: "Nguồn đơn",
		shift_external_id: "Mã ca trên máy bán hàng",
		guest_count: "Số khách",
		item_discount_amount: "Giảm giá theo món (₫)",
		bill_discount_amount: "Giảm giá trên hóa đơn (₫)",
		extra_discount_amount: "Giảm giá thêm (₫)",
		bill_discount_name: "Tên chương trình giảm giá hóa đơn",
		voucher_name: "Tên voucher",
		voucher_amount: "Tiền giảm bằng voucher (₫)",
		partner_marketing_amount: "Tiền khuyến mãi do đối tác chịu (₫)",
		service_charge_amount: "Phí dịch vụ (₫)",
		shipping_fee_amount: "Phí giao hàng (₫)",
		vat_amount: "Thuế GTGT (₫)",
		paid_amount: "Số tiền khách trả (₫)",
		primary_payment_method_name: "Phương thức thanh toán chính",
		customer_phone: "Số điện thoại khách (thông tin cá nhân)",
		customer_name: "Tên khách (thông tin cá nhân)",
		employee_name: "Tên nhân viên (thông tin cá nhân)",
		voucher_code: "Mã voucher (thông tin cá nhân)",
	},
	invoice_lines: {
		external_id: "Mã dòng trên hóa đơn",
		business_date: "Ngày kinh doanh của hóa đơn",
		parent_line_external_id: "Mã dòng cha, với topping và món kèm",
		line_kind:
			"Loại dòng: item (món), modifier (topping, tùy chọn), service (dịch vụ), package (combo), other (khác)",
		item_external_id: "Mã món trên máy bán hàng",
		item_name: "Tên món như in trên hóa đơn",
		base_name: "Tên món không kèm cỡ",
		size_label: "Cỡ (S, M, L…)",
		item_type_name: "Nhóm món",
		item_class_name: "Lớp món",
		unit_name: "Đơn vị tính",
		package_external_id: "Mã combo",
		quantity: "Số lượng",
		list_unit_price: "Đơn giá niêm yết (₫)",
		unit_price: "Đơn giá bán (₫)",
		discount_amount: "Giảm giá trên dòng (₫)",
		promotion_name: "Tên khuyến mãi",
		note: "Ghi chú trên dòng (thông tin cá nhân)",
	},
	invoice_payments: {
		business_date: "Ngày kinh doanh của lần thanh toán",
		sequence_no: "Thứ tự lần thanh toán trong hóa đơn",
		payment_method_external_id: "Mã phương thức thanh toán",
		payment_method_name: "Tên phương thức thanh toán",
		amount: "Số tiền (₫)",
		fee_amount: "Phí thanh toán (₫)",
		reference_no: "Số tham chiếu giao dịch (thông tin cá nhân)",
		partner_transaction_id: "Mã giao dịch của đối tác (thông tin cá nhân)",
	},
	shifts: {
		id: "Mã ca trong ứng dụng (UUID)",
		external_id: "Mã ca trên máy bán hàng",
		name: "Tên ca; có thể chứa tên đăng nhập của thu ngân (thông tin cá nhân)",
		business_date: "Ngày kinh doanh của giờ mở ca",
		opened_at: "Thời điểm mở ca, giờ UTC",
		opened_at_local: "Thời điểm mở ca theo giờ cửa hàng",
		closed_at: "Thời điểm đóng ca, giờ UTC",
		closed_at_local: "Thời điểm đóng ca theo giờ cửa hàng",
		orders_count: "Số đơn trong ca",
		sales_amount: "Doanh số ca (₫)",
		opening_float_amount: "Tiền đầu ca (₫)",
		expected_cash_amount: "Tiền mặt dự kiến trong két (₫)",
		cash_drawer_amount: "Tiền mặt đếm được (₫)",
		cash_variance_amount: "Chênh lệch tiền mặt = đếm được − dự kiến (₫)",
		changed_after_close: "Ca bị sửa sau khi đóng (true/false)",
		status: "Trạng thái ca",
		cashier_name: "Tên thu ngân (thông tin cá nhân)",
	},
	daily_summary: {
		scope: "Phạm vi: ALL (mọi cửa hàng đã chọn) hoặc nhãn cửa hàng S1, S2…",
		store_name: "Tên cửa hàng, để trống với ALL",
		days_with_data: "Số ngày có số liệu",
		invoices: "Số hóa đơn không bị hủy",
		item_discount_amount: "Giảm giá theo món (₫)",
		bill_discount_amount: "Giảm giá trên hóa đơn (₫)",
		voucher_amount: "Giảm bằng voucher (₫)",
		discount_amount: "Tổng giảm giá (₫)",
		paid_amount: "Khách trả (₫)",
		cash_amount: "Thu tiền mặt (₫)",
		items_sold: "Số món bán ra",
		voucher_invoices: "Số hóa đơn dùng voucher",
		member_invoices: "Số hóa đơn có thành viên",
		identified_invoices: "Số hóa đơn biết khách",
		voided_invoices: "Số hóa đơn bị hủy",
		voided_amount: "Giá trị hóa đơn bị hủy (₫)",
		edited_invoices: "Số hóa đơn bị sửa",
		avg_ticket: "Giá trị trung bình mỗi hóa đơn (₫)",
		items_per_ticket: "Số món trung bình mỗi hóa đơn",
		avg_item_price: "Giá trung bình mỗi món (₫)",
		cash_share: "Tỷ lệ tiền mặt (0 đến 1)",
		voucher_share: "Tỷ lệ hóa đơn dùng voucher (0 đến 1)",
		member_share: "Tỷ lệ hóa đơn có thành viên (0 đến 1)",
		identified_share: "Tỷ lệ hóa đơn biết khách (0 đến 1)",
		discount_rate: "Tỷ lệ giảm giá trên tiền hàng (0 đến 1)",
		holiday_kind: "Loại ngày lễ: public (lễ), tet (Tết), custom (do quán đặt)",
		checked_days: "Số ngày đã đối soát với máy bán hàng",
		matched_days: "Số ngày đối soát khớp",
	},
};

export function columnMeaning(table: ExportTableId, column: string): string {
	return TABLE_MEANINGS[table][column] ?? SHARED_MEANINGS[column] ?? column;
}

const DIALECT_TEXT: Readonly<Record<CsvDialect, string>> = {
	comma: "dấu phẩy ngăn cột, dấu chấm thập phân",
	semicolon:
		"dấu chấm phẩy ngăn cột, dấu phẩy thập phân (cho Excel cài đặt vùng Việt Nam)",
};

export interface GuideInput {
	readonly format: ExportFormat;
	readonly dialect: CsvDialect;
	readonly personal: boolean;
	readonly firstMonth: MonthKey;
	readonly lastMonth: MonthKey;
	readonly receivedMegabytes: string;
	readonly verificationLines: readonly string[];
}

function columnSection(table: ExportTableId, input: GuideInput): string[] {
	const extension = input.format === "csv" ? "csv" : "json";
	const lines = [`${FILE_STEMS[table]}.${extension} — ${TABLE_TITLES[table]}`];
	for (const column of columnsFor(table, input.personal)) {
		lines.push(`  ${column}: ${columnMeaning(table, column)}`);
	}
	return lines;
}

export function guideText(input: GuideInput): string {
	const lines: string[] = [
		"ĐỌC TRƯỚC — DỮ LIỆU XUẤT TỪ FNB MANAGER",
		"",
		`Khoảng tháng: ${input.firstMonth} đến ${input.lastMonth}.`,
		"Mỗi tháng là một thư mục YYYY-MM; mỗi cửa hàng là một thư mục con S1, S2… (xem manifest.json).",
		"Tháng đang chạy chỉ có số liệu đến hết ngày dữ liệu gần nhất và được đánh dấu running trong manifest.json.",
		"",
		input.format === "csv"
			? `Định dạng: CSV mã hóa UTF-8 có BOM, ${DIALECT_TEXT[input.dialect]}.`
			: "Định dạng: JSON mã hóa UTF-8, giữ nguyên mọi mã số.",
		input.personal
			? "Tệp có kèm thông tin cá nhân (tên, số điện thoại, ghi chú, mã tham chiếu). Hãy giữ tệp cẩn thận."
			: "Tệp không kèm thông tin cá nhân của khách và nhân viên.",
		"",
		"MỞ TỆP CSV TRONG EXCEL",
		"  Excel đổi cột toàn chữ số thành số và bỏ số 0 ở đầu (ví dụ receipt_no 0123 thành 123).",
		'  Cách giữ nguyên: Data › From Text/CSV, chọn Transform Data, đặt receipt_no và mọi cột id, *external_id, *_code thành Text rồi mới tải; hoặc chọn "Do not detect data types".',
		'  Excel cho Microsoft 365 và Excel 2024: File › Options › Data › Automatic Data Conversion, tắt "Remove leading zeros…" thì mở bằng nháy đúp cũng giữ số 0.',
		"  Mở bằng nháy đúp sẽ mất số 0 ở đầu số hóa đơn; tệp JSON luôn giữ đúng mọi mã.",
		"  Nếu cả dòng dồn vào một cột, đổi định dạng CSV ở Cài đặt › Ngưỡng báo cáo rồi xuất lại.",
		"",
		"ĐỐI CHIẾU",
		"  Mỗi tệp được so với cơ sở dữ liệu bằng số dòng, tổng tiền và mã băm SHA-256 do cơ sở dữ liệu tính độc lập (manifest.json, verified).",
		...input.verificationLines.map((line) => `  ${line}`),
		"",
		"DUNG LƯỢNG TRUYỀN TẢI",
		`  Đã nhận khoảng ${input.receivedMegabytes} MB (chưa nén, là mức tối đa) từ cơ sở dữ liệu. Gói Free cho 5 GB mỗi tháng.`,
		"",
		"Ý NGHĨA CÁC CỘT",
	];
	for (const table of EXPORT_TABLES) {
		lines.push("", ...columnSection(table, input));
	}
	return `${lines.join("\r\n")}\r\n`;
}
