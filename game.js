const $=id=>document.getElementById(id);
const cv=$('cv'),g=cv.getContext('2d');
const COL=['#2fe04f','#ff3b3b','#ffd21f','#2f8dff'];
const KEYS={f:['F1','F2','F3','F4'],d:['KeyD','KeyF','KeyJ','KeyK']};
const DIFF=[{gap:.55,th:3,ap:2.3,ml:.7},{gap:.36,th:2.4,ap:1.9,ml:.55},{gap:.24,th:1.9,ap:1.6,ml:.45}];
const WIN=.12,PERF=.05;
let ctx,master,src,t0,chart=[],notes=[],fileBuf=null,playing=false,appr=1.9,lineOff=0,endAt=0,lastBuzz=0;
let down=[0,0,0,0],heldList=[],lastNow=0,score,combo,maxC,hits,miss,rock,flash=[0,0,0,0],fx=[],msg='',msgT=0;

function resize(){cv.width=innerWidth;cv.height=innerHeight}
addEventListener('resize',resize);resize();
$('off').oninput=e=>$('offV').textContent=e.target.value;

/* ---- filtro de densidad: respeta una separación mínima y conserva las notas más fuertes ---- */
function thin(list,gap){
  const o=[];
  for(const n of list.sort((a,b)=>a.t-b.t)){
    const L=o[o.length-1];
    if(L&&n.t-L.t<gap){if(n.s>L.s)o[o.length-1]=n}else o.push(n);
  }
  return o;
}

/* ---- las sostenidas no pueden pisar la siguiente nota del mismo carril ---- */
function fitHolds(L,ml){
  const by=[[],[],[],[]];L.forEach(n=>by[n.l].push(n));
  for(const a of by){a.sort((x,y)=>x.t-y.t);for(let i=0;i<a.length;i++){const n=a[i];if(n.d&&a[i+1]){const mx=a[i+1].t-n.t-.15;n.d=mx>=ml?Math.min(n.d,mx):0}}}
  return L;
}

/* ---- canción demo sintetizada ---- */
async function makeDemo(){
  const sr=44100,beat=.5,steps=128,lead=.5,len=lead+steps*beat/2+1;
  const oc=new OfflineAudioContext(1,sr*len,sr),out=[];
  const nb=oc.createBuffer(1,sr,sr),nd=nb.getChannelData(0);
  for(let i=0;i<sr;i++)nd[i]=Math.random()*2-1;
  const env=(p,t,d,v)=>{p.setValueAtTime(v,t);p.exponentialRampToValueAtTime(.001,t+d)};
  const tone=(ty,f1,f2,t,d,v)=>{const o=oc.createOscillator(),n=oc.createGain();o.type=ty;o.frequency.setValueAtTime(f1,t);o.frequency.exponentialRampToValueAtTime(f2,t+d);env(n.gain,t,d,v);o.connect(n).connect(oc.destination);o.start(t);o.stop(t+d)};
  const noise=(t,d,v,hp)=>{const s=oc.createBufferSource(),f=oc.createBiquadFilter(),n=oc.createGain();s.buffer=nb;f.type='highpass';f.frequency.value=hp;env(n.gain,t,d,v);s.connect(f).connect(n).connect(oc.destination);s.start(t);s.stop(t+d)};
  const sc=[0,3,5,7,10,12,7,5];let padUntil=0;
  for(let s=0;s<steps;s++){
    const t=lead+s*beat/2,i=s%8,bar=s>>3;
    const ld=bar>=2&&(i==3||i==7||(i==5&&bar%2));
    if(i==0||i==4){tone('sine',150,40,t,.25,1);out.push({t,l:0,s:3})}
    if(i==2||i==6){noise(t,.15,.5,1500);out.push({t,l:1,s:2})}
    noise(t,.05,.2,7000);
    const hd=ld&&i==3&&bar%2==0,pad=bar>=4&&bar%4==0&&i==1;
    if(ld){const f=440*2**(sc[(s>>1)%8]/12),d=hd?.75:0;tone('triangle',f,f,t,d?d+.2:.3,.4);out.push({t,l:3,s:hd?4:2,d})}
    else if(pad){tone('triangle',220,220,t,1.1,.35);out.push({t,l:2,s:4,d:.9});padUntil=t+1.02}
    else if(i%2==1&&t>padUntil)out.push({t,l:2,s:1,d:0});
  }
  lineOff=lead;
  return{buf:await oc.startRendering(),chart:out};
}

/* ---- pantallas ---- */
const showOnly=id=>['menu','load','cal','results'].forEach(k=>$(k).classList.toggle('hide',k!==id));
const setLoad=(t,p)=>{$('loadT').textContent=t;$('loadBar').style.width=Math.round(p*100)+'%';$('loadP').textContent=Math.round(p*100)+'%'};

/* ---- análisis del tema: 4 bandas de frecuencia = 4 carriles (con progreso) ---- */
async function bands(b,prog){
  const c0=b.getChannelData(0),c1=b.numberOfChannels>1?b.getChannelData(1):null;
  const sr=b.sampleRate,H=512,A=[.02,.1,.35],nF=Math.floor(b.length/H);
  const mag=[0,1,2,3].map(()=>new Float32Array(nF)),s=[0,0,0];
  for(let k=0;k<nF;k++){
    const e=[0,0,0,0];
    for(let i=k*H;i<(k+1)*H;i++){
      const x=c1?(c0[i]+c1[i])/2:c0[i];
      s[0]+=A[0]*(x-s[0]);s[1]+=A[1]*(x-s[1]);s[2]+=A[2]*(x-s[2]);
      const v=[s[0],s[1]-s[0],s[2]-s[1],x-s[2]];
      for(let j=0;j<4;j++)e[j]+=v[j]*v[j];
    }
    for(let j=0;j<4;j++)mag[j][k]=Math.sqrt(e[j]);
    if(k%300==0){prog(k/nF);await new Promise(r=>setTimeout(r))}
  }
  return{mag,nF,sr,H};
}
function pick(B,P){
  const{mag,nF,sr,H}=B,cand=[];
  for(let j=0;j<4;j++){
    const m=mag[j],f=new Float32Array(nF),ps=new Float64Array(nF+1);
    for(let k=1;k<nF;k++)f[k]=Math.max(0,m[k]-m[k-1]);
    for(let k=0;k<nF;k++)ps[k+1]=ps[k]+f[k];
    const gm=ps[nF]/nF;
    for(let k=2;k<nF-2;k++){
      const a=Math.max(0,k-43),c=Math.min(nF,k+43),mean=(ps[c]-ps[a])/(c-a);
      if(f[k]>mean*P.th&&f[k]>gm*1.3&&f[k]>=f[k-1]&&f[k]>f[k+1]){
        const pk=Math.max(m[k],m[k+1],m[k+2]),thr=pk*.6;let low=0,j2=k+3;
        for(;j2<nF&&j2-k<220;j2++){if(m[j2]>thr)low=0;else if(++low>6)break}
        let d=(j2-low-k)*H/sr;if(d<P.ml)d=0;
        cand.push({t:k*H/sr,l:j,s:f[k]/(mean+1e-9)*(d?1.5:1),d});
      }
    }
  }
  lineOff=0;
  return fitHolds(thin(cand,P.gap),P.ml);
}

let fileBands=null;
$('file').onchange=async e=>{
  const f=e.target.files[0];if(!f)return;
  fileBuf=fileBands=null;
  showOnly('load');setLoad('Leyendo archivo…',.03);
  try{
    ctx=ctx||new AudioContext();
    fileBuf=await ctx.decodeAudioData(await f.arrayBuffer());
    fileBands=await bands(fileBuf,p=>setLoad('Analizando el tema…',.08+.92*p));
    setLoad('Listo',1);
    const m=Math.floor(fileBuf.duration/60),sec=String(Math.round(fileBuf.duration%60)).padStart(2,'0');
    $('status').textContent=`Listo: ${f.name} (${m}:${sec}). El archivo no sale de tu dispositivo.`;
  }catch{fileBuf=fileBands=null;$('status').textContent='No se pudo leer ese archivo. Probá con otro.'}
  showOnly('menu');
};

/* ---- audio: fallo = baja de volumen + zumbido ---- */
function buzz(){
  const t=ctx.currentTime;if(t-lastBuzz<.08)return;lastBuzz=t;
  const o=ctx.createOscillator(),n=ctx.createGain();
  o.type='sawtooth';o.frequency.setValueAtTime(130,t);o.frequency.exponentialRampToValueAtTime(60,t+.14);
  n.gain.setValueAtTime(.18,t);n.gain.exponentialRampToValueAtTime(.001,t+.16);
  o.connect(n).connect(ctx.destination);o.start(t);o.stop(t+.17);
}
function bad(){
  combo=0;rock=Math.max(0,rock-.05);say('Fallo');
  const t=ctx.currentTime,p=master.gain;
  p.cancelScheduledValues(t);p.setTargetAtTime(.25,t,.015);p.setTargetAtTime(1,t+.5,.12);
  buzz();
}
function good(){const t=ctx.currentTime;master.gain.cancelScheduledValues(t);master.gain.setTargetAtTime(1,t,.04)}

/* ---- juego ---- */
const songT=()=>ctx.currentTime-t0;
const judgeT=()=>songT()-$('off').value/1000;
const mult=()=>Math.min(4,1+(combo/10|0));
const say=m=>{msg=m;msgT=performance.now()};

async function start(){
  ctx=ctx||new AudioContext();await ctx.resume();
  if(!master){master=ctx.createGain();master.connect(ctx.destination)}
  master.gain.cancelScheduledValues(0);master.gain.value=1;
  const P=DIFF[+$('diff').value];appr=P.ap;let buf;
  if(fileBuf){buf=fileBuf;chart=pick(fileBands,P)}
  else{showOnly('load');setLoad('Preparando canción demo…',.4);const d=await makeDemo();setLoad('Listo',1);buf=d.buf;chart=thin(d.chart,P.gap)}
  if(!chart.length){$('status').textContent='No se detectaron notas. Probá con dificultad Difícil.';showOnly('menu');return}
  notes=chart.map(n=>({...n,done:0}));
  score=combo=maxC=hits=miss=0;rock=.5;fx=[];msg='';heldList=[];down.fill(0);lastNow=0;
  src=ctx.createBufferSource();src.buffer=buf;src.connect(master);
  t0=ctx.currentTime+2;src.start(t0);endAt=buf.duration+1;
  showOnly(null);playing=true;requestAnimationFrame(loop);
}
function finish(natural){
  playing=false;try{src.stop()}catch{}
  master.gain.cancelScheduledValues(0);master.gain.value=1;
  if(natural){
    $('rS').textContent=Math.floor(score);$('rA').textContent=hits+' / '+notes.length;
    $('rF').textContent=miss;$('rC').textContent=maxC;showOnly('results');
  }else showOnly('menu');
}
$('play').onclick=start;$('again').onclick=start;$('toMenu').onclick=()=>showOnly('menu');

function press(l){
  if(!playing)return;
  flash[l]=performance.now();
  const now=judgeT();let f=null;
  for(const n of notes){
    if(n.t-now>WIN)break;
    if(!n.done&&!n.held&&n.l==l&&Math.abs(n.t-now)<=WIN){f=n;break}
  }
  if(!f){bad();return}
  if(f.d){f.held=1;heldList.push(f)}else f.done=1;
  hits++;combo++;maxC=Math.max(maxC,combo);rock=Math.min(1,rock+.02);
  const p=Math.abs(f.t-now)<PERF;score+=(p?100:50)*mult();say(p?'¡Perfecto!':'Bien');
  fx.push({l,t:performance.now()});good();
}
addEventListener('keydown',e=>{
  if(cal){e.preventDefault();if(e.code==='Escape')calCancel();else if(!e.repeat)calTap();return}
  if(e.code==='Escape'&&playing){finish(false);return}
  const l=KEYS[$('keys').value].indexOf(e.code);
  if(l>=0){e.preventDefault();if(!e.repeat){down[l]=1;press(l)}}
});
addEventListener('keyup',e=>{const l=KEYS[$('keys').value].indexOf(e.code);if(l>=0)down[l]=0});
addEventListener('blur',()=>down.fill(0));
const ptr=new Map();
cv.addEventListener('pointerdown',e=>{e.preventDefault();const l=Math.min(3,Math.floor(e.clientX/cv.width*4));ptr.set(e.pointerId,l);down[l]=1;press(l)});
const pUp=e=>{const l=ptr.get(e.pointerId);if(l==null)return;ptr.delete(e.pointerId);down[l]=[...ptr.values()].includes(l)?1:0};
addEventListener('pointerup',pUp);addEventListener('pointercancel',pUp);

/* ---- dibujo ---- */
const ell=(x,y,rx,ry)=>{g.beginPath();g.ellipse(x,y,rx,ry,0,0,7)};
function loop(){
  if(!playing)return;
  const w=cv.width,h=cv.height,now=songT(),tn=performance.now(),cx=w/2,top=h*.05,hy=h*.8;
  const full=Math.min(w*.72,h*1.15);
  const lw=p=>full*(.42+.58*p)/4,X=(l,p)=>cx+(l-1.5)*lw(p),Y=p=>top+(hy-top)*p;
  const poly=(pts,fill)=>{g.beginPath();pts.forEach((q,i)=>i?g.lineTo(q[0],q[1]):g.moveTo(q[0],q[1]));g.closePath();g.fillStyle=fill;g.fill()};
  // fondo
  let gr=g.createRadialGradient(cx,h*.35,30,cx,h*.35,Math.max(w,h)*.8);
  gr.addColorStop(0,'#3a1230');gr.addColorStop(1,'#08050c');g.fillStyle=gr;g.fillRect(0,0,w,h);
  // rieles metálicos
  gr=g.createLinearGradient(X(-.9,1),0,X(-.5,1),0);gr.addColorStop(0,'#2a1200');gr.addColorStop(.6,'#c8650a');gr.addColorStop(1,'#ffc46b');
  poly([[X(-.8,0),Y(0)],[X(-.5,0),Y(0)],[X(-.5,1.1),Y(1.1)],[X(-.9,1.1),Y(1.1)]],gr);
  gr=g.createLinearGradient(X(3.5,1),0,X(3.9,1),0);gr.addColorStop(0,'#ffc46b');gr.addColorStop(.4,'#c8650a');gr.addColorStop(1,'#2a1200');
  poly([[X(3.5,0),Y(0)],[X(3.8,0),Y(0)],[X(4.0,1.1),Y(1.1)],[X(3.5,1.1),Y(1.1)]],gr);
  // pista
  gr=g.createLinearGradient(0,Y(0),0,Y(1.1));gr.addColorStop(0,'#050408');gr.addColorStop(1,'#25222d');
  poly([[X(-.5,0),Y(0)],[X(3.5,0),Y(0)],[X(3.5,1.1),Y(1.1)],[X(-.5,1.1),Y(1.1)]],gr);
  g.lineWidth=1;g.strokeStyle='rgba(255,255,255,.035)';
  for(let k=-.5;k<=3.5;k+=.125){g.beginPath();g.moveTo(X(k,0),Y(0));g.lineTo(X(k,1.1),Y(1.1));g.stroke()}
  // luz de carril al pulsar
  for(let l=0;l<4;l++){const a=1-(tn-flash[l])/180;if(a>0){g.globalAlpha=a*.3;poly([[X(l-.5,.55),Y(.55)],[X(l+.5,.55),Y(.55)],[X(l+.5,1.1),Y(1.1)],[X(l-.5,1.1),Y(1.1)]],COL[l]);g.globalAlpha=1}}
  // separadores y líneas de compás
  g.lineWidth=2;g.strokeStyle='#4a4358';
  for(let l=-.5;l<=3.5;l++){g.beginPath();g.moveTo(X(l,0),Y(0));g.lineTo(X(l,1.1),Y(1.1));g.stroke()}
  for(let s=Math.ceil(now-lineOff)+lineOff;s<now+appr;s+=1){
    const p=1-(s-now)/appr;if(p<0||p>1.1)continue;
    g.strokeStyle='rgba(200,200,220,'+(.15+.25*p)+')';g.lineWidth=1+2*p;
    g.beginPath();g.moveTo(X(-.5,p),Y(p));g.lineTo(X(3.5,p),Y(p));g.stroke();
  }
  // fallos automáticos
  const jn=judgeT();
  for(const n of notes){if(n.t-jn>0)break;if(!n.done&&!n.held&&jn-n.t>WIN){n.done=2;miss++;bad()}}
  const dt=Math.min(.1,Math.max(0,now-lastNow));lastNow=now;
  for(const n of heldList){
    if(jn>=n.t+n.d-.05){n.held=0;n.done=1;score+=50*mult();say('¡Sostenida!')}
    else if(!down[n.l]&&jn<n.t+n.d-.2){n.held=0;n.done=3;rock=Math.max(0,rock-.02)}
    else{score+=120*mult()*dt;flash[n.l]=tn}
  }
  heldList=heldList.filter(n=>n.held);
  // barra y aros de golpeo
  g.lineWidth=6;g.strokeStyle='#b9b7c4';g.beginPath();g.moveTo(X(-.5,.94),Y(.94));g.lineTo(X(3.5,.94),Y(.94));g.stroke();
  for(let l=0;l<4;l++){
    const r=lw(1)*.44,x=X(l,1),y=Y(1),on=tn-flash[l]<120;
    if(on){g.shadowColor=COL[l];g.shadowBlur=30}
    g.fillStyle='#0e0c14';ell(x,y,r,r*.42);g.fill();
    g.lineWidth=6;g.strokeStyle=COL[l];g.stroke();g.shadowBlur=0;
    g.lineWidth=2;g.strokeStyle='#d6d4de';ell(x,y,r*.8,r*.32);g.stroke();
    g.fillStyle=on?COL[l]:'#1d1a26';ell(x,y,r*.6,r*.24);g.fill();
  }
  // notas (lejanas primero)
  for(let i=notes.length-1;i>=0;i--){
    const n=notes[i],p=1-(n.t-now)/appr,d=n.d||0;
    if(n.done==1)continue;
    if(d){
      const pT=1-(n.t+d-now)/appr;
      if(pT<1.12&&p>0){
        const a=Math.max(pT,0),b=n.held?1:Math.min(p,1.12),dead=n.done>=2;
        if(b>a){
          const q=(pp,k)=>[X(n.l,pp)+k*lw(pp)*.11,Y(pp)];
          g.globalAlpha=dead?.5:1;
          if(n.held){g.shadowColor=COL[n.l];g.shadowBlur=20}
          poly([q(a,-1),q(a,1),q(b,1),q(b,-1)],dead?'#4a4a52':COL[n.l]);
          g.shadowBlur=0;
          poly([q(a,-.35),q(a,.35),q(b,.35),q(b,-.35)],dead?'#666':'rgba(255,255,255,.75)');
          g.globalAlpha=1;
        }
      }
    }
    if(p<0||p>1.12||n.held||n.done==3)continue;
    const x=X(n.l,p),y=Y(p),rx=lw(p)*.42,ry=rx*.42,dead=n.done==2;
    g.fillStyle=dead?'#555':'#d4d6de';ell(x,y+ry*.3,rx*1.06,ry*1.06);g.fill();
    g.fillStyle=dead?'#3a3a3a':COL[n.l];ell(x,y,rx,ry);g.fill();
    if(!dead){
      g.fillStyle='rgba(255,255,255,.4)';ell(x,y-ry*.3,rx*.8,ry*.55);g.fill();
      g.fillStyle='rgba(255,255,255,.95)';ell(x,y-ry*.12,rx*.42,ry*.38);g.fill();
    }
  }
  // destellos de acierto
  fx=fx.filter(f=>tn-f.t<350);
  for(const f of fx){const a=(tn-f.t)/350,r=lw(1)*(.44+.5*a);g.globalAlpha=1-a;g.lineWidth=4;g.strokeStyle='#fff';ell(X(f.l,1),Y(1),r,r*.42);g.stroke();g.globalAlpha=1}
  // HUD pegado a la pista
  const bw=Math.min(170,w*.3),ax=Math.max(8,X(-1.35,.02)-bw),ay=14;
  g.fillStyle='rgba(10,8,16,.8)';g.strokeStyle='#ffd21f';g.lineWidth=2;g.beginPath();g.roundRect(ax,ay,bw,40,8);g.fill();g.stroke();
  g.fillStyle='#fff';g.font='bold 22px sans-serif';g.textAlign='right';g.fillText(Math.floor(score),ax+bw-10,ay+29);
  g.textAlign='left';g.font='13px sans-serif';g.fillStyle='#ffd21f';g.fillText('PTS',ax+10,ay+29);
  const rx0=ax+30,ry0=ay+84;
  g.fillStyle='rgba(10,8,16,.8)';ell(rx0,ry0,28,28);g.fill();
  g.lineWidth=5;g.strokeStyle='#2c2740';ell(rx0,ry0,24,24);g.stroke();
  g.strokeStyle='#37c9ff';g.beginPath();g.arc(rx0,ry0,24,-Math.PI/2,-Math.PI/2+Math.PI*2*(combo>=30?1:(combo%10)/10));g.stroke();
  g.fillStyle='#fff';g.textAlign='center';g.font='bold 18px sans-serif';g.fillText(mult()+'x',rx0,ry0+6);
  g.textAlign='left';g.font='14px sans-serif';g.fillText('Racha '+combo,rx0+36,ry0+5);
  const meter=(a,b,frac,col)=>{for(let i=0;i<16;i++){
    const pLo=1-.7*(i+.85)/16,pHi=1-.7*i/16,f=i/16;
    poly([[X(a,pLo),Y(pLo)],[X(b,pLo),Y(pLo)],[X(b,pHi),Y(pHi)],[X(a,pHi),Y(pHi)]],frac>f?col(f):'#2a2538')}};
  meter(-1.28,-1.03,rock,f=>f<.33?'#ff3b3b':f<.66?'#ffd21f':'#2fe04f');
  meter(4.03,4.28,Math.min(1,combo/40),()=>'#37c9ff');
  if(tn-msgT<600){g.fillStyle='#fff';g.font='bold 30px sans-serif';g.textAlign='center';g.fillText(msg,cx,h*.42)}
  if(now<0){g.fillStyle='#fff';g.font='bold 28px sans-serif';g.textAlign='center';g.fillText('Preparate…',cx,h*.3)}
  g.fillStyle='#ffd21f';g.fillRect(0,0,w*Math.max(0,Math.min(1,now/(endAt-1))),4);
  if(now>endAt){finish(true);return}
  requestAnimationFrame(loop);
}

/* ---- calibración por toques ---- */
let cal=null;
function calStart(){
  ctx=ctx||new AudioContext();
  ctx.resume().then(()=>{
    const IV=.6,N=12,st=ctx.currentTime+1.5;
    for(let i=0;i<N;i++){
      const t=st+i*IV,o=ctx.createOscillator(),n=ctx.createGain();
      o.frequency.value=880;n.gain.setValueAtTime(.3,t);n.gain.exponentialRampToValueAtTime(.001,t+.07);
      o.connect(n).connect(ctx.destination);o.start(t);o.stop(t+.08);
    }
    cal={st,IV,N,taps:[]};
    $('calT').textContent='Tocá la pantalla o cualquier tecla justo con cada pitido.';
    showOnly('cal');requestAnimationFrame(calLoop);
  });
}
function calLoop(){
  if(!cal)return;
  const t=ctx.currentTime-cal.st,ph=t>=0?(t/cal.IV)%1:1;
  $('beat').style.transform='scale('+(1+.35*Math.max(0,1-ph*5))+')';
  $('calN').textContent='Toques: '+cal.taps.length;
  if(t>cal.N*cal.IV+.3){calEnd();return}
  requestAnimationFrame(calLoop);
}
const calTap=()=>{if(cal)cal.taps.push(ctx.currentTime)};
function calCancel(){cal=null;showOnly('menu')}
function calEnd(){
  const e=cal.taps.map(t=>{const k=Math.round((t-cal.st)/cal.IV);return{k,e:t-cal.st-k*cal.IV}})
    .filter(x=>x.k>=3&&x.k<cal.N&&Math.abs(x.e)<cal.IV/2).map(x=>x.e).sort((a,b)=>a-b);
  cal=null;
  if(e.length<4)$('status').textContent='Calibración incompleta: tocá siguiendo cada pitido y probá de nuevo.';
  else{
    const ms=Math.max(-200,Math.min(300,Math.round(e[e.length>>1]*200)*5));
    $('off').value=ms;$('offV').textContent=ms;$('status').textContent='Calibrado: compensación de '+ms+' ms.';
  }
  showOnly('menu');
}
$('calBtn').onclick=calStart;$('calCancel').onclick=calCancel;
document.addEventListener('pointerdown',e=>{if(cal&&!e.target.closest('button'))calTap()});
