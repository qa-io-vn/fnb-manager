export const NOTICE_VERSION = "ops-notifications-v1";

export const NOTICE_TEMPLATE =
	"Khi liên kết, {tenant} chỉ dùng mã tài khoản {kênh} hoặc địa chỉ e-mail đăng nhập của bạn để gửi bản tin số liệu hằng ngày và cảnh báo vận hành. Tin do hệ thống tự động gửi qua {nhà cung cấp}. Việc liên kết là tự nguyện và không ảnh hưởng đến công việc của bạn. Bạn có thể ngừng bất cứ lúc nào trong Cài đặt → Cảnh báo, hoặc nhờ chủ cửa hàng gỡ liên kết. Nhật ký gửi tin được lưu khoảng 13 tháng.";

export const CHANNEL_WORDS: Readonly<
	Record<"zalo_bot" | "telegram" | "email" | "webhook", string>
> = {
	zalo_bot: "Zalo",
	telegram: "Telegram",
	email: "e-mail",
	webhook: "webhook",
};

export const PROVIDER_WORDS: Readonly<
	Record<"zalo_bot" | "telegram" | "brevo" | "resend" | "hmac_webhook", string>
> = {
	zalo_bot: "Zalo Bot",
	telegram: "Telegram",
	brevo: "Brevo",
	resend: "Resend",
	hmac_webhook: "webhook",
};
