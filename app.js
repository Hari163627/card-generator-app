const tg = window.Telegram.WebApp;
const CONFIG = window.CONFIG;

let state = {
    user: null,
    credits: 0,
    selectedTone: 'premium',
    selectedFormat: '1:1',
    uploadedImage: null,
    generatedImage: null
};

// ==================== INIT ====================
async function init() {
    tg.ready();
    tg.expand();

    state.user = tg.initDataUnsafe.user;
    if (!state.user) {
        tg.showAlert('Ошибка: не удалось получить данные пользователя');
        return;
    }

    await loadUser();
    await checkReferralFromUrl();
    updateUI();

    setTimeout(() => showScreen('home'), 800);
}

// ==================== SUPABASE ====================
async function sb(endpoint, method = 'GET', body = null) {
    const url = `${CONFIG.SUPABASE_URL}/rest/v1/${endpoint}`;
    const headers = {
        'apikey': CONFIG.SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${CONFIG.SUPABASE_ANON_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=representation'
    };
    const options = { method, headers };
    if (body) options.body = JSON.stringify(body);

    const res = await fetch(url, options);
    if (!res.ok) throw new Error(`SB ${res.status}: ${await res.text()}`);
    return res.json();
}

async function loadUser() {
    try {
        const users = await sb(`users?id=eq.${state.user.id}&select=*`);

        if (users.length > 0) {
            state.credits = users[0].credits;
            localStorage.setItem('refCode', users[0].referral_code);
            if (users[0].is_banned) {
                tg.showAlert('Вы забанены');
                tg.close();
            }
        } else {
            const refCode = 'u' + Math.random().toString(36).substring(2, 9);
            await sb('users', 'POST', {
                id: state.user.id,
                username: state.user.username || '',
                first_name: state.user.first_name || '',
                credits: CONFIG.FREE_CREDITS_ON_SIGNUP,
                referral_code: refCode
            });
            state.credits = CONFIG.FREE_CREDITS_ON_SIGNUP;
            localStorage.setItem('refCode', refCode);

            await sb('transactions', 'POST', {
                user_id: state.user.id,
                type: 'signup',
                amount: CONFIG.FREE_CREDITS_ON_SIGNUP,
                note: 'Бонус за регистрацию'
            });
        }
    } catch (e) {
        console.error('loadUser error:', e);
        state.credits = parseInt(localStorage.getItem('credits') || '3');
    }
}

async function checkReferralFromUrl() {
    const params = new URLSearchParams(window.location.search);
    let refCode = params.get('ref');

    if (!refCode && tg.initDataUnsafe && tg.initDataUnsafe.start_param) {
        refCode = tg.initDataUnsafe.start_param;
    }

    if (!refCode) return;

    try {
        const me = await sb(`users?id=eq.${state.user.id}&select=referred_by`);
        if (me[0]?.referred_by) return;

        const inviter = await sb(`users?referral_code=eq.${refCode}&select=id`);
        if (inviter.length === 0) return;

        const inviterId = inviter[0].id;
        if (inviterId === state.user.id) return;

        await fetch(`${CONFIG.SUPABASE_URL}/rest/v1/rpc/apply_referral`, {
            method: 'POST',
            headers: {
                'apikey': CONFIG.SUPABASE_ANON_KEY,
                'Authorization': `Bearer ${CONFIG.SUPABASE_ANON_KEY}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                p_inviter_id: inviterId,
                p_new_user_id: state.user.id,
                p_bonus: CONFIG.REFERRAL_BONUS
            })
        });

        tg.showAlert(`🎉 +${CONFIG.REFERRAL_BONUS} карточки вашему другу!`);
    } catch (e) {
        console.error('Referral error:', e);
    }
}
// ==================== UI ====================
function showScreen(id) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    document.getElementById(id).classList.add('active');
    tg.HapticFeedback.impactOccurred('light');
}

function updateUI() {
    document.getElementById('userName').textContent = state.user.first_name || 'друг';
    document.getElementById('creditsCount').textContent = state.credits;
    document.getElementById('refCode').textContent = localStorage.getItem('refCode') || '—';
}

function goToCreate() { showScreen('create'); }
function goToHome() { showScreen('home'); updateUI(); }
function goToPricing() { showScreen('pricing'); }
function goToHistory() { showScreen('history'); loadHistory(); }
function goBack() { showScreen('home'); }

// ==================== FILE ====================
function handleFile(event) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
        state.uploadedImage = e.target.result;
        document.getElementById('preview').innerHTML =
            `<img src="${e.target.result}" alt="preview">`;
    };
    reader.readAsDataURL(file);
}

// ==================== CHIPS ====================
document.addEventListener('click', (e) => {
    if (e.target.matches('#toneChips .chip')) {
        document.querySelectorAll('#toneChips .chip').forEach(c => c.classList.remove('active'));
        e.target.classList.add('active');
        state.selectedTone = e.target.dataset.tone;
    }
    if (e.target.matches('#formatChips .chip')) {
        document.querySelectorAll('#formatChips .chip').forEach(c => c.classList.remove('active'));
        e.target.classList.add('active');
        state.selectedFormat = e.target.dataset.format;
    }
});

// ==================== РЕФЕРАЛКА ====================
function copyReferral() {
    const code = localStorage.getItem('refCode');
    const link = `https://t.me/${CONFIG.BOT_USERNAME}?startapp=${code}`;
    navigator.clipboard.writeText(link);
    tg.showAlert('Ссылка скопирована!');
    tg.HapticFeedback.notificationOccurred('success');
}

function shareReferral() {
    const code = localStorage.getItem('refCode');
    const botLink = `https://t.me/${CONFIG.BOT_USERNAME}?startapp=${code}`;
    const text = `🎨 Создаю рекламные карточки за 10 секунд! Попробуй:`;
    const shareUrl = `https://t.me/share/url?url=${encodeURIComponent(botLink)}&text=${encodeURIComponent(text)}`;
    tg.openTelegramLink(shareUrl);
}

// ==================== ОПЛАТА ====================
function openPayment() {
    document.getElementById('paymentModal').classList.add('active');
    tg.HapticFeedback.impactOccurred('medium');
}

function closeModal() {
    document.getElementById('paymentModal').classList.remove('active');
}

function openManager(method) {
    const messages = {
        stars: 'Привет! Хочу оплатить звёздами. Тариф: Пакет карточек.',
        crypto: 'Привет! Хочу оплатить в TON/USDT/$. Тариф: Пакет карточек.'
    };
    const url = `https://t.me/${CONFIG.MANAGER_USERNAME}?text=${encodeURIComponent(messages[method])}`;
    tg.openTelegramLink(url);
    closeModal();
}

// ==================== ИСТОРИЯ ====================
async function loadHistory() {
    const grid = document.getElementById('historyGrid');
    grid.innerHTML = '';
    try {
        const cards = await sb(`generated_cards?user_id=eq.${state.user.id}&order=created_at.desc&limit=30`);
        if (cards.length === 0) {
            document.getElementById('historyEmpty').style.display = 'block';
            return;
        }
        document.getElementById('historyEmpty').style.display = 'none';
        cards.forEach(c => {
            const img = document.createElement('img');
            img.src = c.image_preview;
            img.onclick = () => {
                document.getElementById('resultImage').src = c.image_preview;
                showScreen('result');
            };
            grid.appendChild(img);
        });
    } catch (e) {
        console.error(e);
    }
}

// ==================== СКАЧИВАНИЕ ====================
function downloadResult() {
    if (!state.generatedImage) return;
    const a = document.createElement('a');
    a.href = state.generatedImage;
    a.download = `card_${Date.now()}.png`;
    a.click();
    tg.HapticFeedback.notificationOccurred('success');
}

// ==================== ПРОГРЕСС ====================
function runProgressAnimation() {
    let progress = 0;
    const fill = document.getElementById('progressFill');
    fill.style.width = '0%';
    const interval = setInterval(() => {
        progress += 8;
        if (progress > 95) progress = 95;
        fill.style.width = progress + '%';
        if (progress >= 95) clearInterval(interval);
    }, 80);
}
// ==================== ГЕНЕРАЦИЯ ====================
async function generateCard() {
    const headline = document.getElementById('headline').value.trim();
    const subheadline = document.getElementById('subheadline').value.trim();
    const bulletsRaw = document.getElementById('bullets').value.trim();
    const cta = document.getElementById('cta').value.trim() || 'Купить';

    if (!headline) return tg.showAlert('Введите заголовок');
    if (!state.uploadedImage) return tg.showAlert('Загрузите фото');
    if (state.credits <= 0) {
        tg.showAlert('Закончились генерации');
        return goToPricing();
    }

    const bullets = bulletsRaw.split('\n').map(s => s.trim()).filter(Boolean).slice(0, 3);

    showScreen('generating');
    runProgressAnimation();

    try {
        const dataUrl = await renderCard({
            image: state.uploadedImage,
            headline,
            subheadline,
            bullets,
            cta,
            tone: state.selectedTone,
            format: state.selectedFormat
        });

        state.generatedImage = dataUrl;
        state.credits--;

        // Списание
        try {
            await sb(`users?id=eq.${state.user.id}`, 'PATCH', { credits: state.credits });
            await sb('transactions', 'POST', {
                user_id: state.user.id,
                type: 'spend',
                amount: -1,
                note: 'Генерация карточки'
            });
            await sb('generated_cards', 'POST', {
                user_id: state.user.id,
                image_preview: dataUrl.substring(0, 500),
                style: state.selectedTone,
                format: state.selectedFormat,
                has_watermark: true
            });
        } catch (dbErr) {
            console.error('DB save error:', dbErr);
        }

        document.getElementById('resultImage').src = dataUrl;
        setTimeout(() => {
            showScreen('result');
            tg.HapticFeedback.notificationOccurred('success');
        }, 500);
    } catch (e) {
        console.error(e);
        tg.showAlert('Ошибка: ' + e.message);
        showScreen('create');
    }
}

// ==================== РЕНДЕР КАРТОЧКИ ====================
function renderCard({ image, headline, subheadline, bullets, cta, tone, format }) {
    return new Promise((resolve, reject) => {
        const canvas = document.getElementById('renderCanvas');
        const ctx = canvas.getContext('2d');

        const sizes = {
            '1:1': [1080, 1080],
            '9:16': [1080, 1920],
            '16:9': [1920, 1080]
        };
        const [W, H] = sizes[format] || sizes['1:1'];
        canvas.width = W;
        canvas.height = H;

        const palettes = {
            premium: { bg1: '#1a1a2e', bg2: '#16213e', accent: '#e2b96f', text: '#ffffff', sub: '#c0c0d0' },
            bold:    { bg1: '#ff4757', bg2: '#c0392b', accent: '#ffeaa7', text: '#ffffff', sub: '#ffe8e8' },
            warm:    { bg1: '#ffb347', bg2: '#ff7b54', accent: '#ffffff', text: '#2d2016', sub: '#4a3528' },
            minimal: { bg1: '#f5f5f5', bg2: '#e8e8e8', accent: '#2d2d2d', text: '#1a1a1a', sub: '#666666' }
        };
        const p = palettes[tone] || palettes.premium;

        const img = new Image();
        img.onload = () => {
            try {
                // Фон
                const grad = ctx.createLinearGradient(0, 0, W, H);
                grad.addColorStop(0, p.bg1);
                grad.addColorStop(1, p.bg2);
                ctx.fillStyle = grad;
                ctx.fillRect(0, 0, W, H);

                // Фото (верхняя часть)
                const photoH = H * 0.55;
                const scale = Math.max(W / img.width, photoH / img.height);
                const dw = img.width * scale;
                const dh = img.height * scale;
                const dx = (W - dw) / 2;
                const dy = (photoH - dh) / 2;
                ctx.save();
                ctx.beginPath();
                ctx.rect(0, 0, W, photoH);
                ctx.clip();
                ctx.drawImage(img, dx, dy, dw, dh);
                ctx.restore();

                // Затемнение фото внизу
                const fade = ctx.createLinearGradient(0, photoH * 0.5, 0, photoH);
                fade.addColorStop(0, 'rgba(0,0,0,0)');
                fade.addColorStop(1, 'rgba(0,0,0,0.6)');
                ctx.fillStyle = fade;
                ctx.fillRect(0, photoH * 0.5, W, photoH * 0.5);

                // Заголовок
                const baseSize = W / 12;
                const padding = W * 0.08;
                let y = photoH + baseSize * 1.2;

                ctx.textAlign = 'left';
                ctx.fillStyle = p.text;
                ctx.font = `bold ${baseSize}px -apple-system, "SF Pro Display", Roboto, sans-serif`;

                // Обрезка длинного заголовка
                let headText = headline;
                while (ctx.measureText(headText).width > W - padding * 2 && headText.length > 5) {
                    headText = headText.slice(0, -1);
                }

                // Многострочный заголовок
                const headLines = wrapText(ctx, headText, W - padding * 2, 2);
                headLines.forEach((line, i) => {
                    ctx.fillText(line, padding, y + i * baseSize * 1.15);
                });
                y += headLines.length * baseSize * 1.15 + baseSize * 0.3;

                // Подзаголовок
                if (subheadline) {
                    ctx.fillStyle = p.sub;
                    ctx.font = `${baseSize * 0.55}px -apple-system, Roboto, sans-serif`;
                    const subLines = wrapText(ctx, subheadline, W - padding * 2, 2);
                    subLines.forEach((line, i) => {
                        ctx.fillText(line, padding, y + i * baseSize * 0.7);
                    });
                    y += subLines.length * baseSize * 0.7 + baseSize * 0.4;
                }

                // Буллеты
                if (bullets.length > 0) {
                    ctx.fillStyle = p.sub;
                    ctx.font = `${baseSize * 0.5}px -apple-system, Roboto, sans-serif`;
                    bullets.forEach(b => {
                        ctx.fillStyle = p.accent;
                        ctx.fillText('•', padding, y);
                        ctx.fillStyle = p.sub;
                        ctx.fillText(b, padding + baseSize * 0.5, y);
                        y += baseSize * 0.7;
                    });
                    y += baseSize * 0.3;
                }

                // CTA кнопка
                const ctaY = H - padding - baseSize * 2;
                const ctaH = baseSize * 1.6;
                ctx.font = `bold ${baseSize * 0.6}px -apple-system, Roboto, sans-serif`;
                const ctaW = Math.max(ctx.measureText(cta).width + padding * 1.2, W * 0.4);

                ctx.fillStyle = p.accent;
                roundRect(ctx, padding, ctaY, ctaW, ctaH, ctaH / 2);
                ctx.fill();

                ctx.fillStyle = (tone === 'warm' || tone === 'minimal') ? p.text : p.bg1;
                ctx.textAlign = 'center';
                ctx.font = `bold ${baseSize * 0.6}px -apple-system, Roboto, sans-serif`;
                ctx.fillText(cta, padding + ctaW / 2, ctaY + ctaH / 2 + baseSize * 0.2);

                // Водяной знак
                ctx.fillStyle = 'rgba(255,255,255,0.35)';
                ctx.font = `${baseSize * 0.4}px -apple-system, Roboto, sans-serif`;
                ctx.textAlign = 'right';
                ctx.fillText(CONFIG.WATERMARK_TEXT, W - padding / 2, H - padding / 4);

                resolve(canvas.toDataURL('image/png', 0.92));
            } catch (err) {
                reject(err);
            }
        };
        img.onerror = () => reject(new Error('Не удалось загрузить фото'));
        img.src = image;
    });
}

// Утилита: скруглённый прямоугольник
function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
}

// Утилита: разбить текст на строки
function wrapText(ctx, text, maxWidth, maxLines) {
    const words = text.split(' ');
    const lines = [];
    let current = '';

    for (const word of words) {
        const test = current ? current + ' ' + word : word;
        if (ctx.measureText(test).width <= maxWidth) {
            current = test;
        } else {
            if (current) lines.push(current);
            current = word;
            if (lines.length >= maxLines - 1) break;
        }
    }
    if (current) lines.push(current);
    return lines.slice(0, maxLines);
}

// ==================== СТАРТ ====================
init();
