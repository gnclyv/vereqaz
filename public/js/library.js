let currentUser = null;

// ---------- Toast fallback ----------
function showToast(message, type = 'success') {
  if (typeof window.showToast === 'function' && window.showToast !== showToast) {
    return window.showToast(message, type);
  }
  const el = document.createElement('div');
  el.textContent = message;
  el.style.cssText = `
    position:fixed; bottom:20px; right:20px; z-index:9999;
    padding:12px 18px; border-radius:8px; color:#fff; font-size:14px;
    background:${type === 'error' ? '#A83232' : '#2F6F4E'};
    box-shadow:0 4px 12px rgba(0,0,0,.3);
  `;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 3500);
}

// ---------- Başlanğıc ----------
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

function safeInit(name, fn) {
  try { fn(); } catch (err) { console.error(`Başlatma xətası (${name}):`, err); }
}

function debounce(func, delay) {
  let timer;
  return function (...args) {
    clearTimeout(timer);
    timer = setTimeout(() => func.apply(this, args), delay);
  };
}

// ---------- 1. İstifadəçi yoxlanışı ----------
async function checkUser() {
  try {
    const res = await fetch('/api/me', { credentials: 'include' });
    const data = await res.json();
    if (data.user) {
      currentUser = data.user;
      const greet = document.getElementById('greetName');
      const label = document.getElementById('usernameLabel');
      const avatar = document.getElementById('avatar');
      if (greet) greet.textContent = currentUser.username;
      if (label) label.textContent = currentUser.username;
      if (avatar) {
        avatar.textContent = currentUser.username.charAt(0).toUpperCase();
        avatar.style.background = currentUser.avatarColor || '#c9a227';
      }
    } else {
      window.location.href = '/login.html';
    }
  } catch (err) { console.error('İstifadəçi yoxlanılarkən xəta:', err); }
}

// ---------- 2. Kitabların siyahısı ----------
async function fetchBooks() {
  const skeleton = document.getElementById('skeletonGrid');
  const grid = document.getElementById('bookGrid');
  const emptyState = document.getElementById('emptyState');
  const searchVal = document.getElementById('searchInput')?.value || '';
  const categoryVal = document.getElementById('categorySelect')?.value || 'Hamısı';

  if (skeleton) skeleton.style.display = 'grid';
  if (grid) grid.style.display = 'none';
  if (emptyState) emptyState.style.display = 'none';

  try {
    let url = `/api/books?q=${encodeURIComponent(searchVal)}`;
    if (categoryVal !== 'Hamısı') url += `&category=${encodeURIComponent(categoryVal)}`;
    const res = await fetch(url, { credentials: 'include' });
    if (res.status === 401) { window.location.href = '/login.html'; return; }
    
    const data = await res.json();
    const books = data.books || [];

    if (grid) grid.innerHTML = '';
    if (skeleton) skeleton.style.display = 'none';
    if (books.length === 0) { if (emptyState) emptyState.style.display = 'block'; return; }
    
    if (grid) grid.style.display = 'grid';
    books.forEach((book, index) => {
      const coverHtml = book.cover_image ? `<img src="${book.cover_image}" class="book-cover-img">` : `<div class="glyph">${book.title.charAt(0)}</div>`;
      const deleteBtn = (currentUser && book.uploaded_by === currentUser.id) ? `<button class="icon-btn del" onclick="deleteBook('${book.id}')">🗑️</button>` : '';
      const card = document.createElement('div');
      card.className = 'book-card';
      card.innerHTML = `
        <div class="cover">${coverHtml}</div>
        <div class="card-body">
          <h3>${book.title}</h3>
          <div class="author">${book.author}</div>
          <div class="card-actions">
            <a href="/api/books/${book.id}/view" target="_blank" class="icon-btn">👁️</a>
            <a href="/api/books/${book.id}/download" class="icon-btn">⬇️</a>
            ${deleteBtn}
          </div>
        </div>
      `;
      grid.appendChild(card);
    });
  } catch (err) { console.error(err); }
}

// ---------- 3. Modal ----------
function closeModal() {
  document.getElementById('modalOverlay')?.classList.remove('open');
  document.getElementById('uploadForm')?.reset();
}

// ---------- 4. Kitab yükləmə (Supabase Client-Side) ----------
function setupUploadForm() {
  const form = document.getElementById('uploadForm');
  if (!form) return;

  // ÖZ AÇARLARINI BURAYA YAZ
  const supabase = supabase.createClient('URL_BURA', 'KEY_BURA');

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const pdfInput = document.getElementById('pdfInput');
    const titleInput = document.getElementById('titleInput'); 
    const authorInput = document.getElementById('authorInput');
    const uploadBtn = document.getElementById('uploadBtn');

    if (!pdfInput.files[0]) return showToast('Fayl seçin!', 'error');

    uploadBtn.disabled = true;
    try {
      const file = pdfInput.files[0];
      const fileName = Date.now() + '_' + file.name.replace(/[^a-zA-Z0-9.-]/g, '_');

      const { data, error } = await supabase.storage.from('books').upload(fileName, file);
      if (error) throw error;

      const publicUrl = supabase.storage.from('books').getPublicUrl(fileName).data.publicUrl;

      const res = await fetch('/api/books', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: titleInput.value,
          author: authorInput.value,
          filename: publicUrl,
          filesize: file.size
        })
      });

      if (!res.ok) throw new Error('Bazaya yazıla bilmədi');
      showToast('Kitab yükləndi!');
      closeModal();
      fetchBooks();
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      uploadBtn.disabled = false;
    }
  });
}

// ---------- 5. Kitabı silmək ----------
async function deleteBook(id) {
  if (!confirm('Silmək istədiyinizdən əminsiniz?')) return;
  const res = await fetch(`/api/books/${id}`, { method: 'DELETE', credentials: 'include' });
  if (res.ok) { showToast('Kitab silindi'); fetchBooks(); }
}
