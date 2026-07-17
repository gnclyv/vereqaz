// --- Global Dəyişənlər ---
let currentUser = null;

// --- 1. Toast bildiriş sistemi ---
function showToast(message, type = 'success') {
    const el = document.createElement('div');
    el.textContent = message;
    el.style.cssText = `position:fixed; bottom:20px; right:20px; z-index:9999; padding:12px 18px; border-radius:8px; color:#fff; font-size:14px; background:${type === 'error' ? '#A83232' : '#2F6F4E'}; box-shadow:0 4px 12px rgba(0,0,0,.3);`;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 3500);
}

// --- 2. Yardımçı Funksiyalar ---
function escapeHtml(str) { const div = document.createElement('div'); div.textContent = str ?? ''; return div.innerHTML; }
function debounce(func, delay) { let timer; return function (...args) { clearTimeout(timer); timer = setTimeout(() => func.apply(this, args), delay); }; }
function safeInit(name, fn) { try { fn(); } catch (err) { console.error(`Başlatma xətası (${name}):`, err); } }

// --- 3. DOM Başlanğıcı ---
document.addEventListener('DOMContentLoaded', () => {
    safeInit('checkUser', checkUser);
    safeInit('fetchBooks', fetchBooks);
    safeInit('setupDragAndDrop', setupDragAndDrop);
    safeInit('setupUploadForm', setupUploadForm);

    const searchInput = document.getElementById('searchInput');
    const categorySelect = document.getElementById('categorySelect');
    if (searchInput) searchInput.addEventListener('input', debounce(fetchBooks, 300));
    if (categorySelect) categorySelect.addEventListener('change', fetchBooks);
});

// --- 4. İstifadəçi İdarəetməsi ---
async function checkUser() {
    try {
        const res = await fetch('/api/me', { credentials: 'include' });
        const data = await res.json();
        if (data.user) {
            currentUser = data.user;
            const greet = document.getElementById('greetName');
            if (greet) greet.textContent = currentUser.username;
        } else { window.location.href = '/login.html'; }
    } catch (err) { console.error('İstifadəçi xətası:', err); }
}

async function logout() {
    const res = await fetch('/api/logout', { method: 'POST' });
    if (res.ok) window.location.href = '/login.html';
}

// --- 5. Kitab siyahısı və render ---
async function fetchBooks() {
    const grid = document.getElementById('bookGrid');
    const skeleton = document.getElementById('skeletonGrid');
    const emptyState = document.getElementById('emptyState');
    
    if (skeleton) skeleton.style.display = 'grid';
    try {
        const q = document.getElementById('searchInput')?.value || '';
        const cat = document.getElementById('categorySelect')?.value || 'Hamısı';
        const res = await fetch(`/api/books?q=${encodeURIComponent(q)}&category=${encodeURIComponent(cat)}`);
        const data = await res.json();
        
        if (grid) {
            grid.innerHTML = '';
            if (data.books.length === 0) {
                if (emptyState) emptyState.style.display = 'block';
            } else {
                if (emptyState) emptyState.style.display = 'none';
                data.books.forEach(book => {
                    const card = document.createElement('div');
                    card.className = 'book-card';
                    card.innerHTML = `
                        <div class="cover"><img src="${book.cover_image || ''}"></div>
                        <div class="card-body">
                            <h3>${escapeHtml(book.title)}</h3>
                            <div class="author">${escapeHtml(book.author)}</div>
                            <div class="card-actions">
                                <a href="/api/books/${book.id}/view" target="_blank" class="icon-btn">👁️</a>
                                <a href="/api/books/${book.id}/download" class="icon-btn">⬇️</a>
                                ${(currentUser && book.uploaded_by === currentUser.id) ? `<button onclick="deleteBook('${book.id}')" class="icon-btn">🗑️</button>` : ''}
                            </div>
                        </div>
                    `;
                    grid.appendChild(card);
                });
            }
        }
    } catch (err) { console.error(err); } finally { if (skeleton) skeleton.style.display = 'none'; }
}

// --- 6. Kitab Silinməsi ---
async function deleteBook(id) {
    if (!confirm('Bu kitabı silmək istəyirsiniz?')) return;
    try {
        const res = await fetch(`/api/books/${id}`, { method: 'DELETE' });
        if (res.ok) { showToast('Kitab silindi'); fetchBooks(); }
        else showToast('Silinmə xətası', 'error');
    } catch (e) { showToast('Server xətası', 'error'); }
}

// --- 7. Yükləmə Sistemi (Supabase İnteqrasiyası) ---
function setupDragAndDrop() {
    const setupZone = (zoneId, inputId, labelId) => {
        const zone = document.getElementById(zoneId);
        const input = document.getElementById(inputId);
        const label = document.getElementById(labelId);
        if (!zone || !input) return;
        zone.addEventListener('click', () => input.click());
        zone.addEventListener('drop', (e) => { e.preventDefault(); input.files = e.dataTransfer.files; if(label) label.textContent = input.files[0].name; });
        input.addEventListener('change', () => { if(label) label.textContent = input.files[0].name; });
    };
    setupZone('dropZone', 'pdfInput', 'dzFile');
    setupZone('coverDropZone', 'coverInput', 'dzCoverFile');
}

function setupUploadForm() {
    const form = document.getElementById('uploadForm');
    if (!form) return;
    
    // Supabase AÇARLARINI BURAYA YAZ
    const supabase = supabase.createClient('https://hhrbkricwmmtgpwygedq.supabase.co', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhocmJrcmljd21tdGdwd3lnZWRxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQyMjQwNTUsImV4cCI6MjA5OTgwMDA1NX0.n-shxgUao7ovM852I0fKcs0q00yM8Fw5aceF8wtd4ts');

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const pdfFile = document.getElementById('pdfInput').files[0];
        const uploadBtn = document.getElementById('uploadBtn');
        if (!pdfFile) return showToast('Fayl seçin!', 'error');

        uploadBtn.disabled = true;
        try {
            const fileName = Date.now() + '_' + pdfFile.name;
            const { error } = await supabase.storage.from('books').upload(fileName, pdfFile);
            if (error) throw error;

            const publicUrl = supabase.storage.from('books').getPublicUrl(fileName).data.publicUrl;

            const res = await fetch('/api/books', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    title: document.getElementById('titleInput').value,
                    author: document.getElementById('authorInput').value,
                    category: document.getElementById('catInput').value,
                    filename: publicUrl,
                    filesize: pdfFile.size
                })
            });

            if (!res.ok) throw new Error('Məlumat bazaya yazılmadı');
            showToast('Kitab uğurla yükləndi!');
            closeModal();
            fetchBooks();
        } catch (err) { showToast(err.message, 'error'); }
        finally { uploadBtn.disabled = false; }
    });
}

function closeModal() {
    document.getElementById('modalOverlay')?.classList.remove('open');
    document.getElementById('uploadForm')?.reset();
    const dzFile = document.getElementById('dzFile');
    if(dzFile) dzFile.textContent = '';
}
