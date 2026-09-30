// The recruiter's protocol, read by the app.
//
// The recruiter answers with one JSON object per turn: a round of questions, or the teammate's
// profile. What arrives is model output, so nothing here trusts its shape: every field is
// checked, clipped or replaced, and a reply that is not one of the two shapes is null — the
// screen then says the recruiter did not answer in a form it can draw, instead of drawing garbage.
import { AVATAR_IDS, avatarOf } from './faces.js';

export const NAME_MAX = 20;
export const TAGLINE_MAX = 60;
export const GREETING_MAX = 200;
export const OTHER = 'Something else';

const clip = (s, n) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
const slug = (s, i) => (String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || `q${i + 1}`);

/** The one JSON object in a reply — bare, fenced, or wrapped in a sentence the model added anyway. */
export function extractJson(text) {
  const t = String(text || '').trim();
  if (!t) return null;
  const tries = [t];
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) tries.push(fence[1].trim());
  const a = t.indexOf('{'), b = t.lastIndexOf('}');
  if (a >= 0 && b > a) tries.push(t.slice(a, b + 1));
  for (const s of tries) {
    try { const v = JSON.parse(s); if (v && typeof v === 'object' && !Array.isArray(v)) return v; } catch { /* next */ }
  }
  return null;
}

/** A teammate's name as the roster shows it: letters, digits, spaces; never empty. */
export function cleanName(s) {
  const n = clip(s, NAME_MAX).replace(/[^\p{L}\p{N} '-]/gu, '').trim();
  return n || 'Teammate';
}

/** The handle a teammate is mentioned by: the name without spaces, e.g. "Nova Lee" -> "NovaLee". */
export function handleOf(name) {
  return cleanName(name).replace(/[\s'-]+/g, '');
}

export function parseBuilderReply(text) {
  const v = extractJson(text);
  if (!v) return null;
  if (v.type === 'questions' && Array.isArray(v.questions)) {
    const questions = v.questions.slice(0, 5).map((q, i) => ({
      id: slug(q?.id, i),
      prompt: clip(q?.prompt, 160) || `Question ${i + 1}`,
      options: (Array.isArray(q?.options) ? q.options : []).map((o) => clip(o, 60)).filter(Boolean)
        .filter((o) => o.toLowerCase() !== OTHER.toLowerCase()).slice(0, 6),
      multiple: q?.multiple === true,
    })).filter((q) => q.options.length >= 2);
    if (!questions.length) return null;
    return { type: 'questions', intro: clip(v.intro, 200), questions };
  }
  if (v.type === 'teammate' && typeof v.system_prompt === 'string' && v.system_prompt.trim()) {
    const name = cleanName(v.name);
    return {
      type: 'teammate',
      name,
      tagline: clip(v.tagline, TAGLINE_MAX),
      avatar: avatarOf(typeof v.avatar === 'string' ? v.avatar.toLowerCase() : '', name),
      expertise: (Array.isArray(v.expertise) ? v.expertise : []).map((e) => clip(e, 24)).filter(Boolean).slice(0, 6),
      greeting: clip(v.greeting, GREETING_MAX),
      system_prompt: String(v.system_prompt).trim().slice(0, 6000),
    };
  }
  return null;
}

/** The answers as the recruiter reads them back: one line per question, keyed by its id. */
export function answersToText(questions, answers) {
  const lines = [];
  for (const q of questions) {
    const a = answers[q.id];
    if (!a) continue;
    const picked = (a.picked || []).filter(Boolean);
    const other = clip(a.other, 300);
    const parts = [...picked, ...(other ? [`(in their words) ${other}`] : [])];
    if (parts.length) lines.push(`- ${q.id}: ${parts.join('; ')}`);
  }
  return lines.length ? `Answers:\n${lines.join('\n')}` : 'Answers: (none; use your best judgement)';
}

/** What the teammate's Harness is told, in one piece: the recruiter's prompt, then who it is. */
export function composeSystemPrompt(profile) {
  const head = `You are ${profile.name}${profile.tagline ? `, ${profile.tagline.replace(/\.$/, '')}` : ''}, an AI teammate in this workplace.`;
  return `${head}\n\n${profile.system_prompt.trim()}`;
}

/** Every avatar the person can switch to at the reveal. */
export const AVATAR_CHOICES = AVATAR_IDS;
