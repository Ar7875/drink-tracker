(() => {
  "use strict";

  /* ----------------------------------------------------------
     Drink assets.
     Every pair (empty / fill / full) shares one canvas, so the layers
     overlap exactly. Numbers are in source-image pixels:
       iw, ih   image canvas size
       ox, oy   top-left of the glass silhouette inside the canvas
       gw, gh   glass silhouette size (sticker outline included)
       liquid   [top, bottom] rows of the liquid in the filled artwork
     rowH / heroH are the silhouette heights in Figma px.
  ---------------------------------------------------------- */
  const DRINKS = [
    { id: "wine",      label: "Wine",      iw: 399, ih: 741, ox: 5,  oy: 5,  gw: 390, gh: 724, liquid: [152, 455], rowH: 85, heroH: 236 },
    { id: "beer",      label: "Beer",      iw: 409, ih: 741, ox: 12, oy: 5,  gw: 393, gh: 717, liquid: [46, 633],  rowH: 83, heroH: 231 },
    { id: "whiskey",   label: "Whiskey",   iw: 462, ih: 489, ox: 5,  oy: 17, gw: 452, gh: 467, liquid: [115, 386], rowH: 54, heroH: 160 },
    { id: "margarita", label: "Margarita", iw: 642, ih: 750, ox: 4,  oy: 32, gw: 549, gh: 712, liquid: [60, 410],  rowH: 81, heroH: 222 },
  ];

  const src = (d, kind) => `assets/${d.id}-${kind}.png`;
  const FULL_AT = 10;
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const dur = (ms) => (reduceMotion ? Math.min(ms, 120) : ms);

  /* ---------------------------------------------------------- DOM */
  const app = document.getElementById("app");
  const row = document.getElementById("row");
  const introTitle = document.getElementById("introTitle");
  const trackTitle = document.getElementById("trackTitle");
  const drinkName = document.getElementById("drinkName");
  const counter = document.getElementById("counter");
  const countEl = document.getElementById("count");
  const minusBtn = document.getElementById("minusBtn");
  const plusBtn = document.getElementById("plusBtn");
  const hero = document.getElementById("hero");
  const heroGlass = document.getElementById("heroGlass");
  const [heroEmpty, heroFill, heroCap] = heroGlass.querySelectorAll(".layer");

  /* ---------------------------------------------------------- State */
  const counts = Object.fromEntries(DRINKS.map((d) => [d.id, 0]));
  let active = null;          // selected drink config
  let level = 0;              // rendered fill 0..1 (animated)
  let levelTween = null;      // { from, to, start, duration }
  let rafId = 0;

  /* Preload everything so the fill layers are ready before first tap */
  DRINKS.forEach((d) => ["empty", "fill", "full"].forEach((k) => { const i = new Image(); i.src = src(d, k); }));

  function applyGlassVars(el, d) {
    el.style.setProperty("--iw", d.iw);
    el.style.setProperty("--ih", d.ih);
    el.style.setProperty("--ox", d.ox);
    el.style.setProperty("--oy", d.oy);
    el.style.setProperty("--gw", d.gw);
    el.style.setProperty("--gh", d.gh);
  }

  /* ---------------------------------------------------------- Row */
  const rowButtons = DRINKS.map((d) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "drink";
    btn.dataset.id = d.id;
    btn.setAttribute("aria-label", `Select ${d.id}`);
    btn.setAttribute("aria-pressed", "false");
    btn.innerHTML = `<div class="glass"><div class="stack"><img class="layer" alt="" draggable="false"></div></div>`;
    const glass = btn.firstElementChild;
    applyGlassVars(glass, d);
    glass.style.setProperty("--row-h", d.rowH);
    glass.querySelector("img").src = src(d, "empty");
    btn.addEventListener("click", () => select(d));
    row.appendChild(btn);
    return btn;
  });
  const rowGlass = (d) => rowButtons[DRINKS.indexOf(d)].firstElementChild;

  /* ---------------------------------------------------------- Fill rendering */
  const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
  const smoothstep = (t) => { t = Math.min(1, Math.max(0, t)); return t * t * (3 - 2 * t); };

  function renderLevel() {
    if (!active) return;
    const top = active.liquid[0] / active.ih;
    const bottom = active.liquid[1] / active.ih;
    // Reveal the filled artwork bottom → top, mapped onto the liquid's own range
    // so each drink raises the surface by a tenth of the glass's liquid height.
    const clipTop = level <= 0.0005 ? 100 : (bottom - level * (bottom - top)) * 100;
    heroFill.style.clipPath = `inset(${clipTop.toFixed(3)}% 0 0 0)`;
    // As the glass tops out, bring in the full artwork (garnish, foam, rim).
    const cap = smoothstep((level - 0.9) / 0.1);
    heroCap.style.opacity = cap.toFixed(3);
    heroEmpty.style.opacity = (1 - cap).toFixed(3);
  }

  function tick(now) {
    rafId = 0;
    if (!levelTween) return;
    const { from, to, start, duration } = levelTween;
    const t = duration <= 0 ? 1 : Math.min(1, (now - start) / duration);
    level = from + (to - from) * easeOutCubic(t);
    renderLevel();
    if (t < 1) rafId = requestAnimationFrame(tick);
    else levelTween = null;
  }

  function animateLevelTo(target, duration = 420) {
    // Always start from the value currently on screen, so rapid taps
    // just retarget the tween and it catches up smoothly.
    levelTween = { from: level, to: target, start: performance.now(), duration: dur(duration) };
    if (!rafId) rafId = requestAnimationFrame(tick);
  }

  function setLevelNow(v) {
    levelTween = null;
    if (rafId) { cancelAnimationFrame(rafId); rafId = 0; }
    level = v;
    renderLevel();
  }

  const fillFor = (n) => Math.min(n / FULL_AT, 1);

  /* ---------------------------------------------------------- Counter */
  const countNum = () => countEl.querySelector(".count-num");

  function showCount(n, dir) {
    const num = countNum();
    const before = [minusBtn, plusBtn].map((b) => b.getBoundingClientRect().left);
    num.textContent = String(n);
    // When the number gains/loses a digit, glide the ± buttons to their new spots
    [minusBtn, plusBtn].forEach((b, i) => {
      const dx = before[i] - b.getBoundingClientRect().left;
      if (Math.abs(dx) < 0.5) return;
      b.animate([{ translate: `${dx}px 0` }, { translate: "0 0" }], {
        duration: dur(280),
        easing: "cubic-bezier(0.22, 1, 0.36, 1)",
      });
    });
    countEl.setAttribute("aria-label", `${n} ${n === 1 ? "drink" : "drinks"}`);
    if (!dir) return;
    num.getAnimations().forEach((a) => a.cancel());
    num.animate(
      [
        { transform: `translateY(${dir > 0 ? 0.16 : -0.16}em) scale(0.94)`, opacity: 0.35 },
        { transform: "translateY(0) scale(1)", opacity: 1 },
      ],
      { duration: dur(260), easing: "cubic-bezier(0.22, 1, 0.36, 1)" }
    );
  }

  function change(delta) {
    if (!active) return;
    const next = Math.max(0, counts[active.id] + delta);
    if (next === counts[active.id]) return;       // never below 0
    counts[active.id] = next;
    showCount(next, delta);
    minusBtn.setAttribute("aria-disabled", String(next === 0));
    animateLevelTo(fillFor(next));
  }

  const pressAnims = new WeakMap();
  function pressFeedback(btn) {
    pressAnims.get(btn)?.cancel();
    pressAnims.set(btn, btn.animate(
      [{ transform: "scale(1)" }, { transform: "scale(0.93)", offset: 0.35 }, { transform: "scale(1)" }],
      { duration: dur(200), easing: "ease-out" }
    ));
  }

  [[minusBtn, -1], [plusBtn, 1]].forEach(([btn, delta]) => {
    btn.addEventListener("pointerdown", () => pressFeedback(btn));
    btn.addEventListener("click", (e) => {
      if (e.detail === 0) pressFeedback(btn);     // keyboard activation
      change(delta);
    });
  });

  /* ---------------------------------------------------------- Selection */
  function setHeroDrink(d) {
    applyGlassVars(heroGlass, d);
    heroGlass.style.setProperty("--hero-h", d.heroH);
    heroEmpty.src = src(d, "empty");
    heroFill.src = src(d, "fill");
    heroCap.src = src(d, "full");
  }

  function flyFromRow(d, { delay = 0 } = {}) {
    heroGlass.getAnimations().forEach((a) => a.cancel());
    const first = rowGlass(d).getBoundingClientRect();
    const last = heroGlass.getBoundingClientRect();
    const k = first.height / last.height;
    const dx = first.left + first.width / 2 - (last.left + last.width / 2);
    const dy = first.top + first.height / 2 - (last.top + last.height / 2);
    return heroGlass.animate(
      [
        { transform: `translate(${dx}px, ${dy}px) scale(${k})` },
        { transform: "translate(0, 0) scale(1)" },
      ],
      { duration: dur(580), delay, easing: "cubic-bezier(0.2, 0.9, 0.28, 1.03)", fill: "backwards" }
    );
  }

  /* Old hero glass slips back down into its slot while the new one rises */
  function sendHeroBack(prev) {
    const rect = heroGlass.getBoundingClientRect();
    const target = rowGlass(prev).getBoundingClientRect();
    const ghost = heroGlass.cloneNode(true);
    ghost.removeAttribute("id");
    ghost.style.position = "fixed";
    ghost.style.left = `${rect.left}px`;
    ghost.style.top = `${rect.top}px`;
    ghost.style.width = `${rect.width}px`;
    ghost.style.height = `${rect.height}px`;
    ghost.style.transformOrigin = "50% 50%";
    ghost.style.margin = "0";
    ghost.style.zIndex = "5";
    document.body.appendChild(ghost);
    const k = target.height / rect.height;
    const dx = target.left + target.width / 2 - (rect.left + rect.width / 2);
    const dy = target.top + target.height / 2 - (rect.top + rect.height / 2);
    ghost.animate(
      [
        { transform: "translate(0,0) scale(1)", opacity: 1 },
        { transform: `translate(${dx}px, ${dy}px) scale(${k})`, opacity: 0 },
      ],
      { duration: dur(420), easing: "cubic-bezier(0.4, 0, 0.2, 1)", fill: "forwards" }
    ).finished.then(() => ghost.remove(), () => ghost.remove());
  }

  function markSelected(d) {
    rowButtons.forEach((b) => {
      const on = b.dataset.id === d.id;
      b.classList.toggle("is-selected", on);
      b.setAttribute("aria-pressed", String(on));
    });
  }

  /* The selected row slot lifts off (hero covers it), then settles back in */
  function reappearInRow(d, delay) {
    const btn = rowButtons[DRINKS.indexOf(d)];
    btn.getAnimations().forEach((a) => a.cancel());
    btn.animate([{ opacity: 0 }, { opacity: 0 }, { opacity: 1 }], {
      duration: dur(delay + 320),
      easing: "ease-out",
    });
  }

  function select(d) {
    if (active && active.id === d.id) return;
    const prev = active;
    const firstTime = !prev;

    if (prev) sendHeroBack(prev);

    active = d;
    setHeroDrink(d);
    setLevelNow(0);
    markSelected(d);
    hero.style.visibility = "visible";

    if (firstTime) enterTracker(d);
    else swapLabel(d);

    reappearInRow(d, 260);
    const flight = flyFromRow(d);

    showCount(counts[d.id], firstTime ? 0 : 1);
    minusBtn.setAttribute("aria-disabled", String(counts[d.id] === 0));

    // Pour this drink's saved count once the glass has landed
    if (counts[d.id] > 0) {
      flight.finished.then(() => { if (active === d) animateLevelTo(fillFor(counts[d.id]), 520); }, () => {});
    }
  }

  function swapLabel(d) {
    drinkName.getAnimations().forEach((a) => a.cancel());
    const out = drinkName.animate([{ opacity: 1 }, { opacity: 0 }], { duration: dur(140), fill: "forwards" });
    out.finished.then(() => {
      drinkName.textContent = d.label;
      out.cancel();
      drinkName.animate([{ opacity: 0 }, { opacity: 1 }], { duration: dur(220), easing: "ease-out" });
    }, () => {});
  }

  /* SS1 → SS2: heading rises and becomes the tracker title, the chosen
     glass travels to centre, the others dim, then the counter arrives. */
  function enterTracker(d) {
    drinkName.textContent = d.label;
    app.dataset.state = "track";

    const introRect = introTitle.getBoundingClientRect();
    const trackRect = trackTitle.querySelector(".track-heading").getBoundingClientRect();
    const rise = (introRect.top + introRect.height / 2) - (trackRect.top + trackRect.height / 2);

    introTitle.animate(
      [
        { transform: "translateY(-50%)", opacity: 1 },
        { transform: `translateY(calc(-50% - ${rise * 0.55}px))`, opacity: 0, offset: 0.55 },
        { transform: `translateY(calc(-50% - ${rise}px))`, opacity: 0 },
      ],
      { duration: dur(520), easing: "cubic-bezier(0.33, 0, 0.2, 1)", fill: "forwards" }
    );
    introTitle.setAttribute("aria-hidden", "true");

    trackTitle.style.opacity = "1";
    trackTitle.removeAttribute("aria-hidden");
    trackTitle.animate(
      [
        { transform: `translateY(${rise * 0.45}px)`, opacity: 0 },
        { transform: "translateY(0)", opacity: 1 },
      ],
      { duration: dur(560), delay: dur(90), easing: "cubic-bezier(0.22, 1, 0.36, 1)", fill: "backwards" }
    );

    counter.style.opacity = "1";
    counter.style.pointerEvents = "auto";
    counter.removeAttribute("aria-hidden");
    minusBtn.tabIndex = 0;
    plusBtn.tabIndex = 0;
    counter.animate(
      [
        { transform: "translateY(calc(-50% + 14px)) scale(0.94)", opacity: 0 },
        { transform: "translateY(-50%) scale(1)", opacity: 1 },
      ],
      { duration: dur(460), delay: dur(300), easing: "cubic-bezier(0.22, 1, 0.36, 1)", fill: "backwards" }
    );

    hero.setAttribute("aria-hidden", "false");
  }

  /* ---------------------------------------------------------- Boot */
  function boot() {
    app.classList.remove("is-booting");
    if (reduceMotion) return;
    introTitle.animate(
      [{ transform: "translateY(calc(-50% + 12px))", opacity: 0 }, { transform: "translateY(-50%)", opacity: 1 }],
      { duration: 600, easing: "cubic-bezier(0.22, 1, 0.36, 1)", fill: "backwards" }
    );
    rowButtons.forEach((b, i) => {
      b.animate(
        [{ transform: "translateY(16px)", opacity: 0 }, { transform: "translateY(0)", opacity: 1 }],
        { duration: 560, delay: 140 + i * 60, easing: "cubic-bezier(0.22, 1, 0.36, 1)", fill: "backwards" }
      );
    });
  }

  app.classList.add("is-booting");
  const fontsReady = document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve();
  Promise.race([fontsReady, new Promise((r) => setTimeout(r, 800))]).then(() => requestAnimationFrame(boot));
})();
