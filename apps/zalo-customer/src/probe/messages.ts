import type { Catalog, Language } from "@fnb/zalo-mini";

export const probeCatalogs: Readonly<Record<Language, Catalog>> = {
	vi: {
		"probe.open": "Kiểm tra quyền số điện thoại",
		"probe.title": "Kiểm tra quyền số điện thoại",
		"probe.purpose":
			"Màn hình này chỉ có trong bản Development. Nó ghi lại việc hộp thoại chia sẻ số điện thoại của Zalo có hoàn tất hay không; số điện thoại không được hiển thị hay lưu lại.",
		"probe.start": "Bắt đầu kiểm tra",
		"probe.running": "Đang kiểm tra…",
		"probe.consented": "Đã đồng ý chia sẻ",
		"probe.yes": "Có",
		"probe.no": "Không",
		"probe.errorCode": "Mã lỗi",
		"probe.noError": "Không có",
	},
	en: {
		"probe.open": "Check the phone-number permission",
		"probe.title": "Check the phone-number permission",
		"probe.purpose":
			"This screen exists only in Development builds. It records whether Zalo's phone-number consent dialog completes; the number is never shown or kept.",
		"probe.start": "Start the check",
		"probe.running": "Checking…",
		"probe.consented": "Consent given",
		"probe.yes": "Yes",
		"probe.no": "No",
		"probe.errorCode": "Error code",
		"probe.noError": "None",
	},
};
