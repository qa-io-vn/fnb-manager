---
{
	"format": "fnb-plan/1",
	"pack": "d491ef2908796fa6856ac737c87ccdd2efda7bacd9efc949b0987c735728f69a",
	"title": "Kế hoạch mẫu, tạo tự động để minh họa",
	"horizon": "90d",
	"language": "vi",
	"kpis": {
		"avg_ticket": { "scope": "ALL", "baseline": 91401.96, "target": 95972, "initiatives": [1, 4] },
		"attach_rate_topping": { "scope": "ALL", "baseline": 0.228824, "target": 0.2403, "initiatives": [2, 5] },
		"discount_rate": { "scope": "ALL", "baseline": 0.02052, "target": 0.0195, "initiatives": [3] }
	}
}
---

# Kế hoạch mẫu, tạo tự động để minh họa

Ứng dụng tạo kế hoạch này tự động từ chính các ô của gói dữ liệu, chỉ để minh họa định dạng; đây không phải lời khuyên kinh doanh.

## 1. Tóm tắt tình hình

- Giá trị trung bình mỗi hóa đơn bốn tuần gần nhất là 91.402 đ [[kpi:ALL/avg_ticket:w28]], giảm 0,43% [[kpi:ALL/avg_ticket:p28_change]] so với bốn tuần trước.
- Tỷ lệ kèm topping bốn tuần gần nhất là 22,88% [[kpi:ALL/attach_rate_topping:w28]], giảm 1,1 điểm [[kpi:ALL/attach_rate_topping:p28_change]] so với bốn tuần trước.
- Tỷ lệ giảm giá bốn tuần gần nhất là 2,05% [[kpi:ALL/discount_rate:w28]], giảm 0,13 điểm [[kpi:ALL/discount_rate:p28_change]] so với bốn tuần trước.

## 2. Điểm mạnh và điểm yếu

- Điểm yếu: Giá trị trung bình mỗi hóa đơn chưa đi đúng hướng so với bốn tuần trước; các cửa sổ bốn tuần gần đây dao động từ 91.397 đ [[kpi:ALL/avg_ticket:lo]] đến 91.854 đ [[kpi:ALL/avg_ticket:hi]].
- Điểm yếu: Tỷ lệ kèm topping chưa đi đúng hướng so với bốn tuần trước; các cửa sổ bốn tuần gần đây dao động từ 22,88% [[kpi:ALL/attach_rate_topping:lo]] đến 24,41% [[kpi:ALL/attach_rate_topping:hi]].
- Điểm mạnh: Tỷ lệ giảm giá đi đúng hướng so với bốn tuần trước; các cửa sổ bốn tuần gần đây dao động từ 2,01% [[kpi:ALL/discount_rate:lo]] đến 2,22% [[kpi:ALL/discount_rate:hi]].

## 3. Sáng kiến ưu tiên

### Sáng kiến 1: Đẩy mạnh món dẫn đầu

- **Căn cứ:** Món đứng đầu doanh thu bốn tuần qua mang về 13.415.000 đ [[items:ALL/r01:net]].
- **Hành động:** Đặt Matcha Latte ở đầu thực đơn và gợi ý một món thêm mỗi khi khách gọi món này.
- **Tác động dự kiến:** Ước tính Giá trị trung bình mỗi hóa đơn đạt 95.972 đ vào cuối kỳ, so với 91.402 đ hiện nay.
- **Công sức:** Thấp: chỉ đổi cách trình bày thực đơn và lời gợi ý của thu ngân.
- **KPI:** avg_ticket
- **Cách đọc KPI trên ứng dụng:** Tab Kế hoạch, hàng avg_ticket; tăng là tốt.
- **Bước đầu tiên:** Chọn món thêm để gợi ý và in lại thực đơn.

### Sáng kiến 2: Kéo khách vào ngày vắng nhất

- **Căn cứ:** Ngày vắng nhất trong tuần chỉ chiếm 10,24% [[weekday:ALL/mon:share]] doanh thu tuần.
- **Hành động:** Chạy một ưu đãi nhỏ vào Thứ Hai và báo trước cho khách quen.
- **Tác động dự kiến:** Ước tính Tỷ lệ kèm topping đạt 24,03% vào cuối kỳ, so với 22,88% hiện nay.
- **Công sức:** Trung bình: cần chuẩn bị ưu đãi và nhắc khách.
- **KPI:** attach_rate_topping
- **Cách đọc KPI trên ứng dụng:** Tab Kế hoạch, hàng attach_rate_topping; tăng là tốt.
- **Bước đầu tiên:** Chọn ưu đãi và ghi lên bảng ở quầy.

### Sáng kiến 3: Thanh toán nhanh hơn ở quầy

- **Căn cứ:** Phương thức thanh toán dùng nhiều nhất chiếm 55,36% [[payments:ALL/r01:share]] số tiền thu.
- **Hành động:** Đặt mã QR ở mọi quầy và nhắc thu ngân mời khách quét mã.
- **Tác động dự kiến:** Ước tính Tỷ lệ giảm giá đạt 1,95% vào cuối kỳ, so với 2,05% hiện nay.
- **Công sức:** Thấp: chỉ cần in mã và nhắc ca làm.
- **KPI:** discount_rate
- **Cách đọc KPI trên ứng dụng:** Tab Kế hoạch, hàng discount_rate; giảm là tốt.
- **Bước đầu tiên:** In mã QR cho mọi quầy.

### Sáng kiến 4: Mở rộng nhóm món dẫn đầu

- **Căn cứ:** Nhóm món dẫn đầu chiếm 17,82% [[categories:ALL/r01:share]] doanh thu bốn tuần qua.
- **Hành động:** Thử thêm một món mới trong nhóm món dẫn đầu suốt bốn tuần.
- **Tác động dự kiến:** Ước tính Giá trị trung bình mỗi hóa đơn đạt 95.972 đ vào cuối kỳ, so với 91.402 đ hiện nay.
- **Công sức:** Trung bình: cần thử công thức và đào tạo pha chế.
- **KPI:** avg_ticket
- **Cách đọc KPI trên ứng dụng:** Tab Kế hoạch, hàng avg_ticket; tăng là tốt.
- **Bước đầu tiên:** Chọn món mới và thử công thức với nhân viên.

### Sáng kiến 5: Theo dõi tiến độ doanh thu mỗi tuần

- **Căn cứ:** Doanh thu thuần từ đầu tháng đến nay đạt 184.132.000 đ [[month_to_date:ALL:net]].
- **Hành động:** Đầu mỗi tuần xem lại doanh thu tuần trước trên báo cáo Tuần và điều chỉnh các sáng kiến.
- **Tác động dự kiến:** Ước tính Tỷ lệ kèm topping đạt 24,03% vào cuối kỳ, so với 22,88% hiện nay.
- **Công sức:** Thấp: mười phút mỗi tuần.
- **KPI:** attach_rate_topping
- **Cách đọc KPI trên ứng dụng:** Tab Kế hoạch, hàng attach_rate_topping; tăng là tốt.
- **Bước đầu tiên:** Đặt lịch nhắc xem báo cáo Tuần.

## 4. Kế hoạch 30/60/90 ngày

- Sau 30 ngày: sáng kiến 1 và 2 đã chạy.
- Sau 60 ngày: thêm sáng kiến 3 và 4.
- Sau 90 ngày: thêm sáng kiến 5 và so từng KPI với mục tiêu.

## 5. Thực đơn

Giữ các món dẫn đầu, xem lại các món bán chậm sau bốn tuần.

## 6. Giờ mở cửa và nhân sự

Bố trí thêm người vào giờ cao điểm theo bảng giờ của gói; giữ ca hiện tại ở giờ vắng.

## 8. Rủi ro

Ưu đãi có thể kéo giá trị hóa đơn xuống; xem KPI mỗi tuần và dừng sớm nếu đi sai hướng.

## 9. Dữ liệu cần thu thập

- `fee_rates/S1`
- `fee_rates/S2`
- `item_costs/S1`
- `item_costs/S2`
- `no_customer_identity/ALL`

## 10. Giả định

- Đây là kế hoạch mẫu: mục tiêu mỗi KPI lệch 5% so với giá trị bốn tuần gần nhất theo hướng tốt.
- Lượng khách và giá bán giữ như bốn tuần gần nhất.
