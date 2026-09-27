(() => {
"use strict";

/* ---------- qismein (supabase/schema.sql ki list se milni chahiye) ---------- */
const CATS = {
  closure: [
    {id:"khudai", t:"Khudai / tameer", d:"Orange Line, pipe, cable", g:"K"},
    {id:"paani", t:"Barish ka paani", d:"Sarak ya underpass doobi", g:"P"},
    {id:"band", t:"Rasta band", d:"Container, dharna, VIP", g:"B"},
    {id:"jam", t:"Shadeed rush", d:"Gaariyan ruki hui", g:"J"},
    {id:"hadsa", t:"Hadsa", d:"Accident, gaari kharab", g:"H"},
  ],
  broken: [
    {id:"gaddha", t:"Gaddha", d:"Sarak mein gaddha", g:"G"},
    {id:"gutter", t:"Khula gutter", d:"Dhakkan ghayab", g:"O"},
    {id:"sewer", t:"Gutter ubal raha", d:"Ganda paani sarak pe", g:"S"},
    {id:"light", t:"Street light band", d:"Andhera", g:"L"},
    {id:"kachra", t:"Kachra", d:"Dher laga hai", g:"C"},
    {id:"aur", t:"Kuch aur", d:"Note mein likhein", g:"?"},
  ],
};
const CAT = {}; for (const k in CATS) for (const c of CATS[k]) CAT[c.id] = {...c, kind:k};
const DURS = [
  {id:"2h", t:"2 ghante", ms:2*3600e3},
  {id:"6h", t:"6 ghante", ms:6*3600e3},
  {id:"day", t:"Aaj raat tak", ms:null},
  {id:"3d", t:"3 din", ms:3*86400e3},
];
const DAY = 86400e3;
const CFG = window.RASTA_CONFIG || {};

/* ---------- chhote helpers ---------- */
const $ = s => document.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
function ago(ms){
  const m = Math.round((Date.now()-ms)/60000);
  if (m < 1) return "abhi abhi";
  if (m < 60) return m + " minute pehle";
  const h = Math.round(m/60); if (h < 24) return h + " ghante pehle";
  return Math.round(h/24) + " din pehle";
}
function left(ms){
  const m = Math.max(0, Math.round((ms-Date.now())/60000));
  if (m < 60) return m + " minute";
  const h = Math.round(m/60); if (h < 48) return h + " ghante";
  return Math.round(h/24) + " din";
}
function toast(t){ const el=$("#toast"); el.textContent=t; el.hidden=false; clearTimeout(toast.t); toast.t=setTimeout(()=>el.hidden=true,2600); }
function banner(t){ const b=$("#banner"); b.textContent=t||""; b.hidden=!t; if (t) $("#key").hidden = true; }
function dist(a,b){ // metres
  const R=6371e3, r=Math.PI/180, dLat=(b.lat-a.lat)*r, dLng=(b.lng-a.lng)*r;
  const x=Math.sin(dLat/2)**2+Math.cos(a.lat*r)*Math.cos(b.lat*r)*Math.sin(dLng/2)**2;
  return 2*R*Math.asin(Math.sqrt(x));
}

/* ---------- report ki haalat ----------
   band rasta: waqt guzarne pe ya 2 logon (ya reporter) ke "khul gaya" kehne pe gayab
   toota hua: 2 logon ya reporter ke "theek ho gaya" kehne pe hara (agar "abhi bhi toota" kam hon);
              theek hone ke 7 din baad naqshe se hat jata hai, fehrist mein rehta hai */
function state(r){
  if (r.kind === "closure") return (r.cleared >= 2 || r.byCleared || Date.now() > r.expiresAt) ? "gone" : "closure";
  const fixed = (r.fixed >= 2 || r.byFixed) && r.fixed > r.still;
  if (!fixed) return "broken";
  return Date.now() - r.fixedAt > 7*DAY ? "fixed-old" : "fixed";
}

/* ---------- store: Supabase ---------- */
const store = {
  sb: null, uid: null, canWrite: false, list: [], myVotes: new Set(), listeners: [],
  onChange(f){ this.listeners.push(f); },
  emit(){ for (const f of this.listeners) f(); },
  photoUrl(path){ return this.sb.storage.from("photos").getPublicUrl(path).data.publicUrl; },

  async init(){
    if (!CFG.supabaseUrl || !CFG.supabaseAnonKey) { banner("Setup adhoora hai: config.js mein Supabase ka URL aur key daalein."); return; }
    this.sb = supabase.createClient(CFG.supabaseUrl, CFG.supabaseAnonKey, {auth:{persistSession:true, autoRefreshToken:true}});
    // har phone ki aik gumnaam pehchaan (login ke baghair); isi se votes aur "apni report" chalti hai
    let {data:{session}} = await this.sb.auth.getSession();
    if (!session) {
      const {data, error} = await this.sb.auth.signInAnonymously();
      if (error) console.warn("anonymous sign-in", error);
      session = data && data.session;
    }
    this.uid = session ? session.user.id : null;
    this.canWrite = !!this.uid;
    if (!this.uid) banner("Is waqt sirf dekh sakte hain: report ke liye pehchaan nahi ban saki. Page reload karein.");
    await this.load();
    // nayi report ya hatayi gayi report: sab ke naqshe pe foran
    this.sb.channel("reports").on("postgres_changes", {event:"*", schema:"public", table:"reports"}, () => this.reloadSoon()).subscribe();
    // doosron ke votes live nahi aate (privacy), is liye har minute taaza karo
    setInterval(() => this.load(), 60000);
    document.addEventListener("visibilitychange", () => { if (!document.hidden) this.load(); });
  },
  reloadSoon(){ clearTimeout(this.t); this.t = setTimeout(() => this.load(), 400); },
  async load(){
    const [stats, mine] = await Promise.all([
      this.sb.from("report_stats").select("*").order("created_at", {ascending:false}).limit(1000),
      this.uid ? this.sb.from("votes").select("report_id,kind") : Promise.resolve({data:[]}),
    ]);
    if (stats.error) { banner("Reports load nahi ho sakin. Internet check kar ke page reload karein."); console.warn(stats.error); return; }
    if ($("#banner").textContent.startsWith("Reports load")) banner("");
    this.myVotes = new Set((mine.data || []).map(v => v.report_id + ":" + v.kind));
    this.list = stats.data.map(r => ({
      id:r.id, kind:r.kind, cat:r.cat, lat:r.lat, lng:r.lng, note:r.note, photo:r.photo_path ? this.photoUrl(r.photo_path) : null,
      photoPath:r.photo_path, createdAt:Date.parse(r.created_at), expiresAt:r.expires_at ? Date.parse(r.expires_at) : null,
      mine:r.mine, metoo:+r.metoo, fixed:+r.fixed, still:+r.still, cleared:+r.cleared,
      fixedAt:r.fixed_at ? Date.parse(r.fixed_at) : 0, byFixed:r.by_fixed, byCleared:r.by_cleared,
    }));
    this.emit();
  },
  voted(r, k){ return this.myVotes.has(r.id + ":" + k); },
  async add(d, photoBlob){
    let photo_path = null;
    if (photoBlob) {
      photo_path = this.uid + "/" + crypto.randomUUID() + ".jpg";
      const up = await this.sb.storage.from("photos").upload(photo_path, photoBlob, {contentType:"image/jpeg"});
      if (up.error) throw up.error;
    }
    const {error} = await this.sb.from("reports").insert({kind:d.kind, cat:d.cat, lat:d.lat, lng:d.lng, note:d.note,
      expires_at:d.expiresAt ? new Date(d.expiresAt).toISOString() : null, photo_path});
    if (error) { if (photo_path) this.sb.storage.from("photos").remove([photo_path]); throw error; }
    await this.load();
  },
  async vote(r, kind, on){
    const q = on
      ? this.sb.from("votes").insert({report_id:r.id, kind})
      : this.sb.from("votes").delete().match({report_id:r.id, kind, user_id:this.uid});
    const {error} = await q;
    if (error && error.code !== "23505") throw error; // 23505: vote pehle se tha
  },
  async remove(r){
    const {error} = await this.sb.from("reports").delete().eq("id", r.id);
    if (error) throw error;
    if (r.photoPath) this.sb.storage.from("photos").remove([r.photoPath]);
    await this.load();
  },
};
function writeError(e){
  const m = (e && (e.message || "")) + "";
  if (m.includes("rate_limit")) return "Aik ghante mein 10 se zyada reports nahi bhej sakte. Thori der baad koshish karein.";
  if (m.toLowerCase().includes("fetch")) return "Internet nahi mil raha. Connection check kar ke dobara bhejein.";
  return "Save nahi hua. Dobara koshish karein.";
}

/* ---------- naqsha ---------- */
const map = L.map("map", {zoomControl:false, minZoom:11, maxZoom:19, zoomSnap:0.5,
  maxBounds:[[31.20,72.80],[31.65,73.40]], maxBoundsViscosity:0.8});
map.attributionControl.setPrefix(false);
L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {maxZoom:19,
  attribution:'&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>'}).addTo(map);
map.fitBounds([[31.37,73.00],[31.47,73.16]]);

// Orange Line ke raste wali sarkein (OSM mein jin ke naam mile)
const decode = f => { const o=[]; for (let i=0;i<f.length;i+=2) o.push([31+f[i]/1e5, 72+f[i+1]/1e5]); return o; };
const orangeLayer = L.layerGroup().addTo(map);
for (const seg of (window.ORANGE_LINE || [])) L.polyline(decode(seg), {color:"#E2621A", weight:9, opacity:.35, interactive:false, lineCap:"round"}).addTo(orangeLayer);
try { if (localStorage.getItem("rf.keyHidden")) $("#key").hidden = true; } catch {}
$("#key-x").onclick = () => { $("#key").hidden = true; try { localStorage.setItem("rf.keyHidden", "1"); } catch {} };

$("#zin").onclick = () => map.zoomIn();
$("#zout").onclick = () => map.zoomOut();

/* ---------- GPS ---------- */
let meMarker = null;
function locate(zoom){
  return new Promise(res => {
    if (!navigator.geolocation) { toast("Is browser mein location nahi milti"); return res(null); }
    navigator.geolocation.getCurrentPosition(p => {
      const ll = [p.coords.latitude, p.coords.longitude];
      if (!L.latLngBounds([[31.20,72.80],[31.65,73.40]]).contains(ll)) { toast("Aap Faisalabad se bahar lag rahe hain"); return res(null); }
      if (meMarker) meMarker.setLatLng(ll); else meMarker = L.circleMarker(ll, {radius:8, color:"#fff", weight:3, fillColor:"#2F6FD6", fillOpacity:1}).addTo(map);
      map.setView(ll, Math.max(map.getZoom(), zoom || 16));
      res(ll);
    }, err => { toast(err.code === 1 ? "Location ki ijazat nahi mili. Naqsha hila kar jagah chunein." : "Location nahi mil saki"); res(null); },
    {enableHighAccuracy:true, timeout:10000, maximumAge:60000});
  });
}
$("#locate").onclick = () => locate(16);

/* ---------- pins aur fehrist ---------- */
let filter = "all", selected = null, sheetView = null;
const markers = new Map();
function visible(r){
  const s = state(r);
  if (s === "gone") return false;
  if (s === "fixed-old") return filter === "fixed";
  return filter === "all" || s === filter;
}
function pinIcon(r, s){
  const g = (CAT[r.cat] || {g:"?"}).g;
  const html = `<div class="pin ${s}${selected===r.id?" sel":""}"><b>${g}</b></div>`;
  return {html, icon: L.divIcon({html, className:"", iconSize:[30,30], iconAnchor:[4,30]})};
}
function render(){
  const counts = {closure:0, broken:0, fixed:0};
  for (const r of store.list) { const s = state(r).replace("-old", ""); if (counts[s] !== undefined) counts[s]++; }
  $("#n-closure").textContent = counts.closure; $("#n-broken").textContent = counts.broken; $("#n-fixed").textContent = counts.fixed;
  $("#n-all").textContent = counts.closure + counts.broken + counts.fixed;
  const keep = new Set();
  for (const r of store.list) {
    if (!visible(r)) continue;
    keep.add(r.id);
    const {html, icon} = pinIcon(r, state(r).replace("-old", ""));
    let m = markers.get(r.id);
    if (!m) { m = L.marker([r.lat, r.lng], {icon, keyboard:true, title:(CAT[r.cat]||{}).t||""}).addTo(map); m.on("click", () => openReport(r.id)); markers.set(r.id, m); }
    else if (m._html !== html) m.setIcon(icon);
    m._html = html;
  }
  for (const [id, m] of markers) if (!keep.has(id)) { m.remove(); markers.delete(id); }
  $("#btn-report").disabled = !store.canWrite;
  if (sheetView === "report" && selected) openReport(selected, true);
  if (sheetView === "list") openList();
}
store.onChange(render);
setInterval(render, 60000); // band raste waqt pe khud gayab hon

document.querySelectorAll(".chip").forEach(b => b.onclick = () => {
  filter = b.dataset.f;
  document.querySelectorAll(".chip").forEach(x => x.setAttribute("aria-pressed", String(x === b)));
  render();
});

/* ---------- sheet ---------- */
function openSheet(title, html, view){ sheetView = view; $("#sheet-title").textContent = title; $("#sheet-b").innerHTML = html; $("#sheet").hidden = false; }
function closeSheet(){
  $("#sheet").hidden = true; sheetView = null;
  if (!$("#picker").hidden) endPick();
  if (selected) { selected = null; render(); }
}
$("#sheet-x").onclick = closeSheet;
document.addEventListener("keydown", e => { if (e.key === "Escape" && !$("#sheet").hidden) closeSheet(); });

function openReport(id, quiet){
  const r = store.list.find(x => x.id === id);
  if (!r) { if (sheetView === "report") closeSheet(); return; }
  const first = selected !== id;
  selected = id; sheetView = "report";
  if (!quiet && first) render();
  const s = state(r).replace("-old", ""), c = CAT[r.cat] || {t:"Masla", kind:r.kind};
  const dis = store.canWrite ? "" : " disabled";
  const days = Math.max(0, Math.floor((Date.now()-r.createdAt)/DAY));
  let top;
  if (s === "closure") top = `<span class="status closure">${esc(c.t)}</span><div class="muted">Report hua ${ago(r.createdAt)}. Naqshe se hatega ${left(r.expiresAt)} mein, ya 2 log "khul gaya" kahein.</div>`;
  else if (s === "broken") top = `<span class="status broken">${esc(c.t)}</span><div class="age">${days}<small>din se para hai</small></div><div class="muted">Report hua ${ago(r.createdAt)}</div>`;
  else if (s === "gone") top = `<span class="status closure">${esc(c.t)}</span><div class="muted">Yeh rukawat ab khatam ho chuki hai.</div>`;
  else top = `<span class="status fixed">Theek ho gaya</span><div class="muted">${esc(c.t)}. Report hua ${ago(r.createdAt)}.</div>`;
  const photo = r.photo ? `<img class="photo-prev" alt="Report ki photo" loading="lazy" src="${esc(r.photo)}">` : "";
  const note = r.note ? `<div>${esc(r.note)}</div>` : "";
  const vb = (k, t, n, cls="") => `<button class="vote ${cls}" data-v="${k}" aria-pressed="${store.voted(r,k)}"${dis}><span>${t}</span><span class="n">${n}</span></button>`;
  const votes = r.kind === "closure"
    ? vb("still", "Abhi bhi band hai", r.still) + vb("cleared", "Khul gaya", r.cleared)
    : vb("metoo", "Mera bhi yahi masla hai", r.metoo + 1, "wide") + vb("fixed", "Theek ho gaya", r.fixed) + vb("still", "Abhi bhi toota hai", r.still);
  const del = r.mine ? `<button class="btn quiet" id="del">Apni report hatayein</button>` : "";
  const maps = `<a class="muted" href="https://www.google.com/maps/search/?api=1&query=${r.lat},${r.lng}" target="_blank" rel="noopener">Google Maps mein kholein</a>`;
  openSheet(c.kind === "closure" ? "Rasta band / rukawat" : "Toota hua", `${top}${photo}${note}<div class="votes">${votes}</div><div class="row">${del}${maps}<span class="err" id="verr"></span></div>`, "report");
  $("#sheet-b").querySelectorAll(".vote").forEach(b => b.onclick = async () => {
    const k = b.dataset.v, on = !store.voted(r, k);
    const other = {fixed:"still", still: r.kind === "closure" ? "cleared" : "fixed", cleared:"still"}[k];
    b.disabled = true;
    try {
      await store.vote(r, k, on);
      if (on && other && store.voted(r, other)) await store.vote(r, other, false);
      await store.load();
      toast(on ? "Shukriya, darj ho gaya" : "Wapas le liya");
    } catch (e) { const el = $("#verr"); if (el) el.textContent = writeError(e); b.disabled = false; }
  });
  const d = $("#del");
  if (d) d.onclick = () => {
    d.outerHTML = `<span class="muted">Pakka hatana hai?</span> <button class="btn quiet" id="del-yes">Haan, hatayein</button>`;
    $("#del-yes").onclick = async () => { try { await store.remove(r); closeSheet(); toast("Report hata di"); } catch (e) { $("#verr").textContent = writeError(e); } };
  };
  if (!quiet && first) map.panTo([r.lat, r.lng], {animate:true});
}

function openList(){
  const all = store.list.map(r => ({r, s: state(r)}));
  const broken = all.filter(x => x.s === "broken").sort((a,b) => a.r.createdAt - b.r.createdAt);
  const closure = all.filter(x => x.s === "closure").sort((a,b) => b.r.createdAt - a.r.createdAt);
  const fixed = all.filter(x => x.s.startsWith("fixed")).sort((a,b) => b.r.fixedAt - a.r.fixedAt).slice(0, 30);
  const row = ({r, s}) => { const c = CAT[r.cat] || {t:"Masla"}; const col = s.startsWith("fixed") ? "var(--fixed)" : s === "closure" ? "var(--closure)" : "var(--broken)";
    const right = s === "broken" ? Math.floor((Date.now()-r.createdAt)/DAY) + " din" : s === "closure" ? left(r.expiresAt) : "";
    return `<button class="item" data-id="${esc(r.id)}"><i style="background:${col}"></i><div><strong>${esc(c.t)}</strong><span>${esc(r.note || ago(r.createdAt))}</span></div><b>${right}</b></button>`; };
  const sec = (t, arr, empty) => `<div class="label">${t}</div>` + (arr.length ? `<div class="list">${arr.map(row).join("")}</div>` : `<div class="muted">${empty}</div>`);
  openSheet("Fehrist", sec("Abhi band raste", closure, "Is waqt koi band rasta report nahi hua.")
    + sec("Toote hue, sab se purane pehle", broken, "Koi toota hua masla report nahi hua.")
    + sec("Haal hi mein theek hue", fixed, "Abhi tak koi masla theek nahi hua."), "list");
  $("#sheet-b").querySelectorAll(".item").forEach(b => b.onclick = () => openReport(b.dataset.id));
}
$("#btn-list").onclick = () => sheetView === "list" ? closeSheet() : openList();

/* ---------- report ka flow ---------- */
let draft = null;
$("#btn-report").onclick = () => { if (store.canWrite) startReport(); };
function startReport(){
  selected = null; render();
  draft = {kind:null, cat:null, dur:"6h", note:"", photo:null, photoUrl:null};
  stepKind();
}
function stepKind(){
  const kinds = [["closure","Rasta band / rukawat","Khudai, paani, dharna, rush","var(--closure)"],["broken","Kuch toota hai","Gaddha, gutter, light, kachra","var(--broken)"]];
  openSheet("Kya report karna hai?", `<div class="kind">${kinds.map(([k,t,d,c]) => `<button class="opt" data-k="${k}" style="--c:${c}"><strong>${t}</strong><span>${d}</span></button>`).join("")}</div>
    <div class="muted">"Rasta band" kuch ghanton ya dinon baad khud naqshe se hat jata hai. "Kuch toota hai" tab tak rehta hai jab tak log na batayein ke theek ho gaya.</div>`, "new");
  $("#sheet-b").querySelectorAll(".opt").forEach(b => b.onclick = () => { draft.kind = b.dataset.k; stepCat(); });
}
function stepCat(){
  openSheet(draft.kind === "closure" ? "Kis qism ki rukawat?" : "Kya toota hai?",
    `<div class="grid2">${CATS[draft.kind].map(c => `<button class="opt" data-c="${c.id}"><strong>${c.t}</strong><span>${c.d}</span></button>`).join("")}</div>
     <button class="btn quiet" id="back">Wapas</button>`, "new");
  $("#sheet-b").querySelectorAll(".opt").forEach(b => b.onclick = () => { draft.cat = b.dataset.c; startPick(true); });
  $("#back").onclick = stepKind;
}
function startPick(useGps){
  $("#picker").hidden = false; $("#fabs").hidden = true;
  const pp = $("#picker-pin"); pp.className = "pin " + draft.kind; pp.firstElementChild.textContent = CAT[draft.cat].g;
  if (map.getZoom() < 15) map.setZoom(15);
  openSheet("Jagah chunein", `<div class="muted">Naqshe ko ungli se hilayein jab tak nishaan theek us jagah pe na aa jaye.</div>
    <div id="dup"></div>
    <div class="row"><button class="btn primary" id="here">Yahi jagah hai</button><button class="btn quiet" id="gps">◎ Meri jagah</button><button class="btn quiet" id="back">Wapas</button></div>`, "new");
  $("#back").onclick = () => { endPick(); stepCat(); };
  $("#gps").onclick = () => locate(17);
  $("#here").onclick = () => { const c = map.getCenter(); draft.lat = +c.lat.toFixed(6); draft.lng = +c.lng.toFixed(6); endPick(); stepDetails(); };
  checkDup(); map.on("moveend", checkDup);
  if (useGps) locate(17); // aksar log wahin khare hote hain jahan masla hai
}
function endPick(){ $("#picker").hidden = true; $("#fabs").hidden = false; map.off("moveend", checkDup); }
function checkDup(){
  // FixMyStreet wala qaida: aas paas pehle se report ho to naya banane ki bajaye us pe vote
  const el = $("#dup"); if (!el || !draft) return;
  const c = map.getCenter();
  const near = store.list.filter(r => r.cat === draft.cat && ["closure","broken"].includes(state(r)) && dist(c, r) < 80)
    .sort((a,b) => dist(c,a) - dist(c,b))[0];
  el.innerHTML = near ? `<div class="muted" style="color:var(--ink)"><strong>Yeh shayad pehle se report hai</strong> (${Math.round(dist(c, near))} meter door, ${ago(near.createdAt)}). Naya banane ki bajaye usi pe vote dein.</div>
    <button class="btn quiet" id="open-dup" style="margin-top:8px">Pehli report dekhein</button>` : "";
  const b = $("#open-dup"); if (b) b.onclick = () => { endPick(); openReport(near.id); };
}
function stepDetails(){
  const c = CAT[draft.cat];
  const durs = draft.kind === "closure" ? `<div class="label">Kab tak rahega (andaza)</div>
    <div class="grid2" id="durs">${DURS.map(d => `<button class="opt" data-d="${d.id}" aria-pressed="${d.id===draft.dur}"><strong>${d.t}</strong></button>`).join("")}</div>` : "";
  openSheet(c.t, `${durs}
    <div class="label"><label for="note">Chhota sa note (chahein to)</label></div>
    <textarea id="note" maxlength="280" placeholder="${draft.kind==="closure" ? "Maslan: Satiana Road pe Susan Road ki taraf jaane wali lane band" : "Maslan: gali ke mor pe bara gaddha, raat ko nazar nahi aata"}">${esc(draft.note)}</textarea>
    <div class="label">Photo (chahein to)</div>
    <label class="file"><input type="file" id="photo" accept="image/*">Photo lagayein</label>
    <div id="pv"></div>
    <div class="row"><button class="btn primary" id="send">Report bhejein</button><button class="btn quiet" id="back">Jagah badlein</button></div>
    <div class="err" id="serr"></div>`, "new");
  $("#sheet-b").querySelectorAll("#durs .opt").forEach(b => b.onclick = () => { draft.dur = b.dataset.d; $("#sheet-b").querySelectorAll("#durs .opt").forEach(x => x.setAttribute("aria-pressed", String(x===b))); });
  $("#note").oninput = e => draft.note = e.target.value;
  const showPhoto = () => { $("#pv").innerHTML = draft.photoUrl ? `<img class="photo-prev" alt="Chuni hui photo" src="${draft.photoUrl}">` : ""; };
  $("#photo").onchange = async e => {
    const f = e.target.files[0]; if (!f) return;
    $("#pv").innerHTML = `<div class="muted">Photo chhoti ki ja rahi hai…</div>`;
    try { draft.photo = await shrink(f); if (draft.photoUrl) URL.revokeObjectURL(draft.photoUrl); draft.photoUrl = URL.createObjectURL(draft.photo); showPhoto(); }
    catch { draft.photo = null; $("#pv").innerHTML = `<div class="err">Yeh photo khul nahi saki. Koi aur photo chunein.</div>`; }
  };
  showPhoto();
  $("#back").onclick = () => startPick(false);
  $("#send").onclick = async () => {
    const btn = $("#send"); btn.disabled = true; btn.textContent = "Bhej rahe hain…"; $("#serr").textContent = "";
    let exp = null;
    if (draft.kind === "closure") { const d = DURS.find(x => x.id === draft.dur); if (d.ms) exp = Date.now() + d.ms; else { const e = new Date(); e.setHours(23,59,0,0); exp = e.getTime(); } }
    try {
      await store.add({kind:draft.kind, cat:draft.cat, lat:draft.lat, lng:draft.lng, note:draft.note.trim().slice(0,280), expiresAt:exp}, draft.photo);
      draft = null; closeSheet(); toast("Report darj ho gayi. Shukriya!");
    } catch (e) { console.warn(e); $("#serr").textContent = writeError(e); btn.disabled = false; btn.textContent = "Report bhejein"; }
  };
}
// photo ko ~1024px JPEG (300 KB se kam) bana do: data bachta hai aur upload tez hota hai
function shrink(file){
  return new Promise((res, rej) => {
    const img = new Image(), url = URL.createObjectURL(file);
    img.onload = () => {
      const k = Math.min(1, 1024 / Math.max(img.width, img.height));
      const cv = document.createElement("canvas"); cv.width = Math.round(img.width*k); cv.height = Math.round(img.height*k);
      cv.getContext("2d").drawImage(img, 0, 0, cv.width, cv.height); URL.revokeObjectURL(url);
      const tryQ = q => cv.toBlob(b => {
        if (!b) return rej(new Error("encode"));
        if (b.size > 280000 && q > 0.35) return tryQ(q - 0.1);
        b.size > 300000 ? rej(new Error("too big")) : res(b);
      }, "image/jpeg", q);
      tryQ(0.75);
    };
    img.onerror = () => { URL.revokeObjectURL(url); rej(new Error("bad image")); };
    img.src = url;
  });
}

/* ---------- shuru ---------- */
render();
store.init().then(render).catch(e => { console.warn(e); banner("Server se rabta nahi ho saka. Page reload karein."); });
})();
