---
{
  "format": "fnb-plan/1",
  "pack": "8ad42bf909744d50aba34f9a87c9aa60212b27bd35d8a141d17bc66bba8a3ead",
  "title": "Kế hoạch 90 ngày: tăng giá trị hóa đơn",
  "horizon": "90d",
  "language": "vi",
  "kpis": {
    "avg_ticket": { "scope": "ALL", "baseline": 52314.42, "target": 55000, "initiatives": [1, 2] },
    "size_l_share": { "scope": "ALL", "baseline": 0.3451, "target": 0.38, "initiatives": [1] },
    "discount_rate": { "scope": "S2", "baseline": 0.0425, "target": 0.035, "initiatives": [3] },
    "attach_rate_topping": { "scope": "ALL", "baseline": 0.3125, "target": 0.35, "initiatives": [4] },
    "invoices": { "scope": "S2", "baseline": 11299, "target": 12000, "initiatives": [5] }
  }
}
---

## 1. Tóm tắt tình hình

Doanh thu thuần bốn tuần qua đạt 1,23 tỷ đồng [[kpi:ALL/net_revenue:w28]], tăng 4,6% [[kpi:ALL/net_revenue:p28_change]] so với bốn tuần trước.

Hai cửa hàng có 23.599 hóa đơn [[kpi:ALL/invoices:w28]], giá trị trung bình mỗi hóa đơn là 52.314 đ [[kpi:ALL/avg_ticket:w28]]. Ví điện tử chiếm 56,8% [[payments:ALL/r01:share]] số tiền thu, tiền mặt 35,21% [[payments:ALL/r02:share]].

Chủ quán muốn ưu tiên tăng giá trị hóa đơn, nên hai sáng kiến đầu nhắm vào giá trị mỗi hóa đơn.

## 2. Điểm mạnh và điểm yếu

- Điểm mạnh: món hạng nhất mang về 124,8 triệu đồng [[items:ALL/r01:net]].
- Điểm mạnh: S1 có giá trị trung bình mỗi hóa đơn 55.285 đ [[kpi:S1/avg_ticket:w28]].
- Điểm yếu: tỷ lệ giảm giá của S2 là 4,25% [[kpi:S2/discount_rate:w28]], ước tính cao hơn S1 khoảng 1,2 điểm.
- Điểm yếu: tỷ lệ kèm topping giảm 1,76 điểm [[kpi:ALL/attach_rate_topping:p28_change]] xuống 31,25% [[kpi:ALL/attach_rate_topping:w28]].

## 3. Sáng kiến ưu tiên

### Sáng kiến 1: Gợi ý size L cho đồ uống bán chạy

- **Căn cứ:** Giá trị trung bình mỗi hóa đơn là 52.314 đ [[kpi:ALL/avg_ticket:w28]]; size L chiếm 34,51% [[kpi:ALL/size_l_share:w28]] số ly có size.
- **Hành động:** Thu ngân gợi ý size L cho mọi đơn trà sữa và cà phê, bắt đầu ở S1, suốt giờ mở cửa.
- **Tác động dự kiến:** ước tính giá trị hóa đơn tăng 5%: 52.314 × 1,05 ≈ 54.930 đ; tỷ trọng size L lên khoảng 38%: 34,51% + 3,49 điểm.
- **Công sức:** Thấp: một buổi hướng dẫn thu ngân.
- **KPI:** avg_ticket (mục tiêu 55.000 đ), size_l_share (mục tiêu 38%)
- **Cách đọc KPI trên ứng dụng:** Tab Kế hoạch, hàng avg_ticket và size_l_share; tăng là tốt.
- **Bước đầu tiên:** Họp với thu ngân của S1 trong tuần này.

### Sáng kiến 2: Combo trà sữa kèm bánh mì que

- **Căn cứ:** Trà sữa trân châu và bánh mì que cùng có trong 412 hóa đơn [[pairs:ALL/r01:invoices]], với mức nâng 2,21 [[pairs:ALL/r01:lift]].
- **Hành động:** Bán combo trà sữa trân châu kèm bánh mì que ở cả hai cửa hàng, rẻ hơn mua lẻ 5.000 đ, từ 14h đến 17h.
- **Tác động dự kiến:** ước tính thêm 300 combo mỗi tháng, giảm giá 300 × 5.000 = 1.500.000 đ, bù bằng phần bánh bán thêm; giá trị hóa đơn tăng khoảng 1%: 52.314 × 1,01 ≈ 52.837 đ.
- **Công sức:** Trung bình: cần in bảng giá mới và hướng dẫn thu ngân.
- **KPI:** avg_ticket (mục tiêu 55.000 đ)
- **Cách đọc KPI trên ứng dụng:** Tab Kế hoạch, hàng avg_ticket; tăng là tốt.
- **Bước đầu tiên:** Thử combo ở S1 trong tuần đầu.

### Sáng kiến 3: Thu hẹp giảm giá tự phát ở S2

- **Căn cứ:** Tỷ lệ giảm giá của S2 là 4,25% [[kpi:S2/discount_rate:w28]], cao hơn mức 3,05% [[kpi:S1/discount_rate:w28]] của S1.
- **Hành động:** Ở S2 chỉ quản lý được duyệt giảm giá ngoài chương trình; thu ngân không tự giảm giá ở quầy.
- **Tác động dự kiến:** ước tính tỷ lệ giảm giá của S2 về 3,5%: 4,25% − 0,75 điểm.
- **Công sức:** Thấp: thêm một bước duyệt.
- **KPI:** discount_rate (mục tiêu 3,5% ở S2)
- **Cách đọc KPI trên ứng dụng:** Tab Kế hoạch, hàng discount_rate của S2; giảm là tốt.
- **Bước đầu tiên:** Gửi quy định mới cho các ca ở S2.

### Sáng kiến 4: Topping theo mùa

- **Căn cứ:** Tỷ lệ kèm topping giảm 1,76 điểm [[kpi:ALL/attach_rate_topping:p28_change]] xuống 31,25% [[kpi:ALL/attach_rate_topping:w28]]; ít đá là tùy chọn dùng nhiều nhất với 22,14% [[modifiers:ALL/r01:share]] số dòng.
- **Hành động:** Thêm hai topping theo mùa vào thực đơn của cả hai cửa hàng và giới thiệu ở quầy.
- **Tác động dự kiến:** ước tính tỷ lệ kèm topping lên 35%: 31,25% + 3,75 điểm.
- **Công sức:** Trung bình: cần nguyên liệu và công thức mới.
- **KPI:** attach_rate_topping (mục tiêu 35%)
- **Cách đọc KPI trên ứng dụng:** Tab Kế hoạch, hàng attach_rate_topping; tăng là tốt.
- **Bước đầu tiên:** Thử hai topping mới với nhân viên pha chế.

### Sáng kiến 5: Kéo khách buổi sáng cho S2

- **Căn cứ:** S2 có 11.299 hóa đơn [[kpi:S2/invoices:w28]] trong bốn tuần, ít hơn S1 với 12.300 hóa đơn [[kpi:S1/invoices:w28]]; Chủ Nhật chỉ chiếm 12,08% [[weekday:ALL/sun:share]] doanh thu tuần.
- **Hành động:** Bán bánh mì que kèm cà phê từ 6:30 đến 9:00 ở S2.
- **Tác động dự kiến:** ước tính thêm 25 hóa đơn mỗi ngày: 25 × 28 = 700 hóa đơn trong bốn tuần, tức 11.299 + 700 ≈ 12.000.
- **Công sức:** Trung bình: cần thêm một người ở ca sáng.
- **KPI:** invoices (mục tiêu 12.000 hóa đơn ở S2)
- **Cách đọc KPI trên ứng dụng:** Tab Kế hoạch, hàng invoices của S2; tăng là tốt.
- **Bước đầu tiên:** Đặt thêm bánh mì que cho S2 từ tuần sau.

## 4. Kế hoạch 30/60/90 ngày

- 30 ngày: sáng kiến 1 và 3 chạy ở cả hai cửa hàng.
- 60 ngày: thêm sáng kiến 2 và 4, rồi xem lại từng KPI.
- 90 ngày: giữ sáng kiến 5 nếu số hóa đơn của S2 tăng.

## 5. Thực đơn

- Giữ và đẩy: trà sữa trân châu, cà phê sữa đá.
- Đổi: thêm hai topping theo mùa.
- Xem lại: bánh mì que nếu combo bán chậm.

## 6. Giờ mở cửa và nhân sự

Thêm một thu ngân ở S1 trong khung 17–19h, giờ đông nhất; thêm một người ở ca sáng của S2 khi bắt đầu sáng kiến 5.

## 7. Lịch khuyến mãi

- Từ 2026-12-20: combo của sáng kiến 2, mức giảm thấp hơn giới hạn trong `context.rules`.
- Tết Dương lịch 2027-01-01 và Tết từ 2027-02-05: không giảm giá thêm, chỉ bán combo.

## 8. Rủi ro

- Khách quen của S2 có thể phản ứng khi bớt giảm giá; dấu hiệu sớm: số hóa đơn của S2 giảm hai tuần liền.
- Topping mới có thể làm chậm quầy giờ cao điểm; dấu hiệu sớm: số hóa đơn giờ cao điểm giảm.

## 9. Dữ liệu cần thu thập

- Giá vốn món của S1 và S2 (`item_costs`): cài đặt `settings_costs`.
- Phí thanh toán (`fee_rates`): cài đặt `settings_fees`.
- Mục tiêu tháng của S2 (`target/S2`): cài đặt `settings_targets`.

## 10. Giả định

- Lượng khách giữ như bốn tuần qua trong mùa lễ.
- Các ước tính tác động dùng giá trị bốn tuần gần nhất của gói.
