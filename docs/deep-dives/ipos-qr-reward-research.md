# iPOS: accepting a reward QR from our Zalo app at the till

Research date 2026-11-20. Desk research only: no iPOS API calls, logins or contact. This builds on `ipos-loyalty-integration-design.md` (rails 1–3, the callback, hotline Q1–Q14) and does not repeat it.

Markers: **[verified]** read today on the vendor's live page; **[archived]** read on a Wayback Machine copy of a vendor page that is now private; **[inferred]** our reading, not stated anywhere.

## New findings

- **Still no public developer API.** A WordPress search of huongdan.ipos.vn for "api", "hub", "callback", "mini app" and partner names finds no API reference, no Postman collection and no developer portal. GitHub and the web show no `foodbook.vn` API docs either. Foodbook.vn Co. Ltd is the company that publishes the iPOS apps on the App Store. It does not run a consumer member app [verified].
- **Partner APIs exist, but only behind contracts.** The POS PC feature table (updated 2025-03-28) lists: 6.1 "Kết nối hệ thống iPOS Hub mở các cổng API kết nối Partner như E-Voucher, Payment, ứng dụng đặt hàng online" and 6.3 "Kết nối hệ thống Loyalty để quản lý hệ thống thành viên trên nhiều thương hiệu" [verified].
- **FABi already accepts a third-party member barcode (VANI).** VANI is a multi-brand loyalty wallet that shows one barcode per user. iPOS published a 6-page VANI runbook in June 2023. The pages now return 401 on the live site, but Wayback copies exist [archived]:
  - The cashier taps "Thêm khách hàng", which opens a dialog titled "Nhập mã Check-in". The cashier scans the VANI barcode with a USB scanner, or with the camera button on FABi PDA, then taps "Kiểm tra". The CRM member appears with name, phone, tier, points, "Danh sách voucher" and "Đổi điểm". The cashier taps "Thêm".
  - The screenshots show a 16-digit code and a 13-digit code. The dialog therefore resolves foreign codes online against CRM. The POS PC page agrees: a member cannot be recognised when the shop is offline [verified].
  - VANI vouchers are an ordinary CRM export. The cashier picks the distribution channel `VANI_VOUCHER` and uses "Xuất danh sách voucher": at most 1,000 codes per run, a code prefix of at most 2 characters, and the list goes by e-mail. **The shop then hands the list to VANI by hand.** At the till the cashier opens "Phiếu giảm giá", types the code and taps "Thêm". The dialog is a free-text field plus a list of multi-use codes.
- **iPOS Hub partner channels.** The CRM programme type "Phát hành voucher trên kênh đối tác" has a channel drop-down (`ONE_MOUNT`, i.e. OneU, is shown), a quantity, and a logo and banner "hiển thị trên kênh đối tác". Codes "được tạo ra từ chương trình" only during the issue window [verified, 2024-06-10]. From this we read that the partner pulls codes on demand through the Hub API [inferred].
- **Partner codes are validated online.** "Mã voucher nhận được từ đối tác … hệ thống sẽ tự động xác thực mã" [verified, 2024-06-10].
- **Third-party e-vouchers.** We found no evidence that iPOS integrates Got It, UrBox, Giftpop, Dealtoday or ZaloPay vouchers. Partners we could confirm: OneU through the Hub and VANI through a code pool. How the others usually work:
  - Got It: the merchant's POS calls Got It: check, reserve against `bill_number`, use, unreserve [verified, docs-stg v6.0, 2025-03-21].
  - UrBox: merchants check codes in a separate UrBox POS app [verified, App Store].
  - MoMo: the till scans a MoMo QR, and the partner checks the voucher conditions [snippet only, the site returns 403]. FABi 2.1.14 "thanh toán MoMo cho phép áp dụng voucher kèm theo" covers MoMo-funded vouchers, not ours [verified].
- **Hardware.** The iPOS iSC80 scanner reads 1D and 2D codes (QR, PDF417) over USB or RS232, "quét thanh toán, thành viên" [verified]. Whether it acts as a keyboard is not stated.
- **Zalo.** Nothing new. iPOS has no Zalo Mini App. The only QR that Zalo produces for iPOS is the 2020 OA-chat check-in code [verified, old].

## Options ranked by feasibility

**1. QR wraps a CRM single-use code from an exported pool (Rail 1 plus scanning).** This is the VANI voucher model.
- How it works: our Mini App shows the assigned code as a QR or Code128 with the text underneath. The cashier scans or types it into "Phiếu giảm giá". CRM validates the code and burns it, and the invoice carries `voucher_code`, which our sync confirms.
- Evidence: the VANI runbook and the 385 of 385 invoices with `voucher_code` in the 2026-11-19 audit.
- Gaps: no callback and no member on the bill, so confirmation waits for the sync (5–30 minutes). Codes must be stocked ahead.
- Confirm: does a scanner type into that field (and press Enter), and which symbologies work [inferred: yes for keyboard-wedge scanners]?

**2. Member QR through "Nhập mã Check-in", with a CRM member voucher.**
- (a) No partnership: the QR encodes the customer's phone, and the store toggle "check-in bằng SĐT" (`enable_checkin_by_phone_number`, off today) is turned on. The member is attached, so path A puts the phone on the invoice. The cashier then picks the reward from "Danh sách voucher".
  - Scanning a phone is the same as typing it [inferred].
  - Privacy: the barcode shows the phone in plain form. Mitigate with a short display time and the consent text.
- (b) With a partnership: register a VANI-style loyalty partner so that FABi resolves our rotating token through our API. Needs iPOS (feature 6.3) [inferred].

**3. Manual fallback (Rail 3, unchanged).** Staff check the QR in the Staff Mini App and apply a "Chiết khấu thanh toán". Works today, but the POS has no double-use guard. This matches how UrBox and Got It merchants without an integration operate.

**4. Multi-use programme with our callback (Rail 2).** The QR carries our per-customer code. This is the only documented real-time hook, and it returns Sale_Tran_Id and Membership_Id. It works only if the POS forwards codes it does not recognise (hotline Q6–Q7). It is the iPOS counterpart of Got It's "POS calls the issuer".

**5. Our app as an iPOS Hub voucher channel (the OneU model).**
- How it works: codes are issued on demand with no pool stocking.
- Needs: a contract.
- Unknown: whether iPOS calls the partner back on redemption.
- This gives the best user experience, but only if iPOS will sign.

## Hotline questions (new: Q15–Q20; sharpen Q4, Q6, Q13)

15. "Ô 'Phiếu giảm giá' và 'Nhập mã Check-in' trên FABi có nhận mã quét bằng máy quét (iSC80, chế độ bàn phím) không? Quét QR hay chỉ mã vạch 1D? FABi PDA có nút quét camera cho voucher không?" *Do both fields take a scanned code, QR or only 1D, and is there a PDA camera scan for vouchers?*
16. "'Nhập mã Check-in' nhận những loại mã nào: SĐT, mã tích điểm CRM, mã đối tác như VANI? Bật 'check-in bằng SĐT' thì quét mã vạch chứa SĐT có gắn hội viên không, và SĐT có ghi vào hóa đơn không?" *Which codes does the field accept? Does a barcode holding the phone attach the member and put the phone on the invoice?*
17. "iPOS có cho đối tác loyalty đăng ký mã thành viên riêng để FABi nhận diện (như VANI) không? Điều kiện, phí, tài liệu API? Tích hợp VANI còn hoạt động không?" *Can a loyalty partner have its own member codes resolved, as VANI did? Terms, fee, API docs? Is VANI still live?*
18. "Để Zalo Mini App của thương hiệu là 'Kênh phân phối voucher' qua iPOS Hub (như ONE_MOUNT): có API lấy mã theo thời gian thực, API tra trạng thái mã, và thông báo khi mã được dùng kèm số hóa đơn, cửa hàng, thời điểm không? Phí?" *Can our Mini App be a Hub voucher channel: real-time code API, status API, and a used-code notice with bill, store and time? Fee?*
19. "Có API hoặc báo cáo tự động cho trạng thái từng mã voucher (đã dùng, hóa đơn, cửa hàng) không? 'Báo cáo voucher' có cột số hóa đơn không?" *Is there a per-code status API or report that shows the invoice?*
20. "Voucher gán cho hội viên hiện trong 'Danh sách voucher' khi check-in: tạo hoặc gán voucher đó cho hội viên bằng API hay file import được không?" *Can member-assigned vouchers be created or imported by API or file?*

Q6 sharpened: does the callback also fire for single-use and partner-channel codes? Q13 sharpened: the name and conditions of the "Loyalty" (6.3) and "iPOS Hub E-Voucher" (6.1) APIs.

## Sources

- https://huongdan.ipos.vn/docs/bang-tinh-nang-phan-mem-ipos-vn/tinh-nang-phan-mem-pospc/ (2025-03-28)
- https://huongdan.ipos.vn/docs/bang-tinh-nang-phan-mem-ipos-vn/tinh-nang-phan-mem-fabi/ (2025-03-28)
- VANI runbook (live pages now 401; Wayback copies from 2024): http://web.archive.org/web/20240224182255/https://huongdan.ipos.vn/docs/tai-lieu-van-hanh-vani-tren-ipos/iv-thao-tac-tich-diem-tai-cua-hang-pos-fabi/ · http://web.archive.org/web/20240224201814/https://huongdan.ipos.vn/docs/tai-lieu-van-hanh-vani-tren-ipos/v-thao-tac-xuat-voucher-vani/ · http://web.archive.org/web/20240420225708/https://huongdan.ipos.vn/docs/tai-lieu-van-hanh-vani-tren-ipos/vi-nhap-voucher-tai-cua-hang/ · http://web.archive.org/web/20240420232111/https://huongdan.ipos.vn/docs/tai-lieu-van-hanh-vani-tren-ipos/i-gioi-thieu-ve-vani/
- https://huongdan.ipos.vn/docs/huong-dan-su-dung-ipos-crm/quan-ly-evoucher/phat-hanh-e-voucher-tren-kenh-doi-tac/ (2024-06-10; screenshot `wp-content/uploads/2024/06/Picture4.png`)
- https://huongdan.ipos.vn/docs/huong-dan-su-dung-ipos-crm/quan-ly-evoucher/ap-dung-ma-voucher/ (2024-06-10)
- https://huongdan.ipos.vn/docs/huong-dan-su-dung-ipos-crm/khach-hang/thu-thap-thong-tin-hanh-vi-khach-hang/thu-thap-hanh-vi-khach-hang/ (2020-08-07)
- https://thietbi.ipos.vn/product/may-doc-ma-vach-ipos-isc80/
- https://docs-stg.openapi.gotit.vn/merchants/merchant-api · https://docs-stg.openapi.gotit.vn/merchants/merchant-api-reserve-flow
- https://apps.apple.com/vn/app/id1593839954 (UrBox POS)
- https://developers.momo.vn/v3/docs/voucher-distribution/api-document/voucher-redemption/voucher-redemption-pos/ (search snippet only; 403)
- https://www.momo.vn/tin-tuc/thong-bao/danh-cho-chu-quan-momo-nay-da-tich-hop-tren-ipos-6577 (2024-08-16)
- https://apps.apple.com/us/app/id1046418807 (Foodbook.vn as publisher)
