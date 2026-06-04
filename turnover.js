/* =====================================================================
   离职率分析模块  (Turnover analysis — Mexico plant only)
   依赖：主程序 allEmps()/empNat()/parseYMD()/isResigned()、Chart.js
   仅统计国籍为「墨西哥」的员工；以科室为单位，无科室者按部门归组。
   所有标识以 to / turnover 前缀，避免与主程序冲突。
   ===================================================================== */
(function(){
  function $(id){return document.getElementById(id);}
  function pad2(n){return String(n).padStart(2,'0');}
  function esc(s){return String(s==null?'':s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));}

  let toY=null,toM=null;
  let _trendChart=null,_tenureChart=null,_catChart=null,_typeChart=null;

  function nowYM(){
    try{if(typeof curY==='number'&&typeof curM==='number')return[curY,curM];}catch(_){}
    const d=new Date();return[d.getFullYear(),d.getMonth()+1];
  }
  function mLbl(y,m){try{if(typeof mLabel==='function')return mLabel(y,m);}catch(_){}return y+'年'+m+'月';}
  function pYMD(s){try{return parseYMD(s);}catch(_){return null;}}

  // 墨西哥工厂全部员工（含离职），按角色可见
  function mxAll(){
    let list;
    try{list=(typeof allEmps==='function')?allEmps():(window.employees||[]);}catch(_){list=window.employees||[];}
    const nat=e=>(e&&e.nationality)?e.nationality:'墨西哥';
    return list.filter(e=>nat(e)==='墨西哥');
  }
  function resignedOf(e){return e&&e.status==='resigned';}
  // 有效科室：若 section 为空、或等于部门名（"本部门直属"），均视为无科室
  function effSec(e){const s=e.section||'';return (s&&s!==(e.dept||''))?s:'';}
  function gKey(e){const s=effSec(e);return s?('S|'+(e.dept||'')+'|'+s):('D|'+(e.dept||'未分配'));}
  function gLabelSec(e){return effSec(e)||'—';}
  function gDept(e){return e.dept||'未分配';}

  // date 当天是否在职：入职<=date 且（未离职 或 离职日>=date）
  function employedOn(e,date){
    const jd=pYMD(e.joinDate); if(jd&&jd>date)return false;
    if(resignedOf(e)){const rd=pYMD(e.resignDate); if(rd&&rd<date)return false;}
    return true;
  }
  function joinedIn(e,first,last){const jd=pYMD(e.joinDate);return jd&&jd>=first&&jd<=last;}
  function resignedIn(e,first,last){if(!resignedOf(e))return false;const rd=pYMD(e.resignDate);return rd&&rd>=first&&rd<=last;}
  function tenureMonths(e){const jd=pYMD(e.joinDate),rd=pYMD(e.resignDate);if(!jd||!rd)return null;return (rd-jd)/(1000*60*60*24*30.4375);}

  // 计算某月某组人群指标
  function monthStat(emps,y,m){
    const first=new Date(y,m-1,1),last=new Date(y,m,0);
    let start=0,hires=0,resigns=0,end=0;
    emps.forEach(e=>{
      if(employedOn(e,first))start++;
      if(employedOn(e,last))end++;
      if(joinedIn(e,first,last))hires++;
      if(resignedIn(e,first,last))resigns++;
    });
    const avg=(start+end)/2;
    const rate=avg>0?(resigns/avg*100):null;
    return {start,hires,resigns,end,avg,rate};
  }
  function rateTxt(r){return r==null?'—':r.toFixed(1)+'%';}

  // 按部门聚合：部门有科室分类时，输出一行「部门汇总」(isDept) + 各科室明细；
  // 部门无科室时，仅输出一行部门级。返回有序行描述数组。
  function buildDeptRows(emps){
    const byDept={};
    emps.forEach(e=>{const d=gDept(e);if(!byDept[d])byDept[d]={dept:d,emps:[],secs:{}};byDept[d].emps.push(e);
      const sec=effSec(e);const sk=sec||'__none__';
      if(!byDept[d].secs[sk])byDept[d].secs[sk]={sec:sec||'部门直属',emps:[]};
      byDept[d].secs[sk].emps.push(e);});
    const deptList=Object.values(byDept).map(d=>({...d,st:monthStat(d.emps,toY,toM)}))
      .sort((a,b)=>(b.st.rate||0)-(a.st.rate||0)||b.st.resigns-a.st.resigns||b.st.start-a.st.start);
    const out=[];
    deptList.forEach(d=>{
      const hasRealSections=Object.keys(d.secs).some(k=>k!=='__none__');
      if(hasRealSections){
        out.push({dept:d.dept,sec:'部门汇总',isDept:true,st:d.st});
        Object.values(d.secs).map(s=>({sec:s.sec,st:monthStat(s.emps,toY,toM)}))
          .sort((a,b)=>(b.st.rate||0)-(a.st.rate||0)||b.st.resigns-a.st.resigns)
          .forEach(s=>out.push({dept:d.dept,sec:s.sec,isDept:false,st:s.st}));
      }else{
        out.push({dept:d.dept,sec:'',isDept:true,single:true,st:d.st});
      }
    });
    return out;
  }
  function rowHtml(row){
    const r=row.st;const hot=r.rate!=null&&r.rate>=10;
    const rateCol=hot?'#c0392b':(r.rate?'#b9770e':'var(--color-text-tertiary)');
    if(row.isDept){
      const b='font-weight:700;';
      return `<tr style="background:var(--color-background-info)"><td style="text-align:left;${b}">${esc(row.dept)}</td><td style="text-align:left;${b}color:var(--color-text-secondary)">${esc(row.sec)}</td><td style="${b}">${r.start}</td><td style="${b}color:#1f8a5b">${r.hires||'-'}</td><td style="${b}color:${r.resigns?'#c0392b':'inherit'}">${r.resigns||'-'}</td><td style="${b}">${r.end}</td><td style="${b}color:var(--color-text-secondary)">${r.avg?r.avg.toFixed(1):'-'}</td><td style="${b}color:${rateCol}">${rateTxt(r.rate)}</td></tr>`;
    }
    return `<tr><td></td><td style="text-align:left"><span style="color:#adb5bd">└</span> ${esc(row.sec)}</td><td>${r.start}</td><td style="color:#1f8a5b">${r.hires||'-'}</td><td style="color:${r.resigns?'#c0392b':'inherit'};font-weight:${r.resigns?600:400}">${r.resigns||'-'}</td><td>${r.end}</td><td style="color:var(--color-text-secondary)">${r.avg?r.avg.toFixed(1):'-'}</td><td style="font-weight:600;color:${rateCol}">${rateTxt(r.rate)}</td></tr>`;
  }

  // ---------- 渲染 ----------
  function renderTurnoverPage(){
    if(toY===null){const[y,m]=nowYM();toY=y;toM=m;}
    // 部门下拉
    const sel=$('to-dept-f');
    if(sel){const cur=sel.value;const depts=[...new Set(mxAll().map(gDept))].sort();
      sel.innerHTML='<option value="">全部部门</option>'+depts.map(d=>`<option value="${esc(d)}">${esc(d)}</option>`).join('');
      sel.value=cur;}
    renderTurnover();
    renderResignList();
  }

  function curEmps(){
    const dF=$('to-dept-f')?$('to-dept-f').value:'';
    return mxAll().filter(e=>!dF||gDept(e)===dF);
  }

  function renderTurnover(){
    $('to-month-lbl').textContent=mLbl(toY,toM);
    const emps=curEmps();
    // KPI 汇总
    const agg=monthStat(emps,toY,toM);
    const cards=[
      {l:'月初人数',v:agg.start,c:'var(--color-text-primary)'},
      {l:'入职人数',v:agg.hires,c:'#1f8a5b'},
      {l:'离职人数',v:agg.resigns,c:'#c0392b'},
      {l:'月末人数',v:agg.end,c:'var(--color-text-primary)'},
      {l:'当月离职率',v:rateTxt(agg.rate),c:'#b9770e'}
    ];
    $('to-kpi').innerHTML=cards.map(c=>`<div class="card" style="margin:0;padding:14px 16px"><div style="font-size:11px;color:var(--color-text-secondary);margin-bottom:6px">${c.l}</div><div style="font-size:26px;font-weight:600;color:${c.c}">${c.v}</div></div>`).join('');

    // 分组表：按部门聚合，部门下列出各科室，并加部门级汇总行（加粗高亮）
    $('to-table').innerHTML=buildDeptRows(emps).map(rowHtml).join('')||`<tr><td colspan="8" style="text-align:center;color:var(--color-text-tertiary);padding:18px">本月暂无数据</td></tr>`;
    // 趋势图仍以科室为单位
    const groups={};
    emps.forEach(e=>{const k=gKey(e);if(!groups[k])groups[k]={dept:gDept(e),sec:gLabelSec(e),emps:[]};groups[k].emps.push(e);});

    renderTenureChart(emps);
    renderTrendChart(groups);
    renderTypeCharts(emps);
  }

  // 离职类型统计（本月离职者）
  function typeCounts(emps){
    const first=new Date(toY,toM-1,1),last=new Date(toY,toM,0);
    const RT=window.RESIGN_TYPES||{'主动离职':['旷工离职','辞职','退休','死亡'],'被动离职':['公司解除','试用期不通过','人员优化']};
    const order=Object.keys(RT).reduce((a,c)=>a.concat(RT[c]),[]);
    const cnt={};order.forEach(t=>cnt[t]=0);
    let unknown=0,act=0,pas=0;
    emps.filter(e=>resignedIn(e,first,last)).forEach(e=>{
      const t=e.resignType;
      if(t&&cnt.hasOwnProperty(t)){cnt[t]++;const c=window.resignCategory?window.resignCategory(t):'';if(c==='主动离职')act++;else if(c==='被动离职')pas++;}
      else unknown++;
    });
    return {RT,order,cnt,unknown,act,pas,total:act+pas+unknown};
  }
  function typeColor(t){const c=window.resignCategory?window.resignCategory(t):'';return c==='被动离职'?'#2a6fdb':'#e6a23c';}
  function renderTypeCharts(emps){
    const tc=typeCounts(emps);
    const chip=(l,v,col)=>`<div style="border:1px solid var(--color-border-secondary);border-radius:8px;padding:6px 14px;min-width:78px;text-align:center"><div style="font-size:10px;color:var(--color-text-secondary)">${l}</div><div style="font-size:19px;font-weight:700;color:${col};line-height:1.2">${v}</div></div>`;
    const kpiEl=$('to-type-kpi');
    if(kpiEl)kpiEl.innerHTML=chip('本月离职',tc.total,'var(--color-text-primary)')+chip('主动离职',tc.act,'#b9770e')+chip('被动离职',tc.pas,'#2a6fdb')+(tc.unknown?chip('未分类',tc.unknown,'#868e96'):'');
    if(typeof Chart==='undefined')return;
    // doughnut：主动 / 被动 (+未分类)
    const catLabels=['主动离职','被动离职'],catData=[tc.act,tc.pas],catCol=['#e6a23c','#2a6fdb'];
    if(tc.unknown){catLabels.push('未分类');catData.push(tc.unknown);catCol.push('#ced4da');}
    const cc=$('to-chart-cat');
    if(cc){if(_catChart)_catChart.destroy();
      _catChart=new Chart(cc.getContext('2d'),{type:'doughnut',data:{labels:catLabels,datasets:[{data:tc.total?catData:[1],backgroundColor:tc.total?catCol:['#eef0f4'],borderWidth:2,borderColor:'#fff'}]},options:{animation:false,responsive:true,maintainAspectRatio:false,cutout:'58%',plugins:{legend:{position:'bottom',labels:{boxWidth:10,font:{size:11}}},title:{display:true,text:tc.total?'主动 / 被动 占比':'本月暂无离职',font:{size:12}},tooltip:{enabled:!!tc.total}}}});
    }
    // 横向柱：各离职类型人数
    const labels=tc.order.slice(),data=tc.order.map(t=>tc.cnt[t]),cols=tc.order.map(typeColor);
    if(tc.unknown){labels.push('未分类');data.push(tc.unknown);cols.push('#ced4da');}
    const te=$('to-chart-type');
    if(te){if(_typeChart)_typeChart.destroy();
      _typeChart=new Chart(te.getContext('2d'),{type:'bar',data:{labels,datasets:[{label:'离职人数',data,backgroundColor:cols,borderRadius:4}]},options:{indexAxis:'y',animation:false,responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false},title:{display:true,text:'各离职类型人数',font:{size:12}}},scales:{x:{beginAtZero:true,ticks:{precision:0}}}}});
    }
  }

  // 工龄分布（本月离职者）
  function renderTenureChart(emps){
    const first=new Date(toY,toM-1,1),last=new Date(toY,toM,0);
    const buckets=['≤1月','1–3月','3–6月','6–12月','>12月','未知'];
    const counts=[0,0,0,0,0,0];
    emps.filter(e=>resignedIn(e,first,last)).forEach(e=>{
      const t=tenureMonths(e);
      if(t==null)counts[5]++;
      else if(t<=1)counts[0]++;else if(t<=3)counts[1]++;else if(t<=6)counts[2]++;else if(t<=12)counts[3]++;else counts[4]++;
    });
    const ctx=$('to-chart-tenure').getContext('2d');
    if(_tenureChart)_tenureChart.destroy();
    _tenureChart=new Chart(ctx,{type:'bar',data:{labels:buckets,datasets:[{label:'离职人数',data:counts,backgroundColor:['#e07a5f','#e6a23c','#d4b483','#81b29a','#3d7a64','#adb5bd'],borderRadius:4}]},
      options:{animation:false,responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},scales:{y:{beginAtZero:true,ticks:{precision:0}}}}});
  }

  // 科室近6个月离职率趋势（取本月在岗人数最多的前 8 个科室 + 全厂总览线）
  function renderTrendChart(groups){
    const months=[];for(let i=5;i>=0;i--){let y=toY,m=toM-i;while(m<1){m+=12;y--;}months.push([y,m]);}
    const labels=months.map(([y,m])=>m+'月');
    const palette=['#2a6fdb','#c0392b','#1f8a5b','#b9770e','#7d3cb5','#0e8a8a','#d6336c','#5a6b7b'];
    const ranked=Object.values(groups).map(g=>({g,hc:monthStat(g.emps,toY,toM).start})).sort((a,b)=>b.hc-a.hc);
    const top=ranked.slice(0,8).map(x=>x.g);
    const datasets=top.map((g,i)=>{const col=palette[i%palette.length];const lbl=g.sec==='—'?g.dept:g.sec;return {label:lbl,data:months.map(([y,m])=>{const st=monthStat(g.emps,y,m);return st.rate==null?null:+st.rate.toFixed(1);}),borderColor:col,backgroundColor:col,tension:.3,spanGaps:true,pointRadius:3,borderWidth:2};});
    // 全厂总览线
    const allE=Object.values(groups).reduce((a,g)=>a.concat(g.emps),[]);
    datasets.unshift({label:'全厂',data:months.map(([y,m])=>{const st=monthStat(allE,y,m);return st.rate==null?null:+st.rate.toFixed(1);}),borderColor:'#212529',backgroundColor:'#212529',borderWidth:2.5,borderDash:[5,3],pointRadius:0,tension:.3,spanGaps:true});
    const ctx=$('to-chart-trend').getContext('2d');
    if(_trendChart)_trendChart.destroy();
    _trendChart=new Chart(ctx,{type:'line',data:{labels,datasets},
      options:{animation:false,responsive:true,maintainAspectRatio:false,plugins:{legend:{position:'bottom',labels:{boxWidth:10,font:{size:10}}}},scales:{y:{beginAtZero:true,ticks:{callback:v=>v+'%'}}}}});
  }

  // 离职名单（全部离职墨方员工）
  function renderResignList(){
    const q=($('to-resign-search')?$('to-resign-search').value:'').trim().toLowerCase();
    let list=mxAll().filter(resignedOf);
    if(q)list=list.filter(e=>(e.name||'').toLowerCase().includes(q)||(e.id||'').toLowerCase().includes(q));
    list.sort((a,b)=>{const ra=pYMD(a.resignDate),rb=pYMD(b.resignDate);return (rb?rb.getTime():0)-(ra?ra.getTime():0);});
    $('to-resign-count').textContent=`（共 ${list.length} 人）`;
    $('to-resign-table').innerHTML=list.map(e=>{
      const t=tenureMonths(e);const tn=t==null?'-':(t>=12?(t/12).toFixed(1)+'年':Math.max(0,Math.round(t))+'个月');
      const cat=window.resignCategory?window.resignCategory(e.resignType):'';
      const typeCell=e.resignType?`<span class="badge" style="font-size:10px;background:${cat==='被动离职'?'#fdecea':'#fff4e0'};color:${cat==='被动离职'?'#c0392b':'#b9770e'}" title="${esc(cat)}">${esc(e.resignType)}</span>`:'<span style="color:var(--color-text-tertiary);font-size:11px">未分类</span>';
      return `<tr><td style="font-family:monospace;font-size:12px">${esc(e.id)}</td><td><strong>${esc(e.name)}</strong></td><td>${esc(e.dept||'-')}</td><td>${esc(e.section||'-')}</td><td>${esc(e.position||'-')}</td><td style="color:var(--color-text-secondary)">${esc(e.joinDate||'-')}</td><td style="color:#c0392b">${esc(e.resignDate||'-')}</td><td>${typeCell}</td><td>${tn}</td></tr>`;
    }).join('')||`<tr><td colspan="9" style="text-align:center;color:var(--color-text-tertiary);padding:18px">暂无离职人员</td></tr>`;
  }

  function toChMonth(d){let y=toY,m=toM+d;while(m<1){m+=12;y--;}while(m>12){m-=12;y++;}toY=y;toM=m;renderTurnover();}

  function exportTurnover(){
    if(typeof XLSX==='undefined'){if(window.toast)toast('导出组件未就绪');return;}
    const emps=curEmps();
    const head=['部门','科室','月初人数','入职','离职','月末人数','月均人数','当月离职率'];
    const aoa=[head];
    buildDeptRows(emps).forEach(row=>{const r=row.st;aoa.push([row.isDept?row.dept:'',row.isDept?(row.single?row.dept+'（部门）':row.dept+'·部门汇总'):'  └ '+row.sec,r.start,r.hires,r.resigns,r.end,r.avg?+r.avg.toFixed(1):0,r.rate==null?'—':+r.rate.toFixed(1)+'%']);});
    const agg=monthStat(emps,toY,toM);
    aoa.push(['合计','',agg.start,agg.hires,agg.resigns,agg.end,agg.avg?+agg.avg.toFixed(1):0,agg.rate==null?'—':+agg.rate.toFixed(1)+'%']);
    const wb=XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet(aoa),`${toY}-${pad2(toM)}离职率`);
    // 离职名单 sheet
    const rl=[['工号','姓名','部门','科室','岗位','入职日期','离职日期','离职性质','离职类型','工龄(月)']];
    mxAll().filter(resignedOf).forEach(e=>{const t=tenureMonths(e);const cat=window.resignCategory?window.resignCategory(e.resignType):'';rl.push([e.id,e.name,e.dept||'',e.section||'',e.position||'',e.joinDate||'',e.resignDate||'',cat,e.resignType||'未分类',t==null?'':Math.round(t)]);});
    XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet(rl),'离职名单');
    // 离职类型分布 sheet（本月）
    const tc=typeCounts(emps);
    const dist=[['离职类型分布（'+toY+'-'+pad2(toM)+'）'],[],['离职性质','离职类型','人数']];
    Object.keys(tc.RT).forEach(c=>{tc.RT[c].forEach(t=>dist.push([c,t,tc.cnt[t]||0]));});
    if(tc.unknown)dist.push(['—','未分类',tc.unknown]);
    dist.push([]);
    dist.push(['汇总','主动离职',tc.act]);
    dist.push(['汇总','被动离职',tc.pas]);
    dist.push(['汇总','合计',tc.total]);
    XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet(dist),'离职类型分布');
    XLSX.writeFile(wb,`离职率分析_${toY}-${pad2(toM)}.xlsx`);
    if(window.toast)toast('导出成功');
  }

  function exportTurnoverPDF(){
    if(typeof window.buildPDFReport!=='function'){if(window.toast)toast('PDF 组件未就绪');return;}
    const emps=curEmps();
    const agg=monthStat(emps,toY,toM);
    const dF=$('to-dept-f')?$('to-dept-f').value:'';
    let html='<table><thead><tr><th>部门</th><th>科室</th><th>月初人数</th><th>入职</th><th>离职</th><th>月末人数</th><th>月均人数</th><th>当月离职率</th></tr></thead><tbody>';
    buildDeptRows(emps).forEach(row=>{
      const r=row.st;
      const dept=row.isDept?row.dept:'';
      const sec=row.isDept?(row.single?'':'部门汇总'):('└ '+row.sec);
      const style=row.isDept?'font-weight:700;background:#eef2ff;':'';
      html+=`<tr style="${style}"><td>${esc(dept)}</td><td style="text-align:left">${esc(sec)}</td><td>${r.start}</td><td>${r.hires||'-'}</td><td>${r.resigns||'-'}</td><td>${r.end}</td><td>${r.avg?r.avg.toFixed(1):'-'}</td><td>${rateTxt(r.rate)}</td></tr>`;
    });
    html+=`<tr style="font-weight:700;background:#f8fafc"><td>合计</td><td style="text-align:left"></td><td>${agg.start}</td><td>${agg.hires||'-'}</td><td>${agg.resigns||'-'}</td><td>${agg.end}</td><td>${agg.avg?agg.avg.toFixed(1):'-'}</td><td>${rateTxt(agg.rate)}</td></tr></tbody></table>`;
    // 离职类型分布
    const tc=typeCounts(emps);
    let typeHtml='<table><thead><tr><th>离职性质</th><th>离职类型</th><th>人数</th></tr></thead><tbody>';
    Object.keys(tc.RT).forEach(c=>{tc.RT[c].forEach((t,i)=>{typeHtml+=`<tr><td>${i===0?esc(c):''}</td><td style="text-align:left">${esc(t)}</td><td>${tc.cnt[t]||0}</td></tr>`;});});
    if(tc.unknown)typeHtml+=`<tr><td>—</td><td style="text-align:left">未分类</td><td>${tc.unknown}</td></tr>`;
    typeHtml+=`<tr style="font-weight:700;background:#f8fafc"><td>合计</td><td style="text-align:left">主动 ${tc.act} · 被动 ${tc.pas}</td><td>${tc.total}</td></tr></tbody></table>`;
    const ci=window.chartToImg;
    window.buildPDFReport({
      title:'离职率分析报表',
      meta:`统计月份：${mLbl(toY,toM)}　·　范围：仅墨西哥工厂员工${dF?'　·　部门：'+dF:''}　·　以科室为单位（无科室按部门）　·　生成时间：${new Date().toLocaleString('zh-CN')}`,
      sections:[
        {kind:'kpi',cards:[
          {label:'月初人数',value:agg.start},
          {label:'入职人数',value:agg.hires,color:'#1f8a5b'},
          {label:'离职人数',value:agg.resigns,color:'#c0392b'},
          {label:'月末人数',value:agg.end},
          {label:'当月离职率',value:rateTxt(agg.rate),color:'#b9770e'},
        ]},
        {kind:'table',title:'各科室离职率（本月）',html:html},
        {kind:'kpi',cards:[
          {label:'本月离职',value:tc.total},
          {label:'主动离职',value:tc.act,color:'#b9770e'},
          {label:'被动离职',value:tc.pas,color:'#2a6fdb'},
          {label:'未分类',value:tc.unknown,color:'#868e96'},
        ]},
        {kind:'table',title:'离职类型分布（本月）',html:typeHtml},
        {kind:'charts',cols:2,images:[ci&&ci(_catChart,'主动 / 被动 占比'),ci&&ci(_typeChart,'各离职类型人数')]},
        {kind:'charts',title:'其他图表',cols:2,images:[ci&&ci(_tenureChart,'离职人员工龄分布（本月）'),ci&&ci(_trendChart,'科室近 6 个月离职率趋势')]},
      ]
    });
    if(window.toast)toast('正在生成 PDF…请在打印窗口中选择「另存为 PDF」');
  }

  // 暴露给主程序
  window.renderTurnoverPage=renderTurnoverPage;
  window.renderTurnover=renderTurnover;
  window.renderResignList=renderResignList;
  window.toChMonth=toChMonth;
  window.exportTurnover=exportTurnover;
  window.exportTurnoverPDF=exportTurnoverPDF;
})();
