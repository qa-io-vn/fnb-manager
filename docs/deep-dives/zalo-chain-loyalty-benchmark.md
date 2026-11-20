# Zalo chain loyalty benchmark: how VN chains identify members at the till

Research date 2026-11-20, public web only. Companion to `ipos-loyalty-integration-design.md`.

Markers: **[V]** verified on the cited page; **[I]** inferred from indirect evidence; **[?]** not found.

## What each chain does

| Chain | Customer surface | How the till identifies the member | Vendors seen |
|---|---|---|---|
| Highlands | App HighlandsĐI, plus Zalo Mini App "Highlands Rewards" for sign-up (follow OA, share phone) and redeeming DRIPS [V] | A "mã tích điểm thành viên" in the app ("xuất trình tài khoản hoặc mã vạch"); DRIPS land "ngay sau khi thanh toán thành công" [V]. App 5.3.0: "dynamic Member QR code" [V]. Real-time POS integration [I] | App by Digital Signal Service Co.; Zalo campaigns by VietGuys and PangoCDP [V]. POS: [?] |
| Phúc Long | Zalo Mini App "Phúc Long Rewards" (zalo.me/s/2001374113466962529), launched 2025-11 [V] | Plastic card (no longer issued), a web barcode that keeps changing (screenshots refused), or the phone number read out before the bill prints. Rewards are redeemed in the Mini App; new-member coupons are bound to the phone [V] | [?] |
| Cộng Cà Phê | Zalo OA chat, not a Mini App [V]. **Listed by iPOS as a customer** (2023 press release) [V] | Customer taps "Lấy mã tích điểm" in the OA chat and gives the code to the cashier, or gives the phone. Discount codes arrive in Zalo and are handed to staff [V]. This is the iPOS CRM ↔ OA flow from our design doc (`#checkin`, "Lấy mã tích điểm") [I, strong] | iPOS [V] |
| The Coffee House | Own app; membership in a MoMo mini app [V]. iPOS customer (2021 press, 2023 release) [V] | In-store: show the "Tích điểm" member code for staff to scan (MoMo page, 2023) [V] | iPOS CRM + FABi (kiosks), 2021 [V] |
| Phê La | Own app [V] | "Xuất trình mã thành viên/mã tích điểm" before paying; points are converted into an E-Voucher in the app, and the cashier applies it from the code [V] | [?] |
| Hồng Trà Ngô Gia (600+ stores) | Zalo Mini App for ordering and stamps (Zalo case study) [V] | Orders and stamps flow straight into the POS; no till lookup [V] | PosApp [V] |

Katinat (own app since 2026-11-05; earlier a MoMo membership that earned on MoMo payment), Gong Cha (own app) and KFC/Jollibee (ordering apps): no till mechanism published [?].

**Zalo's own case studies** (miniforbusiness.zalo.me):
- Highlands "Chill hè": the bill carried a participation code, typed into the Mini App after scanning a QR on POSM. It reached 2M users, 56.9 % identified and 347k OA follows [V, vendor-reported].
- Anlene × VietGuys: the shop owner uses a **staff account in the Mini App to scan the customer's QR**, photograph the receipt and pick the product. The case says outright that this needs no POS [V].

## Patterns, and which need POS integration

| Pattern | Who uses it | POS integration needed? |
|---|---|---|
| (a) Cashier scans the member QR or barcode into the POS | Highlands, Phúc Long, TCH, Phê La; Cộng (OA code) | **Yes**: the POS must resolve the code (VietGuys ZES: "thu ngân quét mã thành viên hoặc nhập ID khách hàng trên hệ thống POS", 2026-06) [V]. Rotating codes are the anti-screenshot norm [V] |
| (a′) Staff scan the customer QR in a **separate staff Mini App** | Anlene/VietGuys | **No**, any POS; a receipt photo or bill number is the proof |
| (b) Voucher code shown in the app or chat, applied at the POS | Highlands, Phê La, Cộng, Phúc Long | **Yes, for POS enforcement** (the code must exist in the POS or CRM). Otherwise a named manual discount, verified by us |
| (c) Customer scans a QR on the receipt or POSM | Highlands campaign; The Master Channel "Mini App Loyalty" (about 50M ₫ setup plus 9M ₫ a year, vendor claim) | **No**, if the receipt carries a bill number or code |
| (d) Phone number read out | Phúc Long, Cộng; iPOS "Thêm khách hàng" | Native in POS CRMs; usable by us only if the phone reaches the synced invoice (gate G2) |

## What fits an iPOS (Fabi) shop

1. **Closest precedent: Cộng Cà Phê**, an iPOS chain using CRM's OA "Lấy mã tích điểm" code plus phone at the till [V/I]. This does **not** prove that Fabi accepts *our* codes (hotline Q4 stays open).
2. **Without iPOS cooperation:** (a′) + (c) + staff-verified (b), which are our paths B and C and Rail 3, as in the Anlene and The Master Channel patterns. No chain does (a) without its POS vendor.
3. **Keep the 60-second dynamic code**, like the rotating, screenshot-proof codes of Highlands and Phúc Long.
4. **Instant crediting needs a POS member API**, which iPOS does not publish; our earns stay "đang chờ xác nhận" until the sync.

## Zalo-side facts

- `scanQRCode` (SDK ≥ 2.5.3) returns the scanned content; below API 2.23.0 it needs login and permission [V]. Use it for the staff scan and the receipt QR.
- `keepScreen` (SDK ≥ 2.5.3) [V]; no brightness API in the index [V, absence]. Render the QR or barcode in JS [I].
- ZNS/ZBS has a **Voucher** template type [V, Viindoo/Infobip], at 400 ₫ per message. QR or barcode rendering is undocumented in the sources reached [?].
- No native OA "thẻ thành viên" found [?]; chains use OA chat menus (Cộng) or Mini Apps.
- Zalo's Mini App partner page lists **PosApp as the only POS vendor**; iPOS, KiotViet and Sapo are absent [V, 2026-11-20]. KiotViet and Sapo connect only through third-party builders (Miniai, Aimini, CNV) [vendor claims].

## Sources

- https://www.highlandscoffee.com.vn/vn/chinh-sach-chuong-trinh-thanh-vien-highlandsdi.html
- https://apps.apple.com/vn/app/highlands-coffee/id1535599037
- https://miniforbusiness.zalo.me/case-study/highlands-coffee-tang-ti-le-chuyen-doi-voi-chien-dich-phat-voucher-tren-zalo-mini-app
- https://www.brandsvietnam.com/congdong/topic/khac-biet-hoa-cach-phat-voucher-cho-nganh-f-b-voi-the-master-channel
- https://voucherhighlands.com/highlands-coffee-ra-mat-ung-dung-highlandsdi/ (third party)
- https://phuclong.com.vn/hoi-vien/faq
- https://phuclong.com.vn/khuyen-mai/ra-mat-phuc-long-rewards---tich-diem-doi-qua-ngay-20251105100638
- https://chinhsachkhachhang.congcaphe.com/
- https://old.ipos.vn/wp-content/uploads/2023/08/TCBC_iPOS.vn-cong-bo-Khao-sat-tinh-hinh-kinh-doanh-am-thuc-6-thang-dau-nam-2023.docx
- https://baodautu.vn/the-coffee-house-mang-mo-hinh-kiosk-di-khap-viet-nam-d157607.html
- https://www.momo.vn/tin-tuc/thong-bao/dang-ky-thanh-vien-the-coffee-house-tren-momo-3834
- https://www.momo.vn/tin-tuc/khuyen-mai/nhap-hoi-thanh-vien-katinat-tren-momo-tich-diem-6873
- https://phela.vn/dieu-khoan-va-dieu-kien/
- https://apps.apple.com/vn/app/ph%C3%AA-la-specialty-tea-coffee/id6746535911
- https://apps.apple.com/vn/app/katinat-coffee-and-tea-house/id6769085427
- https://gongcha.com.vn/chinh-sach-thanh-vien/
- https://miniforbusiness.zalo.me/case-study/tu-hang-cho-den-65-khach-quay-lai-cach-hong-tra-ngo-gia-bien-moi-don-hang-thanh-ly-do-cho-lan-mua-tiep-theo-2
- https://miniforbusiness.zalo.me/case-study/anlene-vietnam-x-vietguys-chien-dich-friend-get-friend-kich-hoattang-truong-tu-thanh-vien-loyalty-voi-89-4-ma-qua-duoc-su-dung-tai-cua-hang
- https://miniforbusiness.zalo.me/partner
- https://www.brandsvietnam.com/congdong/topic/zalo-engagement-solution-cho-f-b-xay-dung-kenh-ban-hang-va-cham-soc-khach-hang-toan-dien
- https://www.brandsvietnam.com/24244-mini-app-loyalty-tich-diem-nhanh-chong-voi-qr-code-tren-hoa-don
- https://www.brandsvietnam.com/congdong/topic/f-b-loyalty-tu-module-tich-diem-den-hanh-trinh-ket-noi
- https://docs.zaloplatforms.com/docs/MA/api/device/qr/scanQRCode
- https://docs.zaloplatforms.com/docs/MA/api/device/screen/keepScreen
- https://viindoo.com/documentation/17.0/applications/productivity/zalo/manage-zbs-message-templates.html
