'use strict';
/* Parse an AVT reel-inspection export (CSV) into Stage-2 defect/waste rows.
   Expected headers (case-insensitive, flexible): Roll, TotalMeters, WasteIn, WasteOut, Defect, WeightKg */
function parse(csv){
  if(!csv||!csv.trim()) return { error:'Empty CSV' };
  const lines=csv.trim().split(/\r?\n/); const head=lines[0].split(',').map(s=>s.trim().toLowerCase());
  const idx=(names)=>{ for(const n of names){ const i=head.indexOf(n); if(i>=0) return i; } return -1; };
  const c={ roll:idx(['roll','roll#','roll no','rollno']), tm:idx(['totalmeters','total meters','meters','length']), wi:idx(['wastein','waste in','waste_in']), wo:idx(['wasteout','waste out','waste_out']), def:idx(['defect','type of defect','defect type']), kg:idx(['weightkg','weight','kg','grams']) };
  const rows=[];
  for(let i=1;i<lines.length;i++){ const cells=lines[i].split(','); if(cells.length<2) continue; rows.push({ roll:(cells[c.roll]||String(i)).trim(), totalMeters:(cells[c.tm]||'').trim(), wasteIn:(cells[c.wi]||'').trim(), wasteOut:(cells[c.wo]||'').trim(), defect:(cells[c.def]||'').trim(), weightKg:(cells[c.kg]||'').trim(), sign:'AVT' }); }
  return { rows, count:rows.length };
}
module.exports = { parse };
