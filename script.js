/* ===========================
   ZAADAQ Portfolio — script.js
   =========================== */

// ── Navigation ────────────────────────────────────────
const nav  = document.querySelector('.nav');
const menu = document.querySelector('.menu');

window.addEventListener('scroll', () => {
  nav.classList.toggle('scrolled', scrollY > 24);
  updateScrollProgress();
  updateBackToTop();
});

menu.addEventListener('click', () => {
  const open = nav.classList.toggle('open');
  menu.setAttribute('aria-expanded', open);
});

document.querySelectorAll('nav a').forEach(a =>
  a.addEventListener('click', () => nav.classList.remove('open'))
);

// ── Scroll progress bar ───────────────────────────────
const progressBar = document.getElementById('scroll-progress');

function updateScrollProgress() {
  const scrollable = document.documentElement.scrollHeight - window.innerHeight;
  const pct = scrollable > 0 ? (scrollY / scrollable) * 100 : 0;
  progressBar.style.width = pct + '%';
}

// ── Back-to-top button ────────────────────────────────
const backToTop = document.getElementById('back-to-top');

backToTop.addEventListener('click', () => {
  window.scrollTo({ top: 0, behavior: 'smooth' });
});

function updateBackToTop() {
  backToTop.classList.toggle('visible', scrollY > 400);
}

// ── Active nav link (IntersectionObserver) ────────────
const navLinks = document.querySelectorAll('.nav nav a[href^="#"]');
const sections = document.querySelectorAll('main section[id]');

const sectionObserver = new IntersectionObserver(
  entries => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        const id = entry.target.id;
        navLinks.forEach(link => {
          link.classList.toggle('active', link.getAttribute('href') === '#' + id);
        });
      }
    });
  },
  { rootMargin: '-40% 0px -55% 0px', threshold: 0 }
);
sections.forEach(section => sectionObserver.observe(section));

// ── Reveal on scroll ──────────────────────────────────
const revealObserver = new IntersectionObserver(
  entries => entries.forEach(e => {
    if (e.isIntersecting) {
      e.target.classList.add('visible');
      revealObserver.unobserve(e.target);
    }
  }),
  { threshold: .12 }
);
document.querySelectorAll('.reveal').forEach(el => revealObserver.observe(el));

// ── Typed hero text ───────────────────────────────────
(function initTyped() {
  const heroH1 = document.querySelector('.hero-copy h1');
  if (!heroH1) return;

  const firstChild = heroH1.firstChild;
  if (!firstChild || firstChild.nodeType !== Node.TEXT_NODE) return;

  const phrases = ['Creative ideas.', 'Bold visions.', 'Real impact.'];
  let phraseIndex = 0;
  let charIndex   = 0;
  let deleting    = false;

  // Replace the raw text node with a typed span + blinking cursor
  const typedEl  = document.createElement('span');
  const cursorEl = document.createElement('span');
  cursorEl.className = 'typed-cursor';
  typedEl.textContent = phrases[0];
  heroH1.replaceChild(typedEl, firstChild);
  heroH1.insertBefore(cursorEl, typedEl.nextSibling);

  function tick() {
    const phrase = phrases[phraseIndex];
    if (!deleting) {
      charIndex++;
      typedEl.textContent = phrase.slice(0, charIndex);
      if (charIndex === phrase.length) {
        deleting = true;
        return setTimeout(tick, 2200);
      }
      setTimeout(tick, 70);
    } else {
      charIndex--;
      typedEl.textContent = phrase.slice(0, charIndex);
      if (charIndex === 0) {
        deleting = false;
        phraseIndex = (phraseIndex + 1) % phrases.length;
        return setTimeout(tick, 400);
      }
      setTimeout(tick, 38);
    }
  }

  // Start after a short pause so the user can read the page first
  setTimeout(tick, 1800);
})();

// ── Project filters ───────────────────────────────────
document.querySelectorAll('.filters button').forEach(button => {
  button.addEventListener('click', () => {
    document.querySelector('.filters .active').classList.remove('active');
    button.classList.add('active');

    const filter = button.dataset.filter;
    document.querySelectorAll('.project').forEach(project => {
      const matches = filter === 'all' || project.classList.contains(filter);

      if (matches) {
        // Fade in
        project.classList.remove('hide');
        project.style.opacity   = '0';
        project.style.transform = 'scale(.97)';
        requestAnimationFrame(() => requestAnimationFrame(() => {
          project.style.transition = 'opacity .35s ease, transform .35s ease';
          project.style.opacity    = '1';
          project.style.transform  = 'scale(1)';
        }));
      } else {
        // Fade out then hide
        project.style.transition = 'opacity .25s ease, transform .25s ease';
        project.style.opacity    = '0';
        project.style.transform  = 'scale(.97)';
        setTimeout(() => project.classList.add('hide'), 260);
      }
    });
  });
});

// ── Cursor glow ───────────────────────────────────────
const cursorGlow = document.querySelector('.cursor-glow');
window.addEventListener('pointermove', e => {
  cursorGlow.style.left = e.clientX + 'px';
  cursorGlow.style.top  = e.clientY + 'px';
});

// ── Contact form — WhatsApp + client validation ────────
const contactForm = document.querySelector('#contact-form');

contactForm.addEventListener('submit', event => {
  event.preventDefault();
  if (!validateContactForm()) return;

  const data = new FormData(contactForm);
  const text = [
    'Salaan ZAADAQ, waxaan rabaa inaan kaa codsado mashruuc.',
    '',
    `Magaca: ${data.get('name')}`,
    `Email: ${data.get('email')}`,
    `Nooca mashruuca: ${data.get('projectType')}`,
    '',
    'Faahfaahin:',
    data.get('message'),
  ].join('\n');

  window.open(`https://wa.me/252615156485?text=${encodeURIComponent(text)}`, '_blank', 'noopener');
});

function validateContactForm() {
  // Remove any existing error messages first
  contactForm.querySelectorAll('.field-error').forEach(el => el.remove());

  const rules = [
    { name: 'name',        label: 'name (at least 2 characters)',  test: v => v.trim().length >= 2 },
    { name: 'email',       label: 'valid email address',           test: v => /\S+@\S+\.\S+/.test(v.trim()) },
    { name: 'projectType', label: 'project type',                  test: v => v !== '' },
    { name: 'message',     label: 'message (at least 5 characters)', test: v => v.trim().length >= 5 },
  ];

  let valid = true;
  rules.forEach(({ name, label, test }) => {
    const input = contactForm.querySelector(`[name="${name}"]`);
    if (!input || test(input.value)) return;
    valid = false;
    const err = document.createElement('span');
    err.className   = 'field-error';
    err.textContent = `Please enter a ${label}.`;
    input.parentElement.appendChild(err);
  });
  return valid;
}

// ── Login / Auth modal ────────────────────────────────
const loginModal       = document.querySelector('#login-modal');
const loginTrigger     = document.querySelector('#login-trigger');
const logoutTrigger    = document.querySelector('#logout-trigger');
const closeLoginBtn    = document.querySelector('#close-login');
const loginForm        = document.querySelector('#login-form');
const switchAuth       = document.querySelector('#switch-auth');
const loginError       = document.querySelector('#login-error');
const registerOnly     = document.querySelector('.register-only');
const loginTitle       = document.querySelector('#login-title');
const loginDescription = document.querySelector('#login-description');

let isRegistering = false;

// ── Hybrid Auth (Server API + Static Fallback) ───────
async function getAuthenticatedUser() {
  try {
    const res = await fetch('/api/auth/me', { credentials: 'same-origin' });
    if (res.status === 404) throw new Error('STATIC_HOST');
    if (!res.ok) return null;
    const { user } = await res.json();
    return user;
  } catch (err) {
    if (err.message === 'STATIC_HOST' || err.name === 'TypeError') {
      // Fallback for static hosts like GitHub Pages / Netlify
      const stored = localStorage.getItem('zaadaq_user');
      return stored ? JSON.parse(stored) : null;
    }
    return null;
  }
}

async function updateLoginState() {
  const user = await getAuthenticatedUser();
  if (user && user.name) {
    loginTrigger.hidden  = true;
    logoutTrigger.hidden = false;
    const firstName = user.name.trim().split(' ')[0];
    logoutTrigger.innerHTML = `Logout, ${firstName} <span>↗</span>`;
  } else {
    loginTrigger.hidden  = false;
    logoutTrigger.hidden = true;
  }
}

function setAuthMode(registering) {
  isRegistering = registering;
  registerOnly.hidden = !registering;
  registerOnly.querySelector('input').required = registering;
  loginTitle.innerHTML        = registering ? 'Create your<br>account.' : 'Welcome<br>back.';
  loginDescription.textContent = registering
    ? 'Create a secure ZAADAQ account.'
    : 'Log in securely to your ZAADAQ account.';
  loginForm.querySelector('button[type="submit"]').innerHTML = registering
    ? 'Create account <b>↗</b>'
    : 'Login <b>↗</b>';
  switchAuth.textContent = registering
    ? 'Already have an account? Log in'
    : 'New here? Create an account';
  loginError.textContent = '';
}

function openLoginModal() {
  setAuthMode(false);
  loginModal.classList.add('open');
  loginModal.setAttribute('aria-hidden', 'false');
  const firstInput = loginForm.querySelector('input:not([hidden])');
  if (firstInput) firstInput.focus();
}

function closeLoginModal() {
  loginModal.classList.remove('open');
  loginModal.setAttribute('aria-hidden', 'true');
}

loginTrigger.addEventListener('click', openLoginModal);
closeLoginBtn.addEventListener('click', closeLoginModal);
loginModal.addEventListener('click', event => {
  if (event.target === loginModal) closeLoginModal();
});
switchAuth.addEventListener('click', () => setAuthMode(!isRegistering));

loginForm.addEventListener('submit', async event => {
  event.preventDefault();
  loginError.textContent = '';

  const data     = new FormData(loginForm);
  const name     = (data.get('loginName') || '').toString().trim();
  const email    = (data.get('loginEmail') || '').toString().trim();
  const password = (data.get('loginPassword') || '').toString().trim();

  const payload  = { name, email, password };

  try {
    const endpoint = isRegistering ? '/api/auth/register' : '/api/auth/login';
    const response = await fetch(endpoint, {
      method:      'POST',
      headers:     { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body:        JSON.stringify(payload),
    });

    if (response.status === 404) {
      // Handle static host (GitHub Pages) fallback
      const user = { name: name || email.split('@')[0], email };
      localStorage.setItem('zaadaq_user', JSON.stringify(user));
      loginForm.reset();
      closeLoginModal();
      await updateLoginState();
      return;
    }

    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Unable to continue.');

    loginForm.reset();
    closeLoginModal();
    await updateLoginState();
  } catch (error) {
    if (error.name === 'TypeError') {
      // Network/static fallback
      const user = { name: name || email.split('@')[0], email };
      localStorage.setItem('zaadaq_user', JSON.stringify(user));
      loginForm.reset();
      closeLoginModal();
      await updateLoginState();
    } else {
      loginError.textContent = error.message;
    }
  }
});

// ── Logout Action ─────────────────────────────────────
logoutTrigger.addEventListener('click', async () => {
  try {
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' });
  } catch {
    // Ignore network error on static deployment
  }
  localStorage.removeItem('zaadaq_user');
  await updateLoginState();

  // Show brief feedback toast if desired
  const origText = logoutTrigger.innerHTML;
  logoutTrigger.textContent = 'Logged out';
  setTimeout(() => updateLoginState(), 1000);
});

window.addEventListener('keydown', event => {
  if (event.key === 'Escape') closeLoginModal();
});

// Check login state on load
updateLoginState();
