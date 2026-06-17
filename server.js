const express = require('express');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs'); // bcryptjs - compile kerak emas!
const jwt = require('jsonwebtoken');
const cors = require('cors');
const dotenv = require('dotenv');

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const JWT_SECRET = process.env.JWT_SECRET || 'vocabmaster-secret-key-2024';
const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/vocabmaster';

// MongoDB Connect
mongoose.connect(MONGO_URI)
  .then(() => console.log('✅ MongoDB connected!'))
  .catch(err => {
    console.log('⚠️  MongoDB ulanmadi. JSON file storage ishlatilmoqda...');
    console.log('Error:', err.message);
  });

// ===== SCHEMAS =====
const userSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  createdAt: { type: Date, default: Date.now },
  learningStreak: { type: Number, default: 0 },
  lastLearningDate: Date,
  totalWordsLearned: { type: Number, default: 0 },
  dailyGoal: { type: Number, default: 10 },
  preferences: {
    darkMode: { type: Boolean, default: true }
  }
});

const folderSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  name: { type: String, required: true },
  description: String,
  color: { type: String, default: '#3B82F6' },
  createdAt: { type: Date, default: Date.now }
});

const wordSchema = new mongoose.Schema({
  folderId: { type: mongoose.Schema.Types.ObjectId, ref: 'Folder', required: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  word: { type: String, required: true },
  definition: { type: String, required: true },
  example: String,
  translation: String,
  pronunciation: String,
  difficulty: { type: String, enum: ['easy', 'medium', 'hard'], default: 'medium' },
  synonyms: [String],
  antonyms: [String],
  mastered: { type: Boolean, default: false },
  reviewed: { type: Number, default: 0 },
  lastReviewDate: Date,
  nextReviewDate: { type: Date, default: Date.now },
  isFavorite: { type: Boolean, default: false },
  interval: { type: Number, default: 1 },
  easeFactor: { type: Number, default: 2.5 },
  createdAt: { type: Date, default: Date.now }
});

const studySessionSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  folderId: { type: mongoose.Schema.Types.ObjectId, ref: 'Folder', required: true },
  wordsStudied: { type: Number, default: 0 },
  correctAnswers: { type: Number, default: 0 },
  studyMode: { type: String, default: 'flashcard' },
  duration: Number,
  score: Number,
  date: { type: Date, default: Date.now }
});

const User = mongoose.model('User', userSchema);
const Folder = mongoose.model('Folder', folderSchema);
const Word = mongoose.model('Word', wordSchema);
const StudySession = mongoose.model('StudySession', studySessionSchema);

// ===== AUTH MIDDLEWARE =====
const auth = async (req, res, next) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'Token kerak!' });
    const decoded = jwt.verify(token, JWT_SECRET);
    req.userId = decoded.userId;
    next();
  } catch {
    res.status(401).json({ error: 'Token noto\'g\'ri' });
  }
};

// ===== AUTH ROUTES =====

// Register
app.post('/api/auth/register', async (req, res) => {
  try {
    const { username, email, password } = req.body;
    if (!username || !email || !password)
      return res.status(400).json({ error: 'Barcha maydonlar to\'ldirilsin!' });

    const exists = await User.findOne({ $or: [{ username }, { email }] });
    if (exists) return res.status(409).json({ error: 'Foydalanuvchi mavjud!' });

    const hashed = await bcrypt.hash(password, 10);
    const user = new User({ username, email, password: hashed });
    await user.save();

    const token = jwt.sign({ userId: user._id }, JWT_SECRET, { expiresIn: '30d' });
    res.status(201).json({ token, user: { id: user._id, username, email } });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Login
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email });
    if (!user) return res.status(401).json({ error: 'Email yoki parol noto\'g\'ri' });

    const valid = await bcrypt.compare(password, user.password);
    if (!valid) return res.status(401).json({ error: 'Email yoki parol noto\'g\'ri' });

    const token = jwt.sign({ userId: user._id }, JWT_SECRET, { expiresIn: '30d' });
    res.json({ token, user: { id: user._id, username: user.username, email } });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Get Profile
app.get('/api/auth/me', auth, async (req, res) => {
  try {
    const user = await User.findById(req.userId).select('-password');
    res.json(user);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Update streak
app.post('/api/auth/streak', auth, async (req, res) => {
  try {
    const user = await User.findById(req.userId);
    const today = new Date().toDateString();
    const lastDate = user.lastLearningDate?.toDateString();

    if (lastDate !== today) {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const isConsecutive = lastDate === yesterday.toDateString();

      user.learningStreak = isConsecutive ? user.learningStreak + 1 : 1;
      user.lastLearningDate = new Date();
      await user.save();
    }

    res.json({ streak: user.learningStreak });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ===== FOLDER ROUTES =====
app.get('/api/folders', auth, async (req, res) => {
  try {
    const folders = await Folder.find({ userId: req.userId }).sort({ createdAt: -1 });
    // Add word count to each folder
    const foldersWithStats = await Promise.all(folders.map(async f => {
      const totalWords = await Word.countDocuments({ folderId: f._id });
      const masteredWords = await Word.countDocuments({ folderId: f._id, mastered: true });
      return { ...f.toObject(), totalWords, masteredWords };
    }));
    res.json(foldersWithStats);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/folders', auth, async (req, res) => {
  try {
    const { name, description, color } = req.body;
    if (!name) return res.status(400).json({ error: 'Papka nomi kerak!' });
    const folder = new Folder({ userId: req.userId, name, description, color });
    await folder.save();
    res.status(201).json(folder);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.put('/api/folders/:id', auth, async (req, res) => {
  try {
    const folder = await Folder.findOneAndUpdate(
      { _id: req.params.id, userId: req.userId },
      req.body,
      { new: true }
    );
    if (!folder) return res.status(404).json({ error: 'Papka topilmadi' });
    res.json(folder);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/folders/:id', auth, async (req, res) => {
  try {
    const folder = await Folder.findOneAndDelete({ _id: req.params.id, userId: req.userId });
    if (!folder) return res.status(404).json({ error: 'Papka topilmadi' });
    await Word.deleteMany({ folderId: folder._id });
    res.json({ message: 'Papka o\'chirildi' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ===== WORD ROUTES =====
app.get('/api/folders/:folderId/words', auth, async (req, res) => {
  try {
    const { difficulty, favorites, search, sort } = req.query;
    let query = { folderId: req.params.folderId, userId: req.userId };

    if (difficulty && difficulty !== 'all') query.difficulty = difficulty;
    if (favorites === 'true') query.isFavorite = true;
    if (search) {
      query.$or = [
        { word: { $regex: search, $options: 'i' } },
        { definition: { $regex: search, $options: 'i' } },
        { translation: { $regex: search, $options: 'i' } }
      ];
    }

    let sortQuery = { createdAt: -1 };
    if (sort === 'alphabetical') sortQuery = { word: 1 };
    if (sort === 'difficulty') sortQuery = { difficulty: 1 };
    if (sort === 'reviewed') sortQuery = { reviewed: -1 };

    const words = await Word.find(query).sort(sortQuery);
    res.json(words);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/words', auth, async (req, res) => {
  try {
    const { folderId, word, definition, example, translation, difficulty, pronunciation, synonyms, antonyms } = req.body;
    if (!word || !definition) return res.status(400).json({ error: 'So\'z va ta\'rif kerak!' });

    const folder = await Folder.findOne({ _id: folderId, userId: req.userId });
    if (!folder) return res.status(404).json({ error: 'Papka topilmadi' });

    const newWord = new Word({
      userId: req.userId,
      folderId,
      word, definition, example, translation, difficulty, pronunciation,
      synonyms: synonyms || [],
      antonyms: antonyms || []
    });
    await newWord.save();
    res.status(201).json(newWord);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.put('/api/words/:id', auth, async (req, res) => {
  try {
    const word = await Word.findOneAndUpdate(
      { _id: req.params.id, userId: req.userId },
      req.body,
      { new: true }
    );
    if (!word) return res.status(404).json({ error: 'So\'z topilmadi' });
    res.json(word);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/words/:id', auth, async (req, res) => {
  try {
    const word = await Word.findOneAndDelete({ _id: req.params.id, userId: req.userId });
    if (!word) return res.status(404).json({ error: 'So\'z topilmadi' });
    res.json({ message: 'So\'z o\'chirildi' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Toggle favorite
app.patch('/api/words/:id/favorite', auth, async (req, res) => {
  try {
    const word = await Word.findOne({ _id: req.params.id, userId: req.userId });
    if (!word) return res.status(404).json({ error: 'So\'z topilmadi' });
    word.isFavorite = !word.isFavorite;
    await word.save();
    res.json(word);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ===== SPACED REPETITION (SM-2 Algorithm) =====
app.post('/api/words/:id/review', auth, async (req, res) => {
  try {
    const { quality } = req.body; // 0-5: 0=forgot, 5=perfect
    const word = await Word.findOne({ _id: req.params.id, userId: req.userId });
    if (!word) return res.status(404).json({ error: 'So\'z topilmadi' });

    const q = parseInt(quality);
    word.reviewed += 1;

    // SM-2 Algorithm
    if (q >= 3) {
      if (word.reviewed === 1) word.interval = 1;
      else if (word.reviewed === 2) word.interval = 3;
      else word.interval = Math.round(word.interval * word.easeFactor);
    } else {
      word.interval = 1;
    }

    word.easeFactor = Math.max(1.3, word.easeFactor + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02)));
    word.mastered = word.reviewed >= 5 && q >= 4;

    const nextDate = new Date();
    nextDate.setDate(nextDate.getDate() + word.interval);
    word.nextReviewDate = nextDate;
    word.lastReviewDate = new Date();

    await word.save();

    // Update user total
    await User.findByIdAndUpdate(req.userId, { $inc: { totalWordsLearned: 1 } });

    res.json(word);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Due for review
app.get('/api/folders/:folderId/due-words', auth, async (req, res) => {
  try {
    const dueWords = await Word.find({
      folderId: req.params.folderId,
      userId: req.userId,
      nextReviewDate: { $lte: new Date() },
      mastered: false
    }).limit(20);
    res.json(dueWords);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ===== STUDY SESSIONS =====
app.post('/api/sessions', auth, async (req, res) => {
  try {
    const session = new StudySession({ userId: req.userId, ...req.body });
    await session.save();
    res.status(201).json(session);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/sessions', auth, async (req, res) => {
  try {
    const { folderId, limit = 30 } = req.query;
    const query = { userId: req.userId };
    if (folderId) query.folderId = folderId;

    const sessions = await StudySession.find(query)
      .sort({ date: -1 })
      .limit(parseInt(limit));

    const totalWordsStudied = sessions.reduce((sum, s) => sum + s.wordsStudied, 0);
    const totalDuration = sessions.reduce((sum, s) => sum + (s.duration || 0), 0);
    const avgAccuracy = sessions.length > 0
      ? sessions.reduce((sum, s) => sum + (s.wordsStudied > 0 ? s.correctAnswers / s.wordsStudied : 0), 0) / sessions.length
      : 0;

    res.json({
      sessions,
      stats: {
        totalSessions: sessions.length,
        totalWordsStudied,
        totalDuration,
        avgAccuracy: Math.round(avgAccuracy * 100)
      }
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ===== STATISTICS =====
app.get('/api/stats', auth, async (req, res) => {
  try {
    const user = await User.findById(req.userId).select('-password');
    const allWords = await Word.find({ userId: req.userId });
    const allFolders = await Folder.find({ userId: req.userId });
    const sessions = await StudySession.find({ userId: req.userId });

    // Daily stats (last 7 days)
    const last7Days = [];
    for (let i = 6; i >= 0; i--) {
      const date = new Date();
      date.setDate(date.getDate() - i);
      const dayStart = new Date(date.setHours(0, 0, 0, 0));
      const dayEnd = new Date(date.setHours(23, 59, 59, 999));
      const daySessions = sessions.filter(s => s.date >= dayStart && s.date <= dayEnd);
      last7Days.push({
        date: dayStart.toLocaleDateString('uz-UZ', { weekday: 'short' }),
        words: daySessions.reduce((sum, s) => sum + s.wordsStudied, 0),
        sessions: daySessions.length
      });
    }

    // Difficulty breakdown
    const difficultyStats = {
      easy: allWords.filter(w => w.difficulty === 'easy').length,
      medium: allWords.filter(w => w.difficulty === 'medium').length,
      hard: allWords.filter(w => w.difficulty === 'hard').length
    };

    res.json({
      user: { username: user.username, email: user.email, learningStreak: user.learningStreak },
      overview: {
        totalFolders: allFolders.length,
        totalWords: allWords.length,
        masteredWords: allWords.filter(w => w.mastered).length,
        favoriteWords: allWords.filter(w => w.isFavorite).length,
        dueForReview: allWords.filter(w => !w.mastered && w.nextReviewDate <= new Date()).length,
        totalSessions: sessions.length,
        totalWordsLearned: user.totalWordsLearned
      },
      dailyStats: last7Days,
      difficultyStats
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ===== ACHIEVEMENTS =====
app.get('/api/achievements', auth, async (req, res) => {
  try {
    const user = await User.findById(req.userId);
    const wordCount = await Word.countDocuments({ userId: req.userId });
    const masteredCount = await Word.countDocuments({ userId: req.userId, mastered: true });
    const sessionCount = await StudySession.countDocuments({ userId: req.userId });

    const allAchievements = [
      { id: 'first_word', name: 'Birinchi Qadam', desc: 'Birinchi so\'zni qo\'shdingiz!', icon: '🎉', unlocked: wordCount >= 1 },
      { id: 'ten_words', name: '10 ta So\'z', desc: '10 ta so\'z qo\'shildi', icon: '📚', unlocked: wordCount >= 10 },
      { id: 'fifty_words', name: '50 ta So\'z', desc: '50 ta so\'z qo\'shildi', icon: '🚀', unlocked: wordCount >= 50 },
      { id: 'hundred_words', name: 'Yuz So\'z', desc: '100 ta so\'z! Ajoyib!', icon: '💯', unlocked: wordCount >= 100 },
      { id: 'five_hundred', name: 'Besh Yuz!', desc: '500 ta so\'z - Zo\'r!', icon: '🌟', unlocked: wordCount >= 500 },
      { id: 'first_mastered', name: 'Birinchi Mastered', desc: 'Birinchi so\'z mastered qilindi', icon: '🏆', unlocked: masteredCount >= 1 },
      { id: 'ten_mastered', name: '10 Mastered', desc: '10 ta so\'z mastered', icon: '🥇', unlocked: masteredCount >= 10 },
      { id: 'fifty_mastered', name: '50 Mastered', desc: '50 ta so\'z mastered', icon: '👑', unlocked: masteredCount >= 50 },
      { id: 'streak_3', name: '3 Kun Ketma-ket', desc: '3 kun o\'qidingiz', icon: '🔥', unlocked: user.learningStreak >= 3 },
      { id: 'streak_7', name: 'Haftalik Olov', desc: '7 kun ketma-ket', icon: '⚡', unlocked: user.learningStreak >= 7 },
      { id: 'streak_30', name: 'Oy Champion!', desc: '30 kun ketma-ket!', icon: '🦁', unlocked: user.learningStreak >= 30 },
      { id: 'ten_sessions', name: '10 Sessiya', desc: '10 ta o\'qish sessiyasi', icon: '📖', unlocked: sessionCount >= 10 },
      { id: 'sat_ready', name: 'SAT Ready', desc: '200+ so\'z mastered', icon: '🎓', unlocked: masteredCount >= 200 },
      { id: 'ielts_ready', name: 'IELTS Ready', desc: '500+ so\'z mastered', icon: '🌍', unlocked: masteredCount >= 500 }
    ];

    res.json(allAchievements);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ===== EXPORT/IMPORT =====
app.get('/api/folders/:id/export', auth, async (req, res) => {
  try {
    const folder = await Folder.findOne({ _id: req.params.id, userId: req.userId });
    if (!folder) return res.status(404).json({ error: 'Papka topilmadi' });

    const words = await Word.find({ folderId: folder._id });
    const csv = ['Word,Definition,Example,Translation,Difficulty,Mastered']
      .concat(words.map(w =>
        `"${w.word}","${w.definition}","${w.example || ''}","${w.translation || ''}","${w.difficulty}","${w.mastered}"`
      )).join('\n');

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${folder.name}.csv"`);
    res.send('\uFEFF' + csv); // BOM for Excel
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/folders/:id/import', auth, async (req, res) => {
  try {
    const { words: wordsData } = req.body;
    const folder = await Folder.findOne({ _id: req.params.id, userId: req.userId });
    if (!folder) return res.status(404).json({ error: 'Papka topilmadi' });

    const created = await Word.insertMany(
      wordsData.map(w => ({ ...w, folderId: folder._id, userId: req.userId }))
    );
    res.json({ imported: created.length });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ===== SEARCH (global) =====
app.get('/api/search', auth, async (req, res) => {
  try {
    const { q } = req.query;
    if (!q) return res.json([]);

    const words = await Word.find({
      userId: req.userId,
      $or: [
        { word: { $regex: q, $options: 'i' } },
        { definition: { $regex: q, $options: 'i' } },
        { translation: { $regex: q, $options: 'i' } }
      ]
    }).limit(20).populate('folderId', 'name');

    res.json(words);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ===== HEALTH CHECK =====
app.get('/api/health', (req, res) => {
  res.json({
    status: 'OK',
    message: 'VocabMaster server ishlayapti! 🚀',
    time: new Date().toISOString(),
    mongodb: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected'
  });
});

// ===== START =====
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log('');
  console.log('╔════════════════════════════════════╗');
  console.log('║   🎓 VocabMaster Server             ║');
  console.log(`║   🚀 Port: ${PORT}                      ║`);
  console.log('║   ✅ Ready for SAT/IELTS prep!      ║');
  console.log('╚════════════════════════════════════╝');
  console.log('');
});
