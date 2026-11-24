// Line-follower demo: a differential-drive robot with an 8-sensor bar and a PD
// steering loop, following a closed track. All units are fractions of the
// track size, so the same numbers work at any canvas size.
(function (root) {
  const N = 720;
  const SENSORS = 16;
  const BAR_HALF = 0.05;   // half width of the sensor bar
  const LOOK = 0.0844;     // sensor bar centre ahead of the wheel axle: 126.6 mm on the real robot (100 mm rails, bar pads on the last two rail holes)
  const ARC = 0.0064;      // the 16MuxV3 bar is an arc: its ends sit this far behind its centre
  const LINE_HALF = 0.011; // half width of the printed line

  function makeTrack() {
    const pts = [];
    for (let i = 0; i < N; i++) {
      const t = (i / N) * Math.PI * 2;
      const x = 0.40 * Math.cos(t) + 0.04 * Math.cos(3 * t) - 0.015 * Math.sin(2 * t);
      const y = 0.30 * Math.sin(t) + 0.03 * Math.sin(2 * t) + 0.02 * Math.cos(3 * t);
      pts.push([x, y]);
    }
    return pts;
  }

  function nearest(track, x, y, hint) {
    let best = hint, bd = Infinity;
    const span = hint < 0 ? N : 60;
    for (let k = -span; k <= span; k++) {
      const i = hint < 0 ? (k + span) % N : (hint + k + N) % N;
      const dx = track[i][0] - x, dy = track[i][1] - y, d = dx * dx + dy * dy;
      if (d < bd) { bd = d; best = i; }
    }
    return { i: best, d: Math.sqrt(bd) };
  }

  function create() {
    const track = makeTrack();
    const a = track[0], b = track[1];
    return {
      track,
      x: a[0], y: a[1], th: Math.atan2(b[1] - a[1], b[0] - a[0]),
      idx: 0, prevE: 0, lastSign: 1, t: 0, lapStart: 0, lap: null, laps: 0,
      sensors: new Array(SENSORS).fill(0), err: 0, offLine: 0,
    };
  }

  function step(s, dt, speed) {
    if (!(dt > 0)) return;
    const cx = s.x + Math.cos(s.th) * LOOK, cy = s.y + Math.sin(s.th) * LOOK;
    const nx = -Math.sin(s.th), ny = Math.cos(s.th);
    let sum = 0, wsum = 0;
    for (let k = 0; k < SENSORS; k++) {
      const off = -BAR_HALF + (2 * BAR_HALF * k) / (SENSORS - 1);
      const back = ARC * (off / BAR_HALF) ** 2;
      const px = cx + nx * off - Math.cos(s.th) * back, py = cy + ny * off - Math.sin(s.th) * back;
      const d = nearest(s.track, px, py, s.idx).d;
      const v = Math.exp(-((d / LINE_HALF) ** 2));
      s.sensors[k] = v; sum += v * off; wsum += v;
    }
    let e;
    if (wsum > 0.15) { e = sum / wsum / BAR_HALF; s.lastSign = Math.sign(e) || s.lastSign; }
    else { e = s.lastSign; }
    const de = (e - s.prevE) / dt; s.prevE = e; s.err = e;
    // gains scale with speed so the loop stays stable across the slider range
    const kp = 16 * (speed / 0.35), kd = 0.12;
    const w = kp * e + kd * de * (speed / 0.35);
    s.th += w * dt;
    s.x += Math.cos(s.th) * speed * dt; s.y += Math.sin(s.th) * speed * dt;
    const n = nearest(s.track, s.x, s.y, s.idx);
    if (s.idx > N * 0.9 && n.i < N * 0.1) {
      if (s.laps > 0) s.lap = s.t - s.lapStart;
      s.lapStart = s.t; s.laps++;
    }
    s.idx = n.i; s.offLine = n.d;
    s.t += dt;
  }

  root.LineSim = { create, step, SENSORS, BAR_HALF, LOOK, ARC, LINE_HALF };
})(typeof window !== 'undefined' ? window : globalThis);
