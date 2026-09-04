/* Coach! — know your next move. Internal tool; all state lives on the device. */
'use strict';

/* ---------- palette: one colour per day type, black text on every fill ---------- */
const DAYS = {
  push:  { label: 'Push',  color: '#FF6B60', blurb: 'Chest, shoulders, triceps' },
  pull:  { label: 'Pull',  color: '#0DABFF', blurb: 'Back and biceps' },
  legs:  { label: 'Legs',  color: '#BE7DFF', blurb: 'Quads, hamstrings, calves' },
  upper: { label: 'Upper', color: '#E88600', blurb: 'Push and pull, compressed' },
  lower: { label: 'Lower', color: '#00C24E', blurb: 'Everything below the belt' }
};
const DAY_ORDER = ['push', 'pull', 'legs', 'upper', 'lower'];

/* Upper = push + pull movements. Lower = legs. So exercises carry several groups. */
const CATALOGUE = [
  { id: 'bench',    name: 'Bench Press',            groups: ['push','upper'],  inc: 2.5,  bar: true },
  { id: 'incline',  name: 'Incline Dumbbell Press', groups: ['push','upper'],  inc: 2.5 },
  { id: 'ohp',      name: 'Overhead Press',         groups: ['push','upper'],  inc: 2.5,  bar: true },
  { id: 'dips',     name: 'Dips',                   groups: ['push','upper'],  inc: 2.5 },
  { id: 'fly',      name: 'Cable Fly',              groups: ['push','upper'],  inc: 2.5 },
  { id: 'pushdown', name: 'Triceps Pushdown',       groups: ['push','upper'],  inc: 2.5 },
  { id: 'lateral',  name: 'Lateral Raise',          groups: ['push','upper'],  inc: 1.25 },
  { id: 'row',      name: 'Barbell Row',            groups: ['pull','upper'],  inc: 2.5,  bar: true },
  { id: 'pulldown', name: 'Lat Pulldown',           groups: ['pull','upper'],  inc: 2.5 },
  { id: 'pullup',   name: 'Pull-up',                groups: ['pull','upper'],  inc: 2.5 },
  { id: 'facepull', name: 'Face Pull',              groups: ['pull','upper'],  inc: 2.5 },
  { id: 'curl',     name: 'Dumbbell Curl',          groups: ['pull','upper'],  inc: 1.25 },
  { id: 'hammer',   name: 'Hammer Curl',            groups: ['pull','upper'],  inc: 1.25 },
  { id: 'squat',    name: 'Back Squat',             groups: ['legs','lower'],  inc: 2.5,  bar: true },
  { id: 'rdl',      name: 'Romanian Deadlift',      groups: ['legs','lower'],  inc: 2.5,  bar: true },
  { id: 'legpress', name: 'Leg Press',              groups: ['legs','lower'],  inc: 5 },
  { id: 'legcurl',  name: 'Leg Curl',               groups: ['legs','lower'],  inc: 2.5 },
  { id: 'legext',   name: 'Leg Extension',          groups: ['legs','lower'],  inc: 2.5 },
  { id: 'hip',      name: 'Hip Thrust',             groups: ['legs','lower'],  inc: 5,    bar: true },
  { id: 'calf',     name: 'Calf Raise',             groups: ['legs','lower'],  inc: 2.5 }
];
const byId = id => CATALOGUE.find(x => x.id === id);

/* ---------- the maths (carried over verbatim; verified by the suite) ---------- */
const ZONES = {
  bigger:   { pct: 0.725, reps: '6–8',  top: 8, bottom: 6, sets: 3, rest: '90 sec', label: 'Bigger',   pctText: '67–78%' },
  stronger: { pct: 0.85,  reps: '3–5',  top: 5, bottom: 3, sets: 4, rest: '3 min',  label: 'Stronger', pctText: '82–87%' }
};
const epley = (w, reps, rir) => w * (1 + (reps + rir) / 30);
/* The single progression rule. Everything that answers "what next?" calls this. */
function nextWeight(prev, z, inc, base) {
  if (!prev) return { w: base, why: 'hold' };
  if (prev.r >= z.top && prev.rir >= 1) return { w: snap(prev.w + inc, inc), why: 'up' };
  if (prev.r < z.bottom)                return { w: snap(prev.w * 0.925, inc), why: 'down' };
  return { w: prev.w, why: 'hold' };
}
const snap = (w, inc) => Math.max(inc, Math.round(w / inc) * inc);
const num = v => String(Math.round(v * 100) / 100).replace(/\.0+$/, '');

/* ---------- storage ---------- */
const KEY = 'coach.v1';
const blank = () => ({
  settings: { goal: 'bigger', unit: 'kg', plate: 1.25, setupDone: false },
  exercises: {},                 // id -> { e1rm, last:{w,r,rir} }
  sessions: [],                  // finished
  current: null                  // { type, exIds, idx, log:{ id:[{w,r,rir}] } }
});
let S = blank();
function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) S = Object.assign(blank(), JSON.parse(raw));
  } catch (e) { S = blank(); }
}
function save() {
  try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) {}
}

/* ---------- helpers ---------- */
const $ = sel => document.querySelector(sel);
const app = () => document.getElementById('app');
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[c]));
const dayColor = t => (DAYS[t] ? DAYS[t].color : '#0A0A0A');
/* Local calendar date. toISOString() is UTC and silently shifts the day
   for anyone not on GMT — that put sessions on the wrong square in History. */
function localISO(d) {
  d = d || new Date();
  const p = n => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}
const todayISO = () => localISO();
function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.classList.add('on');
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('on'), 1600);
}
function daysAgo(iso) {
  const d = Math.round((Date.parse(todayISO()) - Date.parse(iso)) / 86400000);
  return d <= 0 ? 'today' : d === 1 ? 'yesterday' : d + ' days ago';
}
function fmtDate(iso) {
  const d = new Date(iso + 'T00:00:00');
  return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
}

/* the one suggestion the app makes — never a prescription */
function suggestion() {
  const seen = {};
  S.sessions.forEach(s => { if (!seen[s.type]) seen[s.type] = s.date; });
  const core = ['push', 'pull', 'legs'].filter(t => !seen[t]);
  if (core.length) return { type: core[0], why: 'not logged yet' };
  let oldest = null;
  ['push', 'pull', 'legs'].forEach(t => {
    if (!oldest || Date.parse(seen[t]) < Date.parse(seen[oldest])) oldest = t;
  });
  return { type: oldest, why: 'last done ' + daysAgo(seen[oldest]) };
}

/* prescription for one exercise, given its stored 1RM and the chosen goal */
function prescribe(exId) {
  const ex = byId(exId);
  const rec = S.exercises[exId];
  const z = ZONES[S.settings.goal];
  if (!rec || !rec.e1rm) return { unknown: true, ex, zone: z };
  const inc = ex.inc;
  const sets = (S.current && S.current.log[exId]) ? S.current.log[exId] : [];
  const done = sets.length;
  const left = Math.max(0, z.sets - done);
  const base = snap(rec.e1rm * z.pct, inc);

  // What to do next follows the LAST SET ACTUALLY PERFORMED, not an assumption.
  const prev = sets.length ? sets[sets.length - 1] : null;
  const nx = nextWeight(prev, z, inc, base);
  const weight = nx.w, why = nx.why;

  return {
    unknown: false, ex, zone: z, inc, done, left,
    e1rm: rec.e1rm, weight: weight, why: why,
    finished: left === 0,
    last: prev || rec.last
  };
}

/* ---------- icons ---------- */
const I = {
  today:   '<path d="M4 9.5v5M8 7v10M16 7v10M20 9.5v5M8 12h8"/>',
  history: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3.2 2"/>',
  progress:'<path d="M3.5 16.5l5.5-5.5 3.5 3.5 8-8"/><path d="M16.5 6.5h4v4"/>',
  back:    '<path d="M15 18l-6-6 6-6"/>',
  fwd:     '<path d="M9 6l6 6-6 6"/>',
  plus:    '<path d="M12 5v14M5 12h14"/>',
  check:   '<path d="M20 6L9 17l-5-5"/>',
  info:    '<circle cx="12" cy="12" r="9"/><path d="M12 16v-4M12 8.5v.01"/>',
  gear:    '<path d="M4 7h8M17 7h3M4 17h3M12 17h8"/><circle cx="14.5" cy="7" r="2.5"/><circle cx="9.5" cy="17" r="2.5"/>'
};
const svg = (k, size, color, sw) =>
  '<svg width="' + (size||22) + '" height="' + (size||22) + '" viewBox="0 0 24 24" fill="none" stroke="' +
  (color||'currentColor') + '" stroke-width="' + (sw||2.1) + '" stroke-linecap="round" stroke-linejoin="round">' + I[k] + '</svg>';

/* ---------- router ---------- */
let route = { name: 'today', tab: 'today' };
function go(name, opts) {
  route = Object.assign({ name: name }, opts || {});
  if (['today','history','progress'].indexOf(name) !== -1) route.tab = name;
  render();
}

function tabbar(active) {
  return '<nav class="tabbar">' + ['today','history','progress'].map(function (k) {
    const on = k === active;
    return '<button class="tab" role="tab" aria-selected="' + on + '" data-go="' + k + '">' +
      svg(k, 23, 'currentColor', on ? 2.3 : 2) +
      '<span>' + (k === 'today' ? 'Today' : k === 'history' ? 'History' : 'Progress') + '</span></button>';
  }).join('') + '</nav>';
}
const header = (title, right) =>
  '<div class="top"><button class="mark" style="font-size:22px" data-go="today">COACH!</button>' +
  (right || '') + '</div>';

const pushHeader = (title, backTo) =>
  '<div class="top"><button data-go="' + backTo + '" style="width:36px;height:36px;display:flex;align-items:center">' +
  svg('back', 20, '#0A0A0A', 2.4) + '</button>' +
  '<div style="font-family:Outfit,sans-serif;font-size:16px;font-weight:700">' + esc(title) + '</div>' +
  '<div style="width:36px"></div></div>';

/* ---------- view: setup ---------- */
function vSetup() {
  const s = S.settings;
  const goalCard = (k) => {
    const on = s.goal === k, z = ZONES[k];
    return '<button data-goal="' + k + '" style="text-align:left;border-radius:22px;padding:' + (on ? '17px 18px' : '18px 19px') +
      ';border:' + (on ? '2px solid #0A0A0A' : '1px solid var(--line)') + ';background:' + (on ? 'var(--surface)' : '#fff') + ';width:100%">' +
      '<div class="split"><span class="h2">Get ' + (k === 'stronger' ? 'stronger' : 'bigger') + '</span>' +
      '<span style="width:22px;height:22px;border-radius:50%;flex:0 0 auto;' +
      (on ? 'background:#0A0A0A;box-shadow:inset 0 0 0 4px var(--surface),inset 0 0 0 5px #0A0A0A' : 'border:1px solid #DCDCE2') + '"></span></div>' +
      '<div class="sub" style="margin-top:5px">' + (k === 'stronger'
        ? 'Heavy, low reps. 3–5 reps at 82–87% of your max, longer rests.'
        : 'Moderate weight, more reps. 6–12 reps at 67–78%, shorter rests.') + '</div></button>';
  };
  const pill = (label, on, attr) =>
    '<button ' + attr + ' style="flex:1;height:46px;border-radius:23px;font-family:Outfit,sans-serif;font-weight:' +
    (on ? '700' : '600') + ';font-size:15px;' + (on ? 'background:#0A0A0A;color:#fff' : 'background:#fff;color:var(--muted);border:1px solid var(--hair)') + '">' + label + '</button>';
  const plates = s.unit === 'kg' ? [1.25, 2.5, 5] : [2.5, 5, 10];

  return '<div class="view on">' +
    '<div class="scroll">' +
    '<div class="top"><div class="mark" style="font-size:22px">COACH!</div></div>' +
    '<div class="pad" style="padding-top:20px"><div class="h1">Two questions and<br>we\'re training.</div></div>' +
    '<div class="pad" style="padding-top:26px"><div class="eyebrow" style="color:var(--faint)">What are you after</div>' +
    '<div class="list" style="margin-top:13px">' + goalCard('stronger') + goalCard('bigger') + '</div></div>' +
    '<div class="pad" style="padding-top:24px"><div class="eyebrow" style="color:var(--faint)">Units</div>' +
    '<div style="display:flex;gap:8px;margin-top:11px">' +
      pill('Kilograms', s.unit === 'kg', 'data-unit="kg"') + pill('Pounds', s.unit === 'lb', 'data-unit="lb"') + '</div></div>' +
    '<div class="pad" style="padding-top:22px"><div class="eyebrow" style="color:var(--faint)">Smallest plate pair you own</div>' +
    '<div style="display:flex;gap:8px;margin-top:11px">' +
      plates.map(p => pill(p + ' ' + s.unit, Math.abs(p - s.plate) < 0.01, 'data-plate="' + p + '"')).join('') + '</div>' +
    '<div class="sub" style="margin-top:12px">So Coach never asks you for a weight you can\'t load.</div></div>' +
    '<div style="height:24px"></div></div>' +
    '<div class="footer"><button class="btn btn-dark" data-setup-done="1">Start training</button></div></div>';
}

/* ---------- view: today ---------- */
function vToday() {
  const cur = S.current;
  if (!cur) {
    const sug = suggestion();
    const tiles = DAY_ORDER.map(function (k) {
      const d = DAYS[k];
      return '<button class="daytile" data-pick-day="' + k + '" style="background:' + d.color + '">' +
        '<div class="t">' + d.label + '</div><div class="s">' + esc(d.blurb) + '</div></button>';
    });
    return '<div class="view on">' +
      '<div class="scroll">' +
      header('', '<button data-go="setup" style="width:36px;height:36px;display:flex;align-items:center;justify-content:flex-end">' + svg('gear', 21, '#0A0A0A', 2) + '</button>') +
      '<div class="pad" style="padding-top:24px">' +
        '<div class="h1">What are you<br>training today?</div>' +
        '<div class="sub" style="margin-top:8px">' +
          (S.sessions.length
            ? 'Coach would say ' + DAYS[sug.type].label + ' — ' + sug.why + '. Up to you.'
            : 'Pick anything. Coach learns your weights as you log them.') +
        '</div>' +
      '</div>' +
      '<div class="pad" style="padding-top:20px;display:grid;grid-template-columns:1fr 1fr;gap:10px">' +
        tiles.slice(0, 4).join('') +
      '</div>' +
      '<div class="pad" style="padding-top:10px">' + tiles[4] + '</div>' +
      (installPrompt && !isStandalone()
        ? '<div class="installbar" style="margin-top:18px"><button class="btn btn-dark" data-install="1" style="height:52px;font-size:16px">' +
          'Install Coach! on this phone</button>' +
          '<div class="faint" style="text-align:center;margin-top:8px">Adds it to your app drawer. Works offline.</div></div>'
        : '') +
      '<div style="height:24px"></div>' +
      '</div>' + tabbar('today') + '</div>';
  }

  const d = DAYS[cur.type];
  const rows = cur.exIds.map(function (id, i) {
    const p = prescribe(id);
    const now = i === cur.idx;
    const doneCount = (cur.log[id] || []).length;
    const target = p.unknown ? 'First time — tell Coach one set'
      : (p.finished ? 'Done · next time ' + num(p.weight) + ' ' + S.settings.unit
                    : num(p.weight) + ' ' + S.settings.unit + ' × ' + p.zone.reps);
    return '<button data-open-ex="' + i + '" class="row" style="width:100%;text-align:left;border-radius:18px;padding:14px 16px;' +
      (now ? 'background:#0A0A0A;color:#fff' : 'border:1px solid var(--line)') + '">' +
      '<div class="grow"><div class="clip" style="font-family:Outfit,sans-serif;font-size:16px;font-weight:700">' + esc(p.ex.name) + '</div>' +
      '<div style="font-size:13px;margin-top:2px;color:' + (now ? 'rgba(255,255,255,.62)' : 'var(--faint)') + '">' + esc(target) + '</div></div>' +
      (doneCount ? '<span class="faint" style="color:' + (now ? d.color : 'var(--faint)') + ';font-weight:700">' + doneCount + '/' + p.zone.sets + '</span>'
                 : svg('fwd', 17, now ? 'rgba(255,255,255,.5)' : '#C8C8D0', 2.4)) +
      '</button>';
  }).join('');

  const anyLogged = cur.exIds.some(id => (cur.log[id] || []).length);
  return '<div class="view on" style="--day:' + d.color + '">' +
    '<div class="scroll">' +
    header('', '<button data-abandon="1" class="faint" style="font-weight:600">Cancel</button>') +
    '<div class="pad" style="padding-top:22px">' +
      '<span class="pill" style="background:' + d.color + '">' + d.label + ' day</span>' +
      '<div class="h1" style="margin-top:12px">Today</div>' +
      '<div class="sub" style="margin-top:4px">' + cur.exIds.length + ' exercise' + (cur.exIds.length === 1 ? '' : 's') + '</div>' +
    '</div>' +
    '<div class="pad list" style="padding-top:20px">' + (rows ||
      '<div class="empty">Nothing added yet.<br>Pick what\'s actually free in the gym.</div>') +
      '<button class="btn-ghost" data-go="library">' + svg('plus', 17, 'var(--muted)', 2.4) + 'Add exercise</button>' +
    '</div><div style="height:24px"></div></div>' +
    '<div class="footer">' +
      (cur.exIds.length
        ? '<button class="btn btn-day" data-open-ex="' + cur.idx + '">' + (anyLogged ? 'Continue' : 'Start') + ' with ' + esc(byId(cur.exIds[cur.idx]).name) + '</button>'
        : '<button class="btn btn-day" data-go="library">Add exercises</button>') +
      (anyLogged ? '<button class="btn" style="height:46px;color:var(--muted);font-size:15px" data-finish="1">Finish session</button>' : '') +
    '</div>' + tabbar('today') + '</div>';
}

/* ---------- view: library ---------- */
function vLibrary() {
  const cur = S.current;
  const d = DAYS[cur.type];
  const filter = route.filter || cur.type;
  const q = (route.q || '').trim().toLowerCase();

  const chips = [cur.type, 'all'].concat(DAY_ORDER.filter(k => k !== cur.type))
    .filter((v, i, a) => a.indexOf(v) === i)
    .map(function (k) {
      const on = filter === k;
      const label = k === 'all' ? 'All' : DAYS[k].label;
      return '<button class="chip" aria-pressed="' + on + '" data-filter="' + k + '">' +
        (k === 'all' ? '' : '<span class="dot" style="background:' + DAYS[k].color + '"></span>') + label + '</button>';
    }).join('');

  const rows = CATALOGUE
    .filter(x => filter === 'all' || x.groups.indexOf(filter) !== -1)
    .filter(x => !q || x.name.toLowerCase().indexOf(q) !== -1)
    .map(function (x) {
      const on = cur.exIds.indexOf(x.id) !== -1;
      const rec = S.exercises[x.id];
      const meta = on ? 'Added'
        : rec && rec.last ? 'Last time ' + num(rec.last.w) + ' ' + S.settings.unit + ' × ' + rec.last.r
        : 'New to Coach';
      return '<button data-toggle-ex="' + x.id + '" class="row" style="width:100%;text-align:left;border-radius:18px;padding:14px 16px;' +
        (on ? 'background:color-mix(in srgb,' + d.color + ' 16%,#fff);border:1px solid ' + d.color : 'border:1px solid var(--line)') + '">' +
        '<div class="grow"><div class="clip" style="font-family:Outfit,sans-serif;font-size:16px;font-weight:700">' + esc(x.name) + '</div>' +
        '<div style="font-size:13px;margin-top:2px;color:var(--faint)">' + esc(meta) + '</div></div>' +
        '<span style="width:28px;height:28px;border-radius:50%;flex:0 0 auto;display:flex;align-items:center;justify-content:center;' +
        (on ? 'background:' + d.color : 'border:1px solid #DCDCE2') + '">' +
        svg(on ? 'check' : 'plus', 15, on ? '#0A0A0A' : '#B8B8C0', 2.8) + '</span></button>';
    }).join('');

  const n = cur.exIds.length;
  return '<div class="view on" style="--day:' + d.color + '">' +
    pushHeader('Add to ' + d.label + ' day', 'today') +
    '<div class="pad" style="padding-top:18px"><label class="field">' +
      '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#A0A0A8" stroke-width="2.2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="M16.5 16.5L21 21"/></svg>' +
      '<input id="q" placeholder="Search exercises" value="' + esc(route.q || '') + '" ' +
      'style="border:0;background:none;outline:none;font:inherit;width:100%;color:var(--ink)"></label></div>' +
    '<div class="pad chips" style="padding-top:14px;flex-wrap:nowrap;overflow-x:auto">' + chips + '</div>' +
    '<div class="scroll pad list" style="padding-top:16px">' +
      (rows || '<div class="empty">Nothing matches that.</div>') + '<div style="height:12px"></div></div>' +
    '<div class="footer" style="border-top:1px solid var(--line)">' +
      '<button class="btn ' + (n ? 'btn-day' : '') + '" ' + (n ? '' : 'aria-disabled="true"') + ' data-go="today">' +
      (n ? 'Done — ' + n + ' exercise' + (n === 1 ? '' : 's') : 'Pick at least one') + '</button></div></div>';
}

/* ---------- view: coach ---------- */
function vCoach() {
  const cur = S.current;
  const d = DAYS[cur.type];
  const id = cur.exIds[cur.idx];
  const p = prescribe(id);
  const z = p.zone;

  const seg = '<div class="seg" style="margin-top:20px">' +
    ['stronger','bigger'].map(k => '<button role="tab" aria-selected="' + (S.settings.goal === k) + '" data-goal="' + k + '">' +
      (k === 'stronger' ? 'Stronger' : 'Bigger') + '</button>').join('') + '</div>';

  const nav = '<div class="top" style="padding-left:20px;padding-right:20px">' +
    '<button data-step="-1" style="width:40px;height:40px;display:flex;align-items:center;justify-content:center">' + svg('back', 21, '#0A0A0A', 2.4) + '</button>' +
    '<div style="text-align:center" class="grow"><div class="clip" style="font-family:Outfit,sans-serif;font-size:17px;font-weight:700">' + esc(p.ex.name) + '</div>' +
    '<div class="faint" style="font-size:12px">' + (cur.idx + 1) + ' of ' + cur.exIds.length + '</div></div>' +
    '<button data-step="1" style="width:40px;height:40px;display:flex;align-items:center;justify-content:center">' + svg('fwd', 21, '#0A0A0A', 2.4) + '</button></div>';

  if (p.unknown) {
    const f = route.first || { w: 20, r: 8, rir: 2 };
    const step = (label, key, val, stepSize) =>
      '<div class="split" style="align-items:center"><div><div style="font-family:Outfit,sans-serif;font-weight:700;font-size:16px">' + label + '</div>' +
      '<div class="faint">' + (key === 'rir' ? 'reps you could still have done' : key === 'w' ? S.settings.unit : 'reps completed') + '</div></div>' +
      '<div class="stepper"><button data-first="' + key + ':-' + stepSize + '">−</button><div class="val">' + num(val) + '</div>' +
      '<button data-first="' + key + ':' + stepSize + '">+</button></div></div>';
    return '<div class="view on" style="--day:' + d.color + '">' + nav +
      '<div class="scroll pad" style="padding-top:24px">' +
      '<div class="eyebrow" style="color:' + d.color + '">First time</div>' +
      '<div class="h1" style="margin-top:8px;font-size:28px">One honest set and<br>Coach takes over.</div>' +
      '<div class="sub" style="margin-top:10px">Give it anything you\'ve lifted on this before — it works backwards from there.</div>' +
      '<div class="list" style="margin-top:22px;gap:18px">' +
        step('Weight', 'w', f.w, p.ex.inc) + '<div class="hr"></div>' +
        step('Reps', 'r', f.r, 1) + '<div class="hr"></div>' +
        step('Left in the tank', 'rir', f.rir, 1) +
      '</div><div style="height:24px"></div></div>' +
      '<div class="footer"><button class="btn btn-day" data-seed="1">Set my starting point</button></div></div>';
  }

  const bars = Array.from({ length: z.sets }, (_, i) =>
    '<div class="bar' + (i < p.done ? ' on' : '') + '"></div>').join('');
  const why = route.why
    ? '<div class="sub" style="margin-top:10px;background:var(--surface);border-radius:16px;padding:14px 16px;line-height:1.6">' +
      'Your logged sets put your one-rep max on ' + esc(p.ex.name) + ' around <strong>' + num(p.e1rm) + ' ' + S.settings.unit +
      '</strong>. ' + z.label + ' means ' + z.pctText + ' of that for ' + z.reps + ' reps, rounded to plates you own.</div>'
    : '';
  const lastTxt = p.last ? num(p.last.w) + ' ' + S.settings.unit + ' × ' + p.last.r + (p.last.rir ? ' · ' + p.last.rir + ' in tank' : '') : '—';

  const sh = route.sheet;
  const sheetUI = !sh ? '' :
    '<div style="position:absolute;inset:0;background:rgba(10,10,10,.45);z-index:40" data-sheet-close="1"></div>' +
    '<div style="position:absolute;left:0;right:0;bottom:0;z-index:41;background:#fff;border-radius:26px 26px 0 0;' +
    'padding:22px 22px calc(22px + var(--safe-b));box-shadow:0 -12px 40px rgba(0,0,0,.18)">' +
      '<div class="split"><div class="h2">What did you do?</div>' +
      '<button data-sheet-close="1" class="faint" style="font-weight:600">Cancel</button></div>' +
      '<div class="sub" style="margin-top:4px">Pre-filled with what Coach asked. Change it if reality disagreed.</div>' +
      '<div class="list" style="margin-top:18px;gap:16px">' +
        [['Weight', 'w', sh.w, p.ex.inc, S.settings.unit],
         ['Reps', 'r', sh.r, 1, 'completed'],
         ['Left in the tank', 'rir', sh.rir, 1, 'reps you had spare']].map(function (row) {
          return '<div class="split" style="align-items:center"><div>' +
            '<div style="font-family:Outfit,sans-serif;font-weight:700;font-size:16px">' + row[0] + '</div>' +
            '<div class="faint">' + row[4] + '</div></div>' +
            '<div class="stepper"><button data-sheet="' + row[1] + ':-' + row[3] + '">−</button>' +
            '<div class="val">' + num(row[2]) + '</div>' +
            '<button data-sheet="' + row[1] + ':' + row[3] + '">+</button></div></div>';
        }).join('<div class="hr"></div>') +
      '</div>' +
      '<div style="margin-top:20px"><button class="btn btn-day" data-commit="1">Log it</button></div></div>';

  return '<div class="view on" style="--day:' + d.color + ';position:relative">' + nav + seg +
    '<div class="scroll">' +
    '<div class="pad" style="padding-top:20px"><div class="presc tint">' +
      '<div class="eyebrow" style="color:#0A0A0A;opacity:.65">' + (p.finished ? 'Next session' : 'Next set') + '</div>' +
      '<div style="display:flex;align-items:baseline;gap:9px;margin-top:6px">' +
        '<div class="big">' + num(p.weight) + '</div>' +
        '<div style="font-family:Outfit,sans-serif;font-weight:600;font-size:26px;opacity:.55">' + S.settings.unit + '</div></div>' +
      '<div style="font-family:Outfit,sans-serif;font-weight:700;font-size:30px;letter-spacing:-.03em;margin-top:8px">× ' + z.reps + ' reps</div>' +
      '<div class="bars">' + bars + '</div>' +
      '<div style="font-size:14px;margin-top:10px;opacity:.7">' +
        (p.finished ? 'All ' + z.sets + ' sets done — goes up next time' : p.left + ' of ' + z.sets + ' sets left') + '</div>' +
    '</div></div>' +
    '<div class="pad" style="padding-top:14px">' +
      '<button class="row" data-why="1" style="gap:7px">' + svg('info', 15, '#A0A0A8', 2.2) +
      '<span style="font-size:14px;font-weight:600;color:var(--muted)">' + (route.why ? 'Hide the maths' : 'Why ' + num(p.weight) + ' ' + S.settings.unit + '?') + '</span></button>' + why +
    '</div>' +
    '<div class="pad list" style="padding-top:20px;gap:14px">' +
      '<div class="split"><span class="sub">Rest between sets</span><span class="num" style="font-size:18px">' + z.rest + '</span></div>' +
      '<div class="hr"></div>' +
      '<div class="split"><span class="sub">Last set</span><span class="num" style="font-size:18px">' + esc(lastTxt) + '</span></div>' +
      '<div class="hr"></div>' +
      '<div class="split"><span class="sub">Estimated 1RM</span><span class="num" style="font-size:18px">' + num(p.e1rm) + ' ' + S.settings.unit + '</span></div>' +
    '</div><div style="height:24px"></div></div>' +
    '<div class="footer">' +
      (p.finished
        ? '<button class="btn btn-dark" data-step="1">' + (cur.idx + 1 < cur.exIds.length ? 'Next exercise' : 'Back to today') + '</button>'
        : '<button class="btn btn-day" data-log="1">' + svg('check', 18, '#0A0A0A', 2.6) + 'Log this set</button>') +
    '</div>' + sheetUI + '</div>';
}

/* ---------- view: session complete ---------- */
function vComplete() {
  const s = route.session;
  const d = DAYS[s.type];
  const sets = s.entries.reduce((n, e) => n + e.sets.length, 0);
  const vol = Math.round(s.volume);
  const changed = s.entries;
  return '<div class="view on" style="background:' + d.color + ';color:#0A0A0A">' +
    '<div class="scroll">' +
    '<div class="top"><div class="mark" style="font-size:22px">COACH!</div></div>' +
    '<div class="pad" style="padding-top:30px">' +
      '<div class="eyebrow" style="opacity:.7">Session complete</div>' +
      '<div class="h1" style="font-size:44px;margin-top:10px">' + d.label + ' day,<br>done.</div>' +
    '</div>' +
    '<div class="pad" style="padding-top:30px"><div class="sub" style="color:rgba(10,10,10,.72)">You moved</div>' +
      '<div style="display:flex;align-items:baseline;gap:8px;margin-top:4px">' +
      '<div class="num" style="font-size:74px;line-height:.86">' + vol.toLocaleString() + '</div>' +
      '<div style="font-family:Outfit,sans-serif;font-weight:600;font-size:24px;opacity:.6">' + S.settings.unit + '</div></div>' +
      '<div class="sub" style="color:rgba(10,10,10,.75);margin-top:10px">Across ' + sets + ' set' + (sets === 1 ? '' : 's') + ' and ' + s.entries.length + ' exercise' + (s.entries.length === 1 ? '' : 's') + '.</div>' +
    '</div>' +
    '<div class="pad" style="padding-top:24px"><div style="background:#fff;border-radius:24px;padding:20px 22px">' +
      '<div class="eyebrow" style="color:var(--muted)">What changed</div>' +
      '<div class="list" style="margin-top:12px;gap:10px">' + changed.map(function (e) {
          const arrow = e.wentUp ? '↑' : e.wentDown ? '↓' : '=';
          return '<div class="split"><span style="font-size:15px">' + esc(byId(e.exId).name) + '</span>' +
            '<span class="num" style="font-size:16px">' + arrow + ' ' + num(e.next) + ' ' + S.settings.unit + '</span></div>';
        }).join('') + '</div>' +
      '<div class="sub" style="margin-top:12px">' +
        (changed.some(e => e.wentUp) ? 'Where you hit the top of the range with a rep spare, Coach moved the weight up.'
                                     : 'Nothing moved up this time — hit the top of the range with a rep in the tank and it will.') + '</div>' +
    '</div></div><div style="height:24px"></div></div>' +
    '<div class="footer"><button class="btn" style="background:#0A0A0A;color:#fff" data-go="today">Back to Today</button></div></div>';
}

/* ---------- view: history ---------- */
function vHistory() {
  const wk = [];
  const now = new Date(todayISO() + 'T00:00:00');
  const monday = new Date(now); monday.setDate(now.getDate() - ((now.getDay() + 6) % 7));
  for (let i = 0; i < 7; i++) {
    const dt = new Date(monday); dt.setDate(monday.getDate() + i);
    const iso = localISO(dt);
    const hit = S.sessions.find(s => s.date === iso);
    const isToday = iso === todayISO();
    wk.push('<div><span class="lab" style="' + (isToday ? 'color:var(--ink);font-weight:700' : '') + '">' +
      'MTWTFSS'[i] + '</span><div class="box" style="' +
      (hit ? 'background:' + DAYS[hit.type].color : isToday ? 'background:#fff;border:2px solid var(--ink)' : '') + '"></div></div>');
  }
  const count = S.sessions.filter(s => Date.parse(s.date) >= monday.getTime()).length;

  const rows = S.sessions.slice().reverse().map(function (s) {
    const d = DAYS[s.type];
    const sets = s.entries.reduce((n, e) => n + e.sets.length, 0);
    return '<div class="row card">' +
      '<span style="width:5px;align-self:stretch;border-radius:3px;background:' + d.color + '"></span>' +
      '<div class="grow"><div style="font-family:Outfit,sans-serif;font-size:16px;font-weight:700">' + d.label + ' day</div>' +
      '<div class="faint">' + s.entries.length + ' exercise' + (s.entries.length === 1 ? '' : 's') + ' · ' + sets + ' sets · ' + Math.round(s.volume).toLocaleString() + ' ' + S.settings.unit + '</div></div>' +
      '<span class="sub" style="font-size:13px;flex:0 0 auto">' + fmtDate(s.date) + '</span></div>';
  }).join('');

  return '<div class="view on"><div class="scroll">' +
    '<div class="pad" style="padding-top:calc(env(safe-area-inset-top,0px) + 26px)"><div class="h1">History</div></div>' +
    '<div class="pad" style="padding-top:22px"><div class="split">' +
      '<span class="eyebrow" style="color:var(--faint)">This week</span>' +
      '<span class="sub" style="font-size:13px">' + count + ' session' + (count === 1 ? '' : 's') + '</span></div>' +
      '<div class="wk" style="margin-top:13px">' + wk.join('') + '</div></div>' +
    '<div class="pad" style="padding-top:26px"><div class="eyebrow" style="color:var(--faint)">Recent</div>' +
      '<div class="list" style="margin-top:13px">' + (rows ||
        '<div class="empty">No sessions yet.<br>Train something and it lands here.</div>') + '</div></div>' +
    '<div style="height:24px"></div></div>' + tabbar('history') + '</div>';
}

/* ---------- view: progress ---------- */
function vProgress() {
  const trained = Object.keys(S.exercises).filter(id => S.exercises[id].e1rm && byId(id));
  if (!trained.length) {
    return '<div class="view on"><div class="scroll">' +
      '<div class="pad" style="padding-top:calc(env(safe-area-inset-top,0px) + 26px)"><div class="h1">Progress</div>' +
      '<div class="sub" style="margin-top:3px">Estimated 1RM over time</div></div>' +
      '<div class="empty" style="padding-top:60px">Nothing to chart yet.<br>Log a few sets and your strength shows up here.</div>' +
      '</div>' + tabbar('progress') + '</div>';
  }
  const sel = trained.indexOf(route.lift) !== -1 ? route.lift : trained[0];
  const ex = byId(sel);
  const grp = ex.groups[0];
  const color = DAYS[grp].color;

  const series = [];
  S.sessions.forEach(function (s) {
    const e = s.entries.find(x => x.exId === sel);
    if (e && e.e1rmAfter) series.push({ date: s.date, v: e.e1rmAfter });
  });
  const curV = S.exercises[sel].e1rm;
  if (!series.length || series[series.length - 1].v !== curV) series.push({ date: todayISO(), v: curV });

  let chart;
  if (series.length < 2) {
    chart = '<div class="sub" style="padding:26px 0;text-align:center">One data point so far. Log this lift again and the line appears.</div>';
  } else {
    const W = 326, H = 130, TOP = 12;
    const vals = series.map(p => p.v);
    const mn = Math.min.apply(null, vals) - 2, mx = Math.max.apply(null, vals) + 2;
    const px = i => (i / (series.length - 1)) * W;
    const py = v => TOP + (1 - (v - mn) / (mx - mn || 1)) * H;
    let path = '';
    series.forEach((p, i) => { path += (i ? 'L' : 'M') + px(i).toFixed(1) + ' ' + py(p.v).toFixed(1) + ' '; });
    chart = '<svg viewBox="0 0 ' + W + ' 160" width="100%" height="160" style="display:block;overflow:visible" role="img" aria-label="Estimated 1RM over time">' +
      '<line x1="0" y1="12" x2="' + W + '" y2="12" stroke="#F1F1F4"/><line x1="0" y1="77" x2="' + W + '" y2="77" stroke="#F1F1F4"/><line x1="0" y1="142" x2="' + W + '" y2="142" stroke="#F1F1F4"/>' +
      '<path d="' + path + 'L' + W + ' 160 L0 160 Z" fill="' + color + '" opacity=".13"/>' +
      '<path d="' + path.trim() + '" fill="none" stroke="' + color + '" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>' +
      '<circle cx="' + px(series.length - 1).toFixed(1) + '" cy="' + py(curV).toFixed(1) + '" r="7.5" fill="#fff"/>' +
      '<circle cx="' + px(series.length - 1).toFixed(1) + '" cy="' + py(curV).toFixed(1) + '" r="5" fill="' + color + '"/></svg>' +
      '<div class="split" style="margin-top:10px"><span class="faint">' + fmtDate(series[0].date) + '</span><span class="faint">now</span></div>';
  }
  const first = series[0].v, delta = Math.round((curV - first) * 10) / 10;

  return '<div class="view on"><div class="scroll">' +
    '<div class="pad" style="padding-top:calc(env(safe-area-inset-top,0px) + 26px)"><div class="h1">Progress</div>' +
    '<div class="sub" style="margin-top:3px">Estimated 1RM over time</div></div>' +
    '<div class="pad chips" style="padding-top:18px;flex-wrap:nowrap;overflow-x:auto">' +
      trained.map(function (id) {
        const on = id === sel, g = byId(id).groups[0];
        return '<button class="chip" aria-pressed="' + on + '" data-lift="' + id + '" style="flex:0 0 auto">' +
          '<span class="dot" style="background:' + DAYS[g].color + '"></span>' + esc(byId(id).name) + '</button>';
      }).join('') + '</div>' +
    '<div class="pad" style="padding-top:22px"><div class="split" style="align-items:flex-end">' +
      '<div><div class="sub">Now</div><div style="display:flex;align-items:baseline;gap:7px;margin-top:3px">' +
      '<span class="num" style="font-size:56px;line-height:.9">' + num(curV) + '</span>' +
      '<span style="font-family:Outfit,sans-serif;font-weight:600;font-size:20px;color:var(--muted)">' + S.settings.unit + '</span></div></div>' +
      (delta > 0 ? '<span class="pill" style="background:' + color + '">+' + num(delta) + ' ' + S.settings.unit + '</span>' : '') +
      '</div><div style="margin-top:18px">' + chart + '</div></div>' +
    '<div style="height:24px"></div></div>' + tabbar('progress') + '</div>';
}

/* ---------- actions ---------- */
function startSession(type) {
  S.current = { type: type, exIds: [], idx: 0, log: {} };
  save(); go('library');
}
function toggleExercise(id) {
  const cur = S.current, i = cur.exIds.indexOf(id);
  if (i === -1) cur.exIds.push(id);
  else {
    if ((cur.log[id] || []).length) { toast('That one has logged sets'); return; }
    cur.exIds.splice(i, 1);
    if (cur.idx >= cur.exIds.length) cur.idx = Math.max(0, cur.exIds.length - 1);
  }
  save(); render();
}
function seedFirstSet() {
  const cur = S.current, id = cur.exIds[cur.idx];
  const f = route.first || { w: 20, r: 8, rir: 2 };
  S.exercises[id] = { e1rm: Math.round(epley(f.w, f.r, f.rir) * 10) / 10, last: { w: f.w, r: f.r, rir: f.rir } };
  route.first = null; save(); render();
}
function openLogSheet() {
  const p = prescribe(S.current.exIds[S.current.idx]);
  if (p.unknown || p.finished) return;
  route.sheet = { w: p.weight, r: p.zone.top, rir: 1 };
  render();
}
function commitSet() {
  const cur = S.current, id = cur.exIds[cur.idx];
  const entry = Object.assign({}, route.sheet);
  (cur.log[id] = cur.log[id] || []).push(entry);
  const rec = S.exercises[id];
  rec.last = entry;
  rec.e1rm = Math.max(rec.e1rm, Math.round(epley(entry.w, entry.r, entry.rir) * 10) / 10);
  route.sheet = null;
  save(); render();
  const after = prescribe(id);
  const word = after.finished ? 'Exercise done'
    : after.why === 'up'   ? 'Nice — next set ' + num(after.weight) + ' ' + S.settings.unit
    : after.why === 'down' ? 'Backing off to ' + num(after.weight) + ' ' + S.settings.unit
    : 'Same weight again — ' + num(after.weight) + ' ' + S.settings.unit;
  toast(word);
}
function stepExercise(dir) {
  const cur = S.current;
  const n = cur.exIds.length;
  const next = cur.idx + dir;
  if (next < 0 || next >= n) { route.why = false; go('today'); return; }
  cur.idx = next; route.why = false; save(); render();
}
function finishSession() {
  const cur = S.current;
  const entries = [];
  let volume = 0;
  cur.exIds.forEach(function (id) {
    const sets = cur.log[id] || [];
    if (!sets.length) return;
    sets.forEach(s => { volume += s.w * s.r; });
    const rec = S.exercises[id];
    const z = ZONES[S.settings.goal];
    const inc = byId(id).inc;
    const nx = nextWeight(sets[sets.length - 1], z, inc, snap(rec.e1rm * z.pct, inc));
    entries.push({
      exId: id, sets: sets, e1rmAfter: rec.e1rm,
      wentUp: nx.why === 'up', wentDown: nx.why === 'down', next: nx.w
    });
  });
  if (!entries.length) { toast('Log a set first'); return; }
  const session = { id: Date.now(), type: cur.type, date: todayISO(), entries: entries, volume: volume };
  S.sessions.push(session);
  S.current = null;
  save();
  go('complete', { session: session });
}

/* ---------- render + events ---------- */
function render() {
  let html;
  if (!S.settings.setupDone || route.name === 'setup') html = vSetup();
  else if (route.name === 'complete') html = vComplete();
  else if (route.name === 'library' && S.current) html = vLibrary();
  else if (route.name === 'coach' && S.current && S.current.exIds.length) html = vCoach();
  else if (route.name === 'history') html = vHistory();
  else if (route.name === 'progress') html = vProgress();
  else html = vToday();
  app().innerHTML = html;
  const q = document.getElementById('q');
  if (q) {
    q.addEventListener('input', function () { route.q = q.value; const p = q.selectionStart; render();
      const n = document.getElementById('q'); if (n) { n.focus(); try { n.setSelectionRange(p, p); } catch (e) {} } });
  }
}

document.addEventListener('click', function (ev) {
  const t = ev.target.closest('[data-go],[data-pick-day],[data-toggle-ex],[data-filter],[data-open-ex],' +
    '[data-goal],[data-unit],[data-plate],[data-setup-done],[data-step],[data-log],[data-why],' +
    '[data-first],[data-seed],[data-finish],[data-abandon],[data-lift],[data-sheet],[data-sheet-close],[data-commit],[data-install]');
  if (!t) return;
  const d = t.dataset;

  if (d.go) { route.why = false; route.q = ''; go(d.go === 'today' && S.current ? 'today' : d.go); return; }
  if (d.pickDay) return startSession(d.pickDay);
  if (d.toggleEx) return toggleExercise(d.toggleEx);
  if (d.filter) { route.filter = d.filter; return render(); }
  if (d.openEx !== undefined) { S.current.idx = +d.openEx; route.why = false; save(); return go('coach'); }
  if (d.goal) { S.settings.goal = d.goal; save(); return render(); }
  if (d.unit) { S.settings.unit = d.unit; S.settings.plate = d.unit === 'kg' ? 1.25 : 2.5; save(); return render(); }
  if (d.plate) { S.settings.plate = +d.plate; save(); return render(); }
  if (d.setupDone) { S.settings.setupDone = true; save(); return go('today'); }
  if (d.step) return stepExercise(+d.step);
  if (d.log) return openLogSheet();
  if (d.sheetClose) { route.sheet = null; return render(); }
  if (d.commit) return commitSet();
  if (d.sheet) {
    const kv = d.sheet.split(':'), k = kv[0], delta = parseFloat(kv[1]);
    const sh = route.sheet; if (!sh) return;
    sh[k] = Math.max(k === 'rir' ? 0 : (k === 'r' ? 1 : 0.5), Math.round((sh[k] + delta) * 100) / 100);
    if (k === 'r') sh.r = Math.min(30, sh.r);
    if (k === 'rir') sh.rir = Math.min(10, sh.rir);
    return render();
  }
  if (d.why) { route.why = !route.why; return render(); }
  if (d.first) {
    const parts = d.first.split(':');
    const f = route.first || { w: 20, r: 8, rir: 2 };
    const key = parts[0], delta = parseFloat(parts[1]);
    f[key] = Math.max(key === 'rir' ? 0 : 1, Math.round((f[key] + delta) * 100) / 100);
    if (key === 'r') f.r = Math.min(30, f.r);
    if (key === 'rir') f.rir = Math.min(10, f.rir);
    route.first = f; return render();
  }
  if (d.seed) return seedFirstSet();
  if (d.finish) return finishSession();
  if (d.abandon) { if (confirm('Throw away this session?')) { S.current = null; save(); render(); } return; }
  if (d.lift) { route.lift = d.lift; return render(); }
  if (d.install) {
    if (!installPrompt) return;
    installPrompt.prompt();
    installPrompt.userChoice.then(function (r) {
      if (r && r.outcome === 'accepted') toast('Installing…');
      installPrompt = null; render();
    });
    return;
  }
});

/* ---------- install prompt (Chrome / Samsung Internet on Android) ---------- */
let installPrompt = null;
window.addEventListener('beforeinstallprompt', function (e) {
  e.preventDefault(); installPrompt = e; render();
});
window.addEventListener('appinstalled', function () { installPrompt = null; render(); });
const isStandalone = () =>
  window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;

/* ---------- boot ---------- */
load();
if (S.current && S.current.exIds.length) route = { name: 'today', tab: 'today' };
render();
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}
/* expose for the test harness */
if (typeof module !== 'undefined') module.exports = { DAYS, CATALOGUE, ZONES, epley, snap, prescribe,
  get S() { return S; }, set S(v) { S = v; }, blank, suggestion, byId, num };
