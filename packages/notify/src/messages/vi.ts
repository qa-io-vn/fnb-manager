export const VI_MESSAGES = {
	"test.subject": "Tin thử từ FNB Manager",
	"test.body":
		"Tin thử từ FNB Manager: kênh {label} hoạt động lúc {time} {date}. Đây là tin nhắn tự động.",
	"link_confirmation.subject": "Đã liên kết nhận bản tin",
	"link_confirmation.body":
		"Đã liên kết. Bạn sẽ nhận bản tin ngày và cảnh báo vận hành của {tenant} tại đây. Đây là tin nhắn tự động; tắt hoặc đổi kênh trong Cài đặt → Cảnh báo.",
	"link_code.subject": "Mã xác nhận nhận bản tin",
	"link_code.body":
		"{notice}\n\nNếu bạn đồng ý nhận bản tin và cảnh báo, hãy nhập mã này (hoặc đưa mã cho người đang liên kết giúp bạn): {code}. Mã hết hạn sau 15 phút. Nếu bạn không đồng ý hoặc không yêu cầu, hãy bỏ qua thư này.",
	"link_notice.subject": "Thông báo trước khi nhận bản tin",
	"link_notice.body":
		"{notice}\n\nĐây là tin nhắn tự động. Trả lời ĐỒNG Ý để nhận bản tin và cảnh báo. Nếu không đồng ý, hãy bỏ qua tin này; mã liên kết sẽ tự hết hạn.",
	"link.handover":
		"Gửi nguyên khối này cho người nhận nếu bạn liên kết giúp họ:\n{notice}\nGửi mã {code} cho {bot} trong 15 phút, rồi trả lời ĐỒNG Ý khi bot hỏi.",
	"link.instruction": "Gửi mã {code} cho {bot} trong 15 phút.",
	"link.retry": "Nếu chưa thấy xác nhận sau 1 phút, gửi lại mã.",
	"digest.title": "Bản tin ngày {date} ({weekday})",
	"digest.subject": "Bản tin ngày {date} · {scope}",
	"digest.scope.all": "Tất cả {count} cửa hàng",
	"digest.scope.one": "{store}",
	"digest.scope.some": "{count} cửa hàng",
	"digest.state.verified": "đã đối soát",
	"digest.state.unverified":
		"chưa đối soát, số liệu có thể đổi sau lần đồng bộ đêm",
	"digest.state.unmatched": "chưa khớp với POS ở {stores}",
	"digest.state.partial": "{stores} chưa đồng bộ xong, số liệu tính đến {time}",
	"digest.state.stores.more": "{stores} và {count} cửa hàng khác",
	"digest.state.no_data": "Ngày {date} chưa có hóa đơn nào.",
	"digest.stale": "Một số số liệu đang cập nhật.",
	"digest.net": "Doanh thu thuần: {net}",
	"digest.vsBaseline": "• So với mức nền cùng thứ: {change}",
	"digest.vsBaseline.partial":
		"• So với mức nền cùng thứ ({weeks}/8 tuần): {change}",
	"digest.vsBaseline.building": "• Chưa đủ dữ liệu để so với mức nền cùng thứ",
	"digest.vsPrevious": "• So với hôm trước: {change}",
	"digest.vsPrevious.likeForLike":
		"• So với hôm trước (cùng {covered}/{total} cửa hàng): {change}",
	"digest.invoices": "Hóa đơn: {invoices} · Trung bình {ticket}/hóa đơn",
	"digest.invoices.only": "Hóa đơn: {invoices}",
	"digest.cash": "Tiền mặt cần đếm: {cash}",
	"digest.peak": "Cao điểm: {hour} giờ ({net})",
	"digest.topItems": "Bán chạy: {items}",
	"digest.topItem": "{item} ({quantity})",
	"digest.holiday": "Ngày lễ ({kind}): mức nền không tính các ngày lễ và Tết.",
	"digest.holiday.tet": "Tết",
	"digest.holiday.holiday": "ngày lễ",
	"digest.stores.title": "Theo cửa hàng:",
	"digest.stores.line": "• {store}: {net} ({change} so với mức nền)",
	"digest.stores.line.partial":
		"• {store}: {net} ({change} so với mức nền, {weeks}/8 tuần)",
	"digest.stores.line.building":
		"• {store}: {net} (chưa đủ dữ liệu để so với mức nền)",
	"digest.stores.closed": "• {store}: nghỉ",
	"digest.stores.noSales": "• {store}: không có hóa đơn",
	"digest.stores.unsettled": "• {store}: chưa đồng bộ xong",
	"digest.stores.shiftOpen":
		"• {store}: còn ca chưa đóng, số liệu tính đến {time}",
	"digest.stores.more": "• và {count} cửa hàng khác",
	"digest.attention.title": "Cần chú ý ({count}):",
	"digest.attention.more": "• và {count} mục khác",
	"digest.finding.revenue_below_baseline":
		"• {store}: doanh thu thuần chỉ bằng {ratio} mức nền cùng thứ (ngưỡng {threshold}).",
	"digest.finding.ticket_drop":
		"• {store}: trung bình mỗi hóa đơn {ticket}, giảm {drop} so với {reference}.",
	"digest.finding.ticket_drop.baseline": "mức nền",
	"digest.finding.ticket_drop.previous": "hôm trước",
	"digest.finding.drawer_variance":
		"• {store}: {shift} ({from}–{to}) lệch két {variance}.",
	"digest.finding.drawer_variance.more":
		"• {store}: và {count} ca lệch két khác (xem báo cáo ngày).",
	"digest.finding.drawer_variance.shift": "Ca {number}",
	"digest.finding.drawer_variance.shift.unknown": "Một ca",
	"digest.finding.unverified_day.unmatched":
		"• {store}: số liệu chưa khớp với POS; cảnh báo doanh thu của cửa hàng này tạm ẩn.",
	"digest.finding.unverified_day.unchecked":
		"• {store}: chưa đối soát với POS.",
	"digest.finding.zero_sales_day":
		"• {store}: không có hóa đơn nào trong ngày mở cửa.",
	"digest.open.title": "Đang mở:",
	"digest.open.auth_failed": "• POS từ chối đăng nhập {account} (từ {date}).",
	"digest.open.sync_stale": "• {store} chưa đồng bộ được (từ {time} {date}).",
	"digest.open.sync_failed": "• Đồng bộ {subject} đang lỗi (từ {date}).",
	"digest.link.ngay": "Xem báo cáo ngày: {url}",
	"digest.link.today": "Xem Hôm nay: {url}",
	"digest.footer": "Tắt hoặc đổi kênh nhận: Cài đặt → Cảnh báo.",
	"correction.title": "Cập nhật bản tin ngày {date}",
	"correction.intro": "Sau lần đồng bộ đêm, số liệu đã thay đổi:",
	"correction.net": "• Doanh thu thuần: {net} (trước đó {old})",
	"correction.invoices": "• Hóa đơn: {invoices} (trước đó {old})",
	"correction.store":
		"• {store}: {net}, {invoices} hóa đơn (trước đó {oldNet}, {oldInvoices} hóa đơn)",
	"correction.attention": "Mới cần chú ý ({count}):",
	"alert.subject": "Cảnh báo vận hành từ FNB Manager",
	"alert.reminder.subject": "Nhắc lại cảnh báo vận hành",
	"alert.resolved.subject": "Đã khôi phục",
	"alert.auth_failed":
		"Cảnh báo: POS từ chối đăng nhập {account}. Đồng bộ {count} cửa hàng đã dừng. Cập nhật mật khẩu ở .env, secret GitHub và secret Edge Function, rồi chạy lại đồng bộ.",
	"alert.auth_failed.stores":
		"Cảnh báo: POS từ chối đăng nhập {account}. Đồng bộ các cửa hàng của tài khoản này đã dừng. Cập nhật mật khẩu ở .env, secret GitHub và secret Edge Function, rồi chạy lại đồng bộ.",
	"alert.auth_failed.resolved":
		"Đã khôi phục: {account} đăng nhập lại được, đồng bộ tiếp tục.",
	"alert.sync_stale":
		"Cảnh báo: {store} chưa đồng bộ thành công trong {minutes} phút mở cửa (ngưỡng {threshold}). Số liệu hôm nay có thể chưa cập nhật.",
	"alert.sync_stale.reminder":
		"Nhắc lại: {store} vẫn chưa đồng bộ được (từ {time} {date}).",
	"alert.sync_stale.resolved":
		"Đã khôi phục: {store} đồng bộ lại được lúc {time}.",
	"alert.sync_stale.previous_day":
		"{store}: hôm qua có {minutes} phút mở cửa liền nhau không đồng bộ được (ngưỡng {threshold}).",
	"alert.sync_failed":
		"Cảnh báo: đồng bộ {subject} lỗi khi {stage} ({count} lần liên tiếp). Hệ thống sẽ thử lại; nếu còn lỗi, chạy fnb status.",
	"alert.sync_failed.stage.config": "đọc cấu hình",
	"alert.sync_failed.stage.connect": "kết nối POS",
	"alert.sync_failed.stage.run": "đồng bộ dữ liệu",
	"alert.sync_failed.subject.kind": "{account} ({kind})",
	"alert.sync_failed.kind.nightly": "đồng bộ đêm",
	"alert.sync_failed.kind.backfill": "nạp dữ liệu cũ",
	"alert.sync_failed.kind.reconciliation": "đối soát",
	"alert.sync_failed.kind.incremental": "đồng bộ trong ngày",
	"alert.sync_dispatch_failed":
		"Cảnh báo: lịch đồng bộ không gọi được hàm đồng bộ cho {store} ({count} lần). Xem nhật ký Edge Function sync-incremental.",
	"alert.zero_sales_open":
		"{store}: đã mở cửa {minutes} phút nhưng chưa có hóa đơn nào hôm nay.",
	"alert.nightly_missing":
		"Cảnh báo: đồng bộ đêm chưa chạy thành công trong {hours} giờ qua. Kiểm tra tab Actions của kho mã.",
	"alert.nightly_missing.resolved":
		"Đã khôi phục: đồng bộ đêm chạy thành công lúc {time}.",
	"alert.job_failed":
		'Cảnh báo: tác vụ tự động "{workflow}" thất bại lúc {time} ({conclusion}). Mở tab Actions của kho mã để xem nhật ký.',
	"alert.job_failed.workflows_active":
		"Một số tác vụ theo lịch đã bị GitHub tắt vì kho mã lâu không hoạt động và vừa được bật lại.",
	"alert.channel_failed":
		"Cảnh báo: kênh {label} không gửi được tin ({reason}). Kiểm tra token hoặc liên kết lại trong Cài đặt → Cảnh báo.",
	"alert.dsr_due_soon":
		"Cảnh báo: {overdue} yêu cầu về dữ liệu cá nhân đã quá hạn trả lời và {due_soon} yêu cầu đến hạn trong {days} ngày tới. Mở Khách hàng → Yêu cầu dữ liệu để xử lý.",
	"alert.dsr_due_soon.reminder":
		"Nhắc lại: {overdue} yêu cầu về dữ liệu cá nhân đã quá hạn trả lời, yêu cầu cũ nhất trễ {days_late} ngày. Mở Khách hàng → Yêu cầu dữ liệu để xử lý.",
	"alert.digest_failed":
		"Cảnh báo: chưa tạo được bản tin ngày {date} sau {attempts} lần thử.",
	"alert.cash_count_variance":
		"Cảnh báo: {store}, {shift} ngày {date}: tiền mặt đếm khi đóng ca {direction} so với POS, vượt ngưỡng {reasons}. Kiểm tra két; quản lý có thể mở lại lượt đếm để đếm lại.",
	"alert.cash_count_variance.recount":
		"Cảnh báo: {store}, {shift} ngày {date}: sau {count} lần đếm lại, tiền mặt vẫn {direction} so với POS, vượt ngưỡng {reasons}. Kiểm tra két và các khoản thu chi trong ca.",
	"alert.cash_count_variance.shift": "Ca {number}",
	"alert.cash_count_variance.shift.unknown": "một ca",
	"alert.cash_count_variance.shortfall": "thiếu",
	"alert.cash_count_variance.surplus": "dư",
	"alert.cash_count_variance.differs": "lệch",
	"alert.cash_count_variance.reason.absolute": "tuyệt đối",
	"alert.cash_count_variance.reason.relative": "tương đối",
	"alert.cash_count_variance.reason.z_score": "điểm z",
	"alert.cash_count_variance.reason.unknown": "đã đặt",
	"alert.zalo_token_failed":
		"Cảnh báo: chưa làm mới được {token} của thương hiệu {brand}. Chạy fnb zalo status để xem trạng thái.",
	"alert.zalo_token_failed.refused":
		"Cảnh báo: Zalo từ chối làm mới {token} của thương hiệu {brand} (mã lỗi {code}). Cấp lại bằng {command}, rồi kiểm tra bằng fnb zalo status.",
	"alert.zalo_token_failed.not_configured":
		"Cảnh báo: chưa làm mới được {token} của thương hiệu {brand} vì nơi chạy tác vụ thiếu App secret của thương hiệu. Thêm secret đó, rồi chạy lại tác vụ.",
	"alert.zalo_token_failed.unanswered":
		"Cảnh báo: Zalo không trả lời khi làm mới {token} của thương hiệu {brand}. Token cũ không được dùng lại; lần chạy sau sẽ đọc lại trạng thái. Nếu còn lỗi, chạy fnb zalo status.",
	"alert.zalo_token_failed.reminder":
		"Nhắc lại: {token} của thương hiệu {brand} vẫn chưa được làm mới (từ {time} {date}). Chạy fnb zalo status để xem trạng thái.",
	"alert.zalo_token_failed.resolved":
		"Đã khôi phục: {token} của thương hiệu {brand} đã được lưu lại lúc {time}.",
	"alert.zalo_token_failed.token.oa": "token OA",
	"alert.zalo_token_failed.token.developer": "token nhà phát triển Mini App",
	"alert.zalo_token_failed.token.unknown": "token Zalo",
	"alert.zalo_token_failed.command.oa": "fnb zalo oa authorize",
	"alert.zalo_token_failed.command.developer": "fnb zalo zmp seed",
	"alert.oa_package_expiring":
		"Cảnh báo: gói {tier} của OA hết hạn ngày {date}, còn {days} ngày. Gia hạn trong trang quản lý OA để tin nhắn qua OA không bị gián đoạn.",
	"alert.oa_package_expiring.last_day":
		"Cảnh báo: gói {tier} của OA hết hạn ngày {date}. Gia hạn ngay trong trang quản lý OA để tin nhắn qua OA không bị gián đoạn.",
	"alert.oa_package_expiring.tier.co_ban": "Cơ bản",
	"alert.oa_package_expiring.tier.tieu_chuan": "Tiêu chuẩn",
	"alert.oa_package_expiring.tier.tang_truong": "Tăng trưởng",
	"alert.oa_package_expiring.tier.toan_dien": "Toàn diện",
	"alert.zalo_webhook_unverified":
		"Cảnh báo: ngày {date}, webhook OA nhận {count} sự kiện sai chữ ký (ngưỡng {threshold} mỗi ngày). Kiểm tra khóa bí mật OA trong secret Edge Function.",
	"alert.zalo_webhook_unverified.observe":
		"Cảnh báo: ngày {date}, webhook OA nhận {count} sự kiện sai chữ ký (ngưỡng {threshold} mỗi ngày). Chế độ quan sát vẫn lưu các sự kiện này; kiểm tra khóa bí mật OA trong secret Edge Function trước khi chuyển sang chế độ chặn.",
	"alert.zalo_webhook_unverified.enforce":
		"Cảnh báo: ngày {date}, webhook OA từ chối {count} sự kiện sai chữ ký (ngưỡng {threshold} mỗi ngày). Kiểm tra khóa bí mật OA trong secret Edge Function; nếu khóa đúng, có thể có người gửi sự kiện giả.",
	"alert.redemption_mismatch":
		"Cảnh báo: {store} có {count} mục đổi thưởng chưa khớp với hóa đơn POS: {kinds}. Đối chiếu với POS rồi xử lý các mục này trong hàng chờ đối soát.",
	"alert.redemption_mismatch.unsorted":
		"Cảnh báo: {store} có {count} mục đổi thưởng chưa khớp với hóa đơn POS. Đối chiếu với POS rồi xử lý các mục này trong hàng chờ đối soát.",
	"alert.redemption_mismatch.verified_without_invoice":
		"{count} mã đã xác nhận tại quầy nhưng chưa có hóa đơn",
	"alert.redemption_mismatch.discount_without_redemption":
		"{count} hóa đơn có giảm giá đổi thưởng nhưng không có lượt đổi nào",
	"alert.redemption_mismatch.amount_mismatch":
		"{count} hóa đơn có mức giảm khác với phần thưởng",
	"alert.generic": "Cảnh báo vận hành: {rule}.",
	"alert.generic.resolved": "Đã khôi phục: {rule}.",
	"alert.footer": "Tắt hoặc đổi kênh nhận: Cài đặt → Cảnh báo.",
	"workflow.sync": "Đồng bộ đêm",
	"workflow.backup": "Sao lưu cơ sở dữ liệu",
	"workflow.migrate": "Cập nhật cơ sở dữ liệu",
	"workflow.deploy_web": "Triển khai ứng dụng web",
	"workflow.deploy_functions": "Triển khai Edge Function",
	"workflow.notify": "Gửi bản tin",
	"workflow.workflows_active": "Bật lại tác vụ theo lịch",
	"workflow.zalo_tokens": "Làm mới token Zalo",
	"workflow.other": "Tác vụ khác",
	"list.and": "và",
	"reason.token_invalid": "token không hợp lệ",
	"reason.unauthorized": "khóa API bị từ chối",
	"reason.no_credit": "hết lượt gửi",
	"reason.not_found": "không tìm thấy cuộc trò chuyện",
	"reason.blocked_by_user": "người nhận đã chặn bot",
	"reason.secret_missing": "thiếu khóa bí mật",
	"reason.sender_missing": "chưa cấu hình địa chỉ gửi",
	"reason.permission_denied": "khóa API không có quyền gửi",
	"reason.account_under_validation": "tài khoản e-mail đang chờ xác minh",
} as const;

export type MessageKey = keyof typeof VI_MESSAGES;

export const TEMPLATE_REFS = {
	test: "test.v1",
	link_code: "link_code.v1",
	link_notice: "link_notice.v1",
	link_confirmation: "link_confirmation.v1",
	digest: "digest.v1",
	digest_correction: "digest_correction.v1",
} as const;

export function alertTemplateRef(
	ruleKey: string,
	kind: "alert" | "alert_reminder" | "alert_resolved",
): string {
	if (kind === "alert_reminder") {
		return `alert.${ruleKey}.reminder.v1`;
	}
	if (kind === "alert_resolved") {
		return `alert.${ruleKey}.resolved.v1`;
	}
	return `alert.${ruleKey}.v1`;
}
