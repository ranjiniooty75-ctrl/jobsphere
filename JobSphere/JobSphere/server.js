const http  = require('http');
const https = require('https');
const url   = require('url');
const path  = require('path');
const fs    = require('fs');

const PORT         = process.env.PORT         || 3000;
const ADZUNA_ID    = process.env.ADZUNA_ID    || '';
const ADZUNA_KEY   = process.env.ADZUNA_KEY   || '';
const JSEARCH_KEY  = process.env.JSEARCH_KEY  || '';
const REED_KEY     = process.env.REED_KEY     || '';
const JOOBLE_KEY   = process.env.JOOBLE_KEY   || '';
const CAREERJET_ID = process.env.CAREERJET_ID || '';

// ── fetch helpers ─────────────────────────────────────────────────────────
function fetchJSON(apiUrl, opts = {}, ms = 15000) {
  return new Promise((resolve, reject) => {
    const headers = { 'User-Agent': 'JobSphere/4.0', Accept: 'application/json', ...(opts.headers || {}) };
    const req = https.get(apiUrl, { headers }, res => {
      let raw = '';
      res.on('data', c => (raw += c));
      res.on('end', () => {
        try { resolve(JSON.parse(raw)); }
        catch (e) { reject(new Error('JSON parse: ' + e.message + ' | ' + apiUrl.substring(0,60))); }
      });
    });
    req.setTimeout(ms, () => { req.destroy(); reject(new Error('timeout: ' + apiUrl.substring(0,60))); });
    req.on('error', reject);
  });
}

function postJSON(apiUrl, body, opts = {}, ms = 15000) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const u = new URL(apiUrl);
    const headers = {
      'User-Agent': 'JobSphere/4.0',
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(data),
      'Accept': 'application/json',
      ...(opts.headers || {})
    };
    const req = https.request({ hostname: u.hostname, path: u.pathname + u.search, method: 'POST', headers }, res => {
      let raw = '';
      res.on('data', c => (raw += c));
      res.on('end', () => {
        try { resolve(JSON.parse(raw)); }
        catch (e) { reject(new Error('JSON parse POST: ' + e.message)); }
      });
    });
    req.setTimeout(ms, () => { req.destroy(); reject(new Error('timeout POST')); });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

// ── classifier ────────────────────────────────────────────────────────────
function classify(j) {
  const t = ((j.title||'')+' '+(Array.isArray(j.tags)?j.tags.join(' '):(j.tags||''))+' '+(j.category||'')).toLowerCase();
  if (/\btest(ing|er)?\b|qa\b|quality assur|sdet|selenium|playwright|cypress|edifecs|edi\b|hipaa/.test(t)) return 'testing';
  if (/\bdata\b|analyst|machine.?learn|\bai\b|scientist|\betl\b|tableau|dbt|llm|bigquery|spark/.test(t))   return 'data';
  if (/devops|\baws\b|azure|\bgcp\b|kubernetes|docker|infra|\bsre\b|cloud/.test(t))                         return 'devops';
  if (/design|figma|\bux\b|\bui\b|graphic|creative/.test(t))                                                return 'design';
  if (/product.?manager|product.?owner|\bpm\b|roadmap|scrum/.test(t))                                       return 'product';
  if (/market|growth|\bseo\b|content|social.?media|brand|campaign/.test(t))                                 return 'marketing';
  if (/support|customer.?service|customer.?success|helpdesk/.test(t))                                       return 'support';
  if (/sales|business.?dev|account.?exec|revenue|b2b/.test(t))                                              return 'sales';
  if (/financ|account|payroll|\btax\b|invest|banking|audit/.test(t))                                        return 'finance';
  if (/\bhr\b|human.?resour|recruit|talent|peopleops/.test(t))                                              return 'hr';
  if (/engineer|developer|software|fullstack|backend|frontend|mobile|react|node|python|java\b|golang|ruby|typescript/.test(t)) return 'software';
  return 'other';
}

// ── location detector ─────────────────────────────────────────────────────
const INDIA_CITIES = ['bangalore','bengaluru','mumbai','chennai','hyderabad','pune','delhi','noida','gurugram','gurgaon','kolkata','ahmedabad','jaipur','kochi','lucknow','chandigarh','coimbatore','trichy','mysore','vizag','visakhapatnam','nagpur'];
const INDIA_STATES = { 'Tamil Nadu':['chennai','coimbatore','madurai','trichy','salem'], 'Karnataka':['bangalore','bengaluru','mysore'], 'Maharashtra':['mumbai','pune','nagpur','nashik','thane'], 'Delhi':['delhi','noida','gurugram','gurgaon'], 'Telangana':['hyderabad'], 'Gujarat':['ahmedabad','surat','vadodara'], 'West Bengal':['kolkata'], 'Kerala':['kochi','thiruvananthapuram'], 'Uttar Pradesh':['lucknow','kanpur','noida','agra'], 'Punjab':['chandigarh','ludhiana'], 'Rajasthan':['jaipur','jodhpur'], 'Andhra Pradesh':['visakhapatnam','vizag','vijayawada'] };

function detectLoc(locationStr) {
  if (!locationStr) return { country:'Remote', state:'', city:'' };
  const loc = locationStr.toLowerCase();
  if (/remote|worldwide|anywhere|work from home/.test(loc)) return { country:'Remote', state:'', city:'' };
  if (/india/.test(loc) || INDIA_CITIES.some(c => loc.includes(c))) {
    let state='', city='';
    for (const [s,cs] of Object.entries(INDIA_STATES)) { const f=cs.find(c=>loc.includes(c)); if(f){state=s;city=f;break;} }
    return { country:'India', state, city };
  }
  if (/united states|usa|\busa\b| tx | ca | ny | wa |texas|california|new york|seattle|chicago|boston|austin|dallas|houston|atlanta|denver|miami|orlando/.test(loc)) return { country:'US', state:'', city:'' };
  if (/united kingdom|uk\b|england|scotland|london|manchester|birmingham|leeds|bristol|edinburgh/.test(loc)) return { country:'GB', state:'', city:'' };
  if (/australia|sydney|melbourne|brisbane|perth/.test(loc)) return { country:'AU', state:'', city:'' };
  if (/germany|deutschland|berlin|munich|münchen|frankfurt|hamburg/.test(loc)) return { country:'DE', state:'', city:'' };
  if (/canada|toronto|vancouver|montreal|calgary/.test(loc)) return { country:'CA', state:'', city:'' };
  if (/singapore/.test(loc)) return { country:'SG', state:'', city:'' };
  if (/uae|dubai|abu dhabi|emirates/.test(loc)) return { country:'UAE', state:'', city:'' };
  return { country:'Other', state:'', city:'' };
}

function norm(raw) {
  const det = detectLoc(raw.location);
  const tags = Array.isArray(raw.tags) ? raw.tags.filter(Boolean)
    : typeof raw.tags === 'string' ? raw.tags.split(',').map(t=>t.trim()).filter(Boolean) : [];
  return { ...raw, tags, _country: det.country, _state: det.state, _city: det.city, cat: raw.cat || classify({...raw, tags}) };
}

// ── SOURCE 1: Himalayas (no key, remote) ─────────────────────────────────
async function getHimalayas() {
  try {
    const pages = await Promise.all([0,20,40,60,80,100].map(offset =>
      fetchJSON(`https://himalayas.app/jobs/api?limit=20&offset=${offset}`).then(d=>d.jobs||[]).catch(()=>[])
    ));
    return pages.flat().map(j => norm({
      id:'him-'+j.id, title:j.title||'', company:j.companyName||'', logo:j.companyLogo||'',
      location:(j.locationRestrictions||['Worldwide']).join(', '), remote:true, type:j.employmentType||'Full Time',
      url:j.applicationLink||'https://himalayas.app/jobs',
      tags:[...(j.tags||[]),j.seniority,j.employmentType].filter(Boolean),
      desc:(j.shortDescription||'').replace(/<[^>]+>/g,'').trim().substring(0,300),
      posted:j.pubDate||new Date().toISOString(),
      salary:j.annualSalaryMin&&j.annualSalaryMax?`$${Math.round(j.annualSalaryMin/1000)}k–$${Math.round(j.annualSalaryMax/1000)}k`:null,
      source:'Himalayas'
    }));
  } catch(e) { console.error('[Himalayas]',e.message); return []; }
}

// ── SOURCE 2: RemoteOK (no key, remote) ──────────────────────────────────
async function getRemoteOK() {
  try {
    const d = await fetchJSON('https://remoteok.com/api');
    return (Array.isArray(d)?d:[]).filter(j=>j&&j.id&&j.position).slice(0,120).map(j => norm({
      id:'rok-'+j.id, title:j.position||'', company:j.company||'', logo:j.company_logo||'',
      location:'Worldwide', remote:true, type:'Full Time',
      url:j.url||`https://remoteok.com/l/${j.id}`,
      tags:(j.tags||[]).filter(Boolean),
      desc:(j.description||'').replace(/<[^>]+>/g,'').trim().substring(0,300),
      posted:j.date||new Date().toISOString(),
      salary:j.salary_min&&j.salary_max?`$${Math.round(j.salary_min/1000)}k–$${Math.round(j.salary_max/1000)}k`:null,
      source:'RemoteOK'
    }));
  } catch(e) { console.error('[RemoteOK]',e.message); return []; }
}

// ── SOURCE 3: Remotive (no key, remote) ──────────────────────────────────
async function getRemotive() {
  try {
    const d = await fetchJSON('https://remotive.com/api/remote-jobs?limit=100');
    return (d.jobs||[]).map(j => norm({
      id:'rem-'+j.id, title:j.title||'', company:j.company_name||'', logo:j.company_logo||'',
      location:j.candidate_required_location||'Worldwide', remote:true, type:j.job_type||'Full Time',
      url:j.url||'#',
      tags: Array.isArray(j.tags) ? j.tags.filter(Boolean) : typeof j.tags==='string' ? j.tags.split(',').map(t=>t.trim()).filter(Boolean) : [],
      desc:(j.description||'').replace(/<[^>]+>/g,'').trim().substring(0,300),
      posted:j.publication_date||new Date().toISOString(),
      salary:j.salary||null, source:'Remotive'
    }));
  } catch(e) { console.error('[Remotive]',e.message); return []; }
}

// ── SOURCE 4: Jobicy (no key, remote) ────────────────────────────────────
async function getJobicy() {
  try {
    const [d1,d2] = await Promise.all([
      fetchJSON('https://jobicy.com/api/v2/remote-jobs?count=50&tag=tech').catch(()=>({jobs:[]})),
      fetchJSON('https://jobicy.com/api/v2/remote-jobs?count=50&tag=marketing').catch(()=>({jobs:[]}))
    ]);
    return [...(d1.jobs||[]),...(d2.jobs||[])].map(j => norm({
      id:'jcy-'+j.id, title:j.jobTitle||'', company:j.companyName||'', logo:j.companyLogo||'',
      location:j.jobGeo||'Worldwide', remote:true, type:j.jobType||'Full Time',
      url:j.url||'https://jobicy.com',
      tags:(j.jobIndustry||[]).concat(j.jobType?[j.jobType]:[]).filter(Boolean),
      desc:(j.jobDescription||'').replace(/<[^>]+>/g,'').trim().substring(0,300),
      posted:j.pubDate||new Date().toISOString(),
      salary:j.annualSalaryMin&&j.annualSalaryMax?`$${Math.round(j.annualSalaryMin/1000)}k–$${Math.round(j.annualSalaryMax/1000)}k`:null,
      source:'Jobicy'
    }));
  } catch(e) { console.error('[Jobicy]',e.message); return []; }
}

// ── SOURCE 5: The Muse (no key, all types) ───────────────────────────────
async function getTheMuse() {
  try {
    const pages = await Promise.all([1,2,3,4,5].map(p =>
      fetchJSON(`https://www.themuse.com/api/public/jobs?page=${p}&api_key=`).then(d=>d.results||[]).catch(()=>[])
    ));
    return pages.flat().map(j => norm({
      id:'muse-'+j.id, title:j.name||'', company:j.company?.name||'', logo:j.company?.refs?.logo_image||'',
      location:(j.locations||[{name:'USA'}])[0].name, remote:j.locations?.some(l=>l.name?.toLowerCase().includes('remote'))||false,
      type:(j.level||[]).map(l=>l.name).join(', ')||'Full Time',
      url:j.refs?.landing_page||'https://www.themuse.com/jobs',
      tags:[...(j.categories||[]).map(c=>c.name),...(j.level||[]).map(l=>l.name)].filter(Boolean),
      desc:(j.contents||'').replace(/<[^>]+>/g,'').trim().substring(0,300),
      posted:j.publication_date||new Date().toISOString(),
      salary:null, source:'The Muse'
    }));
  } catch(e) { console.error('[TheMuse]',e.message); return []; }
}

// ── SOURCE 6: Arbeitnow (no key, global ATS) ─────────────────────────────
async function getArbeitnow() {
  try {
    const pages = await Promise.all([1,2,3,4].map(p =>
      fetchJSON(`https://www.arbeitnow.com/api/job-board-api?page=${p}`).then(d=>d.data||[]).catch(()=>[])
    ));
    return pages.flat().map(j => norm({
      id:'arb-'+j.slug, title:j.title||'', company:j.company_name||'', logo:'',
      location:j.location||'Remote', remote:!!j.remote, type:'Full Time',
      url:j.url||'https://www.arbeitnow.com',
      tags:j.tags||[],
      desc:(j.description||'').replace(/<[^>]+>/g,'').trim().substring(0,300),
      posted:j.created_at?new Date(j.created_at*1000).toISOString():new Date().toISOString(),
      salary:null, source:'Arbeitnow'
    }));
  } catch(e) { console.error('[Arbeitnow]',e.message); return []; }
}

// ── SOURCE 7: USAJobs (no key, US govt) ──────────────────────────────────
async function getUSAJobs() {
  try {
    const d = await fetchJSON(
      'https://data.usajobs.gov/api/search?ResultsPerPage=50&WhoMayApply=public',
      { headers: { 'Host':'data.usajobs.gov', 'User-Agent':'JobSphere/4.0', 'Authorization-Key':'' } }
    );
    return ((d.SearchResult||{}).SearchResultItems||[]).map(j => {
      const p = j.MatchedObjectDescriptor||{};
      return norm({
        id:'usa-'+p.PositionID, title:p.PositionTitle||'', company:p.OrganizationName||'US Government', logo:'',
        location:(p.PositionLocationDisplay||'USA'), remote:false, type:p.PositionSchedule?.[0]?.Name||'Full Time',
        url:p.PositionURI||'https://usajobs.gov',
        tags:[p.JobCategory?.[0]?.Name,'Government','USA'].filter(Boolean),
        desc:(p.UserArea?.Details?.JobSummary||'').trim().substring(0,300),
        posted:p.PublicationStartDate||new Date().toISOString(),
        salary:p.PositionRemuneration?.[0]?.MinimumRange&&p.PositionRemuneration?.[0]?.MaximumRange
          ?`$${Math.round(p.PositionRemuneration[0].MinimumRange/1000)}k–$${Math.round(p.PositionRemuneration[0].MaximumRange/1000)}k`:null,
        source:'USAJobs'
      });
    });
  } catch(e) { console.error('[USAJobs]',e.message); return []; }
}

// ── SOURCE 8: Adzuna (free key, India + global) ───────────────────────────
async function getAdzuna(cc, label) {
  if (!ADZUNA_ID || !ADZUNA_KEY) return [];
  try {
    const pages = await Promise.all([1,2,3].map(p =>
      fetchJSON(`https://api.adzuna.com/v1/api/jobs/${cc}/search/${p}?app_id=${ADZUNA_ID}&app_key=${ADZUNA_KEY}&results_per_page=50&content-type=application/json`)
        .then(d=>d.results||[]).catch(()=>[])
    ));
    return pages.flat().map(j => norm({
      id:`az${cc}-`+j.id, title:j.title||'', company:j.company?.display_name||'', logo:'',
      location:j.location?.display_name||label, remote:(j.title+' '+(j.description||'')).toLowerCase().includes('remote'),
      type:j.contract_time==='full_time'?'Full Time':j.contract_time||'Full Time',
      url:j.redirect_url||'#', tags:[j.category?.label].filter(Boolean),
      desc:(j.description||'').trim().substring(0,300),
      posted:j.created||new Date().toISOString(),
      salary:j.salary_min&&j.salary_max?`${cc==='in'?'₹':'$'}${Math.round(j.salary_min/1000)}k–${Math.round(j.salary_max/1000)}k`:null,
      source:cc==='in'?'Adzuna India':'Adzuna'
    }));
  } catch(e) { console.error(`[Adzuna ${cc}]`,e.message); return []; }
}

// ── SOURCE 9: Reed.co.uk (free key, UK jobs) ──────────────────────────────
async function getReed() {
  if (!REED_KEY) return [];
  try {
    const auth = Buffer.from(REED_KEY+':').toString('base64');
    const pages = await Promise.all([0,100,200].map(skip =>
      fetchJSON(`https://www.reed.co.uk/api/1.0/search?resultsToTake=100&resultsToSkip=${skip}`,
        { headers:{ 'Authorization':'Basic '+auth } }).then(d=>d.results||[]).catch(()=>[])
    ));
    return pages.flat().map(j => norm({
      id:'reed-'+j.jobId, title:j.jobTitle||'', company:j.employerName||'', logo:'',
      location:j.locationName||'UK', remote:(j.locationName||'').toLowerCase().includes('remote'),
      type:j.jobTypes?.join(', ')||'Full Time',
      url:j.jobUrl||'https://www.reed.co.uk',
      tags:['UK', j.jobTypes?.[0]].filter(Boolean),
      desc:(j.jobDescription||'').replace(/<[^>]+>/g,'').trim().substring(0,300),
      posted:j.date||new Date().toISOString(),
      salary:j.minimumSalary&&j.maximumSalary?`£${Math.round(j.minimumSalary/1000)}k–£${Math.round(j.maximumSalary/1000)}k`:null,
      source:'Reed UK'
    }));
  } catch(e) { console.error('[Reed]',e.message); return []; }
}

// ── SOURCE 10: JSearch / OpenWeb Ninja (free key, Google Jobs aggregator) ─
async function getJSearch(query='developer', location='') {
  if (!JSEARCH_KEY) return [];
  try {
    const q = encodeURIComponent(query+(location?' in '+location:''));
    const d = await fetchJSON(
      `https://api.openwebninja.com/jsearch/search?query=${q}&num_pages=3`,
      { headers:{ 'x-api-key': JSEARCH_KEY } }
    );
    return (d.data||[]).map(j => norm({
      id:'js-'+j.job_id, title:j.job_title||'', company:j.employer_name||'', logo:j.employer_logo||'',
      location:j.job_city?(j.job_city+(j.job_country?', '+j.job_country:'')):j.job_country||'Worldwide',
      remote:j.job_is_remote||false, type:j.job_employment_type||'Full Time',
      url:j.job_apply_link||j.job_google_link||'#',
      tags:[j.job_required_skills?.[0],j.job_employment_type,j.job_publisher].filter(Boolean),
      desc:(j.job_description||'').trim().substring(0,300),
      posted:j.job_posted_at_datetime_utc||new Date().toISOString(),
      salary:j.job_min_salary&&j.job_max_salary?`$${Math.round(j.job_min_salary/1000)}k–$${Math.round(j.job_max_salary/1000)}k`:null,
      source:'JSearch'
    }));
  } catch(e) { console.error('[JSearch]',e.message); return []; }
}

// ── SOURCE 11: Jooble (free key via email, 60+ countries) ─────────────────
async function getJooble(keywords='developer', location='') {
  if (!JOOBLE_KEY) return [];
  try {
    const d = await postJSON(`https://jooble.org/api/${JOOBLE_KEY}`, { keywords, location, page:1, ResultOnPage:50 });
    return (d.jobs||[]).map(j => norm({
      id:'jbl-'+(j.id||Math.random()), title:j.title||'', company:j.company||'', logo:'',
      location:j.location||location||'Worldwide', remote:(j.title+' '+(j.location||'')).toLowerCase().includes('remote'),
      type:j.type||'Full Time', url:j.link||'https://jooble.org',
      tags:[j.type].filter(Boolean),
      desc:(j.snippet||'').replace(/<[^>]+>/g,'').trim().substring(0,300),
      posted:j.updated||new Date().toISOString(),
      salary:j.salary||null, source:'Jooble'
    }));
  } catch(e) { console.error('[Jooble]',e.message); return []; }
}

// ── SOURCE 12: Careerjet (affiliate ID, 90 countries) ────────────────────
async function getCareerjet(keywords='developer', location='') {
  if (!CAREERJET_ID) return [];
  try {
    const q = encodeURIComponent(keywords), l = encodeURIComponent(location);
    const d = await fetchJSON(`https://www.careerjet.com/jobs/api?keywords=${q}&location=${l}&affid=${CAREERJET_ID}&user_ip=1.0.0.0&url=https://jobsphere.app&user_agent=JobSphere&locale_code=en_GB&pagesize=50`);
    return (d.jobs||[]).map(j => norm({
      id:'cj-'+(j.url||Math.random()).toString().slice(-10),
      title:j.title||'', company:j.company||'', logo:'',
      location:j.locations||location||'Worldwide',
      remote:(j.title+' '+(j.locations||'')).toLowerCase().includes('remote'),
      type:'Full Time', url:j.url||'https://www.careerjet.com',
      tags:[j.site].filter(Boolean),
      desc:(j.description||'').replace(/<[^>]+>/g,'').trim().substring(0,300),
      posted:j.date||new Date().toISOString(),
      salary:j.salary||null, source:'Careerjet'
    }));
  } catch(e) { console.error('[Careerjet]',e.message); return []; }
}

// ── CACHE ─────────────────────────────────────────────────────────────────
let cache = { jobs:[], ts:0, sources:{}, meta:{} };
const TTL  = 20 * 60 * 1000;

async function getAllJobs() {
  if (Date.now()-cache.ts < TTL && cache.jobs.length > 0) return cache;
  console.log('[JobSphere] Refreshing…');
  const t0 = Date.now();

  const [him,rok,rem,jcy,muse,arb,usa,azIn,azUs,azGb,azAu,azDe,azCa,reed,jsearch,jooble,cj] =
    await Promise.allSettled([
      getHimalayas(), getRemoteOK(), getRemotive(), getJobicy(), getTheMuse(),
      getArbeitnow(), getUSAJobs(),
      getAdzuna('in','India'), getAdzuna('us','USA'), getAdzuna('gb','UK'),
      getAdzuna('au','Australia'), getAdzuna('de','Germany'), getAdzuna('ca','Canada'),
      getReed(),
      getJSearch('software engineer',''),
      getJooble('developer',''),
      getCareerjet('developer','')
    ]);

  const pick = r => r.status==='fulfilled' ? (r.value||[]) : [];

  let jobs = [
    ...pick(him),...pick(rok),...pick(rem),...pick(jcy),...pick(muse),
    ...pick(arb),...pick(usa),
    ...pick(azIn),...pick(azUs),...pick(azGb),...pick(azAu),...pick(azDe),...pick(azCa),
    ...pick(reed),...pick(jsearch),...pick(jooble),...pick(cj)
  ];

  // Deduplicate
  const seen = new Set();
  jobs = jobs.filter(j => {
    const k = (j.title+j.company).toLowerCase().replace(/\s+/g,'').substring(0,60);
    if (seen.has(k)) return false; seen.add(k); return true;
  });

  // Sort newest first
  jobs.sort((a,b) => new Date(b.posted)-new Date(a.posted));

  // Build meta
  const countryCounts={}, stateCounts={};
  jobs.forEach(j => {
    const c=j._country||'Other', s=j._state||'';
    countryCounts[c]=(countryCounts[c]||0)+1;
    if(s){ const k=c+'||'+s; stateCounts[k]=(stateCounts[k]||0)+1; }
  });

  const sources = {
    'Himalayas':   pick(him).length,
    'RemoteOK':    pick(rok).length,
    'Remotive':    pick(rem).length,
    'Jobicy':      pick(jcy).length,
    'The Muse':    pick(muse).length,
    'Arbeitnow':   pick(arb).length,
    'USAJobs':     pick(usa).length,
    'Adzuna India':pick(azIn).length,
    'Adzuna':      pick(azUs).length+pick(azGb).length+pick(azAu).length+pick(azDe).length+pick(azCa).length,
    'Reed UK':     pick(reed).length,
    'JSearch':     pick(jsearch).length,
    'Jooble':      pick(jooble).length,
    'Careerjet':   pick(cj).length,
  };

  console.log(`[JobSphere] ${jobs.length} jobs in ${Date.now()-t0}ms`);
  console.log('[Sources]', Object.entries(sources).map(([k,v])=>`${k}:${v}`).join(' | '));
  if (!ADZUNA_ID)   console.log('⚠  Add ADZUNA_ID + ADZUNA_KEY for India/global jobs');
  if (!JSEARCH_KEY) console.log('⚠  Add JSEARCH_KEY for LinkedIn/Indeed/Glassdoor via Google Jobs');
  if (!REED_KEY)    console.log('⚠  Add REED_KEY for UK jobs (reed.co.uk/developers)');
  if (!JOOBLE_KEY)  console.log('⚠  Add JOOBLE_KEY for 60+ country coverage');
  if (!CAREERJET_ID)console.log('⚠  Add CAREERJET_ID for 90-country Careerjet coverage');

  cache = { jobs, ts:Date.now(), sources, meta:{ countryCounts, stateCounts } };
  return cache;
}

// ── HTTP SERVER ───────────────────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  const parsed   = new URL(req.url, `http://localhost:${PORT}`);
  const pathname = parsed.pathname;
  const q        = Object.fromEntries(parsed.searchParams);

  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Access-Control-Allow-Methods','GET,OPTIONS');
  if (req.method==='OPTIONS'){ res.writeHead(204); res.end(); return; }

  if (pathname==='/api/jobs') {
    try {
      const data = await getAllJobs();
      let jobs = [...data.jobs];

      if (q.q)       { const kw=q.q.toLowerCase(); jobs=jobs.filter(j=>(j.title+' '+j.company+' '+j.tags.join(' ')+' '+j.location).toLowerCase().includes(kw)); }
      if (q.cat)     jobs=jobs.filter(j=>j.cat===q.cat);
      if (q.source)  jobs=jobs.filter(j=>j.source===q.source);
      if (q.country) jobs=jobs.filter(j=>j._country?.toLowerCase()===q.country.toLowerCase());
      if (q.state)   jobs=jobs.filter(j=>j._state?.toLowerCase()===q.state.toLowerCase());
      if (q.city)    jobs=jobs.filter(j=>j._city?.toLowerCase().includes(q.city.toLowerCase())||j.location?.toLowerCase().includes(q.city.toLowerCase()));
      if (q.remote==='1') jobs=jobs.filter(j=>j.remote);
      if (q.salary==='1') jobs=jobs.filter(j=>j.salary);
      if (q.days)    { const cut=Date.now()-parseInt(q.days)*864e5; jobs=jobs.filter(j=>new Date(j.posted)>cut); }
      if (q.type)    jobs=jobs.filter(j=>(j.type||'').toLowerCase().includes(q.type.toLowerCase()));
      if (q.sort==='salary') jobs.sort((a,b)=>(b.salary?1:0)-(a.salary?1:0));
      else if (q.sort==='rel') jobs.sort((a,b)=>b.tags.length-a.tags.length);

      const page=Math.max(1,parseInt(q.page)||1), per=Math.min(50,Math.max(1,parseInt(q.per)||15));
      const total=jobs.length, pages=Math.ceil(total/per)||1;
      const slice=jobs.slice((page-1)*per,page*per);
      const cats={}; data.jobs.forEach(j=>{cats[j.cat]=(cats[j.cat]||0)+1;});

      res.writeHead(200,{'Content-Type':'application/json'});
      res.end(JSON.stringify({ jobs:slice, total, pages, page, sources:data.sources, cats, meta:data.meta }));
    } catch(e) {
      res.writeHead(500,{'Content-Type':'application/json'});
      res.end(JSON.stringify({error:e.message}));
    }
    return;
  }

  if (pathname==='/api/health') {
    res.writeHead(200,{'Content-Type':'application/json'});
    res.end(JSON.stringify({ ok:true, cached:cache.jobs.length, sources:cache.sources,
      keys:{ adzuna:!!(ADZUNA_ID&&ADZUNA_KEY), jsearch:!!JSEARCH_KEY, reed:!!REED_KEY, jooble:!!JOOBLE_KEY, careerjet:!!CAREERJET_ID }
    }));
    return;
  }

  // static
  let fp = pathname==='/'?'/index.html':pathname;
  fp = path.join(__dirname,'public',fp);
  if (fs.existsSync(fp)&&fs.statSync(fp).isFile()) {
    const ext=path.extname(fp);
    const mime={'.html':'text/html','.css':'text/css','.js':'application/javascript','.json':'application/json','.png':'image/png','.ico':'image/x-icon'};
    res.writeHead(200,{'Content-Type':mime[ext]||'text/plain'});
    fs.createReadStream(fp).pipe(res);
  } else {
    res.writeHead(200,{'Content-Type':'text/html'});
    fs.createReadStream(path.join(__dirname,'public/index.html')).pipe(res);
  }
});

server.listen(PORT,()=>{
  console.log(`\n✅  JobSphere v4  →  http://localhost:${PORT}`);
  console.log(`📡  API           →  http://localhost:${PORT}/api/jobs`);
  console.log(`❤️   Health        →  http://localhost:${PORT}/api/health`);
  console.log(`\n📦  Sources active: Himalayas · RemoteOK · Remotive · Jobicy · The Muse · Arbeitnow · USAJobs${ADZUNA_ID?' · Adzuna India/Global':''}${REED_KEY?' · Reed UK':''}${JSEARCH_KEY?' · JSearch':''}${JOOBLE_KEY?' · Jooble':''}${CAREERJET_ID?' · Careerjet':''}\n`);
  getAllJobs().catch(console.error);
});
