/* UZA Build — real 3D room viewer.
 * Three.js is vendored locally (web/vendor/three.min.js) so the platform
 * stays fully offline-capable. Rooms are built from their TRUE geometry
 * (area + perimeter + height solved to length x width), finishes map to
 * procedural materials (tile grids with grout, wood planks, painted walls),
 * and the whole thing re-skins live when a selection changes.
 */
window.UZA3D = (function () {
  "use strict";

  function dims(room) {
    const A = Number(room.area_m2) || 12;
    const P = Number(room.perimeter_m) || 4 * Math.sqrt(A);
    const H = Number(room.height_m) || 2.7;
    const s = P / 2, disc = (s * s) / 4 - A;
    let L, W;
    if (disc > 0) { L = s / 2 + Math.sqrt(disc); W = A / L; } else { L = W = Math.sqrt(A); }
    return { L: Math.max(L, 1.8), W: Math.max(W, 1.8), H: Math.max(H, 2.2) };
  }

  function specFor(sel, cat) {
    const color = (sel && sel.swatch) || (cat === "ceiling" ? "#fbfbf9" : "#eceae4");
    const name = (((sel && sel.product_name) || "") + " " + ((sel && sel.finish) || "")).toLowerCase();
    if (cat === "floor") {
      if (/oak|wood|plank|grain|spc|vinyl/.test(name)) return { kind: "wood", color, sx: 0.19, sy: 1.9 };
      if (/marble|carrara|8080|800x800/.test(name)) return { kind: "tile", color, sx: 0.8, sy: 0.8, vein: true };
      return { kind: "tile", color, sx: 0.6, sy: 0.6 };
    }
    if (cat === "wall" && /tile|ceramic/.test(name)) return { kind: "tile", color, sx: 0.3, sy: 0.6 };
    return { kind: "plain", color };
  }

  function makeTexture(spec) {
    const c = document.createElement("canvas"); c.width = c.height = 256;
    const x = c.getContext("2d");
    x.fillStyle = spec.color; x.fillRect(0, 0, 256, 256);
    // gentle material noise
    for (let i = 0; i < 500; i++) {
      x.fillStyle = "rgba(0,0,0," + (Math.random() * 0.025).toFixed(3) + ")";
      x.fillRect(Math.random() * 256, Math.random() * 256, 2, 2);
    }
    if (spec.kind === "tile") {
      if (spec.vein) {                       // marble veining
        x.strokeStyle = "rgba(120,120,125,.18)"; x.lineWidth = 1.2;
        for (let v = 0; v < 5; v++) {
          x.beginPath(); let px = Math.random() * 256, py = 0;
          x.moveTo(px, py);
          while (py < 256) { px += (Math.random() - 0.5) * 40; py += 20 + Math.random() * 26; x.lineTo(px, py); }
          x.stroke();
        }
      }
      x.strokeStyle = "rgba(60,60,60,.5)"; x.lineWidth = 6;
      x.strokeRect(0, 0, 256, 256);          // one tile per repeat, grout at edges
    } else if (spec.kind === "wood") {
      const g = x.createLinearGradient(0, 0, 256, 0);
      g.addColorStop(0, "rgba(0,0,0,.10)"); g.addColorStop(0.5, "rgba(255,255,255,.05)"); g.addColorStop(1, "rgba(0,0,0,.14)");
      x.fillStyle = g; x.fillRect(0, 0, 256, 256);
      x.strokeStyle = "rgba(70,45,20,.25)"; x.lineWidth = 1;
      for (let i = 0; i < 7; i++) {          // grain
        x.beginPath(); x.moveTo(0, 18 + i * 34 + Math.random() * 8);
        x.bezierCurveTo(80, 10 + i * 34, 170, 30 + i * 34, 256, 16 + i * 34);
        x.stroke();
      }
      x.strokeStyle = "rgba(40,25,10,.4)"; x.lineWidth = 3;
      x.strokeRect(0, 0, 256, 256);
    }
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    return t;
  }

  function surfaceMaterial(spec, w, h, side) {
    const mat = new THREE.MeshStandardMaterial({ side: side || THREE.FrontSide, roughness: 0.9, metalness: 0.02 });
    if (spec.kind === "plain") { mat.color = new THREE.Color(spec.color); return mat; }
    const t = makeTexture(spec);
    t.repeat.set(Math.max(1, w / spec.sx), Math.max(1, h / spec.sy));
    mat.map = t;
    mat.roughness = spec.vein || /gloss|polish/i.test(spec.kind) ? 0.35 : 0.75;
    return mat;
  }

  function mount(el, room, selections) {
    const { L, W, H } = dims(room);
    const get = c => (selections || []).find(s => s.category === c);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xe8ebef);
    const cam = new THREE.PerspectiveCamera(52, Math.max(el.clientWidth, 200) / Math.max(el.clientHeight, 200), 0.05, 200);
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(Math.max(el.clientWidth, 200), Math.max(el.clientHeight, 200));
    el.innerHTML = ""; el.appendChild(renderer.domElement);
    renderer.domElement.style.cursor = "grab";

    // lights
    scene.add(new THREE.HemisphereLight(0xffffff, 0x8fa0b3, 1.05));
    const sun = new THREE.DirectionalLight(0xfff4e0, 0.65); sun.position.set(-L, H * 1.6, W); scene.add(sun);
    let group = null;

    function build(sels) {
      const g2 = c => (sels || []).find(s => s.category === c);
      if (group) { scene.remove(group); }
      group = new THREE.Group();

      // the room shell: one box, interior faces only (dollhouse view)
      const paint = g2("paint"), wallSel = g2("wall"), ceil = g2("ceiling"), floor = g2("floor");
      const paintSpec = { kind: "plain", color: (paint && paint.swatch) || "#f2f0ea" };
      const featureSpec = wallSel ? specFor(wallSel, "wall") : paintSpec;
      const mats = [
        surfaceMaterial(paintSpec, W, H, THREE.BackSide),                       // +x
        surfaceMaterial(paintSpec, W, H, THREE.BackSide),                       // -x
        surfaceMaterial({ kind: "plain", color: (ceil && ceil.swatch) || "#fbfbf9" }, L, W, THREE.BackSide), // ceiling
        surfaceMaterial(specFor(floor, "floor"), L, W, THREE.BackSide),         // floor
        surfaceMaterial(paintSpec, L, H, THREE.BackSide),                       // +z
        surfaceMaterial(featureSpec, L, H, THREE.BackSide),                     // -z feature wall
      ];
      const shell = new THREE.Mesh(new THREE.BoxGeometry(L, H, W), mats);
      shell.position.y = H / 2;
      group.add(shell);

      // skirting hint
      const skirt = new THREE.Mesh(new THREE.BoxGeometry(L - 0.02, 0.08, W - 0.02),
        new THREE.MeshStandardMaterial({ color: 0xffffff, side: THREE.BackSide, roughness: 0.6 }));
      skirt.position.y = 0.04; group.add(skirt);

      // window on the feature (-z) wall
      const win = new THREE.Mesh(new THREE.PlaneGeometry(Math.min(1.6, L * 0.4), 1.1),
        new THREE.MeshBasicMaterial({ color: 0xcfe8f2 }));
      win.position.set(0, 1.45, -W / 2 + 0.015); group.add(win);
      const frame = new THREE.Mesh(new THREE.BoxGeometry(Math.min(1.7, L * 0.42), 1.2, 0.05),
        new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.5 }));
      frame.position.set(0, 1.45, -W / 2 + 0.002); group.add(frame);

      // door on +x wall
      const door = g2("door");
      const doorMesh = new THREE.Mesh(new THREE.BoxGeometry(0.06, 2.05, 0.92),
        new THREE.MeshStandardMaterial({ color: (door && door.swatch) || 0xa9764a, roughness: 0.65 }));
      doorMesh.position.set(L / 2 - 0.045, 1.025, W * 0.22); group.add(doorMesh);

      // kitchen counter along the feature wall
      const kit = g2("kitchen");
      if (kit) {
        const len = Math.min(L * 0.72, 3.2);
        const base = new THREE.Mesh(new THREE.BoxGeometry(len, 0.88, 0.6),
          new THREE.MeshStandardMaterial({ color: kit.swatch, roughness: 0.55 }));
        base.position.set(-(L / 2) + len / 2 + 0.15, 0.44, -W / 2 + 0.32); group.add(base);
        const top = new THREE.Mesh(new THREE.BoxGeometry(len + 0.04, 0.045, 0.64),
          new THREE.MeshStandardMaterial({ color: 0x2c2f33, roughness: 0.3 }));
        top.position.set(base.position.x, 0.9, base.position.z); group.add(top);
      }

      // wardrobe in a corner
      const wr = g2("wardrobe");
      if (wr) {
        const wrM = new THREE.Mesh(new THREE.BoxGeometry(1.6, 2.2, 0.62),
          new THREE.MeshStandardMaterial({ color: wr.swatch, roughness: 0.6 }));
        wrM.position.set(L / 2 - 0.95, 1.1, -W / 2 + 0.35); group.add(wrM);
      }

      // sanitaryware proxies
      const san = g2("sanitaryware");
      if (san) {
        const white = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.25 });
        const basin = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.2, 0.16, 24), white);
        basin.position.set(-L / 2 + 0.5, 0.85, W / 2 - 0.45); group.add(basin);
        const ped = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.8, 0.3), white);
        ped.position.set(-L / 2 + 0.5, 0.4, W / 2 - 0.45); group.add(ped);
        const wc = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.42, 0.62), white);
        wc.position.set(-L / 2 + 1.25, 0.21, W / 2 - 0.42); group.add(wc);
      }

      // lighting fixtures
      const lit = g2("lighting");
      if (lit) {
        const glowM = new THREE.MeshBasicMaterial({ color: 0xfff3cf });
        for (const fx of [-L / 4, L / 4]) {
          const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.02, 20), glowM);
          disc.position.set(fx, H - 0.02, 0); group.add(disc);
        }
        const pt = new THREE.PointLight(0xffe0b0, 0.55, Math.max(L, W) * 2);
        pt.position.set(0, H - 0.3, 0); group.add(pt);
      }
      scene.add(group);
    }
    build(selections);

    // custom orbit (drag) + zoom (wheel) — no OrbitControls dependency
    const center = new THREE.Vector3(0, H * 0.42, 0);
    let theta = Math.PI / 3.7, phi = 1.12, radius = Math.max(L, W) * 1.02 + H * 0.55;
    const minR = Math.max(L, W) * 0.55, maxR = Math.max(L, W) * 3.2;
    function place() {
      cam.position.set(
        center.x + radius * Math.sin(phi) * Math.sin(theta),
        center.y + radius * Math.cos(phi),
        center.z + radius * Math.sin(phi) * Math.cos(theta));
      cam.lookAt(center);
    }
    place();
    let dragging = false, lx = 0, ly = 0;
    const dom = renderer.domElement;
    const onDown = e => { dragging = true; lx = e.clientX; ly = e.clientY; dom.style.cursor = "grabbing"; };
    const onMove = e => {
      if (!dragging) return;
      theta -= (e.clientX - lx) * 0.006; phi -= (e.clientY - ly) * 0.005;
      phi = Math.min(1.45, Math.max(0.18, phi));
      lx = e.clientX; ly = e.clientY; place();
    };
    const onUp = () => { dragging = false; dom.style.cursor = "grab"; };
    const onWheel = e => { e.preventDefault(); radius *= (1 + Math.sign(e.deltaY) * 0.08); radius = Math.min(maxR, Math.max(minR, radius)); place(); };
    dom.addEventListener("pointerdown", onDown);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    dom.addEventListener("wheel", onWheel, { passive: false });

    const ro = new ResizeObserver(() => {
      if (!el.isConnected) return;
      cam.aspect = Math.max(el.clientWidth, 100) / Math.max(el.clientHeight, 100);
      cam.updateProjectionMatrix();
      renderer.setSize(el.clientWidth, el.clientHeight);
    });
    ro.observe(el);

    let raf = 0, dead = false;
    (function loop() {
      if (dead) return;
      if (!dom.isConnected) { api.dispose(); return; }   // route changed away
      renderer.render(scene, cam);
      raf = requestAnimationFrame(loop);
    })();

    const api = {
      label: `${L.toFixed(1)} m × ${W.toFixed(1)} m × ${H.toFixed(1)} m — true geometry`,
      update(sels) { build(sels); },
      dispose() {
        if (dead) return; dead = true;
        cancelAnimationFrame(raf); ro.disconnect();
        dom.removeEventListener("pointerdown", onDown);
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        dom.removeEventListener("wheel", onWheel);
        renderer.dispose();
        if (dom.parentNode) dom.parentNode.removeChild(dom);
      },
    };
    return api;
  }

  return { mount };
})();
