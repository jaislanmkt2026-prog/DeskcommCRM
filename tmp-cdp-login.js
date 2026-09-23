const WebSocket = require("ws");
const ws = new WebSocket(process.argv[2]);
let id = 1;
const pending = new Map();
function send(method, params = {}) {
  const mid = id++;
  return new Promise((resolve, reject) => {
    pending.set(mid, { resolve, reject });
    ws.send(JSON.stringify({ id: mid, method, params }));
  });
}
ws.on("message", (data) => {
  const msg = JSON.parse(data.toString());
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id);
    pending.delete(msg.id);
    if (msg.error) reject(new Error(JSON.stringify(msg.error)));
    else resolve(msg.result);
  }
});
ws.on("open", async () => {
  try {
    await send("Page.enable");
    await send("Runtime.enable");
    console.log("NAVIGATING to http://localhost/login");
    await send("Page.navigate", { url: "http://localhost/login" });
    await new Promise(r => setTimeout(r, 3000));

    const emailResult = await send("Runtime.evaluate", {
      expression: `(() => { const el = document.querySelector('input[type="email"], input[name="email"]'); if (!el) return "NO_EMAIL_INPUT"; el.value = "staging@deskcomm.local"; el.dispatchEvent(new Event("input", {bubbles:true})); return "ok"; })()`
    });
    console.log("EMAIL_SET:", emailResult.result?.value);
    await new Promise(r => setTimeout(r, 500));

    const pwResult = await send("Runtime.evaluate", {
      expression: `(() => { const el = document.querySelector('input[type="password"], input[name="password"]'); if (!el) return "NO_PW_INPUT"; el.value = "staging"; el.dispatchEvent(new Event("input", {bubbles:true})); return "ok"; })()`
    });
    console.log("PW_SET:", pwResult.result?.value);
    await new Promise(r => setTimeout(r, 500));

    const clickResult = await send("Runtime.evaluate", {
      expression: `(() => { const btn = document.querySelector('button[type="submit"], button'); if (!btn) return "NO_BUTTON"; btn.click(); return "clicked"; })()`
    });
    console.log("SUBMIT:", clickResult.result?.value);
    await new Promise(r => setTimeout(r, 4000));

    const urlResult = await send("Runtime.evaluate", { expression: "window.location.href" });
    console.log("CURRENT_URL:", urlResult.result?.value);

    const bodyResult = await send("Runtime.evaluate", { expression: "document.body?.innerText?.substring(0, 800)" });
    console.log("BODY_TEXT:", bodyResult.result?.value);

    const hasError = bodyResult.result?.value?.includes("Algo deu errado") || bodyResult.result?.value?.includes("bfa18c52");
    if (hasError) {
      console.log("RESULT: ERROR_STILL_PRESENT");
    } else if (urlResult.result?.value?.includes("/app")) {
      console.log("RESULT: LOGIN_SUCCESS");
    } else {
      console.log("RESULT: UNKNOWN_STATE");
    }

    ws.close();
    process.exit(0);
  } catch (e) {
    console.error("ERROR:", e.message);
    ws.close();
    process.exit(1);
  }
});
ws.on("error", (e) => { console.error("WS_ERROR:", e.message); process.exit(1); });