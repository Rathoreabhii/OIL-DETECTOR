/** Debug: why did Ocean Pride's score shift with physics-driven tracks? */
import { OceanEngine, TRUE_SRC } from '../engine/engine';
import { stwAtKn, speedAtKn, posAt } from '../engine/vessels';

const eng = new OceanEngine();
let g = 0;
while (!eng.bootStep(7200) && g++ < 100) {}
eng.beginInvestigation();
let g2 = 0;
while (!eng.stepInvestigation() && g2++ < 500) {}
const inv = eng.investigation!;

for (const c of inv.candidates) {
  console.log(`\n=== ${c.vessel.def.name} total=${c.total}`);
  for (const k of c.components) console.log(`   ${k.label}: ${k.value} → ${k.points}/${k.max}`);
  console.log(`   raw: ${JSON.stringify(c.raw)}`);
}

const op = inv.candidates.find((c) => c.vessel.def.name === 'MV Ocean Pride')!.vessel;
const buf = new Float64Array(2);
console.log('\n--- Ocean Pride timeline (physics) ---');
for (const h of [-4, -3, -2.5, -2, -1.5, -1, 0, 1, 2]) {
  const t = h * 3600;
  if (posAt(op, t, buf)) {
    const dKm = Math.hypot(buf[0] - inv.estX, buf[1] - inv.estY) / 1000;
    console.log(`t=${h}h  sog=${speedAtKn(op, t).toFixed(2)}kn  stw=${stwAtKn(op, t).toFixed(2)}kn  distEst=${dKm.toFixed(1)}km  pos=(${(buf[0]/1000).toFixed(1)},${(buf[1]/1000).toFixed(1)})km`);
  } else {
    console.log(`t=${h}h  outside span`);
  }
}
console.log('estX,estY (km):', (inv.estX/1000).toFixed(1), (inv.estY/1000).toFixed(1));
console.log('true source (km): 0,0 =', TRUE_SRC.lon, TRUE_SRC.lat);
