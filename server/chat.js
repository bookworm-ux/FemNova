import { privacy, readPrivateText } from './privacy.js';
import { isUrgentQuestion } from './analysis.js';

// Fixed, developer-authored educational content. User-provided retrieval context
// must be included in the gateway input before it can be added here.
const knowledge = [
  { topic: 'cycle', content: 'A menstrual cycle is counted from the first day of bleeding to the day before the next period. Cycle length and symptoms vary between people. Tracking over several months can reveal personal patterns.' },
  { topic: 'nutrition', content: 'Regular meals with protein, iron-rich foods, fibre, and hydration can support energy. Vitamin C helps the body absorb plant-based iron. Nutrition advice should be adapted for allergies, conditions, and clinician guidance.' },
  { topic: 'mood', content: 'Hormonal changes across the cycle can coincide with changes in mood, sleep, appetite, and energy, but they do not explain every experience. Persistent or severe mood symptoms deserve professional support.' },
  { topic: 'labs', content: 'Typical adult non-pregnant reference ranges used by FemNova are Free T3 2.3 to 4.2 pg/mL, Free T4 0.8 to 1.8 ng/dL, TSH 0.4 to 4.0 mIU/L, and haemoglobin 12.0 to 15.5 g/dL. Laboratories may use different ranges; results need clinical context.' },
  { topic: 'safety', content: 'Seek urgent medical help for severe pain, fainting, chest pain, trouble breathing, very heavy bleeding, or thoughts of self-harm. FemNova is educational and does not diagnose or replace a healthcare professional.' },
  { topic: 'pregnancy', content: 'A missed period can have many causes. A home pregnancy test and a healthcare professional can help clarify pregnancy status. Contraception choices depend on health history and preferences; a clinician or pharmacist can help.' },
];

export function answerQuestion(input) {
  const question = readPrivateText(input);
  if (isUrgentQuestion(input)) return { answer: knowledge[4].content, sources: ['safety'] };
  const words = question.toLowerCase().split(/[^a-z0-9]+/).filter(word => word.length > 2);
  const ranked = knowledge.map(doc => ({ doc, score: words.reduce((score, word) => score + (doc.content.toLowerCase().includes(word) || doc.topic.includes(word) ? 1 : 0), 0) })).sort((a, b) => b.score - a.score);
  const source = ranked[0].score ? ranked[0].doc : knowledge[4];
  return { answer: `${source.content} ${source.topic === 'labs' ? 'Please compare with the range printed on your report and discuss any flagged result with your doctor.' : 'Your experience is personal, so use this as a starting point rather than a verdict.'}`, sources: [source.topic] };
}

export function createChatHandler({ gateway = privacy, answer = answerQuestion } = {}) {
  return async (req, res) => {
    const body = req.body;
    if (!body || Object.keys(body).length !== 1 || typeof body.question !== 'string' || !body.question.trim() || body.question.length > 4000) {
      return res.status(400).json({ code: 'INVALID_QUESTION', error: 'Enter a question of up to 4,000 characters.' });
    }
    try {
      const input = await gateway.text(body.question);
      const result = await answer(input);
      return res.json(result);
    } catch {
      return res.status(503).json({ code: 'PRIVACY_UNAVAILABLE', error: 'Privacy protection is unavailable. Nova could not process your message. Please try again later.' });
    }
  };
}
