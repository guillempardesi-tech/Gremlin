# Gremlin · SwingLab

**Real-time golf swing analyzer** — point a camera at your swing and get clubhead
speed, ball speed, carry/total distance, apex, spin, launch, a swing score, and
coaching advice, per club. Everything runs locally in the browser; no video ever
leaves the device.

![](https://img.shields.io/badge/runs-100%25%20in%20browser-blue) ![](https://img.shields.io/badge/tracking-MediaPipe%20BlazePose-blue)

## Quick start

The app is a static site, but the camera API requires a secure context, so serve
it rather than double-clicking `index.html`:

```bash
# either
npx serve .
# or
python3 -m http.server 8000
```

Open the printed URL (on a phone: use the same Wi-Fi + your machine's LAN IP, or
any HTTPS tunnel — `localhost` is only "secure" on the machine itself). First
load fetches the MediaPipe pose model (~9 MB) from a CDN, so the first run needs
internet; pose inference itself is fully local.

**Camera setup for best accuracy**

1. **Face-on** (caddy view): camera pointing at your chest, ball between you and the camera.
2. **Whole body in frame**, head to feet, ~3–4 m away, camera steady.
3. Good light; 60 fps camera if the device offers it.
4. Pick your club in the top bar, address the ball, hold still ~½ s, swing.
   Detection, analysis and the distance readout are automatic. You can also
   analyse a recorded video file instead of the live camera.

## How it works (and why each piece was chosen)

### 1. Pose tracking
MediaPipe **BlazePose (full)** runs in VIDEO mode on the GPU, delivering 33
3-D landmarks per frame including **metric world landmarks**. Every channel is
smoothed with a **One-Euro filter** (Casiez, Roussel & Vogel, CHI 2012) — the
standard filter for interactive tracking because it adapts its cutoff to speed:
heavy smoothing at address, minimal lag mid-swing.

A metres-per-image-unit scale is estimated from the ratio of world-space to
image-space **torso length** (rotation-invariant in the face-on view, unlike
shoulder width) and frozen at takeaway, letting the app measure absolute body
translations (head sway, hip slide) that are invisible in MediaPipe's
hip-centred world coordinates.

### 2. Swing segmentation
A state machine segments each swing — *address → backswing → top → downswing →
impact → finish* — from hand height, hand speed and vertical velocity, with
false-start (waggle) rejection. Tempo, turns and sway are measured at the phase
boundaries.

### 3. Clubhead speed
A 30–60 fps camera cannot resolve the clubhead itself (at 45+ m/s it travels
~1.5 m between frames and motion-blurs), but the **hands are trackable**. The
app measures peak 3-D hand speed in the downswing (with 3-point parabolic
refinement around the sampled maximum, so the true peak isn't undersampled) and
scales it through the double-pendulum geometry of the swing:

```
CHS ≈ v_hands,peak × (r_wrist + 0.95·L_club)/r_wrist × G_release
```

`r_wrist` is the *measured* shoulder-pivot→wrist radius, `L_club` comes from the
selected club's real length, and `G_release ≈ 1.53` accounts for the
wrist-release whip — at impact the club rotates faster than the arms as momentum
transfers down the chain, and hand speed peaks mid-downswing then drops 20–30 %
into impact (Jorgensen, *The Physics of Golf*; Nesbit & Serrano 2005). The
product is anchored so a tour-typical peak hand speed maps to a tour-typical
clubhead speed. A ±30 % calibration slider is provided if you know your real
numbers from a launch monitor.

### 4. Impact model (per club)
Ball speed = clubhead speed × the club's **smash factor**; launch angle and spin
come from the club's reference dynamic-launch values with spin scaled linearly
with clubhead speed (spin loft is a club property — Penner 2003). All 15 club
entries are anchored to the published **TrackMan PGA Tour averages**.

### 5. Ball flight physics
Full equations of motion for a spinning sphere, integrated with **RK4** at 4 ms
steps:

```
m dv/dt = m g − ½ρ C_d(S) A |v| v + ½ρ C_l(S) A |v|² (ω̂ × v̂)
S = r·ω / |v|          (spin ratio)
C_d(S) = 0.2022 + 0.4313·min(S, 0.45)
C_l(S) = 0.5312·S / (S + 0.2125)
```

with exponential in-flight spin decay (τ = 25 s, consistent with radar
observations) and air density from temperature + altitude (barometric formula —
both settable in the app). The functional forms follow the golf-aerodynamics
literature (Bearman & Harvey 1976; Smits & Smith 1994; Penner 2003, *Rep. Prog.
Phys.* **66** 131); the four constants were **calibrated by grid search +
coordinate descent** (`tools/validate.mjs --calibrate`) so that, fed the
published tour launch conditions, the simulator reproduces published tour
carries. Ground roll uses a 3-parameter model of landing speed/angle/spin fitted
to the tour carry-vs-total gaps.

**Validation** (`node tools/validate.mjs`) — simulator vs. TrackMan tour data:

| Club | Ball speed | Launch | Spin | Sim carry | TM carry | Error | Sim roll | TM roll |
|---|---|---|---|---|---|---|---|---|
| Driver | 167 mph | 10.9° | 2686 | 266 yd | 275 yd | −3.3 % | 20.5 | 22 |
| 3 wood | 158 mph | 9.2° | 3655 | 247 yd | 243 yd | +1.6 % | 15.2 | 19 |
| 5 wood | 151 mph | 9.4° | 4350 | 231 yd | 230 yd | +0.6 % | 11.9 | 16 |
| Hybrid | 146 mph | 10.2° | 4437 | 222 yd | 225 yd | −1.3 % | 11.5 | 13 |
| 3 iron | 142 mph | 10.4° | 4630 | 214 yd | 212 yd | +0.9 % | 11.0 | 14 |
| 4 iron | 137 mph | 11.0° | 4836 | 205 yd | 203 yd | +0.7 % | 10.3 | 10 |
| 5 iron | 133 mph | 12.1° | 5361 | 193 yd | 194 yd | −0.3 % | 8.5 | 8 |
| 6 iron | 127 mph | 14.1° | 6231 | 180 yd | 183 yd | −1.4 % | 6.6 | 6 |
| 7 iron | 120 mph | 16.3° | 7097 | 166 yd | 172 yd | −3.5 % | 5.3 | 4 |
| 8 iron | 115 mph | 18.1° | 7998 | 157 yd | 160 yd | −2.2 % | 4.3 | 4 |
| 9 iron | 109 mph | 20.4° | 8647 | 147 yd | 148 yd | −1.0 % | 3.7 | 3 |
| PW | 102 mph | 24.2° | 9304 | 136 yd | 136 yd | −0.4 % | 3.0 | 3 |

Mean |carry error| ≈ **1.6 %** across the tour bag (wedge references beyond PW
are estimates, errors up to ~6 %). Predicted driver land angle 38.5° vs the
published 38°.

### 6. Form review
Each swing is scored against target bands from the golf-science literature:

| Check | Target | Source |
|---|---|---|
| Tempo (backswing:downswing) | 2.6–3.4 : 1 | Novosel & Garrity, *Tour Tempo* (2004) |
| X-Factor (shoulder–pelvis separation at top) | 35–55° | McLean 1992; Myers et al., *J Sports Sci* 2008 |
| Lead-arm bend at top | < 25° | swing-radius mechanics |
| Head sway in backswing | < 10 cm, never toward target | reverse-pivot screening |
| Hip slide in backswing | < 10 cm | sway vs. rotation |
| Head rise into impact | < 7 cm | early-extension screening (TPI/GEARS norms) |
| Lead elbow at impact | > 145° | "chicken wing" |
| Hand-speed peak timing | < 120 ms before impact | parametric acceleration; Nesbit & Serrano 2005 |

Every flagged fault ships with an explanation of *why it costs you* and a
specific drill. Findings are ranked most-severe first and feed a 100-point
swing score.

## Honest limitations

A camera is not a Doppler radar. Treat the outputs as **good estimates**:

- Clubhead speed is inferred from hand speed through calibrated lever geometry
  (typically within a few mph once the calibration slider is set against one
  known launch-monitor session); it is not a direct measurement.
- Launch angle and spin are **club-typical models scaled by your speed** — a
  camera cannot see the strike, so fat/thin/toe strikes read like flush ones.
- Sidespin is not modelled (face-to-path is invisible face-on): every simulated
  flight is a straight shot at your speed.
- 30 fps capture works; 60 fps is meaningfully better for peak-speed detection.

## Repo layout

```
index.html            app shell
css/style.css         dark, video-first UI
js/main.js            camera + MediaPipe loop + UI orchestration
js/swing.js           One-Euro filtering, phase machine, biomechanics, CHS estimator
js/clubs.js           15-club database (TrackMan tour anchors)
js/physics.js         drag + Magnus RK4 flight simulator (calibrated)
js/advice.js          fault rules → advice + swing score
js/trajectory.js      animated ball-flight chart
tools/validate.mjs    physics validation & calibration harness
tools/test-swing.mjs  end-to-end synthetic-swing pipeline test
```

Run the checks any time:

```bash
node tools/validate.mjs      # physics vs TrackMan table
node tools/test-swing.mjs    # synthetic swing through the full pipeline
```
