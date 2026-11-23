document.addEventListener("DOMContentLoaded", () => {
  document.title = "میری ایران؟ | رايح لإيران؟";

  const banner = document.createElement("div");
  banner.textContent = "میری ایران؟ ✈️ — نسخة استعراضية فقط، لا تدعم الحجوزات أو المدفوعات الحقيقية";
  banner.style.cssText = "background:#f5bd55;color:#17324d;padding:14px;text-align:center;font-weight:bold;position:relative;z-index:9999";
  document.body.prepend(banner);

  document.querySelectorAll("button, input, select, textarea").forEach(el => {
    el.disabled = true;
    el.style.cursor = "not-allowed";
  });

  document.addEventListener("submit", event => {
    event.preventDefault();
    event.stopImmediatePropagation();
  }, true);

  document.addEventListener("click", event => {
    const link = event.target.closest("a");
    if (link) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  }, true);
});