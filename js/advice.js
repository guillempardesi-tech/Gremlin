/**
 * Swing-fault detection & coaching advice.
 *
 * Every rule compares a measured biomechanical quantity against target
 * bands taken from the golf-science literature and tour motion-capture
 * norms (sources noted per rule). Severity feeds the swing score.
 *
 * severity: 'good' | 'info' | 'minor' | 'major'
 */

const fmt = {
  deg: (v) => `${v.toFixed(0)}°`,
  ratio: (v) => `${v.toFixed(1)} : 1`,
  cm: (v) => `${(v * 100).toFixed(0)} cm`,
  ms: (v) => `${v.toFixed(0)} ms`,
};

export function evaluateSwing(m) {
  const findings = [];
  const add = (f) => findings.push(f);

  // ── Tempo ─────────────────────────────────────────────────────────────
  if (m.tempoRatio > 0) {
    const t = m.tempoRatio;
    if (t >= 2.6 && t <= 3.4) {
      add({
        id: 'tempo', severity: 'good', title: 'Tour-grade tempo',
        measured: fmt.ratio(t), target: '3.0 : 1',
        detail: `Your backswing-to-downswing time ratio is ${fmt.ratio(t)} — right in the elite window. Frame-count studies of tour players (Novosel & Garrity, "Tour Tempo", 2004) found nearly all cluster at 3:1 regardless of swing length.`,
      });
    } else if (t > 3.4) {
      add({
        id: 'tempo', severity: 'minor', title: 'Backswing drags relative to downswing',
        measured: fmt.ratio(t), target: '2.6–3.4 : 1',
        detail: 'A very slow takeaway relative to the strike disrupts the stretch-shorten cycle in the trunk musculature and usually costs sequencing, not just speed.',
        drill: 'Count "one-two-three" up, "one" down — or swing to a 3:1 metronome app. Feel the club "fall" from the top rather than being placed.',
      });
    } else {
      add({
        id: 'tempo', severity: t < 2.0 ? 'major' : 'minor', title: 'Swing is rushed from the top',
        measured: fmt.ratio(t), target: '2.6–3.4 : 1',
        detail: 'Snatching the club down early fires the arms before the lower body can lead the kinematic sequence (pelvis → torso → arms → club), which is where efficient speed comes from.',
        drill: 'Pause drill: swing to the top, hold a full one-second pause, then swing through. The ball should still go 90% as far — proof the top-of-swing rush adds nothing.',
      });
    }
  }

  // ── X-Factor (shoulder–pelvis separation at the top) ──────────────────
  if (isFinite(m.xFactor)) {
    const x = m.xFactor;
    if (x >= 32 && x <= 60) {
      add({
        id: 'xfactor', severity: 'good', title: 'Strong coil (X-Factor)',
        measured: fmt.deg(x), target: '35–55°',
        detail: `Shoulder–pelvis separation of ${fmt.deg(x)} at the top. Motion-capture studies (McLean 1992; Myers et al., J Sports Sci 2008) show this separation correlates directly with ball speed.`,
      });
    } else if (x < 32) {
      add({
        id: 'xfactor', severity: x < 22 ? 'major' : 'minor', title: 'Limited shoulder–hip coil',
        measured: fmt.deg(x), target: '35–55°',
        detail: 'Your shoulders and hips are turning together, so little elastic energy is stored in the trunk. This is the most common amateur power leak (Myers et al. 2008 found higher X-Factor in high-ball-speed groups).',
        drill: 'Cross-arm turns: club across your chest, turn your shoulders fully while resisting with the trail knee — feel the stretch across your lead side. Then rebuild the backswing keeping the lower half quieter.',
      });
    } else {
      add({
        id: 'xfactor', severity: 'info', title: 'Very large X-Factor',
        measured: fmt.deg(x), target: '35–55°',
        detail: 'Separation beyond ~60° can exceed comfortable spinal rotation for many players and is associated with higher lumbar load. If you have the mobility of a tour pro, carry on — otherwise let the hips turn a touch more.',
      });
    }
  }

  // ── Lead arm at the top ───────────────────────────────────────────────
  if (isFinite(m.leadArmFlexTop)) {
    const flex = m.leadArmFlexTop;
    if (flex <= 25) {
      add({
        id: 'leadarm', severity: 'good', title: 'Lead arm stays long',
        measured: `${fmt.deg(flex)} bend`, target: '< 25° bend',
        detail: 'A long (not rigid) lead arm at the top maintains swing radius — and clubhead speed scales directly with radius at a given angular velocity.',
      });
    } else if (flex > 35) {
      add({
        id: 'leadarm', severity: 'major', title: 'Lead arm collapses at the top',
        measured: `${fmt.deg(flex)} bend`, target: '< 25° bend',
        detail: 'A collapsed lead elbow shrinks the swing arc, costing speed, and forces a compensating re-extension on the way down that ruins low-point control.',
        drill: 'Shorten the backswing until the lead arm stays comfortably extended — a shorter swing with structure outdrives a long collapsed one. Towel-under-both-armpits drill keeps arms and chest connected.',
      });
    } else {
      add({
        id: 'leadarm', severity: 'minor', title: 'Lead arm softens at the top',
        measured: `${fmt.deg(flex)} bend`, target: '< 25° bend',
        detail: 'Some bend is fine (many long drivers have a few degrees), but past ~25° the arc starts shrinking measurably.',
        drill: 'Feel "wide hands" at the top — push the grip away from your trail shoulder as you complete the turn.',
      });
    }
  }

  // ── Head sway (backswing) ─────────────────────────────────────────────
  if (isFinite(m.headSwayTarget)) {
    const sway = Math.abs(m.headSwayTarget);
    const towardTarget = m.headSwayTarget > 0;
    if (towardTarget && m.headSwayTarget > 0.05) {
      add({
        id: 'headsway', severity: 'major', title: 'Reverse-pivot pattern',
        measured: `${fmt.cm(m.headSwayTarget)} toward target`, target: 'stable or slightly away',
        detail: 'Your head moved toward the target during the backswing — the classic reverse-pivot signature. Weight ends up on the lead side at the top, then falls backward through impact, costing speed and producing thin/fat strikes.',
        drill: 'Feel your trail hip turn "into" a wall behind you as pressure loads into the trail heel during the backswing. Step-through drills exaggerate the correct weight flow.',
      });
    } else if (sway > 0.12) {
      add({
        id: 'headsway', severity: 'minor', title: 'Excessive head movement',
        measured: fmt.cm(sway), target: '< 10 cm',
        detail: 'Tour players keep the head within roughly a ball-width of its address position during the backswing; large lateral drift moves the swing low point and makes contact a timing exercise.',
        drill: 'Shadow drill: swing with the sun (or a lamp) casting your head-shadow on a spot — keep the shadow inside a small circle to the top.',
      });
    } else {
      add({
        id: 'headsway', severity: 'good', title: 'Quiet head',
        measured: fmt.cm(sway), target: '< 10 cm',
        detail: 'Your head stays centred through the backswing, which keeps the swing low point predictable — the foundation of consistent strikes.',
      });
    }
  }

  // ── Hip sway (backswing) ──────────────────────────────────────────────
  if (isFinite(m.hipSwayAway) && m.hipSwayAway > 0.10) {
    add({
      id: 'hipsway', severity: 'minor', title: 'Hips slide instead of turning',
      measured: `${fmt.cm(m.hipSwayAway)} away from target`, target: '< 10 cm',
      detail: 'Lateral pelvis slide in the backswing (sway) replaces rotation with translation — pressure gets stuck on the outside of the trail foot and the downswing sequence starts from a dead position.',
      drill: 'Place an alignment stick (or bag stand) just outside your trail hip at address; turn the hip clear of it rather than bumping into it.',
    });
  }

  // ── Standing up through impact ────────────────────────────────────────
  if (isFinite(m.headRise)) {
    if (m.headRise > 0.09) {
      add({
        id: 'posture', severity: 'major', title: 'Early extension / standing up',
        measured: `head up ${fmt.cm(m.headRise)} by impact`, target: '< 7 cm',
        detail: 'You rise out of your posture in the downswing. GEARS/TPI screening data finds early extension in a majority of amateurs and almost no tour players — it forces the arms to save the strike and blocks the hips from rotating through.',
        drill: 'Chair drill: set up with your glutes brushing a chair/wall and keep contact into impact. Also try hitting balls with your lead foot slightly flared and feeling the chest stay "down and turning" through the ball.',
      });
    } else if (m.headRise > 0.06) {
      add({
        id: 'posture', severity: 'minor', title: 'Slight loss of posture',
        measured: `head up ${fmt.cm(m.headRise)} by impact`, target: '< 7 cm',
        detail: 'A small rise through the hitting area — worth monitoring before it grows into full early extension.',
        drill: 'Rehearse slow-motion downswings keeping your belt buckle the same distance from the ball line.',
      });
    } else {
      add({
        id: 'posture', severity: 'good', title: 'Posture maintained into impact',
        measured: `head moved ${fmt.cm(Math.max(0, m.headRise))}`, target: '< 7 cm',
        detail: 'You stay in your spine angle through the strike — the pattern that separates tour impact positions from amateur ones.',
      });
    }
  }

  // ── Chicken wing at impact ────────────────────────────────────────────
  if (isFinite(m.leadElbowImpact) && m.leadElbowImpact < 145) {
    add({
      id: 'chickenwing', severity: 'minor', title: 'Lead elbow bent through impact',
      measured: `${fmt.deg(180 - m.leadElbowImpact)} bend at impact`, target: '< 35°',
      detail: 'A buckling lead elbow ("chicken wing") at impact shortens the arc exactly when radius matters most and usually indicates an over-the-top path or fear of turning through.',
      drill: 'Split-hand drill: grip with hands separated a few centimetres and swing half-speed — the lead arm must stay long to square the face.',
    });
  }

  // ── Overswing ─────────────────────────────────────────────────────────
  if (m.overswing) {
    add({
      id: 'overswing', severity: 'info', title: 'Long backswing',
      measured: 'hands above head at top', target: 'compact top position',
      detail: 'Hands travelling above head height often means the club is past parallel. Unless you have exceptional flexibility, length past parallel usually comes from collapsing structure rather than extra turn — check the lead-arm reading above.',
    });
  }

  // ── Casting / deceleration ────────────────────────────────────────────
  if (isFinite(m.peakToImpactMs)) {
    if (m.peakToImpactMs > 140) {
      add({
        id: 'release', severity: 'major', title: 'Early release — speed peaks too soon',
        measured: `hands peaked ${fmt.ms(m.peakToImpactMs)} before impact`, target: '< 120 ms',
        detail: 'Your hands hit maximum speed well before the ball. Efficient swings transfer hand momentum into the clubhead *at* impact (the parametric-acceleration effect — hands actually slow just before the strike as energy flows down the chain; Nesbit & Serrano 2005). Peaking early means the whip cracked behind the ball.',
        drill: 'Impact-bag or towel-whip drill: make the "whoosh" happen past the ball position, not at the top of the downswing. Hold the wrist angle until the hands pass the trail thigh.',
      });
    } else {
      add({
        id: 'release', severity: 'good', title: 'Well-timed release',
        measured: `hands peaked ${fmt.ms(Math.max(0, m.peakToImpactMs))} before impact`, target: '< 120 ms',
        detail: 'Hand speed peaks close to the strike, so stored wrist-cock energy is being delivered to the clubhead at the right moment.',
      });
    }
  }

  // ── Knee flex at address ──────────────────────────────────────────────
  if (isFinite(m.kneeFlexAddress)) {
    if (m.kneeFlexAddress < 8) {
      add({
        id: 'knees', severity: 'info', title: 'Legs very straight at address',
        measured: fmt.deg(m.kneeFlexAddress), target: '≈ 15–25°',
        detail: 'Athletic knee flex at setup lets the lower body drive the downswing; straight knees encourage an all-arms action.',
      });
    } else if (m.kneeFlexAddress > 35) {
      add({
        id: 'knees', severity: 'info', title: 'Deep knee bend at address',
        measured: fmt.deg(m.kneeFlexAddress), target: '≈ 15–25°',
        detail: 'Sitting very low at address tends to force a stand-up move through impact to create room.',
      });
    }
  }

  // Sort: problems first (major → minor → info), then positives.
  const order = { major: 0, minor: 1, info: 2, good: 3 };
  findings.sort((a, b) => order[a.severity] - order[b.severity]);

  // Swing score.
  let score = 100;
  for (const f of findings) {
    if (f.severity === 'major') score -= 14;
    else if (f.severity === 'minor') score -= 7;
    else if (f.severity === 'info') score -= 2;
  }
  score = Math.max(35, score);

  return { findings, score };
}
