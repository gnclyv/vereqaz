require('dotenv').config();
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const session = require('express-session');
const PgSession = require('connect-pg-simple')(session);
const bcrypt = require('bcryptjs');
const { createClient } = require('@supabase/supabase-js');
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

// Supabase Storage müştərisi (Birbaşa brauzerdən yükləmə üçün)
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

app.use(express.json({ limit: '1mb' })); // Yalnız JSON qəbul edirik, fayl gəlmir
app.use(express.urlencoded({ extended: true }));
app.set('trust proxy', 1);

// Sessiya konfiqurasiyası
const sessionStore = new PgSession({
  conString: process.env.DATABASE_URL,
  tableName: 'session',
  createTableIfMissing: true,
  ssl: { rejectUnauthorized: false }
});

app.use(session({
  store: sessionStore,
  secret: process.env.SESSION_SECRET || 'gizli-acar-' + crypto.randomBytes(16).toString('hex'),
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 1000 * 60 * 60 * 24 * 7,
    secure: process.env.NODE_ENV === 'production',
    sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax'
  }
}));

app.use(express.static(path.join(__dirname, 'public')));

// --- Köməkçi funksiyalar ---
function requireAuth(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: 'Daxil olun!' });
  next();
}

function publicUser(row) {
  return { id: row.id, username: row.username, email: row.email, avatarColor: row.avatar_color };
}

// --- Auth API ---
app.post('/api/register', async (req, res) => {
  try {
    const { username, email, password } = req.body;
    const exists = await db.userExists(username.trim(), email.trim().toLowerCase());
    if (exists) return res.status(409).json({ error: 'İstifadəçi mövcuddur' });
    const hash = await bcrypt.hash(password, 10);
    const user = await db.createUser({ username: username.trim(), email: email.trim().toLowerCase(), password_hash: hash });
    req.session.userId = user.id;
    res.json({ user: publicUser(user) });
  } catch (e) { res.status(500).json({ error: 'Server xətası' }); }
});

app.post('/api/login', async (req, res) => {
  try {
    const user = await db.findUserByUsernameOrEmail(req.body.identifier.trim());
    if (user && await bcrypt.compare(req.body.password, user.password_hash)) {
      req.session.userId = user.id;
      res.json({ user: publicUser(user) });
    } else { res.status(401).json({ error: 'Yanlış məlumatlar' }); }
  } catch (e) { res.status(500).json({ error: 'Server xətası' }); }
});

app.post('/api/logout', (req, res) => { req.session.destroy(() => res.json({ ok: true })); });

app.get('/api/me', async (req, res) => {
  if (!req.session.userId) return res.json({ user: null });
  const user = await db.findUserById(req.session.userId);
  res.json({ user: user ? publicUser(user) : null });
});

// --- Books API (Burada multer yoxdur, birbaşa JSON gəlir) ---
app.get('/api/books', requireAuth, async (req, res) => {
  const rows = await db.listBooks({ q: (req.query.q || ''), category: (req.query.category || '') });
  res.json({ books: rows });
});

app.post('/api/books', requireAuth, async (req, res) => {
  try {
    const { title, author, category, filename, filesize, description } = req.body;
    if (!filename) return res.status(400).json({ error: 'Fayl URL-i tələb olunur' });

    const book = await db.createBook({
      title: title.trim(),
      author: author.trim(),
      description: (description || '').trim(),
      category: category || 'Digər',
      filename: filename,
      filesize: filesize,
      uploaded_by: req.session.userId
    });
    res.status(201).json({ id: book.id });
  } catch (e) {
    console.error('DATABASE UPLOAD ERROR:', e);
    res.status(500).json({ error: 'Bazaya yazıla bilmədi' });
  }
});

app.delete('/api/books/:id', requireAuth, async (req, res) => {
  try {
    const book = await db.findBookById(req.params.id);
    if (!book) return res.status(404).json({ error: 'Kitab tapılmadı' });
    if (book.uploaded_by !== req.session.userId) return res.status(403).json({ error: 'Səlahiyyət yoxdur' });

    // Supabase-dən faylı silmək üçün fayl adını çıxarırıq
    const fileName = book.filename.split('/').pop();
    await supabase.storage.from('books').remove([fileName]);
    await db.deleteBook(book.id);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: 'Silinmə xətası' }); }
});

// --- Yönləndirmələr ---
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// --- Server ---
if (require.main === module) {
  app.listen(PORT, () => console.log(`Server işə düşdü: ${PORT}`));
}

module.exports = app;
