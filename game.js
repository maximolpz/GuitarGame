const $=id=>document.getElementById(id);
const cv=$('cv'),g=cv.getContext('2d');
const COL=['#2fe04f','#ff3b3b','#ffd21f','#2f8dff'];
const KEYS={f:['F1','F2','F3','F4'],d:['KeyD','KeyF','KeyJ','KeyK']};
const LBL={f:['F1','F2','F3','F4'],d:['D','F','J','K']};
const DIFF=[{gap:.55,th:3,ap:2.3},{gap:.36,th:2.4,ap:1.9},{gap:.24,th:1.9,ap:1.6}];
const WIN=.12,PERF=.05;
let ctx,master,src,t0,chart=[],notes=[],fileBuf=null,playing=false,appr=1.9,lineOff=0,endAt=0,lastBuzz=0;
let score,combo,maxC,hits,miss,rock,flash=[0,0,0,0],fx=[],msg='',msgT=0;

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

/* ---- canción demo sintetizada ---- */
async function makeDemo(){
  const sr=44100,beat=.5,steps=128,lead=.5,len=lead+steps*beat/2+1;
  const oc=new OfflineAudioContext(1,sr*len,sr),out=[];
  const nb=oc.createBuffer(1,sr,sr),nd=nb.getChannelData(0);
  for(let i=0;i<sr;i++)nd[i]=Math.random()*2-1;
  const env=(p,t,d,v)=>{p.setValueAtTime(v,t);p.exponentialRampToValueAtTime(.001,t+d)};
  const tone=(ty,f1,f2,t,d,v)=>{const o=oc.createOscillator(),n=oc.createGain();o.type=ty;o.frequency.setValueAtTime(f1,t);o.frequency.exponentialRampToValueAtTime(f2,t+d);env(n.gain,t,d,v);o.connect(n).connect(oc.destination);o.start(t);o.stop(t+d)};
  const noise=(t,d,v,hp)=>{const s=oc.createBufferSource(),f=oc.createBiquadFilter(),n=oc.createGain();s.buffer=nb;f.type='highpass';f.frequency.value=hp;env(n.gain,t,d,v);s.connect(f).connect(n).connect(oc.destination);s.start(t);s.stop(t+d)};
  const sc=[0,3,5,7,10,12,7,5];
  for(let s=0;s<steps;s++){
    const t=lead+s*beat/2,i=s%8,bar=s>>3;
    const ld=bar>=2&&(i==3||i==7||(i==5&&bar%2));
    if(i==0||i==4){tone('sine',150,40,t,.25,1);out.push({t,l:0,s:3})}
    if(i==2||i==6){noise(t,.15,.5,1500);out.push({t,l:1,s:2})}
    noise(t,.05,.2,7000);
    if(ld){const f=440*2**(sc[(s>>1)%8]/12);tone('triangle',f,f,t,.3,.4);out.push({t,l:3,s:2})}
    else if(i%2==1)out.push({t,l:2,s:1});
  }
  lineOff=lead;
  return{buf:await oc.startRendering(),chart:out};
}

/* ---- notas desde un archivo: 4 bandas de frecuencia = 4 carriles ---- */
function analyze(b,P){
  const d=b.getChannelData(0),sr=b.sampleRate,H=512,A=[.02,.1,.35],nF=Math.floor(d.length/H);
  const mag=[0,1,2,3].map(()=>new Float32Array(nF)),s=[0,0,0];
  for(let k=0;k<nF;k++){
    const e=[0,0,0,0];
    for(let i=k*H;i<(k+1)*H;i++){
      const x=d[i];s[0]+=A[0]*(x-s[0]);s[1]+=A[1]*(x-s[1]);s[2]+=A[2]*(x-s[2]);
      const v=[s[0],s[1]-s[0],s[2]-s[1],x-s[2]];
      for(let j=0;j<4;j++)e[j]+=v[j]*v[j];
    }
    for(let j=0;j<4;j++)mag[j][k]=Math.sqrt(e[j]);
  }
  const cand=[];
  for(let j=0;j<4;j++){
    const m=mag[j],f=new Float32Array(nF),ps=new Float64Array(nF+1);
    for(let k=1;k<nF;k++)f[k]=Math.max(0,m[k]-m[k-1]);
    for(let k=0;k<nF;k++)ps[k+1]=ps[k]+f[k];
    const gm=ps[nF]/nF;
    for(let k=2;k<nF-2;k++){
      const a=Math.max(0,k-43),c=Math.min(nF,k+43),mean=(ps[c]-ps[a])/(c-a);
      if(f[k]>mean*P.th&&f[k]>gm*1.3&&f[k]>=f[k-1]&&f[k]>f[k+1])cand.push({t:k*H/sr,l:j,s:f[k]/(mean+1e-9)});
    }
  }
  lineOff=0;
  return thin(cand,P.gap);
}

$('file').onchange=async e=>{
  const f=e.target.files[0];if(!f)return;
  $('status').textContent='Decodificando…';
  try{
    ctx=ctx||new AudioContext();
    fileBuf=await ctx.decodeAudioData(await f.arrayBuffer());
    $('status').textContent=`Listo: ${f.name} (${Math.round(fileBuf.duration)} s). El archivo no sale de tu dispositivo.`;
  }catch{fileBuf=null;$('status').textContent='No se pudo leer ese archivo. Probá con otro.'}
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
  const P=DIFF[+$('diff').value];appr=P.ap;
  let buf;
  if(fileBuf){buf=fileBuf;chart=analyze(buf,P)}
  else{const d=await makeDemo();buf=d.buf;chart=thin(d.chart,P.gap)}
  if(!chart.length){$('status').textContent='No se detectaron notas. Probá con dificultad Difícil.';return}
  notes=chart.map(n=>({...n,done:0}));
  score=combo=maxC=hits=miss=0;rock=.5;fx=[];msg='';
  src=ctx.createBufferSource();src.buffer=buf;src.connect(master);
  t0=ctx.currentTime+2;src.start(t0);endAt=buf.duration+.5;
  $('menu').classList.add('hide');playing=true;requestAnimationFrame(loop);
}
function stop(){
  playing=false;try{src.stop()}catch{}
  $('status').textContent=`Puntaje ${score} · Aciertos ${hits}/${notes.length} · Fallos ${miss} · Mejor combo ${maxC}`;
  $('menu').classList.remove('hide');
}
$('play').onclick=start;

function press(l){
  if(!playing)return;
  flash[l]=performance.now();
  const now=judgeT();let f=null;
  for(const n of notes){
    if(n.t-now>WIN)break;
    if(!n.done&&n.l==l&&Math.abs(n.t-now)<=WIN){f=n;break}
  }
  if(!f){bad();return}
  f.done=1;hits++;combo++;maxC=Math.max(maxC,combo);rock=Math.min(1,rock+.02);
  const p=Math.abs(f.t-now)<PERF;score+=(p?100:50)*mult();say(p?'¡Perfecto!':'Bien');
  fx.push({l,t:performance.now()});good();
}
addEventListener('keydown',e=>{
  if(e.code==='Escape'&&playing){stop();return}
  const l=KEYS[$('keys').value].indexOf(e.code);
  if(l>=0){e.preventDefault();if(!e.repeat)press(l)}
});
cv.addEventListener('pointerdown',e=>{e.preventDefault();press(Math.min(3,Math.floor(e.clientX/cv.width*4)))});

/* ---- dibujo ---- */
const ell=(x,y,rx,ry)=>{g.beginPath();g.ellipse(x,y,rx,ry,0,0,7)};
function loop(){
  if(!playing)return;
  const w=cv.width,h=cv.height,now=songT(),tn=performance.now(),cx=w/2,top=h*.05,hy=h*.8;
  const full=Math.min(w*.86,h*1.1);
  const lw=p=>full*(.28+.72*p)/4,X=(l,p)=>cx+(l-1.5)*lw(p),Y=p=>top+(hy-top)*p;
  const poly=(pts,fill)=>{g.beginPath();pts.forEach((q,i)=>i?g.lineTo(q[0],q[1]):g.moveTo(q[0],q[1]));g.closePath();g.fillStyle=fill;g.fill()};
  // fondo
  let gr=g.createRadialGradient(cx,h*.35,30,cx,h*.35,Math.max(w,h)*.8);
  gr.addColorStop(0,'#3a1230');gr.addColorStop(1,'#08050c');g.fillStyle=gr;g.fillRect(0,0,w,h);
  // rieles metálicos
  gr=g.createLinearGradient(X(-.9,1),0,X(-.5,1),0);gr.addColorStop(0,'#2a2833');gr.addColorStop(.6,'#8d8a99');gr.addColorStop(1,'#cfcdd8');
  poly([[X(-.8,0),Y(0)],[X(-.5,0),Y(0)],[X(-.5,1.1),Y(1.1)],[X(-.9,1.1),Y(1.1)]],gr);
  gr=g.createLinearGradient(X(3.5,1),0,X(3.9,1),0);gr.addColorStop(0,'#cfcdd8');gr.addColorStop(.4,'#8d8a99');gr.addColorStop(1,'#2a2833');
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
  for(const n of notes){if(n.t-jn>0)break;if(!n.done&&jn-n.t>WIN){n.done=2;miss++;bad()}}
  // barra y aros de golpeo
  g.lineWidth=6;g.strokeStyle='#b9b7c4';g.beginPath();g.moveTo(X(-.5,.94),Y(.94));g.lineTo(X(3.5,.94),Y(.94));g.stroke();
  const lb=LBL[$('keys').value];
  for(let l=0;l<4;l++){
    const r=lw(1)*.44,x=X(l,1),y=Y(1),on=tn-flash[l]<120;
    if(on){g.shadowColor=COL[l];g.shadowBlur=30}
    g.fillStyle='#0e0c14';ell(x,y,r,r*.42);g.fill();
    g.lineWidth=6;g.strokeStyle=COL[l];g.stroke();g.shadowBlur=0;
    g.lineWidth=2;g.strokeStyle='#d6d4de';ell(x,y,r*.8,r*.32);g.stroke();
    g.fillStyle=on?COL[l]:'#1d1a26';ell(x,y,r*.6,r*.24);g.fill();
    g.fillStyle=on?'#000':COL[l];g.textAlign='center';g.font='bold '+Math.max(13,r*.42)+'px sans-serif';g.fillText(lb[l],x,y+r*.16);
  }
  // notas (lejanas primero)
  for(let i=notes.length-1;i>=0;i--){
    const n=notes[i],p=1-(n.t-now)/appr;
    if(p<0||n.done==1||p>1.12)continue;
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
  // HUD: puntaje, multiplicador, medidor
  g.fillStyle='rgba(10,8,16,.8)';g.strokeStyle='#ffd21f';g.lineWidth=2;g.beginPath();g.roundRect(14,14,170,40,8);g.fill();g.stroke();
  g.fillStyle='#fff';g.font='bold 22px sans-serif';g.textAlign='right';g.fillText(score,174,43);
  g.textAlign='left';g.font='13px sans-serif';g.fillStyle='#ffd21f';g.fillText('PTS',22,43);
  g.fillStyle='rgba(10,8,16,.8)';ell(52,98,28,28);g.fill();
  g.lineWidth=5;g.strokeStyle='#2c2740';ell(52,98,24,24);g.stroke();
  g.strokeStyle='#37c9ff';g.beginPath();g.arc(52,98,24,-Math.PI/2,-Math.PI/2+Math.PI*2*(combo>=30?1:(combo%10)/10));g.stroke();
  g.fillStyle='#fff';g.textAlign='center';g.font='bold 18px sans-serif';g.fillText(mult()+'x',52,104);
  g.font='14px sans-serif';g.fillText('Racha '+combo,52,142);
  const mh=Math.min(h*.4,260),my=h*.82-mh,seg=16;
  for(let i=0;i<seg;i++){
    const f=i/seg,on=rock>f;g.fillStyle=on?(f<.33?'#ff3b3b':f<.66?'#ffd21f':'#2fe04f'):'#2a2538';
    g.fillRect(16,my+mh-(i+1)*mh/seg+2,18,mh/seg-3);
  }
  if(tn-msgT<600){g.fillStyle='#fff';g.font='bold 30px sans-serif';g.textAlign='center';g.fillText(msg,cx,h*.42)}
  if(now<0){g.fillStyle='#fff';g.font='bold 28px sans-serif';g.textAlign='center';g.fillText('Preparate…',cx,h*.3)}
  if(now>endAt){stop();return}
  requestAnimationFrame(loop);
}
