import { money } from "./account-extras.js";

async function resolvePurchase(api, id, control) {
  let state = "UNAVAILABLE";
  for (const delay of [0, 1000, 2000]) {
    if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
    if (!control.isConnected) return state;
    try {
      const result = await api("purchase-status/" + encodeURIComponent(id), {
        signal: AbortSignal.timeout(5000),
      });
      state = result.status;
      if (state === "PAID") return state;
    } catch {
      state = "UNAVAILABLE";
    }
  }
  return state;
}

export async function handlePurchase(
  { api, json, notice, render, getSelectedMedia },
  control,
) {
  const { action, id, next } = control.dataset;
  const checking = action === "check-purchase";
  if (
    !checking &&
    !window.confirm(`Dùng ${money(next)} từ số dư demo để mua tác phẩm này?`)
  )
    return;
  const status = control.nextElementSibling;
  control.disabled = true;
  status.textContent = checking
    ? "Đang kiểm tra trạng thái đơn…"
    : "Đang gửi yêu cầu mua thử…";
  try {
    let result;
    if (!checking) {
      try {
        result = await json("test-purchase/" + encodeURIComponent(id), "POST", {
          price: Number(next),
        });
      } catch (error) {
        if (error.status >= 400 && error.status < 500 && error.status !== 408)
          throw error;
      }
    }
    if (result?.status !== "PAID") {
      if (!control.isConnected) return;
      status.textContent = "Đang xác nhận giao dịch với Commerce…";
      const state = await resolvePurchase(api, id, control);
      if (!control.isConnected) return;
      if (state !== "PAID") {
        const canRetry = state === "UNCONFIRMED";
        status.textContent = canRetry
          ? "Chưa thấy quyền mua được cấp. Bạn có thể thử lại với cùng tài khoản."
          : "Chưa kiểm tra được kết quả. Hãy kiểm tra trạng thái trước khi gửi yêu cầu mua mới.";
        control.dataset.action = canRetry ? "test-purchase" : "check-purchase";
        control.textContent = canRetry ? "Mua thử lại" : "Kiểm tra trạng thái";
        return;
      }
    }
    if (!control.isConnected) return;
    const { selected, firstPremium } = getSelectedMedia();
    notice("Đã mua bằng số dư demo. Bạn có thể xem và tải tệp đã mở khóa.");
    await render({
      selectedMediaId: (selected?.premium ? selected : firstPremium)?.id,
    });
  } catch (error) {
    if (control.isConnected) status.textContent = error.message;
  } finally {
    control.disabled = false;
  }
}
