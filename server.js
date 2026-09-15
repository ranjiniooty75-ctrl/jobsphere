const http   = require('http');
const https  = require('https');
const url    = require('url');
const path   = require('path');
const fs     = require('fs');
const crypto = require('crypto');

const PORT          = process.env.PORT          || 3000;
const ADZUNA_ID     = process.env.ADZUNA_ID     || '';
const ADZUNA_KEY    = process.env.ADZUNA_KEY    || '';
const MONGO_URI     = process.env.MONGO_URI     || '';
const JWT_SECRET    = process.env.JWT_SECRET    || 'jobsphere-secret-2026';
const RZP_KEY_ID    = process.env.RZP_KEY_ID    || '';
const RZP_KEY_SECRET= process.env.RZP_KEY_SECRET|| '';

// ── Load auth only if MongoDB is configured
let auth = null;
if (MONGO_URI) {
  try { auth = require('./auth'); } catch(e) { console.error('Auth module error:', e.message); }
}

// ── Razorpay
let Razorpay = null;
if (RZP_KEY_ID && RZP_KEY_SECRET) {
  try { Razorpay = require('razorpay'); } catch(e) { console.log('Razorpay not installed yet'); }
}

// ── fetch helper
function fetchJSON(apiUrl, opts={}, ms=15000) {
  return new Promise((resolve, reject) => {
    const req = https.get(apiUrl, { headers:{'User-Agent':'JobSphere/4.0',Accept:'application/json',...(opts.headers||{})} }, res => {
      let raw='';
      res.on('data',c=>raw+=c);
      res.on('end',()=>{ try{resolve(JSON.parse(raw));}catch(e){reject(new Error('JSON: '+e.message));} });
    });
    req.setTimeout(ms,()=>{req.destroy();reject(new Error('timeout'));});
    req.on('error',reject);
  });
}

// ── classifier
function classify(j) {
  const t=((j.title||'')+' '+(Array.isArray(j.tags)?j.tags.join(' '):(j.tags||''))+' '+(j.category||'')).toLowerCase();
  if(/\btest(ing|er)?\b|qa\b|quality assur|sdet|selenium|playwright|cypress/.test(t))return'testing';
  if(/\bdata\b|analyst|machine.?learn|\bai\b|scientist|\betl\b|tableau|dbt|llm/.test(t))return'data';
  if(/devops|\baws\b|azure|\bgcp\b|kubernetes|docker|\bsre\b|cloud/.test(t))return'devops';
  if(/design|figma|\bux\b|\bui\b|graphic/.test(t))return'design';
  if(/product.?manager|product.?owner|\bpm\b|roadmap/.test(t))return'product';
  if(/market|growth|\bseo\b|content|social.?media|brand/.test(t))return'marketing';
  if(/support|customer.?service|helpdesk/.test(t))return'support';
  if(/sales|business.?dev|account.?exec|b2b/.test(t))return'sales';
  if(/financ|account|payroll|\btax\b|banking/.test(t))return'finance';
  if(/\bhr\b|human.?resour|recruit|talent/.test(t))return'hr';
  if(/engineer|developer|software|fullstack|backend|frontend|mobile|react|node|python|java\b|golang/.test(t))return'software';
  return'other';
}

// ── location detector
const INDIA_CITIES=['bangalore','bengaluru','mumbai','chennai','hyderabad','pune','delhi','noida','gurugram','gurgaon','kolkata','ahmedabad','jaipur','kochi','lucknow','chandigarh','coimbatore'];
const INDIA_STATES={'Tamil Nadu':['chennai','coimbatore','madurai','trichy'],'Karnataka':['bangalore','bengaluru','mysore'],'Maharashtra':['mumbai','pune','nagpur','nashik'],'Delhi':['delhi','noida','gurugram','gurgaon'],'Telangana':['hyderabad'],'Gujarat':['ahmedabad','surat','vadodara'],'West Bengal':['kolkata'],'Kerala':['kochi'],'Uttar Pradesh':['lucknow','noida','agra'],'Punjab':['chandigarh'],'Rajasthan':['jaipur']};

function detectLoc(locationStr) {
  if (!locationStr) return {country:'Remote',state:'',city:''};
  const loc=locationStr.toLowerCase();
  if(/remote|worldwide|anywhere/.test(loc))return{country:'Remote',state:'',city:''};
  if(/india/.test(loc)||INDIA_CITIES.some(c=>loc.includes(c))){
    let state='',city='';
    for(const[s,cs]of Object.entries(INDIA_STATES)){const f=cs.find(c=>loc.includes(c));if(f){state=s;city=f;break;}}
    return{country:'India',state,city};
  }
  if(/united states|usa|\b usa\b|texas|california|new york|seattle|chicago/.test(loc))return{country:'US',state:'',city:''};
  if(/united kingdom|uk\b|england|london|manchester/.test(loc))return{country:'GB',state:'',city:''};
  if(/australia|sydney|melbourne|brisbane/.test(loc))return{country:'AU',state:'',city:''};
  if(/germany|berlin|munich|frankfurt/.test(loc))return{country:'DE',state:'',city:''};
  if(/canada|toronto|vancouver|montreal/.test(loc))return{country:'CA',state:'',city:''};
  return{country:'Other',state:'',city:''};
}

function norm(raw) {
  const det=detectLoc(raw.location);
  const tags=Array.isArray(raw.tags)?raw.tags.filter(Boolean):typeof raw.tags==='string'?raw.tags.split(',').map(t=>t.trim()).filter(Boolean):[];
  return{...raw,tags,_country:det.country,_state:det.state,_city:det.city,cat:raw.cat||classify({...raw,tags})};
}

// ── sources
async function getHimalayas(){
  try{const pages=await Promise.all([0,20,40,60,80].map(o=>fetchJSON(`https://himalayas.app/jobs/api?limit=20&offset=${o}`).then(d=>d.jobs||[]).catch(()=>[])));
  return pages.flat().map(j=>norm({id:'him-'+j.id,title:j.title||'',company:j.companyName||'',logo:j.companyLogo||'',location:(j.locationRestrictions||['Worldwide']).join(', '),remote:true,type:j.employmentType||'Full Time',url:j.applicationLink||'https://himalayas.app/jobs',tags:[...(j.tags||[]),j.seniority,j.employmentType].filter(Boolean),desc:(j.shortDescription||'').replace(/<[^>]+>/g,'').trim().substring(0,300),posted:j.pubDate||new Date().toISOString(),salary:j.annualSalaryMin&&j.annualSalaryMax?`$${Math.round(j.annualSalaryMin/1000)}k–$${Math.round(j.annualSalaryMax/1000)}k`:null,source:'Himalayas'}));}catch(e){console.error('[Himalayas]',e.message);return[];}}

async function getRemoteOK(){
  try{const d=await fetchJSON('https://remoteok.com/api');
  return(Array.isArray(d)?d:[]).filter(j=>j&&j.id&&j.position).slice(0,120).map(j=>norm({id:'rok-'+j.id,title:j.position||'',company:j.company||'',logo:j.company_logo||'',location:'Worldwide',remote:true,type:'Full Time',url:j.url||`https://remoteok.com/l/${j.id}`,tags:(j.tags||[]).filter(Boolean),desc:(j.description||'').replace(/<[^>]+>/g,'').trim().substring(0,300),posted:j.date||new Date().toISOString(),salary:j.salary_min&&j.salary_max?`$${Math.round(j.salary_min/1000)}k–$${Math.round(j.salary_max/1000)}k`:null,source:'RemoteOK'}));}catch(e){console.error('[RemoteOK]',e.message);return[];}}

async function getRemotive(){
  try{const d=await fetchJSON('https://remotive.com/api/remote-jobs?limit=100');
  return(d.jobs||[]).map(j=>norm({id:'rem-'+j.id,title:j.title||'',company:j.company_name||'',logo:j.company_logo||'',location:j.candidate_required_location||'Worldwide',remote:true,type:j.job_type||'Full Time',url:j.url||'#',tags:Array.isArray(j.tags)?j.tags.filter(Boolean):typeof j.tags==='string'?j.tags.split(',').map(t=>t.trim()).filter(Boolean):[],desc:(j.description||'').replace(/<[^>]+>/g,'').trim().substring(0,300),posted:j.publication_date||new Date().toISOString(),salary:j.salary||null,source:'Remotive'}));}catch(e){console.error('[Remotive]',e.message);return[];}}

async function getJobicy(){
  try{const[d1,d2]=await Promise.all([fetchJSON('https://jobicy.com/api/v2/remote-jobs?count=50&tag=tech').catch(()=>({jobs:[]})),fetchJSON('https://jobicy.com/api/v2/remote-jobs?count=50').catch(()=>({jobs:[]}))]);
  return[...(d1.jobs||[]),...(d2.jobs||[])].map(j=>norm({id:'jcy-'+j.id,title:j.jobTitle||'',company:j.companyName||'',logo:j.companyLogo||'',location:j.jobGeo||'Worldwide',remote:true,type:j.jobType||'Full Time',url:j.url||'https://jobicy.com',tags:(j.jobIndustry||[]).concat(j.jobType?[j.jobType]:[]).filter(Boolean),desc:(j.jobDescription||'').replace(/<[^>]+>/g,'').trim().substring(0,300),posted:j.pubDate||new Date().toISOString(),salary:null,source:'Jobicy'}));}catch(e){console.error('[Jobicy]',e.message);return[];}}

async function getTheMuse(){
  try{const pages=await Promise.all([1,2,3,4,5].map(p=>fetchJSON(`https://www.themuse.com/api/public/jobs?page=${p}&api_key=`).then(d=>d.results||[]).catch(()=>[])));
  return pages.flat().map(j=>norm({id:'muse-'+j.id,title:j.name||'',company:j.company?.name||'',logo:'',location:(j.locations||[{name:'USA'}])[0].name,remote:false,type:'Full Time',url:j.refs?.landing_page||'https://www.themuse.com/jobs',tags:[...(j.categories||[]).map(c=>c.name)].filter(Boolean),desc:(j.contents||'').replace(/<[^>]+>/g,'').trim().substring(0,300),posted:j.publication_date||new Date().toISOString(),salary:null,source:'The Muse'}));}catch(e){console.error('[TheMuse]',e.message);return[];}}

async function getArbeitnow(){
  try{const pages=await Promise.all([1,2,3,4].map(p=>fetchJSON(`https://www.arbeitnow.com/api/job-board-api?page=${p}`).then(d=>d.data||[]).catch(()=>[])));
  return pages.flat().map(j=>norm({id:'arb-'+j.slug,title:j.title||'',company:j.company_name||'',logo:'',location:j.location||'Remote',remote:!!j.remote,type:'Full Time',url:j.url||'https://www.arbeitnow.com',tags:j.tags||[],desc:(j.description||'').replace(/<[^>]+>/g,'').trim().substring(0,300),posted:j.created_at?new Date(j.created_at*1000).toISOString():new Date().toISOString(),salary:null,source:'Arbeitnow'}));}catch(e){console.error('[Arbeitnow]',e.message);return[];}}

async function getAdzuna(cc,label){
  if(!ADZUNA_ID||!ADZUNA_KEY)return[];
  try{const pages=await Promise.all([1,2,3].map(p=>fetchJSON(`https://api.adzuna.com/v1/api/jobs/${cc}/search/${p}?app_id=${ADZUNA_ID}&app_key=${ADZUNA_KEY}&results_per_page=50&content-type=application/json`).then(d=>d.results||[]).catch(()=>[])));
  return pages.flat().map(j=>norm({id:`az${cc}-`+j.id,title:j.title||'',company:j.company?.display_name||'',logo:'',location:j.location?.display_name||label,remote:(j.title+' '+(j.description||'')).toLowerCase().includes('remote'),type:j.contract_time==='full_time'?'Full Time':j.contract_time||'Full Time',url:j.redirect_url||'#',tags:[j.category?.label].filter(Boolean),desc:(j.description||'').trim().substring(0,300),posted:j.created||new Date().toISOString(),salary:j.salary_min&&j.salary_max?`${cc==='in'?'₹':'$'}${Math.round(j.salary_min/1000)}k–${Math.round(j.salary_max/1000)}k`:null,source:cc==='in'?'Adzuna India':'Adzuna'}));}catch(e){console.error(`[Adzuna ${cc}]`,e.message);return[];}}

// ── cache
let cache={jobs:[],ts:0,sources:{},meta:{}};
const TTL=20*60*1000;

async function getAllJobs(){
  if(Date.now()-cache.ts<TTL&&cache.jobs.length>0)return cache;
  console.log('[JobSphere] Refreshing…');
  const t0=Date.now();
  const [him,rok,rem,jcy,muse,arb,azIn,...azGl]=await Promise.allSettled([
    getHimalayas(),getRemoteOK(),getRemotive(),getJobicy(),getTheMuse(),getArbeitnow(),
    getAdzuna('in','India'),...['us','gb','au','de','ca'].map(cc=>getAdzuna(cc,cc.toUpperCase()))
  ]);
  const pick=r=>r.status==='fulfilled'?(r.value||[]):[];
  let jobs=[...pick(him),...pick(rok),...pick(rem),...pick(jcy),...pick(muse),...pick(arb),...pick(azIn),...azGl.flatMap(pick)];
  const seen=new Set();
  jobs=jobs.filter(j=>{const k=(j.title+j.company).toLowerCase().replace(/\s+/g,'').substring(0,60);if(seen.has(k))return false;seen.add(k);return true;});
  jobs.sort((a,b)=>new Date(b.posted)-new Date(a.posted));
  const countryCounts={},stateCounts={};
  jobs.forEach(j=>{const c=j._country||'Other',s=j._state||'';countryCounts[c]=(countryCounts[c]||0)+1;if(s){const k=c+'||'+s;stateCounts[k]=(stateCounts[k]||0)+1;}});
  const sources={'Himalayas':pick(him).length,'RemoteOK':pick(rok).length,'Remotive':pick(rem).length,'Jobicy':pick(jcy).length,'The Muse':pick(muse).length,'Arbeitnow':pick(arb).length,'Adzuna India':pick(azIn).length,'Adzuna':azGl.reduce((s,r)=>s+pick(r).length,0)};
  console.log(`[JobSphere] ${jobs.length} jobs in ${Date.now()-t0}ms`);
  cache={jobs,ts:Date.now(),sources,meta:{countryCounts,stateCounts}};
  return cache;
}

// ── parse body
function parseBody(req){
  return new Promise((resolve,reject)=>{
    let raw='';
    req.on('data',c=>raw+=c);
    req.on('end',()=>{try{resolve(JSON.parse(raw||'{}'));}catch(e){resolve({});}});
    req.on('error',reject);
  });
}

// ── get token from request
function getToken(req){
  const h=req.headers['authorization']||'';
  return h.startsWith('Bearer ')?h.slice(7):null;
}

// ── HTTP server
const server=http.createServer(async(req,res)=>{
  const parsed=new URL(req.url,`http://localhost:${PORT}`);
  const pathname=parsed.pathname;
  const q=Object.fromEntries(parsed.searchParams);

  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Access-Control-Allow-Methods','GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers','Content-Type,Authorization');
  if(req.method==='OPTIONS'){res.writeHead(204);res.end();return;}

  const json=(data,status=200)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(data));};

  // ── AUTH ROUTES
  if(pathname==='/api/auth/register'&&req.method==='POST'){
    if(!auth)return json({error:'Auth not configured'},500);
    const body=await parseBody(req);
    try{const result=await auth.register(body.email,body.password);json(result);}
    catch(e){json({error:e.message},400);}
    return;
  }

  if(pathname==='/api/auth/login'&&req.method==='POST'){
    if(!auth)return json({error:'Auth not configured'},500);
    const body=await parseBody(req);
    try{const result=await auth.login(body.email,body.password);json(result);}
    catch(e){json({error:e.message},400);}
    return;
  }

  if(pathname==='/api/auth/check'){
    if(!auth)return json({ok:true,reason:'no_auth'});
    const token=getToken(req);
    const result=await auth.checkAccess(token);
    json(result);
    return;
  }

  // ── PAYMENT ROUTES
  if(pathname==='/api/payment/create-order'&&req.method==='POST'){
    if(!auth)return json({error:'Auth not configured'},500);
    if(!Razorpay||!RZP_KEY_ID)return json({error:'Payment not configured'},500);
    const token=getToken(req);
    const access=await auth.checkAccess(token);
    if(!access.ok&&access.reason!=='expired')return json({error:'Not authorized'},401);
    try{
      const rzp=new Razorpay({key_id:RZP_KEY_ID,key_secret:RZP_KEY_SECRET});
      const order=await rzp.orders.create({amount:5900,currency:'INR',receipt:'jobsphere_'+Date.now()});
      json({...order,key:RZP_KEY_ID,email:access.user?.email||''});
    }catch(e){json({error:e.message},500);}
    return;
  }

  if(pathname==='/api/payment/verify'&&req.method==='POST'){
    if(!auth)return json({error:'Auth not configured'},500);
    const token=getToken(req);
    const access=await auth.checkAccess(token);
    if(!access.user)return json({error:'Not authorized'},401);
    const body=await parseBody(req);
    const sig=crypto.createHmac('sha256',RZP_KEY_SECRET).update(body.razorpay_order_id+'|'+body.razorpay_payment_id).digest('hex');
    if(sig!==body.razorpay_signature)return json({ok:false,error:'Invalid signature'},400);
    await auth.markPaid(access.user.email,1);
    json({ok:true});
    return;
  }

  // ── JOBS API
  if(pathname==='/api/jobs'){
    // Check auth if configured
    if(auth){
      const token=getToken(req);
      const access=await auth.checkAccess(token);
      if(!access.ok){
        res.writeHead(401,{'Content-Type':'application/json'});
        res.end(JSON.stringify({error:'unauthorized',reason:access.reason}));
        return;
      }
    }
    try{
      const data=await getAllJobs();
      let jobs=[...data.jobs];
      if(q.q){const kw=q.q.toLowerCase();jobs=jobs.filter(j=>(j.title+' '+j.company+' '+(j.tags||[]).join(' ')+' '+j.location).toLowerCase().includes(kw));}
      if(q.cat)jobs=jobs.filter(j=>j.cat===q.cat);
      if(q.source)jobs=jobs.filter(j=>j.source===q.source);
      if(q.country)jobs=jobs.filter(j=>j._country?.toLowerCase()===q.country.toLowerCase());
      if(q.state)jobs=jobs.filter(j=>j._state?.toLowerCase()===q.state.toLowerCase());
      if(q.city)jobs=jobs.filter(j=>j._city?.toLowerCase().includes(q.city.toLowerCase())||j.location?.toLowerCase().includes(q.city.toLowerCase()));
      if(q.remote==='1')jobs=jobs.filter(j=>j.remote);
      if(q.days){const cut=Date.now()-parseInt(q.days)*864e5;jobs=jobs.filter(j=>new Date(j.posted)>cut);}
      if(q.sort==='salary')jobs.sort((a,b)=>(b.salary?1:0)-(a.salary?1:0));
      const page=Math.max(1,parseInt(q.page)||1),per=Math.min(50,Math.max(1,parseInt(q.per)||15));
      const total=jobs.length,pages=Math.ceil(total/per)||1;
      const slice=jobs.slice((page-1)*per,page*per);
      const cats={};data.jobs.forEach(j=>{cats[j.cat]=(cats[j.cat]||0)+1;});
      res.writeHead(200,{'Content-Type':'application/json'});
      res.end(JSON.stringify({jobs:slice,total,pages,page,sources:data.sources,cats,meta:data.meta}));
    }catch(e){json({error:e.message},500);}
    return;
  }

  // ── /api/match — resume matching via Claude
  if(pathname==='/api/match'&&req.method==='POST'){
    if(auth){
      const token=getToken(req);
      const access=await auth.checkAccess(token);
      if(!access.ok){res.writeHead(401,{'Content-Type':'application/json'});res.end(JSON.stringify({error:'unauthorized'}));return;}
    }
    try{
      const body=await parseBody(req);
      const resumeText=body.resume||'';
      const jobs=body.jobs||[];
      if(!resumeText||resumeText.length<50){res.writeHead(400,{'Content-Type':'application/json'});res.end(JSON.stringify({error:'Resume text too short'}));return;}

      const jobSummaries=jobs.slice(0,150).map(function(j,i){
        return i+': '+j.title+' at '+j.company+' ('+j.location+') — tags: '+(j.tags||[]).slice(0,5).join(', ');
      }).join('\n');

      const prompt='You are a job matching expert. Given this resume, extract a profile and score each job 0-100.\n\nRESUME:\n'+resumeText.substring(0,2000)+'\n\nJOBS (index: title at company - tags):\n'+jobSummaries+'\n\nRespond with valid JSON only, no markdown:\n{"profile":{"titles":"comma-separated job titles","experience":"X years in field","topSkills":["skill1","skill2","skill3","skill4","skill5","skill6","skill7","skill8"]},"matches":[{"index":0,"score":85,"reasons":["skill1","skill2"]},...]}\n\nOnly include jobs with score >= 50. Max 30 matches. Sort by score descending.';

      const groqKey=process.env.GROQ_API_KEY||'';
      if(!groqKey){res.writeHead(500,{'Content-Type':'application/json'});res.end(JSON.stringify({error:'GROQ_API_KEY not configured. Get a free key at console.groq.com'}));return;}

      const groqRes=await new Promise((resolve,reject)=>{
        const body=JSON.stringify({model:'llama3-8b-8192',max_tokens:2000,messages:[{role:'user',content:prompt}],temperature:0.1});
        const req2=https.request({hostname:'api.groq.com',path:'/openai/v1/chat/completions',method:'POST',headers:{'Content-Type':'application/json','Content-Length':Buffer.byteLength(body),'Authorization':'Bearer '+groqKey}},res2=>{
          let raw='';res2.on('data',c=>raw+=c);res2.on('end',()=>{try{resolve(JSON.parse(raw));}catch(e){reject(e);}});
        });
        req2.setTimeout(30000,()=>{req2.destroy();reject(new Error('Groq timeout'));});
        req2.on('error',reject);
        req2.write(body);req2.end();
      });

      // Handle Groq API errors
      if(groqRes.error){throw new Error('Groq API: '+groqRes.error.message);}
      if(!groqRes.choices||!groqRes.choices[0]){throw new Error('Empty response from Groq: '+JSON.stringify(groqRes).substring(0,200));}
      const text=groqRes.choices[0].message.content;
      const jsonMatch=text.match(/\{[\s\S]*\}/);
      if(!jsonMatch)throw new Error('No JSON in response: '+text.substring(0,300));
      const result=JSON.parse(jsonMatch[0]);

      res.writeHead(200,{'Content-Type':'application/json'});
      res.end(JSON.stringify(result));
    }catch(e){
      res.writeHead(500,{'Content-Type':'application/json'});
      res.end(JSON.stringify({error:e.message}));
    }
    return;
  }

  if(pathname==='/api/health'){
    json({ok:true,cached:cache.jobs.length,sources:cache.sources,auth:!!auth,razorpay:!!(RZP_KEY_ID&&RZP_KEY_SECRET)});
    return;
  }

  // ── static files
  let fp=pathname==='/'?'/index.html':pathname;
  fp=path.join(__dirname,'public',fp);
  if(fs.existsSync(fp)&&fs.statSync(fp).isFile()){
    const ext=path.extname(fp);
    const mime={'.html':'text/html','.css':'text/css','.js':'application/javascript','.json':'application/json','.png':'image/png','.ico':'image/x-icon'};
    res.writeHead(200,{'Content-Type':mime[ext]||'text/plain'});
    fs.createReadStream(fp).pipe(res);
  }else{
    res.writeHead(200,{'Content-Type':'text/html'});
    fs.createReadStream(path.join(__dirname,'public/index.html')).pipe(res);
  }
});

server.listen(PORT,()=>{
  console.log(`\n✅  JobSphere v5  →  http://localhost:${PORT}`);
  console.log(`📡  API: http://localhost:${PORT}/api/jobs`);
  console.log(`🔐  Auth: ${auth?'enabled (MongoDB)':'disabled (no MONGO_URI)'}`);
  console.log(`💳  Razorpay: ${RZP_KEY_ID?'enabled':'disabled'}\n`);
  getAllJobs().catch(console.error);
});
