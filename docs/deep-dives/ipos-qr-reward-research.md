# iPOS: accepting a reward QR from our Zalo app at the till

Research date 2026-11-20. Desk research only: no iPOS API calls, logins or contact. This builds on `ipos-loyalty-integration-design.md` (rails 1–3, the callback, hotline Q1–Q14).

Markers: **[verified]** read today on the vendor's live page; **[archived]** read on a Wayback copy of a vendor page that is now private; **[inferred]** our reading only.

## New findings

- **Still no public developer API.** Searching huongdan.ipos.vn for "api", "hub", "callback" and "mini app" finds no API reference, Postman collection or portal. Nothing on GitHub either. Foodbook.vn Co. Ltd publishes the iPOS apps; it has no consumer member app [verified].
- **Partner APIs exist behind contracts.** The POS PC feature table (2025-03-28) lists:
  - 6.1 "iPOS Hub mở các cổng API kết nối Partner như E-Voucher, Payment…"
  - 6.3 "Kết nối hệ thống Loyalty … thành viên trên nhiều thương hiệu" [verified].
- **FABi already accepts a third-party member barcode (VANI)** [archived; runbook dated June 2023, live pages now return 401].
  - Scanning: "Thêm khách hàng" opens a dialog, "Nhập mã Check-in". The cashier scans the VANI barcode (USB scanner, or the camera button on FABi PDA), then taps "Kiểm tra". The CRM member appears: name, phone, tier, points, "Danh sách voucher".
  - The screenshots show 16- and 13-digit codes, so the dialog looks foreign codes up online.
  - VANI vouchers are an ordinary CRM export: channel `VANI_VOUCHER`, at most 1,000 codes per run, a prefix of at most 2 characters, and the list arrives by e-mail. **The shop hands the list to VANI by hand.**
  - At the till: "Phiếu giảm giá" (a free-text field), type the code, tap "Thêm".
- **iPOS Hub partner channel.** CRM "Phát hành voucher trên kênh đối tác" has a channel drop-down (`ONE_MOUNT`, i.e. OneU), a quantity, and a logo and banner shown on the partner side. Codes are "tạo ra từ chương trình" only during the issue window [verified, 2024-06-10]. So the partner probably pulls codes on demand through the Hub [inferred].
- **Partner codes are validated online.** "Mã voucher nhận được từ đối tác … hệ thống sẽ tự động xác thực mã" [verified, 2024-06-10].
- **Third-party e-vouchers.** We found no iPOS integration with Got It, UrBox, Giftpop, Dealtoday or ZaloPay vouchers; OneU and VANI are the only confirmed partners. How the others work:
  - Got It: the merchant's POS calls Got It to check, reserve against `bill_number`, use and unreserve [verified, staging docs v6.0].
  - UrBox: merchants use a separate UrBox POS app [verified].
  - MoMo: the partner checks voucher conditions at a QR scan [snippet only]. FABi 2.1.14 covers MoMo-funded vouchers paid with MoMo, not ours [verified].
- **Hardware.** The iPOS iSC80 scanner reads 1D and QR codes for "thanh toán, thành viên" [verified]. Whether it emulates a keyboard is not stated.
- **Zalo.** Nothing new: iPOS has no Zalo Mini App. The only Zalo QR is the 2020 OA-chat check-in code.

## Options ranked by feasibility

**1. QR wraps a CRM single-use code from an exported pool (Rail 1 plus scanning; the VANI voucher model).**
- How: our app shows the code as a QR or Code128 with the text underneath. The cashier scans or types it into "Phiếu giảm giá". CRM validates and burns it, and the invoice carries `voucher_code`.
- Evidence: the VANI runbook; 385 of 385 audited invoices carry `voucher_code`.
- Gaps: no callback and no member on the bill. Confirmation comes with the sync (5–30 minutes), and the pool must be stocked ahead.
- To confirm: scanner input into that field [inferred to work].

**2. Member QR through "Nhập mã Check-in", with a CRM member voucher.**
- (a) No partnership: the QR encodes the phone, and the store toggle `enable_checkin_by_phone_number` (off today) is turned on. The member is attached, so path A puts the phone on the invoice. The cashier picks the reward from "Danh sách voucher" [inferred].
  - Privacy: the phone is readable in the barcode. Show it only briefly, and cover it in the consent text.
- (b) Partnership: become a VANI-style loyalty partner (feature 6.3), so FABi resolves our rotating token [inferred].

**3. Manual fallback (Rail 3, unchanged).** Staff check the QR in the Staff Mini App and apply a "Chiết khấu thanh toán". Works today, but the POS has no double-use guard. Merchants without Got It or UrBox integration work this way.

**4. Multi-use programme with our callback (Rail 2).** The QR carries our per-customer code. It is the only documented real-time hook and returns Sale_Tran_Id and Membership_Id. It works only if the POS forwards codes it does not know (Q6–Q7). It is iPOS's version of "the POS calls the issuer".

**5. Our app as an iPOS Hub voucher channel (OneU model).** Codes are issued on demand, with no pool. It needs a contract. Unknown: whether iPOS notifies us when a code is used. Best user experience, if iPOS agrees.

## Hotline questions (new Q15–Q20)

15. "Ô 'Phiếu giảm giá' và 'Nhập mã Check-in' trên FABi có nhận mã quét bằng máy quét (chế độ bàn phím) không? QR hay chỉ mã vạch 1D? FABi PDA có quét camera cho voucher không?" *Do both fields take scanned codes, QR or only 1D?*
16. "'Nhập mã Check-in' nhận những mã nào: SĐT, mã tích điểm CRM, mã đối tác? Bật 'check-in bằng SĐT' rồi quét mã vạch chứa SĐT thì có gắn hội viên và ghi SĐT vào hóa đơn không?" *Does a phone barcode attach the member and reach the invoice?*
17. "Đối tác loyalty có đăng ký mã thành viên riêng để FABi nhận diện như VANI được không? Điều kiện, phí, tài liệu API? Tích hợp VANI còn hoạt động không?" *Can we be a VANI-style partner?*
18. "Zalo Mini App của thương hiệu làm 'Kênh phân phối voucher' qua iPOS Hub (như ONE_MOUNT) được không: API lấy mã theo thời gian thực, API tra trạng thái mã, thông báo khi mã được dùng (số hóa đơn, cửa hàng, thời điểm)? Phí?" *Hub channel APIs and a used-code notice?*
19. "Có API hoặc báo cáo tự động trạng thái từng mã (đã dùng, hóa đơn, cửa hàng) không? 'Báo cáo voucher' có cột số hóa đơn không?" *Per-code status with the invoice?*
20. "Tạo hoặc gán voucher cho hội viên (hiện trong 'Danh sách voucher') bằng API hay import file được không?" *Member vouchers by API or import?*

Sharpened: Q6, does the callback also fire for single-use and partner-channel codes? Q13, what are the names and terms of the 6.1 and 6.3 partner APIs?

## Sources

- https://huongdan.ipos.vn/docs/bang-tinh-nang-phan-mem-ipos-vn/tinh-nang-phan-mem-pospc/ and …/tinh-nang-phan-mem-fabi/ (2025-03-28)
- VANI runbook, Wayback copies: http://web.archive.org/web/20240224182255/https://huongdan.ipos.vn/docs/tai-lieu-van-hanh-vani-tren-ipos/iv-thao-tac-tich-diem-tai-cua-hang-pos-fabi/ · http://web.archive.org/web/20240224201814/https://huongdan.ipos.vn/docs/tai-lieu-van-hanh-vani-tren-ipos/v-thao-tac-xuat-voucher-vani/ · http://web.archive.org/web/20240420225708/https://huongdan.ipos.vn/docs/tai-lieu-van-hanh-vani-tren-ipos/vi-nhap-voucher-tai-cua-hang/ · http://web.archive.org/web/20240420232111/https://huongdan.ipos.vn/docs/tai-lieu-van-hanh-vani-tren-ipos/i-gioi-thieu-ve-vani/
- https://huongdan.ipos.vn/docs/huong-dan-su-dung-ipos-crm/quan-ly-evoucher/phat-hanh-e-voucher-tren-kenh-doi-tac/ (screenshot `wp-content/uploads/2024/06/Picture4.png`)
- https://huongdan.ipos.vn/docs/huong-dan-su-dung-ipos-crm/quan-ly-evoucher/ap-dung-ma-voucher/
- https://huongdan.ipos.vn/docs/huong-dan-su-dung-ipos-crm/khach-hang/thu-thap-thong-tin-hanh-vi-khach-hang/thu-thap-hanh-vi-khach-hang/
- https://thietbi.ipos.vn/product/may-doc-ma-vach-ipos-isc80/
- https://docs-stg.openapi.gotit.vn/merchants/merchant-api · …/merchant-api-reserve-flow
- https://apps.apple.com/vn/app/id1593839954 (UrBox POS) · https://apps.apple.com/us/app/id1046418807 (Foodbook.vn publisher)
- https://developers.momo.vn/v3/docs/voucher-distribution/api-document/voucher-redemption/voucher-redemption-pos/ (snippet; 403)
- https://www.momo.vn/tin-tuc/thong-bao/danh-cho-chu-quan-momo-nay-da-tich-hop-tren-ipos-6577
