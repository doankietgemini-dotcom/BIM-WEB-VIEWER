# BIM Data Viewer

Ứng dụng web BIM được xây dựng bằng React, TypeScript, Vite, Tailwind CSS và `lucide-react`.

## Chạy ứng dụng

1. Cài Node.js 20.19 trở lên (hoặc 22.12 trở lên).
2. Mở terminal tại thư mục dự án.
3. Chạy `npm install` để cài các gói phụ thuộc.
4. Chạy `npm run dev`.
5. Mở địa chỉ mà Vite hiển thị trong terminal, mặc định là <http://127.0.0.1:5173/>.

## Giao diện hiện tại

- Thanh công cụ mở tệp `.ifc`, đặt lại góc nhìn và bật/tắt chế độ X-Ray.
- Đọc mô hình IFC bằng `web-ifc`, dựng hình bằng Three.js, raycast chọn cấu kiện và tô sáng cấu kiện đang chọn.
- Cây cấu kiện được gom nhóm theo loại IFC, hiển thị số lượng và cho phép ẩn/hiện từng nhóm.
- Bảng Properties hiển thị thông tin cơ bản, kích thước, Property Sets và Element Quantities từ cấu kiện lẫn kiểu cấu kiện; các liên kết Property Sets bị thiếu được bỏ qua an toàn.
- Khung xem 3D hỗ trợ OrbitControls, tự căn giữa mô hình, có lưới tọa độ vô hạn được dựng theo giao điểm tia nhìn với mặt phẳng đáy và điều khiển xoay mô hình theo trục X/Y/Z.
- Dock nổi trong khung 3D hỗ trợ chọn nhiều cấu kiện bằng Ctrl/Shift, cô lập, ẩn, Ghost và khôi phục hiển thị; góc nhìn chuẩn Top/Front/Back/Left/Right/Bottom/Isometric; chuyển Perspective/Orthographic và chụp PNG HD.
- Material Manager giữ vật liệu IFC nguyên bản trên `mesh.userData.originalMaterial`; Highlight, X-Ray và Ghost dùng bản sao có thể khôi phục chính xác.
- IFC được đưa về gốc tọa độ cục bộ trước khi lưu đỉnh hình học dạng Float32 để giữ độ chính xác cho các tệp dùng tọa độ chia sẻ lớn; hướng đứng được chuẩn hóa về trục Z của khung xem.
- Bảng Mặt cắt 3 trục cắt mô hình theo X/Y/Z bằng sáu clipping plane; có thể đảo chiều từng mặt phẳng, bật khung viền vùng cắt và đặt lại vùng cắt.
- Công cụ đo trực tiếp trên bề mặt hỗ trợ khoảng cách (kèm ΔX/ΔY/ΔZ), diện tích đa giác (Enter hoặc đúp chuột để chốt), góc ba điểm và cao độ Z có offset; nhãn theo vị trí 3D, Escape hủy phép đo dở, có thể xóa nét gần nhất hoặc tất cả.
- Bảng Phân tích mô hình cho phép tô màu theo loại IFC, tầng, vật liệu hoặc thuộc tính Pset/Quantity; thuộc tính số dùng heatmap xanh-vàng-đỏ, có chú giải để cô lập nhóm và khôi phục vật liệu gốc.
- Công cụ QA/QC quét lỗi tên, vật liệu, thể tích, mẫu tên và cấu kiện trùng vị trí; hỗ trợ quy tắc tùy chỉnh, làm mờ cấu kiện đạt/tô đỏ cấu kiện lỗi, focus cấu kiện lỗi và xuất báo cáo Excel.
- Các nút toàn màn hình, lưới hiển thị, tìm nhanh cấu kiện (Ctrl/⌘+K), mở rộng cây, chọn cấu kiện và cô lập loại cấu kiện đều có thao tác tương ứng.
- Camera tự giới hạn góc xoay, khoảng zoom và mặt phẳng clipping theo kích thước mô hình để giữ hướng nhìn đứng và giảm rung/nhấp nháy khi tương tác gần.
- BOQ quét vật liệu và chiều dài/diện tích/thể tích từ Property Sets/Element Quantities, lọc theo loại và cộng tổng.
- Xuất báo cáo Excel gồm sheet tổng hợp theo loại cấu kiện và sheet chi tiết; SheetJS được tải động khi xuất.

Các tệp WASM của `web-ifc` được tự động sao chép vào `public/wasm/` sau khi cài dependencies, và trước khi chạy dev server hoặc build.
Tệp `.ifc` được xử lý trong trình duyệt. Tệp IFCZIP/XML chưa được hỗ trợ. Các đại lượng BOQ được lấy theo đơn vị khai báo trong tệp IFC; trường không có dữ liệu được để trống.

## Kiểm tra

- `npm run build` — kiểm tra TypeScript và tạo bản build.
- `npm run lint` — chạy Oxlint.
