---
{
	"format": "fnb-plan/1",
	"pack": "a797a5c812e8280337968934e6f6a6df8cb195ee90cccc10ad6c12132f35004c",
	"title": "Kế hoạch 90 ngày cho hai cửa hàng",
	"horizon": "90d",
	"language": "vi",
	"kpis": {
		"avg_ticket": { "scope": "ALL", "target": 55000, "baseline": 52314.27, "initiatives": [1, 2] },
		"void_rate": { "target": 0.038, "initiatives": [3] },
		"attach_rate_topping": { "scope": "ALL", "target": 0.34, "initiatives": [4] },
		"invoices": { "scope": "S2", "target": 11000, "initiatives": [5] }
	}
}
---

# Kế hoạch 90 ngày cho hai cửa hàng

## 1. Tóm tắt tình hình

Doanh thu thuần bốn tuần gần nhất của hai cửa hàng đạt 1,23 tỷ đồng [[kpi:ALL/net_revenue:w28]], tăng 4,6% [[kpi:ALL/net_revenue:p28_change]] so với bốn tuần trước đó.

Giá trị trung bình mỗi hóa đơn là 52.314 đ [[kpi:ALL/avg_ticket:w28]] trên 23.600 hóa đơn [[kpi:ALL/invoices:w28]].

## 2. Điểm mạnh và điểm yếu

- Điểm mạnh: tỷ lệ gọi thêm topping là 31,25% [[kpi:ALL/attach_rate_topping:w28]], và món bán chạy nhất chiếm 10,1% doanh thu [[items:ALL/i01:share]].
- Điểm yếu: tỷ lệ giảm giá lên 4,25% [[kpi:ALL/discount_rate:w28]]; tiền mặt chiếm 35,2% [[payments:ALL/cash:share]], giảm 3,2 điểm [[payments:ALL/cash:share_change]].

## 3. Sáng kiến ưu tiên

### Sáng kiến 1: Gợi ý nâng size cho đồ uống bán chạy

- **Căn cứ:** Trà sữa trân châu bán 3.120 ly [[items:ALL/i01:qty]] trong bốn tuần, mang về 124,8 triệu đồng [[items:ALL/i01:net]].
- **Hành động:** Thu ngân gợi ý size L cho mọi đơn trà sữa.
- **Tác động dự kiến:** Ước tính giá trị hóa đơn tăng 5% (52.314 × 1,05 ≈ 54.930 đ).
- **Công sức:** Thấp.
- **KPI:** avg_ticket
- **Cách đọc KPI trên ứng dụng:** Báo cáo Tuần, thẻ Giá trị trung bình mỗi hóa đơn.
- **Bước đầu tiên:** Họp thu ngân vào thứ 2 tuần tới.

### Sáng kiến 2: Đưa combo của S1 sang S2

- **Căn cứ:** Giá trị trung bình mỗi hóa đơn tuần 2026-W45 của S1 là 55.120 đ [[kpi:S1/avg_ticket:w28]], cao hơn S2 với 48.761 đ [[kpi:S2/avg_ticket:w28]].
- **Hành động:** Đưa ba combo bán tốt nhất của S1 lên thực đơn của S2.
- **Tác động dự kiến:** Ước tính S2 tăng 2.000 đ mỗi hóa đơn.
- **Công sức:** Trung bình.
- **KPI:** avg_ticket (ALL)
- **Cách đọc KPI trên ứng dụng:** Báo cáo Tháng, thẻ So sánh cửa hàng.
- **Bước đầu tiên:** Chọn ba combo trong tuần này.

### Sáng kiến 3: Thu hẹp giảm giá tự phát

- **Căn cứ:** Tỷ lệ giảm giá bốn tuần qua là 4,25% [[kpi:ALL/discount_rate:w28]], cao hơn mức 3,98% [[kpi:ALL/discount_rate:p28]] của bốn tuần trước.
- **Hành động:** Chỉ quản lý được duyệt giảm giá ngoài chương trình.
- **Tác động dự kiến:** Ước tính tỷ lệ giảm giá về 3,8%.
- **Công sức:** Thấp.
- **KPI:** void_rate
- **Cách đọc KPI trên ứng dụng:** Khuyến mãi & giảm giá, thẻ Tỷ lệ giảm giá.
- **Bước đầu tiên:** Gửi quy định mới cho các ca.

### Sáng kiến 4: Topping theo mùa

- **Căn cứ:** Tỷ lệ gọi thêm topping giảm 1,76 điểm [[kpi:ALL/attach_rate_topping:p28_change]] xuống 31,25% [[kpi:ALL/attach_rate_topping:w28]].
- **Hành động:** Thêm hai topping theo mùa và giới thiệu ở quầy.
- **Tác động dự kiến:** Ước tính tỷ lệ gọi thêm topping lên 34%.
- **Công sức:** Trung bình.
- **KPI:** attach_rate_topping
- **Cách đọc KPI trên ứng dụng:** Thực đơn, thẻ Tỷ lệ gọi thêm.
- **Bước đầu tiên:** Thử hai topping mới với nhân viên.

### Sáng kiến 5: Kéo khách buổi sáng cho S2

- **Căn cứ:** S2 có 10.400 hóa đơn [[kpi:S2/invoices:w28]] trong bốn tuần; doanh thu tháng 2026-10 của cả hai cửa hàng là 1,29 tỷ đồng [[monthly:ALL/2026-10:net]].
- **Hành động:** Mở bán bánh mì que kèm cà phê từ 6:30 đến 9:00.
- **Tác động dự kiến:** Ước tính thêm 600 hóa đơn trong bốn tuần.
- **Công sức:** Trung bình.
- **KPI:** invoices (S2)
- **Cách đọc KPI trên ứng dụng:** Báo cáo Ngày, thẻ Số hóa đơn.
- **Bước đầu tiên:** Đặt thêm bánh mì que từ tuần sau.

## 4. Kế hoạch 30/60/90 ngày

- 30 ngày: triển khai sáng kiến 1 và 3.
- 60 ngày: triển khai sáng kiến 2 và 4.
- 90 ngày: đánh giá lại và mở rộng sáng kiến 5.

## 5. Thực đơn

Giữ các món nhóm A, xem lại các món nhóm C như bánh mì que.

## 6. Giờ mở cửa và nhân sự

Thêm một thu ngân trong khung 17–19h ở S1.

## 7. Lịch khuyến mãi

Không mở thêm chương trình giảm giá trước ngày 15/12.

## 8. Rủi ro

Khách quen có thể phản ứng khi bớt giảm giá.

## 9. Dữ liệu cần thu thập

Số ghế của S2 và giá vốn của các món mới.

## 10. Giả định

Lượng khách giữ ổn định trong mùa lễ.
