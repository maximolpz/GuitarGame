const $=id=>document.getElementById(id);
const cv=$('cv'),g=cv.getContext('2d');
const COL=['#3ddc57','#ff4d4d','#ffd83d','#3da5ff'];
const KEYS={f:['F1','F2','F3','F4'],d:['KeyD','KeyF','KeyJ','KeyK']};
const LBL={f:['F1','F2','F3','F4'],d:['D','F','J','K']};
const APPROACH=1.5,WIN=.12,PERF=.05;
let ctx,src,t0,chart=[],notes=[],fileBuf=null,playing=false;
let score,combo,maxC,hits,miss,flash=[0,0,0,0],msg='',msgT=0;

function resize(){cv.width=innerWidth;cv.height=innerHeight}
addEventListener('resize',resize);resize();
$('sens').oninput=e=>$('sensV').textContent=e.target.value;
$('off').oninput=e=>$('offV').textContent=e.target.value;

/* ---------- Canción demo sintetizada (sin copyright) ---------- */
async function makeDemo(){
  const sr=44100,beat=.5,steps=16*8,lead=.5,len=lead+steps*beat/2+1;
  const oc=new OfflineAudioContext(1,sr*len,sr),out=[];
  const nb=oc.createBuffer(1,sr,sr),nd=nb.getChannelData(0);
  for(let i=0;i<sr;i++)nd[i]=Math.random()*2-1;
  const env=(p,t,d,v)=>{p.setValueAtTime(v,t);p.exponentialRampToValueAtTime(.001,t+d)};
  const tone=(type,f1,f2,t,d,v)=>{const o=oc.createOscillator(),n=oc.createGain();o.type=type;o.frequency.setValueAtTime(f1,t);o.frequency.exponentialRampToValueAtTime(f2,t+d);env(n.gain,t,d,v);o.connect(n).connect(oc.destination);o.start(t);o.stop(t+d)};
  const noise=(t,d,v,hp)=>{const s=oc.createBufferSource(),f=oc.createBiquadFilter(),n=oc.createGain();s.buffer=nb;f.type='highpass';f.frequency.value=hp;env(n.gain,t,d,v);s.connect(f).connect(n).connect(oc.destination);s.start(t);s.stop(t+d)};
  const scale=[0,3,5,7,10,12,7,5];
  for(let s=0;s<steps;s++){
    const t=lead+s*beat/2,i=s%8,bar=(s/8)|0;
    if(i==0||i==4){tone('sine',150,40,t,.25,1);out.push({t,l:0})}
    if(i==2||i==6){noise(t,.15,.5,1500);out.push({t,l:1})}
    noise(t,.05,.2,7000);
    if(i%2==1){out.push({t,l:2})}
    if(bar>=2&&(i==3||i==7||i==5&&bar%2)){tone('triangle',440*2**(scale[(s>>1)%8]/12),440*2**(scale[(s>>1)%8]/12),t,.3,.4);out.push({t,l:3})}
  }
  return{buf:await oc.startRendering(),chart:out};
}

/* ---------- Generación automática de notas desde un MP3 ---------- */
function analyze(b,sens){
  const d=b.getChannelData(0),sr=b.sampleRate,H=512,N=1024,E=[];
  let lp=0;
  for(let s=0;s+N<d.length;s+=H){
    let lo=0,hi=0;
    for(let i=s;i<s+N;i++){lp+=.1*(d[i]-lp);const h=d[i]-lp;lo+=lp*lp;hi+=h*h}
    E.push([lo,hi]);
  }
  const mag=E.map(e=>Math.sqrt(e[0]+e[1])),fx=mag.map((m,k)=>k?Math.max(0,m-mag[k-1]):0);
  const mult=2.4-sens*.19,W=20,on=[];
  let last=-1;
  for(let k=1;k<fx.length-1;k++){
    let sum=0,c=0;for(let j=Math.max(0,k-W);j<Math.min(fx.length,k+W);j++){sum+=fx[j];c++}
    const t=(k*H+N/2)/sr;
    if(fx[k]>sum/c*mult&&fx[k]>=fx[k-1]&&fx[k]>=fx[k+1]&&t-last>.14){
      on.push({t,r:E[k][1]/(E[k][0]+E[k][1]+1e-9)});last=t;
    }
  }
  const sorted=on.map(o=>o.r).sort((a,b)=>a-b);
  return on.map(o=>({t:o.t,l:Math.min(3,Math.floor(sorted.indexOf(o.r)/sorted.length*4))}));
}

$('file').onchange=async e=>{
  const f=e.target.files[0];if(!f)return;
  $('status').textContent='Decodificando…';
  try{
    ctx=ctx||new AudioContext();
    fileBuf=await ctx.decodeAudioData(await f.arrayBuffer());
    $('status').textContent=`Listo: ${f.name} (${Math.round(fileBuf.duration)} s). El archivo no sale de tu dispositivo.`;
  }catch{fileBuf=null;$('status').textContent='No se pudo leer ese archivo. Probá con otro MP3.'}
};

/* ---------- Juego ---------- */
const songT=()=>ctx.currentTime-t0;
const judgeT=()=>songT()-$('off').value/1000;
const mult=()=>Math.min(4,1+(combo/10|0));

async function start(){
  ctx=ctx||new AudioContext();await ctx.resume();
  let buf;
  if(fileBuf){buf=fileBuf;chart=analyze(buf,+$('sens').value)}
  else{const d=await makeDemo();buf=d.buf;chart=d.chart}
  if(!chart.length){$('status').textContent='No se detectaron notas. Subí la densidad.';return}
  notes=chart.map(n=>({...n,done:0}));
  score=combo=maxC=hits=miss=0;msg='';
  src=ctx.createBufferSource();src.buffer=buf;src.connect(ctx.destination);
  t0=ctx.currentTime+2;src.start(t0);
  $('menu').classList.add('hide');playing=true;
  endAt=buf.duration;requestAnimationFrame(loop);
}
let endAt=0;
function stop(){
  playing=false;try{src.stop()}catch{}
  $('status').textContent=`Puntaje ${score} · Aciertos ${hits} · Fallos ${miss} · Mejor combo ${maxC}`;
  $('menu').classList.remove('hide');
}
$('play').onclick=start;

function press(l){
  if(!playing)return;
  flash[l]=performance.now();
  const now=judgeT();let best=null;
  for(const n of notes){
    if(n.t-now>WIN)break;
    if(!n.done&&n.l==l&&Math.abs(n.t-now)<=WIN){best=n;break}
  }
  if(!best)return;
  best.done=1;hits++;combo++;maxC=Math.max(maxC,combo);
  const p=Math.abs(best.t-now)<PERF;
  score+=(p?100:50)*mult();say(p?'¡Perfecto!':'Bien');
}
function say(m){msg=m;msgT=performance.now()}

addEventListener('keydown',e=>{
  if(e.code==='Escape'&&playing){stop();return}
  const l=KEYS[$('keys').value].indexOf(e.key.length>1?e.code:e.code);
  if(l>=0){e.preventDefault();if(!e.repeat)press(l)}
});
cv.addEventListener('pointerdown',e=>{
  e.preventDefault();
  if(playing)press(Math.min(3,Math.floor(e.clientX/cv.width*4)));
});

/* ---------- Dibujo con perspectiva ---------- */
function loop(){
  if(!playing)return;
  const w=cv.width,h=cv.height,now=songT(),top=h*.06,hy=h*.8,cx=w/2;
  const full=Math.min(w*.92,h*1.1);
  const lw=p=>full*(.28+.72*p)/4, X=(l,p)=>cx+(l-1.5)*lw(p), Y=p=>top+(hy-top)*p;
  g.fillStyle='#14101f';g.fillRect(0,0,w,h);
  // carril
  g.fillStyle='#0c0a14';g.beginPath();
  g.moveTo(X(-.5,0),Y(0));g.lineTo(X(3.5,0),Y(0));g.lineTo(X(3.5,1.1),Y(1.1));g.lineTo(X(-.5,1.1),Y(1.1));g.fill();
  g.lineWidth=2;
  for(let l=-.5;l<=3.5;l++){g.strokeStyle='#3b3158';g.beginPath();g.moveTo(X(l,0),Y(0));g.lineTo(X(l,1.1),Y(1.1));g.stroke()}
  // fallos automáticos
  const jn=judgeT();
  for(const n of notes){if(n.t-jn>0)break;if(!n.done&&jn-n.t>WIN){n.done=2;miss++;combo=0;say('Fallo')}}
  // objetivos
  const lb=LBL[$('keys').value],tn=performance.now();
  for(let l=0;l<4;l++){
    const r=lw(1)*.4,on=tn-flash[l]<110;
    g.strokeStyle=COL[l];g.fillStyle=on?COL[l]:'#0c0a14';g.lineWidth=4;
    g.beginPath();g.ellipse(X(l,1),Y(1),r,r*.42,0,0,7);g.fill();g.stroke();
    g.fillStyle=on?'#000':COL[l];g.font='bold '+Math.max(14,r*.5)+'px sans-serif';g.textAlign='center';
    g.fillText(lb[l],X(l,1),Y(1)+r*.18+4);
  }
  // notas (las lejanas primero)
  for(let i=notes.length-1;i>=0;i--){
    const n=notes[i],p=1-(n.t-now)/APPROACH;
    if(p<0||n.done==1||p>1.12)continue;
    const r=lw(p)*.4,c=n.done==2?'#555':COL[n.l];
    g.fillStyle=c;g.beginPath();g.ellipse(X(n.l,p),Y(p),r,r*.42,0,0,7);g.fill();
    g.fillStyle='#fff8';g.beginPath();g.ellipse(X(n.l,p),Y(p)-r*.08,r*.5,r*.18,0,0,7);g.fill();
  }
  // HUD
  g.textAlign='left';g.fillStyle='#f3eefc';g.font='bold 26px sans-serif';
  g.fillText('Puntaje '+score,16,34);
  g.font='18px sans-serif';g.fillStyle='#ffd83d';g.fillText('Combo '+combo+'  x'+mult(),16,60);
  if(tn-msgT<600){g.textAlign='center';g.fillStyle='#f3eefc';g.font='bold 30px sans-serif';g.fillText(msg,cx,h*.45)}
  if(now<0){g.textAlign='center';g.fillStyle='#f3eefc';g.font='bold 28px sans-serif';g.fillText('Preparate…',cx,h*.3)}
  if(now>endAt+.5){stop();return}
  requestAnimationFrame(loop);
}
