// Records the busy-chat segment: a 400-message synthetic replay classified live, control room + OBS overlay.
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
const require = createRequire(import.meta.url);
const { chromium } = require("C:/Users/ankit/.vscode/extensions/danielsanmedium.dscodegpt-3.24.79/standalone/node_modules/patchright");
const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const vdir = path.join(here, "raw", "replay"); fs.mkdirSync(vdir, { recursive: true });
const API = "http://127.0.0.1:3002";
const browser = await chromium.launch({ headless: true, channel: "chrome" });
const ctlCtx = await browser.newContext({ viewport: { width: 1280, height: 720 }, recordVideo: { dir: vdir, size: { width: 1280, height: 720 } } });
const ovCtx = await browser.newContext({ viewport: { width: 1280, height: 720 }, recordVideo: { dir: vdir, size: { width: 1280, height: 720 } } });
const ctl = await ctlCtx.newPage(); const ov = await ovCtx.newPage();
await Promise.all([ctl.goto(API + "/control"), ov.goto(API + "/overlay")]);
// stand-in for a game scene behind the transparent OBS overlay
await ov.addStyleTag({ content: "html,body{background:radial-gradient(circle at 70% 60%,#3b4a2f 0,#1d2618 45%,#0e130c 100%) !important}" });
await ctl.waitForTimeout(55000);
const v1 = ctl.video(); const v2 = ov.video(); await ctlCtx.close(); await ovCtx.close();
const out = { control: await v1.path(), overlay: await v2.path() };
fs.writeFileSync(path.join(here, "marks-replay.json"), JSON.stringify(out, null, 2)); console.log(JSON.stringify(out));
await browser.close();
