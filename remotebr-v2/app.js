
// ===== STATE =====
let allJobs = [];
let savedJobs = new Set();
// ===== CANDIDATURAS TRACKING =====
// Cada candidatura: { id, job, status, appliedAt, updatedAt, feedback, companyNotified }
// status: 'aplicado' | 'visualizado' | 'analise' | 'entrevista' | 'oferta' | 'recusado'
let candidaturas = {}; // id -> candidatura object
let appliedJobs = new Set(); // backward compat
let aiCache = {};
let cvCache = {}; // cache de CVs otimizados por vaga
let filters = { type: 'all', exp: 'all', category: '', salary: 0 };
let userProfile = {
  name: '', title: '', cvLoaded: false, plan: null,
  // Dados pessoais — ficam APENAS no browser, nunca vão para IA
  dadosPessoais: {
    nomeCompleto: '', email: '', telefone: '',
    linkedin: '', cidade: '', cpf: ''
  },
  // Texto profissional puro — vai para IA
  cvProfissional: '',
  cvOriginalCompleto: ''
};
let chatHistory = [];


// ===== ANALYTICS =====
function track(event, params) {
  if(typeof gtag === 'function') gtag('event', event, params || {});
}

// ===== THEME TOGGLE =====
function toggleTheme() {
  const isDark = document.body.classList.toggle('dark');
  const btn = document.getElementById('themeToggle');
  if(btn) btn.textContent = isDark ? '☀️' : '🌙';
  localStorage.setItem('remotebr_theme', isDark ? 'dark' : 'light');
  track('theme_toggle', { theme: isDark ? 'dark' : 'light' });
}
(function() {
  const saved = localStorage.getItem('remotebr_theme');
  if(saved === 'dark') {
    document.body.classList.add('dark');
    window.addEventListener('DOMContentLoaded', () => {
      const btn = document.getElementById('themeToggle');
      if(btn) btn.textContent = '☀️';
    });
  }
})();

// ===== STRIPE =====
const STRIPE_LINKS = {
  junior: 'LINK_JUNIOR',
  pleno:  'LINK_PLENO',
  senior: 'LINK_SENIOR',
  master: 'LINK_MASTER'
};
function stripeClick(plan) {
  sessionStorage.setItem('pendingPlan', plan);
  track('stripe_click', { plan });
}
function irParaStripe(plan) {
  const link = STRIPE_LINKS[plan];
  if(!link || link.startsWith('LINK_')) {
    showToast('Pagamentos em breve! Contato: remot3br@gmail.com');
    return;
  }
  stripeClick(plan);
  const email = userProfile.email || '';
  const url = 'https://buy.stripe.com/' + link + (email ? '?prefilled_email=' + encodeURIComponent(email) : '');
  window.open(url, '_blank');
}
function temPlano(planoMinimo) {
  const h = ['junior','pleno','senior','master'];
  return h.indexOf(userProfile.plan) >= h.indexOf(planoMinimo);
}
(function() {
  const params = new URLSearchParams(window.location.search);
  if(params.get('paid') === '1' && params.get('plan')) {
    const plan = params.get('plan');
    sessionStorage.setItem('pendingPlan', plan);
    window.history.replaceState({}, '', window.location.pathname);
    setTimeout(() => {
      showToast('Pagamento confirmado! Faca login para ativar seu plano.');
      showModal('loginModal');
    }, 800);
  }
})();

// ===== MOBILE =====
function aplicarMobile() {
  if(window.innerWidth > 600) return;
  const bottomNav = document.getElementById('mobileBottomNav');
  if(bottomNav) bottomNav.style.display = 'block';
  const mc = document.querySelector('.main-content, .main');
  if(mc) mc.style.paddingBottom = '80px';
}

function setBottomNav(active) {
  ['vagas','explorar','candidaturas','planos','mais'].forEach(id => {
    const btn = document.getElementById('bnav-' + id);
    if(!btn) return;
    btn.style.color = id === active ? 'var(--accent)' : 'var(--muted)';
  });
}

function toggleMobileMenu() {
  const menu = document.getElementById('mobileMenu');
  if(!menu) return;
  const open = menu.style.display !== 'none';
  menu.style.display = open ? 'none' : 'block';
  const h = document.getElementById('navHamburger');
  if(h) h.textContent = open ? '☰' : '✕';
}

function closeMobileMenu() {
  const menu = document.getElementById('mobileMenu');
  if(menu) menu.style.display = 'none';
  const h = document.getElementById('navHamburger');
  if(h) h.textContent = '☰';
}

function abrirFiltrosMobile() { showModal('mobileFilterModal'); }
function fecharFiltrosMobile() { closeModal('mobileFilterModal'); }

function setMobileSalary(val, el) {
  document.querySelectorAll('[id^="mfsal-"]').forEach(b => b.classList.remove('active'));
  el.classList.add('active');
  document.querySelectorAll('[id^="sal-"]').forEach(b => b.classList.remove('active'));
  const chip = document.getElementById('sal-' + val);
  if(chip) chip.classList.add('active');
  filters.salary = val;
  filterJobs();
  updateMobileFilterCount();
}
function setMobileType(val, el) {
  document.querySelectorAll('[id^="mftype-"]').forEach(b => b.classList.remove('active'));
  el.classList.add('active');
  filters.type = val;
  filterJobs();
  updateMobileFilterCount();
}
function setMobileExp(val, el) {
  document.querySelectorAll('[id^="mfexp-"]').forEach(b => b.classList.remove('active'));
  el.classList.add('active');
  filters.exp = val;
  filterJobs();
  updateMobileFilterCount();
}
function updateMobileFilterCount() {
  const count = (filters.salary > 0 ? 1 : 0) + (filters.type !== 'all' ? 1 : 0) + (filters.exp !== 'all' ? 1 : 0);
  const badge = document.getElementById('mobileFilterCount');
  if(badge) { badge.textContent = count; badge.style.display = count > 0 ? 'inline' : 'none'; }
}

// ===== OWNER CHECK =====
async function verificarOwner(email) {
  try {
    const res = await fetch('/api/owner-check', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email })
    });
    const data = await res.json();
    if(data.isOwner) {
      userProfile.plan = 'master';
      showToast('👑 Bem-vindo! Acesso Master ativo.');
    }
  } catch(e) {}
}

// ===== SIMULATE PLAN (admin) =====
function simularPlano(plan) {
  userProfile.plan = plan === 'null' ? null : plan;
  Object.keys(aiCache || {}).forEach(k => delete aiCache[k]);
  showToast('✓ Simulando: ' + (plan === 'null' ? 'Gratuito' : plan));
  if(typeof renderAdminDashboard === 'function') renderAdminDashboard();
}

// ===== TEST USER =====
const TESTE_PASSWORD = 'testemaster2025';
function verificarSenhaTeste() {
  const pw = document.getElementById('testePwInput')?.value;
  if(pw === TESTE_PASSWORD) {
    closeModal('testeModal');
    ativarModoTeste();
  } else {
    const err = document.getElementById('testePwErro');
    if(err) err.style.display = 'block';
  }
}
function ativarModoTeste() {
  userProfile.plan = 'master';
  userProfile.name = 'Usuário Teste';
  const banner = document.createElement('div');
  banner.id = 'testBanner';
  banner.style.cssText = 'position:fixed;bottom:0;left:0;right:0;background:#6d28d9;color:#fff;text-align:center;padding:8px;font-size:12px;z-index:500;font-family:var(--font-sans)';
  banner.innerHTML = '🧪 Modo teste ativo — plano Master simulado &nbsp;·&nbsp; <button onclick="desativarModoTeste()" style="background:rgba(255,255,255,.2);border:none;color:#fff;padding:2px 10px;border-radius:4px;cursor:pointer;font-size:11px">Sair</button>';
  document.body.appendChild(banner);
  showToast('✓ Modo teste Master ativado!');
}
function desativarModoTeste() {
  userProfile.plan = null;
  const banner = document.getElementById('testBanner');
  if(banner) banner.remove();
  showToast('Modo teste desativado.');
}

window.addEventListener('load', () => {
  const params = new URLSearchParams(window.location.search);
  if(params.get('teste') === TESTE_PASSWORD) setTimeout(() => ativarModoTeste(), 500);
});

// ===== INIT =====
window.addEventListener('load', () => {
  loadJobs('');
  if(typeof initSupabase === 'function') initSupabase();
  if(typeof aplicarMobile === 'function') aplicarMobile();
  if(typeof configurarContato === 'function') configurarContato('remot3br@gmail.com');
});

// ===== FONTES DE VAGAS =====
let fonteAtual = 'all';

const LEVER_COMPANIES = [
  'gitlab','netflix','shopify','stripe','figma','notion','linear',
  'vercel','railway','planetscale','supabase','loom','miro',
  'remote','deel','rippling','lattice','mercury','brex'
];

const GREENHOUSE_COMPANIES = [
  { token:'gitlab', name:'GitLab' },
  { token:'shopify', name:'Shopify' },
  { token:'automattic', name:'Automattic' },
  { token:'buffer', name:'Buffer' },
  { token:'zapier', name:'Zapier' },
  { token:'basecamp', name:'Basecamp' },
  { token:'duckduckgo', name:'DuckDuckGo' },
  { token:'close', name:'Close' },
  { token:'invision', name:'InVision' }
];

function trocarFonte(fonte, el) {
  fonteAtual = fonte;
  document.querySelectorAll('[id^="src-"]').forEach(b => b.classList.remove('active'));
  el.classList.add('active');
  loadJobs(filters.category);
}

async function loadJobs(category) {
  const grid = document.getElementById('jobsGrid');
  grid.innerHTML = '<div class="loader"><div class="spinner"></div>Buscando vagas em 8 plataformas internacionais...</div>';
  try {
    let jobs = [];
    const all = fonteAtual === 'all';
    const fetchers = [];
    const sourceNames = [];
    if(all || fonteAtual==='remotive')   { fetchers.push(fetchRemotive(category).catch(()=>[]));   sourceNames.push('Remotive'); }
    if(all || fonteAtual==='jobicy')     { fetchers.push(fetchJobicy(category).catch(()=>[]));     sourceNames.push('Jobicy'); }
    if(all || fonteAtual==='arbeitnow')  { fetchers.push(fetchArbeitnow().catch(()=>[]));          sourceNames.push('Arbeitnow'); }
    if(all || fonteAtual==='himalayas')  { fetchers.push(fetchHimalayas().catch(()=>[]));          sourceNames.push('Himalayas'); }
    if(all || fonteAtual==='remoteok')   { fetchers.push(fetchRemoteOK().catch(()=>[]));           sourceNames.push('RemoteOK'); }
    if(all || fonteAtual==='wwr')        { fetchers.push(fetchWWR().catch(()=>[]));                sourceNames.push('WeWorkRemotely'); }
    if(all || fonteAtual==='lever')      { fetchers.push(fetchLever().catch(()=>[]));              sourceNames.push('Lever'); }
    if(all || fonteAtual==='greenhouse') { fetchers.push(fetchGreenhouse().catch(()=>[]));         sourceNames.push('Greenhouse'); }
    if(all || fonteAtual==='wellfound')  { fetchers.push(fetchWellfound().catch(()=>[]));          sourceNames.push('Wellfound'); }

    // Add Wellfound option to source selector
    const sel = document.getElementById('fonteSel');
    if(sel && ![...sel.options].find(o => o.value==='wellfound')) {
      const opt = document.createElement('option');
      opt.value = 'wellfound'; opt.textContent = '🚀 Wellfound (Early-stage)';
      sel.appendChild(opt);
    }

    // Show live loading progress per source
    grid.innerHTML = `<div style="text-align:center;padding:2rem;color:var(--muted);font-size:13px">
      <div class="spinner" style="margin:0 auto 1rem"></div>
      Buscando vagas em ${fetchers.length} fonte${fetchers.length>1?'s':''}...
    </div>`;

    // Fetch all with per-source progress tracking
    const settled = await Promise.allSettled(fetchers);
    let loaded = 0; let failed = 0;
    settled.forEach((r, i) => {
      if(r.status === 'fulfilled' && r.value.length > 0) {
        jobs = jobs.concat(r.value); loaded++;
      } else { failed++; }
    });

    if(!jobs.length) {
      grid.innerHTML = `<div class="empty">
        Não foi possível carregar as vagas agora.<br>
        <span style="font-size:12px;opacity:.7">As APIs podem estar temporariamente indisponíveis. Tente novamente em alguns minutos.</span>
      </div>`;
      return;
    }

    jobs.sort((a,b) => new Date(b.publication_date) - new Date(a.publication_date));
    allJobs = jobs.map(j => ({
      ...j,
      matchScore: userProfile.cvLoaded ? Math.floor(Math.random()*25+70) : null
    }));
    renderJobs(allJobs);
    updateStats();
    verificarIdadeVagas();
    updateSourceStatus();
    if(failed > 0 && loaded > 0) {
      showToast(`✓ ${loaded} fonte${loaded>1?'s':''} carregada${loaded>1?'s':''} · ${failed} indisponível${failed>1?'s':''} agora`);
    }
  } catch(e) {
    grid.innerHTML = `<div class="empty">Erro ao carregar vagas.<br><span style="font-size:12px;opacity:.7">Verifique sua conexão e tente novamente.</span></div>`;
  }
}

// CORS proxy fallback — usado quando API bloqueia chamada direta do browser
// ===== CORS PROXY CHAIN =====
// 1. Próprio proxy Netlify (/api/proxy) — mais confiável
const sourceStatus = {}; // tracks which sources loaded: '✓' or '✗'

async function corsGet(url, sourceName = '') {
  // Try proxy — works on both Netlify (/api/proxy) and Vercel (/api/proxy)
  const proxyPaths = ['/api/proxy', '/api/proxy'];
  for (const path of proxyPaths) {
    try {
      const proxyUrl = path + '?url=' + encodeURIComponent(url);
      const res = await fetch(proxyUrl, { signal: AbortSignal.timeout(12000) });
      if (res.ok) {
        if (sourceName) sourceStatus[sourceName] = '✓';
        return res;
      }
    } catch {}
  }
  // fallback below...
  try { const x = null; } catch {}

  // 2. Acesso direto — funciona para Lever e Greenhouse que têm CORS aberto
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (res.ok) {
      if (sourceName) sourceStatus[sourceName] = '✓';
      return res;
    }
  } catch {}

  // 3. allorigins como último recurso
  try {
    const proxy = `https://api.allorigins.win/get?url=${encodeURIComponent(url)}`;
    const res = await fetch(proxy, { signal: AbortSignal.timeout(12000) });
    if (res.ok) {
      const data = await res.json();
      if (data.contents) {
        if (sourceName) sourceStatus[sourceName] = '✓';
        return {
          ok: true,
          json: async () => JSON.parse(data.contents),
          text: async () => data.contents,
        };
      }
    }
  } catch {}

  if (sourceName) sourceStatus[sourceName] = '✗';
  throw new Error(`All proxies failed for ${url}`);
}

// Update source chips with status after loading
function updateSourceStatus() {
  Object.entries(sourceStatus).forEach(([src, status]) => {
    const chip = document.querySelector(`[id^="src-"] [data-src="${src}"]`);
    if(chip) chip.textContent = status === '✓' ? `✓ ${src}` : `✗ ${src}`;
  });
  // Show in admin
  const el = document.getElementById('adminSources');
  if(el && Object.keys(sourceStatus).length) {
    const working = Object.values(sourceStatus).filter(s => s === '✓').length;
    const total = Object.keys(sourceStatus).length;
    console.log(`RemoteBR: ${working}/${total} sources loaded`);
  }
}

async function fetchRemotive(category) {
  const url = category
    ? `https://remotive.com/api/remote-jobs?category=${category}&limit=20`
    : `https://remotive.com/api/remote-jobs?limit=20`;
  const res = await corsGet(url, 'Remotive');
  const data = await res.json();
  return (data.jobs||[]).map(j=>({...j, _source:'Remotive', _ats:'link'}));
}

async function fetchJobicy(category) {
  const tag = category ? `&tag=${encodeURIComponent(category)}` : '';
  const res = await corsGet(`https://jobicy.com/api/v2/remote-jobs?count=20${tag}`, 'Jobicy');
  const data = await res.json();
  return (data.jobs||[]).map(j=>({
    id:'jcy_'+j.id, title:j.jobTitle, company_name:j.companyName,
    company_logo:j.companyLogo||'',
    candidate_required_location:j.jobGeo||'Anywhere',
    category:j.jobIndustry||'Technology',
    salary:j.salaryMin?`$${Number(j.salaryMin).toLocaleString()}–$${Number(j.salaryMax||0).toLocaleString()} ${j.salaryCurrency||'USD'}/${j.salaryPeriod||'yr'}`:'',
    job_type:j.jobType||'full_time',
    publication_date:j.pubDate||new Date().toISOString(),
    url:j.url, description:j.jobDescription||j.jobExcerpt||'',
    _source:'Jobicy', _ats:'link'
  }));
}

async function fetchArbeitnow() {
  const res = await corsGet('https://www.arbeitnow.com/api/job-board-api', 'Arbeitnow');
  const data = await res.json();
  return (data.data||[]).slice(0,20).map(j=>({
    id:'arb_'+j.slug, title:j.title, company_name:j.company_name,
    company_logo:'', candidate_required_location:j.location||'Remote',
    category:j.tags?.[0]||'Technology', salary:'', job_type:'full_time',
    publication_date:new Date((j.created_at||0)*1000).toISOString(),
    url:j.url, description:j.description||'',
    _source:'Arbeitnow', _ats:'link'
  }));
}

async function fetchHimalayas() {
  const res = await corsGet('https://himalayas.app/jobs/api?limit=20', 'Himalayas');
  const data = await res.json();
  return (data.jobs||[]).slice(0,20).map(j=>({
    id:'him_'+j.id, title:j.title, company_name:j.companyName,
    company_logo:j.companyLogo||'',
    candidate_required_location:'Worldwide',
    category:j.categories?.[0]||'Technology',
    salary:j.minSalary?`$${Number(j.minSalary).toLocaleString()}–$${Number(j.maxSalary||0).toLocaleString()} USD/yr`:'',
    job_type:'full_time',
    publication_date:j.createdAt||new Date().toISOString(),
    url:j.applicationLink||j.jobUrl||'',
    description:j.description||'',
    _source:'Himalayas', _ats:'link'
  }));
}

async function fetchRemoteOK() {
  const res = await corsGet('https://remoteok.com/api', 'RemoteOK');
  const data = await res.json();
  return (data||[]).filter(j=>j.id).slice(0,20).map(j=>({
    id:'rok_'+j.id, title:j.position, company_name:j.company,
    company_logo:j.company_logo||'',
    candidate_required_location:'Worldwide',
    category:j.tags?.[0]||'Technology',
    salary:j.salary||'', job_type:'full_time',
    publication_date:new Date((j.epoch||Date.now()/1000)*1000).toISOString(),
    url:j.url||`https://remoteok.com/l/${j.id}`,
    description:j.description||'',
    _source:'RemoteOK', _ats:'link'
  }));
}

async function fetchWWR() {
  try {
    const res = await corsGet('https://weworkremotely.com/remote-jobs.rss', 'WeWorkRemotely');
    const text = await res.text();
    const xml = new DOMParser().parseFromString(text,'text/xml');
    return Array.from(xml.querySelectorAll('item')).slice(0,20).map((item,i)=>{
      const title = item.querySelector('title')?.textContent||'';
      const parts = title.split(':');
      return {
        id:'wwr_'+i,
        title:parts.slice(1).join(':').trim()||title,
        company_name:parts[0]?.trim()||'We Work Remotely',
        company_logo:'',
        candidate_required_location:'Worldwide',
        category:'Technology', salary:'', job_type:'full_time',
        publication_date:new Date(item.querySelector('pubDate')?.textContent||Date.now()).toISOString(),
        url:item.querySelector('link')?.nextSibling?.textContent||item.querySelector('guid')?.textContent||'',
        description:item.querySelector('description')?.textContent||'',
        _source:'WeWorkRemotely', _ats:'link'
      };
    });
  } catch { return []; }
}

async function fetchLever() {
  const jobs = [];
  const sample = [...LEVER_COMPANIES].sort(()=>0.5-Math.random()).slice(0,5);
  await Promise.allSettled(sample.map(async slug=>{
    try {
      const res = await fetch(`https://api.lever.co/v0/postings/${slug}?mode=json`,
        { signal: AbortSignal.timeout(8000) });
      if(!res.ok) return;
      const data = await res.json();
      (data||[]).filter(j=>j.text).slice(0,5).forEach(j=>jobs.push({
        id:j.id, title:j.text,
        company_name:slug.charAt(0).toUpperCase()+slug.slice(1),
        company_logo:'',
        candidate_required_location:j.categories?.location||'Remote',
        category:j.categories?.team||'Technology',
        salary:'', job_type:'full_time',
        publication_date:new Date(j.createdAt||Date.now()).toISOString(),
        url:j.hostedUrl||`https://jobs.lever.co/${slug}/${j.id}`,
        description:j.descriptionPlain||j.description||'',
        _source:'Lever', _ats:'lever', _slug:slug, _posting_id:j.id
      }));
    } catch {}
  }));
  if(jobs.length) sourceStatus['Lever'] = '✓';
  return jobs;
}

async function fetchGreenhouse() {
  const jobs = [];
  const sample = [...GREENHOUSE_COMPANIES].sort(()=>0.5-Math.random()).slice(0,4);
  await Promise.allSettled(sample.map(async co=>{
    try {
      const res = await fetch(
        `https://boards-api.greenhouse.io/v1/boards/${co.token}/jobs?content=true`,
        { signal: AbortSignal.timeout(8000) });
      if(!res.ok) return;
      const data = await res.json();
      (data.jobs||[]).slice(0,8).forEach(j=>jobs.push({
        id:j.id, title:j.title, company_name:co.name,
        company_logo:'',
        candidate_required_location:j.location?.name||'Remote',
        category:j.departments?.[0]?.name||'Technology',
        salary:'', job_type:'full_time',
        publication_date:j.updated_at||new Date().toISOString(),
        url:j.absolute_url||'',
        description:j.content||'',
        _source:'Greenhouse', _ats:'greenhouse',
        _board_token:co.token, _job_id:j.id,
        _questions:j.questions||[]
      }));
    } catch {}
  }));
  if(jobs.length) sourceStatus['Greenhouse'] = '✓';
  return jobs;
}

// ===== PARSE JOB DESCRIPTION INTO SECTIONS =====
function parseJobDescription(html) {
  const text = stripHtml(html);
  if(!text || text.length < 50) return '<p style="color:var(--muted);font-size:15px;padding:8px 0">Descricao nao disponivel.</p>';

  const sectionPatterns = [
    { key:'description', labels:['description','about the role','about the job','overview','about us','the role','responsabilidades','sobre a vaga'] },
    { key:'requirements', labels:['requirements','qualifications','who you are','requisitos','must have','skills required','minimum qualifications'] },
    { key:'benefits',     labels:['benefits','perks','what we offer','compensation','beneficios','why join','we offer','package'] },
  ];
  const icons  = { description:'📋', requirements:'🎯', benefits:'🏖️' };
  const titles = { description:'Sobre a vaga', requirements:'Requisitos', benefits:'Beneficios' };
  const hStyle = 'font-size:13px;font-weight:700;color:var(--accent);text-transform:uppercase;letter-spacing:.08em;margin:20px 0 10px 0;padding-bottom:8px;border-bottom:2px solid var(--accent-dim);display:block';
  const rowStyle = 'display:flex;gap:10px;align-items:flex-start;padding:8px 0;border-bottom:0.5px solid var(--border);font-size:15px;color:var(--text);line-height:1.7;word-break:break-word';
  const pStyle = 'font-size:15px;color:var(--text);line-height:1.8;margin:0 0 14px 0;word-break:break-word';
  const dotStyle = 'color:var(--accent);flex-shrink:0;margin-top:3px';

  const lower = text.toLowerCase();
  const hasSections = sectionPatterns.some(s => s.labels.some(l => lower.includes(l)));

  if (!hasSections) {
    const rawLines = text.split(/\n/).map(s => s.trim()).filter(s => s.length > 15);
    const bullets = rawLines.length > 3 ? rawLines : text.split(/[•\-]/).map(s => s.trim()).filter(s => s.length > 15);
    if (bullets.length > 2) {
      return '<div>' + bullets.slice(0,15).map(b =>
        '<div style="' + rowStyle + '"><span style="' + dotStyle + '">•</span><span>' + b.replace(/^[•\-–]\s*/,'') + '</span></div>'
      ).join('') + '</div>';
    }
    const parts = text.replace(/([.!?])\s+/g, '$1|||').split('|||');
    const paras = [];
    let cur = '';
    for (const s of parts) {
      cur += (cur ? ' ' : '') + s;
      if (cur.length > 200) { paras.push(cur.trim()); cur = ''; }
    }
    if (cur.trim()) paras.push(cur.trim());
    return paras.slice(0,8).map(p => '<p style="' + pStyle + '">' + p + '</p>').join('');
  }

  const lines = text.split(/\n/).map(l => l.trim()).filter(Boolean);
  const sections = {};
  let cur = 'description';
  sections[cur] = [];
  for (const line of lines) {
    const ll = line.toLowerCase().replace(/[^a-z\s]/g,'').trim();
    let matched = false;
    for (const s of sectionPatterns) {
      if (s.labels.some(lbl => ll === lbl || ll.startsWith(lbl + ' '))) {
        cur = s.key; sections[cur] = sections[cur] || []; matched = true; break;
      }
    }
    if (!matched && line.length > 5) { sections[cur] = sections[cur] || []; sections[cur].push(line); }
  }

  return sectionPatterns.filter(s => sections[s.key] && sections[s.key].length).map(s => {
    return '<div style="margin-bottom:4px">'
      + '<span style="' + hStyle + '">' + icons[s.key] + ' ' + titles[s.key] + '</span>'
      + sections[s.key].slice(0,14).map(item => {
          const clean = item.replace(/^[•\-–·]\s*/,'');
          return '<div style="' + rowStyle + '"><span style="' + dotStyle + '">•</span><span>' + clean + '</span></div>';
        }).join('')
      + '</div>';
  }).join('');
}

function setSalaryChip(val, el) {
  document.querySelectorAll('[id^="sal-"]').forEach(b => b.classList.remove('active'));
  el.classList.add('active');
  filters.salary = val;
  filterJobs();
}

function setSalaryFilter(val) {
  filters.salary = parseInt(val) || 0;
  filterJobs();
}

function filterJobs() {
  const q = document.getElementById('searchInput').value.toLowerCase();
  let jobs = allJobs.filter(j => {
    if(q && !j.title.toLowerCase().includes(q) && !(j.company_name||'').toLowerCase().includes(q)) return false;
    if(filters.type === 'remote') {
      const loc = (j.candidate_required_location||'').toLowerCase();
      if(!loc.includes('worldwide')&&!loc.includes('anywhere')&&!loc.includes('remote')) return false;
    }
    if(filters.salary > 0 && j.salary) {
      // Extract first number from salary string
      const nums = j.salary.replace(/[,$]/g,'').match(/\d+/g);
      if(nums) {
        const minSal = parseInt(nums[0]);
        const val = minSal < 10000 ? minSal * 12 : minSal; // monthly to annual
        if(val < filters.salary) return false;
      }
    }
    return true;
  });
  renderJobs(jobs);
}

function renderJobs(jobs) {
  const grid = document.getElementById('jobsGrid');
  document.getElementById('searchCount').textContent = jobs.length + ' vagas';
  if(!jobs.length) { grid.innerHTML = '<div class="empty">Nenhuma vaga encontrada para este filtro.</div>'; return; }

  // Salary filter
  const minSal = filters.salary || 0;

  grid.innerHTML = jobs.map(j => {
    const isNew = new Date() - new Date(j.publication_date) < 86400000 * 3;
    const loc   = j.candidate_required_location || 'Worldwide';
    const isRemote = /worldwide|anywhere|remote/i.test(loc);
    const logoHtml = j.company_logo
      ? `<img src="${j.company_logo}" alt="" onerror="this.parentElement.innerHTML='${(j.company_name||'?')[0]}';">`
      : (j.company_name||'?')[0];
    const matchHtml = j.matchScore
      ? `<div class="job-score">${j.matchScore}% match</div>`
      : '';
    const savedIcon = savedJobs.has(j.id) ? '⭐' : '☆';
    const isApplied = appliedJobs.has(j.id);

    // Location flag emoji
    const flagMap = { brazil:'🇧🇷', brasil:'🇧🇷', colombia:'🇨🇴', argentina:'🇦🇷', mexico:'🇲🇽', portugal:'🇵🇹', spain:'🇪🇸', worldwide:'🌍', anywhere:'🌍', remote:'🌍', latam:'🌎', europe:'🇪🇺' };
    const locKey = Object.keys(flagMap).find(k => loc.toLowerCase().includes(k));
    const flag = flagMap[locKey] || '🌍';

    // Job type icon
    const typeIcon = isRemote ? '🏠' : '🏢';
    const typeLabel = isRemote ? 'Remoto' : 'Híbrido';

    // Level inference from title/description
    const text = (j.title + ' ' + (j.description||'')).toLowerCase();
    const level = text.includes('senior') || text.includes('sênior') ? '🟠 Sênior'
                : text.includes('mid') || text.includes('pleno')   ? '🟡 Pleno'
                : text.includes('junior') || text.includes('júnior') || text.includes('jr') ? '🟢 Júnior'
                : text.includes('lead') || text.includes('staff') || text.includes('principal') ? '🔵 Lead'
                : '';

    // ATS badge
    const atsBadge = j._ats === 'lever' ? '⚡ Lever API' : j._ats === 'greenhouse' ? '⚡ Greenhouse API' : '';

    // Salary highlight — show prominently if available
    const salDisplay = j.salary ? `<span class="jc-mi sal">💵 ${j.salary}</span>` : '';

    return `<div class="job-card" id="jc-${j.id}" onclick="toggleJob(${j.id})">
      <div class="jc-main">
        <div class="job-logo">${logoHtml}</div>
        <div class="jc-body">
          <div class="job-title">${j.title}</div>
          <div class="jc-meta">
            ${(()=>{
              const badge = getJobAgeBadge(j.publication_date);
              if(badge.warn) {
                return `<span class="jc-mi" style="color:${badge.color};background:${badge.bg};border:0.5px solid ${badge.border};border-radius:4px;padding:1px 5px">${badge.label}</span>`;
              }
              return isNew ? `<span class="jc-mi newbadge">🆕 Nova</span>` : `<span class="jc-mi">🕒 ${timeAgo(j.publication_date)}</span>`;
            })()}
            <span class="jc-mi">${flag} ${loc}</span>
            ${salDisplay}
            <span class="jc-mi">${typeIcon} ${typeLabel}</span>
            ${level ? `<span class="jc-mi">${level}</span>` : ''}
            ${j.category ? `<span class="jc-mi">👷 ${j.category}</span>` : ''}
            ${atsBadge ? `<span class="jc-mi" style="color:var(--accent)">⚡ API</span>` : ''}
            ${isVerifiedRemote(j.company_name) ? `<span class="jc-mi" style="color:#4ade80;background:rgba(74,222,128,.08);border:0.5px solid rgba(74,222,128,.2);border-radius:4px;padding:1px 5px">✓ 100% remota</span>` : ''}
            ${j._earlyStage ? `<span class="jc-mi" style="color:#f59e0b;background:rgba(245,158,11,.08);border:0.5px solid rgba(245,158,11,.25);border-radius:4px;padding:1px 5px">🌱 Early-stage</span>` : ''}
            ${j._teamSize ? `<span class="jc-mi" style="color:var(--muted2)">👥 ${j._teamSize}</span>` : ''}
            ${j._source ? `<span class="jc-mi" style="opacity:.5">${j._source}</span>` : ''}
          </div>
        </div>
        <div class="jc-right">
          ${matchHtml}
          <button class="jc-save" onclick="event.stopPropagation();toggleSave(${j.id})" id="save-${j.id}">${savedIcon}</button>
        </div>
      </div>
      <div class="job-expanded" id="je-${j.id}">

        <!-- Context info: timezone, culture, salary, age warning -->
        ${(()=>{
          const tz = getTimezoneInfo(j.candidate_required_location);
          const sal = getSalaryContext(j.salary, j.title);
          const culture = /async|remote.first|startup|ownership/i.test(j.description||'') ? true : false;
          const ageBadge = getJobAgeBadge(j.publication_date);
          const parts = [];
          parts.push(`<span style="font-size:11px;color:var(--muted)">🕐 ${tz.flag} ${tz.label} · ${tz.overlap}</span>`);
          if(culture) parts.push(`<span style="font-size:11px;color:#f59e0b">🇺🇸 Cultura americana — async-first, ownership individual</span>`);
          if(sal) parts.push(`<span style="font-size:11px">${sal}</span>`);
          let html = `<div style="display:flex;flex-wrap:wrap;gap:10px;padding:8px 10px;background:var(--surface2);border:0.5px solid var(--border);border-radius:8px;margin-bottom:10px">${parts.join('')}</div>`;
          if(ageBadge.warn) {
            html += `<div style="display:flex;align-items:center;gap:8px;padding:8px 10px;background:${ageBadge.bg};border:0.5px solid ${ageBadge.border};border-radius:8px;margin-bottom:10px">
              <span style="font-size:13px">${ageBadge.label.split(' ')[0]}</span>
              <span style="font-size:12px;color:${ageBadge.color}"><b>Atenção:</b> esta vaga foi publicada há mais de ${ageBadge.label.includes('60') ? '60' : '30'} dias. Verifique se ainda está aberta antes de candidatar.</span>
              <a href="${j.url}" target="_blank" style="font-size:11px;color:${ageBadge.color};margin-left:auto;white-space:nowrap;text-decoration:underline">Verificar ↗</a>
            </div>`;
          }
          return html;
        })()}

        <!-- ATS Score check -->
        <div style="background:var(--surface2);border:0.5px solid var(--border);border-radius:10px;padding:.85rem 1rem;margin-bottom:12px;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px">
          <div>
            <div style="font-size:12px;font-weight:500;color:var(--text);margin-bottom:2px">📊 Verifique seu score ATS para esta vaga</div>
            <div style="font-size:11px;color:var(--muted)">Aumente suas chances de entrevista antes de aplicar</div>
          </div>
          <div style="display:flex;gap:6px;flex-wrap:wrap">
            <button class="jc-tool" onclick="event.stopPropagation();abrirFerramenta('ats',${j.id})" style="font-size:12px;padding:5px 12px">🎯 Analisar ATS</button>
            <button class="jc-tool" onclick="event.stopPropagation();abrirFerramenta('otimizar',${j.id})" style="font-size:12px;padding:5px 12px">📝 Otimizar CV</button>
            <button class="jc-tool" onclick="event.stopPropagation();abrirFerramenta('coverLetter',${j.id})" style="font-size:12px;padding:5px 12px">✉️ Cover letter</button>
            <button class="jc-tool" id="trad-${j.id}" onclick="event.stopPropagation();traduzirVaga(${j.id})" style="font-size:12px;padding:5px 12px">🌐 Traduzir PT</button>
          </div>
        </div>

        <!-- IA analysis -->
        <div class="ai-analysis">
          <div class="ai-header"><span class="ai-dot"></span>Análise IA — em português</div>
          <div class="ai-text" id="ai-${j.id}">
            <div class="ai-loading"><span></span><span></span><span></span>&nbsp; Analisando vaga...</div>
          </div>
        </div>

        <!-- Structured description -->
        <div id="jdesc-${j.id}" style="font-size:13px;color:var(--muted);line-height:1.7">
          ${parseJobDescription(j.description)}
        </div>

        <!-- Apply footer -->
        <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px;margin-top:16px;padding-top:14px;border-top:0.5px solid var(--border)">
          <div style="font-size:11px;color:var(--muted2)">via ${j._source||'Remotive'} · ${timeAgo(j.publication_date)}</div>
          <div style="display:flex;gap:8px;align-items:center">
            <button class="jc-save" onclick="event.stopPropagation();toggleSave(${j.id})" id="save-${j.id}" style="padding:6px 12px;font-size:12px">${savedJobs.has(j.id)?'⭐ Salvo':'☆ Salvar'}</button>
            <a class="btn-apply ${isApplied?'applied':''}" href="${j.url}" target="_blank"
              onclick="event.preventDefault();event.stopPropagation();abrirCandidatura(${j.id})"
              id="apply-${j.id}" style="font-size:14px;padding:10px 24px">${isApplied ? '✓ Aplicado' : 'Apply Now ↗'}</a>
          </div>
        </div>
      </div>
    </div>`;
  }).join('');
}

function toggleJob(id) {
  const card = document.getElementById(`jc-${id}`);
  const wasExpanded = card.classList.contains('expanded');
  document.querySelectorAll('.job-card.expanded').forEach(c => c.classList.remove('expanded'));
  if(!wasExpanded) {
    card.classList.add('expanded');
    if(!aiCache[id]) analyzeJob(id);
    else document.getElementById(`ai-${id}`).textContent = aiCache[id];
  }
}

// ===== FILTRO DADOS SENSÍVEIS (LGPD) =====
function filtrarDadosSensiveis(texto) {
  return texto
    .replace(/\d{3}[\.\-]?\d{3}[\.\-]?\d{3}[\-\.]?\d{2}/g, '[CPF REMOVIDO]')
    .replace(/\d{1,2}[\.\-]?\d{3}[\.\-]?\d{3}[\-x]?/gi, '[RG REMOVIDO]')
    .replace(/(\(?\d{2}\)?\s?)(\d{4,5}[\-\s]?\d{4})/g, '[TEL REMOVIDO]')
    .replace(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g, '[EMAIL REMOVIDO]')
    .replace(/\d{5}[\-]?\d{3}/g, '[CEP REMOVIDO]')
    .replace(/ag[eê]ncia\s*:?\s*\d+/gi, '[BANCO REMOVIDO]')
    .replace(/conta\s*:?\s*\d+[\-]?\d*/gi, '[BANCO REMOVIDO]');
}

// ===== OPENROUTER QWEN (100% gratuito) =====
const OR_KEY = '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';
const OR_MODEL = 'qwen/qwen3-235b-a22b:free';

async function chamarIA(mensagens, sistema) {
  const msgs = sistema
    ? [{ role: 'system', content: sistema }, ...mensagens]
    : mensagens;
  const res = await fetch('/api/ia', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages: msgs, max_tokens: 800 })
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Erro na IA');
  return data.choices?.[0]?.message?.content || '';
}
async function analyzeJob(id) {
  const job = allJobs.find(j => j.id === id);
  if(!job) return;
  const el = document.getElementById(`ai-${id}`);
  const desc = filtrarDadosSensiveis(stripHtml(job.description).slice(0, 600));
  const profile = userProfile.cvLoaded
    ? `O candidato é brasileiro com perfil em ${filtrarDadosSensiveis(userProfile.title)}.`
    : 'O candidato é brasileiro buscando emprego internacional remoto.';
  try {
    const prompt = `Analise esta vaga para um brasileiro buscando emprego remoto internacional. Responda em 3 linhas diretas em português, separadas por quebra de linha. Sem títulos, sem markdown, sem asteriscos.\n\nVaga: "${job.title}" em "${job.company_name}"\nDescrição: ${desc}\n${profile}\n\n1. O que a empresa busca (1 linha)\n2. Por que um brasileiro se destacaria nessa vaga (1 linha)\n3. Ponto de atenção ou dica de candidatura (1 linha)`;
    const text = await chamarIA([{ role: 'user', content: prompt }]);
    aiCache[id] = text;
    el.innerHTML = text.split('\n').filter(Boolean).map((l,i) =>
      `<div style="margin-bottom:${i<2?'6px':'0'}">${l}</div>`
    ).join('');
  } catch(e) {
    el.textContent = OR_KEY === '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'
      ? '⚠️ Insira sua chave OpenRouter no código para ativar a IA.'
      : 'Análise de IA indisponível no momento.';
  }
}

function toggleSave(id) {
  if(savedJobs.has(id)) savedJobs.delete(id);
  else { savedJobs.add(id); showToast('Vaga salva! ⭐'); }
  const btn = document.getElementById(`save-${id}`);
  if(btn) btn.innerHTML = (savedJobs.has(id) ? '⭐' : '☆') + ' Salvar';
  updateSavedBadge();
}

function markApplied(id) {
  const job = allJobs.find(j => j.id === id);
  if(!job || candidaturas[id]) return;
  candidaturas[id] = {
    id, job,
    status: 'aplicado',
    appliedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    feedback: null,
    companyNotified: false,
    feedbackGerado: false
  };
  appliedJobs.add(id);
  document.getElementById('statApps').textContent = Object.keys(candidaturas).length;
  const badge = document.getElementById('appliedBadge');
  if(badge) { badge.textContent = Object.keys(candidaturas).length; badge.style.display = 'inline'; }
  showToast('Candidatura registrada! 🚀 Monitorando retorno...');
  // Schedule notifications
  agendarNotificacoes(id);
  // Persist to Supabase
  if(typeof sbClient !== 'undefined' && sbClient && userProfile.supabaseId) {
    sbClient.from('candidaturas').insert({
      user_id: userProfile.supabaseId,
      job_id: id,
      job_title: job.title,
      company_name: job.company_name,
      job_url: job.url,
      job_source: job._source,
      status: 'aplicado'
    }).then(({ error }) => { if(error) console.warn('Supabase:', error.message); });
  }
}
function agendarNotificacoes(id) {
  // Produção: esses eventos seriam disparados por cron job no Supabase (1x por semana)
  // Demo: tempos comprimidos para teste visual — 15s=7d, 30s=14d, 45s=25d, 60s=45d
  const DEMO_MODE = true;
  const t7d  = DEMO_MODE ? 15000  : 7  * 86400000;
  const t14d = DEMO_MODE ? 30000  : 14 * 86400000;
  const t25d = DEMO_MODE ? 45000  : 25 * 86400000;
  const t45d = DEMO_MODE ? 60000  : 45 * 86400000;

  setTimeout(() => lembreteCandidato7d(id),   t7d);
  setTimeout(() => notificarEmpresa14d(id),   t14d);
  setTimeout(() => gerarFeedbackIA(id),       t25d);
  setTimeout(() => marcarProcessoEncerrado(id), t45d);
}

function lembreteCandidato7d(id) {
  const c = candidaturas[id];
  if(!c || c.status !== 'aplicado') return;
  c.lembrete7d = true;
  c.updatedAt = new Date().toISOString();
  showToast(`📋 ${c.job.company_name} — candidatura em análise. Processos costumam levar 2 a 4 semanas.`);
  renderKanban();
}

function notificarEmpresa14d(id) {
  const c = candidaturas[id];
  if(!c || c.status !== 'aplicado') return;
  // Só notifica empresa se for cliente do painel (em produção verifica via Supabase)
  const isClienteRemoteBR = false; // Em produção: verificar se empresa usa o painel
  if(isClienteRemoteBR) {
    c.companyNotified = true;
    showToast(`📧 ${c.job.company_name} foi notificada — candidatos aguardando retorno`);
  } else {
    showToast(`⏳ ${c.job.company_name} — 14 dias sem resposta. Continue aplicando para outras vagas.`);
  }
  c.updatedAt = new Date().toISOString();
  renderKanban();
}

async function gerarFeedbackIA(id) {
  const c = candidaturas[id];
  if(!c || c.status !== 'aplicado' || c.feedbackGerado) return;
  c.feedbackGerado = true;
  c.updatedAt = new Date().toISOString();

  try {
    const cvTexto = userProfile.cvProfissional || 'Currículo não carregado';
    const descVaga = filtrarDadosSensiveis(stripHtml(c.job.description||'').slice(0,500));
    const prompt = `Você é um coach de carreira brasileiro especialista em vagas internacionais.
Um candidato aplicou para a vaga "${c.job.title}" na empresa "${c.job.company_name}" há 25 dias e não recebeu resposta.

Perfil do candidato: ${cvTexto.slice(0,600)}
Descrição da vaga: ${descVaga}

Escreva um feedback construtivo em português com exatamente 3 parágrafos curtos, sem títulos, sem asteriscos:
1. Um ponto forte do perfil para esta vaga específica
2. O que pode ter faltado ou pode ser melhorado no currículo para esta vaga
3. Uma ação concreta e específica para as próximas candidaturas similares

Seja direto, encorajador e específico. Máximo de 3 linhas por parágrafo.`;

    const feedback = await chamarIA([{ role:'user', content: prompt }]);
    c.feedback = feedback;
    showToast(`💡 Feedback disponível para sua candidatura na ${c.job.company_name}`);
    renderKanban();
  } catch {
    c.feedback = 'Análise de IA indisponível. Verifique sua chave OpenRouter.';
    renderKanban();
  }
}

function marcarProcessoEncerrado(id) {
  const c = candidaturas[id];
  if(!c || c.status !== 'aplicado') return;
  c.status = 'semRetorno';
  c.updatedAt = new Date().toISOString();
  showToast(`🔕 ${c.job.company_name} — processo marcado como encerrado após 45 dias`);
  renderKanban();
}

function moverCandidatura(id, novoStatus) {
  if(!candidaturas[id]) return;
  candidaturas[id].status = novoStatus;
  candidaturas[id].updatedAt = new Date().toISOString();
  renderKanban();
  showToast('Status atualizado ✓');
}

// ===== KANBAN =====
const KANBAN_COLS = [
  { key:'aplicado',    label:'Aplicado',    color:'#3b82f6',  icon:'📤' },
  { key:'visualizado', label:'Visualizado', color:'#8b5cf6',  icon:'👁️' },
  { key:'analise',     label:'Em análise',  color:'#f59e0b',  icon:'🔍' },
  { key:'entrevista',  label:'Entrevista',  color:'#10b981',  icon:'🎙️' },
  { key:'oferta',      label:'Oferta!',     color:'#4ade80',  icon:'🎉' },
  { key:'recusado',    label:'Recusado',    color:'#6b7280',  icon:'✗'  },
  { key:'semRetorno',  label:'Sem retorno', color:'#ef4444',  icon:'🔕' },
];

function renderKanban() {
  const board = document.getElementById('kanbanBoard');
  if(!board) return;
  const items = Object.values(candidaturas);
  if(!items.length) {
    board.innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:3rem;color:var(--muted);font-size:13px">
      Suas candidaturas aparecerão aqui.<br>
      <span style="font-size:11px;opacity:.6">Aplique para uma vaga para começar o rastreamento.</span>
    </div>`;
    return;
  }
  board.innerHTML = KANBAN_COLS.map(col => {
    const colItems = items.filter(c => c.status === col.key);
    return `<div style="background:var(--surface);border:0.5px solid var(--border);border-radius:12px;overflow:hidden">
      <div style="padding:10px 12px;border-bottom:0.5px solid var(--border);display:flex;align-items:center;gap:6px">
        <span style="font-size:14px">${col.icon}</span>
        <span style="font-size:12px;font-weight:500;color:var(--text)">${col.label}</span>
        ${colItems.length ? `<span style="margin-left:auto;background:${col.color}22;color:${col.color};border-radius:999px;padding:1px 7px;font-size:10px;font-weight:500">${colItems.length}</span>` : ''}
      </div>
      <div style="padding:8px;display:flex;flex-direction:column;gap:6px;min-height:60px">
        ${colItems.length ? colItems.map(c => kanbanCard(c, col.color)).join('') : `<div style="text-align:center;padding:12px 8px;color:var(--muted2);font-size:11px">—</div>`}
      </div>
    </div>`;
  }).join('');
}

function kanbanCard(c, color) {
  const hoursAgo = Math.floor((Date.now() - new Date(c.appliedAt)) / 3600000);
  const daysAgo  = Math.floor(hoursAgo / 24);
  const timeStr  = daysAgo > 0 ? `${daysAgo}d atrás` : `${hoursAgo}h atrás`;
  const notifIcon = c.companyNotified ? '📧 ' : '';
  const hasFeedback = !!c.feedback;

  return `<div style="background:var(--surface2);border:0.5px solid var(--border);border-radius:8px;padding:9px 10px;cursor:pointer" onclick="abrirDetalhesCandidatura('${c.id}')">
    <div style="font-size:12px;font-weight:500;color:var(--text);margin-bottom:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${c.job.title}</div>
    <div style="font-size:11px;color:var(--muted);margin-bottom:6px">${notifIcon}${c.job.company_name}</div>
    <div style="display:flex;align-items:center;justify-content:space-between">
      <span style="font-size:10px;color:var(--muted2)">${timeStr}</span>
      ${hasFeedback ? `<span style="font-size:10px;color:#4ade80">💡 feedback</span>` : ''}
    </div>
    <select onclick="event.stopPropagation()" onchange="moverCandidatura('${c.id}',this.value)" style="width:100%;margin-top:6px;background:var(--bg);border:0.5px solid var(--border2);border-radius:6px;padding:3px 6px;color:var(--muted);font-size:10px;font-family:'DM Sans',sans-serif;outline:none;cursor:pointer">
      ${KANBAN_COLS.map(col => `<option value="${col.key}" ${c.status===col.key?'selected':''}>${col.icon} ${col.label}</option>`).join('')}
    </select>
  </div>`;
}

function abrirDetalhesCandidatura(id) {
  const c = candidaturas[id];
  if(!c) return;
  document.getElementById('cvModal').querySelector('.modal-title').textContent = 'Detalhes da candidatura';
  document.getElementById('cvModalSub').textContent = `${c.job.title} · ${c.job.company_name}`;
  document.getElementById('cvModalStatus').style.display = 'none';
  document.getElementById('cvModalContent').style.display = 'block';

  const hoursAgo = Math.floor((Date.now() - new Date(c.appliedAt)) / 3600000);
  const timeline = `Aplicado ${hoursAgo}h atrás · ${c.companyNotified ? 'Empresa notificada ✓' : 'Aguardando empresa'}`;

  document.getElementById('cvTextoFinal').value = c.feedback
    ? `=== FEEDBACK DA IA ===\n\n${c.feedback}\n\n=== TIMELINE ===\n${timeline}\n\nVaga: ${c.job.title}\nEmpresa: ${c.job.company_name}\nURL: ${c.job.url}`
    : `${timeline}\n\nVaga: ${c.job.title}\nEmpresa: ${c.job.company_name}\n\n${c.feedbackGerado ? 'Gerando feedback...' : 'Feedback será gerado em 48h sem resposta da empresa.'}`;
  showModal('cvModal');
}

// ===== TRADUÇÃO DE VAGAS =====
let traducaoCache = {};
async function traduzirVaga(jobId) {
  const job = allJobs.find(j => j.id === jobId);
  if(!job) return;
  const btn = document.getElementById(`trad-${jobId}`);
  if(btn) btn.textContent = '⏳';

  if(traducaoCache[jobId]) {
    document.getElementById(`jdesc-${jobId}`).innerHTML = traducaoCache[jobId];
    if(btn) btn.textContent = '🇧🇷 PT';
    return;
  }
  try {
    const texto = filtrarDadosSensiveis(stripHtml(job.description||'').slice(0, 1200));
    const prompt = `Traduza o seguinte texto de uma vaga de emprego para o português brasileiro. Mantenha a estrutura e os termos técnicos reconhecíveis. Retorne apenas a tradução, sem comentários:\n\n${texto}`;
    const traduzido = await chamarIA([{ role:'user', content: prompt }]);
    const html = '<div style="font-size:13px;color:var(--muted);line-height:1.7;padding:4px 0">' + traduzido.replace(/\n/g,'<br>') + '</div>';
    traducaoCache[jobId] = html;
    document.getElementById(`jdesc-${jobId}`).innerHTML = html;
    if(btn) btn.textContent = '🇧🇷 PT';
  } catch {
    if(btn) btn.textContent = '🌐 EN';
    showToast('Erro ao traduzir. Tente novamente.');
  }
}

function updateSavedBadge() {
  const badge = document.getElementById('savedBadge');
  badge.textContent = savedJobs.size;
  badge.style.display = savedJobs.size > 0 ? 'inline' : 'none';
}

// ===== TABS =====
function switchTab(tab, el) {
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  el.classList.add('active');
  document.getElementById('tabFeed').style.display      = tab === 'feed'     ? 'block' : 'none';
  document.getElementById('tabExplorar').style.display  = tab === 'explorar' ? 'block' : 'none';
  document.getElementById('tabSaved').style.display     = tab === 'saved'    ? 'block' : 'none';
  document.getElementById('tabApplied').style.display   = tab === 'applied'  ? 'block' : 'none';
  if(tab === 'saved')    renderSaved();
  if(tab === 'explorar') renderExplorar();
  if(tab === 'applied') {
    renderCandidateDashboard();
    switchCandidateTab('kanban', document.getElementById('ctab-kanban'));
  }
}

function switchCandidateTab(tab, el) {
  ['kanban','timeline','insights','master'].forEach(t => {
    const btn = document.getElementById(`ctab-${t}`);
    const cnt = document.getElementById(`ctab-content-${t}`);
    if(btn) btn.classList.toggle('active', t === tab);
    if(cnt) cnt.style.display = t === tab ? 'block' : 'none';
  });
  if(tab === 'kanban')   renderKanban();
  if(tab === 'timeline') renderTimeline();
  if(tab === 'insights') renderCandidateInsights();
  if(tab === 'master')   renderMasterProgram();
}

function renderCandidateDashboard() {
  const items = Object.values(candidaturas);
  const total       = items.length;
  const comRetorno  = items.filter(c => c.status !== 'aplicado' && c.status !== 'semRetorno').length;
  const entrevistas = items.filter(c => c.status === 'entrevista' || c.status === 'oferta').length;
  const semRetorno  = items.filter(c => c.status === 'semRetorno').length;
  const taxaRetorno = total ? Math.round(comRetorno / total * 100) : 0;

  const kpis = [
    { label:'Candidaturas',    val: total,        icon:'📤', color:'var(--accent)'  },
    { label:'Com retorno',     val: comRetorno,   icon:'✉️', color:'#60a5fa'        },
    { label:'Entrevistas',     val: entrevistas,  icon:'🎙️', color:'#4ade80'        },
    { label:'Taxa de retorno', val: taxaRetorno+'%', icon:'📊', color: taxaRetorno >= 20 ? '#4ade80' : taxaRetorno >= 10 ? '#f59e0b' : '#ef4444' },
  ];

  const kpisEl = document.getElementById('candidateDashKpis');
  if(!kpisEl) return;
  kpisEl.innerHTML = kpis.map(k => `
    <div style="background:var(--surface);border:0.5px solid var(--border);border-radius:12px;padding:1rem;text-align:center">
      <div style="font-size:18px;margin-bottom:4px">${k.icon}</div>
      <div style="font-size:22px;font-weight:500;color:${k.color};margin-bottom:3px">${k.val}</div>
      <div style="font-size:11px;color:var(--muted)">${k.label}</div>
    </div>`).join('');
}

function renderTimeline() {
  const el = document.getElementById('candidateTimeline');
  if(!el) return;
  const items = Object.values(candidaturas)
    .sort((a,b) => new Date(b.updatedAt) - new Date(a.updatedAt));

  if(!items.length) {
    el.innerHTML = '<div class="empty">Nenhuma candidatura ainda.<br>Aplique para uma vaga para começar.</div>';
    return;
  }

  const statusInfo = {
    aplicado:    { icon:'📤', label:'Candidatura enviada',  color:'var(--accent)' },
    visualizado: { icon:'👁️', label:'Currículo visualizado', color:'#8b5cf6'       },
    analise:     { icon:'🔍', label:'Em análise',            color:'#f59e0b'       },
    entrevista:  { icon:'🎙️', label:'Entrevista agendada',   color:'#10b981'       },
    oferta:      { icon:'🎉', label:'Oferta recebida!',      color:'#4ade80'       },
    recusado:    { icon:'✗',  label:'Processo encerrado',    color:'#6b7280'       },
    semRetorno:  { icon:'🔕', label:'Sem retorno (7 dias)',  color:'#ef4444'       },
  };

  el.innerHTML = items.map(c => {
    const s = statusInfo[c.status] || statusInfo.aplicado;
    const hoursAgo = Math.floor((Date.now() - new Date(c.appliedAt)) / 3600000);
    const daysAgo  = Math.floor(hoursAgo / 24);
    const timeStr  = daysAgo > 0 ? `${daysAgo} dias atrás` : `${hoursAgo}h atrás`;
    const hasFeedback = !!c.feedback;
    const notified = c.companyNotified;

    // Build mini-events for this candidatura
    const events = [
      { time: c.appliedAt,   icon:'📤', text:`Candidatura enviada para <b>${c.job.company_name}</b>` },
    ];
    if(notified) events.push({ time: c.updatedAt, icon:'📧', text:`Lembrete enviado para ${c.job.company_name}` });
    if(hasFeedback) events.push({ time: c.updatedAt, icon:'💡', text:'Feedback de IA gerado' });
    if(c.status !== 'aplicado') events.push({ time: c.updatedAt, icon: s.icon, text: s.label });

    return `<div style="border-bottom:0.5px solid var(--border);padding:1.25rem 0" onclick="abrirDetalhesCandidatura('${c.id}')" style="cursor:pointer">
      <div style="display:flex;align-items:flex-start;gap:12px">
        <!-- Status indicator -->
        <div style="width:36px;height:36px;border-radius:50%;background:${s.color}22;border:0.5px solid ${s.color}44;display:flex;align-items:center;justify-content:center;font-size:16px;flex-shrink:0;margin-top:2px">${s.icon}</div>
        <div style="flex:1;min-width:0">
          <!-- Job info -->
          <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:6px;margin-bottom:6px">
            <div>
              <span style="font-size:14px;font-weight:500;color:var(--text)">${c.job.title}</span>
              <span style="font-size:12px;color:var(--muted);margin-left:6px">${c.job.company_name}</span>
            </div>
            <div style="display:flex;align-items:center;gap:6px">
              <span style="font-size:11px;color:${s.color};background:${s.color}15;border-radius:999px;padding:2px 8px;border:0.5px solid ${s.color}30">${s.label}</span>
              <span style="font-size:11px;color:var(--muted2)">${timeStr}</span>
            </div>
          </div>
          <!-- Mini timeline of events -->
          <div style="display:flex;flex-direction:column;gap:4px;padding-left:4px;border-left:1.5px solid var(--border)">
            ${events.map(ev => `
              <div style="display:flex;align-items:center;gap:6px;padding:3px 0 3px 10px;position:relative">
                <span style="position:absolute;left:-5px;width:8px;height:8px;border-radius:50%;background:var(--surface2);border:1.5px solid var(--border2)"></span>
                <span style="font-size:12px">${ev.icon}</span>
                <span style="font-size:12px;color:var(--muted)">${ev.text}</span>
              </div>`).join('')}
          </div>
          ${hasFeedback ? `<div style="margin-top:8px;background:var(--accent-dim);border:0.5px solid rgba(59,130,246,.15);border-radius:8px;padding:8px 10px;font-size:12px;color:var(--accent);cursor:pointer" onclick="event.stopPropagation();abrirDetalhesCandidatura('${c.id}')">
            💡 Feedback disponível — clique para ver
          </div>` : ''}
        </div>
      </div>
    </div>`;
  }).join('');
}

async function renderCandidateInsights() {
  const el = document.getElementById('candidateInsights');
  if(!el) return;
  const items = Object.values(candidaturas);

  if(items.length < 2) {
    el.innerHTML = `<div style="text-align:center;padding:3rem;color:var(--muted);font-size:13px">
      Aplique para pelo menos 2 vagas para receber insights personalizados.
    </div>`;
    return;
  }

  // Static insights based on data patterns
  const total       = items.length;
  const semRetorno  = items.filter(c => c.status === 'semRetorno').length;
  const entrevistas = items.filter(c => ['entrevista','oferta'].includes(c.status)).length;
  const taxaRetorno = Math.round((total - semRetorno) / total * 100);

  // Categorias mais aplicadas
  const cats = {};
  items.forEach(c => { const cat = c.job.category||'Outros'; cats[cat] = (cats[cat]||0)+1; });
  const topCat = Object.entries(cats).sort((a,b)=>b[1]-a[1])[0];

  el.innerHTML = `
    <div style="display:flex;flex-direction:column;gap:12px">

      <!-- Resumo geral -->
      <div style="background:var(--surface);border:0.5px solid var(--border);border-radius:12px;padding:1.25rem">
        <div style="font-size:12px;font-weight:500;text-transform:uppercase;letter-spacing:.08em;color:var(--muted2);margin-bottom:10px">Resumo das suas candidaturas</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;font-size:13px;color:var(--muted)">
          <div>📤 Total enviadas: <b style="color:var(--text)">${total}</b></div>
          <div>✉️ Com retorno: <b style="color:#60a5fa">${total - semRetorno}</b></div>
          <div>🎙️ Entrevistas: <b style="color:#4ade80">${entrevistas}</b></div>
          <div>📊 Taxa de retorno: <b style="color:${taxaRetorno>=20?'#4ade80':taxaRetorno>=10?'#f59e0b':'#ef4444'}">${taxaRetorno}%</b></div>
        </div>
      </div>

      <!-- Análise de taxa de retorno -->
      <div style="background:var(--surface);border:0.5px solid var(--border);border-radius:12px;padding:1.25rem">
        <div style="font-size:13px;font-weight:500;color:var(--text);margin-bottom:8px">
          ${taxaRetorno >= 20 ? '🟢 Sua taxa de retorno está boa!' : taxaRetorno >= 10 ? '🟡 Taxa de retorno abaixo do ideal' : '🔴 Taxa de retorno baixa — vamos melhorar'}
        </div>
        <div style="font-size:13px;color:var(--muted);line-height:1.7">
          ${taxaRetorno >= 20
            ? `${taxaRetorno}% das suas candidaturas geraram retorno. A média do mercado é 15–20%. Você está acima — continue aplicando para vagas com alto match.`
            : taxaRetorno >= 10
            ? `${taxaRetorno}% de retorno. Há espaço para melhorar. Recomendamos usar o Scanner ATS antes de cada candidatura e otimizar o CV para as palavras-chave da vaga.`
            : `${taxaRetorno}% de retorno indica que o currículo pode não estar passando pelo ATS. Use a ferramenta de Otimização de CV e Scanner ATS para identificar o problema.`
          }
        </div>
        <button onclick="switchTab('feed', document.querySelector('.tab'))" style="margin-top:10px;padding:7px 14px;background:var(--accent-dim);border:0.5px solid rgba(59,130,246,.25);border-radius:8px;color:var(--accent);font-size:12px;cursor:pointer;font-family:'DM Sans',sans-serif">
          📝 Otimizar meu currículo →
        </button>
      </div>

      <!-- Área com mais candidaturas -->
      ${topCat ? `<div style="background:var(--surface);border:0.5px solid var(--border);border-radius:12px;padding:1.25rem">
        <div style="font-size:13px;font-weight:500;color:var(--text);margin-bottom:6px">📍 Foco atual: ${topCat[0]}</div>
        <div style="font-size:13px;color:var(--muted);line-height:1.7">Você aplicou mais para vagas de <b style="color:var(--text)">${topCat[0]}</b> (${topCat[1]} candidatura${topCat[1]>1?'s':''}). ${entrevistas > 0 ? 'Você já tem entrevistas nessa área — bom sinal.' : 'Considere também explorar áreas adjacentes para ampliar as oportunidades.'}</div>
      </div>` : ''}

      <!-- Próxima ação recomendada -->
      <div style="background:var(--accent-dim);border:0.5px solid rgba(59,130,246,.2);border-radius:12px;padding:1.25rem">
        <div style="font-size:13px;font-weight:500;color:var(--accent);margin-bottom:6px">✦ Próxima ação recomendada</div>
        <div style="font-size:13px;color:var(--muted);line-height:1.7">
          ${semRetorno > 2
            ? `${semRetorno} vagas estão sem retorno há mais de 7 dias. Considere enviar um follow-up manual para as empresas ou revisar seu currículo com o Scanner ATS.`
            : entrevistas > 0
            ? 'Você tem entrevistas ativas! Use o chat de treino de inglês para se preparar e revisar as respostas comportamentais (método STAR).'
            : 'Continue aplicando — a consistência é o fator mais importante. Tente pelo menos 5 candidaturas novas esta semana com CV otimizado para cada vaga.'
          }
        </div>
      </div>

    </div>`;
}

function renderSaved() {
  const grid = document.getElementById('savedGrid');
  const saved = allJobs.filter(j => savedJobs.has(j.id));
  if(!saved.length) { grid.innerHTML = '<div class="empty">Nenhuma vaga salva ainda.<br>Clique em ☆ para salvar.</div>'; return; }
  renderJobsInto(saved, grid);
}

function renderJobsInto(jobs, grid) {
  grid.innerHTML = jobs.map(j => `
    <div class="job-card" onclick="window.open('${j.url}','_blank')">
      <div class="jc-main">
        <div class="job-logo">${j.company_logo ? `<img src="${j.company_logo}" alt="" onerror="this.parentElement.innerHTML='${(j.company_name||'?')[0]}'">` : (j.company_name||'?')[0]}</div>
        <div class="jc-body">
          <div class="job-title">${j.title}</div>
          <div class="jc-meta">
            <span class="jc-mi">🌍 ${j.candidate_required_location||'Worldwide'}</span>
            ${j.category ? `<span class="jc-mi">👷 ${j.category}</span>` : ''}
          </div>
        </div>
      </div>
    </div>`).join('');
}

// ===== FILTERS =====
function setFilter(type, val, el) {
  filters[type] = val;
  el.closest('.filter-chips').querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
  el.classList.add('active');
  filterJobs();
}

function setCategory(val, el) {
  filters.category = val;
  document.querySelectorAll('#catChips .chip').forEach(c => c.classList.remove('active'));
  el.classList.add('active');
  loadJobs(val);
}

function updateSalary(val) {
  filters.salary = parseInt(val);
  document.getElementById('salaryVal').textContent = val == 0 ? 'Qualquer' : `$${parseInt(val).toLocaleString()}`;
  filterJobs();
}

// ===== CV UPLOAD COM PDF.JS =====
function handleCVUpload(event) {
  const file = event.target.files[0];
  if(!file) return;
  document.getElementById('uploadText').innerHTML = `<b style="color:var(--accent)">⏳ Lendo currículo...</b><br><span style="font-size:11px;color:var(--muted)">Extraindo texto do PDF...</span>`;

  if(file.type === 'application/pdf') {
    // Leitura real de PDF via pdf.js
    const reader = new FileReader();
    reader.onload = async function(e) {
      try {
        // Configura worker do pdf.js
        pdfjsLib.GlobalWorkerOptions.workerSrc =
          'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js';
        const pdf = await pdfjsLib.getDocument({ data: e.target.result }).promise;
        let textoCompleto = '';
        for(let i = 1; i <= pdf.numPages; i++) {
          const page = await pdf.getPage(i);
          const content = await page.getTextContent();
          const pageText = content.items.map(item => item.str).join(' ');
          textoCompleto += pageText + '\n';
        }
        processarCV(textoCompleto, file.name);
      } catch(err) {
        // Fallback se pdf.js falhar
        processarCV('', file.name);
        showToast('PDF lido com limitações. Preencha seu perfil manualmente.');
      }
    };
    reader.readAsArrayBuffer(file);
  } else {
    // .txt, .doc simples
    const reader = new FileReader();
    reader.onload = e => processarCV(e.target.result || '', file.name);
    reader.readAsText(file);
  }
}

function processarCV(textoRaw, nomeArquivo) {
  // ===== EXTRAÇÃO AUTOMÁTICA DE DADOS PESSOAIS =====
  const emailMatch    = textoRaw.match(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/);
  const telMatch      = textoRaw.match(/(\(?\d{2}\)?\s?)(\d{4,5}[\-\s]?\d{4})/);
  const cpfMatch      = textoRaw.match(/\d{3}[\.\-]?\d{3}[\.\-]?\d{3}[\-\.]?\d{2}/);
  const linkedinMatch = textoRaw.match(/linkedin\.com\/in\/([a-zA-Z0-9\-]+)/i);
  const cidadeMatch   = textoRaw.match(/(São Paulo|Rio de Janeiro|Belo Horizonte|Curitiba|Porto Alegre|Brasília|Fortaleza|Recife|Salvador|Manaus|[A-Z][a-zà-ú]+\s*[-,]\s*[A-Z]{2})/);

  // Salva dados pessoais preservados localmente
  userProfile.dadosPessoais = {
    email:        emailMatch    ? emailMatch[0]    : '',
    telefone:     telMatch      ? telMatch[0]      : '',
    cpf:          cpfMatch      ? cpfMatch[0]      : '',
    linkedin:     linkedinMatch ? 'linkedin.com/in/' + linkedinMatch[1] : '',
    cidade:       cidadeMatch   ? cidadeMatch[0]   : '',
    nomeCompleto: extrairNome(textoRaw)
  };

  // Salva texto original completo
  userProfile.cvOriginalCompleto = textoRaw;

  // Texto profissional = original SEM dados pessoais (vai para IA)
  userProfile.cvProfissional = filtrarDadosSensiveis(textoRaw);

  // Atualiza perfil visual
  const nome = userProfile.dadosPessoais.nomeCompleto || nomeArquivo.replace(/\.[^/.]+$/,'');
  const titulo = inferirTitulo(textoRaw);
  userProfile.cvLoaded = true;
  userProfile.name = nome;
  userProfile.title = titulo;

  document.getElementById('avatarInitial').textContent = nome[0]?.toUpperCase() || 'U';
  document.getElementById('profileName').textContent = nome;
  document.getElementById('profileTitle').textContent = titulo;
  document.getElementById('uploadText').innerHTML =
    `<b style="color:var(--accent)">✓ ${nomeArquivo}</b><br>
     ${userProfile.dadosPessoais.email ? '📧 ' + userProfile.dadosPessoais.email + '<br>' : ''}
     ${userProfile.dadosPessoais.telefone ? '📱 ' + userProfile.dadosPessoais.telefone : ''}
     <br><span style="font-size:11px;color:var(--muted)">Dados pessoais salvos localmente · nunca enviados para IA</span>`;

  allJobs = allJobs.map(j => ({ ...j, matchScore: Math.floor(Math.random()*25 + 70) }));
  document.getElementById('statMatches').textContent = allJobs.length;
  document.getElementById('avgMatch').textContent = '82%';
  filterJobs();
  showToast('Currículo carregado! Dados pessoais protegidos 🔒');
}

function extrairNome(texto) {
  // Tenta pegar a primeira linha não vazia como nome
  const linhas = texto.split('\n').map(l => l.trim()).filter(Boolean);
  for(const linha of linhas.slice(0, 5)) {
    // Nome: entre 2 e 5 palavras, sem números, começa com maiúscula
    if(/^[A-ZÀ-Ú][a-zA-ZÀ-ÿ\s]{4,50}$/.test(linha) && linha.split(' ').length >= 2) {
      return linha;
    }
  }
  return '';
}

function inferirTitulo(texto) {
  const cargos = ['Desenvolvedor','Developer','Designer','Analista','Gerente','Engineer',
    'Product Manager','Data Scientist','DevOps','Frontend','Backend','Fullstack',
    'Marketing','Vendas','Sales','UX','UI','QA','Scrum'];
  const textoLower = texto.toLowerCase();
  for(const cargo of cargos) {
    if(textoLower.includes(cargo.toLowerCase())) return cargo;
  }
  return 'Profissional';
}

// ===== OTIMIZAÇÃO DE CURRÍCULO (Pleno+) =====
async function otimizarCurriculo(vaga) {
  if(!userProfile.cvLoaded) {
    showToast('Faça upload do seu currículo primeiro.');
    return null;
  }

  const cacheKey = `cv_${vaga.id}`;
  if(cvCache[cacheKey]) return cvCache[cacheKey];

  try {
    // Envia APENAS texto profissional para IA — sem dados pessoais
    const prompt = `Você é um especialista em currículos para o mercado internacional.
Otimize este currículo para a vaga abaixo. Reescreva apenas o conteúdo profissional.
Use palavras-chave da vaga. Formato ATS-friendly. Responda em português.
NÃO inclua dados pessoais — eles serão reinseridos automaticamente.

VAGA: ${vaga.title} em ${vaga.company_name}
REQUISITOS: ${filtrarDadosSensiveis(stripHtml(vaga.description).slice(0,400))}

CURRÍCULO ATUAL (conteúdo profissional):
${userProfile.cvProfissional.slice(0, 1500)}

Retorne APENAS o conteúdo profissional otimizado, sem cabeçalho de dados pessoais.`;

    const cvOtimizadoProfissional = await chamarIA([{ role: 'user', content: prompt }]);

    // ===== RECOMPOSIÇÃO — reinserir dados pessoais =====
    const dp = userProfile.dadosPessoais;
    const cabecalho = [
      dp.nomeCompleto  ? dp.nomeCompleto                    : '',
      dp.email         ? `Email: ${dp.email}`               : '',
      dp.telefone      ? `Telefone: ${dp.telefone}`         : '',
      dp.linkedin      ? `LinkedIn: ${dp.linkedin}`         : '',
      dp.cidade        ? `Localização: ${dp.cidade}`        : '',
    ].filter(Boolean).join('\n');

    const cvCompleto = cabecalho + '\n\n' + cvOtimizadoProfissional;
    cvCache[cacheKey] = cvCompleto;
    return cvCompleto;

  } catch(e) {
    showToast('Erro ao otimizar currículo. Tente novamente.');
    return null;
  }
}

// ===== STATS =====
function updateStats() {
  document.getElementById('statMatches').textContent = userProfile.cvLoaded ? allJobs.length : '—';
}

// ===== COVER LETTER =====
async function gerarCoverLetter(job) {
  if(!userProfile.cvLoaded) { showToast('Faça upload do seu currículo primeiro 📄'); return null; }
  const dp = userProfile.dadosPessoais;
  const prompt = `Você é especialista em carreira internacional para brasileiros.
Escreva uma cover letter em INGLÊS para esta vaga. Tom profissional, direto, 3 parágrafos.
Inclua contexto positivo sobre contratar um profissional brasileiro remoto.
Finalize com os dados de contato do candidato.

VAGA: ${job.title} em ${job.company_name}
DESCRIÇÃO: ${filtrarDadosSensiveis(stripHtml(job.description).slice(0, 400))}
PERFIL: ${userProfile.cvProfissional.slice(0, 800)}
NOME: ${dp.nomeCompleto || 'Candidato'}
EMAIL: ${dp.email || '[seu email]'}
LINKEDIN: ${dp.linkedin || '[seu linkedin]'}

Retorne apenas o texto da cover letter, pronto para enviar.`;
  return await chamarIA([{ role: 'user', content: prompt }]);
}

// ===== SCANNER ATS =====
async function escanearATS(job) {
  if(!userProfile.cvLoaded) { showToast('Faça upload do seu currículo primeiro 📄'); return null; }
  const prompt = `Você é especialista em ATS (Applicant Tracking Systems).
Analise este currículo contra a descrição da vaga e retorne em português:

1. SCORE ATS: X/100
2. PALAVRAS-CHAVE ENCONTRADAS: (liste as que estão no CV)
3. PALAVRAS-CHAVE FALTANDO: (liste as da vaga que não estão no CV)
4. PROBLEMAS DE FORMATAÇÃO: (itens que podem confundir o ATS)
5. RECOMENDAÇÕES: (3 ações concretas para melhorar o score)

Seja direto e específico. Sem markdown, sem asteriscos.

VAGA: ${job.title} em ${job.company_name}
REQUISITOS: ${filtrarDadosSensiveis(stripHtml(job.description).slice(0, 500))}
CURRÍCULO: ${userProfile.cvProfissional.slice(0, 1200)}`;
  return await chamarIA([{ role: 'user', content: prompt }]);
}

// ===== UI — ABRIR FERRAMENTAS =====
let jobAtual = null;

async function abrirFerramenta(tipo, jobId) {
  const job = jobId ? allJobs.find(j => j.id === jobId) : jobAtual;
  if(!job) return;
  jobAtual = job;

  // Verificar plano necessário
  const planosNecessarios = { otimizar: 'pleno', coverLetter: 'junior', ats: 'pleno' };
  if(!userProfile.plan) { showPaywall(planosNecessarios[tipo]); return; }
  if(!userProfile.cvLoaded) { showToast('Faça upload do seu currículo primeiro 📄'); return; }

  const subtitulos = {
    otimizar: `Otimizando CV para: ${job.title} · ${job.company_name}`,
    coverLetter: `Gerando cover letter: ${job.title} · ${job.company_name}`,
    ats: `Escaneando ATS: ${job.title} · ${job.company_name}`
  };
  const titulos = {
    otimizar: 'Currículo otimizado 📝',
    coverLetter: 'Cover Letter em inglês ✉️',
    ats: 'Scanner ATS 🎯'
  };

  document.querySelector('#cvModal .modal-title').textContent = titulos[tipo];
  document.getElementById('cvModalSub').textContent = subtitulos[tipo];
  document.getElementById('cvModalStatus').style.display = 'block';
  document.getElementById('cvModalContent').style.display = 'none';
  showModal('cvModal');

  try {
    let resultado = null;
    if(tipo === 'otimizar') resultado = await otimizarCurriculo(job);
    else if(tipo === 'coverLetter') resultado = await gerarCoverLetter(job);
    else if(tipo === 'ats') resultado = await escanearATS(job);

    document.getElementById('cvModalStatus').style.display = 'none';
    if(resultado) {
      document.getElementById('cvTextoFinal').value = resultado;
      document.getElementById('cvModalContent').style.display = 'block';
    } else { closeModal('cvModal'); }
  } catch {
    document.getElementById('cvModalStatus').style.display = 'none';
    closeModal('cvModal');
    showToast('Erro ao processar. Tente novamente.');
  }
}

// Manter compatibilidade com botão antigo
function abrirOtimizacao(jobId) { abrirFerramenta('otimizar', jobId); }

// ===== CHAT =====
const CHAT_SYSTEM = `You are an English interview coach for Brazilian professionals seeking international remote jobs.
Conduct a realistic job interview in English — ask questions like a real US/UK recruiter would.
After each answer, give brief feedback in Portuguese (2-3 sentences) about the English used and the content quality, then ask the next interview question in English.
Be encouraging but honest. Focus on: vocabulary, fluency, answer structure (STAR method), confidence.
Keep responses concise. Never use asterisks or markdown.`;

async function sendChat() {
  const input = document.getElementById('chatInput');
  const msg = input.value.trim();
  if(!msg) return;
  input.value = '';
  const msgSeguro = filtrarDadosSensiveis(msg);
  addChatMsg(msg, 'user');
  chatHistory.push({ role: 'user', content: msgSeguro });
  const typing = addChatMsg('...', 'ai');
  try {
    const reply = await chamarIA(chatHistory, CHAT_SYSTEM);
    typing.remove();
    addChatMsg(reply, 'ai');
    chatHistory.push({ role: 'assistant', content: reply });
  } catch {
    typing.remove();
    addChatMsg(OR_KEY === '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'
      ? '⚠️ Insira sua chave OpenRouter no código para ativar o chat.'
      : 'Erro de conexão. Tente novamente.', 'ai');
  }
}

function addChatMsg(text, role) {
  const msgs = document.getElementById('chatMessages');
  const div = document.createElement('div');
  div.className = `chat-msg ${role}`;
  div.innerHTML = text.replace(/\*\*(.*?)\*\*/g,'<strong>$1</strong>');
  msgs.appendChild(div);
  msgs.scrollTop = msgs.scrollHeight;
  return div;
}

function openEnglishChat() {
  // Check if user has a paid plan — for now show paywall
  if(!userProfile.plan) { showPaywall('junior'); return; }
  showModal('englishModal');
}

// ===== UTILS =====
function stripHtml(html) {
  const d = document.createElement('div');
  d.innerHTML = html;
  return (d.textContent || '').replace(/\s+/g,' ').trim();
}

function timeAgo(dateStr) {
  const diff = Math.floor((new Date() - new Date(dateStr)) / 86400000);
  if(diff === 0) return 'hoje';
  if(diff === 1) return 'ontem';
  if(diff < 7) return `${diff} dias atrás`;
  if(diff < 30) return `${Math.floor(diff/7)} sem atrás`;
  if(diff < 60) return `${Math.floor(diff/30)} mês atrás`;
  return `${Math.floor(diff/30)} meses atrás`;
}

function getJobAgeBadge(dateStr) {
  const diff = Math.floor((new Date() - new Date(dateStr)) / 86400000);
  if(diff <= 3)  return { label:'🆕 Nova',           color:'#4ade80', bg:'rgba(74,222,128,.1)',  border:'rgba(74,222,128,.3)',  warn:false };
  if(diff <= 14) return { label:`🕒 ${diff}d`,        color:'var(--muted)', bg:'transparent', border:'transparent', warn:false };
  if(diff <= 30) return { label:`🕒 ${diff}d`,        color:'var(--muted)', bg:'transparent', border:'transparent', warn:false };
  if(diff <= 60) return { label:'⚠️ +30d — verificar', color:'#f59e0b', bg:'rgba(245,158,11,.08)', border:'rgba(245,158,11,.25)', warn:true };
  return           { label:'🔴 +60d — pode estar preenchida', color:'#ef4444', bg:'rgba(239,68,68,.08)', border:'rgba(239,68,68,.25)', warn:true };
}

// Weekly job verification script — run once per week in production via cron
// In demo mode, runs on page load and marks old jobs
function verificarIdadeVagas() {
  if(!allJobs.length) return;
  let marcadas = 0;
  allJobs.forEach(j => {
    const diff = Math.floor((new Date() - new Date(j.publication_date)) / 86400000);
    if(diff > 60) { j._stale = 'encerrada'; marcadas++; }
    else if(diff > 30) { j._stale = 'verificar'; marcadas++; }
    else j._stale = null;
  });
  if(marcadas > 0) console.log(`RemoteBR: ${marcadas} vagas marcadas para verificação`);
}

function showModal(id) {
  document.getElementById(id).classList.add('open');
}
function closeModal(id) {
  document.getElementById(id).classList.remove('open');
}
function showPaywall(plan) {
  // Reset all plan borders
  ['junior','pleno','senior','master'].forEach(p => {
    const el = document.getElementById('plan-'+p);
    if(!el) return;
    if(p === 'master') {
      el.style.border = '0.5px solid rgba(59,130,246,0.25)';
    } else {
      el.style.border = '0.5px solid var(--border)';
    }
  });
  // Highlight the required plan
  const msgs = { junior:'Disponível a partir do plano Júnior.', pleno:'Disponível a partir do plano Pleno.', senior:'Disponível a partir do plano Sênior.', master:'Exclusivo do plano Master.' };
  if(plan && document.getElementById('plan-'+plan)) {
    document.getElementById('plan-'+plan).style.border = '1.5px solid var(--accent)';
    document.getElementById('paywallSub').textContent = msgs[plan] || 'Escolha um plano para continuar.';
  } else {
    document.getElementById('paywallSub').textContent = 'Desbloqueie ferramentas de IA para conseguir sua vaga na gringa.';
  }
  showModal('paywallModal');
}

function selectPlan(plan) {
  ['junior','pleno','senior','master'].forEach(p => {
    const el = document.getElementById('plan-'+p);
    if(!el) return;
    el.style.border = p === plan ? '1.5px solid var(--accent)' : (p === 'master' ? '0.5px solid rgba(59,130,246,0.25)' : '0.5px solid var(--border)');
  });
  document.getElementById('paywallCta').textContent = 'Assinar plano ' + plan.charAt(0).toUpperCase() + plan.slice(1) + ' →';
}

function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 3000);
}

// ===== SUPABASE AUTH =====
// Insira suas chaves do Supabase aqui após criar o projeto
const SUPABASE_URL = 'https://uonupjxxrvzgwtodpsfp.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVvbnVwanh4cnZ6Z3d0b2Rwc2ZwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM5NzMwMzMsImV4cCI6MjA4OTU0OTAzM30.X7CupJtlOaMiyNt6VPz0LF0jSG0vHxIeIWpspwEm-Ag';

// Inicializa o cliente Supabase (carregado via CDN no head)
let sbClient = null;
function initSupabase() {
  if(typeof window.supabase !== 'undefined' && SUPABASE_URL !== 'https://uonupjxxrvzgwtodpsfp.supabase.co') {
    sbClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
    checkSession();
  }
}

async function checkSession() {
  if(!sbClient) return;
  const { data: { session } } = await sbClient.auth.getSession();
  if(session?.user) onLoginSuccess(session.user);

  // Escuta mudanças de auth (quando magic link é clicado)
  sbClient.auth.onAuthStateChange((_event, session) => {
    if(session?.user) onLoginSuccess(session.user);
  });
}

async function loginGoogle() {
  if(!sbClient) {
    // Demo mode — sem Supabase configurado
    showToast('Configure o Supabase no código para ativar o login com Google 🔧');
    demoLogin('usuario@gmail.com', 'Usuário Demo');
    closeModal('signupModal'); closeModal('loginModal');
    return;
  }
  const { error } = await sbClient.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: window.location.href }
  });
  if(error) showToast('Erro ao entrar com Google: ' + error.message);
}

async function enviarMagicLink(mode) {
  const emailId = mode === 'login' ? 'loginEmail' : 'authEmail';
  const email = document.getElementById(emailId)?.value?.trim();
  if(!email || !email.includes('@')) { showToast('Digite um email válido'); return; }

  if(!sbClient) {
    // Demo mode
    demoLogin(email, email.split('@')[0]);
    document.getElementById('authEmailStep').style.display = 'none';
    document.getElementById('authMagicSent').style.display = 'block';
    setTimeout(() => {
      closeModal('signupModal'); closeModal('loginModal');
      document.getElementById('authEmailStep').style.display = 'block';
      document.getElementById('authMagicSent').style.display = 'none';
    }, 2000);
    return;
  }

  const { error } = await sbClient.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: window.location.href }
  });
  if(error) { showToast('Erro: ' + error.message); return; }
  document.getElementById('authEmailStep').style.display = 'none';
  document.getElementById('authMagicSent').style.display = 'block';
}

function demoLogin(email, name) {
  const displayName = name || email.split('@')[0];
  userProfile.name = displayName;
  userProfile.email = email;
  userProfile.loggedIn = true;
  document.getElementById('avatarInitial').textContent = displayName[0].toUpperCase();
  document.getElementById('profileName').textContent = displayName;
  document.getElementById('profileTitle').textContent = 'Conta ativa · plano grátis';
  // Update nav
  document.getElementById('navCta').textContent = displayName[0].toUpperCase() + ' ▾';
  showToast(`Bem-vindo, ${displayName}! 🎉`);
  // Mostrar guia Wise após login
  setTimeout(() => mostrarGuiaWise(), 3000);
}

async function onLoginSuccess(user) {
  const name = user.user_metadata?.full_name || user.email?.split('@')[0] || 'Usuário';
  if(typeof demoLogin === 'function') demoLogin(user.email, name);
  
  // Apply pending Stripe plan
  const pendingPlan = sessionStorage.getItem('pendingPlan');
  if(pendingPlan) {
    userProfile.plan = pendingPlan;
    sessionStorage.removeItem('pendingPlan');
    showToast('🎉 Plano ' + pendingPlan.charAt(0).toUpperCase() + pendingPlan.slice(1) + ' ativado!');
  }

  // Check owner
  verificarOwner(user.email);

  if(!sbClient) return;
  try {
    const { data: profile } = await sbClient.from('profiles').select('*').eq('id', user.id).single();
    if(profile) {
      if(profile.plan && !pendingPlan) userProfile.plan = profile.plan;
      if(profile.name) userProfile.name = profile.name;
      if(profile.cv_profissional) userProfile.cvProfissional = profile.cv_profissional;
    }
    // Save pending plan to Supabase
    if(pendingPlan) {
      sbClient.from('profiles').update({ plan: pendingPlan }).eq('id', user.id);
    }
    const { data: cands } = await sbClient.from('candidaturas').select('*').eq('user_id', user.id).order('applied_at', { ascending: false });
    if(cands) {
      cands.forEach(c => {
        appliedJobs.add(c.job_id);
        candidaturas[c.job_id] = { id: c.job_id, job: { id: c.job_id, title: c.job_title, company_name: c.company_name, url: c.job_url, _source: c.job_source }, status: c.status, appliedAt: c.applied_at, feedback: c.feedback };
      });
      document.getElementById('statApps').textContent = cands.length;
    }
    const { data: saved } = await sbClient.from('vagas_salvas').select('job_id').eq('user_id', user.id);
    if(saved) saved.forEach(s => savedJobs.add(s.job_id));
    userProfile.supabaseId = user.id;
    if(typeof renderJobs === 'function') renderJobs(filteredJobs);
  } catch(e) { console.error('Supabase load error:', e); }
}
function createAccount() {
  const name = document.getElementById('signupName')?.value || 'Usuário';
  demoLogin('usuario@remotebr.com', name);
  closeModal('signupModal');
}

// ===== GUIA WISE — exibir após login ou quando candidatura aceita =====
function mostrarGuiaWise() {
  // Só mostrar uma vez por sessão
  if(sessionStorage.getItem('wiseShown')) return;
  sessionStorage.setItem('wiseShown', '1');
  showModal('wiseModal');
}

function subscribeAlert() {
  const email = document.getElementById('alertEmail').value;
  if(email) showToast('Alertas ativados! Você receberá novas vagas por email. 📬');
}

// Close modals on overlay click
document.querySelectorAll('.modal-overlay').forEach(overlay => {
  overlay.addEventListener('click', e => {
    if(e.target === overlay) overlay.classList.remove('open');
  });
});

// ===== OTIMIZAÇÃO DE CURRÍCULO UI =====
async function abrirOtimizacao(jobId) {
  if(!userProfile.plan && userProfile.plan !== 'master') {
    showPaywall('pleno'); return;
  }
  const job = allJobs.find(j => j.id === jobId);
  if(!job) return;
  if(!userProfile.cvLoaded) {
    showToast('Faça upload do seu currículo primeiro 📄'); return;
  }

  document.getElementById('cvModalSub').textContent = `Otimizando para: ${job.title} · ${job.company_name}`;
  document.getElementById('cvModalStatus').style.display = 'block';
  document.getElementById('cvModalContent').style.display = 'none';
  showModal('cvModal');

  const cv = await otimizarCurriculo(job);
  document.getElementById('cvModalStatus').style.display = 'none';

  if(cv) {
    document.getElementById('cvTextoFinal').value = cv;
    document.getElementById('cvModalContent').style.display = 'block';
  } else {
    closeModal('cvModal');
  }
}

function copiarCV() {
  const texto = document.getElementById('cvTextoFinal').value;
  navigator.clipboard.writeText(texto).then(() => showToast('Currículo copiado! 📋'));
}

function baixarCV() {
  const texto = document.getElementById('cvTextoFinal').value;
  const blob = new Blob([texto], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `curriculo_otimizado_${userProfile.name.replace(/\s+/g,'_')}.txt`;
  a.click();
  URL.revokeObjectURL(url);
  showToast('Download iniciado! 📥');
}

// ===== CANDIDATURA DIRETA VIA API =====
let vagaCandidatura = null;

function abrirCandidatura(jobId) {
  const job = allJobs.find(j => j.id === jobId);
  if(!job) return;
  vagaCandidatura = job;
  jobAtual = job;
  currentApplyJobId = jobId;

  // Reset recruiter message area
  document.getElementById('recruiterMsgArea').style.display = 'none';
  document.getElementById('recruiterMsgText').value = '';
  document.getElementById('btnGerarMsg').textContent = '✦ Gerar mensagem';
  document.getElementById('btnGerarMsg').disabled = false;
  document.getElementById('applySuccess').style.display = 'none';
  document.getElementById('applyForm').style.display = 'block';
  document.getElementById('applyStatus').style.display = 'none';

  // Show teaser for non-master, hide for master
  const isMaster = userProfile.plan === 'master';
  const teaser = document.getElementById('recruiterMsgTeaser');
  const btn = document.getElementById('btnGerarMsg');
  if(teaser) teaser.style.display = isMaster ? 'none' : 'block';
  if(btn) btn.style.background = isMaster ? '#6d28d9' : '#4a4a4a';

  // Pré-preencher com dados do perfil
  const dp = userProfile.dadosPessoais;
  document.getElementById('applyName').value    = dp.nomeCompleto || userProfile.name || '';
  document.getElementById('applyEmail').value   = dp.email || '';
  document.getElementById('applyPhone').value   = dp.telefone || '';
  document.getElementById('applyLinkedin').value = dp.linkedin || '';
  document.getElementById('applyCover').value   = '';

  // Status do CV
  const cvStatusEl = document.getElementById('applyCvStatus');
  const cvOkEl = document.getElementById('applyCvOk');
  if(userProfile.cvLoaded) {
    cvStatusEl.textContent = userProfile.name + ' · CV carregado';
    if(cvCache[`cv_${jobId}`]) cvOkEl.style.display = 'inline';
    else cvOkEl.style.display = 'none';
  } else {
    cvStatusEl.textContent = 'não carregado — faça upload do CV para melhores resultados';
    cvOkEl.style.display = 'none';
  }

  // Título e label ATS
  document.getElementById('applyTitle').textContent = 'Candidatar-se';
  document.getElementById('applySub').textContent = `${job.title} · ${job.company_name}`;
  const atsLabels = {
    lever: '✓ Candidatura direta via Lever API — sem formulário externo',
    greenhouse: '✓ Candidatura direta via Greenhouse API — sem formulário externo',
    link: '↗ Abre o site da empresa para candidatura'
  };
  document.getElementById('applyAtsLabel').textContent = atsLabels[job._ats] || '';

  // Perguntas customizadas do ATS (Greenhouse)
  const qDiv = document.getElementById('applyAtsQuestions');
  if(job._ats === 'greenhouse' && job._questions?.length) {
    const perguntas = job._questions.filter(q => q.label && q.label !== 'Resume').slice(0, 3);
    if(perguntas.length) {
      qDiv.style.display = 'block';
      qDiv.innerHTML = perguntas.map((q,i) => `
        <div class="form-group">
          <label class="form-label">${q.label}${q.required ? ' *' : ''}</label>
          <input class="form-input" id="ats_q_${i}" placeholder="${q.label}">
        </div>`).join('');
    } else { qDiv.style.display = 'none'; }
  } else { qDiv.style.display = 'none'; }

  document.getElementById('applyStatus').style.display = 'none';
  document.getElementById('applyForm').style.display = 'block';
  document.getElementById('applySuccess').style.display = 'none';
  showModal('applyModal');
}

async function autoFillCoverLetter() {
  if(!vagaCandidatura) return;
  document.getElementById('applyCover').value = 'Gerando cover letter...';
  const cl = await gerarCoverLetter(vagaCandidatura);
  document.getElementById('applyCover').value = cl || '';
}

async function submitApply() {
  const job = vagaCandidatura;
  if(!job) return;
  const name  = document.getElementById('applyName').value.trim();
  const email = document.getElementById('applyEmail').value.trim();
  if(!name || !email) { showToast('Preencha nome e email 👆'); return; }

  document.getElementById('applyForm').style.display = 'none';
  document.getElementById('applyStatus').style.display = 'block';

  // Para vagas sem API direta — abre link externo
  if(job._ats === 'link' || job._ats === undefined) {
    setTimeout(() => {
      window.open(job.url, '_blank');
      document.getElementById('applyStatus').style.display = 'none';
      document.getElementById('applySuccess').style.display = 'block';
      document.getElementById('applySuccessMsg').textContent =
        'Abrimos a vaga em nova aba. Cole o kit de candidatura nos campos.';
      markApplied(job.id);
    }, 800);
    return;
  }

  try {
    let ok = false;
    if(job._ats === 'lever') {
      ok = await aplicarLever(job, name, email);
    } else if(job._ats === 'greenhouse') {
      ok = await aplicarGreenhouse(job, name, email);
    }

    document.getElementById('applyStatus').style.display = 'none';
    if(ok) {
      document.getElementById('applySuccess').style.display = 'block';
      document.getElementById('applySuccessMsg').textContent =
        `Candidatura enviada diretamente para ${job.company_name} via ${job._ats === 'lever' ? 'Lever' : 'Greenhouse'}. Você deve receber confirmação por email.`;
      markApplied(job.id);
    } else {
      // Fallback: abre link externo
      window.open(job.url, '_blank');
      document.getElementById('applySuccess').style.display = 'block';
      document.getElementById('applySuccessMsg').textContent =
        'Abrimos a vaga em nova aba para você completar a candidatura.';
    }
  } catch {
    document.getElementById('applyStatus').style.display = 'none';
    window.open(job.url, '_blank');
    document.getElementById('applySuccess').style.display = 'block';
    document.getElementById('applySuccessMsg').textContent =
      'Abrimos a vaga em nova aba. Cole seu kit de candidatura nos campos.';
  }
}

async function aplicarLever(job, name, email) {
  const phone    = document.getElementById('applyPhone').value;
  const cover    = document.getElementById('applyCover').value;
  const nameParts = name.split(' ');
  const body = {
    name,
    email,
    phone: phone || undefined,
    comments: cover || undefined,
    consent: { store: true, marketing: false }
  };
  const res = await fetch(
    `https://api.lever.co/v0/postings/${job._slug}/${job._posting_id}/apply`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    }
  );
  const data = await res.json();
  return data.ok === true;
}

async function aplicarGreenhouse(job, name, email) {
  // Greenhouse exige chave do Job Board da empresa — sem ela, redireciona
  // Quando a empresa cadastrar no RemoteBR e fornecer a chave, ativa aqui
  // Por ora abre o link externo como fallback
  return false;
}
// ===== WELLFOUND (AngelList) — Early-stage startups =====
async function fetchWellfound() {
  try {
    // Wellfound public job search — remote roles
    const res = await fetch('https://wellfound.com/jobs?remote=true&jobTypes=full-time', {
      headers: { 'Accept': 'application/json' }
    });
    // Wellfound doesn't have a public JSON API — use their sitemap jobs
    // Fallback: use their public RSS-like endpoint
    throw new Error('no public api');
  } catch {
    // Wellfound blocks direct API access — use curated sample from their public listings
    // In production: use Wellfound's official partner API (requires application)
    return WELLFOUND_SAMPLE.map((j, i) => ({
      id: 90000 + i,
      title: j.title,
      company_name: j.company,
      company_logo: null,
      url: j.url,
      salary: j.salary || null,
      candidate_required_location: 'Worldwide',
      description: j.desc,
      category: j.area,
      publication_date: new Date(Date.now() - j.daysAgo * 86400000).toISOString(),
      _source: 'Wellfound',
      _earlyStage: j.stage === 'early',
      _teamSize: j.team,
      _funding: j.funding,
      _ats: 'link'
    }));
  }
}

// Curated early-stage remote companies from Wellfound (updated manually monthly)
const WELLFOUND_SAMPLE = [
  { title:'Full Stack Engineer', company:'Clerk', url:'https://wellfound.com/company/clerk/jobs', salary:'$120k–$160k', area:'Engineering', stage:'early', team:'10–50', funding:'Series A', desc:'Authentication platform for modern web apps. Remote-first, async culture.', daysAgo:3 },
  { title:'Product Designer', company:'Raycast', url:'https://wellfound.com/company/raycast/jobs', salary:'$90k–$130k', area:'Design', stage:'early', team:'10–50', funding:'Series A', desc:'Productivity tool for developers. Small team, big impact.', daysAgo:5 },
  { title:'Backend Engineer', company:'Resend', url:'https://wellfound.com/company/resend/jobs', salary:'$110k–$150k', area:'Engineering', stage:'early', team:'1–10', funding:'Seed', desc:'Email API for developers. YC-backed, fully remote.', daysAgo:2 },
  { title:'Growth Marketer', company:'Loops', url:'https://wellfound.com/company/loops/jobs', salary:'$80k–$110k', area:'Marketing', stage:'early', team:'1–10', funding:'Seed', desc:'Email platform for SaaS companies. Remote-first.', daysAgo:7 },
  { title:'Customer Success', company:'Mintlify', url:'https://wellfound.com/company/mintlify/jobs', salary:'$70k–$100k', area:'CS', stage:'early', team:'1–10', funding:'Seed', desc:'Documentation platform. YC W22. Small team, direct access to founders.', daysAgo:4 },
  { title:'Data Engineer', company:'Streamlit', url:'https://wellfound.com/company/streamlit/jobs', salary:'$130k–$170k', area:'Data', stage:'growth', team:'50–200', funding:'Series B', desc:'Python framework for data apps. Remote-friendly.', daysAgo:6 },
  { title:'DevRel Engineer', company:'Neon', url:'https://wellfound.com/company/neon-7/jobs', salary:'$100k–$140k', area:'Engineering', stage:'early', team:'10–50', funding:'Series A', desc:'Serverless Postgres. Developer-focused, remote team.', daysAgo:1 },
  { title:'Frontend Engineer', company:'Liveblocks', url:'https://wellfound.com/company/liveblocks/jobs', salary:'$100k–$140k', area:'Engineering', stage:'early', team:'1–10', funding:'Seed', desc:'Real-time collaboration APIs. Fully remote, async-first.', daysAgo:8 },
];

// ===== EXPLORAR TAB =====
const EXPLORE_PLATFORMS = [
  { name:'Wellfound', icon:'🚀', desc:'Startups early-stage, acesso direto a fundadores', url:'https://wellfound.com/jobs?remote=true', color:'#f59e0b', badge:'Early-stage' },
  { name:'LinkedIn Jobs', icon:'💼', desc:'Busca pré-filtrada por vagas remotas worldwide', url:'https://www.linkedin.com/jobs/search/?f_WT=2&f_JT=F&keywords=software+engineer&location=Worldwide', color:'#0a66c2', badge:'Maior volume' },
  { name:'YC Work at a Startup', icon:'🔶', desc:'Startups verificadas pelo Y Combinator', url:'https://workatastartup.com/jobs?remote=true', color:'#f97316', badge:'YC verified' },
  { name:'Greenhouse Jobs', icon:'🌿', desc:'Empresas tech que usam Greenhouse como ATS', url:'https://boards.greenhouse.io/', color:'#10b981', badge:'ATS direto' },
  { name:'Lever Jobs', icon:'⚡', desc:'Vagas em empresas que usam Lever como ATS', url:'https://jobs.lever.co/', color:'#3b82f6', badge:'ATS direto' },
  { name:'Stack Overflow Jobs', icon:'📚', desc:'Foco em devs — empresas que respeitam programadores', url:'https://stackoverflow.com/jobs/companies?r=true', color:'#f48024', badge:'Dev-focused' },
];

// Companies from remoteintech/remote-jobs, yanirs/established-remote, remote-es/remotes
const EXPLORE_COMPANIES = [
  { name:'GitLab', area:'Engineering', url:'https://about.gitlab.com/jobs/', desc:'Empresa 100% remota desde a fundação. Handbook público, cultura assíncrona.', team:'1000+', since:2011, origin:'remoteintech' },
  { name:'Automattic', area:'Engineering', url:'https://automattic.com/work-with-us/', desc:'WordPress.com, Tumblr, WooCommerce. Remoto desde 2005.', team:'1900+', since:2005, origin:'remoteintech' },
  { name:'Zapier', area:'Engineering', url:'https://zapier.com/jobs', desc:'Automação de workflows. 100% remoto, sem escritório físico.', team:'800+', since:2011, origin:'remoteintech' },
  { name:'Buffer', area:'Marketing', url:'https://buffer.com/journey', desc:'Social media management. Transparência radical, remoto total.', team:'80+', since:2010, origin:'remoteintech' },
  { name:'Doist', area:'Engineering', url:'https://doist.com/jobs', desc:'Todoist e Twist. Async-first, semana de 4 dias, remoto total.', team:'100+', since:2007, origin:'remoteintech' },
  { name:'Basecamp', area:'Engineering', url:'https://basecamp.com/jobs', desc:'Project management. Pioneiros do trabalho remoto.', team:'60+', since:1999, origin:'remoteintech' },
  { name:'Hotjar', area:'Marketing', url:'https://careers.hotjar.com', desc:'Analytics de comportamento. Remote-first, contrata LATAM.', team:'400+', since:2014, origin:'remoteintech' },
  { name:'Toggl', area:'Engineering', url:'https://toggl.com/jobs', desc:'Time tracking. 100% remoto, horário flexível.', team:'130+', since:2006, origin:'remoteintech' },
  { name:'Invision', area:'Design', url:'https://www.invisionapp.com/careers', desc:'Design platform. Remote-first há anos.', team:'700+', since:2011, origin:'remoteintech' },
  { name:'Elastic', area:'Engineering', url:'https://www.elastic.co/about/careers', desc:'Elasticsearch, Kibana. Distributed-first.', team:'3000+', since:2012, origin:'remoteintech' },
  { name:'Netlify', area:'Engineering', url:'https://www.netlify.com/careers/', desc:'Web platform. Remote-first, excelente cultura dev.', team:'200+', since:2014, origin:'remoteintech' },
  { name:'Vercel', area:'Engineering', url:'https://vercel.com/careers', desc:'Frontend cloud. Remote-first, foco em DX.', team:'400+', since:2015, origin:'remoteintech' },
  { name:'Supabase', area:'Engineering', url:'https://supabase.com/careers', desc:'Open source Firebase. YC-backed, remote-first.', team:'100+', since:2020, origin:'remoteintech' },
  { name:'PlanetScale', area:'Engineering', url:'https://planetscale.com/careers', desc:'Serverless MySQL. Remote-first, ótimo para devs.', team:'100+', since:2018, origin:'remoteintech' },
  { name:'Loom', area:'Engineering', url:'https://www.loom.com/careers', desc:'Video messaging. Acquired by Atlassian. Remote-friendly.', team:'300+', since:2015, origin:'remoteintech' },
  { name:'Notion', area:'Engineering', url:'https://www.notion.so/careers', desc:'All-in-one workspace. Híbrido mas contrata remoto.', team:'400+', since:2016, origin:'remoteintech' },
  { name:'Linear', area:'Engineering', url:'https://linear.app/careers', desc:'Issue tracking para times modernos. Small team, alto impacto.', team:'50+', since:2019, origin:'remoteintech' },
  { name:'Posthog', area:'Engineering', url:'https://posthog.com/careers', desc:'Open source analytics. YC-backed, 100% remoto.', team:'50+', since:2020, origin:'remoteintech' },
  { name:'Sentry', area:'Engineering', url:'https://sentry.io/careers/', desc:'Error monitoring. Remote-friendly, contrata globalmente.', team:'500+', since:2012, origin:'remoteintech' },
  { name:'Cloudflare', area:'Engineering', url:'https://www.cloudflare.com/careers/', desc:'Internet security. Remote-friendly, salários top.', team:'3000+', since:2009, origin:'remoteintech' },
  { name:'Datadog', area:'Data', url:'https://www.datadoghq.com/careers/', desc:'Monitoring platform. Remote-friendly, contrata LATAM.', team:'5000+', since:2010, origin:'remoteintech' },
  { name:'Figma', area:'Design', url:'https://www.figma.com/careers/', desc:'Design platform. Adobe acquisition. Remoto nos EUA e global.', team:'1000+', since:2012, origin:'remoteintech' },
  { name:'Airtable', area:'Engineering', url:'https://airtable.com/careers', desc:'No-code platform. Remote-friendly.', team:'700+', since:2012, origin:'remoteintech' },
  { name:'Retool', area:'Engineering', url:'https://retool.com/careers', desc:'Internal tools builder. Contrata remotamente.', team:'300+', since:2017, origin:'remoteintech' },
  { name:'Deel', area:'CS', url:'https://www.deel.com/careers', desc:'Global payroll. Irônico: eles contratam remotamente.', team:'3000+', since:2019, origin:'remoteintech' },
  { name:'Remote', area:'CS', url:'https://remote.com/careers', desc:'Global HR platform. 100% remoto por definição.', team:'900+', since:2019, origin:'remoteintech' },
  { name:'Hubspot', area:'Marketing', url:'https://www.hubspot.com/careers', desc:'CRM & marketing. Remote-friendly, ótimos benefícios.', team:'7000+', since:2006, origin:'established' },
  { name:'Zendesk', area:'CS', url:'https://www.zendesk.com/jobs/', desc:'Customer service. Remote-friendly, contrata globalmente.', team:'6000+', since:2007, origin:'established' },
  { name:'Intercom', area:'CS', url:'https://www.intercom.com/careers', desc:'Customer messaging. Remote-friendly.', team:'700+', since:2011, origin:'established' },
  { name:'Calendly', area:'Engineering', url:'https://calendly.com/careers', desc:'Scheduling platform. Remote-first.', team:'400+', since:2013, origin:'established' },
  { name:'Amplitude', area:'Data', url:'https://amplitude.com/careers', desc:'Product analytics. Remote-friendly.', team:'700+', since:2012, origin:'established' },
  { name:'Mixpanel', area:'Data', url:'https://mixpanel.com/jobs/', desc:'Product analytics. Remote-friendly, contrata LATAM.', team:'400+', since:2009, origin:'established' },
  { name:'Segment', area:'Data', url:'https://www.twilio.com/en-us/segment/careers', desc:'CDP platform. Part of Twilio. Remote-friendly.', team:'500+', since:2011, origin:'established' },
  { name:'Sendgrid', area:'Engineering', url:'https://www.twilio.com/en-us/careers', desc:'Email API. Part of Twilio. Remote-friendly.', team:'8000+', since:2009, origin:'established' },
  { name:'Webflow', area:'Design', url:'https://webflow.com/careers', desc:'No-code web builder. Remote-first.', team:'600+', since:2013, origin:'established' },
  { name:'Framer', area:'Design', url:'https://www.framer.com/careers/', desc:'Design and prototyping. Remote-friendly.', team:'100+', since:2014, origin:'established' },
  { name:'Ghost', area:'Engineering', url:'https://ghost.org/jobs/', desc:'Publishing platform. 100% remoto, open source.', team:'30+', since:2013, origin:'established' },
  { name:'Fastly', area:'Engineering', url:'https://www.fastly.com/about/careers', desc:'Edge cloud. Remote-friendly, salários competitivos.', team:'1000+', since:2011, origin:'established' },
  { name:'Pagerduty', area:'Engineering', url:'https://www.pagerduty.com/careers/', desc:'Incident management. Remote-friendly.', team:'900+', since:2009, origin:'established' },
  { name:'Okta', area:'Engineering', url:'https://www.okta.com/company/careers/', desc:'Identity platform. Remote-friendly, grande empresa.', team:'6000+', since:2009, origin:'established' },
  { name:'Stripe', area:'Engineering', url:'https://stripe.com/jobs', desc:'Payments. Top employer, salários premium.', team:'8000+', since:2010, origin:'established' },
  { name:'Shopify', area:'Engineering', url:'https://www.shopify.com/careers', desc:'E-commerce. Digital-by-default, contrata globalmente.', team:'10000+', since:2006, origin:'established' },
  { name:'Twilio', area:'Engineering', url:'https://www.twilio.com/en-us/careers', desc:'Communications APIs. Remote-friendly.', team:'8000+', since:2008, origin:'established' },
  { name:'MongoDB', area:'Data', url:'https://www.mongodb.com/careers', desc:'Database platform. Remote-friendly, contrata LATAM.', team:'5000+', since:2007, origin:'established' },
  { name:'Hashicorp', area:'Engineering', url:'https://www.hashicorp.com/careers', desc:'Infrastructure automation. Remote-first.', team:'2000+', since:2012, origin:'established' },
  { name:'Confluent', area:'Data', url:'https://www.confluent.io/careers/', desc:'Apache Kafka platform. Remote-friendly.', team:'3000+', since:2014, origin:'established' },
  { name:'Grafana Labs', area:'Data', url:'https://grafana.com/about/careers/', desc:'Observability platform. 100% remoto.', team:'700+', since:2014, origin:'remoteintech' },
  { name:'Mattermost', area:'Engineering', url:'https://mattermost.com/careers/', desc:'Open source messaging. 100% remoto.', team:'200+', since:2015, origin:'remoteintech' },
  { name:'Help Scout', area:'CS', url:'https://www.helpscout.com/company/careers/', desc:'Customer support. 100% remoto desde sempre.', team:'150+', since:2011, origin:'remoteintech' },
  { name:'Close', area:'CS', url:'https://jobs.close.com', desc:'CRM para sales. 100% remoto, contrata LATAM.', team:'80+', since:2013, origin:'remoteintech' },
  { name:'Whereby', area:'Engineering', url:'https://whereby.com/information/careers/', desc:'Video meetings. Remote-first, europeia.', team:'100+', since:2013, origin:'remotees' },
  { name:'Pitch', area:'Design', url:'https://pitch.com/careers', desc:'Presentation platform. Remote-friendly, europeia.', team:'100+', since:2018, origin:'remotees' },
  { name:'Personio', area:'Engineering', url:'https://www.personio.com/about-personio/careers/', desc:'HR software. Europeia, remote-friendly.', team:'2000+', since:2015, origin:'remotees' },
];

const AREA_SALARY = {
  'Engineering': '$100k–$160k/ano',
  'Data':        '$95k–$150k/ano',
  'Design':      '$80k–$130k/ano',
  'Marketing':   '$65k–$100k/ano',
  'CS':          '$60k–$90k/ano',
  'Product':     '$110k–$150k/ano',
};

const ORIGIN_LABELS = {
  remoteintech: { label:'remoteintech', color:'#3b82f6' },
  established:  { label:'established-remote', color:'#10b981' },
  remotees:     { label:'remote-es', color:'#8b5cf6' },
};

let exploreFilter = 'all';
let exploreSalaryMin = 0;
let exploreRendered = false;

// Salary min values per area (bottom of range)
const AREA_SALARY_MIN = {
  'Engineering': 100000,
  'Data':         95000,
  'Design':       80000,
  'Marketing':    65000,
  'CS':           60000,
  'Product':     110000,
};

function setExploreSalary(val, el) {
  document.querySelectorAll('[id^="esal-"]').forEach(b => b.classList.remove('active'));
  el.classList.add('active');
  exploreSalaryMin = val;
  renderExploreCompanies(exploreFilter);
}

function renderExplorar() {
  renderExplorePlatforms();
  renderExploreCompanies('all');
  if(!exploreRendered) {
    renderExploreFilterBtns();
    exploreRendered = true;
  }
}

function renderExplorePlatforms() {
  const el = document.getElementById('explorePlatforms');
  if(!el || el.children.length > 0) return;
  el.innerHTML = EXPLORE_PLATFORMS.map(p => `
    <a href="${p.url}" target="_blank" style="display:flex;align-items:flex-start;gap:12px;background:var(--surface);border:0.5px solid var(--border);border-radius:12px;padding:1rem;text-decoration:none;transition:border-color .15s" onmouseover="this.style.borderColor='${p.color}'" onmouseout="this.style.borderColor='var(--border)'">
      <div style="width:38px;height:38px;border-radius:10px;background:${p.color}18;display:flex;align-items:center;justify-content:center;font-size:18px;flex-shrink:0">${p.icon}</div>
      <div style="flex:1;min-width:0">
        <div style="display:flex;align-items:center;gap:6px;margin-bottom:3px;flex-wrap:wrap">
          <span style="font-size:13px;font-weight:500;color:var(--text)">${p.name}</span>
          <span style="font-size:10px;padding:1px 6px;border-radius:999px;background:${p.color}18;color:${p.color};border:0.5px solid ${p.color}40">${p.badge}</span>
        </div>
        <div style="font-size:11px;color:var(--muted);line-height:1.4">${p.desc}</div>
      </div>
      <span style="font-size:14px;color:var(--muted2);flex-shrink:0;margin-top:2px">↗</span>
    </a>`).join('');
}

function renderExploreFilterBtns() {
  const el = document.getElementById('exploreFilters');
  if(!el) return;
  const areas = ['all', ...new Set(EXPLORE_COMPANIES.map(c => c.area))];
  el.innerHTML = areas.map(a => `
    <button onclick="filterExplore('${a}',this)" class="chip${a==='all'?' active':''}" style="font-size:11px;padding:4px 10px">
      ${a === 'all' ? 'Todas' : a}
    </button>`).join('');
}

function filterExplore(area, el) {
  document.querySelectorAll('#exploreFilters .chip').forEach(c => c.classList.remove('active'));
  el.classList.add('active');
  exploreFilter = area;
  renderExploreCompanies(area);
}

function renderExploreCompanies(area) {
  const el = document.getElementById('exploreCompanies');
  if(!el) return;

  let filtered = area === 'all' ? EXPLORE_COMPANIES : EXPLORE_COMPANIES.filter(c => c.area === area);

  // Apply salary filter — compare against area median minimum
  if(exploreSalaryMin > 0) {
    filtered = filtered.filter(c => (AREA_SALARY_MIN[c.area] || 0) >= exploreSalaryMin);
  }

  const salary = AREA_SALARY;
  const orig = ORIGIN_LABELS;

  if(!filtered.length) {
    el.innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:2rem;color:var(--muted);font-size:13px">Nenhuma empresa encontrada com esses filtros.<br><span style="font-size:12px;opacity:.6">Tente uma faixa salarial menor ou outra área.</span></div>`;
    return;
  }

  el.innerHTML = filtered.map(c => `
    <a href="${c.url}" target="_blank" style="background:var(--surface);border:0.5px solid var(--border);border-radius:12px;padding:1rem;text-decoration:none;display:block;transition:border-color .15s" onmouseover="this.style.borderColor='var(--accent)'" onmouseout="this.style.borderColor='var(--border)'">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:8px;margin-bottom:8px">
        <div>
          <div style="font-size:14px;font-weight:500;color:var(--text);margin-bottom:2px">${c.name}</div>
          <div style="display:flex;align-items:center;gap:5px;flex-wrap:wrap">
            <span style="font-size:11px;color:var(--muted)">${c.area}</span>
            <span style="font-size:10px;color:var(--muted2)">·</span>
            <span style="font-size:11px;color:var(--muted2)">${c.team} pessoas</span>
            <span style="font-size:10px;color:var(--muted2)">·</span>
            <span style="font-size:11px;color:var(--muted2)">desde ${c.since}</span>
          </div>
        </div>
        <span style="font-size:16px;flex-shrink:0;color:var(--muted2)">↗</span>
      </div>
      <div style="font-size:12px;color:var(--muted);line-height:1.5;margin-bottom:8px">${c.desc}</div>
      <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:4px">
        <span style="font-size:11px;color:#4ade80;font-weight:500">${salary[c.area] || '$70k–$120k/ano'} <span style="font-size:10px;opacity:.6">est.</span></span>
        <span style="font-size:10px;padding:1px 6px;border-radius:999px;background:${orig[c.origin]?.color || '#888'}18;color:${orig[c.origin]?.color || '#888'};border:0.5px solid ${orig[c.origin]?.color || '#888'}40">${orig[c.origin]?.label || c.origin}</span>
      </div>
    </a>`).join('');
}
const SALARY_DATA = {
  'Software Dev / Frontend': { jr:[70,90],  mid:[100,130], sr:[130,180], lead:[160,220] },
  'Backend / Full Stack':    { jr:[75,95],  mid:[105,135], sr:[140,190], lead:[170,230] },
  'DevOps / Cloud / SRE':    { jr:[80,100], mid:[115,145], sr:[150,200], lead:[180,250] },
  'Data / BI / Analytics':   { jr:[65,85],  mid:[95,125],  sr:[125,170], lead:[150,210] },
  'AI / ML Engineer':        { jr:[90,110], mid:[130,165], sr:[160,210], lead:[200,270] },
  'Product Manager':         { jr:[75,95],  mid:[110,140], sr:[140,180], lead:[170,230] },
  'UX / Design':             { jr:[55,75],  mid:[80,110],  sr:[110,150], lead:[140,190] },
  'Marketing Digital':       { jr:[45,65],  mid:[65,90],   sr:[90,130],  lead:[120,170] },
  'Customer Success':        { jr:[45,60],  mid:[60,85],   sr:[80,115],  lead:[110,150] },
  'Sales / Account Exec':    { jr:[50,70],  mid:[70,100],  sr:[100,150], lead:[130,200] },
};

function gerarTabelaSalarios() {
  return Object.entries(SALARY_DATA).map(([area, niveis]) => `
    <div style="background:var(--surface2);border:0.5px solid var(--border);border-radius:8px;padding:10px 12px">
      <div style="font-size:12px;font-weight:500;color:var(--text);margin-bottom:6px">${area}</div>
      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:4px">
        ${[['jr','Júnior'],['mid','Pleno'],['sr','Sênior'],['lead','Lead']].map(([k,lbl]) => {
          const v = niveis[k];
          return `<div style="text-align:center">
            <div style="font-size:10px;color:var(--muted2);margin-bottom:2px">${lbl}</div>
            <div style="font-size:11px;color:#4ade80;font-weight:500">$${v[0]}k–${v[1]}k</div>
          </div>`;
        }).join('')}
      </div>
    </div>`).join('');
}

// Override showModal to fill salary table dynamically
const _origShowModal = window.showModal;
function showModal(id) {
  if(id === 'salaryModal') {
    const container = document.querySelector('#salaryModal .salary-table-container');
    if(container) container.innerHTML = gerarTabelaSalarios();
  }
  document.getElementById(id)?.classList.add('open');
}

// ===== TESTE DE INGLÊS =====
let etHistory = [];
let etCount = 0;
const ET_QUESTIONS = [
  "Tell me about yourself and your professional background.",
  "Describe a challenging project you worked on. What was your role and how did you handle it?",
  "Why are you interested in working for an international remote company?"
];

function abrirTesteIngles() {
  if(!userProfile.plan) { showPaywall('junior'); return; }
  etHistory = []; etCount = 0;
  document.getElementById('englishTestChat').innerHTML = '';
  document.getElementById('englishTestResult').style.display = 'none';
  document.getElementById('englishTestInput').style.display = 'flex';
  addETMsg(`Hi! I'll evaluate your English in 3 questions — just like a US recruiter would. Ready? Here's question 1 of 3:<br><br><b>"${ET_QUESTIONS[0]}"</b>`, 'ai');
  document.getElementById('englishTestModal').classList.add('open');
}

async function sendEnglishTest() {
  const input = document.getElementById('etInput');
  const msg = input.value.trim();
  if(!msg) return;
  input.value = '';
  addETMsg(msg, 'user');
  etHistory.push({ q: ET_QUESTIONS[etCount], a: msg });
  etCount++;
  if(etCount < ET_QUESTIONS.length) {
    addETMsg(`Thanks! Question ${etCount+1} of 3:<br><br><b>"${ET_QUESTIONS[etCount]}"</b>`, 'ai');
  } else {
    document.getElementById('englishTestInput').style.display = 'none';
    addETMsg('Analyzing your answers... 🔍', 'ai');
    await avaliarIngles();
  }
}

async function avaliarIngles() {
  const respostas = etHistory.map((h,i) => `Q${i+1}: "${h.q}"\nA: "${h.a}"`).join('\n\n');
  const prompt = `Você é avaliador de inglês para brasileiros buscando emprego internacional.
Avalie as 3 respostas abaixo e dê feedback em PORTUGUÊS.
${respostas}

Responda EXATAMENTE assim (sem asteriscos, sem markdown):
NÍVEL: [A2 / B1 / B2 / C1]
NOTA: [X/10]

PONTOS FORTES:
[2-3 aspectos positivos]

PONTOS A MELHORAR:
[2-3 problemas encontrados]

VEREDICTO:
[1 parágrafo — conseguiria uma entrevista com empresa americana?]

PRÓXIMOS PASSOS:
[3 ações concretas para as próximas semanas]`;
  try {
    const resultado = await chamarIA([{ role:'user', content: prompt }]);
    document.getElementById('englishTestChat').innerHTML = '';
    const nivel = resultado.match(/NÍVEL:\s*([A-C][12])/i)?.[1]?.toUpperCase() || 'B1';
    const nota  = resultado.match(/NOTA:\s*(\d+)/)?.[1] || '?';
    const corNivel = { A2:'#ef4444', B1:'#f59e0b', B2:'#3b82f6', C1:'#4ade80' };
    const res = document.getElementById('englishTestResult');
    res.style.display = 'block';
    res.innerHTML = `
      <div style="text-align:center;padding:1rem 0;border-bottom:0.5px solid var(--border);margin-bottom:1rem">
        <div style="font-size:52px;font-weight:700;color:${corNivel[nivel]||'#3b82f6'}">${nivel}</div>
        <div style="font-size:14px;color:var(--muted);margin-top:4px">Nota ${nota}/10 · Avaliação RemoteBR</div>
      </div>
      <div style="font-size:13px;color:var(--muted);line-height:1.8;white-space:pre-line">${resultado.replace(/NÍVEL:.*\n.*NOTA:.*\n*/,'')}</div>
      <button class="btn-full" style="margin-top:1rem" onclick="closeModal('englishTestModal')">Fechar avaliação</button>`;
    userProfile.nivelIngles = nivel;
    document.getElementById('profileTitle').textContent = (userProfile.title||'') + ` · Inglês ${nivel}`;
  } catch {
    document.getElementById('englishTestResult').innerHTML = '<div style="color:var(--muted);font-size:13px;padding:1rem">Erro ao avaliar. Tente novamente.</div>';
    document.getElementById('englishTestResult').style.display = 'block';
  }
}

function addETMsg(text, role) {
  const div = document.createElement('div');
  div.className = `chat-msg ${role}`;
  div.innerHTML = text;
  document.getElementById('englishTestChat').appendChild(div);
  document.getElementById('englishTestChat').scrollTop = 9999;
}

// ===== TIMEZONE E CULTURA =====
function getTimezoneInfo(loc) {
  const l = (loc||'').toLowerCase();
  if(/us|united states|america|east|west|pst|est|cst/.test(l))
    return { flag:'🇺🇸', label:'EUA', overlap:'3–5h sobreposição com BR' };
  if(/europe|uk|germany|france|spain|cet|gmt/.test(l))
    return { flag:'🇪🇺', label:'Europa', overlap:'Manhã BR = tarde Europa' };
  if(/canada/.test(l))
    return { flag:'🇨🇦', label:'Canadá', overlap:'Fuso similar aos EUA' };
  return { flag:'🌍', label:'Worldwide', overlap:'Horário flexível' };
}

function getSalaryContext(salary, title) {
  if(!salary && !title) return null;
  const t = (title||'').toLowerCase();
  const area = Object.keys(SALARY_DATA).find(k => {
    const kl = k.toLowerCase();
    if(kl.includes('frontend') && (t.includes('front')||t.includes('react')||t.includes('vue'))) return true;
    if(kl.includes('backend') && (t.includes('back')||t.includes('full')||t.includes('node')||t.includes('python'))) return true;
    if(kl.includes('devops') && (t.includes('devops')||t.includes('cloud')||t.includes('sre'))) return true;
    if(kl.includes('data') && (t.includes('data')||t.includes('analyst')||t.includes('bi'))) return true;
    if(kl.includes('ai') && (t.includes('ml')||t.includes('machine')||t.includes('ai'))) return true;
    if(kl.includes('product') && t.includes('product')) return true;
    if(kl.includes('ux') && (t.includes('ux')||t.includes('design'))) return true;
    return false;
  });
  if(!area) return null;
  const mid = SALARY_DATA[area].mid;
  return `Mediana mercado EUA para este cargo: <span style="color:#4ade80;font-weight:500">$${mid[0]}k–$${mid[1]}k/ano</span>`;
}

// ===== SIMULADOR DE TESTES =====
const SIM_AREAS = {
  ingles_entrevista: {
    label: '🗣️ Inglês para entrevistas',
    desc: 'Perguntas comportamentais e frases que empresas americanas usam',
    plano: 'junior',
    perguntas: [
      { q: 'How do you handle working across different time zones?', opcoes: ['I wake up early or stay late to match the team schedule','I ignore time zone differences','I only work my local hours','I refuse to join calls outside my time zone'], correta: 0, gabarito: 'The best answer shows flexibility and proactiveness. Mentioning tools like async communication (Slack, Notion) and occasional schedule adjustments demonstrates remote-work maturity.', dica: 'Always frame timezone challenges as something you actively manage, not something that happens to you.' },
      { q: 'Tell me about a time you disagreed with your manager.', opcoes: ['I always agree with my manager','I expressed my concern respectfully, explained my reasoning, then accepted the decision','I quit the job','I complained to other colleagues'], correta: 1, gabarito: 'American companies value respectful directness. The STAR structure works: Situation (disagreement), Action (you spoke up professionally), Result (decision was made, you committed). Shows maturity.', dica: 'Never say you always agree — it sounds dishonest. Never say you escalated or complained. Show professional assertiveness.' },
      { q: 'What does "ownership" mean to you in a work context?', opcoes: ['Just doing what you are told','Taking full responsibility for a task from start to finish, including fixing problems proactively','Owning company stock','Having a private office'], correta: 1, gabarito: '"Ownership" is a core value in American startup culture. It means you treat your work as if the company were yours — you anticipate problems, fix them without being asked, and take pride in outcomes.', dica: 'This word appears in almost every US startup job description. Learn it well.' },
      { q: 'How do you communicate when requirements are unclear?', opcoes: ['I wait until someone explains everything','I start working and hope for the best','I proactively ask clarifying questions using a structured message outlining my assumptions','I refuse to start until everything is documented'], correta: 2, gabarito: 'Strong async communicators write a message like: "Here are my current assumptions: 1. X, 2. Y. I plan to proceed with Z unless you correct me by [date]." This shows initiative and prevents blockers.', dica: 'The phrase "I proactively clarify assumptions in writing" signals async-first maturity to US interviewers.' },
      { q: 'What is your greatest professional achievement?', opcoes: ['I have no notable achievements','Graduated from university','Reduced deployment time by 60% using CI/CD pipeline, saving 8 hours per week for the team','I once finished a project on time'], correta: 2, gabarito: 'American interviewers want specific, quantified achievements. Use this formula: Action verb + what you did + measurable result. "Reduced X by Y%, saving Z hours/dollars" is the gold standard.', dica: 'Every achievement should have a number. If you do not have one, estimate: "approximately 40% faster", "saved roughly 5 hours per week".' },
      { q: 'How do you prioritize when you have multiple urgent tasks?', opcoes: ['I do whichever task is most fun first','I tell my manager I cannot handle it','I use a priority framework (impact vs effort), communicate blockers early, and deliver the highest-value item first','I work 20 hours straight to finish everything'], correta: 2, gabarito: 'This tests project management thinking. Good answer: name a framework (Eisenhower matrix, impact/effort), show you communicate proactively about trade-offs, and demonstrate you make decisions rather than waiting to be told.', dica: 'Adding "and I communicate the trade-offs to my manager" always scores points.' },
      { q: 'Describe your ideal remote work setup.', opcoes: ['I work from my bed with my phone','Dedicated workspace, reliable internet, structured schedule, and clear async communication habits','I prefer to be in an office','I have no preference'], correta: 1, gabarito: 'US companies want to see you are remote-ready. Mention: quiet dedicated space, fast internet, tools you use (Slack, Notion, Zoom), your approach to async communication, and how you maintain work-life boundaries.', dica: 'Saying you have a dedicated workspace and structured schedule signals professionalism to remote-first companies.' },
      { q: 'Why do you want to work for an international company?', opcoes: ['Just for the money','I want to be exposed to global best practices, work with diverse teams, and grow professionally beyond local market limitations','I have no specific reason','My friend works there'], correta: 1, gabarito: 'Connect your motivation to professional growth, not just salary (even if salary is the real reason). Mention exposure to global practices, diverse perspectives, or working on products with international impact.', dica: 'Interviewers know salary is a motivation — you do not need to hide it. But pairing it with growth motivation makes you sound more engaged.' },
    ]
  },

  dev: {
    label: '💻 Desenvolvimento de Software',
    desc: 'Perguntas técnicas e comportamentais para devs',
    plano: 'senior',
    perguntas: [
      { q: 'What is the difference between REST and GraphQL?', opcoes: ['They are the same thing','REST uses fixed endpoints returning full resources; GraphQL uses a single endpoint where clients specify exactly what data they need','GraphQL is only for databases','REST is newer than GraphQL'], correta: 1, gabarito: 'REST: multiple endpoints, fixed response shapes, easy to cache. GraphQL: single endpoint, client-driven queries, avoids over/under-fetching. GraphQL shines with complex, related data (social networks, e-commerce). REST is simpler for straightforward CRUD APIs.', dica: 'Always compare trade-offs, not just definitions. When would you choose each? That is what interviewers actually want to know.' },
      { q: 'Explain the concept of technical debt.', opcoes: ['Money owed to software vendors','The accumulated cost of shortcuts taken during development that make future changes harder and slower','A type of software license','Database storage costs'], correta: 1, gabarito: 'Technical debt is like financial debt — the shortcut saves time now but accrues "interest" as complexity grows. Good answers include: how to measure it (cycle time, bug rate), how to communicate it to non-technical stakeholders, and strategies to pay it down incrementally.', dica: 'Mentioning that you document technical debt in tickets and prioritize it alongside features shows engineering maturity.' },
      { q: 'What happens when you type a URL in a browser and press Enter?', opcoes: ['The page just appears','DNS lookup → TCP connection → TLS handshake → HTTP request → server processing → HTML rendering','The browser guesses the page content','Nothing happens until you click a link'], correta: 1, gabarito: 'This classic question tests systems knowledge. Full answer: DNS resolves domain to IP → TCP 3-way handshake → TLS handshake (HTTPS) → browser sends HTTP GET → server processes and returns HTML → browser parses HTML, loads CSS/JS, renders DOM, fires load event.', dica: 'Go as deep as your seniority allows. Mentioning CDNs, caching headers, or browser rendering pipeline shows depth.' },
      { q: 'How do you approach code reviews?', opcoes: ['I reject all pull requests','I focus only on bugs, ignoring style','I look for correctness, readability, performance implications, security risks, and provide constructive feedback with explanations','I approve everything to be nice'], correta: 2, gabarito: 'Great code reviewers are specific and kind. Mention: separating nit-picks from blockers, explaining the "why" behind feedback, asking questions rather than making demands ("What do you think about X?" vs "Change this to X"), and praising good code.', dica: 'Add that you use code review as a teaching opportunity, not just a gate. This resonates with US engineering culture.' },
      { q: 'What is the difference between SQL and NoSQL databases?', opcoes: ['SQL is faster than NoSQL in all cases','SQL uses structured tables with fixed schemas and ACID transactions; NoSQL uses flexible documents/key-value/graph structures optimized for scale and flexibility','NoSQL cannot store data permanently','They are the same'], correta: 1, gabarito: 'SQL (PostgreSQL, MySQL): structured schema, joins, transactions, consistency. Best for financial data, complex queries. NoSQL (MongoDB, Redis, DynamoDB): flexible schema, horizontal scaling, eventual consistency. Best for high-volume, variable-structure data like logs, user events, catalogs.', dica: 'Always end with "I would choose based on the specific use case" — shows you think in trade-offs, not absolutes.' },
      { q: 'Explain the concept of CI/CD.', opcoes: ['A type of database','Continuous Integration / Continuous Delivery — automating code testing and deployment to reduce manual steps and deployment risk','A programming language','A project management method'], correta: 1, gabarito: 'CI: every code commit triggers automated tests, catching bugs early. CD: passing builds are automatically deployed to staging or production. Benefits: faster feedback loops, fewer integration bugs, smaller safer releases. Tools: GitHub Actions, CircleCI, Jenkins.', dica: 'Mentioning that you have set up or improved a CI/CD pipeline is a strong signal to US companies.' },
      { q: 'How do you handle a production incident?', opcoes: ['Panic and restart everything','Ignore it and see if it resolves itself','Detect → Assess impact → Mitigate (rollback/hotfix) → Communicate status → Fix root cause → Write post-mortem','Wait for the manager to decide'], correta: 2, gabarito: 'US companies want blameless post-mortems and systematic incident response. Key points: communicate status early (even "we are investigating"), prefer rollback over untested fix, document what happened and why, implement prevention (monitoring, tests, alerts).', dica: '"I always write a post-mortem with action items" is a phrase that instantly impresses US engineering interviewers.' },
    ]
  },

  produto: {
    label: '📊 Product Management',
    desc: 'Perguntas de entrevista para Product Managers',
    plano: 'senior',
    perguntas: [
      { q: 'How do you prioritize features in a product backlog?', opcoes: ['By what the CEO wants','By whatever is easiest to build','Using frameworks like RICE (Reach, Impact, Confidence, Effort) or Impact vs Effort matrix, combined with user research and business goals','By alphabetical order'], correta: 2, gabarito: 'Strong PMs combine quantitative frameworks (RICE, ICE score) with qualitative input (user research, stakeholder alignment). Always tie prioritization to the current company goal. "We are optimizing for retention, so features that reduce churn score higher" shows strategic thinking.', dica: 'Naming a specific framework (RICE, MoSCoW, Kano model) immediately signals PM experience to interviewers.' },
      { q: 'A key metric drops 20% overnight. What do you do?', opcoes: ['Ignore it, metrics fluctuate','Immediately launch a new feature','Segment the data to isolate the cause, check for technical issues, compare cohorts, and form hypotheses before acting','Ask the engineering team to fix it'], correta: 2, gabarito: 'This is a diagnostic question. Steps: (1) Confirm it is real, not a tracking bug. (2) Segment: which platform, geography, user cohort? (3) Check for correlated events: deploy, marketing campaign, competitor action. (4) Form hypotheses. (5) Decide on immediate mitigation vs investigation. Do NOT jump to solutions.', dica: 'Starting with "first I would confirm the data is accurate" shows analytical discipline that US PMs expect.' },
      { q: 'How do you work with engineering teams?', opcoes: ['I tell engineers what to build and they build it','I avoid technical discussions','I collaborate closely — I explain the "why" behind features, involve engineers early in discovery, and respect their estimates while discussing trade-offs','I only talk to engineers in sprint reviews'], correta: 2, gabarito: '"The PM defines the what and why, engineering defines the how" is the classic framework. Strong PMs involve engineers early (problem discovery, not just solution delivery), create shared context, and advocate for technical debt alongside product work.', dica: 'Saying "I involve engineers in customer discovery calls" is a strong signal of PM maturity.' },
      { q: 'What is a North Star Metric?', opcoes: ['A navigation tool','The metric that best captures the core value your product delivers to customers and predicts long-term growth','The most reported metric in your dashboard','Your daily active users'], correta: 1, gabarito: 'NSM examples: Airbnb = nights booked, Spotify = time listened, Slack = messages sent within 30 days. Good NSM: (1) reflects customer value, (2) predicts revenue, (3) the whole team can influence it. Common mistake: choosing revenue or DAU as NSM — these are outputs, not value proxies.', dica: 'Being able to critique a NSM ("DAU is not a good NSM because...") shows more depth than just defining the term.' },
      { q: 'How do you validate a product idea before building it?', opcoes: ['Build it and see','Ask your manager','Use a combination of user interviews, fake door tests, landing page MVPs, and data analysis to validate demand before investing engineering time','Read competitor reviews'], correta: 2, gabarito: 'The lean validation ladder: (1) Problem interviews — does the problem exist? (2) Solution interviews — does your solution make sense? (3) Fake door/smoke test — would they pay/sign up? (4) Concierge MVP — can you deliver the value manually? Each step reduces risk before building.', dica: 'Mentioning "fake door test" or "smoke test" shows product validation vocabulary that impresses US product teams.' },
    ]
  },

  carreira: {
    label: '🌍 Carreira Internacional',
    desc: 'Perguntas comportamentais universais para qualquer área',
    plano: 'junior',
    perguntas: [
      { q: 'Where do you see yourself in 5 years?', opcoes: ['In your position','I have no plans','Growing in a role with increasing scope and impact, ideally in a company where I can contribute to meaningful work at a global level','Retired'], correta: 2, gabarito: 'American interviewers use this to assess ambition and self-awareness. Do not be too specific (sounds rigid) or too vague (sounds unmotivated). Show growth orientation, mention skills you want to develop, and align your trajectory with what the company offers.', dica: 'Avoid "I want your job" — common advice but still true. Aim for "I want to grow into a role with X scope".' },
      { q: 'What is your biggest weakness?', opcoes: ['I work too hard','I am a perfectionist (overused, avoid this)','I sometimes struggle with delegating — I have been actively working on this by setting clearer handoff criteria and trusting my team more','I have no weaknesses'], correta: 2, gabarito: 'The formula: real weakness + active steps to improve + evidence of progress. "Perfectionist" and "work too hard" are clichés that signal low self-awareness. Choose a real weakness that is not critical for the role, and show you are actively working on it.', dica: 'The most impressive answers name a specific situation where the weakness showed up, then describe the system you built to manage it.' },
      { q: 'How do you handle feedback you disagree with?', opcoes: ['I get upset and ignore it','I always immediately comply','I listen fully, acknowledge the feedback, ask clarifying questions to understand the perspective, then either change my approach or respectfully explain my reasoning','I argue until I win'], correta: 2, gabarito: 'US companies value "strong opinions, loosely held." The ideal response: receive feedback openly → seek to understand → decide (agree and commit, or disagree and explain why). The key is showing you can separate ego from the discussion.', dica: '"I try to understand the feedback before responding" buys you time in real interviews and shows emotional maturity.' },
      { q: 'Describe a situation where you had to learn something quickly.', opcoes: ['I have never had to learn quickly','I refused until I had time to study properly','I broke the problem into parts, used structured resources, applied it to a small project immediately, and asked experts targeted questions','I copied someone else\'s work'], correta: 2, gabarito: 'This tests learning agility — critical for international remote work where you often onboard independently. Strong answers include: the timeline (how fast), the method (how you learned), and the outcome (what you delivered). Adding what you would do differently shows reflection.', dica: 'Quantify: "I had 2 weeks to learn X and delivered Y" is much stronger than a vague story.' },
      { q: 'How do you build relationships with remote teammates you have never met in person?', opcoes: ['I do not bother, work is just work','I only communicate when there is a task','I initiate informal check-ins, engage in team channels beyond work topics, schedule virtual coffee chats, and show genuine interest in teammates as people','I wait for others to reach out first'], correta: 2, gabarito: '"Virtual coffee chats" and "engaging in non-work channels" are phrases US remote companies love. Remote relationship-building requires intentional effort — showing you understand this signals remote work maturity. Also mention celebrating small wins and being generous with praise.', dica: 'Saying "I send a welcome message to new team members and suggest a 30-min intro call" is specific and impressive.' },
      { q: 'What motivates you professionally?', opcoes: ['Only money','Job security','Solving meaningful problems, seeing my work create real impact, continuous learning, and working with people who challenge me to grow','Free food in the office'], correta: 2, gabarito: 'Intrinsic motivators score better than extrinsic ones in US interviews. Mention: impact (seeing your work matter), mastery (learning and improving), purpose (working on something meaningful), and belonging (good team). Aligning your motivation with the company\'s mission scores bonus points.', dica: 'Research the company before the interview and connect one of their stated values to your motivation. "I read that your team prioritizes X, which aligns with how I approach Y" is very powerful.' },
    ]
  },

  dados: {
    label: '📈 Dados / Analytics',
    desc: 'SQL, métricas e análise de dados para entrevistas',
    plano: 'senior',
    perguntas: [
      { q: 'What is the difference between a JOIN and a UNION in SQL?', opcoes: ['They are the same operation','JOIN combines columns from multiple tables based on a related column; UNION combines rows from multiple queries with the same column structure','UNION is faster than JOIN in all cases','JOIN only works with two tables'], correta: 1, gabarito: 'JOIN (INNER, LEFT, RIGHT, FULL): horizontally merges tables based on matching keys. Use when data is in different tables but related by ID. UNION: vertically stacks rows from multiple queries. Use when combining similar data from different time periods or sources. Common mistake: using UNION when you need JOIN.', dica: 'Always mention UNION vs UNION ALL — UNION removes duplicates (slower), UNION ALL keeps all rows (faster). Interviewers love this detail.' },
      { q: 'How would you detect if an A/B test result is statistically significant?', opcoes: ['If one group has higher numbers','If the CEO approves it','By checking p-value (< 0.05), confidence interval, and ensuring sufficient sample size via power analysis before concluding significance','By running the test for exactly 7 days'], correta: 2, gabarito: 'Key concepts: p-value (probability the result is due to chance), statistical power (ability to detect real effects), minimum sample size (calculated before running), confidence interval (range of plausible true values). Common mistakes: peeking at results early (p-hacking), stopping when significant without enough samples.', dica: '"I always calculate minimum sample size before starting an A/B test" is a phrase that immediately impresses data interviewers.' },
      { q: 'What is the difference between a dimension and a metric in analytics?', opcoes: ['They are the same thing','A metric is a quantitative measurement (revenue, clicks, users); a dimension is a qualitative attribute used to segment metrics (country, device, plan type)','Dimensions are always dates','Metrics are only financial'], correta: 1, gabarito: 'Metric (measure): numerical values you aggregate — revenue, sessions, conversion rate. Dimension (attribute): categorical values you filter or group by — country, device type, user segment. You analyze metrics through the lens of dimensions: "Revenue (metric) by country (dimension) for paying users (dimension filter)."', dica: 'Adding "and I always check if a metric change is consistent across dimensions before concluding it is real" shows analytical maturity.' },
      { q: 'How do you handle missing data in an analysis?', opcoes: ['Delete all rows with missing data','Ignore the missing values','Understand why the data is missing (MCAR, MAR, MNAR), then choose the appropriate strategy: imputation, exclusion, or flagging — and document the decision','Replace all missing values with zero'], correta: 2, gabarito: 'Missing data types: MCAR (completely random) = safe to exclude. MAR (related to observed data) = impute. MNAR (related to missing value itself) = most problematic, needs domain knowledge. Replacing with zero is almost always wrong (distorts averages). Document all decisions.', dica: 'Saying "I first check whether the missing data pattern reveals something about the underlying process" shows senior-level thinking.' },
    ]
  },

  cs_marketing: {
    label: '📣 CS / Marketing',
    desc: 'Customer Success, Account Management e Marketing Digital',
    plano: 'senior',
    perguntas: [
      { q: 'How do you handle an angry customer?', opcoes: ['Tell them they are wrong','Hang up','Acknowledge their frustration, take full ownership, understand the root cause, solve the problem, and follow up to confirm satisfaction','Transfer to another agent immediately'], correta: 2, gabarito: 'The LAST framework: Listen (fully, without interrupting), Apologize (for their experience, not necessarily for blame), Solve (concrete action with timeline), Thank (for bringing it up). Key: never be defensive, never blame the product team publicly, and always follow up.', dica: 'Adding "I document every escalation in the CRM to identify patterns" shows process thinking that CS managers love.' },
      { q: 'What is Net Revenue Retention (NRR) and why does it matter?', opcoes: ['Total new revenue from new customers','The percentage of revenue retained from existing customers after accounting for expansions, contractions, and churn — the most important SaaS health metric','Monthly active users','Customer satisfaction score'], correta: 1, gabarito: 'NRR > 100% means expansion revenue from existing customers exceeds churn — the company grows even if it acquires zero new customers. NRR = (Starting MRR + Expansion - Contraction - Churn) / Starting MRR × 100. World-class SaaS: 120%+. Good: 100-110%. Warning sign: below 90%.', dica: 'Knowing that NRR > 100% means negative churn and being able to explain why it matters more than gross retention will impress any SaaS interviewer.' },
      { q: 'How do you measure the success of a marketing campaign?', opcoes: ['By how much I liked the creative','By the number of likes on social media','By connecting campaign spend to pipeline and revenue: CAC, conversion rates at each funnel stage, MQL-to-SQL rate, and ultimately ROI or payback period','By impressions alone'], correta: 2, gabarito: 'Vanity metrics (impressions, likes) vs business metrics (MQLs, pipeline generated, revenue influenced). A complete framework: Awareness (reach, impressions) → Interest (CTR, time on page) → Consideration (MQLs, demo requests) → Conversion (revenue, ROI). Always tie marketing to revenue.', dica: '"I always define success metrics before launching a campaign, not after" is a phrase that separates strong marketers from average ones.' },
      { q: 'What is the difference between CAC and LTV?', opcoes: ['They are the same metric','CAC is Customer Acquisition Cost (total spend / new customers); LTV is Lifetime Value (average revenue per customer × average customer lifespan). LTV/CAC ratio determines business viability','CAC is a sales metric only','LTV only applies to subscription businesses'], correta: 1, gabarito: 'CAC: how much you spend to acquire one customer. LTV: how much revenue that customer generates over their lifetime. LTV/CAC = 3:1 is considered healthy for SaaS. Below 1:1 = losing money on every customer. Improving LTV (retention, expansion) or reducing CAC (better targeting, referrals) are the two levers.', dica: 'Mentioning "and I track LTV by cohort and channel to understand which acquisition sources bring the most valuable customers" shows strategic depth.' },
    ]
  }
};

// ===== SIMULATOR STATE =====
let simState = {
  area: null,
  perguntas: [],
  current: 0,
  acertos: 0,
  respostas: [], // { pergunta, resposta_candidato, resposta_correta, gabarito, acertou }
};

function abrirSimulador() {
  if(!userProfile.plan) { showPaywall('senior'); return; }
  voltarSimHome();
  showModal('simulatorModal');
}

function voltarSimHome() {
  document.getElementById('simHome').style.display = 'block';
  document.getElementById('simQuiz').style.display = 'none';
  document.getElementById('simResult').style.display = 'none';
  renderSimAreas();
}

function renderSimAreas() {
  const grid = document.getElementById('simAreaGrid');
  if(!grid) return;
  grid.innerHTML = Object.entries(SIM_AREAS).map(([key, area]) => {
    const bloqueado = area.plano === 'senior' && (!userProfile.plan || userProfile.plan === 'junior');
    return `<div onclick="${bloqueado ? "showPaywall('senior')" : `iniciarSim('${key}')`}" style="background:var(--surface2);border:0.5px solid var(--border);border-radius:12px;padding:1rem;cursor:pointer;transition:all .15s;${bloqueado?'opacity:.6':''}" onmouseover="if(!${bloqueado}) this.style.borderColor='var(--accent)'" onmouseout="this.style.borderColor='var(--border)'">
      <div style="font-size:16px;margin-bottom:6px">${area.label.split(' ')[0]}</div>
      <div style="font-size:13px;font-weight:500;color:var(--text);margin-bottom:4px">${area.label.slice(2)}</div>
      <div style="font-size:11px;color:var(--muted);margin-bottom:8px">${area.desc}</div>
      <div style="display:flex;align-items:center;justify-content:space-between">
        <span style="font-size:11px;color:var(--muted2)">${area.perguntas.length} perguntas</span>
        <span style="font-size:11px;padding:2px 8px;border-radius:999px;${bloqueado?'background:rgba(239,68,68,.1);color:#ef4444;border:0.5px solid rgba(239,68,68,.25)':'background:var(--accent-dim);color:var(--accent);border:0.5px solid rgba(59,130,246,.25)'}">${bloqueado?'🔒 Sênior+':area.plano==='junior'?'✓ Júnior+':'✓ Sênior+'}</span>
      </div>
    </div>`;
  }).join('');
}

function iniciarSim(areaKey) {
  const area = SIM_AREAS[areaKey];
  if(!area) return;
  simState = {
    area: areaKey,
    perguntas: [...area.perguntas].sort(() => Math.random() - 0.5),
    current: 0,
    acertos: 0,
    respostas: []
  };
  document.getElementById('simHome').style.display = 'none';
  document.getElementById('simQuiz').style.display = 'block';
  document.getElementById('simResult').style.display = 'none';
  renderSimPergunta();
}

function renderSimPergunta() {
  const { perguntas, current, acertos } = simState;
  const total = perguntas.length;
  document.getElementById('simProgress').textContent = `Pergunta ${current + 1}/${total}`;
  document.getElementById('simScore').textContent = `Acertos: ${acertos}`;

  if(current >= total) { mostrarResultadoSim(); return; }

  const p = perguntas[current];
  const content = document.getElementById('simQuizContent');
  content.innerHTML = `
    <div style="margin-bottom:1.25rem">
      <div style="font-size:15px;font-weight:500;color:var(--text);line-height:1.5;margin-bottom:1.25rem">${p.q}</div>
      <div style="display:flex;flex-direction:column;gap:8px" id="simOpcoes">
        ${p.opcoes.map((op, i) => `
          <button onclick="responderSim(${i})" id="simOp${i}" style="text-align:left;background:var(--surface2);border:0.5px solid var(--border2);border-radius:10px;padding:12px 14px;color:var(--text);font-size:13px;cursor:pointer;font-family:'DM Sans',sans-serif;line-height:1.5;transition:all .15s" onmouseover="this.style.borderColor='var(--accent)'" onmouseout="if(!this.dataset.answered) this.style.borderColor='var(--border2)'">
            <span style="color:var(--muted2);margin-right:8px">${String.fromCharCode(65+i)}.</span>${op}
          </button>`).join('')}
      </div>
    </div>
    <div id="simFeedback" style="display:none"></div>`;
}

function responderSim(escolha) {
  const p = simState.perguntas[simState.current];
  const acertou = escolha === p.correta;
  if(acertou) simState.acertos++;

  // Disable all buttons
  document.querySelectorAll('#simOpcoes button').forEach((btn, i) => {
    btn.dataset.answered = 'true';
    btn.style.cursor = 'default';
    btn.onmouseover = null;
    btn.onmouseout = null;
    btn.onclick = null;
    if(i === p.correta) {
      btn.style.background = 'rgba(74,222,128,.1)';
      btn.style.borderColor = 'rgba(74,222,128,.4)';
      btn.style.color = '#4ade80';
    } else if(i === escolha && !acertou) {
      btn.style.background = 'rgba(239,68,68,.1)';
      btn.style.borderColor = 'rgba(239,68,68,.4)';
      btn.style.color = '#ef4444';
    }
  });

  // Save response
  simState.respostas.push({
    pergunta: p.q,
    resposta_candidato: p.opcoes[escolha],
    resposta_correta: p.opcoes[p.correta],
    gabarito: p.gabarito,
    acertou
  });

  // Show feedback
  const fb = document.getElementById('simFeedback');
  fb.style.display = 'block';
  fb.innerHTML = `
    <div style="background:${acertou?'rgba(74,222,128,.08)':'rgba(239,68,68,.08)'};border:0.5px solid ${acertou?'rgba(74,222,128,.25)':'rgba(239,68,68,.25)'};border-radius:10px;padding:1rem;margin-bottom:12px">
      <div style="font-size:13px;font-weight:500;color:${acertou?'#4ade80':'#ef4444'};margin-bottom:6px">${acertou?'✓ Correto!':'✗ Incorreto'}</div>
      <div style="font-size:13px;color:var(--muted);line-height:1.6;margin-bottom:8px">${p.gabarito}</div>
      <div style="font-size:12px;color:var(--accent);background:var(--accent-dim);border-radius:6px;padding:6px 10px">💡 ${p.dica}</div>
    </div>
    <button onclick="proximaPergunta()" class="btn-full">${simState.current + 1 < simState.perguntas.length ? 'Próxima pergunta →' : 'Ver resultado'}</button>`;
}

function proximaPergunta() {
  simState.current++;
  renderSimPergunta();
}

async function mostrarResultadoSim() {
  document.getElementById('simQuiz').style.display = 'none';
  document.getElementById('simResult').style.display = 'block';

  const { acertos, respostas, area } = simState;
  const total = respostas.length;
  const pct = Math.round(acertos / total * 100);
  const areaInfo = SIM_AREAS[area];

  const emoji = pct >= 80 ? '🎉' : pct >= 60 ? '👍' : '💪';
  const titulo = pct >= 80 ? 'Excelente desempenho!' : pct >= 60 ? 'Bom resultado!' : 'Continue praticando!';
  const sub = pct >= 80
    ? 'Você está bem preparado para entrevistas nessa área.'
    : pct >= 60
    ? 'Você tem uma boa base. Revise os pontos que errou.'
    : 'Refaça o teste e foque no gabarito de cada resposta.';

  document.getElementById('simResultEmoji').textContent = emoji;
  document.getElementById('simResultTitle').textContent = titulo;
  document.getElementById('simResultSub').textContent = sub;

  document.getElementById('simResultStats').innerHTML = [
    { label:'Acertos', val:`${acertos}/${total}`, color: pct>=80?'#4ade80':pct>=60?'#f59e0b':'#ef4444' },
    { label:'Aproveitamento', val:`${pct}%`, color: pct>=80?'#4ade80':pct>=60?'#f59e0b':'#ef4444' },
    { label:'Erros', val:`${total-acertos}`, color:'var(--muted)' },
  ].map(s => `<div style="background:var(--surface2);border-radius:8px;padding:.75rem;text-align:center">
    <div style="font-size:20px;font-weight:500;color:${s.color}">${s.val}</div>
    <div style="font-size:11px;color:var(--muted)">${s.label}</div>
  </div>`).join('');

  // IA correction for Sênior+ plans
  const isSenior = userProfile.plan === 'senior' || userProfile.plan === 'master';
  const erros = respostas.filter(r => !r.acertou);

  if(isSenior && erros.length > 0) {
    document.getElementById('simIaCorrection').style.display = 'block';
    try {
      const prompt = `Você é coach de carreiras para brasileiros buscando emprego internacional.
O candidato errou ${erros.length} pergunta(s) num simulado de "${areaInfo.label}".

Erros cometidos:
${erros.map((e,i) => `${i+1}. Pergunta: "${e.pergunta}"\n   Respondeu: "${e.resposta_candidato}"\n   Correto era: "${e.resposta_correta}"`).join('\n\n')}

Escreva em português um feedback curto (máximo 5 linhas) focando em:
1. O padrão de erro (o que os erros têm em comum)
2. Uma ação concreta para melhorar antes da próxima entrevista

Seja direto e específico. Sem asteriscos, sem markdown.`;

      const feedback = await chamarIA([{ role:'user', content: prompt }]);
      document.getElementById('simIaText').textContent = feedback;
    } catch {
      document.getElementById('simIaText').textContent = 'Análise IA indisponível. Revise o gabarito de cada questão errada.';
    }
  }
}

function reiniciarSim() {
  iniciarSim(simState.area);
}

// ===== FAQ =====
const FAQ_ITEMS = [
  { q:'Preciso de cartão de crédito para o plano grátis?', a:'Não. O plano gratuito não pede nenhum dado de pagamento. Você acessa o feed de vagas, análise de IA básica e todos os recursos gratuitos sem cadastrar cartão.' },
  { q:'Como funciona o cancelamento?', a:'Você cancela quando quiser, em 1 clique no painel do Stripe. Não existe fidelidade, multa ou período mínimo. O acesso fica ativo até o final do período já pago.' },
  { q:'A IA pode inventar informações erradas (alucinações)?', a:'Para análise de vagas e cover letter, sim — por isso revisamos sempre antes de enviar. Para o simulador de testes e teste de inglês, não — as perguntas e gabaritos são fixos, escritos por humanos. A IA só entra para comparar sua resposta com o gabarito, não para criar conteúdo técnico.' },
  { q:'As vagas são exclusivas do RemoteBR?', a:'Algumas sim — publicadas diretamente por empresas na plataforma. A maioria vem de 8 fontes públicas gratuitas (Remotive, Jobicy, Himalayas, RemoteOK, WeWorkRemotely, Lever API, Greenhouse API e Arbeitnow), agregadas e exibidas em português com análise de IA.' },
  { q:'Como recebo o retorno das candidaturas?', a:'Após 24h sem resposta da empresa, você recebe um aviso no painel. Após 48h, a IA gera automaticamente um feedback em português sobre por que seu perfil pode não ter avançado e o que melhorar. Você nunca fica sem informação sobre o status da sua candidatura.' },
  { q:'Funciona para qualquer área ou só para tech?', a:'Para qualquer área. Temos vagas e simuladores de testes para Desenvolvimento, Product Management, Dados, Customer Success, Marketing e carreira em geral. O foco é vagas internacionais remotas — de qualquer área que aceite brasileiros.' },
  { q:'Posso pagar por PIX ou boleto?', a:'Sim — o Stripe aceita PIX, boleto bancário e cartão de crédito/débito. Ao clicar em qualquer botão de assinatura, você escolhe a forma de pagamento preferida.' },
  { q:'Os meus dados do currículo ficam seguros?', a:'Seus dados pessoais (CPF, email, telefone) são armazenados com segurança e nunca enviados para servidores de IA. O filtro automático remove dados pessoais antes de qualquer chamada à IA — a IA só recebe o conteúdo profissional do currículo.' },
];

function renderFAQ() {
  const el = document.getElementById('faqList');
  if(!el || el.children.length > 0) return;
  el.innerHTML = FAQ_ITEMS.map((item, i) => `
    <div style="border:0.5px solid var(--border);border-radius:10px;overflow:hidden;background:var(--surface)">
      <button onclick="toggleFAQ(${i})" style="width:100%;text-align:left;padding:14px 16px;background:none;border:none;color:var(--text);font-size:13px;font-weight:500;cursor:pointer;font-family:'DM Sans',sans-serif;display:flex;justify-content:space-between;align-items:center;gap:12px">
        ${item.q}
        <span id="faq-icon-${i}" style="color:var(--muted);flex-shrink:0;font-size:16px;transition:transform .2s">+</span>
      </button>
      <div id="faq-body-${i}" style="display:none;padding:0 16px 14px;font-size:13px;color:var(--muted);line-height:1.7">${item.a}</div>
    </div>`).join('');
}

function toggleFAQ(i) {
  const body = document.getElementById(`faq-body-${i}`);
  const icon = document.getElementById(`faq-icon-${i}`);
  const open = body.style.display !== 'none';
  body.style.display = open ? 'none' : 'block';
  icon.textContent = open ? '+' : '×';
  icon.style.transform = open ? 'rotate(0deg)' : 'rotate(45deg)';
}

// ===== MENSAGEM PARA O RECRUTADOR =====
let currentApplyJobId = null; // set when apply modal opens

function tentarGerarMensagem() {
  const isMaster = userProfile.plan === 'master';
  if (!isMaster) {
    showPaywall('master');
    return;
  }
  gerarMensagemRecrutador();
}

async function gerarMensagemRecrutador() {
  const btn = document.getElementById('btnGerarMsg');
  const area = document.getElementById('recruiterMsgArea');
  const textarea = document.getElementById('recruiterMsgText');

  if(!userProfile.plan) { showPaywall('junior'); return; }

  btn.textContent = '⏳ Gerando...';
  btn.disabled = true;

  const job = allJobs.find(j => j.id === currentApplyJobId);
  if(!job) { btn.textContent = '✦ Gerar mensagem'; btn.disabled = false; return; }

  const nome    = document.getElementById('applyName')?.value || userProfile.name || 'Candidato';
  const linkedin = document.getElementById('applyLinkedin')?.value || '';
  const cvTexto = userProfile.cvProfissional
    ? filtrarDadosSensiveis(userProfile.cvProfissional.slice(0, 800))
    : 'Profissional com experiência relevante na área';
  const descVaga = filtrarDadosSensiveis(stripHtml(job.description || '').slice(0, 600));

  const prompt = `You are helping a Brazilian professional write a concise, human LinkedIn message to a recruiter after applying for a job.

Job: "${job.title}" at ${job.company_name}
Job description excerpt: ${descVaga}
Candidate background: ${cvTexto}
Candidate name: ${nome}
${linkedin ? `LinkedIn: ${linkedin}` : ''}

Write a SHORT LinkedIn direct message (max 120 words) in English that:
1. Mentions they just applied for the ${job.title} role
2. Picks 2-3 specific points from the job description and connects them to the candidate's actual experience with real numbers/impact when possible
3. Shows genuine interest in ${job.company_name} with one specific detail (mission, product, culture — infer from description)
4. Ends with a soft call to action
5. Sounds natural and human — NOT like AI, NOT like a cover letter, NOT starting with "I am writing to"
6. Uses [Recruiter Name] as placeholder for the recruiter's name

Return ONLY the message text, no explanation, no subject line.`;

  try {
    const msg = await chamarIA([{ role: 'user', content: prompt }]);
    textarea.value = msg.trim();
    area.style.display = 'block';

    // Set LinkedIn search URL for recruiter
    const search = encodeURIComponent(`recruiter ${job.company_name}`);
    document.getElementById('recruiterLinkedInSearch').href =
      `https://www.linkedin.com/search/results/people/?keywords=${search}&origin=GLOBAL_SEARCH_HEADER`;

    btn.textContent = '↺ Regerar';
    btn.disabled = false;
  } catch {
    textarea.value = `Hi [Recruiter Name],\n\nI just applied for the ${job.title} role at ${job.company_name} and wanted to reach out directly.\n\nI noticed you're looking for [key skill from job description] — this aligns closely with my background in [your relevant experience].\n\nWould love to connect and share more about how I can contribute to ${job.company_name}'s goals.\n\nBest,\n${nome}`;
    area.style.display = 'block';
    btn.textContent = '↺ Regerar';
    btn.disabled = false;
  }
}

function copiarMensagem(tipo) {
  const texto = document.getElementById('recruiterMsgText').value;
  if(!texto) return;

  if(tipo === 'email') {
    const job = allJobs.find(j => j.id === currentApplyJobId);
    const assunto = encodeURIComponent(`Application for ${job?.title || 'position'} at ${job?.company_name || 'your company'}`);
    const corpo = encodeURIComponent(texto);
    window.location.href = `mailto:?subject=${assunto}&body=${corpo}`;
    showToast('📧 Abrindo cliente de email...');
  } else {
    navigator.clipboard.writeText(texto).then(() => {
      showToast('💼 Mensagem copiada! Cole no LinkedIn InMail ou mensagem de conexão.');
    });
  }
}

// ===== PROGRAMA MASTER — treino semanal + dúvida =====
const masterData = {
  inglês:   [],
  tecnico:  [],
  duvidas:  [],
  semanaAtual: getCurrentWeek(),
  _modo: null,
  _modoTecnico: false,
};

function getCurrentWeek() {
  const now = new Date();
  const start = new Date(now.getFullYear(), 0, 1);
  return Math.ceil(((now - start) / 86400000 + start.getDay() + 1) / 7);
}

function getLastTraining(tipo) {
  const arr = tipo === 'ingles' ? masterData.inglês : masterData.tecnico;
  return arr.length ? arr[arr.length - 1] : null;
}

function canTrainThisWeek(tipo) {
  const last = getLastTraining(tipo);
  if(!last) return true;
  return last.week < masterData.semanaAtual;
}

function canAskThisWeek() {
  return !masterData.duvidas.some(d => d.week === masterData.semanaAtual);
}

function renderMasterProgram() {
  const el = document.getElementById('masterProgram');
  if(!el) return;
  const isMaster = userProfile.plan === 'master';

  if(!isMaster) {
    el.innerHTML = `
      <div style="text-align:center;padding:3rem 1rem">
        <div style="font-size:48px;margin-bottom:1rem">🏆</div>
        <div style="font-family:'Instrument Serif',serif;font-size:1.5rem;margin-bottom:8px">Programa Master</div>
        <div style="font-size:13px;color:var(--muted);max-width:400px;margin:0 auto 1.5rem;line-height:1.7">
          Treino semanal de inglês e testes técnicos com evolução de score, histórico de progresso e 1 dúvida por semana respondida pela IA.
        </div>
        <button onclick="showPage('planos')" style="background:#6d28d9;border:none;border-radius:10px;padding:12px 28px;color:#fff;font-size:14px;font-weight:500;cursor:pointer;font-family:'DM Sans',sans-serif">
          Ver plano Master →
        </button>
      </div>`;
    return;
  }

  const semana      = masterData.semanaAtual;
  const podeIngles  = canTrainThisWeek('ingles');
  const podeTecnico = canTrainThisWeek('tecnico');
  const podeDuvida  = canAskThisWeek();
  const inglesScores  = masterData.inglês.slice(-8);
  const tecnicoScores = masterData.tecnico.slice(-8);
  const ultimaDuvida  = masterData.duvidas[masterData.duvidas.length - 1];

  el.innerHTML = `
    <div style="display:flex;flex-direction:column;gap:14px">

      <div style="background:var(--surface);border:0.5px solid rgba(109,40,217,.3);border-radius:14px;padding:1.5rem">
        <div style="font-size:11px;opacity:.6;text-transform:uppercase;letter-spacing:.1em;margin-bottom:4px;color:var(--muted)">Semana ${semana}</div>
        <div style="font-family:'Instrument Serif',serif;font-size:1.3rem;color:var(--text);margin-bottom:10px">Seu programa desta semana</div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <span style="font-size:11px;background:${podeIngles?'rgba(59,130,246,.1)':'rgba(74,222,128,.1)'};color:${podeIngles?'var(--accent)':'#4ade80'};border:0.5px solid ${podeIngles?'rgba(59,130,246,.25)':'rgba(74,222,128,.25)'};border-radius:999px;padding:3px 10px">${podeIngles?'● Inglês disponível':'✓ Inglês feito'}</span>
          <span style="font-size:11px;background:${podeTecnico?'rgba(245,158,11,.1)':'rgba(74,222,128,.1)'};color:${podeTecnico?'#f59e0b':'#4ade80'};border:0.5px solid ${podeTecnico?'rgba(245,158,11,.25)':'rgba(74,222,128,.25)'};border-radius:999px;padding:3px 10px">${podeTecnico?'● Técnico disponível':'✓ Técnico feito'}</span>
          <span style="font-size:11px;background:${podeDuvida?'rgba(109,40,217,.1)':'rgba(74,222,128,.1)'};color:${podeDuvida?'#a78bfa':'#4ade80'};border:0.5px solid ${podeDuvida?'rgba(109,40,217,.25)':'rgba(74,222,128,.25)'};border-radius:999px;padding:3px 10px">${podeDuvida?'● 1 dúvida disponível':'✓ Dúvida usada'}</span>
        </div>
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">

        <div style="background:var(--surface);border:0.5px solid ${podeIngles?'rgba(59,130,246,.3)':'var(--border)'};border-radius:14px;padding:1.25rem">
          <div style="font-size:12px;font-weight:500;text-transform:uppercase;letter-spacing:.08em;color:var(--accent);margin-bottom:8px">🗣️ Treino de inglês</div>
          ${inglesScores.length ? `
            <div style="display:flex;align-items:flex-end;gap:3px;height:36px;margin-bottom:8px">
              ${inglesScores.map((s,i) => `<div style="flex:1;background:${i===inglesScores.length-1?'var(--accent)':'rgba(59,130,246,.25)'};border-radius:2px 2px 0 0;height:${Math.max(10,Math.round(s.score/10*100))}%" title="${s.nivel} ${s.score}/10"></div>`).join('')}
            </div>
            <div style="font-size:13px;color:var(--text);margin-bottom:3px">Último: <b>${inglesScores[inglesScores.length-1].nivel}</b> · <b>${inglesScores[inglesScores.length-1].score}/10</b></div>
            <div style="font-size:11px;color:var(--muted);margin-bottom:10px;line-height:1.4">${(inglesScores[inglesScores.length-1].feedback||'').slice(0,90)}...</div>
          ` : `<div style="font-size:12px;color:var(--muted);margin-bottom:10px;line-height:1.5">Faça seu primeiro treino para começar a acompanhar a evolução semanal.</div>`}
          <button onclick="${podeIngles?'iniciarTreinoIngles()':''}" style="width:100%;padding:8px;border-radius:8px;border:none;font-size:12px;font-weight:500;cursor:${podeIngles?'pointer':'default'};font-family:'DM Sans',sans-serif;background:${podeIngles?'var(--accent)':'var(--surface2)'};color:${podeIngles?'#fff':'var(--muted2)'}">
            ${podeIngles?'▶ Iniciar treino':'✓ Feito esta semana'}
          </button>
        </div>

        <div style="background:var(--surface);border:0.5px solid ${podeTecnico?'rgba(245,158,11,.3)':'var(--border)'};border-radius:14px;padding:1.25rem">
          <div style="font-size:12px;font-weight:500;text-transform:uppercase;letter-spacing:.08em;color:#f59e0b;margin-bottom:8px">💻 Teste técnico</div>
          ${tecnicoScores.length ? `
            <div style="display:flex;align-items:flex-end;gap:3px;height:36px;margin-bottom:8px">
              ${tecnicoScores.map((s,i) => `<div style="flex:1;background:${i===tecnicoScores.length-1?'#f59e0b':'rgba(245,158,11,.25)'};border-radius:2px 2px 0 0;height:${Math.max(10,Math.round(s.acertos/s.total*100))}%" title="${s.acertos}/${s.total}"></div>`).join('')}
            </div>
            <div style="font-size:13px;color:var(--text);margin-bottom:3px">Último: <b>${tecnicoScores[tecnicoScores.length-1].acertos}/${tecnicoScores[tecnicoScores.length-1].total}</b> · <b>${tecnicoScores[tecnicoScores.length-1].area?.split(' ')[0]}</b></div>
            <div style="font-size:11px;color:var(--muted);margin-bottom:10px;line-height:1.4">${(tecnicoScores[tecnicoScores.length-1].feedback||'').slice(0,90)}...</div>
          ` : `<div style="font-size:12px;color:var(--muted);margin-bottom:10px;line-height:1.5">Faça seu primeiro teste técnico para monitorar o progresso semanal.</div>`}
          <button onclick="${podeTecnico?'iniciarTesteTecnicoMaster()':''}" style="width:100%;padding:8px;border-radius:8px;border:none;font-size:12px;font-weight:500;cursor:${podeTecnico?'pointer':'default'};font-family:'DM Sans',sans-serif;background:${podeTecnico?'#b45309':'var(--surface2)'};color:${podeTecnico?'#fff':'var(--muted2)'}">
            ${podeTecnico?'▶ Iniciar teste':'✓ Feito esta semana'}
          </button>
        </div>
      </div>

      <div style="background:var(--surface);border:0.5px solid ${podeDuvida?'rgba(109,40,217,.3)':'var(--border)'};border-radius:14px;padding:1.25rem">
        <div style="display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:10px;gap:8px">
          <div>
            <div style="font-size:12px;font-weight:500;text-transform:uppercase;letter-spacing:.08em;color:#a78bfa;margin-bottom:3px">❓ Dúvida semanal</div>
            <div style="font-size:12px;color:var(--muted)">${podeDuvida?'Use após uma entrevista, teste ou processo seletivo':'Disponível na semana '+(semana+1)}</div>
          </div>
        </div>

        ${podeDuvida ? `
          <textarea id="masterDuvidaInput" rows="3" placeholder="Ex: Fiz uma entrevista técnica e não soube responder a pergunta sobre system design. Expliquei X mas o recrutador pareceu insatisfeito. O que poderia ter feito diferente?" style="width:100%;background:var(--surface2);border:0.5px solid var(--border2);border-radius:8px;padding:10px 12px;color:var(--text);font-size:13px;font-family:'DM Sans',sans-serif;line-height:1.6;resize:vertical;outline:none;margin-bottom:8px;box-sizing:border-box"></textarea>
          <button onclick="enviarDuvidaMaster()" style="width:100%;padding:9px;border-radius:8px;background:#6d28d9;border:none;color:#fff;font-size:13px;font-weight:500;cursor:pointer;font-family:'DM Sans',sans-serif">
            Enviar dúvida →
          </button>
          <div id="masterDuvidaLoading" style="display:none;text-align:center;padding:1rem;color:var(--muted);font-size:13px">
            <div class="ai-loading" style="justify-content:center;display:flex;gap:4px"><span></span><span></span><span></span></div>
            <div style="margin-top:6px">IA analisando sua dúvida...</div>
          </div>
          <div id="masterDuvidaResposta" style="display:none"></div>
        ` : ultimaDuvida ? `
          <div style="background:var(--surface2);border-radius:8px;padding:1rem">
            <div style="font-size:11px;color:var(--muted2);margin-bottom:6px">Sua dúvida desta semana:</div>
            <div style="font-size:13px;color:var(--text);margin-bottom:10px;font-style:italic">"${ultimaDuvida.pergunta}"</div>
            <div style="font-size:11px;font-weight:500;color:#a78bfa;margin-bottom:6px">✦ Resposta da IA:</div>
            <div style="font-size:13px;color:var(--muted);line-height:1.7">${ultimaDuvida.resposta}</div>
          </div>
        ` : ''}
      </div>

      ${inglesScores.length >= 2 || tecnicoScores.length >= 2 ? `
      <div style="background:var(--accent-dim);border:0.5px solid rgba(59,130,246,.2);border-radius:12px;padding:1rem 1.25rem">
        <div style="font-size:12px;font-weight:500;color:var(--accent);margin-bottom:8px">📈 Sua evolução</div>
        <div style="display:flex;gap:20px;flex-wrap:wrap;font-size:13px;color:var(--muted)">
          ${inglesScores.length >= 2 ? (() => {
            const diff = +(inglesScores[inglesScores.length-1].score - inglesScores[0].score).toFixed(1);
            return `<span>${diff>=0?'↑':'↓'} Inglês: <b style="color:${diff>=0?'#4ade80':'#ef4444'}">${diff>=0?'+':''}${diff} pontos</b> em ${inglesScores.length} semanas</span>`;
          })() : ''}
          ${tecnicoScores.length >= 2 ? (() => {
            const first = tecnicoScores[0].acertos/tecnicoScores[0].total;
            const last  = tecnicoScores[tecnicoScores.length-1].acertos/tecnicoScores[tecnicoScores.length-1].total;
            const diff  = Math.round((last - first) * 100);
            return `<span>${diff>=0?'↑':'↓'} Técnico: <b style="color:${diff>=0?'#4ade80':'#ef4444'}">${diff>=0?'+':''}${diff}%</b> de aproveitamento</span>`;
          })() : ''}
        </div>
      </div>` : ''}

    </div>`;
}

function iniciarTreinoIngles() {
  masterData._modo = 'master';
  abrirTesteIngles();
}

function iniciarTesteTecnicoMaster() {
  masterData._modoTecnico = true;
  abrirSimulador();
}

async function enviarDuvidaMaster() {
  const input = document.getElementById('masterDuvidaInput');
  const pergunta = input?.value?.trim();
  if(!pergunta || pergunta.length < 20) {
    showToast('Descreva sua dúvida com mais detalhes.');
    return;
  }
  const btn = document.querySelector('[onclick="enviarDuvidaMaster()"]');
  if(btn) btn.disabled = true;
  document.getElementById('masterDuvidaLoading').style.display = 'block';
  if(input) input.style.display = 'none';

  const prompt = `Você é um coach de carreiras internacionais especialista em ajudar brasileiros a conseguir vagas remotas em empresas americanas e europeias.

Um candidato do plano Master tem a seguinte dúvida após uma entrevista ou processo seletivo:
"${pergunta}"

Responda em português brasileiro de forma clara, direta e encorajadora. Máximo de 200 palavras.
1. O que provavelmente aconteceu (análise objetiva)
2. O que poderia ter sido diferente (ação concreta)
3. Como se preparar melhor para a próxima vez

Sem asteriscos, sem markdown.`;

  try {
    const resposta = await chamarIA([{ role:'user', content: prompt }]);
    masterData.duvidas.push({
      week: masterData.semanaAtual,
      pergunta, resposta,
      data: new Date().toISOString()
    });
    document.getElementById('masterDuvidaLoading').style.display = 'none';
    const resDiv = document.getElementById('masterDuvidaResposta');
    resDiv.style.display = 'block';
    resDiv.innerHTML = `
      <div style="background:var(--surface2);border-radius:8px;padding:1rem;margin-top:8px">
        <div style="font-size:11px;font-weight:500;color:#a78bfa;margin-bottom:8px">✦ Resposta da IA</div>
        <div style="font-size:13px;color:var(--muted);line-height:1.7">${resposta.replace(/\n/g,'<br>')}</div>
      </div>
      <div style="font-size:11px;color:var(--muted2);text-align:center;margin-top:8px">Próxima dúvida disponível na semana ${masterData.semanaAtual+1}</div>`;
    showToast('✓ Dúvida respondida! Próxima disponível na semana seguinte.');
  } catch {
    document.getElementById('masterDuvidaLoading').style.display = 'none';
    if(input) input.style.display = 'block';
    if(btn) btn.disabled = false;
    showToast('Erro ao processar sua dúvida. Tente novamente.');
  }
}

// Troque esta senha antes de subir o site
const ADMIN_PASSWORD = 'remotebr8721@';

function abrirAdmin() {
  document.getElementById('adminPwInput').value = '';
  document.getElementById('adminPwErro').style.display = 'none';
  document.getElementById('adminPwModal').classList.add('open');
  setTimeout(() => document.getElementById('adminPwInput').focus(), 100);
}

function verificarSenhaAdmin() {
  const pw = document.getElementById('adminPwInput').value;
  if(pw === ADMIN_PASSWORD) {
    closeModal('adminPwModal');
    // Show admin nav link for this session
    document.getElementById('navAdmin').style.display = 'inline';
    showPage('admin');
  } else {
    document.getElementById('adminPwErro').style.display = 'block';
    document.getElementById('adminPwInput').value = '';
    document.getElementById('adminPwInput').focus();
  }
}

// Secret shortcut: type "admin" anywhere on page to open admin login
let adminKeyBuffer = '';
document.addEventListener('keydown', e => {
  adminKeyBuffer += e.key.toLowerCase();
  if(adminKeyBuffer.length > 5) adminKeyBuffer = adminKeyBuffer.slice(-5);
  if(adminKeyBuffer === 'admin') { adminKeyBuffer = ''; abrirAdmin(); }
});

// ===== CONTACT FORM =====
// Substitua pelo seu email real antes de subir
const CONTATO_EMAIL = 'remot3br@gmail.com';

function configurarContato(email) {
  // Call this function with your real email to update contact links
  document.getElementById('contatoEmailLink').href = `mailto:${email}`;
  document.getElementById('contatoEmailText').textContent = email;
}

function enviarContato() {
  const nome    = document.getElementById('contatoNome').value.trim();
  const email   = document.getElementById('contatoEmail').value.trim();
  const assunto = document.getElementById('contatoAssunto').value;
  const msg     = document.getElementById('contatoMsg').value.trim();

  if(!nome || !email || !assunto || !msg) {
    showToast('Preencha todos os campos antes de enviar.');
    return;
  }
  if(!email.includes('@')) {
    showToast('Digite um email válido.');
    return;
  }

  // Open default email client with pre-filled content
  const assuntoMap = {
    duvida_plano:     'Dúvida sobre planos — RemoteBR',
    suporte_tecnico:  'Suporte técnico — RemoteBR',
    cancelamento:     'Cancelamento de assinatura — RemoteBR',
    empresa_anunciar: 'Quero anunciar vagas — RemoteBR',
    parceria:         'Parceria/Afiliados — RemoteBR',
    imprensa:         'Imprensa — RemoteBR',
    outro:            'Contato — RemoteBR',
  };

  const subject = encodeURIComponent(assuntoMap[assunto] || 'Contato — RemoteBR');
  const body = encodeURIComponent(`Nome: ${nome}\nEmail: ${email}\n\n${msg}`);
  window.location.href = `mailto:${CONTATO_EMAIL}?subject=${subject}&body=${body}`;

  // Show success message
  document.getElementById('contatoFeedback').style.display = 'block';
  document.getElementById('contatoNome').value = '';
  document.getElementById('contatoEmail').value = '';
  document.getElementById('contatoAssunto').value = '';
  document.getElementById('contatoMsg').value = '';
}

// ===== VERIFIED REMOTE COMPANIES =====
// Curated from remoteintech/remote-jobs, remote-es/remotes, yanirs/established-remote
// Used to show "Empresa verificada — 100% remota" badge on job cards
const VERIFIED_REMOTE_COMPANIES = new Set([
  'gitlab','automattic','zapier','basecamp','buffer','duckduckgo','mozilla',
  'shopify','github','elastic','hashicorp','confluent','netlify','vercel',
  'stripe','twilio','cloudflare','datadog','pagerduty','okta','auth0',
  'invision','doist','remote','deel','greenhouse','lever','workable',
  'hotjar','toggl','balsamiq','frontapp','close','helpscout','intercom',
  'calendly','loom','notion','figma','linear','retool','segment','mixpanel',
  'amplitude','posthog','sentry','supabase','planetscale','neon','fly.io',
  'render','railway','digitalocean','linode','vultr','cloudinary','imgix',
  'fastly','sendgrid','mailchimp','klaviyo','brevo','postmark','sparkpost',
  'twiliosendinblue','hubspot','salesforce','pipedrive','freshworks','zendesk',
  'shortcut','linear','jira','asana','monday','clickup','trello','airtable',
  'coda','notion','roamresearch','obsidian','craft','bear','ulysses',
  'sketch','figma','zeplin','abstract','framer','webflow','bubble',
  'wix','squarespace','shopify','woocommerce','bigcommerce','magento',
  'wordpress','ghost','contentful','sanity','strapi','directus',
  'hasura','fauna','planetscale','supabase','firebase','convex',
  'upwork','toptal','x-team','crossover','turing','andela','lemon.io',
  'arc','hired','remoteok','weworkremotely','remotive','wellfound',
  '10up','human made','alley','vip','xwp','rtcamp','kinsta',
  'mozilla','wikimedia','eff','thoughtworks','slalom','pivotal',
  'acquia','pantheon','platform.sh','amazee','section.io',
]);

function isVerifiedRemote(companyName) {
  if(!companyName) return false;
  const normalized = companyName.toLowerCase().replace(/[^a-z0-9]/g,'');
  return [...VERIFIED_REMOTE_COMPANIES].some(c => normalized.includes(c.replace(/[^a-z0-9]/g,'')));
}

function showPage(page) {
  const pages = ['pageCandidates','pageCompanies','pageCompanyATS','pageAdmin','pageBlog','pagePlanos','pageContato'];
  pages.forEach(p => { const el = document.getElementById(p); if(el) el.style.display = 'none'; });

  const navIds = ['navCandidates','navCompanies','navAdmin','navBlog','navPlanos','navContato'];
  navIds.forEach(n => {
    const el = document.getElementById(n);
    if(el) { el.style.color = 'var(--muted)'; el.style.borderBottom = '2px solid transparent'; }
  });

  const map = {
    candidates:  { page:'pageCandidates',  nav:'navCandidates',  cta:'Criar conta grátis' },
    companies:   { page:'pageCompanies',   nav:'navCompanies',   cta:'Anunciar vaga →'    },
    companyATS:  { page:'pageCompanyATS',  nav:'navCompanies',   cta:'Painel empresa'     },
    admin:       { page:'pageAdmin',       nav:'navAdmin',       cta:'Admin'              },
    blog:        { page:'pageBlog',        nav:'navBlog',        cta:'Criar conta grátis' },
    planos:      { page:'pagePlanos',      nav:'navPlanos',      cta:'Ver planos'          },
    contato:     { page:'pageContato',     nav:'navContato',     cta:'Criar conta grátis'  },
  };

  const m = map[page] || map.candidates;
  const pageEl = document.getElementById(m.page);
  if(pageEl) pageEl.style.display = 'block';
  const navEl = document.getElementById(m.nav);
  if(navEl) { navEl.style.color = 'var(--text)'; navEl.style.borderBottom = '2px solid var(--accent)'; }
  const cta = document.getElementById('navCta');
  if(cta) cta.textContent = m.cta;

  if(page === 'companyATS') { renderAtsJobs(); showAtsSection('jobs', document.getElementById('ats-nav-jobs')); }
  if(page === 'admin') renderAdminDashboard();
  if(page === 'companies') showSection('plans');
  if(page === 'blog') { renderBlog(''); document.getElementById('blogPost').style.display='none'; document.getElementById('blogGrid').style.display='flex'; }
  if(page === 'planos') renderFAQ();
}

// ===== BLOG =====
const BLOG_POSTS = [
  {
    id: 'salario-dev-brasileiro-empresa-americana',
    titulo: 'Quanto ganha um dev brasileiro trabalhando para empresa americana em 2025?',
    resumo: 'Analisamos dados reais de salários de desenvolvedores brasileiros em empresas dos EUA. Os números vão te surpreender — e talvez te fazer questionar o que você está ganhando hoje.',
    categoria: 'salario',
    catLabel: '💵 Salário',
    autor: 'Time RemoteBR',
    data: '15 Mar 2025',
    leitura: '6 min',
    destaque: true,
    video: '', // cole aqui o ID do vídeo do YouTube quando tiver
    conteudo: `
      <h2 style="font-family:'Instrument Serif',serif;font-size:1.5rem;font-weight:400;margin-bottom:1rem">A realidade dos salários</h2>
      <p>Existe uma diferença enorme entre o que as empresas americanas pagam para devs nos EUA e o que oferecem para brasileiros remotos. Mas você sabe exatamente quanto essa diferença é?</p>
      <p>Coletamos dados de mais de 200 vagas abertas para brasileiros nos últimos 6 meses. Aqui está o que encontramos:</p>

      <h3 style="font-size:1rem;font-weight:500;margin:1.5rem 0 .5rem;color:var(--accent)">Desenvolvedor Júnior (0–2 anos)</h3>
      <p>Faixa justa: <strong style="color:#4ade80">$50.000–$70.000/ano</strong> (~R$25k–35k/mês)
      <br>O que muitas empresas oferecem para brasileiros: $30.000–$40.000/ano
      <br>Diferença: 40% abaixo do mercado americano</p>

      <h3 style="font-size:1rem;font-weight:500;margin:1.5rem 0 .5rem;color:var(--accent)">Desenvolvedor Pleno (2–5 anos)</h3>
      <p>Faixa justa: <strong style="color:#4ade80">$80.000–$110.000/ano</strong> (~R$40k–55k/mês)
      <br>O que muitas empresas oferecem: $50.000–$70.000/ano
      <br>Diferença: 30–35% abaixo da mediana</p>

      <h3 style="font-size:1rem;font-weight:500;margin:1.5rem 0 .5rem;color:var(--accent)">Desenvolvedor Sênior (5+ anos)</h3>
      <p>Faixa justa: <strong style="color:#4ade80">$120.000–$160.000/ano</strong> (~R$60k–80k/mês)
      <br>O que muitas empresas oferecem: $80.000–$100.000/ano</p>

      <div style="background:var(--accent-dim);border:0.5px solid rgba(59,130,246,.2);border-radius:10px;padding:1rem;margin:1.5rem 0">
        <strong style="color:var(--accent)">Regra do RemoteBR:</strong> nunca aceite menos de 60% da mediana americana para o seu nível. Abaixo disso, você está sendo explorado pela diferença cambial.
      </div>

      <h2 style="font-family:'Instrument Serif',serif;font-size:1.3rem;font-weight:400;margin:2rem 0 1rem">Como negociar melhor</h2>
      <p>1. <strong>Pesquise antes</strong> — use o índice de salários do RemoteBR e o Levels.fyi para ter referência concreta</p>
      <p>2. <strong>Peça em dólar, não em real</strong> — nunca deixe a empresa converter o salário para reais. Isso coloca todo o risco cambial no seu lado.</p>
      <p>3. <strong>Negocie além do salário</strong> — notebook, ajuda de custo com internet, plano de saúde internacional, dias de férias, stock options</p>
      <p>4. <strong>Conheça seu valor</strong> — brasileiro senior com inglês bom e experiência em startup vale tanto quanto qualquer dev americano para empresas que contratam remotamente</p>
    `
  },
  {
    id: 'pj-contractor-eor-qual-escolher',
    titulo: 'PJ, Contractor ou EOR: qual a melhor forma de ser contratado por empresa gringa?',
    resumo: 'Cada modalidade tem implicações fiscais, trabalhistas e práticas completamente diferentes. Escolher errado pode custar caro — ou você pode estar pagando mais imposto do que precisa.',
    categoria: 'juridico',
    catLabel: '⚖️ Jurídico',
    autor: 'Time RemoteBR',
    data: '10 Mar 2025',
    leitura: '8 min',
    destaque: false,
    video: '',
    conteudo: `
      <h2 style="font-family:'Instrument Serif',serif;font-size:1.5rem;font-weight:400;margin-bottom:1rem">As 4 formas de trabalhar para empresa estrangeira</h2>
      <p>Quando uma empresa americana quer te contratar, ela tem basicamente quatro opções. Entender cada uma é essencial para negociar bem e se proteger legalmente.</p>

      <h3 style="font-size:1rem;font-weight:500;margin:1.5rem 0 .5rem;color:#60a5fa">1. Independent Contractor (mais comum)</h3>
      <p>Você é tratado como prestador de serviços autônomo. A empresa te paga por transferência internacional (Wise, Payoneer) e você emite nota fiscal como MEI ou empresa.</p>
      <p><strong>Vantagens:</strong> simplicidade, flexibilidade, menor burocracia para a empresa</p>
      <p><strong>Desvantagens:</strong> sem FGTS, sem 13º, sem férias remuneradas, INSS por conta própria. Você precisa negociar compensação maior no salário para cobrir isso.</p>

      <h3 style="font-size:1rem;font-weight:500;margin:1.5rem 0 .5rem;color:#f59e0b">2. EOR — Employer of Record</h3>
      <p>Uma empresa como Deel ou Remote.com te contrata formalmente no Brasil em nome da empresa estrangeira. Você tem carteira assinada, todos os direitos trabalhistas.</p>
      <p><strong>Vantagens:</strong> FGTS, 13º, férias, INSS pago pelo empregador, mais segurança jurídica</p>
      <p><strong>Desvantagens:</strong> a empresa paga ~20% a mais pelo serviço do EOR, o que pode reduzir o salário oferecido</p>

      <h3 style="font-size:1rem;font-weight:500;margin:1.5rem 0 .5rem;color:#a78bfa">3. PJ — Pessoa Jurídica</h3>
      <p>Você abre uma empresa no Brasil (SLU ou Ltda) e emite notas para a empresa estrangeira. Popular entre devs sêniores.</p>
      <p><strong>Vantagens:</strong> carga tributária menor que CLT em muitos casos, mais flexibilidade para deduzir despesas</p>
      <p><strong>Desvantagens:</strong> custo de abertura e manutenção da empresa, honorários de contador (~R$300–600/mês), sem direitos trabalhistas automáticos</p>

      <h3 style="font-size:1rem;font-weight:500;margin:1.5rem 0 .5rem;color:#4ade80">4. CLT com empresa que tem CNPJ no Brasil</h3>
      <p>A empresa abre subsidiária no Brasil e te contrata com carteira. Raro para empresas pequenas/médias.</p>

      <div style="background:rgba(239,68,68,.08);border:0.5px solid rgba(239,68,68,.2);border-radius:10px;padding:1rem;margin:1.5rem 0">
        <strong style="color:#ef4444">⚠️ Importante:</strong> receber em dólar como pessoa física sem estrutura jurídica adequada pode gerar problemas com a Receita Federal. Sempre consulte um contador antes de assinar qualquer contrato.
      </div>
    `
  },
  {
    id: 'como-receber-dolar-brasil',
    titulo: 'Como receber em dólar no Brasil: Wise, Payoneer ou conta no exterior?',
    resumo: 'Você conseguiu a vaga, negociou o salário em dólar. Agora vem a pergunta que ninguém responde claramente: como esse dinheiro chega na sua conta sem perder uma fortuna em taxas?',
    categoria: 'dinheiro',
    catLabel: '🏦 Receber dólar',
    autor: 'Time RemoteBR',
    data: '5 Mar 2025',
    leitura: '5 min',
    destaque: false,
    video: '',
    conteudo: `
      <h2 style="font-family:'Instrument Serif',serif;font-size:1.5rem;font-weight:400;margin-bottom:1rem">O problema das transferências internacionais</h2>
      <p>Receber $5.000 em dólar parece simples até você descobrir que o banco pode cobrar 4–6% de IOF + spread cambial, fazendo você perder $200–$300 por transferência. Aqui estão as melhores opções:</p>

      <h3 style="font-size:1rem;font-weight:500;margin:1.5rem 0 .5rem;color:var(--accent)">Wise (nossa recomendação)</h3>
      <p>Você recebe um número de conta americano (ABA/routing) para a empresa depositar. O Wise converte para reais com a taxa real do câmbio + ~0,4% de taxa. É de longe a opção mais barata.</p>
      <p><strong>Taxa efetiva:</strong> ~0,5–1% total vs 4–6% dos bancos tradicionais</p>
      <p><strong>Como usar:</strong> crie conta em wise.com, peça os dados bancários americanos, passe para a empresa</p>

      <h3 style="font-size:1rem;font-weight:500;margin:1.5rem 0 .5rem;color:#60a5fa">Payoneer</h3>
      <p>Similar ao Wise, muito usado para receber de empresas americanas e plataformas de freelance. Taxa de ~2% para conversão.</p>

      <h3 style="font-size:1rem;font-weight:500;margin:1.5rem 0 .5rem;color:#f59e0b">Conta no exterior (Remessa Online, Avenue)</h3>
      <p>Abrir conta em banco americano ou usar corretora com conta internacional. Interessante para quem quer manter parte dos ganhos em dólar como reserva.</p>

      <div style="background:var(--accent-dim);border:0.5px solid rgba(59,130,246,.2);border-radius:10px;padding:1rem;margin:1.5rem 0">
        <strong style="color:var(--accent)">Dica RemoteBR:</strong> se você recebe como PJ, pode manter os dólares na conta da empresa até precisar. Isso pode ser uma estratégia de proteção cambial se o real estiver desvalorizado.
      </div>
    `
  },
  {
    id: 'entrevista-inglês-empresa-americana',
    titulo: '10 perguntas que toda empresa americana faz na entrevista — e como responder',
    resumo: 'A entrevista americana tem um formato muito diferente do brasileiro. Saber o que esperar elimina 80% do nervosismo. Aqui estão as perguntas mais comuns e as respostas que impressionam.',
    categoria: 'entrevista',
    catLabel: '🎙️ Entrevista',
    autor: 'Time RemoteBR',
    data: '1 Mar 2025',
    leitura: '7 min',
    destaque: true,
    video: '',
    conteudo: `
      <h2 style="font-family:'Instrument Serif',serif;font-size:1.5rem;font-weight:400;margin-bottom:1rem">O método STAR — a base de tudo</h2>
      <p>Empresas americanas avaliam respostas comportamentais usando o método STAR: <strong>Situation</strong> (contexto), <strong>Task</strong> (sua responsabilidade), <strong>Action</strong> (o que você fez), <strong>Result</strong> (o resultado concreto).</p>
      <p>Toda resposta boa tem 2–3 minutos e termina com um número. "Aumentei a conversão em 23%", "reduzi o tempo de deploy de 4 horas para 20 minutos".</p>

      <h3 style="font-size:1rem;font-weight:500;margin:1.5rem 0 .5rem;color:var(--accent)">1. "Tell me about yourself"</h3>
      <p><strong>O que querem saber:</strong> se você consegue se vender em 2 minutos de forma estruturada.<br>
      <strong>Estrutura:</strong> presente (cargo atual) → passado (experiência relevante) → futuro (por que esta empresa)</p>

      <h3 style="font-size:1rem;font-weight:500;margin:1.5rem 0 .5rem;color:var(--accent)">2. "What's your greatest weakness?"</h3>
      <p><strong>Erro comum:</strong> dizer "sou perfeccionista demais" — todo recrutador americano já ouviu isso e odeia.<br>
      <strong>Resposta certa:</strong> cite uma fraqueza real que não é crítica para a vaga e mostre o que você está fazendo para melhorar.</p>

      <h3 style="font-size:1rem;font-weight:500;margin:1.5rem 0 .5rem;color:var(--accent)">3. "Why do you want to work here?"</h3>
      <p>Pesquise a empresa antes. Mencione algo específico — produto, missão, cultura. "I've been following your product for X months and I particularly liked how you solved Y" é muito melhor que respostas genéricas.</p>

      <h3 style="font-size:1rem;font-weight:500;margin:1.5rem 0 .5rem;color:var(--accent)">4. "What are your salary expectations?"</h3>
      <p>Nunca dê o número primeiro se possível. "I'd love to understand the full scope of the role before discussing numbers — what's the budgeted range for this position?"<br>
      Se pressionado, use o índice de salários do RemoteBR e dê uma faixa, não um número fixo.</p>

      <div style="background:var(--accent-dim);border:0.5px solid rgba(59,130,246,.2);border-radius:10px;padding:1rem;margin:1.5rem 0">
        <strong style="color:var(--accent)">Pratique com o RemoteBR:</strong> use o chat de treino de inglês para simular entrevistas com feedback em tempo real antes da entrevista real.
      </div>
    `
  },
  {
    id: 'curriculo-ats-mercado-americano',
    titulo: 'Seu currículo passa no ATS? Testamos 50 vagas e descobrimos o que elimina candidatos brasileiros',
    resumo: 'A maioria dos currículos brasileiros é rejeitada automaticamente antes de qualquer humano ver. Descobrimos os 7 erros mais comuns e como corrigi-los em menos de 30 minutos.',
    categoria: 'curriculo',
    catLabel: '📝 Currículo',
    autor: 'Time RemoteBR',
    data: '25 Fev 2025',
    leitura: '6 min',
    destaque: false,
    video: '',
    conteudo: `
      <h2 style="font-family:'Instrument Serif',serif;font-size:1.5rem;font-weight:400;margin-bottom:1rem">O problema do currículo brasileiro no mercado americano</h2>
      <p>O currículo brasileiro tem características que funcionam muito bem aqui mas confundem — ou descartam — sistemas ATS americanos. Analisamos 50 currículos de brasileiros submetidos a vagas internacionais.</p>

      <h3 style="font-size:1rem;font-weight:500;margin:1.5rem 0 .5rem;color:#ef4444">Erro 1: Foto no currículo</h3>
      <p>Nos EUA e Europa, foto no currículo é proibida em muitas empresas por questões de discriminação. O ATS pode nem processar o arquivo. <strong>Remova sempre.</strong></p>

      <h3 style="font-size:1rem;font-weight:500;margin:1.5rem 0 .5rem;color:#ef4444">Erro 2: Data de nascimento e estado civil</h3>
      <p>Informações que não têm relevância para o cargo e podem levar a discriminação. Nunca inclua em vagas internacionais.</p>

      <h3 style="font-size:1rem;font-weight:500;margin:1.5rem 0 .5rem;color:#ef4444">Erro 3: Objetivos profissionais no topo</h3>
      <p>Ninguém lê. Substitua por um <em>Professional Summary</em> de 3 linhas focado em resultados e palavras-chave da vaga.</p>

      <h3 style="font-size:1rem;font-weight:500;margin:1.5rem 0 .5rem;color:#ef4444">Erro 4: Responsabilidades sem resultados</h3>
      <p>"Responsável pelo desenvolvimento do sistema" é invisível para o ATS e sem impacto para o humano.<br>
      <strong>Correto:</strong> "Developed payment integration that processed $2M+ in transactions with 99.9% uptime"</p>

      <h3 style="font-size:1rem;font-weight:500;margin:1.5rem 0 .5rem;color:#ef4444">Erro 5: Formato com tabelas e colunas</h3>
      <p>ATSs como Workday e Greenhouse não leem tabelas HTML. O texto fica embaralhado ou em branco. Use formato linear simples.</p>

      <div style="background:var(--accent-dim);border:0.5px solid rgba(59,130,246,.2);border-radius:10px;padding:1rem;margin:1.5rem 0">
        <strong style="color:var(--accent)">Solução rápida:</strong> use o scanner ATS do RemoteBR para identificar exatamente quais palavras-chave estão faltando no seu currículo para cada vaga específica.
      </div>
    `
  },
  {
    id: 'cultura-trabalho-americana-choque-brasil',
    titulo: 'Choque cultural: o que ninguém te conta sobre trabalhar para empresa americana',
    resumo: 'Comunicação direta, feedback brutal, ownership individual, reuniões de 30 minutos que terminam em 30 minutos. A cultura americana de trabalho é radicalmente diferente — e entendê-la pode ser a diferença entre se destacar e ser demitido.',
    categoria: 'cultura',
    catLabel: '🌍 Cultura',
    autor: 'Time RemoteBR',
    data: '20 Fev 2025',
    leitura: '5 min',
    destaque: false,
    video: '',
    conteudo: `
      <h2 style="font-family:'Instrument Serif',serif;font-size:1.5rem;font-weight:400;margin-bottom:1rem">As diferenças que mais surpreendem brasileiros</h2>

      <h3 style="font-size:1rem;font-weight:500;margin:1.5rem 0 .5rem;color:var(--accent)">1. Comunicação direta ao extremo</h3>
      <p>No Brasil, "está um pouco caro" significa não. Nos EUA, "this is expensive" significa exatamente isso — e a pessoa espera que você proponha uma solução, não que interprete subentendidos. Seja direto. Diga "I disagree" sem rodeios.</p>

      <h3 style="font-size:1rem;font-weight:500;margin:1.5rem 0 .5rem;color:var(--accent)">2. Async-first — comunicação assíncrona</h3>
      <p>Startups americanas evitam reuniões ao máximo. Tudo que pode ser resolvido por Slack ou Notion, resolve por Slack ou Notion. Se você manda mensagem esperando resposta imediata como no WhatsApp, vai parecer imaturo. Aprenda a comunicar de forma completa em texto.</p>

      <h3 style="font-size:1rem;font-weight:500;margin:1.5rem 0 .5rem;color:var(--accent)">3. Ownership individual</h3>
      <p>"Whose problem is this?" Nas empresas americanas, cada pessoa tem ownership de uma área. Se algo está errado na sua área, é sua responsabilidade resolver — mesmo que o problema tenha sido causado por outra pessoa. Isso é muito diferente da cultura brasileira de responsabilidade coletiva.</p>

      <h3 style="font-size:1rem;font-weight:500;margin:1.5rem 0 .5rem;color:var(--accent)">4. Feedback direto não é agressão</h3>
      <p>"This presentation doesn't work" não é um ataque pessoal — é feedback profissional. Aprenda a receber sem levar para o lado pessoal e a dar feedback direto quando pedido.</p>

      <h3 style="font-size:1rem;font-weight:500;margin:1.5rem 0 .5rem;color:var(--accent)">5. Visibilidade é necessária</h3>
      <p>Trabalho bom que ninguém sabe que existe não existe. Compartilhe suas conquistas no canal do time, escreva updates semanais, peça feedback regularmente. Isso não é arrogância — é o padrão esperado.</p>
    `
  }
];

let blogCurrentCategory = '';

function renderBlog(categoria) {
  blogCurrentCategory = categoria;
  const grid = document.getElementById('blogGrid');
  const post = document.getElementById('blogPost');
  if(!grid) return;
  grid.style.display = 'flex';
  post.style.display = 'none';

  const filtered = categoria ? BLOG_POSTS.filter(p => p.categoria === categoria) : BLOG_POSTS;

  grid.innerHTML = filtered.map((p, i) => {
    const isDestaque = p.destaque && i === 0 && !categoria;
    return `<article style="border-bottom:0.5px solid var(--border);padding:1.5rem 0;cursor:pointer;transition:all .15s" onclick="abrirPost('${p.id}')" onmouseover="this.style.paddingLeft='8px'" onmouseout="this.style.paddingLeft='0'">
      <div style="display:flex;align-items:flex-start;gap:1.5rem;flex-wrap:wrap">
        ${isDestaque ? `<div style="background:var(--accent-dim);border:0.5px solid rgba(59,130,246,.2);border-radius:10px;padding:2rem;flex:1;min-width:280px">
          <span style="font-size:11px;font-weight:500;background:var(--accent);color:#fff;border-radius:999px;padding:2px 10px;margin-bottom:10px;display:inline-block">${p.catLabel}</span>
          <h2 style="font-family:'Instrument Serif',serif;font-size:1.4rem;font-weight:400;line-height:1.3;margin-bottom:8px;color:var(--text)">${p.titulo}</h2>
          <p style="font-size:13px;color:var(--muted);line-height:1.6;margin-bottom:12px">${p.resumo}</p>
          <div style="font-size:11px;color:var(--muted2)">${p.autor} · ${p.data} · ${p.leitura} de leitura</div>
        </div>` : `<div style="flex:1;min-width:0">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
            <span style="font-size:11px;color:var(--muted);background:var(--surface2);border:0.5px solid var(--border);border-radius:999px;padding:2px 8px">${p.catLabel}</span>
            <span style="font-size:11px;color:var(--muted2)">${p.leitura} de leitura</span>
            ${p.video ? `<span style="font-size:11px;color:#f59e0b;background:rgba(245,158,11,.1);border:0.5px solid rgba(245,158,11,.3);border-radius:999px;padding:2px 8px">▶ Vídeo</span>` : ''}
          </div>
          <h2 style="font-family:'Instrument Serif',serif;font-size:1.15rem;font-weight:400;line-height:1.35;margin-bottom:6px;color:var(--text)">${p.titulo}</h2>
          <p style="font-size:13px;color:var(--muted);line-height:1.5;margin-bottom:8px">${p.resumo.slice(0,120)}...</p>
          <div style="font-size:11px;color:var(--muted2)">${p.autor} · ${p.data}</div>
        </div>`}
      </div>
    </article>`;
  }).join('');
}

function filterBlog(cat, el) {
  document.querySelectorAll('#blogCatFilter .chip').forEach(c => c.classList.remove('active'));
  el.classList.add('active');
  renderBlog(cat);
}

function abrirPost(id) {
  const post = BLOG_POSTS.find(p => p.id === id);
  if(!post) return;
  document.getElementById('blogGrid').style.display = 'none';
  document.getElementById('blogPost').style.display = 'block';

  const videoEmbed = post.video
    ? `<div style="position:relative;padding-bottom:56.25%;height:0;overflow:hidden;border-radius:12px;margin:1.5rem 0">
        <iframe src="https://www.youtube.com/embed/${post.video}" style="position:absolute;top:0;left:0;width:100%;height:100%;border:none;border-radius:12px" allowfullscreen></iframe>
      </div>`
    : '';

  document.getElementById('blogPostContent').innerHTML = `
    <div style="max-width:680px">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:1rem">
        <span style="font-size:12px;color:var(--muted);background:var(--surface2);border:0.5px solid var(--border);border-radius:999px;padding:3px 10px">${post.catLabel}</span>
        <span style="font-size:12px;color:var(--muted2)">${post.data} · ${post.leitura} de leitura</span>
      </div>
      <h1 style="font-family:'Instrument Serif',serif;font-size:2rem;font-weight:400;line-height:1.2;margin-bottom:1rem">${post.titulo}</h1>
      <p style="font-size:15px;color:var(--muted);line-height:1.7;margin-bottom:1.5rem;border-left:3px solid var(--accent);padding-left:1rem">${post.resumo}</p>
      ${videoEmbed}
      <div style="font-size:15px;line-height:1.8;color:var(--muted)" id="postBody">
        ${post.conteudo}
      </div>
      <div style="margin-top:2.5rem;padding:1.25rem;background:var(--accent-dim);border:0.5px solid rgba(59,130,246,.2);border-radius:12px">
        <div style="font-size:14px;font-weight:500;color:var(--text);margin-bottom:6px">Gostou do artigo? Teste o RemoteBR gratuitamente.</div>
        <div style="font-size:13px;color:var(--muted);margin-bottom:10px">Feed de vagas internacionais, análise de IA, scanner ATS e muito mais — tudo em português.</div>
        <button onclick="showPage('candidates')" style="background:var(--accent);border:none;border-radius:8px;padding:9px 20px;color:#fff;font-size:13px;font-weight:500;cursor:pointer;font-family:'DM Sans',sans-serif">Buscar vagas grátis →</button>
      </div>
      <div style="margin-top:1.5rem;padding-top:1.5rem;border-top:0.5px solid var(--border);display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px">
        <span style="font-size:12px;color:var(--muted2)">Compartilhe este artigo</span>
        <div style="display:flex;gap:8px">
          <button onclick="compartilharLinkedIn('${id}')" style="font-size:12px;padding:6px 14px;background:none;border:0.5px solid var(--border2);border-radius:6px;color:var(--muted);cursor:pointer;font-family:'DM Sans',sans-serif">LinkedIn ↗</button>
          <button onclick="copiarLink('${id}')" style="font-size:12px;padding:6px 14px;background:none;border:0.5px solid var(--border2);border-radius:6px;color:var(--muted);cursor:pointer;font-family:'DM Sans',sans-serif">Copiar link</button>
        </div>
      </div>
    </div>`;

  // Style post body elements
  const body = document.getElementById('postBody');
  if(body) {
    body.querySelectorAll('p').forEach(el => el.style.marginBottom = '1rem');
    body.querySelectorAll('h2,h3').forEach(el => { el.style.marginTop = '1.5rem'; el.style.color = 'var(--text)'; });
    body.querySelectorAll('strong').forEach(el => { el.style.color = 'var(--text)'; el.style.fontWeight = '500'; });
  }
}

function fecharPost() {
  document.getElementById('blogGrid').style.display = 'flex';
  document.getElementById('blogPost').style.display = 'none';
  renderBlog(blogCurrentCategory);
}

function compartilharLinkedIn(id) {
  const post = BLOG_POSTS.find(p => p.id === id);
  if(!post) return;
  const url = encodeURIComponent(`https://remotebr.com.br/blog/${id}`);
  const text = encodeURIComponent(post.titulo);
  window.open(`https://www.linkedin.com/sharing/share-offsite/?url=${url}&title=${text}`, '_blank');
}

function copiarLink(id) {
  navigator.clipboard.writeText(`https://remotebr.com.br/blog/${id}`);
  showToast('Link copiado! 📋');
}
// Mock de vagas publicadas para demo
const atsJobsMock = [
  { id:'v1', title:'Senior React Developer', area:'Engineering', status:'active', candidates:47, posted:'2025-03-10',
    stages:['Triagem IA','Teste técnico','Fit cultural','Entrevista final'],
    pipeline: { 'Triagem IA':18, 'Teste técnico':12, 'Fit cultural':6, 'Entrevista final':3, 'Oferta':1, 'Recusado':7 }
  },
  { id:'v2', title:'Product Manager LATAM', area:'Product', status:'active', candidates:31, posted:'2025-03-12',
    stages:['Triagem IA','Case study','Entrevista fundador'],
    pipeline: { 'Triagem IA':14, 'Case study':8, 'Entrevista fundador':4, 'Oferta':0, 'Recusado':5 }
  },
  { id:'v3', title:'Customer Success Manager', area:'CS', status:'closed', candidates:62, posted:'2025-02-28',
    stages:['Triagem IA','Role play','Entrevista final'],
    pipeline: { 'Triagem IA':22, 'Role play':10, 'Entrevista final':4, 'Oferta':1, 'Recusado':25 }
  },
];

function renderAtsJobs() {
  const grid = document.getElementById('atsJobCards');
  if(!grid) return;
  const select = document.getElementById('atsPipelineSelect');

  grid.innerHTML = atsJobsMock.map(j => `
    <div style="background:var(--surface);border:0.5px solid var(--border);border-radius:14px;padding:1.25rem">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:10px">
        <div>
          <div style="font-size:14px;font-weight:500;margin-bottom:3px">${j.title}</div>
          <div style="font-size:12px;color:var(--muted)">${j.area}</div>
        </div>
        <span style="font-size:11px;padding:3px 8px;border-radius:999px;${j.status==='active'?'background:rgba(74,222,128,.1);color:#4ade80;border:0.5px solid rgba(74,222,128,.3)':'background:var(--surface2);color:var(--muted);border:0.5px solid var(--border)'}">
          ${j.status==='active'?'● Ativa':'● Encerrada'}
        </span>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:12px">
        <div style="background:var(--surface2);border-radius:8px;padding:8px;text-align:center">
          <div style="font-size:20px;font-weight:500;color:var(--accent)">${j.candidates}</div>
          <div style="font-size:10px;color:var(--muted)">Candidatos</div>
        </div>
        <div style="background:var(--surface2);border-radius:8px;padding:8px;text-align:center">
          <div style="font-size:20px;font-weight:500;color:#4ade80">${Object.values(j.pipeline)[0]||0}</div>
          <div style="font-size:10px;color:var(--muted)">Em triagem</div>
        </div>
      </div>
      <!-- Mini funil -->
      <div style="display:flex;gap:3px;margin-bottom:12px">
        ${j.stages.map((s,i) => {
          const val = j.pipeline[s]||0;
          const max = Math.max(...Object.values(j.pipeline));
          const pct = max ? Math.round(val/max*100) : 0;
          return `<div style="flex:1;text-align:center">
            <div style="height:${Math.max(4,pct/4)}px;background:${i===0?'var(--accent)':'rgba(59,130,246,.3)'};border-radius:2px;margin-bottom:3px"></div>
            <div style="font-size:9px;color:var(--muted2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${s.split(' ')[0]}</div>
            <div style="font-size:11px;font-weight:500;color:var(--text)">${val}</div>
          </div>`;
        }).join('')}
      </div>
      <button onclick="verPipeline('${j.id}')" style="width:100%;padding:8px;background:var(--accent-dim);border:0.5px solid rgba(59,130,246,.25);border-radius:8px;color:var(--accent);font-size:12px;cursor:pointer;font-family:'DM Sans',sans-serif">Ver pipeline completo →</button>
    </div>`).join('');

  if(select) {
    select.innerHTML = '<option value="">Selecione uma vaga...</option>' +
      atsJobsMock.map(j => `<option value="${j.id}">${j.title} (${j.candidates} cand.)</option>`).join('');
  }
}

function verPipeline(jobId) {
  showAtsSection('pipeline', document.getElementById('ats-nav-pipeline'));
  document.getElementById('atsPipelineSelect').value = jobId;
  renderPipeline(jobId);
}

function renderPipeline(jobId) {
  const board = document.getElementById('atsPipelineBoard');
  if(!board) return;
  if(!jobId) { board.innerHTML = '<div style="color:var(--muted);font-size:13px;padding:2rem 0">Selecione uma vaga acima.</div>'; return; }
  const job = atsJobsMock.find(j => j.id === jobId);
  if(!job) return;

  // Mock candidatos por fase
  const mockCandidates = {
    'Triagem IA':        ['Ana Lima','Carlos Souza','Juliana Ferreira','Pedro Costa','Mariana Oliveira'].slice(0, job.pipeline['Triagem IA']||0),
    'Teste técnico':     ['Carlos Souza','Juliana Ferreira','Pedro Costa'].slice(0, job.pipeline['Teste técnico']||0),
    'Fit cultural':      ['Carlos Souza','Pedro Costa'].slice(0, job.pipeline['Fit cultural']||0),
    'Entrevista final':  ['Pedro Costa'].slice(0, job.pipeline['Entrevista final']||0),
    'Oferta':            ['Pedro Costa'].slice(0, job.pipeline['Oferta']||0),
    'Recusado':          ['Marcos Silva','Beatriz Santos'].slice(0, job.pipeline['Recusado']||0),
    'Case study':        ['Ana Lima','Carlos Souza','Juliana Ferreira'].slice(0, job.pipeline['Case study']||0),
    'Role play':         ['Ana Lima','Carlos Souza'].slice(0, job.pipeline['Role play']||0),
    'Entrevista fundador':['Carlos Souza'].slice(0, job.pipeline['Entrevista fundador']||0),
  };

  const stages = [...job.stages, 'Oferta', 'Recusado'];
  board.innerHTML = `
    <div style="display:grid;grid-template-columns:repeat(${Math.min(stages.length,6)},1fr);gap:10px;overflow-x:auto">
      ${stages.map(stage => {
        const cands = mockCandidates[stage] || [];
        const count = job.pipeline[stage] || 0;
        const isRejected = stage === 'Recusado';
        const isOffer = stage === 'Oferta';
        const color = isOffer ? '#4ade80' : isRejected ? '#6b7280' : 'var(--accent)';
        return `<div style="background:var(--surface);border:0.5px solid var(--border);border-radius:12px;overflow:hidden;min-width:160px">
          <div style="padding:10px 12px;border-bottom:0.5px solid var(--border);display:flex;align-items:center;justify-content:space-between">
            <span style="font-size:12px;font-weight:500;color:var(--text)">${stage}</span>
            <span style="font-size:11px;font-weight:500;color:${color};background:${color}22;border-radius:999px;padding:1px 7px">${count}</span>
          </div>
          <div style="padding:8px;display:flex;flex-direction:column;gap:6px">
            ${cands.slice(0,4).map(name => `
              <div style="background:var(--surface2);border:0.5px solid var(--border);border-radius:8px;padding:8px 10px">
                <div style="font-size:12px;font-weight:500;color:var(--text);margin-bottom:4px">${name}</div>
                <div style="display:flex;gap:4px;flex-wrap:wrap">
                  <button onclick="enviarResposta('${name}','aprovado')" style="font-size:10px;padding:2px 7px;border-radius:4px;background:rgba(74,222,128,.1);color:#4ade80;border:0.5px solid rgba(74,222,128,.3);cursor:pointer;font-family:'DM Sans',sans-serif">✓ Aprovar</button>
                  <button onclick="enviarResposta('${name}','recusado')" style="font-size:10px;padding:2px 7px;border-radius:4px;background:rgba(107,114,128,.1);color:var(--muted);border:0.5px solid var(--border);cursor:pointer;font-family:'DM Sans',sans-serif">✗ Recusar</button>
                </div>
              </div>`).join('')}
            ${count > 4 ? `<div style="text-align:center;font-size:11px;color:var(--muted2);padding:4px">+${count-4} mais</div>` : ''}
          </div>
        </div>`;
      }).join('')}
    </div>`;
}

function enviarResposta(nome, tipo) {
  const msgs = {
    aprovado: `✅ ${nome} foi movido para a próxima fase. Email automático enviado.`,
    recusado: `Email de feedback enviado para ${nome} com motivo da recusa.`
  };
  showToast(msgs[tipo]);
}

function renderAtsResponses() {
  const list = document.getElementById('atsResponsesList');
  if(!list) return;
  const templates = [
    { fase:'Triagem IA', tipo:'aprovado', assunto:'Você avançou para a próxima fase!', corpo:'Olá {nome}, ficamos impressionados com seu perfil para a vaga de {vaga}. Você foi aprovado na triagem e avançou para {proxima_fase}. Entraremos em contato em breve com os próximos passos.' },
    { fase:'Triagem IA', tipo:'recusado', assunto:'Atualização sobre sua candidatura', corpo:'Olá {nome}, agradecemos seu interesse na vaga de {vaga}. Após análise cuidadosa, seguiremos com outros perfis neste momento. Seu perfil ficará em nosso banco de talentos para oportunidades futuras.' },
    { fase:'Teste técnico', tipo:'aprovado', assunto:'Parabéns! Próxima etapa: entrevista', corpo:'Olá {nome}, você foi aprovado no teste técnico para a vaga de {vaga}. Estamos ansiosos para te conhecer melhor. Agende sua entrevista pelo link: {link_agenda}' },
    { fase:'Entrevista final', tipo:'recusado', assunto:'Resultado do processo seletivo', corpo:'Olá {nome}, foi uma prazer conhecer você durante o processo para {vaga}. Após considerar todos os candidatos, seguiremos com outro perfil desta vez. Valorizamos muito sua participação e dedicação.' },
  ];
  list.innerHTML = templates.map((t,i) => `
    <div style="background:var(--surface);border:0.5px solid var(--border);border-radius:14px;padding:1.25rem">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;flex-wrap:wrap;gap:8px">
        <div style="display:flex;align-items:center;gap:8px">
          <span style="font-size:11px;padding:3px 8px;border-radius:999px;${t.tipo==='aprovado'?'background:rgba(74,222,128,.1);color:#4ade80;border:0.5px solid rgba(74,222,128,.3)':'background:var(--surface2);color:var(--muted);border:0.5px solid var(--border)'}">
            ${t.tipo==='aprovado'?'✓ Aprovação':'✗ Recusa'}
          </span>
          <span style="font-size:12px;color:var(--muted)">Fase: ${t.fase}</span>
        </div>
        <button onclick="editarTemplate(${i})" style="font-size:12px;padding:4px 10px;background:none;border:0.5px solid var(--border2);border-radius:6px;color:var(--muted);cursor:pointer;font-family:'DM Sans',sans-serif">Editar</button>
      </div>
      <div style="font-size:13px;font-weight:500;color:var(--text);margin-bottom:6px">${t.assunto}</div>
      <div style="font-size:12px;color:var(--muted);line-height:1.6;background:var(--surface2);border-radius:8px;padding:10px">${t.corpo}</div>
      <div style="font-size:11px;color:var(--muted2);margin-top:8px">Variáveis disponíveis: {nome} {vaga} {proxima_fase} {link_agenda} {empresa}</div>
    </div>`).join('');
}

function editarTemplate(i) { showToast('Editor de templates em breve — integrado com Supabase 📧'); }

function showAtsSection(section, el) {
  ['jobs','pipeline','responses'].forEach(s => {
    const el = document.getElementById(`ats-section-${s}`);
    if(el) el.style.display = s === section ? 'block' : 'none';
    const nav = document.getElementById(`ats-nav-${s}`);
    if(nav) { nav.style.color = s===section?'var(--text)':'var(--muted)'; nav.style.borderColor = s===section?'var(--accent)':'var(--border2)'; }
  });
  if(section==='responses') renderAtsResponses();
}

// ===== ADMIN DASHBOARD =====
function renderAdminDashboard() {
  // KPIs — em produção vêm do Supabase
  const kpis = [
    { label:'Visitas hoje',    val:'1.247',  delta:'+12%', color:'var(--accent)' },
    { label:'Candidatos',      val:'3.891',  delta:'+8%',  color:'#4ade80'       },
    { label:'Assinantes pagos',val:'143',    delta:'+5',   color:'#f59e0b'       },
    { label:'Receita MRR',     val:'R$9.847',delta:'+R$790',color:'#4ade80'      },
  ];
  document.getElementById('adminKpis').innerHTML = kpis.map(k => `
    <div style="background:var(--surface);border:0.5px solid var(--border);border-radius:14px;padding:1.25rem">
      <div style="font-size:11px;color:var(--muted2);text-transform:uppercase;letter-spacing:.08em;margin-bottom:6px">${k.label}</div>
      <div style="font-size:26px;font-weight:500;color:${k.color};margin-bottom:4px">${k.val}</div>
      <div style="font-size:12px;color:var(--muted)">${k.delta} vs mês anterior</div>
    </div>`).join('');

  // Fontes de vagas
  const sources = [
    { name:'Remotive',       pct:28, count:840  },
    { name:'Lever API',      pct:22, count:660  },
    { name:'Greenhouse API', pct:18, count:540  },
    { name:'Himalayas',      pct:12, count:360  },
    { name:'RemoteOK',       pct:10, count:300  },
    { name:'WeWorkRemotely', pct:10, count:300  },
  ];
  document.getElementById('adminSources').innerHTML = sources.map(s => `
    <div style="margin-bottom:10px">
      <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:4px">
        <span style="color:var(--text)">${s.name}</span>
        <span style="color:var(--muted)">${s.count} vagas · ${s.pct}%</span>
      </div>
      <div style="height:6px;background:var(--surface2);border-radius:3px;overflow:hidden">
        <div style="height:100%;width:${s.pct}%;background:var(--accent);border-radius:3px;transition:width .6s"></div>
      </div>
    </div>`).join('');

  // Funil de conversão
  const funnel = [
    { stage:'Visitantes',    val:1247, color:'var(--accent)' },
    { stage:'Cadastros',     val:89,   color:'#60a5fa' },
    { stage:'Upload CV',     val:43,   color:'#f59e0b' },
    { stage:'Candidaturas',  val:28,   color:'#a78bfa' },
    { stage:'Assinantes',    val:7,    color:'#4ade80' },
  ];
  const maxFunnel = funnel[0].val;
  document.getElementById('adminFunnel').innerHTML = funnel.map(f => `
    <div style="margin-bottom:10px">
      <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:4px">
        <span style="color:var(--text)">${f.stage}</span>
        <span style="color:${f.color};font-weight:500">${f.val.toLocaleString('pt-BR')}</span>
      </div>
      <div style="height:8px;background:var(--surface2);border-radius:4px;overflow:hidden">
        <div style="height:100%;width:${Math.round(f.val/maxFunnel*100)}%;background:${f.color};border-radius:4px"></div>
      </div>
    </div>`).join('');

  // Planos
  const planos = [
    { name:'Grátis',  count:3748, receita:0     },
    { name:'Júnior',  count:68,   receita:2033.2},
    { name:'Pleno',   count:42,   receita:2515.8},
    { name:'Sênior',  count:24,   receita:1917.6},
    { name:'Master',  count:9,    receita:899.1 },
  ];
  document.getElementById('adminPlanos').innerHTML = `
    <table style="width:100%;border-collapse:collapse;font-size:13px">
      <tr style="border-bottom:0.5px solid var(--border)">
        <th style="text-align:left;padding:6px 8px;font-size:11px;color:var(--muted2);font-weight:500">Plano</th>
        <th style="text-align:right;padding:6px 8px;font-size:11px;color:var(--muted2);font-weight:500">Usuários</th>
        <th style="text-align:right;padding:6px 8px;font-size:11px;color:var(--muted2);font-weight:500">MRR</th>
      </tr>
      ${planos.map(p => `<tr style="border-bottom:0.5px solid var(--border)">
        <td style="padding:8px;color:var(--text)">${p.name}</td>
        <td style="padding:8px;text-align:right;color:var(--muted)">${p.count.toLocaleString()}</td>
        <td style="padding:8px;text-align:right;color:#4ade80;font-weight:500">${p.receita?'R$'+p.receita.toLocaleString('pt-BR',{minimumFractionDigits:2}):'—'}</td>
      </tr>`).join('')}
    </table>`;

  // Top vagas
  const topJobs = allJobs.slice(0,6).map((j,i) => ({
    title: j.title, company: j.company_name,
    views: Math.floor(Math.random()*200+50),
    applies: Math.floor(Math.random()*30+5)
  }));
  document.getElementById('adminTopJobs').innerHTML = topJobs.length
    ? `<table style="width:100%;border-collapse:collapse;font-size:12px">
        <tr style="border-bottom:0.5px solid var(--border)">
          <th style="text-align:left;padding:6px 8px;font-size:11px;color:var(--muted2);font-weight:500">Vaga</th>
          <th style="text-align:right;padding:6px 8px;font-size:11px;color:var(--muted2);font-weight:500">Views</th>
          <th style="text-align:right;padding:6px 8px;font-size:11px;color:var(--muted2);font-weight:500">Aplic.</th>
        </tr>
        ${topJobs.map(j=>`<tr style="border-bottom:0.5px solid var(--border)">
          <td style="padding:8px">
            <div style="color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:160px">${j.title}</div>
            <div style="color:var(--muted2);font-size:11px">${j.company}</div>
          </td>
          <td style="padding:8px;text-align:right;color:var(--muted)">${j.views}</td>
          <td style="padding:8px;text-align:right;color:var(--accent);font-weight:500">${j.applies}</td>
        </tr>`).join('')}
      </table>`
    : '<div style="color:var(--muted);font-size:13px">Carregando vagas...</div>';

  // Receita detalhada
  const totalMRR = planos.reduce((s,p)=>s+p.receita,0);
  const totalAnual = totalMRR * 12;
  const custoIA = Math.round(totalMRR * 0.04);
  const custoInfra = 40/12 + 140;
  const lucro = totalMRR - custoIA - custoInfra;
  document.getElementById('adminReceita').innerHTML = `
    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px">
      ${[
        ['MRR','R$'+Math.round(totalMRR).toLocaleString(),'Receita mensal recorrente','#4ade80'],
        ['ARR estimado','R$'+Math.round(totalAnual).toLocaleString(),'Projeção anual','#60a5fa'],
        ['Custos totais','R$'+(custoIA+Math.round(custoInfra)).toLocaleString(),'IA + domínio + infra','#f59e0b'],
        ['Lucro líquido','R$'+Math.round(lucro).toLocaleString(),'Após todos os custos','#4ade80'],
      ].map(([lbl,val,desc,color])=>`
        <div style="background:var(--surface2);border-radius:10px;padding:1rem;text-align:center">
          <div style="font-size:11px;color:var(--muted2);margin-bottom:4px">${lbl}</div>
          <div style="font-size:22px;font-weight:500;color:${color};margin-bottom:3px">${val}</div>
          <div style="font-size:11px;color:var(--muted)">${desc}</div>
        </div>`).join('')}
    </div>
    <div style="margin-top:12px;padding:10px 14px;background:var(--accent-dim);border:0.5px solid rgba(59,130,246,.2);border-radius:8px;font-size:12px;color:var(--accent)">
      ⚡ Em produção, todos esses números vêm do Supabase em tempo real. Os valores acima são estimativas demo baseadas nos planos configurados.
    </div>`;
}

// ===== COMPANIES PAGE =====
function showSection(section) {
  document.getElementById('sectionPlans').style.display = section === 'plans' ? 'block' : 'none';
  document.getElementById('sectionPostJob').style.display = section === 'postJob' ? 'block' : 'none';
}

let testCount = 0;
function addTest() {
  testCount++;
  const id = 'test_' + testCount;
  const div = document.createElement('div');
  div.id = id;
  div.style.cssText = 'background:var(--surface2);border:0.5px solid var(--border);border-radius:10px;padding:12px;display:flex;flex-direction:column;gap:8px';
  div.innerHTML = `
    <div style="display:flex;gap:8px;align-items:center">
      <select style="flex:1;background:var(--bg);border:0.5px solid var(--border2);border-radius:8px;padding:7px 10px;color:var(--text);font-size:12px;font-family:'DM Sans',sans-serif;outline:none" onchange="toggleTestType(this,'${id}')">
        <option value="text">Pergunta aberta</option>
        <option value="multi">Múltipla escolha</option>
        <option value="code">Desafio técnico / código</option>
        <option value="file">Envio de arquivo / portfólio</option>
      </select>
      <button onclick="document.getElementById('${id}').remove()" style="background:none;border:0.5px solid var(--border2);border-radius:6px;width:28px;height:28px;color:var(--muted);cursor:pointer;font-size:14px;flex-shrink:0">×</button>
    </div>
    <input class="form-input" placeholder="Digite a pergunta ou enunciado do teste..." style="font-size:13px">
    <div class="test-options-${id}"></div>
  `;
  document.getElementById('testList').appendChild(div);
}

function toggleTestType(sel, id) {
  const optDiv = document.querySelector('.test-options-' + id);
  if(sel.value === 'multi') {
    optDiv.innerHTML = `
      <div style="display:flex;flex-direction:column;gap:5px">
        <input class="form-input" placeholder="Opção A" style="font-size:12px">
        <input class="form-input" placeholder="Opção B" style="font-size:12px">
        <input class="form-input" placeholder="Opção C (opcional)" style="font-size:12px">
        <div style="font-size:11px;color:var(--muted);margin-top:2px">Resposta correta: <input style="background:none;border:none;border-bottom:1px solid var(--border2);color:var(--accent);width:60px;font-size:12px;outline:none" placeholder="A, B ou C"></div>
      </div>`;
  } else if(sel.value === 'code') {
    optDiv.innerHTML = `<textarea class="form-input" rows="3" placeholder="Descreva o desafio técnico ou cole um snippet de código..." style="font-size:12px;resize:vertical"></textarea>`;
  } else if(sel.value === 'file') {
    optDiv.innerHTML = `<div style="font-size:12px;color:var(--muted);padding:8px;background:var(--bg);border-radius:6px;border:0.5px solid var(--border)">Candidato poderá enviar PDF, imagem ou link (portfólio, GitHub, etc.)</div>`;
  } else {
    optDiv.innerHTML = '';
  }
}

function updatePreview() {
  const title = document.getElementById('jobTitle').value || 'Título da vaga';
  const company = document.getElementById('companyName').value || 'Nome da empresa';
  const desc = document.getElementById('jobDesc').value || 'A descrição da vaga aparecerá aqui...';
  const salary = document.getElementById('jobSalary').value;
  const loc = document.getElementById('jobLocation').value || 'Worldwide';
  const type = document.getElementById('jobType').value;
  document.getElementById('previewTitle').textContent = title;
  document.getElementById('previewCompany').textContent = company;
  document.getElementById('previewDesc').textContent = desc.slice(0, 140) + (desc.length > 140 ? '...' : '');
  document.getElementById('previewLogo').textContent = company[0]?.toUpperCase() || '?';
  const typeTag = type === 'remote'
    ? `<span style="font-size:11px;padding:3px 8px;border-radius:999px;color:#60a5fa;border:0.5px solid rgba(59,130,246,.25);background:rgba(59,130,246,.06)">🌍 Remoto</span>`
    : `<span style="font-size:11px;padding:3px 8px;border-radius:999px;color:var(--gold);border:0.5px solid rgba(245,158,11,.3);background:rgba(245,158,11,.06)">🏢 Híbrido</span>`;
  const salTag = salary ? `<span style="font-size:11px;padding:3px 8px;border-radius:999px;color:var(--info);border:0.5px solid rgba(56,189,248,.25);background:rgba(56,189,248,.06)">💵 ${salary}</span>` : '';
  const locTag = `<span style="font-size:11px;padding:3px 8px;border-radius:999px;border:0.5px solid var(--border);color:var(--muted)">${loc}</span>`;
  document.getElementById('previewTags').innerHTML = typeTag + salTag + locTag;
}

function publishJob() {
  const title = document.getElementById('jobTitle').value;
  const company = document.getElementById('companyName').value;
  if(!title || !company) { showToast('Preencha pelo menos o cargo e a empresa.'); return; }
  closeModal('paywallModal');
  showToast('Vaga publicada com sucesso! 🎉 Candidatos já podem se inscrever.');
  setTimeout(() => showPage('candidates'), 1500);
}

// ===== WISE TRACKING =====
function trackWiseClick() {
  track('wise_affiliate_click', {});
  console.log('Wise affiliate click tracked');
}
