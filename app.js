/* UZA Build — single-page application (vanilla JS, no build step). */
(() => {
  "use strict";

  // ------------------------------------------------------------------ API
  const api = {
    token: localStorage.getItem("uza_token") || "",
    async call(path, opts = {}) {
      const res = await fetch("/api" + path, {
        ...opts,
        headers: {
          "Content-Type": "application/json",
          ...(this.token ? { Authorization: "Bearer " + this.token } : {}),
          ...(opts.headers || {}),
        },
      });
      if (res.status === 401) { logout(); throw new Error("Session expired"); }
      if (!res.ok) {
        let msg = "Request failed";
        try { msg = (await res.json()).detail || msg; } catch (e) {}
        throw new Error(msg);
      }
      const ct = res.headers.get("content-type") || "";
      return ct.includes("json") ? res.json() : res.text();
    },
    get(p) { return this.call(p); },
    post(p, b) { return this.call(p, { method: "POST", body: JSON.stringify(b || {}) }); },
    put(p, b) { return this.call(p, { method: "PUT", body: JSON.stringify(b || {}) }); },
  };

  // ------------------------------------------------------------------ State
  const S = { user: null, project: null, projects: [], room: null };
  const $ = (s, el = document) => el.querySelector(s);
  const app = $("#app");

  const money = (n, cur = "USD") => {
    n = n || 0;
    if (cur === "RWF") return n >= 1e6
      ? (n / 1e6).toFixed(1).replace(/\.0$/, "") + "M RWF"
      : Math.round(n).toLocaleString("en-US") + " RWF";
    return (cur === "USD" ? "$" : cur + " ") + n.toLocaleString("en-US", { maximumFractionDigits: 0 });
  };
  const cur = () => S.project?.currency || "USD";

  // Official UzaBuild lockup (from "UzaBuild AI branding project" design doc):
  // cart rail over UZA, amber wheel dots, bUILD tucked under offset right.
  const CARTU = (stroke = "#233448", w = 38) =>
    `<svg class="cartu lockup-svg" width="${w}" viewBox="486 560 470 270" fill="none" aria-label="UzaBuild cart U">
      <path d="M506 589 L565 589 L597 703 H662 V589" stroke="${stroke}" stroke-width="34" stroke-linecap="round" stroke-linejoin="round"/>
      <circle cx="606" cy="766" r="26" fill="#FBAF43"/><circle cx="658" cy="766" r="26" fill="#FBAF43"/></svg>`;
  const LOCKUP = (stroke = "#FFFFFF", w = 200) =>
    `<svg class="lockup-svg" width="${w}" viewBox="486 565 610 316" fill="none" aria-label="UzaBuild primary lockup">
      <path d="M506 589 L565 589 L597 703 H662 V589" stroke="${stroke}" stroke-width="24" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="M700 589 H782 L701 702 H782" stroke="${stroke}" stroke-width="24" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="M821 703 V589 H872 Q893 589 899 610 L928 700" stroke="${stroke}" stroke-width="24" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="M854 664 H912" stroke="${stroke}" stroke-width="24" stroke-linecap="round"/>
      <circle cx="606" cy="746" r="14" fill="#FBAF43"/><circle cx="658" cy="746" r="14" fill="#FBAF43"/>
      <g transform="translate(716,862) scale(0.74,1)"><text x="0" y="0" font-family="Outfit, sans-serif" font-weight="300" font-size="190" fill="#FBAF43">bUILD</text></g></svg>`;

  // ---------- i18n (EN base · FR · RW beta · 中文) ----------
  let LANG = localStorage.getItem("uza_lang") || "en";
  const LANG_LABELS = { en: "EN", fr: "FR", rw: "RW", zh: "中文" };
  const I18N = {
    en: {
      "HERO_P": "Upload a floor plan. UZA reads it like an architect, specifies the finishes like an interior designer, measures like a QS, checks it like an engineer — then prepares the whole order from Uza's supply network.",
      "S1": "Reads the drawing set: rooms, areas, openings and levels.",
      "S2": "Proposes finish schemes per room, to your budget band and taste.",
      "S3": "Takes off quantities with wastage and builds a priced BOQ.",
      "S4": "Flags clashes, substrates, wet-area and compliance issues.",
      "S5": "Matches suppliers, locks prices, schedules delivery to site.",
    },
    fr: {
      "Overview": "Vue d'ensemble", "Design": "Conception", "Commercial": "Commercial", "Governance": "Gouvernance", "Your portal": "Votre portail",
      "Dashboard": "Tableau de bord", "Project command centre": "Centre de pilotage", "Drawing intake (AI)": "Lecture de plans (IA)",
      "Client vision": "Vision du client", "Rooms & finishes": "Pièces & finitions", "Design studio": "Studio de design",
      "Solutions library": "Bibliothèque de solutions", "Specifications": "Spécifications", "BOQ workspace": "Métré (BOQ)",
      "Procurement & RFQs": "Achats & appels d'offres", "Suppliers": "Fournisseurs", "Orders & logistics": "Commandes & logistique",
      "Documents": "Documents", "Client portal": "Portail client", "Handover record": "Dossier de réception", "Audit & AI log": "Journal & IA",
      "Packages & production": "Lots & production", "Design-to-delivery OS": "De l'esquisse à la livraison",
      "Sign in": "Se connecter", "Open the platform →": "Ouvrir la plateforme →",
      "Drawings in. Priced finishings out.": "Vos plans entrent. Vos finitions chiffrées sortent.",
      "Your plans, fully finished — before you break ground.": "Vos plans, entièrement finis — avant le premier coup de pioche.",
      "HERO_P": "Téléversez un plan. UZA le lit comme un architecte, spécifie les finitions comme un designer, métre comme un économiste, vérifie comme un ingénieur — puis prépare toute la commande auprès du réseau Uza.",
      "Architect": "Architecte", "Interior design": "Design d'intérieur", "Quantity surveyor": "Économiste (QS)", "Engineer": "Ingénieur", "Procurement": "Achats",
      "S1": "Lit les plans : pièces, surfaces, ouvertures, niveaux.", "S2": "Propose des ambiances par pièce, selon budget et goût.",
      "S3": "Établit les quantités avec pertes et un métré chiffré.", "S4": "Signale conflits, supports, zones humides, conformité.",
      "S5": "Consulte les fabricants, verrouille les prix, livre au chantier.",
      "Illustrative example": "Exemple illustratif", "Prices in RWF": "Prix en RWF", "Delivery to site": "Livraison sur site",
      "Kigali · Rwanda — part of the Uza group": "Kigali · Rwanda — membre du groupe Uza",
    },
    rw: {
      "Overview": "Incamake", "Design": "Igishushanyo", "Commercial": "Ubucuruzi", "Governance": "Imiyoborere", "Your portal": "Urubuga rwawe",
      "Dashboard": "Ahabanza", "Project command centre": "Icyumba cy'umushinga", "Drawing intake (AI)": "Gusoma ibishushanyo (AI)",
      "Client vision": "Icyifuzo cy'umukiriya", "Rooms & finishes": "Ibyumba n'imirimo", "Design studio": "Situdiyo y'igishushanyo",
      "Solutions library": "Ububiko bw'ibisubizo", "Specifications": "Ibisobanuro", "BOQ workspace": "Imbonerahamwe y'ibiciro (BOQ)",
      "Procurement & RFQs": "Amasoko & ipiganwa", "Suppliers": "Abatanga ibikoresho", "Orders & logistics": "Ibicuruzwa & ubwikorezi",
      "Documents": "Inyandiko", "Client portal": "Urubuga rw'umukiriya", "Handover record": "Inyandiko y'itangwa", "Audit & AI log": "Igitabo cy'ibikorwa",
      "Packages & production": "Amasoko & umusaruro", "Design-to-delivery OS": "Kuva ku gishushanyo kugeza ku itangwa",
      "Sign in": "Injira", "Open the platform →": "Fungura urubuga →",
      "Drawings in. Priced finishings out.": "Injiza ibishushanyo. Uhabwe imirimo yo kurangiza ifite ibiciro.",
      "Your plans, fully finished — before you break ground.": "Gahunda zawe zuzuye — mbere yo gutangira kubaka.",
      "HERO_P": "Ohereza igishushanyo cy'inzu. UZA igisoma nk'umwubatsi, igena imirimo yo kurangiza nk'umuhanga mu mitako, ibara ibipimo nka QS, isuzuma nk'injeniyeri — hanyuma igategura itumiza ryose mu rusobe rw'abatanga rwa Uza.",
      "Architect": "Umwubatsi", "Interior design": "Imitako y'imbere", "Quantity surveyor": "Umubaruzi (QS)", "Engineer": "Injeniyeri", "Procurement": "Amasoko",
      "S1": "Isoma ibishushanyo: ibyumba, ubuso, imiryango n'amadirishya.", "S2": "Itanga ibitekerezo by'imitako kuri buri cyumba, ku ngengo yawe.",
      "S3": "Ibara ibipimo n'ibihombo, igakora BOQ ifite ibiciro.", "S4": "Igaragaza amakosa, ahantu h'amazi, n'ubudahangarwa.",
      "S5": "Ihuza n'abakora ibikoresho, ikemeza ibiciro, ikagemura ku kibanza.",
      "Illustrative example": "Urugero rw'ikitegererezo", "Prices in RWF": "Ibiciro mu RWF", "Delivery to site": "Kugemura ku kibanza",
      "Kigali · Rwanda — part of the Uza group": "Kigali · u Rwanda — mu itsinda rya Uza",
    },
    zh: {
      "Overview": "总览", "Design": "设计", "Commercial": "商务", "Governance": "治理", "Your portal": "您的门户",
      "Dashboard": "仪表盘", "Project command centre": "项目指挥中心", "Drawing intake (AI)": "图纸识别（AI）",
      "Client vision": "客户愿景", "Rooms & finishes": "房间与饰面", "Design studio": "设计工作室",
      "Solutions library": "解决方案库", "Specifications": "技术规格", "BOQ workspace": "工程量清单（BOQ）",
      "Procurement & RFQs": "采购与询价", "Suppliers": "供应商", "Orders & logistics": "订单与物流",
      "Documents": "文档", "Client portal": "客户门户", "Handover record": "交付档案", "Audit & AI log": "审计与AI日志",
      "Packages & production": "包件与生产", "Design-to-delivery OS": "从设计到交付",
      "Sign in": "登录", "Open the platform →": "进入平台 →",
      "Drawings in. Priced finishings out.": "图纸进，带价格的装修方案出。",
      "Your plans, fully finished — before you break ground.": "开工之前，您的图纸已完成全部装修设计。",
      "HERO_P": "上传户型图。UZA 像建筑师一样读图，像室内设计师一样选材，像造价师一样算量，像工程师一样审查——然后从 Uza 供应网络一站式下单。",
      "Architect": "建筑师", "Interior design": "室内设计", "Quantity surveyor": "工料测量师", "Engineer": "工程师", "Procurement": "采购",
      "S1": "读取图纸：房间、面积、门窗与标高。", "S2": "按预算与品味为每个房间提出饰面方案。",
      "S3": "计算工程量与损耗，生成带价格的清单。", "S4": "标记冲突、基层、湿区与合规问题。", "S5": "匹配厂商、锁定价格、按期送达工地。",
      "Illustrative example": "示意样例", "Prices in RWF": "以卢旺达法郎计价", "Delivery to site": "送货到工地",
      "Kigali · Rwanda — part of the Uza group": "基加利 · 卢旺达 — Uza 集团成员",
    },
  };
  const t = (s) => (I18N[LANG] && I18N[LANG][s]) || s;
  const langSelect = (id) => `<select id="${id}" style="width:auto;padding:4px 8px;font-size:12px">${Object.entries(LANG_LABELS).map(([l, lb]) => `<option value="${l}" ${LANG === l ? "selected" : ""}>${lb}${l === "rw" ? " (beta)" : ""}</option>`).join("")}</select>`;
  function wireLang(id) {
    const el = $("#" + id);
    if (el) el.addEventListener("change", () => { LANG = el.value; localStorage.setItem("uza_lang", LANG); render(); });
  }
  const initials = (name) => name.split(" ").map(w => w[0]).slice(0, 2).join("").toUpperCase();
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  const CATS = {
    floor: "Flooring", wall: "Wall finish", ceiling: "Ceiling", paint: "Paint",
    door: "Doors", window: "Windows", kitchen: "Kitchen", wardrobe: "Wardrobe",
    sanitaryware: "Sanitaryware", lighting: "Lighting",
  };
  const sourceBadge = (src) => {
    const map = {
      "qs-verified": ["verified", "QS-verified"], "drawing-extracted": ["drawing", "Drawing-extracted"],
      "estimated": ["est", "Estimated"], "supplier-calculated": ["info", "Supplier-calc"],
      "uza-bulk": ["bulk", "UZA Bulk"], "uza-catalogue": ["info", "UZA Catalogue"],
      "local": ["info", "Local"], "custom": ["warn", "Custom"],
    };
    const [cls, label] = map[src] || ["", src];
    return `<span class="badge ${cls}"><i class="dot"></i>${label}</span>`;
  };

  function toast(msg) {
    const t = document.createElement("div");
    t.className = "toast"; t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 2200);
  }

  // ------------------------------------------------------------------ Auth
  async function login(email, password) {
    const r = await api.post("/login", { email, password });
    api.token = r.token; localStorage.setItem("uza_token", r.token);
    S.user = r.user;
    await bootData();
    location.hash = "#/dashboard";
    render();
  }
  function logout() {
    api.token = ""; localStorage.removeItem("uza_token");
    S.user = null; location.hash = "";
    render();
  }

  async function bootData() {
    S.projects = await api.get("/projects");
    if (S.projects.length) S.project = await api.get("/projects/" + S.projects[0].id);
  }

  // ------------------------------------------------------------------ Router
  const routes = {};
  const route = (name, fn) => (routes[name] = fn);
  function currentRoute() {
    const h = (location.hash || "#/dashboard").slice(2).split("/");
    return { name: h[0] || "dashboard", args: h.slice(1) };
  }
  window.addEventListener("hashchange", render);

  // ================================================================== VIEWS

  // ---- Public landing page (design doc 3b: "Drawings in. Priced finishings out.")
  function landingView() {
    const STEPS = [
      ["01", "Architect", "S1"], ["02", "Interior design", "S2"], ["03", "Quantity surveyor", "S3"],
      ["04", "Engineer", "S4"], ["05", "Procurement", "S5"],
    ];
    return `<div class="landing">
      <div class="land-top">
        <div class="flex">${CARTU("#FFFFFF", 30)}<b style="color:#fff;font-size:15px">UZA <span style="color:var(--accent);font-weight:300">bUILD</span></b></div>
        <div class="flex">${langSelect("landLang")}<button class="btn accent" id="landSignin">${t("Sign in")}</button></div>
      </div>
      <div class="land-hero">
        <div class="land-copy">
          <div style="margin-bottom:18px">${LOCKUP("#FFFFFF", 150)}</div>
          <h1>${t("Drawings in. Priced finishings out.")}</h1>
          <p class="land-sub">${t("Your plans, fully finished — before you break ground.")}</p>
          <p class="land-p">${t("HERO_P")}</p>
          <div class="flex wrap" style="margin-top:20px">
            <button class="btn accent" id="landCta" style="font-size:14px;padding:11px 20px">${t("Open the platform →")}</button>
            <span class="badge" style="background:rgba(255,255,255,.1);color:#fff;border-color:transparent">${t("Prices in RWF")}</span>
            <span class="badge" style="background:rgba(255,255,255,.1);color:#fff;border-color:transparent">${t("Delivery to site")}</span>
          </div>
        </div>
        <div class="land-card card pad">
          <div class="between"><b>Kigali Heights Apartments · 24 units</b><span class="badge warn">${t("Illustrative example")}</span></div>
          <div class="muted" style="font-size:12px;margin-bottom:8px">Finishing package · 2-bed type A</div>
          <div style="font-size:30px;font-weight:750;letter-spacing:-.02em">18.4M RWF</div>
          ${[["Tiles & stone", "6.2M", 62], ["Sanitaryware", "4.8M", 48], ["Doors & ironmongery", "3.3M", 33], ["Paint & lighting", "2.2M", 22]]
            .map(([k, v, w]) => `<div class="between" style="margin-top:8px;font-size:12.5px"><span>${k}</span><b class="mono">${v}</b></div>
              <div style="height:5px;border-radius:4px;background:var(--surface-2)"><div style="width:${w}%;height:100%;border-radius:4px;background:linear-gradient(90deg,var(--brand),var(--accent))"></div></div>`).join("")}
          <div class="flex wrap" style="margin-top:14px">
            <span class="badge ok">Plan read in 40s</span><span class="badge ok">312 line items</span><span class="badge ok">4 suppliers matched</span>
          </div>
        </div>
      </div>
      <div class="land-steps">
        ${STEPS.map(([n, k, d]) => `<div class="land-step"><div class="num">${n}</div><b>${t(k)}</b><div class="muted" style="font-size:12px">${t(d)}</div></div>`).join("")}
      </div>
      <div class="land-foot">${t("Kigali · Rwanda — part of the Uza group")} · app.uzabuild.rw</div>
    </div>`;
  }
  function wireLanding() {
    wireLang("landLang");
    ["landSignin", "landCta"].forEach(id => $("#" + id)?.addEventListener("click", () => { S.showLogin = true; render(); }));
  }

  // ---- Login
  function loginView() {
    return `
    <div class="login-wrap"><div class="login-card">
      <div class="login-hero">
        <div style="padding:0 0 18px">${LOCKUP("#FFFFFF", 180)}</div>
        <h1>One source of truth, from first drawing to final handover.</h1>
        <p style="color:rgba(255,255,255,.85);margin-top:6px">Drawings become rooms. Rooms become finishes. Finishes become a priced, pack-rounded, manufacturer-ready package — with every quantity tagged by source and confidence, and nothing marked verified without a QS signing it off.</p>
        <div style="margin-top:22px">
          ${[["◱", "Live design studio", "Swap a finish, watch cost + BOQ update instantly"],
             ["▤", "QS-grade BOQ engine", "Net → waste → pack-rounding → rate → margin"],
             ["⇄", "Manufacturer RFQs", "Compare bids on landed cost, not just price"]]
            .map(([i, t, d]) => `<div class="feat"><div class="ico">${i}</div><div><b style="color:#fff">${t}</b><div style="color:rgba(255,255,255,.75);font-size:12.5px">${d}</div></div></div>`).join("")}
        </div>
        <div class="spacer"></div>
        <small style="color:rgba(255,255,255,.6);margin-top:24px">Kigali · Rwanda — part of the Uza group · seeded demo</small>
      </div>
      <div class="login-form">
        <div class="between"><h2 style="margin:0">${t("Sign in")}</h2><button class="btn ghost sm" id="backLanding">←</button></div>
        <p class="muted" style="margin-top:0">Use a demo account below (password <b>uza1234</b>).</p>
        <form id="loginForm">
          <label class="field"><span>Email</span><input name="email" id="email" value="client@uza.build" autocomplete="username"/></label>
          <label class="field"><span>Password</span><input name="password" id="password" type="password" value="uza1234" autocomplete="current-password"/></label>
          <button class="btn primary" style="width:100%;justify-content:center" type="submit">Sign in</button>
          <div id="loginErr" class="muted" style="color:var(--danger);margin-top:8px;font-size:12.5px"></div>
        </form>
        <div class="muted" style="font-size:11px;text-transform:uppercase;letter-spacing:.06em;margin:16px 0 6px">Switch role</div>
        <div class="role-grid" id="roleGrid"></div>
      </div>
    </div></div>`;
  }

  function wireLogin() {
    $("#backLanding")?.addEventListener("click", () => { S.showLogin = false; render(); });
    $("#loginForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      try { await login($("#email").value, $("#password").value); }
      catch (err) { $("#loginErr").textContent = err.message; }
    });
    api.get("/roles").then(roles => {
      $("#roleGrid").innerHTML = roles.map(r =>
        `<button class="role-chip" data-email="${r.email.email}"><b>${r.label}</b><span class="faint">${r.email.email}</span></button>`).join("");
      $("#roleGrid").querySelectorAll(".role-chip").forEach(b =>
        b.addEventListener("click", () => { $("#email").value = b.dataset.email; login(b.dataset.email, "uza1234").catch(e => $("#loginErr").textContent = e.message); }));
    }).catch(() => {});
  }

  // ---- Shell
  const NAV = [
    ["Overview", [["dashboard", "◧", "Dashboard"], ["project", "▦", "Project command centre"]]],
    ["Design", [["intake", "⬒", "Drawing intake (AI)"], ["vision", "◈", "Client vision"], ["rooms", "▤", "Rooms & finishes"], ["studio", "◱", "Design studio"], ["materials", "▢", "Solutions library"], ["specs", "§", "Specifications"]]],
    ["Commercial", [["boq", "∑", "BOQ workspace"], ["procurement", "⇄", "Procurement & RFQs"], ["suppliers", "⚒", "Suppliers"], ["orders", "⛟", "Orders & logistics"]]],
    ["Governance", [["documents", "⎘", "Documents"], ["client", "☺", "Client portal"], ["handover", "⌂", "Handover record"], ["audit", "◈", "Audit & AI log"]]],
  ];
  // Manufacturers see ONLY their portal — spec §4.9 data isolation.
  const NAV_MFG = [["Your portal", [["mfg", "⚒", "Packages & production"]]]];
  const navFor = (u) => u.role === "manufacturer" ? NAV_MFG : NAV;

  function shell(inner, activeName) {
    const u = S.user;
    return `<div class="shell">
      <aside class="sidebar">
        <div class="brand">${CARTU("var(--text)")}<div><b>UZA <span style="color:var(--accent);font-weight:300">bUILD</span></b><small>${t("Design-to-delivery OS")}</small></div></div>
        <nav class="nav">
          ${navFor(u).map(([grp, items]) => `<div class="group">${t(grp)}</div>${items.map(([r, ic, label]) =>
            `<a href="#/${r}" class="${activeName === r ? "active" : ""}"><span class="ico">${ic}</span>${t(label)}</a>`).join("")}`).join("")}
        </nav>
        <div class="userbox">
          <div class="avatar">${initials(u.name)}</div>
          <div style="flex:1;min-width:0"><b style="font-size:13px">${esc(u.name)}</b><div class="faint" style="font-size:11.5px">${esc(u.role_label)}</div></div>
          <button class="btn ghost sm" data-action="logout" title="Sign out">⇥</button>
        </div>
      </aside>
      <div class="main">
        <div class="topbar">
          <div>
            <div class="faint" style="font-size:11px;text-transform:uppercase;letter-spacing:.05em">${esc(S.project?.type || "")}</div>
            <b style="font-size:15px">${esc(S.project?.name || "UZA Build")}</b>
          </div>
          <span class="badge info">${esc(S.project?.code || "")}</span>
          <span class="badge ${S.project?.status === "design" ? "warn" : "ok"}"><i class="dot"></i>${esc(S.project?.status || "")}</span>
          ${langSelect("langSel")}
          <div class="grow"></div>
          ${u.role !== "manufacturer" ? `<button class="btn ghost sm" data-action="activity" style="position:relative" title="Recent activity">◈ Updates<span id="notifCount" style="display:none;position:absolute;top:-5px;right:-5px;background:var(--accent);color:#233448;font-size:10px;font-weight:800;border-radius:100px;padding:1px 6px"></span></button>` : ""}
          <span class="badge">${esc(u.role_label)}</span>
        </div>
        <div id="notifPanel" class="hidden" style="position:fixed;top:58px;right:20px;width:360px;max-height:70vh;overflow:auto;z-index:70" ></div>
        <div class="content">${inner}</div>
      </div>
    </div>`;
  }

  // ---- Dashboard
  route("dashboard", async () => {
    const p = S.project; const st = p.stats;
    const boq = await api.get(`/projects/${p.id}/boq`);
    const orders = await api.get(`/projects/${p.id}/orders`);
    const ai = await api.get(`/projects/${p.id}/ai`);
    const budgetPct = Math.min(100, Math.round(100 * boq.total / p.budget));
    return shell(`
      <div class="between"><h1>Project dashboard</h1>
        <div class="flex">
          <button class="btn" data-action="client-update" title="Copy a WhatsApp/email-ready status update">⧉ Copy client update</button>
          <button class="btn" data-action="client-wa">Share on WhatsApp</button>
          <a class="btn primary" href="#/studio">Open design studio →</a>
        </div></div>
      <div class="grid cols-4" style="margin-top:14px">
        ${statCard("Estimated value", money(boq.total, p.currency), `Budget ${money(p.budget, p.currency)} · ${budgetPct}% used`)}
        ${statCard("Rooms", st.rooms, `${st.selections} finishes selected`)}
        ${statCard("BOQ lines", boq.lines.length, `${boq.verified_pct}% QS-verified`)}
        ${statCard("Purchase orders", orders.length, orders.length ? "Procurement in progress" : "Awaiting RFQ")}
      </div>

      <div class="grid cols-2" style="margin-top:16px">
        <div class="card pad">
          <div class="between"><h2>Cost by category</h2><a href="#/boq" class="btn ghost sm">BOQ →</a></div>
          ${barChart(boq.by_category, p.currency)}
        </div>
        <div class="card pad">
          <div class="between"><h2>Verification status</h2><span class="badge ${boq.verified_pct > 60 ? "ok" : "warn"}">${boq.verified_pct}% verified</span></div>
          <p class="muted" style="margin-top:4px">Quantities remain <b>estimated</b> until a Quantity Surveyor signs them off. This guardrail prevents estimated figures being issued as verified.</p>
          <div class="progress" style="margin-top:10px"><i style="width:${boq.verified_pct}%"></i></div>
          <div class="flex wrap" style="margin-top:14px">
            ${sourceBadge("drawing-extracted")} ${sourceBadge("estimated")} ${sourceBadge("qs-verified")}
          </div>
        </div>
      </div>

      <div class="card pad" style="margin-top:16px">
        <div class="between"><h2>AI activity — every result carries confidence &amp; source</h2><a href="#/audit" class="btn ghost sm">Full log →</a></div>
        ${ai.length ? ai.map(a => `<div class="between" style="padding:8px 0;border-bottom:1px solid var(--border)">
          <div><b>${esc(a.kind)}</b> <span class="faint mono">${esc(a.model)}</span><div class="muted" style="font-size:12.5px">${esc(a.output)}</div></div>
          <div class="right"><span class="badge ${a.confidence > 0.8 ? "ok" : "warn"}">${Math.round(a.confidence * 100)}% conf.</span><div class="faint" style="font-size:11px;margin-top:3px">${esc(a.source)}</div></div>
        </div>`).join("") : `<p class="muted">No AI runs yet.</p>`}
      </div>
    `, "dashboard");
  });

  const statCard = (k, v, sub) => `<div class="card stat"><div class="k">${k}</div><div class="v">${v}</div><div class="sub">${sub || ""}</div></div>`;

  function barChart(obj, cur) {
    const entries = Object.entries(obj);
    if (!entries.length) return `<p class="muted">No costs yet.</p>`;
    const max = Math.max(...entries.map(e => e[1]));
    return `<div style="margin-top:10px">${entries.map(([k, v]) => `
      <div style="margin:9px 0">
        <div class="between" style="font-size:12.5px"><span>${CATS[k] || k}</span><b>${money(v, cur)}</b></div>
        <div class="progress" style="margin-top:4px"><i style="width:${Math.round(100 * v / max)}%"></i></div>
      </div>`).join("")}</div>`;
  }

  // ---- Project command centre
  route("project", async () => {
    const p = await api.get("/projects/" + S.project.id);
    S.project = p;
    return shell(`
      <h1>Project command centre</h1>
      <div class="grid cols-2" style="margin-top:12px">
        <div class="card pad">
          <h2>Project details</h2>
          ${detailRows({ "Code": p.code, "Client": p.client, "Location": p.location, "Type": p.type,
            "Currency": p.currency, "Budget": money(p.budget, p.currency), "Language": p.language, "Status": p.status })}
        </div>
        <div class="card pad">
          <h2>The golden path</h2>
          <div class="timeline" style="margin-top:8px">
            ${["Upload & AI drawing assessment", "Client vision & design brief", "3D concept + material selection",
               "Quantity & BOQ generation", "QS verification", "Manufacturer RFQ & bid comparison",
               "Procurement & purchase orders", "Production, logistics & installation", "Handover & digital record"]
              .map((s, i) => `<div class="tl-item ${i < 4 ? "done" : i === 4 ? "active" : ""}"><b>${s}</b></div>`).join("")}
          </div>
        </div>
      </div>
      <div class="card pad" style="margin-top:16px">
        <div class="between"><h2>Rooms</h2><a href="#/rooms" class="btn sm">Manage finishes →</a></div>
        <table><thead><tr><th>Room</th><th>Floor</th><th class="right">Area</th><th class="right">Wall area</th><th>Geometry source</th></tr></thead>
        <tbody>${p.rooms.map(r => `<tr>
          <td><b>${esc(r.name)}</b></td><td>${esc(r.floor)}</td>
          <td class="right mono">${r.area_m2} m²</td>
          <td class="right mono">${Math.round(r.perimeter_m * r.height_m - r.opening_area_m2)} m²</td>
          <td>${sourceBadge(r.source)} <span class="faint">${Math.round(r.confidence * 100)}%</span></td></tr>`).join("")}</tbody></table>
      </div>
    `, "project");
  });

  const detailRows = (obj) => `<table style="margin-top:6px">${Object.entries(obj).map(([k, v]) =>
    `<tr><td class="muted" style="width:40%">${k}</td><td><b>${esc(v)}</b></td></tr>`).join("")}</table>`;

  // ---- Rooms list
  route("rooms", async () => {
    const p = await api.get("/projects/" + S.project.id);
    const cards = await Promise.all(p.rooms.map(async r => {
      const d = await api.get(`/rooms/${r.id}/selections`);
      return { r, d };
    }));
    return shell(`
      <h1>Rooms &amp; finishes</h1>
      <p class="muted">Pick a room to open it in the design studio. Each card shows the current finish schedule and running room cost.</p>
      <div class="grid cols-3" style="margin-top:12px">
        ${cards.map(({ r, d }) => `
          <div class="card pad">
            <div class="between"><b>${esc(r.name)}</b><span class="badge">${r.area_m2} m²</span></div>
            <div class="flex wrap" style="margin:10px 0;gap:6px">
              ${d.selections.map(s => `<span class="swatch" title="${esc(CATS[s.category] || s.category)}: ${esc(s.product_name)}" style="background:${s.swatch}"></span>`).join("") || '<span class="faint">No finishes yet</span>'}
            </div>
            <div class="between"><span class="muted">${d.selections.length} finishes</span><b>${money(d.room_total, p.currency)}</b></div>
            <a class="btn primary sm" style="width:100%;justify-content:center;margin-top:10px" href="#/studio/${r.id}">Design this room →</a>
          </div>`).join("")}
      </div>
    `, "rooms");
  });

  // ---- Drawing intake (AI front door)
  route("intake", async () => {
    const p = S.project;
    const status = await api.get("/ai/status").catch(() => ({ live: false, model: "demo" }));
    S.aiStatus = status;
    return shell(`
      <div class="between"><h1>Drawing intake — AI assessment</h1>
        ${status.live
          ? `<span class="badge ok"><i class="dot"></i>Live AI · ${esc(status.model)}</span>`
          : `<span class="badge warn"><i class="dot"></i>Demo mode (rules-based)</span>`}</div>
      <p class="muted">Upload an architectural drawing (PDF/image) or paste a room schedule. UZA extracts rooms, geometry and a <b>Drawing Intelligence Report</b> — detected info, missing info, conflicts and assumptions, each with confidence. Nothing is added to the project until a professional reviews and imports it.</p>
      ${!status.live ? `<div class="card pad" style="border-left:3px solid var(--accent);margin:8px 0">
        <b>Demo mode.</b> <span class="muted">Live drawing analysis uses Claude (<span class="mono">${esc(status.model)}</span>). To enable it: <span class="mono">pip install anthropic</span> and set <span class="mono">ANTHROPIC_API_KEY</span>, then restart. In demo mode, paste a schedule like "Living 32", "Kitchen 11" (one room per line) and the rules-based extractor will parse it.</span></div>` : ""}
      <div class="grid cols-2" style="margin-top:12px">
        <div class="card pad">
          <h2>1 · Provide a drawing or schedule</h2>
          <label class="field"><span>Drawing file (PDF, PNG, JPG)</span><input type="file" id="dwgFile" accept=".pdf,.png,.jpg,.jpeg,.webp"/></label>
          <label class="field"><span>…or paste a room schedule (one room + area per line)</span><textarea id="dwgText" rows="6" placeholder="Living / Dining 32&#10;Kitchen 11.5&#10;Master Bedroom 18&#10;Master Bath 5.5"></textarea></label>
          <button class="btn primary" data-action="analyze"><span id="analyzeLbl">Run AI assessment →</span></button>
        </div>
        <div class="card pad" id="reportPanel">
          <h2>2 · Drawing Intelligence Report</h2>
          <p class="muted">Run an assessment to see detected rooms, gaps and conflicts.</p>
        </div>
      </div>
    `, "intake");
  });

  function renderReport(r) {
    const p = S.project;
    S.lastReport = r;
    const list = (title, arr, cls) => arr && arr.length
      ? `<div style="margin-top:8px"><b>${title}</b><ul class="muted" style="margin:4px 0 0">${arr.map(x => `<li class="${cls || ""}">${esc(x)}</li>`).join("")}</ul></div>` : "";
    $("#reportPanel").innerHTML = `
      <div class="between"><h2 style="margin:0">Drawing Intelligence Report</h2>
        <span class="badge ${r.confidence > 0.8 ? "ok" : "warn"}">${Math.round(r.confidence * 100)}% conf.</span></div>
      <div class="flex wrap" style="margin:8px 0">${sourceBadge(r.source)}<span class="badge ${r.mode.startsWith("live") ? "ok" : "warn"}">${esc(r.mode)}</span><span class="faint mono">${esc(r.model)}</span></div>
      ${r.note ? `<p class="badge warn" style="white-space:normal">${esc(r.note)}</p>` : ""}
      <table style="margin-top:6px"><thead><tr><th>Room</th><th class="right">Area</th><th class="right">Wall</th><th class="right">Conf.</th></tr></thead>
      <tbody>${r.rooms.map(rm => `<tr><td><b>${esc(rm.name)}</b> <span class="faint">${esc(rm.floor)}</span></td>
        <td class="right mono">${rm.area_m2} m²</td>
        <td class="right mono">${Math.round(rm.perimeter_m * rm.height_m - rm.opening_area_m2)} m²</td>
        <td class="right"><span class="badge ${rm.confidence > 0.8 ? "ok" : "warn"}">${Math.round(rm.confidence * 100)}%</span></td></tr>`).join("")}</tbody></table>
      ${list("Detected", r.detected)}
      ${list("Missing information", r.missing, "")}
      ${list("⚠ Conflicts (need professional review)", r.conflicts)}
      ${list("Assumptions", r.assumptions)}
      <div class="between" style="margin-top:14px">
        <span class="muted">${r.rooms.length} rooms ready to import</span>
        <button class="btn accent" data-action="import-rooms">Import ${r.rooms.length} rooms into project →</button>
      </div>
      <p class="faint" style="font-size:11px;margin-top:6px">Imported rooms are tagged with their source and confidence. Conflicts should be resolved by a qualified reviewer before issue-for-production.</p>`;
    // wire the injected import button (created after wireGlobal ran)
    $("#reportPanel [data-action=import-rooms]").addEventListener("click", async () => {
      const res = await api.post(`/projects/${S.project.id}/drawings/import`,
        { rooms: r.rooms, source: r.source === "drawing-extracted" ? "drawing-extracted" : "estimated" });
      toast(`${res.created} rooms imported`);
      S.project = await api.get("/projects/" + S.project.id);
      location.hash = "#/rooms";
    });
    $("#reportPanel").scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  // ---- DESIGN STUDIO (the star)
  const STYLES = [
    { name: "Warm Modern",       picks: { floor: "WD-ENG-OAK-190",    paint: "PNT-EMU-PREM-CLAY", ceiling: "CEIL-GYP-SMOOTH", lighting: "LGT-LED-PANEL", door: "DR-FLUSH-OAK",  wall: "TIL-WALL-3060-SGE", wardrobe: "WR-3DR-OAK" } },
    { name: "Minimal Light",     picks: { floor: "TIL-MARB-8080-WHT", paint: "PNT-EMU-PREM-WHT",  ceiling: "CEIL-GYP-SMOOTH", lighting: "LGT-LED-PANEL", door: "DR-FLUSH-OAK",  wall: "TIL-WALL-3060-WHT" } },
    { name: "Bold Contemporary", picks: { floor: "TIL-PORC-6060-GRY", paint: "PNT-EMU-PREM-INK",  ceiling: "CEIL-ACOU-GRID",  lighting: "LGT-TRACK-BLK", door: "DR-ALU-GLASS",  wall: "TIL-WALL-3060-WHT" } },
  ];

  route("studio", async (args) => {
    const p = S.project;
    const rooms = (await api.get("/projects/" + p.id)).rooms;
    const roomId = Number(args[0]) || rooms[0].id;
    S.room = roomId;
    const data = await api.get(`/rooms/${roomId}/selections`);
    S.baseline = S.baseline || {};
    if (!S.baseline[roomId]) S.baseline[roomId] = JSON.parse(JSON.stringify(data.selections));
    const html = shell(`
      <div class="between">
        <div><h1 style="margin-bottom:2px">Design studio</h1>
          <select id="roomPick" style="width:auto;display:inline-block">${rooms.map(r => `<option value="${r.id}" ${r.id === roomId ? "selected" : ""}>${esc(r.name)} · ${r.area_m2} m²</option>`).join("")}</select></div>
        <div class="right"><div class="faint" style="font-size:11px;text-transform:uppercase">Room estimate</div><div id="roomTotal" style="font-size:24px;font-weight:720">${money(data.room_total, p.currency)}</div></div>
      </div>
      <div class="flex wrap" style="margin-top:12px">
        <span class="faint" style="font-size:11px;text-transform:uppercase;letter-spacing:.06em">Style presets</span>
        ${STYLES.map(s => `<button class="btn sm" data-preset="${esc(s.name)}">${esc(s.name)}</button>`).join("")}
        <div class="spacer"></div>
        <button class="btn sm" data-action="toggle-compare">◧ Before / after</button>
      </div>
      <div class="studio" style="margin-top:14px">
        <div class="room-stage">
          <div class="between" style="margin-bottom:10px"><div class="flex"><h2 style="margin:0">Room view</h2>
            <div class="pill-row"><span class="pill active" data-vmode="concept">Concept</span><span class="pill" data-vmode="3d">3D walkthrough</span></div></div>
            <span class="badge warn" id="viewBadge">Concept — not to scale</span></div>
          <div id="roomVisual">${roomSVG(data.selections)}</div>
          <div id="room3dWrap" class="hidden" style="position:relative">
            <div id="room3d" style="height:400px;border-radius:12px;overflow:hidden;background:#e8ebef"></div>
            <span class="badge" id="room3dDims" style="position:absolute;top:10px;left:10px"></span>
            <div class="faint" style="font-size:11px;margin-top:6px">Drag to orbit · scroll to zoom · geometry from the drawing intake · finishes update live</div>
          </div>
          <div class="flex wrap" style="margin-top:12px" id="finishLegend">${legend(data.selections)}</div>
        </div>
        <div>
          <div class="card pad">
            <h2>Finishes</h2>
            <div class="finish-list" id="finishList">${data.selections.map(s => finishRow(s)).join("") || '<p class="muted">No finishes selected.</p>'}</div>
            <div style="margin-top:12px"><select id="addCat"><option value="">+ Add a finish category…</option>${Object.entries(CATS).filter(([c]) => !data.selections.find(s => s.category === c)).map(([c, l]) => `<option value="${c}">${l}</option>`).join("")}</select></div>
          </div>
          <div class="card pad" style="margin-top:14px" id="optionsPanel">
            <h2>Options</h2><p class="muted" id="optHint">Select a finish on the left to see alternatives.</p>
            <div class="opt-grid" id="optGrid"></div>
          </div>
        </div>
      </div>
    `, "studio");
    setTimeout(() => wireStudio(roomId, data), 0);
    return html;
  });

  const variantChips = (pr) => (pr.variants && pr.variants.length)
    ? `<div class="vchips">${pr.variants.map(v => `<span class="vchip ${v.swatch ? "dot" : ""}" data-var="${v.id}" data-pid="${pr.id}" title="${esc(v.label)}${v.price_factor && v.price_factor !== 1 ? " · rate ×" + v.price_factor : ""}" style="${v.swatch ? `background:${v.swatch}` : ""}">${v.swatch ? "" : esc(v.label)}</span>`).join("")}</div>`
    : "";
  function wireVariantChips(container, roomId, cat) {
    container.querySelectorAll(".vchip").forEach(ch => ch.addEventListener("click", (e) => {
      e.stopPropagation();
      applyFinish(roomId, cat, Number(ch.dataset.pid), Number(ch.dataset.var));
    }));
  }

  function roomSVG(sels) {
    const get = (c) => sels.find(s => s.category === c);
    const floor = get("floor")?.swatch || "#cfc6b8";
    const wall = get("wall")?.swatch || get("paint")?.swatch || "#eceae4";
    const back = get("paint")?.swatch || wall;
    const ceil = get("ceiling")?.swatch || "#fbfbf9";
    const hasKitchen = get("kitchen"), hasWardrobe = get("wardrobe"), hasSan = get("sanitaryware");
    const light = get("lighting");
    return `<svg class="room-svg" viewBox="0 0 600 380" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="sh" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".16"/></linearGradient>
      </defs>
      <!-- ceiling --><polygon points="40,26 560,26 420,110 180,110" fill="${ceil}"/><polygon points="40,26 560,26 420,110 180,110" fill="#000" opacity=".05"/>
      <!-- back wall --><polygon points="180,110 420,110 420,272 180,272" fill="${back}"/>
      <!-- left wall --><polygon points="40,26 180,110 180,272 40,354" fill="${wall}"/><polygon points="40,26 180,110 180,272 40,354" fill="#000" opacity=".08"/>
      <!-- right wall --><polygon points="560,26 420,110 420,272 560,354" fill="${wall}"/><polygon points="560,26 420,110 420,272 560,354" fill="#000" opacity=".03"/>
      <!-- floor --><polygon points="40,354 560,354 420,272 180,272" fill="${floor}"/><polygon points="40,354 560,354 420,272 180,272" fill="url(#sh)"/>
      ${get("floor") ? (isWoodFinish(get("floor")) ? plankGrid() : floorGrid(floor)) : ""}
      ${isTileFinish(get("wall")) ? wallTileGrid() : ""}
      <!-- window on back wall --><rect x="250" y="140" width="100" height="70" rx="3" fill="#bfe0ea" stroke="#8aa9b2" stroke-width="2"/><line x1="300" y1="140" x2="300" y2="210" stroke="#8aa9b2"/><line x1="250" y1="175" x2="350" y2="175" stroke="#8aa9b2"/>
      ${hasKitchen ? `<rect x="185" y="230" width="120" height="40" fill="${get("kitchen").swatch}"/><rect x="185" y="222" width="120" height="8" fill="#2b2b2b"/>` : ""}
      ${hasWardrobe ? `<rect x="430" y="150" width="34" height="120" fill="${get("wardrobe").swatch}" transform="skewY(-14)"/>` : ""}
      ${hasSan ? `<ellipse cx="480" cy="300" rx="28" ry="12" fill="#ffffff" stroke="#c9d2d6" stroke-width="2"/><rect x="466" y="270" width="28" height="34" rx="8" fill="#ffffff" stroke="#c9d2d6" stroke-width="2"/>` : ""}
      ${light ? `<circle cx="300" cy="70" r="9" fill="#fff3cf"/><circle cx="300" cy="70" r="20" fill="#fff3cf" opacity=".28"/>` : ""}
    </svg>`;
  }
  const isWoodFinish = (s) => s && /oak|wood|plank|grain|spc|vinyl/i.test((s.product_name || "") + " " + (s.finish || ""));
  const isTileFinish = (s) => s && /tile|ceramic|porcelain/i.test(s.product_name || "");
  function plankGrid() {
    // perspective wood planks: dense horizontals + staggered joints
    let lines = "";
    for (let i = 1; i < 10; i++) {
      const t = i / 10, y = 272 + (354 - 272) * t, xl = 180 - (180 - 40) * t, xr = 420 + (560 - 420) * t;
      lines += `<line x1="${xl}" y1="${y}" x2="${xr}" y2="${y}" stroke="#000" opacity=".09"/>`;
    }
    for (let i = 0; i < 10; i++) {
      const t0 = i / 10, t1 = (i + 1) / 10, f = i % 2 ? 0.38 : 0.66;
      const xa = (180 + (420 - 180) * f) + ((40 + (560 - 40) * f) - (180 + (420 - 180) * f)) * t0;
      const xb = (180 + (420 - 180) * f) + ((40 + (560 - 40) * f) - (180 + (420 - 180) * f)) * t1;
      lines += `<line x1="${xa}" y1="${272 + (354 - 272) * t0}" x2="${xb}" y2="${272 + (354 - 272) * t1}" stroke="#000" opacity=".07"/>`;
    }
    return lines;
  }
  function wallTileGrid() {
    let lines = "";
    for (let i = 1; i < 5; i++) { const y = 110 + (272 - 110) * (i / 5); lines += `<line x1="180" y1="${y}" x2="420" y2="${y}" stroke="#000" opacity=".05"/>`; }
    for (let i = 1; i < 6; i++) { const x = 180 + 240 * (i / 6); lines += `<line x1="${x}" y1="110" x2="${x}" y2="272" stroke="#000" opacity=".05"/>`; }
    return lines;
  }
  function floorGrid(color) {
    let lines = "";
    for (let i = 1; i < 6; i++) { const t = i / 6; const y = 272 + (354 - 272) * t; const xl = 180 - (180 - 40) * t; const xr = 420 + (560 - 420) * t; lines += `<line x1="${xl}" y1="${y}" x2="${xr}" y2="${y}" stroke="#000" opacity=".07"/>`; }
    for (let i = 1; i < 6; i++) { const x = 180 + (420 - 180) * (i / 6); const bx = 40 + (560 - 40) * (i / 6); lines += `<line x1="${x}" y1="272" x2="${bx}" y2="354" stroke="#000" opacity=".07"/>`; }
    return lines;
  }
  function legend(sels) {
    return sels.map(s => `<span class="badge"><span class="swatch" style="width:12px;height:12px;background:${s.swatch}"></span>${CATS[s.category] || s.category}</span>`).join("");
  }
  function finishRow(s) {
    return `<div class="finish-row" data-cat="${s.category}" data-fin="${s.category}">
      <span class="swatch lg" style="background:${s.swatch}"></span>
      <div class="meta"><b>${esc(s.product_name)}</b><div class="faint" style="font-size:11.5px">${CATS[s.category] || s.category} · ${esc(s.finish || "")} ${sourceBadge(s.product_source)}</div></div>
    </div>`;
  }

  async function wireStudio(roomId, data) {
    $("#roomPick")?.addEventListener("change", e => { location.hash = "#/studio/" + e.target.value; });
    $("#addCat")?.addEventListener("change", e => { if (e.target.value) selectFinish(e.target.value); });

    // Concept <-> real 3D view
    document.querySelectorAll("[data-vmode]").forEach(pl => pl.addEventListener("click", async () => {
      document.querySelectorAll("[data-vmode]").forEach(x => x.classList.toggle("active", x === pl));
      const cur2 = await api.get(`/rooms/${roomId}/selections`);
      if (pl.dataset.vmode === "3d") {
        $("#roomVisual").classList.add("hidden"); $("#room3dWrap").classList.remove("hidden");
        $("#viewBadge").textContent = "3D — true room geometry";
        if (S._u3d) S._u3d.dispose();
        S._u3d = UZA3D.mount($("#room3d"), cur2.room, cur2.selections);
        $("#room3dDims").textContent = S._u3d.label;
      } else {
        if (S._u3d) { S._u3d.dispose(); S._u3d = null; }
        $("#room3dWrap").classList.add("hidden"); $("#roomVisual").classList.remove("hidden");
        $("#viewBadge").textContent = "Concept — not to scale";
        $("#roomVisual").innerHTML = roomSVG(cur2.selections);
      }
    }));

    // style presets: batch-apply a coordinated palette to this room's categories
    document.querySelectorAll("[data-preset]").forEach(b => b.addEventListener("click", async () => {
      const style = STYLES.find(s => s.name === b.dataset.preset);
      b.disabled = true; b.textContent = "Applying…";
      try {
        const all = await api.get("/products");
        const byCode = Object.fromEntries(all.map(pr => [pr.code, pr]));
        const cur = await api.get(`/rooms/${roomId}/selections`);
        let applied = 0;
        for (const s of cur.selections) {
          const code = style.picks[s.category];
          if (code && byCode[code] && byCode[code].id !== s.product_id) {
            await api.put(`/rooms/${roomId}/selections/${s.category}`, { product_id: byCode[code].id });
            applied++;
          }
        }
        toast(`${style.name} applied — ${applied} finishes updated`);
        render();
      } catch (e) { toast(e.message); b.disabled = false; b.textContent = style.name; }
    }));

    // before / after comparison against the session baseline
    let compareOn = false;
    $("[data-action=toggle-compare]")?.addEventListener("click", async () => {
      compareOn = !compareOn;
      const cur = await api.get(`/rooms/${roomId}/selections`);
      if (compareOn) {
        $("#roomVisual").innerHTML = `<div class="grid cols-2">
          <div><span class="badge" style="margin-bottom:6px">Before — session start</span>${roomSVG(S.baseline[roomId] || [])}</div>
          <div><span class="badge ok" style="margin-bottom:6px">Now</span>${roomSVG(cur.selections)}</div></div>`;
      } else {
        $("#roomVisual").innerHTML = roomSVG(cur.selections);
      }
    });
    const rows = document.querySelectorAll(".finish-row");
    rows.forEach(row => row.addEventListener("click", () => selectFinish(row.dataset.cat)));

    async function selectFinish(cat) {
      document.querySelectorAll(".finish-row").forEach(r => r.classList.toggle("active", r.dataset.cat === cat));
      $("#optHint").textContent = "Loading " + (CATS[cat] || cat) + " options…";
      const products = await api.get("/products?category=" + cat);
      const current = data.selections.find(s => s.category === cat);
      $("#optHint").textContent = `${products.length} ${(CATS[cat] || cat).toLowerCase()} options — click to apply live.`;
      $("#optGrid").innerHTML = products.map(pr => `
        <div class="opt ${current && current.product_id === pr.id ? "active" : ""}" data-pid="${pr.id}" data-cat="${cat}">
          <div class="tile" style="background:${pr.swatch}"></div>
          <b>${esc(pr.name)}</b>
          <div class="between" style="margin-top:4px"><span class="mono faint" title="Indicative budget rate">~${money(pr.unit_price, cur())}/${pr.unit}</span>${sourceBadge(pr.source)}</div>
          ${variantChips(pr)}
        </div>`).join("");
      $("#optGrid").querySelectorAll(".opt").forEach(o =>
        o.addEventListener("click", () => applyFinish(roomId, cat, Number(o.dataset.pid))));
      wireVariantChips($("#optGrid"), roomId, cat);
    }
  }

  async function applyFinish(roomId, cat, productId, variantId) {
    const r = await api.put(`/rooms/${roomId}/selections/${cat}`, { product_id: productId, variant_id: variantId || null });
    const data = await api.get(`/rooms/${roomId}/selections`);
    // live-refresh the visual, legend, finish list, options highlight, total
    $("#roomVisual").innerHTML = roomSVG(data.selections);
    if (S._u3d) S._u3d.update(data.selections);
    $("#finishLegend").innerHTML = legend(data.selections);
    $("#finishList").innerHTML = data.selections.map(s => finishRow(s)).join("");
    $("#roomTotal").textContent = money(data.room_total, S.project.currency);
    document.querySelectorAll(".finish-row").forEach(row => {
      row.addEventListener("click", () => row.click);
      row.classList.toggle("active", row.dataset.cat === cat);
    });
    // re-wire finish rows (innerHTML replaced them)
    document.querySelectorAll(".finish-row").forEach(row =>
      row.addEventListener("click", async () => {
        document.querySelectorAll(".finish-row").forEach(r2 => r2.classList.toggle("active", r2 === row));
        const products = await api.get("/products?category=" + row.dataset.cat);
        const curSel = data.selections.find(s => s.category === row.dataset.cat);
        $("#optGrid").innerHTML = products.map(pr => `<div class="opt ${curSel && curSel.product_id === pr.id ? "active" : ""}" data-pid="${pr.id}"><div class="tile" style="background:${pr.swatch}"></div><b>${esc(pr.name)}</b><div class="between" style="margin-top:4px"><span class="mono faint" title="Indicative budget rate">~${money(pr.unit_price, cur())}/${pr.unit}</span>${sourceBadge(pr.source)}</div>${variantChips(pr)}</div>`).join("");
        $("#optGrid").querySelectorAll(".opt").forEach(o => o.addEventListener("click", () => applyFinish(roomId, row.dataset.cat, Number(o.dataset.pid))));
        wireVariantChips($("#optGrid"), roomId, row.dataset.cat);
      }));
    // highlight applied option
    document.querySelectorAll("#optGrid .opt").forEach(o => o.classList.toggle("active", Number(o.dataset.pid) === productId));
    impactToast(r.impact, r.delta);
  }

  function impactToast(impact, delta) {
    const prev = $(".impact-toast"); if (prev) prev.remove();
    const el = document.createElement("div");
    el.className = "impact-toast";
    const sign = delta > 0 ? "+" : "";
    el.innerHTML = `<div class="between"><b>Change impact</b><button class="btn ghost sm" data-x>✕</button></div>
      <div style="font-size:20px;font-weight:720;color:${delta > 0 ? "var(--accent)" : "var(--ok)"};margin:4px 0">${sign}${money(delta, S.project.currency)}</div>
      <div class="muted" style="font-size:12.5px">Updates: ${impact.affects.join(", ")}.</div>
      <div class="muted" style="font-size:12.5px;margin-top:4px">Lead time: <b>${impact.lead_time_days} days</b> · Requires: <b>${impact.requires}</b></div>`;
    document.body.appendChild(el);
    el.querySelector("[data-x]").addEventListener("click", () => el.remove());
    setTimeout(() => el.remove(), 6000);
  }

  // ---- Client vision engine: brief -> proposed solution schemes
  route("vision", async () => {
    const meta = await api.get(`/projects/${S.project.id}/brief`);
    const b = meta.brief;
    const canEdit = !["manufacturer", "installer"].includes(S.user.role);
    return shell(`<div id="visionRoot" data-has-brief="${b ? 1 : 0}">
      <h1>Client vision</h1>
      <p class="muted">Tell UZA how the finished home should <b>feel</b> — the engine turns the brief into complete, complementary solution schemes. Estimates are indicative budget figures; final prices are locked by project bids.</p>
      <div class="card pad" style="margin:12px 0 16px">
        <h2 style="margin-bottom:10px">1 · The brief</h2>
        <div class="style-grid">
          ${meta.styles.map(s => `<div class="style-card ${b && b.style === s.key ? "active" : ""}" data-style="${s.key}">
            <div class="chip-strip">${s.chips.map(c => `<span style="background:${c}"></span>`).join("")}</div>
            <b>${esc(s.label)}</b><div class="muted" style="font-size:12px">${esc(s.blurb)}</div></div>`).join("")}
        </div>
        <div class="flex wrap" style="margin:14px 0 4px">
          <span class="muted" style="font-size:12.5px;font-weight:600">Budget band:</span>
          <div class="pill-row" id="bandRow">${meta.bands.map(x => `<span class="pill ${(b ? b.budget_band === x : x === "standard") ? "active" : ""}" data-band="${x}">${x[0].toUpperCase() + x.slice(1)}</span>`).join("")}</div>
        </div>
        <div class="flex wrap" style="margin:8px 0 12px">
          <span class="muted" style="font-size:12.5px;font-weight:600">Priorities:</span>
          <div class="pill-row" id="prioRow">${meta.priorities.map(x => `<span class="pill ${b && (b.priorities || "").includes(x.key) ? "active" : ""}" data-prio="${x.key}">${esc(x.label)}</span>`).join("")}</div>
        </div>
        <label class="field"><span>Anything else about how it should feel?</span><textarea id="briefNotes" rows="2" placeholder="e.g. lots of natural light, two small children, hotel-bathroom feeling…">${b ? esc(b.notes || "") : ""}</textarea></label>
        ${canEdit ? '<button class="btn primary" id="saveBrief">Save brief & propose schemes →</button>' : '<span class="muted">Your role can view the brief but not edit it.</span>'}
      </div>
      <div id="schemes">${b ? "" : '<div class="empty"><div class="big">◈</div>Save the brief to see proposed schemes.</div>'}</div>
    </div>`, "vision");
  });

  function wireVision() {
    const root = $("#visionRoot"); if (!root) return;
    root.querySelectorAll(".style-card").forEach(c => c.addEventListener("click", () =>
      root.querySelectorAll(".style-card").forEach(x => x.classList.toggle("active", x === c))));
    const band = $("#bandRow");
    if (band) band.querySelectorAll(".pill").forEach(pl => pl.addEventListener("click", () => {
      band.querySelectorAll(".pill").forEach(x => x.classList.remove("active")); pl.classList.add("active");
    }));
    const pr = $("#prioRow");
    if (pr) pr.querySelectorAll(".pill").forEach(pl => pl.addEventListener("click", () => pl.classList.toggle("active")));
    const save = $("#saveBrief");
    if (save) save.addEventListener("click", async () => {
      const style = root.querySelector(".style-card.active")?.dataset.style;
      if (!style) { toast("Pick a style first — that's the heart of the brief."); return; }
      await api.post(`/projects/${S.project.id}/brief`, {
        style,
        budget_band: $("#bandRow .pill.active")?.dataset.band || "standard",
        priorities: [...root.querySelectorAll("#prioRow .pill.active")].map(x => x.dataset.prio),
        notes: $("#briefNotes").value,
      });
      toast("Brief saved — matching solutions…");
      loadSchemes();
    });
    if (root.dataset.hasBrief === "1") loadSchemes();
  }

  async function loadSchemes() {
    const box = $("#schemes"); if (!box) return;
    box.innerHTML = `<div class="empty"><div class="big">◈</div>Matching solutions to the brief…</div>`;
    const r = await api.get(`/projects/${S.project.id}/schemes`);
    const p = S.project;
    const canApply = !["manufacturer", "installer"].includes(S.user.role);
    box.innerHTML = `<h2 style="margin:6px 0 10px">2 · Proposed solution schemes</h2><div class="grid cols-3">` +
      r.schemes.map(s => `
      <div class="card pad scheme-card">
        <div class="between"><b style="font-size:15px">${esc(s.label)}</b><span class="badge">${esc(s.band)}</span></div>
        <div class="muted" style="font-size:12px;margin:2px 0 8px">${esc(s.tagline)}</div>
        <div class="chip-strip lg">${Object.values(s.picks).map(k => `<span style="background:${k.swatch}" title="${esc(k.name)}"></span>`).join("")}</div>
        <div style="margin:10px 0 6px">${Object.entries(s.picks).map(([c, k]) => `
          <div class="flex" style="padding:5px 0;border-bottom:1px solid var(--border)">
            <span class="swatch" style="background:${k.swatch}"></span>
            <div style="flex:1;min-width:0"><b style="font-size:12.5px">${esc(k.name)}</b>
              <div class="faint" style="font-size:11px">${CATS[c] || c} · ${esc(k.rationale)}</div></div>
            <span class="mono faint" style="font-size:11px">~${money(k.unit_price, cur())}</span>
          </div>`).join("")}</div>
        <div class="between"><div><div class="faint" style="font-size:11px">Indicative estimate</div><b style="font-size:16px">~${money(s.estimate, p.currency)}</b></div>
          <div class="right"><div class="faint" style="font-size:11px">vs budget</div><b>${p.budget ? Math.round(100 * s.estimate / p.budget) + "%" : "—"}</b></div></div>
        <div class="faint" style="font-size:11px;margin-top:4px">Longest lead ${s.lead_time_days} days · final prices via project bids</div>
        ${canApply ? `<button class="btn primary" style="width:100%;margin-top:10px" data-apply="${s.key}">Apply this scheme →</button>` : ""}
      </div>`).join("") + `</div>`;
    box.querySelectorAll("[data-apply]").forEach(btn => btn.addEventListener("click", async () => {
      const s = r.schemes.find(x => x.key === btn.dataset.apply);
      const picks = {}; for (const [c, k] of Object.entries(s.picks)) picks[c] = k.product_id;
      const res = await api.post(`/projects/${S.project.id}/schemes/apply`, { picks, label: s.label });
      toast(`${s.label} applied — ${res.changed} selections updated. Open the Design studio to see it live.`);
      box.querySelectorAll("[data-apply]").forEach(x => x.textContent = "Apply this scheme →");
      btn.textContent = "✓ Applied";
    }));
  }

  // ---- Materials library
  route("materials", async () => {
    const products = await api.get("/products");
    const cats = [...new Set(products.map(p => p.category))];
    return shell(`
      <h1>Solutions library</h1>
      <p class="muted">Finishing <b>specifications</b>, not price lists — each entry defines a performance solution (standards, finish, lead time). Rates shown are <b>indicative budget rates</b> for early estimating only; real prices are set per project by manufacturer bids in Procurement.</p>
      <div class="flex wrap" style="margin:12px 0">
        <input id="matSearch" placeholder="Search products, codes, finishes…" style="max-width:280px"/>
        <div class="pill-row" id="matFilter">
          <span class="pill active" data-cat="">All</span>${cats.map(c => `<span class="pill" data-cat="${c}">${CATS[c] || c}</span>`).join("")}
        </div>
      </div>
      <div class="card"><table><thead><tr><th>Code</th><th>Product</th><th>Category</th><th>Manufacturer</th><th class="right">Budget rate</th><th>Lead</th><th>Source</th></tr></thead>
      <tbody id="matBody">${products.map(matRow).join("")}</tbody></table></div>
    `, "materials");
  });
  const matRow = (p) => `<tr data-cat="${p.category}">
    <td class="mono">${esc(p.code)}</td>
    <td><div class="flex"><span class="swatch" style="background:${p.swatch}"></span><div><b>${esc(p.name)}</b><div class="faint" style="font-size:11px">${esc(p.finish || "")} ${p.standards ? "· " + esc(p.standards) : ""}</div></div></div></td>
    <td>${CATS[p.category] || p.category}${p.variants && p.variants.length ? `<div class="faint" style="font-size:10.5px">${p.variants.length} variants</div>` : ""}</td><td>${esc(p.manufacturer || "—")}</td>
    <td class="right mono" title="Indicative budget rate — priced per project via RFQ">~${money(p.unit_price, cur())}/${p.unit}</td><td class="mono">${p.lead_time_days}d</td><td>${sourceBadge(p.source)}</td></tr>`;

  // ---- BOQ workspace
  route("boq", async () => {
    const p = S.project;
    const boq = await api.get(`/projects/${p.id}/boq`);
    const canVerify = S.user.caps.includes("boq.verify") || S.user.caps.includes("*");
    return shell(`
      <div class="between"><h1>BOQ workspace</h1>
        <div class="flex">
          <a class="btn" href="/api/projects/${p.id}/boq.csv">⇩ Export CSV</a>
          ${canVerify ? '<button class="btn accent" data-action="verify-all">✓ Verify all as QS</button>' : ''}
        </div></div>
      <div class="grid cols-4" style="margin:12px 0">
        ${statCard("BOQ total", money(boq.total, p.currency), "material + install + margin")}
        ${statCard("Lines", boq.lines.length, "auto-generated from finishes")}
        ${statCard("Verified", boq.verified_pct + "%", "QS professional sign-off")}
        ${statCard("Budget", money(p.budget, p.currency), Math.round(100 * boq.total / p.budget) + "% committed")}
      </div>
      <div class="card"><table>
        <thead><tr><th>Room</th><th>Description</th><th class="right">Net</th><th class="right">Waste</th><th class="right">Ordered</th><th class="right">Budget rate</th><th class="right">Amount</th><th>Source</th>${canVerify ? "<th></th>" : ""}</tr></thead>
        <tbody>${boq.lines.map(l => `<tr>
          <td class="nowrap">${esc(l.room_name)}</td>
          <td><b>${esc(l.description.split(" — ")[0])}</b><div class="faint" style="font-size:11px">${CATS[l.category] || l.category} · ${Math.round(l.confidence * 100)}% conf.</div></td>
          <td class="right mono">${l.net_qty} ${l.unit}</td>
          <td class="right mono">${Math.round(l.waste_pct * 100)}%</td>
          <td class="right mono"><b>${l.ordered_qty} ${l.unit}</b></td>
          <td class="right mono">${money(l.rate, cur())}</td>
          <td class="right mono"><b>${money(l.amount, p.currency)}</b></td>
          <td>${sourceBadge(l.source)}</td>
          ${canVerify ? `<td>${l.source === "qs-verified" ? '<span class="badge ok">✓</span>' : `<button class="btn sm" data-verify data-room="${l.room_id}" data-cat="${l.category}">Verify</button>`}</td>` : ""}
        </tr>`).join("")}</tbody>
        <tfoot><tr><td colspan="${canVerify ? 6 : 5}"></td><td class="right"><b>${money(boq.total, p.currency)}</b></td><td colspan="2"></td></tr></tfoot>
      </table></div>
      <p class="muted" style="margin-top:10px">Quantities derive from room geometry via the QS engine: <b>net → +waste → pack-rounding → rate → +install +margin</b>. A line only becomes <b>QS-verified</b> through the explicit action above — the platform never auto-promotes an estimate. Rates are <b>indicative budget rates</b>: the final price of every category is locked only when Procurement awards a manufacturer bid for this project.</p>
    `, "boq");
  });

  // ---- Procurement & RFQs
  route("procurement", async () => {
    const p = S.project;
    const boq = await api.get(`/projects/${p.id}/boq`);
    const rfqs = await api.get(`/projects/${p.id}/rfqs`);
    const canRFQ = S.user.caps.includes("rfq.manage") || S.user.caps.includes("*");
    const cats = Object.keys(boq.by_category);
    return shell(`
      <div class="between"><h1>Procurement &amp; RFQs</h1></div>
      <div class="grid cols-2" style="margin-top:12px">
        <div class="card pad">
          <h2>Create RFQ package from BOQ</h2>
          <p class="muted">Bundle a BOQ category into a manufacturer package. UZA auto-invites matching manufacturers and collects comparable bids.</p>
          ${canRFQ ? `<div class="flex" style="margin-top:10px"><select id="rfqCat">${cats.map(c => `<option value="${c}">${CATS[c] || c} · ${money(boq.by_category[c], p.currency)}</option>`).join("")}</select><button class="btn primary" data-action="create-rfq">Issue RFQ</button></div>` : '<p class="badge warn">Only Procurement can issue RFQs. Sign in as Grace (procurement@uza.build).</p>'}
        </div>
        <div class="card pad">
          <h2>Manufacturer package preview</h2>
          <p class="muted">Every RFQ generates a spec-complete package: schedule, quantities, standards, samples, QC checklist, QR labelling.</p>
          <div class="flex" style="margin-top:10px"><select id="pkgCat">${cats.map(c => `<option value="${c}">${CATS[c] || c}</option>`).join("")}</select><button class="btn" data-action="view-package">View package</button></div>
        </div>
      </div>
      <div class="card pad" style="margin-top:16px">
        <h2>RFQs &amp; bid comparison</h2>
        ${rfqs.length ? `<div id="rfqList">${rfqs.map(r => `<div class="between" style="padding:10px 0;border-bottom:1px solid var(--border)">
          <div><b>${esc(r.package_code)}</b> <span class="badge">${CATS[r.category] || r.category}</span><div class="faint" style="font-size:12px">${esc(r.scope)}</div></div>
          <div class="flex"><span class="badge ${r.status === "awarded" ? "ok" : "warn"}">${r.status}</span><button class="btn sm" data-bids="${r.id}">Compare bids →</button></div>
        </div>`).join("")}</div>` : '<p class="muted">No RFQs yet. Create one above to see the bid-comparison engine.</p>'}
        <div id="bidPanel" style="margin-top:14px"></div>
      </div>
    `, "procurement");
  });

  async function showBids(rfqId) {
    const { rfq, bids } = await api.get(`/rfqs/${rfqId}/bids`);
    const p = S.project;
    const canAward = S.user.caps.includes("bid.award") || S.user.caps.includes("*");
    $("#bidPanel").innerHTML = `
      <div class="card pad" style="border-color:var(--brand)">
        <div class="between"><h3>${esc(rfq.package_code)} — bids ranked by value (not price alone)</h3><span class="badge ${rfq.status === "awarded" ? "ok" : "warn"}">${rfq.status}</span></div>
        <table style="margin-top:8px"><thead><tr><th>Manufacturer</th><th>Country</th><th class="right">Unit</th><th class="right">Freight</th><th class="right">Duty</th><th class="right">Landed</th><th class="right">Lead</th><th class="right">Compliance</th><th class="right">Score</th>${canAward && rfq.status !== "awarded" ? "<th></th>" : ""}</tr></thead>
        <tbody>${bids.map(b => `<tr style="${b.recommended ? "background:color-mix(in srgb,var(--ok) 8%,transparent)" : ""}">
          <td><b>${esc(b.manufacturer)}</b> ${b.recommended ? '<span class="badge ok">Recommended</span>' : ""} ${b.status === "awarded" ? '<span class="badge info">Awarded</span>' : ""}</td>
          <td>${esc(b.country)}</td>
          <td class="right mono">${money(b.unit_price, cur())}</td><td class="right mono">${money(b.freight, cur())}</td><td class="right mono">${Math.round(b.duty_pct * 100)}%</td>
          <td class="right mono"><b>${money(b.landed_cost, p.currency)}</b></td>
          <td class="right mono">${b.lead_time_days}d</td>
          <td class="right"><div class="progress" style="width:60px;display:inline-block"><i style="width:${Math.round(b.compliance * 100)}%"></i></div></td>
          <td class="right"><b style="font-size:15px">${b.score}</b></td>
          ${canAward && rfq.status !== "awarded" ? `<td><button class="btn accent sm" data-award="${b.id}" data-rfq="${rfqId}">Award</button></td>` : ""}
        </tr>`).join("")}</tbody></table>
        <p class="muted" style="margin-top:8px">Score = 45% landed cost · 20% lead time · 25% compliance · 10% warranty. The cheapest bid is not always the recommendation.</p>
      </div>`;
    // wire the injected award buttons (created after wireGlobal ran)
    $("#bidPanel").querySelectorAll("[data-award]").forEach(b => b.addEventListener("click", async () => {
      const res = await api.post(`/rfqs/${b.dataset.rfq}/award`, { quotation_id: Number(b.dataset.award) });
      toast(`Awarded · ${res.po_code} issued`); render();
    }));
    $("#bidPanel").scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  // ---- Suppliers (manufacturer register)
  route("suppliers", async () => {
    const mans = await api.get("/manufacturers");
    const canAdd = S.user.caps.includes("rfq.manage") || S.user.caps.includes("*");
    return shell(`
      <h1>Supplier &amp; manufacturer register</h1>
      <p class="muted">Every sourcing decision starts here: who can make it, how compliant they are, and how long they take. RFQs auto-invite suppliers whose categories match the package.</p>
      <div class="card" style="margin-top:12px"><table>
        <thead><tr><th>Supplier</th><th>Country</th><th>Categories</th><th class="right">Rating</th><th class="right">Compliance</th><th class="right">Lead time</th></tr></thead>
        <tbody>${mans.map(m => `<tr>
          <td><b>${esc(m.name)}</b></td><td>${esc(m.country || "—")}</td>
          <td><div class="flex wrap" style="gap:4px">${(m.categories || "").split(",").filter(Boolean).map(c => `<span class="badge">${CATS[c.trim()] || c.trim()}</span>`).join("")}</div></td>
          <td class="right mono">${m.rating} ★</td>
          <td class="right"><div class="progress" style="width:70px;display:inline-block"><i style="width:${Math.round(m.compliance * 100)}%"></i></div> <span class="mono faint">${Math.round(m.compliance * 100)}%</span></td>
          <td class="right mono">${m.lead_time_days}d</td></tr>`).join("")}</tbody></table></div>
      ${canAdd ? `
      <div class="card pad" style="margin-top:16px;max-width:680px">
        <h2>Register a new supplier</h2>
        <div class="grid cols-2">
          <label class="field"><span>Name *</span><input id="supName" placeholder="e.g. Rift Valley Stone Ltd"/></label>
          <label class="field"><span>Country</span><input id="supCountry" placeholder="e.g. Rwanda"/></label>
          <label class="field"><span>Categories * (comma-separated)</span><input id="supCats" placeholder="floor,wall,paint"/></label>
          <label class="field"><span>Typical lead time (days)</span><input id="supLead" type="number" value="30"/></label>
        </div>
        <button class="btn primary" data-action="add-supplier">Register supplier</button>
      </div>` : `<p class="badge warn" style="margin-top:14px">Only Procurement can register suppliers.</p>`}
    `, "suppliers");
  });

  // ---- Orders & logistics
  route("orders", async () => {
    const p = S.project;
    const orders = await api.get(`/projects/${p.id}/orders`);
    const canUpdate = ["rfq.manage", "production.update", "install.update", "*"].some(c => S.user.caps.includes(c));
    return shell(`
      <h1>Orders &amp; logistics</h1>
      ${orders.length ? orders.map(o => {
        const next = o.milestones.find(ms => !ms.done);
        return `
        <div class="card pad" style="margin-top:12px">
          <div class="between"><div><b>${esc(o.po_code)}</b> <span class="badge">${esc(o.manufacturer || "")}</span></div>
            <div class="right"><b>${money(o.amount, p.currency)}</b> <span class="badge ${o.status === "delivered" ? "ok" : "warn"}">${o.status}</span></div></div>
          <div class="timeline" style="margin-top:14px">${o.milestones.map(m => `<div class="tl-item ${m.done ? "done" : (next && m.id === next.id) ? "active" : ""}"><div class="between"><b>${esc(m.name)}</b><span class="flex">${canUpdate && next && m.id === next.id ? `<button class="btn accent sm" data-msdone="${m.id}">Mark complete</button>` : ""}<span class="faint mono">${m.pct}% · ETA ${esc(m.eta)}</span></span></div></div>`).join("")}</div>
        </div>`;
      }).join("") : `<div class="empty"><div class="big">⛟</div>No purchase orders yet.<div style="margin-top:8px"><a class="btn primary" href="#/procurement">Go to procurement →</a></div></div>`}
    `, "orders");
  });

  // ---- Client portal
  route("client", async () => {
    const p = S.project;
    const boq = await api.get(`/projects/${p.id}/boq`);
    const rooms = (await api.get("/projects/" + p.id)).rooms;
    const approvals = await api.get(`/projects/${p.id}/approvals`);
    const comments = await api.get(`/projects/${p.id}/comments`);
    const orders = await api.get(`/projects/${p.id}/orders`);
    const orderProgress = orders.map(o => {
      const done = o.milestones.filter(m => m.done).length;
      const next = o.milestones.find(m => !m.done);
      return { o, pct: Math.round(100 * done / o.milestones.length), next };
    });
    return shell(`
      <h1>Client portal</h1>
      <p class="muted">What the client sees: their vision realised, priced transparently (client price only), with a clear approval trail.</p>
      <div class="grid cols-3" style="margin:12px 0">
        ${statCard("Your project value", money(boq.total, p.currency), "client price")}
        ${statCard("Rooms designed", rooms.length, "concepts ready to review")}
        ${statCard("Decisions logged", approvals.length, "full audit trail")}
      </div>
      <div class="grid cols-2">
        <div class="card pad">
          <h2>Approve the current design</h2>
          <p class="muted">Approvals carry an explicit impact statement and a timestamp — a legally useful record.</p>
          <label class="field"><span>Comment (optional)</span><textarea id="apprComment" rows="2" placeholder="e.g. Approved — love the oak in the master."></textarea></label>
          <div class="flex wrap">
            <button class="btn primary" data-approve="approved">Approve design</button>
            <button class="btn" data-approve="approved-with-comments">Approve with comments</button>
            <button class="btn" data-approve="revision-requested">Request revision</button>
          </div>
        </div>
        <div class="card pad">
          <h2>Decision history</h2>
          ${approvals.length ? approvals.map(a => `<div style="padding:8px 0;border-bottom:1px solid var(--border)">
            <div class="between"><b>${esc(a.decision)}</b><span class="faint mono">${esc(a.created_at)}</span></div>
            <div class="muted" style="font-size:12.5px">${esc(a.user_name)} (${esc(a.role)})${a.comment ? " — " + esc(a.comment) : ""}</div></div>`).join("") : '<p class="muted">No decisions yet.</p>'}
        </div>
      </div>
      <div class="grid cols-2" style="margin-top:16px">
        <div class="card pad">
          <h2>Where your order is</h2>
          ${orderProgress.length ? orderProgress.map(({ o, pct, next }) => `
            <div style="padding:10px 0;border-bottom:1px solid var(--border)">
              <div class="between"><b>${esc(o.po_code)}</b><span class="badge ${pct === 100 ? "ok" : "warn"}">${pct}%</span></div>
              <div class="progress" style="margin:8px 0 4px"><i style="width:${pct}%"></i></div>
              <div class="muted" style="font-size:12.5px">${esc(o.manufacturer || "")}${next ? ` · next: <b>${esc(next.name)}</b> (ETA ${esc(next.eta)})` : " · delivered"}</div>
            </div>`).join("") : '<p class="muted">Nothing in production yet — once a package is awarded, you\'ll track it here step by step.</p>'}
        </div>
        <div class="card pad">
          <h2>Conversation</h2>
          <p class="muted" style="margin-top:0">Ask a question or leave feedback — the UZA team sees it instantly.</p>
          <label class="field"><textarea id="newComment" rows="2" placeholder="e.g. Can we see a lighter floor option for Bedroom 2?"></textarea></label>
          <button class="btn primary sm" data-action="post-comment">Post comment</button>
          <div style="margin-top:12px">
            ${comments.length ? comments.map(c => `<div style="padding:8px 0;border-bottom:1px solid var(--border)">
              <div class="between"><b style="font-size:12.5px">${esc(c.user_name || "")} <span class="faint">(${esc(c.role || "")})</span></b><span class="faint mono" style="font-size:11px">${esc(c.created_at)}</span></div>
              <div style="font-size:13px;margin-top:2px">${esc(c.body)}</div></div>`).join("") : '<p class="muted">No comments yet.</p>'}
          </div>
        </div>
      </div>
    `, "client");
  });

  // ---- Specifications (spec engine §4.8)
  route("specs", async (args) => {
    const p = S.project;
    const boq = await api.get(`/projects/${p.id}/boq`);
    const cats = Object.keys(boq.by_category);
    const cat = args[0] || cats[0];
    const spec = await api.get(`/projects/${p.id}/specs/${cat}`);
    return shell(`
      <div class="between"><h1>Specification engine</h1>
        <span class="badge ${spec.issue_allowed ? "ok" : "warn"}"><i class="dot"></i>${spec.status}</span></div>
      <p class="muted">Manufacturer-ready technical specifications generated from the materials library. A package cannot be issued for production until every mandatory field (${spec.mandatory_fields.join(", ")}) is complete.</p>
      <div class="pill-row" style="margin:12px 0">
        ${cats.map(c => `<a class="pill ${c === cat ? "active" : ""}" href="#/specs/${c}">${CATS[c] || c}</a>`).join("")}
      </div>
      ${spec.items.map(it => `
        <div class="card pad" style="margin-top:12px;border-left:3px solid ${it.complete ? "var(--ok)" : "var(--warn)"}">
          <div class="between">
            <div class="flex"><span class="swatch lg" style="background:${it.product.swatch}"></span>
              <div><b>${esc(it.product.name)}</b> <span class="mono faint">${esc(it.product.code)}</span>
              <div class="faint" style="font-size:12px">${esc(it.room)} · ${it.qty} ${it.unit} · ${sourceBadge(it.source)}</div></div></div>
            ${it.complete ? '<span class="badge ok">Spec complete</span>' : `<span class="badge warn">Missing: ${it.missing.join(", ")}</span>`}
          </div>
          <table style="margin-top:10px"><tbody>
            <tr><td class="muted" style="width:22%">Use / location</td><td><b>${esc(it.room)}</b></td>
                <td class="muted" style="width:22%">Finish</td><td><b>${esc(it.product.finish || "—")}</b></td></tr>
            <tr><td class="muted">Colour</td><td><b>${esc(it.product.color || "—")}</b></td>
                <td class="muted">Standards</td><td><b>${esc(it.product.standards || "—")}</b></td></tr>
            <tr><td class="muted">Warranty</td><td><b>${esc(it.product.warranty || "—")}</b></td>
                <td class="muted">Manufacturer</td><td><b>${esc(it.product.manufacturer || "TBC")}</b></td></tr>
            <tr><td class="muted">Lead time</td><td><b>${it.product.lead_time_days} days</b></td>
                <td class="muted">Samples</td><td><b>Required before production</b></td></tr>
          </tbody></table>
        </div>`).join("") || '<p class="muted">No items in this category yet.</p>'}
      <div class="card pad" style="margin-top:14px">
        <div class="between"><b>Issue for production</b>
          <button class="btn ${spec.issue_allowed ? "accent" : ""}" ${spec.issue_allowed ? "" : "disabled"} data-action="issue-spec">${spec.issue_allowed ? "Issue package →" : "Blocked — complete mandatory fields"}</button></div>
        <p class="muted" style="margin:6px 0 0">The gate is enforced: information-required specs cannot be issued. This mirrors the RFQ package (see Procurement) once released.</p>
      </div>
    `, "specs");
  });

  // ---- Manufacturer portal (§4.9)
  route("mfg", async () => {
    const d = await api.get("/portal/manufacturer");
    const m = d.manufacturer;
    return shell(`
      <div class="between"><h1>Manufacturer portal</h1><span class="badge info">${esc(m.name)} · ${esc(m.country || "")}</span></div>
      <p class="muted">You see only packages addressed to <b>${esc(m.name)}</b>. Other manufacturers' bids and UZA internal costs are never visible here.</p>
      <div class="card pad" style="margin-top:12px">
        <h2>Your RFQ invitations &amp; quotations</h2>
        ${d.quotations.length ? `<table><thead><tr><th>Package</th><th>Project</th><th class="right">Your unit price</th><th class="right">Lead</th><th>Status</th><th></th></tr></thead>
        <tbody>${d.quotations.map(q => `<tr>
          <td><b>${esc(q.package_code)}</b> <span class="badge">${CATS[q.category] || q.category}</span><div class="faint" style="font-size:11px">${esc(q.scope)} · needed by ${esc(q.required_by)}</div></td>
          <td>${esc(q.project_code)}<div class="faint" style="font-size:11px">${esc(q.location)}</div></td>
          <td class="right mono">${money(q.unit_price, cur())}</td><td class="right mono">${q.lead_time_days}d</td>
          <td><span class="badge ${q.status === "awarded" ? "ok" : q.status === "rejected" ? "" : "warn"}">${q.status}</span></td>
          <td>${q.rfq_status === "open" ? `<button class="btn sm" data-revise="${q.id}" data-price="${q.unit_price}" data-lead="${q.lead_time_days}">Revise bid</button>` : ""}</td>
        </tr>`).join("")}</tbody></table>` : '<p class="muted">No RFQ invitations yet.</p>'}
      </div>
      <div class="card pad" style="margin-top:16px">
        <h2>Your purchase orders — update production</h2>
        ${d.purchase_orders.length ? d.purchase_orders.map(po => {
          const next = po.milestones.find(ms => !ms.done);
          return `<div style="padding:12px 0;border-bottom:1px solid var(--border)">
            <div class="between"><div><b>${esc(po.po_code)}</b> <span class="faint">${esc(po.project_code)} · ${esc(po.location)}</span></div>
              <span class="badge ${po.status === "delivered" ? "ok" : "warn"}">${po.status}</span></div>
            <div class="timeline" style="margin-top:10px">${po.milestones.map(ms =>
              `<div class="tl-item ${ms.done ? "done" : (next && ms.id === next.id) ? "active" : ""}">
                 <div class="between"><b>${esc(ms.name)}</b>
                   <span class="flex">${!ms.done && next && ms.id === next.id ? `<button class="btn accent sm" data-msdone="${ms.id}">Mark complete</button>` : ""}<span class="faint mono">ETA ${esc(ms.eta)}</span></span></div>
               </div>`).join("")}</div>
          </div>`;
        }).join("") : '<p class="muted">No purchase orders yet.</p>'}
      </div>
    `, "mfg");
  });

  // ---- Handover & digital building record (§4.13)
  route("handover", async () => {
    const p = S.project;
    const d = await api.get(`/projects/${p.id}/handover`);
    return shell(`
      <div class="between"><h1>Handover — digital building record</h1>
        <a class="btn" href="/api/projects/${p.id}/handover.csv">⇩ Export record (CSV)</a></div>
      <p class="muted">The as-built material record: every room, every finish, with codes, warranties and suppliers — so a future replacement is one search away.</p>
      <div class="flex wrap" style="margin:10px 0">${d.orders_summary.map(o => `<span class="badge ${o.status === "delivered" ? "ok" : "warn"}">${esc(o.po_code)} · ${o.status}</span>`).join("") || '<span class="muted">No orders yet.</span>'}</div>
      ${d.record.map(entry => `
        <div class="card pad" style="margin-top:12px">
          <div class="between"><h2>${esc(entry.room.name)}</h2><span class="badge">${entry.room.area_m2} m² · ${esc(entry.room.floor)}</span></div>
          ${entry.materials.length ? `<table><thead><tr><th>Category</th><th>Product</th><th>Code</th><th>Finish / colour</th><th>Standards</th><th>Warranty</th><th>Supplier</th></tr></thead>
          <tbody>${entry.materials.map(mtl => `<tr>
            <td>${CATS[mtl.category] || mtl.category}</td><td><b>${esc(mtl.name)}</b></td>
            <td class="mono">${esc(mtl.code)}</td><td>${esc(mtl.finish || "—")} · ${esc(mtl.color || "—")}</td>
            <td class="faint">${esc(mtl.standards || "—")}</td><td>${esc(mtl.warranty || "—")}</td>
            <td>${esc(mtl.manufacturer || "—")}</td></tr>`).join("")}</tbody></table>` : '<p class="muted">No finishes recorded.</p>'}
        </div>`).join("")}
    `, "handover");
  });

  // ---- Document register
  const DOC_KINDS = { drawing: "Drawing set", specification: "Specification", boq: "BOQ", contract: "Contract", "site-report": "Site report", other: "Other" };
  const DOC_BADGE = { submitted: "warn", "under-review": "info", approved: "ok", "revision-requested": "warn", superseded: "" };
  route("documents", async () => {
    const p = S.project;
    const docs = await api.get(`/projects/${p.id}/documents`);
    const canUpload = S.user.role !== "manufacturer";
    const canReview = ["qs", "engineer", "director", "super_admin"].includes(S.user.role);
    const fmtSize = n => n > 1e6 ? (n / 1e6).toFixed(1) + " MB" : Math.max(1, Math.round(n / 1024)) + " KB";
    return shell(`
      <h1>Documents</h1>
      <p class="muted">Every drawing, specification and report registered against <b>${esc(p.code)}</b> — versioned, reviewed, and announced on the Updates bell. Re-uploading the same title creates the next revision and supersedes the old one.</p>
      ${canUpload ? `
      <div class="card pad" style="margin:12px 0 16px">
        <h2>Submit a document</h2>
        <div class="grid cols-3" style="margin-top:8px">
          <label class="field"><span>Title</span><input id="docTitle" placeholder="e.g. Unit B4 — finishes layout"/></label>
          <label class="field"><span>Kind</span><select id="docKind">${Object.entries(DOC_KINDS).map(([k, l]) => `<option value="${k}">${l}</option>`).join("")}</select></label>
          <label class="field"><span>File (max 40 MB)</span><input type="file" id="docFile"/></label>
        </div>
        <div class="flex"><input id="docNote" placeholder="Note for the reviewers (optional)" style="flex:1"/><button class="btn primary" id="docSubmit">Submit for review →</button></div>
      </div>` : ""}
      <div class="card"><table>
        <thead><tr><th>Document</th><th>Kind</th><th class="center">Rev</th><th>Status</th><th>By</th><th class="right">Size</th><th></th>${canReview ? "<th></th>" : ""}</tr></thead>
        <tbody>${docs.length ? docs.map(d => `<tr style="${d.status === "superseded" ? "opacity:.5" : ""}">
          <td><b>${esc(d.title)}</b><div class="faint" style="font-size:11px">${esc(d.note || "")} · ${esc(d.created_at)}</div></td>
          <td>${DOC_KINDS[d.kind] || d.kind}</td>
          <td class="center mono">v${d.version}</td>
          <td><span class="badge ${DOC_BADGE[d.status] || ""}">${d.status.replace("-", " ")}</span></td>
          <td>${esc(d.uploaded_by_name || "—")}</td>
          <td class="right mono">${fmtSize(d.size_bytes)}</td>
          <td><a class="btn sm" href="/api/documents/${d.id}/download">⇩</a></td>
          ${canReview ? `<td class="nowrap">${d.status !== "superseded" ? `
            ${d.status !== "approved" ? `<button class="btn sm" data-doc-status="approved" data-doc="${d.id}">✓ Approve</button>` : ""}
            ${d.status === "submitted" ? `<button class="btn ghost sm" data-doc-status="under-review" data-doc="${d.id}">Review</button>` : ""}
            ${d.status !== "revision-requested" && d.status !== "approved" ? `<button class="btn ghost sm" data-doc-status="revision-requested" data-doc="${d.id}" title="Request revision">↺</button>` : ""}` : ""}</td>` : ""}
        </tr>`).join("") : `<tr><td colspan="8"><div class="empty" style="padding:26px"><div class="big">⎘</div>No documents yet — submit the first drawing set above.</div></td></tr>`}</tbody>
      </table></div>
      <p class="muted" style="margin-top:10px">The client is notified on the <b>◈ Updates</b> bell whenever a document is submitted or its review status changes.</p>
    `, "documents");
  });

  function wireDocuments() {
    const btn = $("#docSubmit");
    if (btn) btn.addEventListener("click", async () => {
      const f = $("#docFile").files[0];
      if (!f) { toast("Choose a file first"); return; }
      const title = $("#docTitle").value.trim() || f.name;
      btn.disabled = true; btn.textContent = "Uploading…";
      try {
        const fd = new FormData();
        fd.append("file", f); fd.append("title", title);
        fd.append("kind", $("#docKind").value); fd.append("note", $("#docNote").value);
        const res = await fetch(`/api/projects/${S.project.id}/documents`, {
          method: "POST", body: fd,
          headers: api.token ? { Authorization: "Bearer " + api.token } : {},
        });
        if (!res.ok) throw new Error((await res.json()).detail || "Upload failed");
        const r = await res.json();
        toast(`${title} submitted as v${r.version} — reviewers and the client are notified.`);
        render();
      } catch (e) { toast(e.message); btn.disabled = false; btn.textContent = "Submit for review →"; }
    });
    document.querySelectorAll("[data-doc-status]").forEach(b => b.addEventListener("click", async () => {
      await api.post(`/documents/${b.dataset.doc}/status`, { status: b.dataset.docStatus });
      toast(`Document marked ${b.dataset.docStatus.replace("-", " ")}`); render();
    }));
  }

  // ---- Audit & AI
  route("audit", async () => {
    const p = S.project;
    const audit = await api.get(`/projects/${p.id}/audit`);
    const ai = await api.get(`/projects/${p.id}/ai`);
    return shell(`
      <h1>Audit &amp; AI log</h1>
      <div class="grid cols-2" style="margin-top:12px">
        <div class="card pad"><h2>AI runs (governed)</h2>
          ${ai.map(a => `<div style="padding:8px 0;border-bottom:1px solid var(--border)">
            <div class="between"><b>${esc(a.kind)}</b><span class="badge ${a.confidence > 0.8 ? "ok" : "warn"}">${Math.round(a.confidence * 100)}%</span></div>
            <div class="muted" style="font-size:12.5px">${esc(a.output)}</div>
            <div class="faint mono" style="font-size:11px;margin-top:3px">${esc(a.model)} · source: ${esc(a.source)}</div></div>`).join("")}
        </div>
        <div class="card pad"><h2>Immutable audit trail</h2>
          <table><tbody>${audit.map(a => `<tr><td style="width:34%"><b>${esc(a.action)}</b><div class="faint mono" style="font-size:11px">${esc(a.created_at)}</div></td><td>${esc(a.detail || "")}<div class="faint" style="font-size:11px">${esc(a.user_name || "system")}</div></td></tr>`).join("")}</tbody></table>
        </div>
      </div>
    `, "audit");
  });

  // ================================================================== Render
  async function render() {
    if (!S.user) {
      if (api.token) {
        try { S.user = await api.get("/me"); await bootData(); }
        catch (e) { api.token = ""; localStorage.removeItem("uza_token"); }
      }
    }
    if (!S.user) {
      if (S.showLogin) { app.innerHTML = loginView(); wireLogin(); }
      else { app.innerHTML = landingView(); wireLanding(); }
      return;
    }

    let { name, args } = currentRoute();
    // manufacturers are confined to their portal
    if (S.user.role === "manufacturer" && name !== "mfg") { name = "mfg"; location.hash = "#/mfg"; }
    const fn = routes[name] || routes[S.user.role === "manufacturer" ? "mfg" : "dashboard"];
    app.innerHTML = `<div class="empty"><div class="big">◱</div>Loading…</div>`;
    try {
      app.innerHTML = await fn(args);
      wireGlobal();
    } catch (e) {
      app.innerHTML = shell(`<div class="empty"><div class="big">⚠</div>${esc(e.message)}</div>`, name);
      wireGlobal();
    }
  }

  function wireGlobal() {
    document.querySelectorAll("[data-action=logout]").forEach(b => b.addEventListener("click", logout));
    wireVision();
    wireDocuments();
    wireLang("langSel");
    // BOQ verify
    document.querySelectorAll("[data-verify]").forEach(b => b.addEventListener("click", async () => {
      await api.post(`/projects/${S.project.id}/boq/verify`, { room_id: Number(b.dataset.room), category: b.dataset.cat });
      toast("Quantity verified by QS"); render();
    }));
    const verifyAll = $("[data-action=verify-all]");
    if (verifyAll) verifyAll.addEventListener("click", async () => {
      const boq = await api.get(`/projects/${S.project.id}/boq`);
      for (const l of boq.lines) if (l.source !== "qs-verified")
        await api.post(`/projects/${S.project.id}/boq/verify`, { room_id: l.room_id, category: l.category });
      toast("All lines verified"); render();
    });
    // materials filter (category pills + free-text search combine)
    const mf = $("#matFilter");
    if (mf) {
      const applyMatFilter = () => {
        const cat = mf.querySelector(".pill.active")?.dataset.cat || "";
        const q = ($("#matSearch")?.value || "").trim().toLowerCase();
        document.querySelectorAll("#matBody tr").forEach(tr => {
          const catOk = !cat || tr.dataset.cat === cat;
          const qOk = !q || tr.textContent.toLowerCase().includes(q);
          tr.style.display = catOk && qOk ? "" : "none";
        });
      };
      mf.querySelectorAll(".pill").forEach(pill => pill.addEventListener("click", () => {
        mf.querySelectorAll(".pill").forEach(x => x.classList.remove("active")); pill.classList.add("active");
        applyMatFilter();
      }));
      $("#matSearch")?.addEventListener("input", applyMatFilter);
    }
    // procurement
    const cr = $("[data-action=create-rfq]");
    if (cr) cr.addEventListener("click", async () => {
      const cat = $("#rfqCat").value;
      const r = await api.post(`/projects/${S.project.id}/rfqs`, { category: cat });
      toast(`RFQ ${r.package_code} issued · ${r.invited} manufacturers invited`); render();
    });
    const vp = $("[data-action=view-package]");
    if (vp) vp.addEventListener("click", () => showPackage($("#pkgCat").value));
    document.querySelectorAll("[data-bids]").forEach(b => b.addEventListener("click", () => showBids(Number(b.dataset.bids))));
    document.querySelectorAll("[data-award]").forEach(b => b.addEventListener("click", async () => {
      const r = await api.post(`/rfqs/${b.dataset.rfq}/award`, { quotation_id: Number(b.dataset.award) });
      toast(`Awarded · ${r.po_code} issued`); render();
    }));
    // drawing intake
    const analyzeBtn = $("[data-action=analyze]");
    if (analyzeBtn) analyzeBtn.addEventListener("click", async () => {
      const fileEl = $("#dwgFile"), textEl = $("#dwgText");
      const fd = new FormData();
      if (fileEl.files[0]) fd.append("file", fileEl.files[0]);
      if (textEl.value.trim()) fd.append("text", textEl.value);
      if (!fileEl.files[0] && !textEl.value.trim()) { toast("Add a drawing or a schedule first"); return; }
      $("#analyzeLbl").textContent = "Analyzing…"; analyzeBtn.disabled = true;
      try {
        const r = await fetch(`/api/projects/${S.project.id}/drawings/analyze`, {
          method: "POST", headers: { Authorization: "Bearer " + api.token }, body: fd });
        if (!r.ok) throw new Error((await r.json()).detail || "Analysis failed");
        renderReport(await r.json());
      } catch (e) { toast(e.message); }
      finally { $("#analyzeLbl").textContent = "Run AI assessment →"; analyzeBtn.disabled = false; }
    });
    // (import button is wired inside renderReport — it's injected after this runs)
    // supplier register
    const asup = $("[data-action=add-supplier]");
    if (asup) asup.addEventListener("click", async () => {
      try {
        await api.post("/manufacturers", {
          name: $("#supName").value, country: $("#supCountry").value,
          categories: $("#supCats").value, lead_time_days: Number($("#supLead").value) || 30,
        });
        toast("Supplier registered"); render();
      } catch (e) { toast(e.message); }
    });
    // activity bell (notifications)
    const bell = $("[data-action=activity]");
    if (bell && S.project) {
      const seenKey = "uza_seen_audit";
      api.get(`/projects/${S.project.id}/audit`).then(events => {
        const lastSeen = Number(localStorage.getItem(seenKey) || 0);
        const fresh = events.filter(e => e.id > lastSeen);
        const badge = $("#notifCount");
        if (fresh.length && badge) { badge.textContent = fresh.length > 9 ? "9+" : fresh.length; badge.style.display = "block"; }
        bell.addEventListener("click", () => {
          const panel = $("#notifPanel");
          if (!panel.classList.toggle("hidden")) {
            panel.innerHTML = `<div class="card pad">
              <div class="between"><h3 style="margin:0">Recent activity</h3><span class="faint" style="font-size:11px">${events.length} events</span></div>
              ${events.slice(0, 12).map(e => `<div style="padding:7px 0;border-bottom:1px solid var(--border)">
                <div class="between"><b style="font-size:12.5px">${esc(e.action)}</b><span class="faint mono" style="font-size:10.5px">${esc((e.created_at || "").slice(5, 16))}</span></div>
                <div class="muted" style="font-size:12px">${esc(e.detail || "")}</div>
                <div class="faint" style="font-size:10.5px">${esc(e.user_name || "system")}</div></div>`).join("")}
            </div>`;
            if (events.length) localStorage.setItem(seenKey, String(events[0].id));
            if (badge) badge.style.display = "none";
          }
        });
      }).catch(() => {});
    }
    // client update: copy + WhatsApp share (customer care / PR)
    const cu = $("[data-action=client-update]");
    if (cu) cu.addEventListener("click", async () => {
      const r = await api.get(`/projects/${S.project.id}/client-update`);
      try { await navigator.clipboard.writeText(r.text); toast("Client update copied — paste into WhatsApp or email"); }
      catch (e) { window.prompt("Copy the update below:", r.text); }
    });
    const wa = $("[data-action=client-wa]");
    if (wa) wa.addEventListener("click", async () => {
      const r = await api.get(`/projects/${S.project.id}/client-update`);
      window.open("https://wa.me/?text=" + encodeURIComponent(r.text), "_blank");
    });
    // production milestones (orders page + manufacturer portal)
    document.querySelectorAll("[data-msdone]").forEach(b => b.addEventListener("click", async () => {
      try {
        const r = await api.post(`/milestones/${b.dataset.msdone}/done`);
        toast(`Milestone complete — order now ${r.po_status}`); render();
      } catch (e) { toast(e.message); }
    }));
    // manufacturer bid revision (inline mini-form)
    document.querySelectorAll("[data-revise]").forEach(b => b.addEventListener("click", () => {
      const td = b.closest("td");
      td.innerHTML = `<div class="flex" style="gap:6px">
        <input id="revPrice" type="number" step="0.1" value="${b.dataset.price}" style="width:90px" title="Unit price $"/>
        <input id="revLead" type="number" value="${b.dataset.lead}" style="width:70px" title="Lead days"/>
        <button class="btn accent sm" id="revGo">Submit</button></div>`;
      td.querySelector("#revGo").addEventListener("click", async () => {
        try {
          const r = await api.put(`/quotations/${b.dataset.revise}`, {
            unit_price: Number(td.querySelector("#revPrice").value),
            lead_time_days: Number(td.querySelector("#revLead").value),
          });
          toast(`Bid revised — landed cost ${money(r.landed_cost, cur())}`); render();
        } catch (e) { toast(e.message); }
      });
    }));
    // spec issue gate
    const iss = $("[data-action=issue-spec]");
    if (iss && !iss.disabled) iss.addEventListener("click", async () => {
      await api.post(`/projects/${S.project.id}/approvals`, {
        subject_type: "specification", decision: "approved",
        comment: "Specification issued for production", impact: "" });
      toast("Specification issued — recorded in the audit trail");
    });
    // client comments
    const pc = $("[data-action=post-comment]");
    if (pc) pc.addEventListener("click", async () => {
      const txt = $("#newComment").value.trim();
      if (!txt) { toast("Write a comment first"); return; }
      await api.post(`/projects/${S.project.id}/comments`, { body: txt });
      toast("Comment posted"); render();
    });
    // client approvals
    document.querySelectorAll("[data-approve]").forEach(b => b.addEventListener("click", async () => {
      const boq = await api.get(`/projects/${S.project.id}/boq`);
      await api.post(`/projects/${S.project.id}/approvals`, {
        subject_type: "design", decision: b.dataset.approve, comment: $("#apprComment")?.value || "",
        impact: JSON.stringify({ value: boq.total }),
      });
      toast("Decision recorded"); render();
    }));
  }

  async function showPackage(category) {
    const p = S.project;
    const pkg = await api.get(`/projects/${p.id}/package/${category}`);
    const bg = document.createElement("div");
    bg.className = "modal-bg";
    bg.innerHTML = `<div class="modal">
      <div class="hd between"><div><h2 style="margin:0">Manufacturer package — ${CATS[category] || category}</h2><span class="faint mono">${esc(pkg.package_code)} · Rev ${pkg.revision} · ${pkg.status}</span></div><button class="btn ghost" data-close>✕</button></div>
      <div class="bd">
        <div class="grid cols-3" style="margin-bottom:14px">
          ${statCard("Project", esc(pkg.project.code), esc(pkg.project.location))}
          ${statCard("Total quantity", pkg.total_qty, "pack-rounded")}
          ${statCard("Line items", pkg.schedule.length, "across rooms")}
        </div>
        <h3>Room / location schedule</h3>
        <table><thead><tr><th>Room</th><th>Product</th><th class="right">Qty</th><th>Source</th></tr></thead>
        <tbody>${pkg.schedule.map(l => `<tr><td>${esc(l.room_name)}</td><td>${esc(l.description.split(" — ")[0])}</td><td class="right mono">${l.ordered_qty} ${l.unit}</td><td>${sourceBadge(l.source)}</td></tr>`).join("")}</tbody></table>
        <h3 style="margin-top:16px">Requirements</h3>
        <ul class="muted">
          <li>Standards: ${pkg.requirements.standards.map(esc).join(", ") || "—"}</li>
          <li>Shop drawings &amp; samples required before production</li>
          <li>Packaging: ${esc(pkg.requirements.packaging)}</li>
          <li>QC checklist: ${pkg.requirements.qc_checklist.map(esc).join(" · ")}</li>
        </ul>
      </div></div>`;
    document.body.appendChild(bg);
    bg.addEventListener("click", e => { if (e.target === bg || e.target.closest("[data-close]")) bg.remove(); });
  }

  render();
})();
