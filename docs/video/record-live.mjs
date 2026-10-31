// Records the live segment: public Twitch popout chat (left) + Backlog control room (right).
// Chat messages are sent by hand from the streamer's own account while this runs.
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
const require = createRequire(import.meta.url);
const { chromium } = require("C:/Users/ankit/.vscode/extensions/danielsanmedium.dscodegpt-3.24.79/standalone/node_modules/patchright");
const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const vdir = path.join(here, "raw", "live"); fs.mkdirSync(vdir, { recursive: true });
const API = "http://127.0.0.1:3001";
const browser = await chromium.launch({ headless: true, channel: "chrome" });
const chatCtx = await browser.newContext({ viewport: { width: 400, height: 720 }, recordVideo: { dir: vdir, size: { width: 400, height: 720 } } });
const ctlCtx = await browser.newContext({ viewport: { width: 880, height: 720 }, recordVideo: { dir: vdir, size: { width: 880, height: 720 } } });
const chat = await chatCtx.newPage(); const ctl = await ctlCtx.newPage();
const t0 = Date.now(); const marks = {}; const mark = (k) => { marks[k] = (Date.now() - t0) / 1000; console.log(k, marks[k]); };
await Promise.all([chat.goto("https://www.twitch.tv/popout/ankithbuilds/chat", { waitUntil: "domcontentloaded" }), ctl.goto(API + "/control")]);
await chat.waitForTimeout(6000);
// dismiss any consent banner on the public chat page
for (const label of ["Reject", "Reject All", "Decline"]) { const b = chat.getByRole("button", { name: label }); if (await b.count()) { await b.first().click().catch(() => {}); } }
mark("ready"); fs.writeFileSync(path.join(here, "raw", "READY"), String(Date.now()));
const q = async () => (await fetch(API + "/api/queue")).json();
const deadline = Date.now() + 240000;
for (;;) {
  const s = await q(); const kb = s.items.find((i) => /keyboard/i.test(i.normalized));
  if (kb && kb.count >= 3 && s.items.length >= 3 && (s.stats?.ignored ?? 0) >= 2) break;
  if (Date.now() > deadline) throw new Error("timed out waiting for chat");
  await new Promise((r) => setTimeout(r, 1000));
}
mark("queueFull"); await ctl.waitForTimeout(6000);
await ctl.locator(".wordings").first().scrollIntoViewIfNeeded(); mark("wordings"); await ctl.waitForTimeout(5000);
await ctl.getByRole("button", { name: /Send in chat/ }).first().click(); mark("send");
await chat.getByText("semicolon needs a hard press").first().waitFor({ timeout: 30000 }); mark("botReply");
await chat.waitForTimeout(6000); mark("end");
const v1 = chat.video(); const v2 = ctl.video(); await chatCtx.close(); await ctlCtx.close();
const out = { chat: await v1.path(), control: await v2.path(), marks };
fs.writeFileSync(path.join(here, "marks-live.json"), JSON.stringify(out, null, 2)); console.log(JSON.stringify(out));
await browser.close();
