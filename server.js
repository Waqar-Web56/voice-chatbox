require('dotenv').config();
const express = require('express');
const multer = require('multer');
const path = require('path');

if (typeof fetch === 'undefined' || typeof FormData === 'undefined') {
  console.error('Node 18 or newer is required. Your version: ' + process.version);
  process.exit(1);
}
const VERSION = 'v5-browser-voice-fallback';
console.log('Server version:', VERSION);
const app = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });
const { GROQ_API_KEY, ELEVENLABS_API_KEY } = process.env;
const VOICE_ID = process.env.ELEVENLABS_VOICE_ID || '21m00Tcm4TlvDq8ikWAM';

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const APOLOGY = 'معذرت، ہم اس سوال کا جواب نہیں دے سکتے۔ براہ کرم ریسٹورنٹ سے متعلق سوال پوچھیں۔';

// Edit this block to match your real restaurant details.
const KNOWLEDGE = `
ریسٹورنٹ کا نام: ڈیرہ دسترخوان، بھکر۔
مقام: جھنگ روڈ، چوک فوارہ کے قریب، بھکر۔ فون اور واٹس ایپ: 0300-0000000۔
اوقات: ہفتے کے ساتوں دن دوپہر بارہ بجے سے رات بارہ بجے تک۔
مینو اور قیمتیں (روپے میں):
- چکن کڑاہی: آدھا کلو چودہ سو، ایک کلو چھبیس سو
- مٹن کڑاہی: آدھا کلو اٹھارہ سو، ایک کلو پینتیس سو
- چکن بریانی: تین سو پچاس
- سیخ کباب (چار عدد): چار سو پچاس
- چپلی کباب: تین سو اسی
- چکن تکہ ٹانگ: چار سو
- دال ماش: تین سو
- نان: تیس، روغنی نان: پچاس
- لسی گلاس: ایک سو پچاس
- دودھ پتی چائے: اسی
- گلاب جامن (دو عدد): ایک سو بیس
آن لائن آرڈر: ہاں، ویب سائٹ کے آرڈر بٹن سے واٹس ایپ پر یا فون پر 0300-0000000 پر آرڈر دیا جا سکتا ہے۔
ہوم ڈیلیوری: ہاں، بھکر شہر کے اندر۔ پندرہ سو روپے سے اوپر کے آرڈر پر ڈیلیوری مفت، ورنہ ایک سو روپے۔
آرڈر کا وقت: ڈیلیوری میں تیس سے پینتالیس منٹ، ریسٹورنٹ میں بیٹھ کر بیس سے تیس منٹ۔
سب سے مشہور ڈش: چکن کڑاہی۔ اس کے بعد چکن بریانی اور سیخ کباب۔
آرڈر میں تبدیلی: ہاں، مرچ کم یا زیادہ، کم تیل، بغیر پیاز، اور اضافی سائز کی فرمائش کی جا سکتی ہے۔ آرڈر دیتے وقت بتا دیں۔
ادائیگی: نقد، ڈیلیوری پر نقد، جاز کیش، ایزی پیسہ اور بینک ٹرانسفر۔
`;

const SYSTEM_PROMPT = `تم ریسٹورنٹ "ڈیرہ دسترخوان" کے صوتی اسسٹنٹ ہو۔
قواعد:
1. صرف اردو رسم الخط میں جواب دو، زیادہ سے زیادہ دو تین مختصر جملے۔
2. صرف نیچے دی گئی معلومات کی بنیاد پر جواب دو۔ قیمتیں اور اعداد لفظوں میں لکھو تاکہ آواز میں درست پڑھے جائیں۔
3. اگر سوال ریسٹورنٹ، کھانے، مینو، آرڈر، ڈیلیوری، اوقات، ادائیگی یا مقام سے متعلق نہیں ہے، یا جواب معلومات میں موجود نہیں، تو بالکل یہی جملہ لکھو: ${APOLOGY}
4. جواب میں ایموجی، ستارے یا فہرست کی علامات استعمال نہ کرو۔

معلومات:
${KNOWLEDGE}`;

async function transcribe(file) {
  const fd = new FormData();
  const mime = (file.mimetype || 'audio/webm').split(';')[0];
  const ext = mime.includes('mp4') ? 'mp4' : mime.includes('ogg') ? 'ogg' : mime.includes('wav') ? 'wav' : 'webm';
  fd.append('file', new Blob([file.buffer], { type: mime }), 'voice.' + ext);
  fd.append('model', 'whisper-large-v3');
  fd.append('language', 'ur');
  fd.append('temperature', '0');
  fd.append('response_format', 'json');
  const r = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
    method: 'POST', headers: { Authorization: `Bearer ${GROQ_API_KEY}` }, body: fd
  });
  if (!r.ok) throw new Error('Whisper: ' + (await r.text()));
  return ((await r.json()).text || '').trim();
}

let chatModel = process.env.GROQ_CHAT_MODEL || null;
const PREFERRED = ['openai/gpt-oss-120b','llama-3.3-70b-versatile','openai/gpt-oss-20b','meta-llama/llama-4-scout-17b-16e-instruct','llama-3.1-8b-instant','qwen/qwen3-32b'];
async function pickModel() {
  if (chatModel) return chatModel;
  const r = await fetch('https://api.groq.com/openai/v1/models', { headers: { Authorization: `Bearer ${GROQ_API_KEY}` } });
  if (!r.ok) throw new Error('Groq models list: ' + (await r.text()));
  const ids = (await r.json()).data.map(m => m.id);
  const skip = /whisper|guard|tts|playai|orpheus|safeguard|allam/i;
  chatModel = PREFERRED.find(m => ids.includes(m)) || ids.find(i => !skip.test(i));
  if (!chatModel) throw new Error('No chat model available. Models: ' + ids.join(', '));
  console.log('Using Groq chat model:', chatModel);
  return chatModel;
}

async function askLLM(question) {
  const model = await pickModel();
  const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${GROQ_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      max_tokens: 1000,
      ...(model.includes('gpt-oss') ? { reasoning_effort: 'low' } : {}),
      messages: [{ role: 'system', content: SYSTEM_PROMPT }, { role: 'user', content: question }]
    })
  });
  if (!r.ok) { const t = await r.text(); if (/model_not_found|decommission/i.test(t)) chatModel = process.env.GROQ_CHAT_MODEL ? chatModel : null; throw new Error('Groq chat (' + model + '): ' + t); }
  return ((await r.json()).choices[0].message.content || '').replace(/<think>[\s\S]*?<\/think>/g, '').trim() || APOLOGY;
}

// Free ElevenLabs accounts can only use "premade" voices via the API, so we find one that works.
const FALLBACK_VOICES = ['EXAVITQu4vr4xnSDxMaL','CwhRBWXzGAHq8TQ4Fs17','JBFqnCBsd6RMkjVDRZzb','9BWtsMINqrJLrRacOk9x','pNInz6obpgDQGcFmaJgB'];
let goodVoice = null;

async function voiceCandidates() {
  const list = [];
  if (process.env.ELEVENLABS_VOICE_ID && process.env.ELEVENLABS_VOICE_ID !== '21m00Tcm4TlvDq8ikWAM') list.push(process.env.ELEVENLABS_VOICE_ID);
  try {
    const r = await fetch('https://api.elevenlabs.io/v1/voices', { headers: { 'xi-api-key': ELEVENLABS_API_KEY } });
    if (r.ok) {
      const v = (await r.json()).voices || [];
      v.filter(x => x.category === 'premade').forEach(x => list.push(x.voice_id));
      v.filter(x => x.category !== 'premade').forEach(x => list.push(x.voice_id));
    }
  } catch (e) { console.error('Voice list failed:', e.message); }
  return [...new Set([...list, ...FALLBACK_VOICES])];
}

async function ttsWith(voiceId, text) {
  const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=mp3_44100_64`, {
    method: 'POST',
    headers: { 'xi-api-key': ELEVENLABS_API_KEY, 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
    body: JSON.stringify({ text, model_id: 'eleven_multilingual_v2', voice_settings: { stability: 0.5, similarity_boost: 0.75 } })
  });
  if (!r.ok) throw new Error('ElevenLabs: ' + (await r.text()));
  return Buffer.from(await r.arrayBuffer()).toString('base64');
}

async function speak(text) {
  if (goodVoice) {
    try { return await ttsWith(goodVoice, text); } catch (e) { console.error('Saved voice failed, searching again'); goodVoice = null; }
  }
  let lastErr;
  for (const id of await voiceCandidates()) {
    try { const audio = await ttsWith(id, text); goodVoice = id; console.log('Using ElevenLabs voice:', id); return audio; }
    catch (e) { lastErr = e; if (/quota|unauthorized|invalid_api_key/i.test(e.message)) break; }
  }
  throw new Error('[' + VERSION + '] no voice worked on this plan. ' + (lastErr ? lastErr.message.slice(0, 160) : ''));
}

app.post('/api/voice', upload.single('audio'), async (req, res) => {
  let stage = 'upload';
  try {
    if (!req.file) throw new Error('No audio received by server');
    stage = 'whisper (voice to text)';
    const question = await transcribe(req.file);
    console.log('Heard:', question);
    stage = 'groq (understanding)';
    const answer = question.length < 2
      ? 'معذرت، آپ کی آواز واضح نہیں آئی۔ براہ کرم دوبارہ بولیں۔'
      : await askLLM(question);
    stage = 'elevenlabs (text to voice)';
    let audio = null, ttsError = null;
    try { audio = await speak(answer); } catch (e) { ttsError = e.message; console.error(e.message); }
    res.json({ question, answer, audio, ttsError });
  } catch (e) {
    console.error('[' + stage + ']', e.message);
    res.status(500).json({ error: true, stage, detail: String(e.message).slice(0, 300) });
  }
});

// Open http://localhost:3000/api/check to test both services
app.get('/api/check', async (req, res) => {
  const out = { version: VERSION, node: process.version, groqKey: !!GROQ_API_KEY, elevenKey: !!ELEVENLABS_API_KEY };
  try { out.groqChat = await askLLM('مینو میں کیا ہے؟'); } catch (e) { out.groqChat = 'FAILED: ' + e.message; }
  try { out.elevenlabs = (await speak('السلام علیکم')).length > 100 ? 'OK' : 'empty'; } catch (e) { out.elevenlabs = 'FAILED: ' + e.message; }
  res.json(out);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Running on http://localhost:${PORT}`));
