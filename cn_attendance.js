/* =====================================================================
   中方驻墨考勤填报模块  (China-side monthly attendance — Mexico plant)
   依赖：window.CN_ATT_DATA (cn_att_data.js)、Chart.js、全局 toast()
   所有标识以 cn 前缀，避免与主程序冲突。
   ===================================================================== */
(function(){
'use strict';
const D=document;
const $=id=>D.getElementById(id);
function esc(s){return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}

/* ---------- 数据 ---------- */
const SRC=window.CN_ATT_DATA||{year:2026,month:4,records:[]};
// 内置样本花名册（仅当员工信息录入为空时回退使用）
const SAMPLE_ROSTER=SRC.records.map(r=>({id:String(r.id),name:r.name,dept:r.dept,section:r.section,cat:r.cat}));
// 4 月样本考勤（按工号索引，用于给匹配到的员工预填）
const SAMPLE_DAYS={}; SRC.records.forEach(r=>{SAMPLE_DAYS[String(r.id)]=r.days;});
// 清空历史中方考勤数据（仅执行一次）：移除本机所有 cnAtt_* 月度缓存
try{if(localStorage.getItem('cn_att_cleared_v10')!=='1'){Object.keys(localStorage).forEach(k=>{if(k.indexOf('cnAtt_')===0)localStorage.removeItem(k);});localStorage.setItem('cn_att_cleared_v10','1');}}catch(_){}

let curY,curM,DIM,WEEKID=[],RECS=[];
// 默认月份 = 当前月的前一月
(function(){const d=new Date();d.setDate(1);d.setMonth(d.getMonth()-1);curY=d.getFullYear();curM=d.getMonth()+1;})();

function lsKey(){return `cnAtt_${curY}-${String(curM).padStart(2,'0')}`;}
function monthLabel(){return `${curY}年${curM}月`;}

// 主程序的 employees/positions 用 let 声明，不会挂到 window 上，
// 此处直接读取共享的全局词法变量（同为 classic <script>，作用域互通）。
function sysEmployees(){
  try{if(typeof employees!=='undefined'&&Array.isArray(employees))return employees;}catch(_){}
  return Array.isArray(window.employees)?window.employees:null;
}
function sysPositions(){
  try{if(typeof positions!=='undefined'&&Array.isArray(positions))return positions;}catch(_){}
  return Array.isArray(window.positions)?window.positions:[];
}
// 职类：优先员工自身 cat 字段，否则取岗位类别
function empCat(e){
  if(e.cat)return e.cat;
  try{const p=sysPositions().find(x=>x.name===e.position);if(p&&p.category)return p.category;}catch(_){}
  return '';
}
// 当前花名册：与「员工信息录入」一致（取系统 employees），仅含国籍为「中国」者；为空时回退样本
function roster(){
  const emps=sysEmployees();
  let list;
  if(emps&&emps.length){
    list=emps.filter(e=>e.nationality==='中国'&&e.status!=='resigned');   // 中方考勤仅限国籍中国且在职
  }else{
    list=SAMPLE_ROSTER;   // 内置样本花名册视为中方驻墨人员
  }
  return list.map(e=>({id:String(e.id),name:e.name,dept:e.dept||'',section:e.section||'',cat:empCat(e)}));
}

function wd(day){return new Date(curY,curM-1,day).getDay();}   // 0=周日 … 6=周六
const WCN=['日','一','二','三','四','五','六'];
function buildWeekId(){WEEKID=[];}

// 加载某月：localStorage 优先 → 默认月样本预填 → 空白
function loadMonth(){
  DIM=new Date(curY,curM,0).getDate();
  buildWeekId();
  refreshHols();
  let saved=null; try{saved=JSON.parse(localStorage.getItem(lsKey()));}catch(e){}
  const savedMap={}; if(saved&&saved.length)saved.forEach(r=>savedMap[String(r.id)]=r.days);
  const seed=(curY===SRC.year&&curM===SRC.month);   // 仅默认样本月预填
  RECS=roster().map(r=>{
    let days;
    if(savedMap[r.id]) days=savedMap[r.id].slice();
    else if(seed&&SAMPLE_DAYS[r.id]) days=SAMPLE_DAYS[r.id].slice();
    else days=Array(DIM).fill('');
    if(days.length<DIM) days=days.concat(Array(DIM-days.length).fill(''));
    else if(days.length>DIM) days=days.slice(0,DIM);
    return {...r,days};
  });
}
function persist(){try{localStorage.setItem(lsKey(),JSON.stringify(RECS.map(r=>({id:r.id,days:r.days}))));}catch(e){}}

window.cnChMonth=function(delta){
  let m=curM+delta,y=curY; if(m>12){m=1;y++;} if(m<1){m=12;y--;}
  curY=y;curM=m; loadMonth(); updateMonthLabels();
  const ana=$('cn-analysis-panel');
  if(ana&&ana.style.display!=='none') cnRenderAnalysis(); else cnRenderGrid();
};
function updateMonthLabels(){['cn-rep-month','cn-ana-month'].forEach(id=>{if($(id))$(id).textContent=monthLabel();});}

/* ---------- 职类 ---------- */
// 业务职 = 管理职M / 技术职T / 职能职P ; 技能职 = 班长O-S / 普通O
function isBiz(c){return c==='M'||c==='T'||c==='P';}
function isMgmt(c){return c==='M';}
function isLeader(c){return c==='O-S';}
function isReg(c){return c==='O';}
function catGroup(c){
  if(c==='M')return '管理职';
  if(c==='T')return '技术职';
  if(c==='P')return '职能职';
  if(c==='O-S')return '技能职·班长';
  if(c==='O')return '技能职·普通';
  return '其他';
}
function catBucket(c){ // 加班算法分组
  if(isMgmt(c))return '管理职';
  if(c==='T'||c==='P')return '业务职';
  if(isLeader(c))return '技能职·班长';
  if(isReg(c))return '技能职·普通';
  return '业务职';
}

/* ---------- 单元格解析 ---------- */
// 返回 {k:类型, h:工时}
function parse(v){
  v=(v||'').trim();
  if(v==='')              return {k:'none'};
  if(v==='▲')             return {k:'qj'};      // 探亲假
  if(v==='○')             return {k:'sj'};      // 事假
  if(v==='H')             return {k:'hun'};     // 婚假
  if(v==='S')             return {k:'sang'};    // 丧假
  if(v==='P')             return {k:'pei'};     // 陪产假
  if(v==='B')             return {k:'bing'};    // 病假
  if(v==='■')             return {k:'chai'};    // 出差
  if(v==='LD')            return {k:'ldoff'};   // 国外周末
  if(v==='HL')            return {k:'hl'};      // 法定节假日
  if(v==='休')            return {k:'cnoff'};   // 国内周末（探亲在国内休）
  if(v==='V')             return {k:'travel'};  // 往返路上
  const m=v.match(/^国内\s*(\d+(?:\.\d+)?)$/);
  if(m)                   return {k:'cn',h:parseFloat(m[1])};
  const n=parseFloat(v);
  if(!isNaN(n)&&/^\d+(\.\d+)?$/.test(v)) return {k:'ow',h:n};   // 国外工时
  return {k:'other',raw:v};
}
// 单元格配色类
function cellCls(p){
  switch(p.k){
    case 'ow':return 'cd-ow'; case 'cn':return 'cd-cn';
    case 'qj':return 'cd-qj'; case 'sj':return 'cd-sj';
    case 'bing':return 'cd-bing'; case 'hun':case 'sang':case 'pei':return 'cd-paid';
    case 'ldoff':return 'cd-ld'; case 'cnoff':return 'cd-rest'; case 'hl':return 'cd-hl';
    case 'travel':return 'cd-v'; case 'chai':return 'cd-chai';
    default:return '';
  }
}

/* ---------- 应出勤工时（用于 0.5 天判定） ---------- */
function reqHours(cat,day,loc){
  const w=wd(day);
  if(w===0)return 0;                 // 周日无应出勤
  if(loc==='cn')return 8;            // 国内：满 8 为一天
  if(isBiz(cat))return w===6?4:9;    // 业务职：周一~五 9h，周六 4h
  return 8;                          // 技能职：每天 8h
}

/* ---------- 墨西哥法定节假日 ---------- */
// 返回某年某月中节假日的日期集合（Set<number>）
function nthWeekdayOfMonth(y,m,nth,dow){ // dow: 0=日,1=一...6=六
  const first=new Date(y,m-1,1).getDay();
  const d=1+(dow-first+7)%7+(nth-1)*7;
  return d<=new Date(y,m,0).getDate()?d:null;
}
const MEX_HOL_NAMES={
  '1-1':'元旦','5-1':'劳动节','9-16':'独立日','12-25':'圣诞节',
  'feb1mon':'宪法纪念日','mar3mon':'华雷斯诞辰','nov3mon':'革命纪念日',
  'elec':'总统选举日',
};
function getMexHolidays(y,m){
  const hols=new Map(); // day→name
  const add=(hm,hd,name)=>{if(hm===m&&hd)hols.set(hd,name);};
  // 固定节假日
  add(1,1,'元旦'); add(5,1,'劳动节'); add(9,16,'独立日'); add(12,25,'圣诞节');
  // 浮动节假日
  add(2,nthWeekdayOfMonth(y,2,1,1),'宪法纪念日');
  add(3,nthWeekdayOfMonth(y,3,3,1),'华雷斯诞辰');
  add(11,nthWeekdayOfMonth(y,11,3,1),'革命纪念日');
  // 总统选举日（每6年）：2018=7/1, 2024=6/2, 2030起第一个周日
  if(y===2018)add(7,1,'总统选举日');
  else if(y===2024)add(6,2,'总统选举日');
  else if(y>2024&&(y-2024)%6===0)add(6,nthWeekdayOfMonth(y,6,1,0),'总统选举日');
  return hols;
}
// 当月节假日（在渲染前计算一次，compute 复用）
let _curHols=new Map();
function refreshHols(){_curHols=getMexHolidays(curY,curM);}

/* ---------- 计算引擎 ---------- */
function compute(rec){
  const cat=rec.cat;
  let owDays=0,cnDays=0,qj=0,sj=0,bing=0,paid=0,hl=0,ld=0,travel=0,kh=0;
  let owActualNoSun=0;               // 实际海外出勤（不含周日）
  let region=0,total=0;
  let bizY=0,bizW=0,skY=0,skW=0,cnY=0,cnW=0,holOT=0;
  let totHours=0;                    // 工作总时长（含加班）

  rec.days.forEach((cell,i)=>{
    const day=i+1, w=wd(day), p=parse(cell);
    const isHol=_curHols.has(day); // 是否法定节假日
    if(p.k==='ow'){
      const req=reqHours(cat,day,'ow');
      const frac=(w===0)?1:(p.h>=req?1:0.5);
      owDays+=frac; totHours+=p.h;
      if(w!==0)owActualNoSun+=frac;
      region+=frac;
      if(isHol){
        holOT+=p.h; // 节假日出勤：全部计入节假日加班，不再计入普通延时
      } else if(isMgmt(cat)){/* 管理职加班=0 */}
      else if(isBiz(cat)){
        // 业务职：按天计算超出标准工时的部分为延时；周日全部计周末加班
        if(w===0) bizW+=p.h;
        else { const std=w===6?4:9; bizY+=Math.max(0,p.h-std); }
      }else if(isLeader(cat)){
        if(p.h>8)skY+=p.h-8; // 班长：每天（含周六周日）超8h = 延时，无周末加班
      }else if(isReg(cat)){
        if(w===0) skW+=p.h; else skY+=Math.max(0,p.h-8); // 普通：每天超8h；周日计周末
      }
    }else if(p.k==='cn'){
      const frac=p.h>=8?1:0.5;
      cnDays+=frac; totHours+=p.h;
      if(w===0){cnW+=p.h;}
      else{
        const reqCn=isBiz(cat)?(w===6?4:9):8;
        if(p.h>reqCn)cnY+=p.h-reqCn;
      }
    }else if(p.k==='travel'){ owDays+=1; region+=1; owActualNoSun+=(w===0?0:1); }
    else if(p.k==='chai'){ owDays+=1; region+=1; owActualNoSun+=(w===0?0:1); }
    else if(p.k==='hl'){ owDays+=1; hl++; region+=1; }
    else if(p.k==='ldoff'){ ld++; region+=1; }
    else if(p.k==='qj'){ if((isReg(cat)||isLeader(cat))&&w===0){/* 技能职周日探亲假不计 */}else qj++; }
    else if(p.k==='sj'){ sj++; }
    else if(p.k==='bing'){ bing++; }
    else if(p.k==='hun'||p.k==='sang'||p.k==='pei'){ paid++; }
  });

  total=owDays+cnDays;
  const owY = isBiz(cat)?bizY:skY;        // 国外延时
  const owW = isBiz(cat)?bizW:skW;        // 国外周末
  const qjReport=qj;   // 技能职探亲假计入总出勤（周日已排除）
  total=owDays+cnDays+qjReport;           // 探亲假计入出勤天数
  const zhuwai = isReg(cat)?0:region;      // 普通技能职驻外补贴=0
  const actual = isReg(cat)?owActualNoSun:null;       // 实际海外出勤仅普通技能职
  const meal=cnDays;
  const otTotal=owY+owW+cnY+cnW+holOT;

  return {id:rec.id,name:rec.name,dept:rec.dept,section:rec.section,cat,group:catGroup(cat),bucket:catBucket(cat),
    total:+total.toFixed(1),owDays:+owDays.toFixed(1),cnDays:+cnDays.toFixed(1),
    qj,sj,bing,paid,hl,ld,
    owY:+owY.toFixed(1),owW:+owW.toFixed(1),cnY:+cnY.toFixed(1),cnW:+cnW.toFixed(1),holOT,
    region:+region.toFixed(1),zhuwai:+zhuwai.toFixed(1),actual:actual==null?null:+actual.toFixed(1),meal:+meal.toFixed(1),
    totHours:+totHours.toFixed(1),otTotal:+otTotal.toFixed(1)};
}
function computeAll(list){return list.map(compute);}

/* ---------- 过滤 ---------- */
function filtered(){
  const dep=$('cn-dept-f')?$('cn-dept-f').value:'';
  const cat=$('cn-cat-f')?$('cn-cat-f').value:'';
  return RECS.filter(r=>(!dep||r.dept===dep)&&(!cat||catGroup(r.cat)===cat));
}
function depts(){const s=new Set();RECS.forEach(r=>s.add(r.dept));return [...s];}

/* ===================================================================
   渲染：页面 / Tab 切换
   =================================================================== */
window.cnRenderPage=function(){
  loadMonth();
  // 填充部门筛选器
  ['cn-dept-f','cn-rep-dept-f'].forEach(id=>{const s=$(id);if(s){const cur=s.value;s.innerHTML='<option value="">全部部门</option>'+depts().map(d=>`<option value="${esc(d)}">${esc(d)}</option>`).join('');s.value=cur;}});
  updateMonthLabels();
  cnRenderGrid();
};
window.cnSwitchTab=function(tab,el){
  D.querySelectorAll('#page-cn-attendance .tab').forEach(t=>t.classList.remove('active'));
  el.classList.add('active');
  $('cn-report-panel').style.display=tab==='report'?'block':'none';
  $('cn-analysis-panel').style.display=tab==='analysis'?'block':'none';
  if($('cn-leave-panel'))$('cn-leave-panel').style.display=tab==='leave'?'block':'none';
  if(tab==='report')cnRenderGrid();else if(tab==='analysis')cnRenderAnalysis();else cnRenderLeave();
};

/* ===================================================================
   Tab1 — 月度考勤提报网格
   =================================================================== */
window.cnRenderGrid=function(){
  const dep=$('cn-rep-dept-f')?$('cn-rep-dept-f').value:'';
  const q=($('cn-rep-search')?$('cn-rep-search').value:'').trim().toLowerCase();
  const list=RECS.filter(r=>(!dep||r.dept===dep)&&(!q||r.name.toLowerCase().includes(q)||String(r.id).includes(q)));
  // 表头
  let head='<th class="cn-fix cn-fix1">工号</th><th class="cn-fix cn-fix2">姓名</th><th class="cn-fix cn-fix3">部门</th><th>职类</th>';
  for(let d=1;d<=DIM;d++){
    const w=wd(d),isHol=_curHols.has(d),holName=_curHols.get(d)||'';
    const cls=(w===0?'cn-sun':w===6?'cn-sat':'')+(isHol?' cn-hol-head':'');
    head+=`<th class="${cls}" title="${isHol?holName:''}">${d}${isHol?'<span style="font-size:8px;display:block;color:#b45309">🇲🇽</span>':'<br>'}<span style="font-weight:400;font-size:9px">${WCN[w]}</span></th>`;
  }
  $('cn-grid-head').innerHTML=head;
  const idxBase=RECS; // for editing reference
  $('cn-grid-body').innerHTML=list.map(r=>{
    const ri=RECS.indexOf(r);
    let cells='';
    for(let d=0;d<DIM;d++){
      const p=parse(r.days[d]);
      cells+=`<td class="${cellCls(p)}"><input class="cn-cell" value="${esc(r.days[d])}" data-r="${ri}" data-d="${d}"></td>`;
    }
    return `<tr><td class="cn-fix cn-fix1" style="font-family:monospace;font-size:11px">${esc(r.id)}</td><td class="cn-fix cn-fix2"><strong>${esc(r.name)}</strong></td><td class="cn-fix cn-fix3" style="font-size:11px;color:var(--color-text-secondary)">${esc(r.dept)}</td><td style="font-size:11px;white-space:nowrap">${esc(catGroup(r.cat))}</td>${cells}</tr>`;
  }).join('');
  // 绑定编辑（含输入校验）
  $('cn-grid-body').querySelectorAll('.cn-cell').forEach(inp=>{
    inp.addEventListener('change',e=>{
      const raw=e.target.value.trim();
      if(raw!==''&&parse(raw).k==='other'){
        e.target.style.outline='2px solid #ef4444';
        e.target.title='无效值：只允许数字、国内X、▲○HSPB■VLDHLor休';
        if(window.toast)toast(`⚠️ "${raw}" 不是有效的考勤符号，已拒绝写入`);
        e.target.value=RECS[+e.target.dataset.r].days[+e.target.dataset.d]||''; // 恢复旧值
        return;
      }
      e.target.style.outline='';e.target.title='';
      const ri=+e.target.dataset.r,di=+e.target.dataset.d;
      RECS[ri].days[di]=raw;
      persist();
      const td=e.target.parentElement;
      td.className=cellCls(parse(raw));
    });
  });
  if($('cn-rep-count'))$('cn-rep-count').textContent=`${list.length} 人`;
};

/* ===================================================================
   Tab2 — 分析汇总
   =================================================================== */
const charts={};
function card(val,label,sub,bg,fg){
  return `<div class="cn-kpi" style="background:${bg};color:${fg}"><div class="cn-kpi-v">${val}</div><div class="cn-kpi-l">${label}</div>${sub?`<div class="cn-kpi-s">${sub}</div>`:''}</div>`;
}
window.cnRenderAnalysis=function(){
  const list=filtered();
  const rows=computeAll(list);
  const n=rows.length;
  const sum=k=>rows.reduce((s,r)=>s+(r[k]||0),0);
  const owD=sum('owDays'),cnD=sum('cnDays');
  const otAll=sum('owY')+sum('owW')+sum('cnY')+sum('cnW');
  const totH=sum('totHours');
  const weeks=DIM/7;
  // --- KPI 卡 ---
  $('cn-kpi-cards').innerHTML=[
    card(n,'在册人数','名',  '#eef2ff','#3730a3'),
    card(sum('total').toFixed(0),'总出勤','含探亲假 (人·天)', '#ecfdf5','#065f46'),
    card(owD.toFixed(0),'驻外出勤',`国内 ${cnD.toFixed(0)} 人·天`, '#eff6ff','#1e40af'),
    card(otAll.toFixed(0),'加班总时数','延时+周末 (h)', '#fff7ed','#9a3412'),
    card((totH/Math.max(1,n)/weeks).toFixed(1),'人均周工时','含加班 (h)', '#fef2f2','#991b1b'),
    card(sum('qj'),'探亲假',`事假 ${sum('sj')} · 病假 ${sum('bing')} (天)`, '#fefce8','#854d0e'),
  ].join('');

  // --- 按职类（加班算法分组）---
  const buckets=['业务职','管理职','技能职·班长','技能职·普通'];
  const bg={};buckets.forEach(b=>bg[b]={n:0,owD:0,cnD:0,total:0,owY:0,owW:0,cnY:0,cnW:0});
  rows.forEach(r=>{const b=bg[r.bucket]||(bg[r.bucket]={n:0,owD:0,cnD:0,total:0,owY:0,owW:0,cnY:0,cnW:0});b.n++;b.owD+=r.owDays;b.cnD+=r.cnDays;b.total+=r.total;b.owY+=r.owY;b.owW+=r.owW;b.cnY+=r.cnY;b.cnW+=r.cnW;});
  const ruleNote={'业务职':'周一~五9h/周六4h，周累计>49h记延时，周日记周末加班','管理职':'加班时长默认全部为 0','技能职·班长':'每天超 8h 记延时加班（含周六周日）','技能职·普通':'周一~六累计>48h记延时，周日记周末加班'};
  $('cn-cat-body').innerHTML=buckets.filter(b=>bg[b]&&bg[b].n).map(b=>{const g=bg[b];return `<tr><td><strong>${b}</strong><div style="font-size:10px;color:var(--color-text-tertiary);font-weight:400;line-height:1.4">${ruleNote[b]||''}</div></td><td style="text-align:right">${g.n}</td><td style="text-align:right">${g.total.toFixed(1)}</td><td style="text-align:right;font-family:monospace">${(g.owY+g.cnY).toFixed(1)}</td><td style="text-align:right;font-family:monospace">${(g.owW+g.cnW).toFixed(1)}</td><td style="text-align:right;font-family:monospace;font-weight:600">${(g.owY+g.owW+g.cnY+g.cnW).toFixed(1)}</td></tr>`;}).join('');

  // --- 加班强度分布（平均每周加班）---
  const bands=[{l:'≤8h',min:0,max:8},{l:'8~16h',min:8,max:16},{l:'16~24h',min:16,max:24},{l:'24~36h',min:24,max:36},{l:'36~44h',min:36,max:44},{l:'>44h',min:44,max:1e9}];
  const dist=bands.map(()=>0);
  rows.forEach(r=>{const wOT=r.otTotal/weeks;for(let i=0;i<bands.length;i++){if(wOT>bands[i].min&&wOT<=bands[i].max+1e-9){dist[i]++;break;}if(i===bands.length-1)dist[i]++;}});
  // 补贴
  $('cn-allow-cards').innerHTML=[
    card(sum('region').toFixed(0),'地区补贴','人·天','#f0fdfa','#115e59'),
    card(sum('zhuwai').toFixed(0),'驻外补贴','人·天','#eef2ff','#3730a3'),
    card(sum('meal').toFixed(0),'餐补','=国内出勤 (天)','#fefce8','#854d0e'),
    card(rows.filter(r=>r.actual!=null).reduce((s,r)=>s+r.actual,0).toFixed(0),'实际海外出勤','普通技能职·不含周日','#eff6ff','#1e40af'),
  ].join('');

  drawCharts(buckets.filter(b=>bg[b]&&bg[b].n),bg,bands,dist);

  // --- 明细表（支持独立筛选）---
  _cnAnaRows=rows;
  const ddf=$('cn-detail-dept');
  if(ddf){const cur=ddf.value;ddf.innerHTML='<option value="">全部部门</option>'+[...new Set(rows.map(r=>r.dept))].map(d=>`<option value="${esc(d)}">${esc(d)}</option>`).join('');ddf.value=[...new Set(rows.map(r=>r.dept))].includes(cur)?cur:'';}
  cnRenderDetail();
};

let _cnAnaRows=[];
window.cnRenderDetail=function(){
  let rows=_cnAnaRows.slice();
  const q=($('cn-detail-search')?$('cn-detail-search').value:'').trim().toLowerCase();
  const dep=$('cn-detail-dept')?$('cn-detail-dept').value:'';
  const cat=$('cn-detail-cat')?$('cn-detail-cat').value:'';
  if(q)rows=rows.filter(r=>r.name.toLowerCase().includes(q)||String(r.id).includes(q));
  if(dep)rows=rows.filter(r=>r.dept===dep);
  if(cat)rows=rows.filter(r=>r.group===cat);
  const srt=$('cn-ana-sort')?$('cn-ana-sort').value:'ot';
  rows.sort((a,b)=> srt==='ot'?b.otTotal-a.otTotal : srt==='total'?b.total-a.total : String(a.dept).localeCompare(b.dept,'zh'));
  $('cn-detail-body').innerHTML=rows.length?rows.map(r=>`<tr>
    <td style="font-family:monospace;font-size:11px">${esc(r.id)}</td><td><strong>${esc(r.name)}</strong></td>
    <td style="font-size:11px;color:var(--color-text-secondary)">${esc(r.dept)}</td><td style="font-size:11px;color:var(--color-text-secondary)">${esc(r.section)}</td>
    <td><span class="cn-tag cn-tag-${r.bucket.includes('管理')?'m':r.bucket.includes('业务')?'b':r.bucket.includes('班长')?'l':'o'}">${esc(r.group)}</span></td>
    <td class="num">${r.total}</td><td class="num">${r.owDays}</td><td class="num">${r.cnDays}</td>
    <td class="num">${r.qj||''}</td><td class="num">${r.sj||''}</td><td class="num">${r.bing||''}</td><td class="num">${r.paid||''}</td><td class="num">${r.hl||''}</td>
    <td class="num hl-ot">${r.cnY||''}</td><td class="num hl-ot">${r.cnW||''}</td><td class="num hl-ot">${r.owY||''}</td><td class="num hl-ot">${r.owW||''}</td><td class="num hl-ot" style="background:#fefce8;font-weight:${r.holOT?'600':'400'};color:${r.holOT?'#854d0e':'var(--color-text-tertiary)'}">${r.holOT||''}</td>
    <td class="num">${r.region}</td><td class="num">${r.zhuwai}</td><td class="num">${r.actual==null?'—':r.actual}</td><td class="num">${r.meal}</td>
  </tr>`).join(''):'<tr><td colspan="22" style="text-align:center;padding:30px;color:var(--color-text-tertiary)">无符合条件的记录</td></tr>';
  if($('cn-ana-count'))$('cn-ana-count').textContent=`${rows.length} 人`;
};

function drawCharts(buckets,bg,bands,dist){
  if(typeof Chart==='undefined')return;
  const f={font:{family:'inherit'}};
  // 加班强度分布
  const c2=$('cnChart2');
  if(c2){if(charts.c2)charts.c2.destroy();
    charts.c2=new Chart(c2.getContext('2d'),{type:'bar',data:{labels:bands.map(b=>b.l),datasets:[{label:'人数',data:dist,backgroundColor:bands.map((b,i)=>['#86efac','#bef264','#fde047','#fbbf24','#fb923c','#ef4444'][i]),borderRadius:4}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false},tooltip:{callbacks:{title:i=>'平均每周加班 '+i[0].label}}},scales:{y:{beginAtZero:true,title:{display:true,text:'人数'}}}}});
  }
}

/* ---------- 导出 / 保存 ---------- */
window.cnSave=function(){persist();if(window.toast)toast('✅ 中方考勤已保存');};
window.cnReset=function(){if(!confirm('确定清空本月考勤并按当前花名册重置？'))return;localStorage.removeItem(lsKey());loadMonth();cnRenderGrid();if(window.toast)toast('已重置本月考勤');};
window.cnExportAnalysis=function(){
  if(typeof XLSX==='undefined'){if(window.toast)toast('导出组件未就绪');return;}
  const rows=computeAll(filtered());
  const head=['工号','姓名','部门','科室','职类','总出勤','驻外出勤','国内出勤','探亲假','事假','病假','带薪假','法定节假日','国内延时(h)','国内周末(h)','国外延时(h)','国外周末(h)','节假日加班(h)','地区补贴','驻外补贴','实际海外出勤','餐补'];
  const aoa=[head,...rows.map(r=>[r.id,r.name,r.dept,r.section,r.group,r.total,r.owDays,r.cnDays,r.qj,r.sj,r.bing,r.paid,r.hl,r.cnY,r.cnW,r.owY,r.owW,r.holOT||0,r.region,r.zhuwai,r.actual==null?'':r.actual,r.meal])];
  const ws=XLSX.utils.aoa_to_sheet(aoa);const wb=XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb,ws,`${curY}-${curM}核算`);
  XLSX.writeFile(wb,`中方考勤核算_${curY}-${String(curM).padStart(2,'0')}.xlsx`);
  if(window.toast)toast('导出成功');
};

/* ---------- 批量导入 ---------- */
window.cnDlTemplate=function(){
  if(typeof XLSX==='undefined'){if(window.toast)toast('导出组件未就绪');return;}
  const head=['工号','姓名','职类'];
  for(let d=1;d<=DIM;d++)head.push(String(d));
  const aoa=[head];
  RECS.forEach(r=>{const row=[r.id,r.name,r.cat];for(let d=0;d<DIM;d++)row.push(r.days[d]||'');aoa.push(row);});
  const ws=XLSX.utils.aoa_to_sheet(aoa);
  const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,ws,`${curY}-${curM}考勤`);
  const note=[['填写说明（仅供参考，导入时本页忽略）'],['数字','国外工时（如 9、12、16）'],['国内8 / 国内12','国内工时'],['▲','探亲假'],['○','事假'],['B','病假'],['H','婚假'],['S','丧假'],['P','陪产假'],['■','出差'],['V','往返路上'],['LD','国外周末'],['休','国内周末'],['HL','法定节假日'],['',''],['按「工号」匹配现有花名册导入；列 1~'+DIM+' 对应当月 1~'+DIM+' 号']];
  XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet(note),'填写说明');
  XLSX.writeFile(wb,`中方考勤导入模板_${curY}-${String(curM).padStart(2,'0')}.xlsx`);
  if(window.toast)toast('模板已下载');
};
window.cnImportFile=function(e){
  if(typeof XLSX==='undefined'){if(window.toast)toast('导入组件未就绪');return;}
  const f=e.target.files[0];if(!f)return;
  const r=new FileReader();
  r.onload=function(ev){
    try{
      const wb=XLSX.read(ev.target.result,{type:'array'});
      const ws=wb.Sheets[wb.SheetNames[0]];
      const rows=XLSX.utils.sheet_to_json(ws,{header:1,defval:''});
      if(!rows.length){if(window.toast)toast('文件为空');e.target.value='';return;}
      const header=rows[0].map(x=>String(x).trim());
      const dayCol={};header.forEach((h,ci)=>{const m=h.match(/^(\d{1,2})$/);if(m){const dn=+m[1];if(dn>=1&&dn<=DIM)dayCol[dn]=ci;}});
      let idCol=header.findIndex(h=>h==='工号'||h.toLowerCase()==='id');if(idCol<0)idCol=0;
      let matched=0,skipped=0;
      for(let ri=1;ri<rows.length;ri++){
        const row=rows[ri];if(!row||!row.length)continue;
        const id=String(row[idCol]||'').trim();
        if(!id)continue;
        const rec=RECS.find(x=>String(x.id)===id);
        if(!rec){skipped++;continue;}
        let badVals=[];
        for(let d=1;d<=DIM;d++){if(dayCol[d]!=null){const v=(v2=>v2==null?'':String(v2).trim())(row[dayCol[d]]);if(v!==''&&parse(v).k==='other'){badVals.push(`${d}日:"${v}"`);rec.days[d-1]='';}else{rec.days[d-1]=v;}}}
        if(badVals.length&&window.toast)toast(`⚠️ ${rec.name}(${id}) 含无效值已清空：${badVals.slice(0,3).join('、')}${badVals.length>3?'…':''}`,5000);
        matched++;
      }
      persist();
      const ana=$('cn-analysis-panel');
      if(ana&&ana.style.display!=='none')cnRenderAnalysis();else cnRenderGrid();
      if(window.toast)toast(`导入完成：更新 ${matched} 人${skipped?`，未匹配 ${skipped}`:''}`);
    }catch(err){console.error(err);if(window.toast)toast('导入失败：'+err.message);}
    e.target.value='';
  };
  r.readAsArrayBuffer(f);
};

/* ===================================================================
   Tab3 — 休假台账
   =================================================================== */

// 从 localStorage 读取某月某人的日程数据
function cnGetMonthDays(y,m,empId){
  const key=`cnAtt_${y}-${String(m).padStart(2,'0')}`;
  let saved=null;try{saved=JSON.parse(localStorage.getItem(key));}catch(e){}
  if(!saved)return null;
  const rec=saved.find(r=>String(r.id)===String(empId));
  return rec?rec.days:null;
}

// 构建某员工的全历史时间线 [{date,val}, ...]，按月升序扫描 localStorage
function cnBuildTimeline(empId){
  const keys=[];
  try{for(const k in localStorage){if(k.startsWith('cnAtt_'))keys.push(k);}}catch(e){}
  keys.sort();
  const timeline=[];
  keys.forEach(key=>{
    const ym=key.slice(6);
    const y=+ym.slice(0,4),m=+ym.slice(5,7);
    const days=cnGetMonthDays(y,m,empId);
    if(!days)return;
    const dim=new Date(y,m,0).getDate();
    for(let d=1;d<=dim;d++){
      const val=(days[d-1]||'').trim();
      timeline.push({date:new Date(y,m-1,d),val});
    }
  });
  return timeline;
}

function fmtDate(d){
  if(!d)return '—';
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
function dayDiff(a,b){return Math.round((b-a)/86400000);}

// 从时间线提取探亲假旅程：模式 …V, ▲+, V…
function cnExtractTrips(timeline){
  const trips=[];
  let i=0;
  while(i<timeline.length){
    if(parse(timeline[i].val).k==='qj'){
      const qjStart=i;
      while(i<timeline.length&&parse(timeline[i].val).k==='qj')i++;
      const qjEnd=i-1;
      const leaveDays=qjEnd-qjStart+1;
      let startDate=null;
      for(let j=qjStart-1;j>=0;j--){if(parse(timeline[j].val).k==='travel'){startDate=timeline[j].date;break;}}
      let endDate=null;
      for(let j=qjEnd+1;j<timeline.length;j++){if(parse(timeline[j].val).k==='travel'){endDate=timeline[j].date;break;}}
      trips.push({startDate,endDate,leaveDays});
    }else{
      i++;
    }
  }
  return trips;
}

// 应休假天数 = INT((startDate - prevEndDate + 1) / 320 * 45)
function entitledDays(startDate,prevEndDate){
  if(!startDate||!prevEndDate)return 0;
  const days=dayDiff(prevEndDate,startDate)+1;
  return Math.floor(Math.max(0,days)/320*45);
}

function cnBuildLeaveRows(){
  const rows=[];
  RECS.forEach(r=>{
    const timeline=cnBuildTimeline(r.id);
    const trips=cnExtractTrips(timeline);
    let balance=0;
    let prevEndDate=null;
    trips.forEach((t,idx)=>{
      const entitled=entitledDays(t.startDate,prevEndDate);
      const overdue=t.leaveDays-entitled;
      rows.push({id:r.id,name:r.name,dept:r.dept,cat:catGroup(r.cat),seq:idx+1,startDate:t.startDate,endDate:t.endDate,leaveDays:t.leaveDays,entitled,balance,overdue});
      balance=balance+entitled-t.leaveDays;
      prevEndDate=t.endDate;
    });
  });
  return rows;
}

let _cnLeaveRows=[];
window.cnRenderLeave=function(){
  const ddf=$('cn-leave-dept-f');
  if(ddf){const cur=ddf.value;ddf.innerHTML='<option value="">全部部门</option>'+depts().map(d=>`<option value="${esc(d)}">${esc(d)}</option>`).join('');ddf.value=depts().includes(cur)?cur:'';}
  const dep=$('cn-leave-dept-f')?$('cn-leave-dept-f').value:'';
  const q=($('cn-leave-search')?$('cn-leave-search').value:'').trim().toLowerCase();
  _cnLeaveRows=cnBuildLeaveRows();
  let rows=_cnLeaveRows;
  if(dep)rows=rows.filter(r=>r.dept===dep);
  if(q)rows=rows.filter(r=>r.name.toLowerCase().includes(q)||String(r.id).includes(q));
  const body=$('cn-leave-body');
  if(!body)return;
  if(!rows.length){body.innerHTML='<tr><td colspan="11" style="text-align:center;padding:30px;color:var(--color-text-tertiary)">暂无探亲假记录（需要录入含 V 和 ▲ 的考勤数据）</td></tr>';return;}
  body.innerHTML=rows.map(r=>{
    const overdueColor=r.overdue>0?'color:#dc2626;font-weight:600':r.overdue<0?'color:#16a34a':'';
    const balanceColor=r.balance<0?'color:#dc2626':'';
    return `<tr>
      <td style="font-family:monospace;font-size:11px">${esc(r.id)}</td>
      <td><strong>${esc(r.name)}</strong></td>
      <td style="font-size:11px">${esc(r.dept)}</td>
      <td><span class="cn-tag cn-tag-${r.cat.includes('管理')?'m':r.cat.includes('技术')||r.cat.includes('职能')?'b':r.cat.includes('班长')?'l':'o'}">${esc(r.cat)}</span></td>
      <td style="text-align:center">${r.seq}</td>
      <td style="font-family:monospace;font-size:12px">${fmtDate(r.startDate)}</td>
      <td style="font-family:monospace;font-size:12px">${fmtDate(r.endDate)}</td>
      <td class="num">${r.leaveDays}</td>
      <td class="num">${r.entitled}</td>
      <td class="num" style="${balanceColor}">${r.balance}</td>
      <td class="num" style="${overdueColor}">${r.overdue>0?'+'+r.overdue:r.overdue}</td>
    </tr>`;
  }).join('');
};

window.cnExportLeave=function(){
  if(typeof XLSX==='undefined'){if(window.toast)toast('导出组件未就绪');return;}
  if(!_cnLeaveRows.length){if(window.toast)toast('暂无数据');return;}
  const head=['工号','姓名','部门','职类','次序','假期开始（前V）','假期结束（后V）','休假天数','应休天数','前期结余','超期天数'];
  const aoa=[head,..._cnLeaveRows.map(r=>[r.id,r.name,r.dept,r.cat,r.seq,fmtDate(r.startDate),fmtDate(r.endDate),r.leaveDays,r.entitled,r.balance,r.overdue])];
  const ws=XLSX.utils.aoa_to_sheet(aoa);
  const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,ws,'休假台账');
  XLSX.writeFile(wb,'中方驻墨休假台账.xlsx');
  if(window.toast)toast('导出成功');
};

})();
