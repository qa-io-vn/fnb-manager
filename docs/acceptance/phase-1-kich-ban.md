# Kịch bản nghiệm thu giai đoạn 1: gọi món tại bàn

Dành cho người kiểm thử bán thời gian và quản lý cửa hàng trong 2 tuần chạy thử với khách quen. Bản đầu chỉ được ra mắt khi cả 7 tiêu chí nghiệm thu đều đạt. Kịch bản này kiểm từng tiêu chí trên thiết bị thật và được chạy lại trước mỗi bản cập nhật. Thanh toán luôn thử trong môi trường thử (sandbox) của cổng thanh toán trước, rồi mới thử với số tiền thật nhỏ.

Phần tự động của mỗi tiêu chí (các bài kiểm tra mà lập trình viên chạy bằng một lệnh) được liệt kê ở [kế hoạch kiểm thử, mục 10.15](../test-plan.md#1015-the-owners-plan-phase-1-the-7-acceptance-criteria). Kịch bản này chỉ gồm những gì phải làm bằng tay: điện thoại và máy tính bảng thật, cổng thanh toán, tiền thật nhỏ, máy in.

Cập nhật 2026-11-28.

## Mục lục

1. [Cách dùng](#1-cách-dùng)
2. [Chuẩn bị chung](#2-chuẩn-bị-chung)
3. [Trước mỗi bản cập nhật](#3-trước-mỗi-bản-cập-nhật)
4. [Tiêu chí 1: ba bàn, ba cách trả](#4-tiêu-chí-1-ba-bàn-ba-cách-trả)
5. [Tiêu chí 2: tắt món trong 5 giây](#5-tiêu-chí-2-tắt-món-trong-5-giây)
6. [Tiêu chí 3: thanh toán thất bại hoặc khách thoát giữa chừng](#6-tiêu-chí-3-thanh-toán-thất-bại-hoặc-khách-thoát-giữa-chừng)
7. [Tiêu chí 4: hủy đơn đã trả](#7-tiêu-chí-4-hủy-đơn-đã-trả)
8. [Tiêu chí 5: người chưa có trong danh sách](#8-tiêu-chí-5-người-chưa-có-trong-danh-sách)
9. [Tiêu chí 6: doanh thu ngày khớp cổng thanh toán và tiền mặt](#9-tiêu-chí-6-doanh-thu-ngày-khớp-cổng-thanh-toán-và-tiền-mặt)
10. [Tiêu chí 7: công tháng khớp giờ vào, ra ca](#10-tiêu-chí-7-công-tháng-khớp-giờ-vào-ra-ca)
11. [Từ sandbox sang tiền thật nhỏ](#11-từ-sandbox-sang-tiền-thật-nhỏ)
12. [Phiếu kết quả](#12-phiếu-kết-quả)

## 1. Cách dùng

- Mỗi tiêu chí có: **Chuẩn bị**, **Các bước** (đánh số), **Kết quả mong đợi** và một dòng **Đạt / Không đạt** để đánh dấu.
- Làm đúng thứ tự các bước. Đánh dấu ☐ Đạt hoặc ☐ Không đạt cho từng tiêu chí, ghi ngày, bản cập nhật (mã commit lập trình viên đưa) và tên người kiểm vào phiếu ở mục 12.
- Một bước không đạt: dừng tiêu chí đó, chụp màn hình, ghi giờ, mã đơn (ví dụ #012) và bàn, rồi báo lập trình viên. Không đánh dấu Đạt khi chưa làm lại toàn bộ tiêu chí trên bản đã sửa.
- Ảnh chụp và phiếu kết quả có số tiền thật, tên nhân viên hay tên khách thì giữ ở nơi riêng của quán, không đưa vào kho mã.
- Dùng tài khoản Zalo thử của nhân viên quán làm "khách". Không nhờ khách lạ thử thanh toán.

## 2. Chuẩn bị chung

Thiết bị:

- **Máy tính bảng ở quầy**: mở app quầy, đăng nhập bằng Zalo của nhân viên A, bật loa (để nghe tiếng báo đơn), máy in nhiệt đã nối và có giấy.
- **Hai điện thoại "khách"**: một Android, một iPhone, đều có Zalo và mở được app khách bản thử (bản Development hoặc Testing có bật gọi món).
- **Điện thoại quản lý**: mở app quầy, đăng nhập bằng Zalo của quản lý Q.
- **Một điện thoại thứ ba** có Zalo của người B, người chưa có trong danh sách nhân viên.
- Đồng hồ bấm giờ (dùng điện thoại).

Dữ liệu:

- Ba bàn có mã QR in và dán: **bàn 1**, **bàn 2**, **bàn 3** (nên ở hai khu khác nhau, ví dụ tầng 1 và sân).
- Thực đơn có ít nhất: một món có hai cỡ (Vừa, Lớn), một món có nhóm tùy chọn bắt buộc (độ ngọt), một nhóm không bắt buộc (đá) và một topping có tính thêm tiền.
- Danh sách nhân viên: nhân viên A (thu ngân), nhân viên C (pha chế), quản lý Q. Người B **không** có trong danh sách.
- Mã QR quầy (để Vào ca) in sẵn, dán ở quầy.
- Cổng thanh toán đang ở **sandbox**: ví ZaloPay thử và VietQR thử đã được lập trình viên bật cho quán. Có tài khoản ví thử để trả.
- Thẻ tích dấu của khách đang bật.

## 3. Trước mỗi bản cập nhật

Danh sách kiểm, làm đủ trước khi đưa một bản cập nhật cho quán dùng:

| # | Việc | Ai làm | Đạt khi |
|---|---|---|---|
| 1 | Chạy `pnpm test:acceptance` trên máy build, với Supabase cục bộ đang chạy và `DATABASE_URL` trỏ vào cơ sở dữ liệu cục bộ | lập trình viên | Dòng cuối ghi `0 failed`; không bước nào bị bỏ qua (skip) ngoài lý do đã ghi; các bài TODO là lỗi đã biết, được liệt kê ở mục 10.15 của kế hoạch kiểm thử |
| 2 | Gửi cho người kiểm: mã commit của bản, tóm tắt kết quả (số bước đạt, hỏng, bỏ qua) và danh sách lỗi đã biết | lập trình viên | Người kiểm có đủ ba thông tin |
| 3 | Cài bản mới lên app khách bản thử và app quầy | lập trình viên | Màn hình đăng nhập và thực đơn mở được |
| 4 | Làm lại phần tay rút gọn: bước 1 đến 6 của tiêu chí 1 (sandbox), tiêu chí 2, bước 1 đến 4 của tiêu chí 3, tiêu chí 4 với tiền mặt, tiêu chí 5, đối soát của ngày hôm trước (tiêu chí 6) và xem công tháng (tiêu chí 7) | người kiểm, quản lý | Mọi bước đạt |
| 5 | Bản có thay đổi phần thanh toán: làm thêm toàn bộ tiêu chí 1, 3 và 4 ở sandbox, rồi với tiền thật nhỏ (mục 11) | người kiểm, quản lý | Mọi bước đạt |
| 6 | Ghi kết quả vào phiếu ở mục 12 | người kiểm | Phiếu có ngày, bản và chữ ký |

## 4. Tiêu chí 1: ba bàn, ba cách trả

> Quét QR ở 3 bàn khác nhau, đặt và trả bằng cả 3 cách; đơn hiện ở quầy đúng số bàn, đúng tùy chọn.

**Chuẩn bị**: nhân viên A đã Vào ca; máy tính bảng đang ở màn **Đơn**; cổng thanh toán ở sandbox (lần sau: tiền thật nhỏ, mục 11). Ghi ra giấy trước từng đơn sẽ đặt: bàn, món, cỡ, tùy chọn, cách trả.

**Các bước** (chín đơn: mỗi bàn trả đủ ba cách):

1. Điện thoại Android quét QR **bàn 1**. App mở thực đơn và ghi "Gọi món cho Bàn 1".
2. Chọn món có cỡ, chọn cỡ Lớn, độ ngọt "Ít đường", đá "Không đá", thêm vào giỏ. Bấm **Đặt món**, chọn **Trả tại quầy**, bấm **Đặt món**.
3. Xem máy tính bảng: đơn mới hiện với tiếng báo, ghi **Bàn 1**, đúng món, đúng cỡ, đúng tùy chọn, nhãn **Chưa thu tiền**. Bấm giờ từ lúc bấm Đặt món đến lúc đơn hiện.
4. Vẫn ở bàn 1, đặt một đơn khác, chọn **Chuyển khoản QR**. App hiện mã VietQR (số tiền, ngân hàng, nội dung chuyển khoản). Trong lúc chưa chuyển, xem máy tính bảng: đơn này **chưa** hiện.
5. Chuyển khoản sandbox đúng số tiền và đúng nội dung. App khách chuyển sang màn theo dõi đơn có số đơn; máy tính bảng hiện đơn với tiếng báo, ghi Bàn 1, đã trả.
6. Vẫn ở bàn 1, đặt đơn thứ ba, chọn **Ví ZaloPay**, trả bằng ví thử. Đơn hiện ở quầy với Bàn 1, đã trả, đúng tùy chọn.
7. Lặp lại bước 1 đến 6 với iPhone ở **bàn 2**, rồi với Android ở **bàn 3**, mỗi đơn chọn tùy chọn khác nhau (có một đơn số lượng 2, có một đơn có topping tính tiền).
8. Mở **Bàn** trên máy tính bảng: mỗi bàn 1, 2, 3 có 3 đơn đang mở.
9. Thu tiền mặt ba đơn "Trả tại quầy" (**Thu tiền**). Pha chế bấm "Bắt đầu pha", "Xong, mang ra", rồi **Hoàn thành** từng đơn. Phiếu in ra ở máy in nhiệt ghi đúng bàn và tùy chọn.
10. Trên điện thoại khách, màn theo dõi đơn đổi trạng thái theo từng bước mà không cần tải lại.

**Kết quả mong đợi**:

- Chín đơn, không thiếu, không trùng. Mỗi đơn ở quầy đúng bàn đã quét, đúng món, cỡ, số lượng, tùy chọn và tổng tiền như trên điện thoại.
- Đơn trả online chỉ hiện ở quầy sau khi cổng (hoặc ngân hàng) báo tiền về; đơn trả tại quầy hiện ngay với nhãn Chưa thu tiền.
- Đơn hiện ở quầy dưới 3 giây sau khi thanh toán, có tiếng báo.
- Phiếu in đúng bàn và tùy chọn.

**Kết quả**: ☐ Đạt ☐ Không đạt — Sandbox: ☐ Đạt ☐ Không đạt — Tiền thật nhỏ: ☐ Đạt ☐ Không đạt

## 5. Tiêu chí 2: tắt món trong 5 giây

> Tắt một món ở quầy: ứng dụng khách ẩn món đó trong vòng 5 giây; khách đang có món đó trong giỏ thì được báo.

**Chuẩn bị**: món X đang bán. Android ở thực đơn, đã thêm món X vào giỏ nhưng **chưa** đặt. iPhone ở thực đơn, đang thấy món X.

**Các bước**:

1. Trên máy tính bảng mở **Món** → **Còn / hết món**, tìm món X.
2. Gạt món X sang **Hết** và bắt đầu bấm giờ cùng lúc.
3. Nhìn iPhone: ghi thời điểm món X biến khỏi thực đơn (hoặc hiện "Tạm hết").
4. Nhìn Android: mở giỏ. Dòng món X được đánh dấu, có nút **Bỏ món**; app không cho đặt khi còn món X.
5. Bấm **Bỏ món**, đặt phần còn lại: được.
6. Gạt món X lại **Còn**: trong vòng 5 giây món X hiện lại trên cả hai điện thoại.
7. Làm lại bước 1 đến 6 với điện thoại dùng 4G thay vì Wi-Fi của quán.

**Kết quả mong đợi**: món X biến khỏi app khách trong vòng 5 giây trên cả hai điện thoại, cả Wi-Fi lẫn 4G; khách có món X trong giỏ được báo và không đặt được món đó.

**Kết quả**: ☐ Đạt ☐ Không đạt — thời gian đo được: Android ___ giây, iPhone ___ giây

## 6. Tiêu chí 3: thanh toán thất bại hoặc khách thoát giữa chừng

> Thanh toán thất bại hoặc khách thoát giữa chừng: không có đơn trùng, không có đơn "đã trả" giả.

**Chuẩn bị**: sandbox; máy tính bảng ở màn **Đơn**; ghi số đơn đang có trước khi bắt đầu. Mở trang quản trị sandbox của cổng thanh toán để xem giao dịch.

**Các bước**:

1. **Ví thất bại**: đặt đơn, chọn Ví ZaloPay, trong màn ví thử chọn hủy hoặc làm cho thanh toán thất bại. App báo thanh toán chưa thành công, có **Thử lại**. Máy tính bảng không có đơn mới.
2. Bấm **Thử lại**, trả thành công. Máy tính bảng hiện **một** đơn, đã trả.
3. **Bấm hai lần**: đặt đơn Trả tại quầy và bấm **Đặt món** hai lần thật nhanh. Quầy có **một** đơn.
4. **Mất mạng**: bấm Đặt món rồi tắt Wi-Fi và 4G ngay; bật lại; bấm Đặt món lần nữa. Quầy có **một** đơn.
5. **Thoát giữa chừng**: đặt đơn chọn Chuyển khoản QR, khi mã QR hiện thì đóng hẳn Zalo (vuốt tắt app). Mở lại app: đơn hiện đang chờ thanh toán với **Tiếp tục thanh toán**; quầy không có đơn này.
6. **Chuyển thiếu tiền**: với đơn ở bước 5, chuyển khoản sandbox thiếu 1.000đ. Đơn vẫn chờ thanh toán; quầy không có đơn. Quản lý mở **Quản lý** → **Tiền chờ xử lý**: khoản này hiện với **Sai số tiền**, đúng số tiền đã chuyển, "Đơn cần" số tiền của đơn, mã chuyển khoản, giờ nhận và tài khoản đã nhận tiền ("Tiền vào" ngân hàng và 4 số cuối của tài khoản, của cửa hàng hay chung của thương hiệu; đối chiếu với tài khoản trên sao kê) (xem ghi chú dưới).
7. **Hết giờ**: để đơn chờ quá 15 phút. App báo hết hạn và mời **Trả tại quầy**; bấm Trả tại quầy thì quầy có một đơn mới Chưa thu tiền, đơn cũ đã hủy.
8. Cuối bài: so danh sách đơn ở quầy với trang quản trị sandbox: mỗi đơn "đã trả" ở quầy có đúng một giao dịch thành công tương ứng ở cổng, cùng số tiền.

Trường hợp app khách tự báo "đã trả" mà cổng không báo tiền về không làm được bằng tay; bài kiểm tra tự động đã giữ trường hợp này.

**Kết quả mong đợi**: không có đơn trùng; không đơn nào ở quầy ghi đã trả khi cổng hoặc ngân hàng chưa xác nhận; mở lại app luôn thấy đúng trạng thái.

Ghi chú: máy chủ không bao giờ tự tính các khoản chuyển sai số tiền, chuyển muộn, trả trùng hoặc không rõ đơn là đã trả; nó giữ chúng ở **Quản lý** → **Tiền chờ xử lý** chờ quản lý. Các khoản này không tính vào **Đối soát ngày**; khi còn khoản chưa xử lý, ô Đối soát ngày có dòng "N khoản tiền chờ xử lý, chưa tính vào đối soát →". Sau khi trả lại tiền cho khách (chuyển khoản lại hoặc tiền mặt, ngoài app), quản lý bấm **Xử lý**, chọn **Đã trả lại khách**, ghi chú cách trả rồi xác nhận; khoản sang mục **Đã xử lý** với tên người xử lý và giờ. Khoản không phải trả lại (ví dụ chuyển thử) chọn **Bỏ qua, không trả lại**. Ghi rồi không đổi lại được.

**Kết quả**: ☐ Đạt ☐ Không đạt — Sandbox: ☐ Đạt ☐ Không đạt — Tiền thật nhỏ: ☐ Đạt ☐ Không đạt

## 7. Tiêu chí 4: hủy đơn đã trả

> Hủy một đơn đã trả: tiền hoàn đúng, dấu tích điểm bị trừ, nhật ký ghi tên người hủy.

**Chuẩn bị**: một tài khoản Zalo "khách" đã có vài dấu trên thẻ tích dấu (ghi số dấu trước khi thử). Nhân viên A đã Vào ca (hoàn tiền mặt cần người đang trong ca).

**Các bước**:

1. **Tiền mặt, đơn chưa xong**: khách đặt đơn Trả tại quầy, A thu tiền mặt. Trước khi pha, A mở đơn, bấm **Hủy đơn**, chọn lý do. Đơn chuyển sang chờ hoàn tiền. A bấm **Hoàn tiền**, đưa lại tiền mặt đúng số đã thu.
2. **Ví, đơn chưa xong**: khách đặt đơn trả bằng Ví ZaloPay (sandbox). Nhân viên hủy đơn kèm lý do. Hoàn tiền đi qua cổng: kiểm tra trang quản trị sandbox có giao dịch hoàn đúng số tiền.
3. **Đơn đã hoàn thành**: khách đặt hai ly, trả, đơn hoàn thành và thẻ được cộng 2 dấu. Quản lý Q mở đơn, hoàn tiền một ly kèm lý do. Thẻ của khách bị trừ 1 dấu.
4. Nhân viên A (không phải quản lý) thử hoàn tiền đơn đã hoàn thành: app từ chối.
5. Mở **Nhật ký đơn** của từng đơn ở bước 1 đến 3.
6. Trên app khách: xem thẻ tích dấu và đơn đã hủy.

**Kết quả mong đợi**: số tiền hoàn bằng đúng số đã trả (hoặc đúng phần quản lý chọn); dấu đã cộng bị trừ; nhật ký ghi tên người hủy, người hoàn tiền, lý do, số tiền và thời gian; nhân viên thường không hoàn tiền được đơn đã hoàn thành.

Với tiền thật nhỏ (mục 11): ghi ngày tiền hoàn về lại tài khoản ví hoặc ngân hàng của người trả.

**Kết quả**: ☐ Đạt ☐ Không đạt — Sandbox: ☐ Đạt ☐ Không đạt — Tiền thật nhỏ: ☐ Đạt ☐ Không đạt — ngày tiền hoàn về: ___

## 8. Tiêu chí 5: người chưa có trong danh sách

> Nhân viên chưa có trong danh sách không vào được ứng dụng nội bộ.

**Chuẩn bị**: người B (chưa có trong danh sách) có Zalo trên điện thoại thứ ba. Quản lý Q đăng nhập trên điện thoại quản lý.

**Các bước**:

1. Người B mở app quầy trên máy tính bảng (đăng xuất A trước) và bấm đăng nhập bằng Zalo.
2. App hiện "Tài khoản chưa được cấp quyền". Người B không thấy đơn, bàn, món, tiền hay ca làm nào.
3. Người B gõ thẳng địa chỉ một trang nội bộ (ví dụ thêm `#/quan-ly/ca-lam` vào địa chỉ): vẫn bị chặn.
4. Trên điện thoại quản lý, mở **Quản lý** → **Nhân sự**: người B nằm trong danh sách người đăng nhập chưa có trong danh sách.
5. Quản lý thêm người B, tạo mã ghép 6 số. B nhập mã, đọc và đồng ý thông báo cho nhân viên, vào được app.
6. Quản lý khóa người B. Ở thao tác tiếp theo, B bị đưa ra khỏi app và không vào lại được.
7. Nhập sai mã ghép nhiều lần: app báo chờ vài phút.

**Kết quả mong đợi**: người chưa có trong danh sách, hoặc đã bị khóa, không vào được app quầy và không thấy dữ liệu nào; người được quản lý thêm thì vào được sau khi ghép mã.

**Kết quả**: ☐ Đạt ☐ Không đạt

## 9. Tiêu chí 6: doanh thu ngày khớp cổng thanh toán và tiền mặt

> Doanh thu ngày trên ứng dụng khớp tổng giao dịch của cổng thanh toán và tiền mặt cuối ca.

Làm mỗi ngày trong 2 tuần chạy thử, vào cuối ngày hoặc sáng hôm sau.

**Chuẩn bị**: mỗi ca, nhân viên **Vào ca** bằng mã QR quầy và đếm tiền đầu ca; **Ra ca** đếm tiền theo từng mệnh giá (đếm "mù": app không cho thấy số dự kiến trước khi đếm). Ca lệch tiền phải được quản lý xác nhận kèm ghi chú. Giữ phiếu kết toán của máy cà thẻ (nếu có).

**Các bước**:

1. Sau khi mọi ca trong ngày đã Ra ca, quản lý mở **Quản lý** → **Ca làm và công**, chọn ngày.
2. Đọc ô **Đối soát ngày**: Doanh thu trên ứng dụng, Thanh toán online đã xác nhận, Thẻ tại quầy, Tiền mặt đếm cuối ca, và trạng thái **Khớp** hoặc **Chưa khớp**.
3. Mở **Tổng quan ngày** cùng ngày: doanh thu bằng đúng số "Doanh thu trên ứng dụng" ở bước 2.
4. Mở trang quản trị của cổng thanh toán (sandbox trong những ngày thử sandbox, tài khoản thật trong những ngày tiền thật): cộng các giao dịch thành công trong ngày, trừ các giao dịch hoàn tiền. Kết quả bằng "Thanh toán online đã xác nhận". Với VietQR, làm tương tự với sao kê ngân hàng.
5. Cộng phiếu kết toán máy cà thẻ: bằng "Thẻ tại quầy".
6. Cộng số tiền mặt đếm cuối các ca, trừ tiền đầu ca: bằng "Tiền mặt đếm cuối ca".
7. Kiểm tra: Doanh thu trên ứng dụng = online đã xác nhận + thẻ + tiền mặt đếm cuối ca, và trạng thái là **Khớp**.

**Kết quả mong đợi**: các con số ở bước 3 đến 6 bằng đúng các số trên app, và ngày ở trạng thái **Khớp**. Một ngày **Chưa khớp** phải giải thích được: một ca lệch tiền đã được quản lý xác nhận với lý do, một đơn đã thu tiền mà chưa hoàn thành, hoặc tiền mặt của đơn đã hủy (ô **Đối soát ngày** ghi thêm dòng "Tiền mặt của đơn đã hủy" và, khi khách chưa được hoàn, dòng "Tiền mặt còn nợ khách (đơn đã hủy, chưa hoàn)").

Lưu ý: khoản hoàn tiền được tính vào ngày đưa lại tiền cho khách (tiền mặt: ngày của ca đã chi tiền từ két; thẻ và online: ngày hoàn tiền thành công). Nếu một đơn đã hoàn thành của ngày hôm trước được hoàn tiền hôm nay, ngày hôm trước giữ nguyên số liệu và vẫn **Khớp**; hôm nay có thêm một khoản doanh thu âm đúng bằng số tiền hoàn, và hôm nay cũng **Khớp**. Đây là quy tắc mặc định, chủ quán có thể chọn cách khác. Những đơn gần nửa đêm: cổng thanh toán tính theo giờ giao dịch, app tính theo ngày bán của đơn, nên so kỹ các giao dịch sát 0 giờ.

**Kết quả** (mỗi ngày một dòng ở phiếu): ☐ Khớp ☐ Chưa khớp, có giải thích ☐ Chưa khớp, không giải thích được (Không đạt)

## 10. Tiêu chí 7: công tháng khớp giờ vào, ra ca

> Công tháng của từng nhân viên khớp giờ vào, ra ca đã ghi.

**Quy tắc đang dùng (chờ chủ quán chốt)**: mỗi người, mỗi ngày bán hàng (ngày của giờ Vào ca, kể cả ca qua nửa đêm): cộng số giờ giữa Vào ca và Ra ca đã ghi, chia cho 8 giờ, làm tròn 2 chữ số, tối đa 1 công một ngày. Công tháng là tổng các ngày, so với chuẩn 28 công. Ca chưa Ra ca không tính. Ca quên Ra ca thì quản lý đóng hộ với giờ ra quản lý nhập, và giờ đó được tính. Ví dụ: 8 giờ = 1 công; 4 giờ = 0,5 công; 7 giờ 57 phút = 0,99 công; hai ca tổng 10 giờ trong một ngày = 1 công.

**Chuẩn bị**: một sổ chấm công giấy ở quầy. Sau mỗi lần Vào ca và Ra ca, nhân viên ghi tên, ngày, giờ vào và giờ ra mà app hiện.

**Các bước**:

1. Trong 2 tuần, mọi ca đều Vào ca và Ra ca trên app, và ghi sổ.
2. Cố ý tạo một ca quên Ra ca: quản lý đóng hộ trong **Ca làm và công**, nhập giờ ra thật và ghi chú. Ghi giờ đó vào sổ.
3. Cuối đợt (hoặc cuối tháng), với từng người, tính công bằng tay từ sổ theo quy tắc trên.
4. Quản lý mở **Quản lý** → **Ca làm và công** → bảng **Công tháng**: so giờ và công của từng người với số tính tay.
5. Mỗi nhân viên mở **Ca làm** trên app: dòng "… / 28 công" bằng số của quản lý cho người đó.

**Kết quả mong đợi**: giờ và công của từng người trên app bằng số tính tay từ sổ, ở cả màn quản lý lẫn màn của chính nhân viên.

Báo chủ quán nếu thấy quy tắc chưa đúng ý, ví dụ: một người làm ở hai quán trong cùng một ngày có thể được hơn 1 công; một ca 7 giờ 59 phút được tính tròn 1 công; một ca đang chờ quản lý xác nhận tiền lệch vẫn được tính công.

**Kết quả**: ☐ Đạt ☐ Không đạt

## 11. Từ sandbox sang tiền thật nhỏ

1. Làm đủ tiêu chí 1, 3 và 4 ở **sandbox** đến khi tất cả đều Đạt.
2. Lập trình viên chuyển cổng thanh toán của quán sang chế độ thật. Quản lý xác nhận trên trang quản trị của cổng rằng tài khoản nhận tiền đứng tên quán.
3. Quản lý tạo một món thử giá nhỏ (ví dụ 2.000đ đến 10.000đ), hoặc dùng món rẻ nhất.
4. Làm lại tiêu chí 1 (một đơn VietQR và một đơn Ví ZaloPay ở mỗi bàn là đủ), tiêu chí 3 (bước 1, 2, 5 và 8) và tiêu chí 4 (bước 2 và 3) với tiền thật, bằng tài khoản ví và ngân hàng của nhân viên quán.
5. Hoàn lại toàn bộ tiền thật đã trả bằng chức năng hoàn tiền trong app (tiêu chí 4), ghi ngày tiền về lại tài khoản người trả.
6. Hôm sau, làm tiêu chí 6 cho ngày thử tiền thật, so với trang quản trị thật của cổng và sao kê ngân hàng.
7. Ẩn món thử sau khi xong.

## 12. Phiếu kết quả

In hoặc chép bảng này ra nơi riêng của quán, mỗi bản cập nhật một phiếu.

| Tiêu chí | Ngày | Bản (commit) | Người kiểm | Sandbox | Tiền thật nhỏ | Ghi chú (mã đơn, bàn, giờ) |
|---|---|---|---|---|---|---|
| 1. Ba bàn, ba cách trả | | | | ☐ Đạt ☐ Không | ☐ Đạt ☐ Không | |
| 2. Tắt món trong 5 giây | | | | – | – | |
| 3. Thanh toán thất bại, thoát giữa chừng | | | | ☐ Đạt ☐ Không | ☐ Đạt ☐ Không | |
| 4. Hủy đơn đã trả | | | | ☐ Đạt ☐ Không | ☐ Đạt ☐ Không | |
| 5. Người chưa có trong danh sách | | | | – | – | |
| 6. Doanh thu ngày khớp (mỗi ngày một dòng) | | | | ☐ Khớp ☐ Chưa khớp | ☐ Khớp ☐ Chưa khớp | |
| 7. Công tháng khớp giờ vào, ra ca | | | | – | – | |
| Lệnh `pnpm test:acceptance` | | | lập trình viên | ☐ 0 failed | – | số bước đạt / hỏng / bỏ qua |
