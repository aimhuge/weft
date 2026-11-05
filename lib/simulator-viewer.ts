// The page the pane shows for a watched device (docs/architecture/simulators.md#watching). It plays the device's
// window live through window.weft.simLive (electron/sim-live.cjs): a 30 fps capture of the Simulator or Emulator
// window, cropped to the screen, where a click is a tap and a drag a swipe. With no capture (no Screen Recording
// permission, the window minimized, a page outside the desktop app) it falls back to frame.jpg, which the watch
// loop rewrites every second.
import type { Device } from "./simulator-devices";

// How often the fallback view reloads frame.jpg; the watch loop writes a new one at the same pace.
export const FRAME_MS = 1_000;

export type ScreenSize = { width: number; height: number };

const escape = (s: string) => s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
// A value in the page's script: JSON, with "<" escaped so a name can't close the <script> tag.
const js = (v: unknown) => JSON.stringify(v).replaceAll("<", "\\u003c");

const STYLE = `body{margin:0;min-height:100vh;background:#0f1115;color:#cfd3da;font:13px -apple-system,system-ui;display:flex;flex-direction:column;align-items:center}
header{display:flex;gap:10px;align-items:center;padding:12px 0}
.dot{width:8px;height:8px;border-radius:50%;background:#4ade80;box-shadow:0 0 8px #4ade80}
.off .dot{background:#6b7280;box-shadow:none}
img,#screen{max-height:calc(100vh - 90px);max-width:94vw;border-radius:22px;border:6px solid #23272f;background:#000}
#screen{position:relative;overflow:hidden;display:none;touch-action:none;cursor:pointer}
#screen video{position:absolute}
.live img{display:none}.live #screen{display:block}
.tap{position:absolute;width:26px;height:26px;margin:-13px;border-radius:50%;background:rgba(255,255,255,.45);pointer-events:none;animation:t .4s forwards}
@keyframes t{to{transform:scale(1.8);opacity:0}}
small{color:#7b818c}#n{max-width:420px;text-align:center;padding:8px 14px;color:#9aa3b2}`;

// The page's script: start the capture, fit the crop, turn pointer gestures into taps and swipes, stop at `until`.
const SCRIPT = `const img=document.getElementById("f"),s=document.getElementById("s"),n=document.getElementById("n"),box=document.getElementById("screen"),video=box.querySelector("video");
const bridge=window.weft&&window.weft.simLive;let live=false,stream=null,crop=null;
const WHY={permission:"Live view needs Screen Recording for Weft: System Settings → Privacy & Security → Screen & System Audio Recording, then reopen Weft.","no-window":"Live view needs the device's window on screen (not minimized)."};
function next(){if(Date.now()>UNTIL)return stop();if(!live)img.src="frame.jpg?"+Date.now()}
function stop(){document.body.classList.add("off");s.textContent="paused: ask the thread to watch again";if(stream)stream.getTracks().forEach(t=>t.stop())}
img.onload=()=>setTimeout(next,FRAME_MS);img.onerror=()=>setTimeout(next,FRAME_MS*2);next();
function fit(){const vw=video.videoWidth,vh=video.videoHeight;if(!vw||!vh)return;
 crop={x:0,y:0,w:vw,h:vh,taps:false};
 if(ASPECT){const sh=vw*ASPECT,bar=vh-sh;if(bar>=-vh*.02&&bar<=vh*.15)crop={x:0,y:Math.max(0,bar),w:vw,h:Math.min(sh,vh),taps:true}}
 const k=Math.min((innerWidth*.94-12)/crop.w,(innerHeight-90-12)/crop.h);
 box.style.width=crop.w*k+"px";box.style.height=crop.h*k+"px";
 video.style.width=vw*k+"px";video.style.left=-crop.x*k+"px";video.style.top=-crop.y*k+"px";
 box.style.cursor=crop.taps?"pointer":"default";
 n.textContent=crop.taps?"":"Showing the whole window: in Simulator, turn off Window → Show Device Bezels to tap and swipe here."}
async function start(){if(!bridge)return;
 const src=await bridge.source(NAME).catch(()=>null);
 if(!src||!src.ok){n.textContent=(src&&WHY[src.reason]||"No live capture here.")+" Showing a screenshot a second meanwhile.";return}
 try{stream=await navigator.mediaDevices.getUserMedia({audio:false,video:{mandatory:{chromeMediaSource:"desktop",chromeMediaSourceId:src.id,maxFrameRate:30}}})}catch(e){n.textContent="Live capture failed ("+e.message+"). Showing a screenshot a second.";return}
 video.srcObject=stream;video.onloadedmetadata=()=>{fit();video.play()};video.onresize=fit;addEventListener("resize",fit);
 live=true;document.body.classList.add("live");s.textContent="live · tap and drag on the screen · until "+TIME;
 bridge.input({kind:"live",device:ID}).catch(()=>{});
 stream.getVideoTracks()[0].onended=()=>{live=false;document.body.classList.remove("live");next()}}
let down=null;
const at=e=>{const r=box.getBoundingClientRect();return{x:(e.clientX-r.left)/r.width,y:(e.clientY-r.top)/r.height,px:e.clientX-r.left,py:e.clientY-r.top}};
box.onpointerdown=e=>{if(!crop||!crop.taps)return;box.setPointerCapture(e.pointerId);down={...at(e),t:Date.now()}};
box.onpointerup=e=>{if(!down)return;const up=at(e),ms=Date.now()-down.t,moved=Math.hypot(up.px-down.px,up.py-down.py);
 const dot=document.createElement("i");dot.className="tap";dot.style.left=down.px+"px";dot.style.top=down.py+"px";box.appendChild(dot);setTimeout(()=>dot.remove(),400);
 const body=moved<8?{kind:"tap",device:ID,x:down.x,y:down.y}:{kind:"swipe",device:ID,x:down.x,y:down.y,x2:up.x,y2:up.y,ms:Math.min(1500,Math.max(100,ms))};
 down=null;bridge.input(body).then(r=>{if(r&&!r.ok)n.textContent=r.error}).catch(e=>{n.textContent=e.message})};
if(Date.now()<UNTIL)start();`;

export function viewerHtml(d: Device, until: number, size?: ScreenSize) {
  const time = new Date(until).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const title = `${escape(d.name)}${d.runtime ? ` · ${escape(d.runtime)}` : ""}`;
  // The screen's height over its width, to crop the captured window to the screen; 0 when the size is unknown.
  const aspect = size && size.width > 0 ? size.height / size.width : 0;
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>📱 ${title}</title>
<style>${STYLE}</style></head><body>
<header><span class="dot"></span><b>${title}</b><small id="s">live until ${time}</small></header>
<img id="f" alt="${escape(d.name)}'s screen"><div id="screen"><video muted playsinline></video></div><div id="n"></div>
<script>
const UNTIL=${until},FRAME_MS=${FRAME_MS},ID=${js(d.id)},NAME=${js(d.name)},ASPECT=${aspect},TIME=${js(time)};
${SCRIPT}
</script></body></html>`;
}
