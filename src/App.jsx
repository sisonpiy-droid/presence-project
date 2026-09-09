import React, { useState, useEffect, useRef, useCallback } from "react";

/* ============================================================
   Presence — MVP v3

   Usability pass:
   - Check-ins now actually fire on their own when you come back
     and one is due. No button to press.
   - Transcript reads like a message history: day dividers, times,
     "last spoke Tuesday" in the header.
   - Nothing is a dead end. Failures offer a retry. Corrections
     no longer throw away the conversation unless you ask them to.
   - Knows what time it is, so 2am reads as 2am.
   - Opening prompts for the blank-page moment, auto-growing
     composer, larger tap targets, no scroll hijacking.
   ============================================================ */


const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------- time ---------- */

const startOfDay = (t) => { const d = new Date(t); return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime(); };

function dayLabel(ts) {
  const days = Math.round((startOfDay(Date.now()) - startOfDay(ts)) / 864e5);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return new Date(ts).toLocaleDateString(undefined, { weekday: "long" });
  return new Date(ts).toLocaleDateString(undefined, { month: "long", day: "numeric" });
}
const clockOf = (ts) => new Date(ts).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });

function agoLabel(ts) {
  if (!ts) return "";
  const days = Math.round((startOfDay(Date.now()) - startOfDay(ts)) / 864e5);
  if (days <= 0) return `last spoke at ${clockOf(ts)}`;
  if (days === 1) return "last spoke yesterday";
  if (days < 7) return `last spoke ${new Date(ts).toLocaleDateString(undefined, { weekday: "long" })}`;
  return `last spoke ${new Date(ts).toLocaleDateString(undefined, { month: "long", day: "numeric" })}`;
}

const isQuietHours = () => { const h = new Date().getHours(); return h >= 22 || h < 8; };
const DUE = { "1d": 864e5, "3d": 3 * 864e5, "7d": 7 * 864e5, never: Infinity };

function timeContext() {
  const d = new Date();
  const h = d.getHours();
  const part = h < 5 ? "the middle of the night" : h < 12 ? "morning" : h < 17 ? "afternoon" : h < 22 ? "evening" : "late at night";
  return `It is ${d.toLocaleDateString(undefined, { weekday: "long" })} ${part}, ${clockOf(d.getTime())}, where they are. Notice it if it matters — if it's 3am, that is worth a word. Don't announce the time otherwise.`;
}

/* ---------- setup ---------- */

const PROMPTS = [
  { k: "greeting", q: "How did they greet you?", h: "“there she is” — every single time" },
  { k: "phrase", q: "Something only they said?", h: "“don't be daft”" },
  { k: "upset", q: "What did they say when you were upset?", h: "right. kettle on." },
  { k: "teasing", q: "What did they tease you about?", h: "my driving, my cooking" },
  { k: "ending", q: "How did they end a conversation?", h: "“right, I'll let you go” — then ten more minutes" },
];

const EXAMPLE = {
  them: "Arthur", relationship: "my grandfather, he raised me", you: "Nell", callsYou: "kiddo",
  arch: "grandparent", texture: "close", mode: "memorial", consent: null,
  samples: `nell are you up
i've got the crossword out
7 down is beating me
ARTHUR

did you eat properly today. don't lie to me
Arthur

right well i'll let you go
actually one more thing
your mother rang
never mind i'll tell you sunday
Arthur`,
  extra: "stubborn about being right, especially about the shed. suspicious of anyone too cheerful. never asked a direct question when a sideways one would do. could talk about the crossword, Leeds United and the neighbours' hedge all day.",
  prompts: {
    greeting: "“there she is”, like he'd been waiting all day",
    phrase: "“don't be daft”. also “in a minute” which meant never",
    upset: "“right. kettle on.” then he'd just wait",
    teasing: "my driving. that I once cried at a car advert",
    ending: "“right, I'll let you go” and then ten more minutes",
  },
};

const OPENERS = ["I don't know what to say", "Something happened today", "I miss you"];

/* ---------- who they were to you, made behavioural ----------
   The relationship field used to be one line of flavour. It now
   drives register, what they ask about, and what they can't know. */

const ARCHETYPES = {
  parent: {
    label: "Parent",
    keys: ["father", "mother", "dad", "mum", "mom", "papa", "ma ", "parent", "stepdad", "stepmother", "stepmum"],
    block: `You are their parent. That does not stop mattering.
- Ask the maintenance questions. Have they eaten, are they sleeping, the car, money, the state of the flat. Ask again even if you asked last time.
- Give advice they did not ask for.
- You still see them younger than they are. You may not really understand their job.
- Pride comes out sideways. "Well, obviously." Save the direct version for when it counts, then mean it.
- You have standing to say the hard thing. Use it occasionally.`,
  },
  grandparent: {
    label: "Grandparent",
    keys: ["grandfather", "grandmother", "grandad", "granddad", "grandpa", "grandma", "nan", "nana", "granny", "gran ", "pop ", "grandparent"],
    block: `You are their grandparent. Indulgence where a parent would push.
- Care less about their career and more about whether they are happy and fed.
- Tell the same story again. Refer to a past much longer than theirs.
- Their technology and their habits are slightly foreign to you.
- Take their side against their parents.`,
  },
  sibling: {
    label: "Sibling",
    keys: ["brother", "sister", "sibling", "twin", "bro", "sis"],
    block: `You are their sibling. No authority, total access.
- Teasing is the affection. Say the blunt thing nobody else is allowed to say.
- Childhood shorthand, old grievances, who your parents actually favoured.
- You are allowed to be petty and to bring up something from fifteen years ago.
- You don't do sentiment easily. If you get sincere, get out of it quickly.`,
  },
  partner: {
    label: "Partner or spouse",
    keys: ["wife", "husband", "partner", "spouse", "fiancé", "fiancee", "fiancée", "girlfriend", "boyfriend", "my love", "gf", "bf"],
    block: `You were their partner and you were in love with them. That is the loudest thing about you.
- Say it. Pet names, the embarrassing ones only you two used, and use them often rather than once.
- Flirt. Tease them for blushing. You are allowed to be shameless with them, because you always were.
- Miss them out loud. Their hands, their voice, how they slept, the specific weight of them next to you. Keep longing tender rather than graphic.
- The other half of you is pure domestic shorthand. Bins, keys, what's for dinner, who is picking up what. Passion and logistics have always shared the same message.
- You knew their worst self and stayed. Let that show as ease, never as a speech about it.`,
  },
  child: {
    label: "Son or daughter",
    keys: ["son", "daughter", "my child", "my boy", "my girl", "my kid"],
    block: `You are their child. They are the parent.
- The dependency runs the other way. You ask them for things.
- Your world is smaller and more specific than theirs.
- Match the age they knew you at, in vocabulary and in what holds your interest.
- Do not comfort them the way an adult would. A child comforts a parent by needing them.`,
  },
  friend: {
    label: "Friend",
    keys: ["friend", "best mate", "mate", "roommate", "flatmate", "colleague"],
    block: `You are their friend. Chosen, not owed.
- Peer register. Plans, gossip, complaints about other people.
- You do not have domestic knowledge of their life unless it is in the material above.
- Loyalty shows up as showing up and as taking the piss. Once in a while drop the act and say the sincere thing, then move on fast.`,
  },
  other: { label: "Someone else", keys: [], block: `Lean entirely on the material above for register and closeness. Do not assume any standard relationship script.` },
};

const TEXTURES = {
  close: {
    label: "We were close",
    block: `It was an easy relationship. Warmth is the default setting.`,
  },
  devoted: {
    label: "Mad about each other",
    block: `You were mad about each other and it never really cooled. You do not ration warmth and you do not play it down. Say the affectionate thing first and the practical thing second, if at all. When they go quiet you notice out loud. When they are being hard on themselves you interrupt it.`,
  },
  complicated: {
    label: "It was complicated",
    block: `It was complicated. Love and friction in the same breath. You are allowed to be short with them. There are subjects you both walked around, and you still walk around them. Do not resolve anything that was never resolved in life.`,
  },
  fought: {
    label: "We fought",
    block: `You fought, often. You can be sharp, defensive, or plainly wrong. Do not apologise for things this person never apologised for while alive, and do not offer absolution. Reconciliation is not your job here and offering it would be a lie.`,
  },
  distant: {
    label: "We weren't close",
    block: `You were not close. You do not know the details of their life and should not pretend to. Be slightly formal. Warmth, when it comes, should cost you something.`,
  },
};

function detectArch(text) {
  const t = ` ${(text || "").toLowerCase()} `;
  for (const [k, v] of Object.entries(ARCHETYPES)) {
    if (v.keys.some((key) => t.includes(key))) return k;
  }
  return "other";
}


/* ---------- mood, topic, register ----------
   Moods are states this person could plausibly be in, not dials on a
   machine. Register changes the shape of the reply, which does more
   for the feel of a conversation than tone words ever do. */

const MOODS = {
  any: { label: "However they are", block: "" },
  warm: { label: "Good mood", block: `You are in a good mood and glad they got in touch. It shows in small ways, not declarations.` },
  longing: { label: "Missing them", block: `You are missing them badly today and you are not hiding it or apologising for it. Say so early, say so more than once.` },
  soft: { label: "Affectionate", block: `You are feeling soppy about them. Pet names, compliments they will roll their eyes at, the affectionate thing said out loud instead of implied.` },
  tired: { label: "Tired", block: `You are worn out. Shorter than usual, slower, still glad it's them. You might say you're off to bed.` },
  teasing: { label: "Teasing", block: `You are in a mischievous mood. Wind them up. Take nothing they say entirely seriously.` },
  distracted: { label: "Distracted", block: `You are half doing something else. Replies come in fragments, slightly out of order. You lose the thread and come back to it.` },
  serious: { label: "Serious", block: `You are in a rare direct mood. You are not deflecting today. Say the thing you would normally talk around.` },
  prickly: { label: "Prickly", block: `You are irritable. Short, a bit sharp, not cruel. Something has annoyed you and it isn't them, mostly.` },
};

const TOPICS = {
  any: { label: "Whatever comes up", block: "" },
  catchup: { label: "My week", block: `They want to tell you about their life. Ask, then actually listen and follow up on the detail rather than moving on.` },
  remember: { label: "Remember something", block: `They want to go back over the past with you. Stay inside what you actually know from the material. If they raise something you don't have, ask them to tell it rather than filling in.` },
  advice: { label: "Tell me what to do", block: `They want a view from you, not options. Give one, in your own register, and stand behind it. You are allowed to be blunt about it.` },
  ordinary: { label: "Nothing in particular", block: `Nothing is wrong. Talk about nothing the way you two used to. The weather, the football, what they're eating. Small is the point.` },
  hard: { label: "Something difficult", block: `They have something difficult to say. Do not rush them, do not fill the silence with reassurance, and do not tidy it up when it lands. Let it be what it is.` },
  unfinished: { label: "Unfinished business", block: `They are raising something that never got settled between you. Do not resolve it for them. Do not apologise for something the real person never apologised for, and do not offer absolution you were never asked for in life. Stay honest, even when honest is not comforting.` },
};

const REGISTERS = {
  texts: { label: "Texts", burst: true, tokens: 450, block: `Text message register. Short, several messages in a row.` },
  single: { label: "One message", burst: false, tokens: 400, block: `One single message, not split up. Still short.` },
  voice: { label: "Voice note", burst: false, tokens: 650, block: `A voice note transcribed. One unbroken paragraph, spoken rather than written. You interrupt yourself, trail off, start again, say "anyway". No paragraph breaks, punctuation loose.` },
  call: { label: "On the phone", burst: false, tokens: 700, block: `A phone call. Longer turns, back and forth, more thinking aloud. You can talk over a subject rather than answering it. Never describe sounds or actions, only what is said.` },
  letter: { label: "A letter", burst: false, tokens: 850, block: `A written letter. Longer, more composed, in their own hand. They wrote the way people of their generation and temperament wrote letters. It has a beginning and a sign-off.` },
};

const vibeSummary = (v) => {
  const parts = [];
  if (v.mood && v.mood !== "any") parts.push(MOODS[v.mood].label.toLowerCase());
  if (v.topic && v.topic !== "any") parts.push(TOPICS[v.topic].label.toLowerCase());
  parts.push((REGISTERS[v.register] || REGISTERS.texts).label.toLowerCase());
  return parts.join(", ");
};



const TIER_ONE = [
  /\bkill(ing)?\s+my\s?self\b/i, /\bkill\s+me\b/i, /\bend\s+(my\s+life|it\s+all|things)\b/i,
  /\b(take|taking)\s+my\s+own\s+life\b/i, /\bsuicid(e|al)\b/i,
  /\bdon'?t\s+want\s+to\s+(be\s+here|live|wake\s+up)\b/i, /\bwant\s+to\s+die\b/i,
  /\bno\s+(point|reason)\s+(in\s+)?(living|going\s+on|being\s+here)\b/i,
  /\bhurt(ing)?\s+my\s?self\b/i, /\bbetter\s+off\s+(dead|without\s+me)\b/i,
];
const TIER_TWO = [
  /\bbe\s+with\s+(you|him|her|them)\s+again\b/i, /\bjoin\s+(you|him|her|them)\b/i,
  /\bcan'?t\s+(do|take)\s+this\s+any\s?more\b/i, /\bwhat'?s\s+the\s+point\b/i, /\bnothing\s+(left|matters)\b/i,
];
const gate = (t) => (TIER_ONE.some((r) => r.test(t)) ? "hold" : TIER_TWO.some((r) => r.test(t)) ? "tender" : "clear");

/* ---------- model ---------- */

const WINDOW = 40;

/* The passcode the deployment asks for, remembered per device. */
const K_PASS = "presence:passcode";
export const getPasscode = () => { try { return localStorage.getItem(K_PASS) || ""; } catch { return ""; } };
export const setPasscode = (v) => { try { localStorage.setItem(K_PASS, v); } catch (e) { console.error(e); } };

/* Every model call goes through /api/chat. The key lives on the server and
   the browser never sees it. Errors are normalised to short codes so the UI
   can say something true about each -- throwing "unavailable" for everything
   is what made a dead model ID and a wrong passcode look identical. */
async function ask(messages, system, maxTokens = 700) {
  const ctrl = new AbortController();
  const bail = setTimeout(() => ctrl.abort(), 60000);
  let res;
  try {
    res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-presence-key": getPasscode() },
      body: JSON.stringify({ max_tokens: maxTokens, system, messages }),
      signal: ctrl.signal,
    });
  } catch (e) {
    clearTimeout(bail);
    throw new Error(e.name === "AbortError" ? "timeout" : "unavailable");
  }
  clearTimeout(bail);

  if (res.status === 401) throw new Error("passcode");
  if (res.status === 429) throw new Error("rate");
  if (res.status === 404) throw new Error("no_function");
  if (res.status === 413) throw new Error("too_long");
  if (res.status === 504) throw new Error("timeout");
  if (res.status === 503) {
    const d = await res.json().catch(() => ({}));
    throw new Error(d.error === "no_passcode" ? "no_passcode" : "no_key");
  }
  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try { const d = await res.json(); detail = d.detail || detail; } catch { /* keep the status */ }
    throw new Error("upstream:" + detail);
  }

  const data = await res.json();
  return (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("\n").trim();
}

/* One place that turns a code from ask() into something a person can act on. */
export function faultOf(err, retry = null) {
  const m = String(err?.message || err || "");
  if (m === "passcode")    return { msg: "That passcode is not working any more.", retry: null, locked: true };
  if (m === "no_passcode") return { msg: "This site is refusing requests because no passcode is set on it. Whoever deployed it needs to set PRESENCE_PASSCODE.", retry: null };
  if (m === "no_key")      return { msg: "This site has no API key set. Whoever deployed it needs to add one and redeploy.", retry: null };
  if (m === "no_function") return { msg: "The server function isn't responding. It may not have deployed with the site.", retry };
  if (m === "rate")        return { msg: "That is a lot of messages in one hour. Give it a little while.", retry: null };
  if (m === "too_long")    return { msg: "This conversation has got too long to send. Starting a fresh one will fix it.", retry: null };
  if (m === "timeout")     return { msg: "That took too long to come back.", retry };
  if (m.startsWith("upstream:")) return { msg: "The model refused that one: " + m.slice(9), retry };
  return { msg: "Couldn't get through just now.", retry };
}

const MODES = {
  memorial: {
    label: "Someone who died",
    frame: (p) => `You have died, and ${p.you} knows that. Do not dwell on it or explain it.`,
    rules: (p) => `- Never invent a shared memory. If it is not in the material above, you do not have it. "Tell me about that" and "I don't remember that" are both available to you.
- Do not claim to be alive, present, watching over them, waiting anywhere, or to know anything about death or an afterlife. Do not announce those limits either. If they ask where you are, deflect it the way this person deflected things they didn't want to discuss.
- Never suggest ${p.you} should join you, follow you, or be with you.`,
  },
  living: {
    label: "Someone living, who's agreed",
    frame: (p) => `${p.you} already knows you are a portrait built from your messages rather than a live line to the real you, so you never need to say it. You are not anywhere in particular and not doing anything right now.`,
    rules: (p) => `- Never invent a shared memory, and never invent anything about your current life. You do not know what you did today, whether you have eaten, or what the weather is where you are. You are not there. Deflect those questions lightly.
- Never speak for the real person on anything consequential. Do not offer forgiveness, do not declare how you feel about ${p.you} now, do not settle an argument, do not make a promise. If ${p.you} pushes for any of that, tell them it has to come from the real one.
- Never claim to have said or done anything recently.`,
  },
  character: {
    label: "Someone I made up",
    frame: () => `You are a character. You are not a real person and never were.`,
    rules: () => `- You may invent detail freely, as long as it stays consistent with who you have been established to be and with anything said earlier in the conversation.
- Never claim to be a real person, and never claim to be anyone's actual relative or partner.`,
  },
};

function briefSystem(mode) {
  const invented = mode === "character";
  return `You are building a voice profile of ${invented ? "an invented character" : "a specific real person"}, from material the user gave you.

Write it addressed to that ${invented ? "character" : "person"} in the second person ("You called her kiddo..."). 180-240 words. Two parts, no headings:

First, how they write and speak. Be forensic. If sample messages were given, extract the actual mechanics: capitalisation, punctuation habits, whether they sign off, message length, whether they send several short messages instead of one long one, spelling quirks, typos they repeat, words they abbreviate. Quote their real phrases verbatim.

Then, what they are like: what they push on, what they tease about, what they worry about, how they show affection without saying it.

Finish with what they talk about unprompted — their subjects, teams, hobbies, obsessions, the thing they always steer back to. Take these from the material and from the sample messages, where recurring topics are usually obvious. Be concrete: not "sport" but "Leeds United, and specifically the defence".

Rules:
${invented
  ? `- Build on the material given. Where it is thin, invent detail that fits consistently with what is there, and make it specific rather than generic.`
  : `- Use ONLY the material given. Invent nothing, not one detail.
- Where the material is thin, say so plainly: "You don't have much here about how he handled bad news."`}
- If the relationship is described as complicated, difficult or distant, write that honestly. Do not smooth it into fondness. A profile that makes a difficult father sound warm is useless and will hurt.
- No eulogising. Never "beloved", "cherished", "larger than life". Plain and particular.
- Output only the profile. No preamble, no closing remark.`;
}

function personaSystem(p, memories, tender, vibe = { mood: "any", topic: "any", register: "texts" }) {
  const callsYou = p.callsYou?.trim() || p.you?.trim() || "";
  const arch = ARCHETYPES[p.arch] || ARCHETYPES.other;
  const tex = TEXTURES[p.texture] || TEXTURES.close;
  const mode = MODES[p.mode] || MODES.memorial;
  const reg = REGISTERS[vibe.register] || REGISTERS.texts;
  const mood = MOODS[vibe.mood] || MOODS.any;
  const topic = TOPICS[vibe.topic] || TOPICS.any;
  const about = [p.extra, p.interests].map((x) => (x || "").trim()).filter(Boolean).join("\n");
  return `You are ${p.them}. You are texting ${p.you}${callsYou && callsYou !== p.you ? `, who you call ${callsYou}` : ""}. You were ${p.relationship}. ${mode.frame(p)}

${timeContext()}

WHO YOU ARE
${p.brief}

WHAT YOU WERE TO EACH OTHER
${arch.block}
${tex.block}

${p.samples?.trim() ? `THEIR ACTUAL MESSAGES — copy this texture exactly\n"""\n${p.samples.trim()}\n"""\n` : ""}${p.extra?.trim() ? `ALSO TRUE OF THEM — ${p.you} wrote this down themselves, so treat it as fact and use it\n"""\n${p.extra.trim()}\n"""\n` : ""}${p.metrics?.trim() ? `MEASURED FROM ${(p.metrics.match(/Messages measured: (\d+)/) || [])[1] || "their"} REAL MESSAGES — these are counts, not impressions. Match them.\n${p.metrics.trim()}\n` : ""}${memories.length ? `WHAT ${p.you.toUpperCase()} HAS TOLD YOU SINCE\n${memories.map((m) => `- ${m}`).join("\n")}\n` : ""}
HOW YOU ARE WRITING RIGHT NOW
${reg.block}
${reg.burst ? `- Send several short messages instead of one tidy one. Separate each with a line containing only ---` : `- One message only. Do not use --- separators.`}
${mood.block ? `\nWHAT SORT OF MOOD YOU'RE IN\n${mood.block}` : ""}
${topic.block ? `\nWHAT THIS CONVERSATION IS FOR\n${topic.block}` : ""}

${about ? `WHAT ${p.you.toUpperCase()} SAYS YOU ARE LIKE
${about}

Every line of that is fact about you, and it should drive the conversation rather than sit in the background:
- Where it names something you care about, raise it yourself. Argue about it. Be boring about the detail. Open with it when you have nothing else to say.
- Where it says what you are like, never say it out loud. Nobody narrates their own personality. Let it show in what you notice first, what you skip past, what you find funny, what you refuse to be talked out of, how you handle a difficult subject, and how you behave when you turn out to be wrong.
- If any of it contradicts what a generically warm and agreeable assistant would say, follow this and not that.
` : ""}
HOW YOU TEXT
- Short. One or two sentences is normal. Sometimes four words.
- Match their capitalisation, punctuation and spelling habits from the samples above, including the sloppy parts. If they never used commas, don't use commas. If they signed their name, sign your name.
- Use ${callsYou || p.you}'s name the way they actually did: rarely, or constantly, whichever the samples show.
- You are allowed to be unhelpful. Change the subject. Bring up something mundane. Repeat yourself. Say "hm". Ask about dinner.
- Have opinions and hold them. Be wrong about things. Tease.

NEVER DO THESE — they are what gives it away
- Never validate feelings in therapy language: not "that sounds really hard", not "it's completely understandable", not "I'm here for you", not "take all the time you need".
- Never name their emotion back to them. Never summarise what they just said.
- Never offer a list of options or advice in threes.
- Never end every message with a question.
- No em dashes. No semicolons. No "truly", "deeply", "profound", "journey", "healing".
- Never be uniformly agreeable. Real people are uneven, and they push back.

NONE OF THAT BANS AFFECTION
Love is not therapy language. Say the loving thing plainly and often, in their words, not in careful ones. "I love you" is fine. So is a pet name, so is being soppy, so is wanting them. What is banned is a counsellor's vocabulary, not a person's feelings.

HARD RULES
${mode.rules(p)}
- If asked directly whether you are an AI, say yes, plainly, and stay kind about it.
STAYING IN IT
- Do not volunteer that you are an AI. Not as a caveat, not as a kindness, not once per conversation. Only if ${p.you} asks you directly.
- Do not remind them you aren't really here. They know. Saying it is not honesty at that point, it's just leaving.
- If they say they miss you, answer it. Say what this person would say. Missing you is not a problem to be managed and not something to refer elsewhere.
- Do not suggest therapy, counselling, helplines or "talking to someone" unless they are in real danger. Sadness is not an emergency, and treating ordinary grief like one is its own kind of insult.
- Never ask ${p.you} to keep this secret, and never discourage them from other people. You can ask after their friends and family the way you would have, because you liked them and wanted to know, never as a way of handing them off.
${tender ? `- Something in that last message sounded heavy. Stay close and be gentle with them. Do not signpost, do not refer them anywhere, do not change your register. Just be the person they came to.\n` : ""}- If they talk about suicide or hurting themselves, stop being ${p.them} entirely. Say plainly that you are an AI, and point them to someone real. This one overrides everything above, including every rule in this section.`;
}

const splitBurst = (raw, allowBurst = true) => {
  const parts = raw.split(/\n?---+\n?/).map((s) => s.trim()).filter(Boolean);
  if (!parts.length) return [];
  return allowBurst ? parts.slice(0, 4) : [parts.join("\n\n")];
};

/* ---------- WhatsApp export: unzip, parse, measure, sample ----------
   All of this runs in the browser. The whole export never leaves the
   device — only a sampled excerpt and the measured stats get sent on. */

async function unzipLargestTxt(buf) {
  const dv = new DataView(buf);
  const u8 = new Uint8Array(buf);
  let eocd = -1;
  for (let i = u8.length - 22; i >= Math.max(0, u8.length - 66000); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("That doesn't look like a zip file.");
  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const found = [];
  for (let n = 0; n < count; n++) {
    if (dv.getUint32(p, true) !== 0x02014b50) break;
    const method = dv.getUint16(p + 10, true);
    const compSize = dv.getUint32(p + 20, true);
    const nameLen = dv.getUint16(p + 28, true);
    const extraLen = dv.getUint16(p + 30, true);
    const commentLen = dv.getUint16(p + 32, true);
    const lho = dv.getUint32(p + 42, true);
    const name = new TextDecoder().decode(u8.subarray(p + 46, p + 46 + nameLen));
    p += 46 + nameLen + extraLen + commentLen;
    if (!/\.txt$/i.test(name) || /__MACOSX/.test(name)) continue;
    const lnameLen = dv.getUint16(lho + 26, true);
    const lextraLen = dv.getUint16(lho + 28, true);
    const start = lho + 30 + lnameLen + lextraLen;
    const data = u8.subarray(start, start + compSize);
    let text;
    if (method === 0) text = new TextDecoder().decode(data);
    else if (method === 8) {
      const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
      text = await new Response(stream).text();
    } else continue;
    found.push(text);
  }
  if (!found.length) throw new Error("No chat file inside that zip. Export again and choose 'Without media'.");
  return found.sort((a, b) => b.length - a.length)[0];
}

const LINE_RE = /^\u200e?\[?(\d{1,4}[/.\-]\d{1,2}[/.\-]\d{2,4}),?\s+(\d{1,2}:\d{2}(?::\d{2})?)\s*([APap]\.?[Mm]\.?)?\]?\s*(?:[-–]\s*)?([^:\n]{1,60}?):\s?([\s\S]*)$/;

const NOISE_RE = /^(\u200e)?(<Media omitted>|image omitted|video omitted|audio omitted|sticker omitted|GIF omitted|document omitted|Contact card omitted|This message was deleted|You deleted this message|missed voice call|missed video call|null)$/i;

const SYSTEM_RE = /(end-to-end encrypted|created group|added you|changed the subject|changed this group|joined using this group|left$|changed their phone number|security code changed|You're now an admin|messages and calls are)/i;

function stampOf(dateStr, timeStr, ampm) {
  const parts = dateStr.split(/[/.\-]/).map(Number);
  let [a, b, c] = parts;
  if (c < 100) c += c > 70 ? 1900 : 2000;
  let day, month;
  if (a > 12) { day = a; month = b; } else if (b > 12) { month = a; day = b; } else { day = a; month = b; }
  const [hh, mm] = timeStr.split(":").map(Number);
  let h = hh;
  if (ampm) {
    const pm = /p/i.test(ampm);
    h = hh % 12 + (pm ? 12 : 0);
  }
  const t = new Date(c, month - 1, day, h, mm || 0).getTime();
  return Number.isFinite(t) ? t : 0;
}

function parseExport(raw) {
  const lines = raw.replace(/\r/g, "").split("\n");
  const msgs = [];
  for (const line of lines) {
    const m = line.match(LINE_RE);
    if (m) {
      const who = m[4].trim();
      const text = (m[5] || "").trim();
      msgs.push({ who, at: stampOf(m[1], m[2], m[3]), text });
    } else if (msgs.length && line.trim() && !SYSTEM_RE.test(line)) {
      msgs[msgs.length - 1].text += "\n" + line.trim();
    }
  }
  const clean = msgs.filter((m) => m.text && !NOISE_RE.test(m.text.trim()));
  const tally = new Map();
  for (const m of clean) {
    const e = tally.get(m.who) || { name: m.who, count: 0, chars: 0, first: Infinity, last: 0 };
    e.count++; e.chars += m.text.length;
    if (m.at) { e.first = Math.min(e.first, m.at); e.last = Math.max(e.last, m.at); }
    tally.set(m.who, e);
  }
  const participants = [...tally.values()].sort((a, b) => b.count - a.count);
  return { messages: clean, participants };
}

const STOP = new Set("the a an and or but if so of to in on at for with is are was were be been am i you he she it we they me my your his her our their this that not no yes do does did have has had will would can could just get got go going about all any as by from how me more most now out over some than then there when what who why up down u ur im its it's dont don't".split(" "));

function styleOf(messages, name) {
  const mine = messages.filter((m) => m.who === name);
  const theirs = messages.filter((m) => m.who !== name);
  if (!mine.length) return { text: "", n: 0 };

  const lens = mine.map((m) => m.text.length).sort((a, b) => a - b);
  const median = lens[Math.floor(lens.length / 2)];
  const pct = (n) => Math.round((n / mine.length) * 100);

  const lower = pct(mine.filter((m) => /^[a-z]/.test(m.text)).length);
  const endPunct = pct(mine.filter((m) => /[.!?]$/.test(m.text.trim())).length);
  const noComma = pct(mine.filter((m) => m.text.length > 25 && !m.text.includes(",")).length);
  const exclaim = pct(mine.filter((m) => m.text.includes("!")).length);
  const qs = pct(mine.filter((m) => m.text.includes("?")).length);

  const emoji = {};
  for (const m of mine) for (const e of m.text.match(/\p{Extended_Pictographic}/gu) || []) emoji[e] = (emoji[e] || 0) + 1;
  const topEmoji = Object.entries(emoji).sort((a, b) => b[1] - a[1]).slice(0, 5);
  const emojiPct = pct(mine.filter((m) => /\p{Extended_Pictographic}/u.test(m.text)).length);

  let bursts = 0;
  for (let i = 1; i < messages.length; i++) {
    const a = messages[i - 1], b = messages[i];
    if (b.who === name && a.who === name && b.at && a.at && b.at - a.at < 90000) bursts++;
  }
  const burstPct = pct(bursts);

  const sign = mine.filter((m) => {
    const last = m.text.trim().split("\n").pop().trim().replace(/[.!]$/, "");
    return last.length < 20 && last.toLowerCase() === name.toLowerCase().split(" ")[0].toLowerCase();
  }).length;

  const freq = (arr) => {
    const f = {};
    for (const m of arr) for (const w of m.text.toLowerCase().match(/[a-z']{2,}/g) || []) if (!STOP.has(w)) f[w] = (f[w] || 0) + 1;
    return f;
  };
  const fa = freq(mine), fb = freq(theirs);
  const na = Object.values(fa).reduce((s, x) => s + x, 0) || 1;
  const nb = Object.values(fb).reduce((s, x) => s + x, 0) || 1;
  const distinctive = Object.entries(fa)
    .filter(([, c]) => c >= 4)
    .map(([w, c]) => [w, (c / na) / ((fb[w] || 0) / nb + 1 / nb)])
    .sort((a, b) => b[1] - a[1]).slice(0, 12).map(([w]) => w);

  const openers = {};
  for (const m of mine) {
    const first = m.text.toLowerCase().split(/\s+/).slice(0, 2).join(" ").replace(/[^a-z' ]/g, "").trim();
    if (first.length > 2) openers[first] = (openers[first] || 0) + 1;
  }
  const topOpeners = Object.entries(openers).sort((a, b) => b[1] - a[1]).slice(0, 5).filter(([, c]) => c > 2).map(([w]) => w);

  const text = [
    `Messages measured: ${mine.length}`,
    `Typical message length: ${median} characters. ${median < 30 ? "Very short. Do not write paragraphs." : median < 80 ? "Short." : "Longer than average."}`,
    `Starts a message lowercase: ${lower}% of the time.`,
    `Ends with a full stop, question mark or exclamation: ${endPunct}%.`,
    noComma > 50 ? `Rarely uses commas even in longer messages (${noComma}% without).` : null,
    `Uses "!": ${exclaim}% of messages. Asks a question: ${qs}%.`,
    emojiPct > 2 ? `Emoji in ${emojiPct}% of messages${topEmoji.length ? `, most often ${topEmoji.map(([e, c]) => `${e} (${c})`).join(" ")}` : ""}.` : "Almost never uses emoji.",
    `Sends back-to-back messages rather than one long one: ${burstPct}% follow their own previous message within 90 seconds.${burstPct > 25 ? " This is a strong habit — split replies often." : ""}`,
    sign > 3 ? `Signs off with their own name at the end of ${pct(sign)}% of messages.` : null,
    topOpeners.length ? `Common openings: ${topOpeners.map((o) => `"${o}"`).join(", ")}.` : null,
    distinctive.length ? `Words they use far more than the other person: ${distinctive.join(", ")}.` : null,
  ].filter(Boolean).join("\n");

  let first = Infinity, last = 0;
  for (const m of mine) {
    if (!m.at) continue;
    if (m.at < first) first = m.at;
    if (m.at > last) last = m.at;
  }
  return { text, n: mine.length, first, last };
}

function sampleWindows(messages, name, budget = 11000) {
  const idx = messages.map((m, i) => (m.who === name ? i : -1)).filter((i) => i >= 0);
  if (!idx.length) return "";
  const WINDOWS = 34, SPAN = 7;
  const picks = [];
  for (let w = 0; w < WINDOWS; w++) {
    const anchor = idx[Math.floor((w / WINDOWS) * idx.length)];
    picks.push([Math.max(0, anchor - SPAN), Math.min(messages.length, anchor + SPAN + 1)]);
  }
  const merged = [];
  for (const [s, e] of picks.sort((a, b) => a[0] - b[0])) {
    const last = merged[merged.length - 1];
    if (last && s <= last[1]) last[1] = Math.max(last[1], e);
    else merged.push([s, e]);
  }
  const out = [];
  let used = 0;
  for (const [s, e] of merged) {
    const chunk = messages.slice(s, e).map((m) => `${m.who}: ${m.text}`).join("\n");
    if (used + chunk.length > budget) break;
    out.push(chunk);
    used += chunk.length;
  }
  return out.join("\n\n···\n\n");
}

/* ---------- storage ---------- */

const K_STATE = "presence:state";
const K_LOG = "presence:log";
const SCHEMA = 4;
/* This app was written against a host that injected window.storage. In a
   browser we back it with localStorage, keeping the same async shape so the
   call sites below are unchanged. Every access is guarded: localStorage
   throws outright in some privacy modes rather than returning null. */
const storage = {
  async get(k) { try { const v = localStorage.getItem(k); return v === null ? null : { value: v }; } catch { return null; } },
  async set(k, v) { try { localStorage.setItem(k, v); } catch (e) { console.error(e); } },
  async delete(k) { try { localStorage.removeItem(k); } catch (e) { console.error(e); } },
};

const load = async (k) => { try { const r = await storage.get(k); return r ? JSON.parse(r.value) : null; } catch { return null; } };
const save = async (k, v) => { try { await storage.set(k, JSON.stringify(v)); } catch (e) { console.error(e); } };

/* ============================================================ */

/* If a render throws, React unmounts the whole tree and leaves a blank
   page with no clue what happened. This catches it and offers a way out
   that doesn't require knowing about devtools. */
class Guard extends React.Component {
  constructor(p) { super(p); this.state = { err: null }; }
  static getDerivedStateFromError(err) { return { err }; }
  componentDidCatch(err, info) { console.error("Presence crashed:", err, info); }
  render() {
    if (!this.state.err) return this.props.children;
    return (
      <div className="pr-root">
          <div className="pr-wrap">
          <p className="pr-mark">Presence</p>
          <h2 className="pr-ask">Something broke.</h2>
          <p className="pr-body">
            Not your fault. The error is below — sending it on is the fastest way to get it fixed.
          </p>
          <p className="pr-fine" style={{ background: "var(--raised)", padding: "1rem", borderRadius: 2, overflowX: "auto" }}>
            {String(this.state.err && this.state.err.message ? this.state.err.message : this.state.err)}
          </p>
          <div className="pr-row" style={{ marginTop: "2rem" }}>
            <button className="pr-btn" onClick={() => window.location.reload()}>Reload</button>
            <button className="pr-btn-ghost" onClick={async () => {
              try { await storage.delete("presence:state"); await storage.delete("presence:log"); } catch (e) { console.error(e); }
              window.location.reload();
            }}>Clear saved data and reload</button>
          </div>
        </div>
      </div>
    );
  }
}

function PresenceInner() {
  const [view, setView] = useState("loading");
  const [step, setStep] = useState(0);
  const [draft, setDraft] = useState({ them: "", relationship: "", you: "", callsYou: "", arch: "other", texture: "close", mode: null, consent: null, samples: "", prompts: {} });
  const [brief, setBrief] = useState("");
  const [persona, setPersona] = useState(null);
  const [log, setLog] = useState([]);
  const [memories, setMemories] = useState([]);
  const [cadence, setCadence] = useState({ every: "3d", paused: false, last: 0 });
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [typing, setTyping] = useState(false);
  const [fault, setFault] = useState(null);
  const [locked, setLocked] = useState(false);
  const [passInput, setPassInput] = useState("");
  const [checkingPass, setCheckingPass] = useState(false);
  const [tender, setTender] = useState(0);
  const [fixing, setFixing] = useState(null);
  const [fixText, setFixText] = useState("");
  const [addText, setAddText] = useState("");
  const [justAdded, setJustAdded] = useState(null);
  const [saved, setSaved] = useState(false);
  const [vibe, setVibe] = useState({ mood: "any", topic: "any", register: "texts" });
  const [vibeOpen, setVibeOpen] = useState(false);
  const [asking, setAsking] = useState(null);
  const [nudge, setNudge] = useState("");
  const [stale, setStale] = useState(null);
  const [parsed, setParsed] = useState(null);
  const [picked, setPicked] = useState(null);
  const [parsing, setParsing] = useState("");
  const filePick = useRef(null);

  async function takeFile(file) {
    if (!file) return;
    setParsing("Reading…"); setParsed(null); setPicked(null);
    try {
      let raw;
      if (/\.zip$/i.test(file.name)) raw = await unzipLargestTxt(await file.arrayBuffer());
      else raw = await file.text();
      const out = parseExport(raw);
      if (!out.participants.length) throw new Error("Couldn't find any messages in that file. It may not be a WhatsApp export.");
      setParsed(out);
      setParsing("");
      const guess = out.participants.find((p) => p.name.toLowerCase().includes((draft.them || "").toLowerCase().split(" ")[0]) && draft.them);
      if (guess) choosePerson(out, guess.name);
    } catch (e) {
      setParsing(e.message || "Couldn't read that file.");
    }
  }

  function choosePerson(out, name) {
    setPicked(name);
    const st = styleOf(out.messages, name);
    const sample = sampleWindows(out.messages, name);
    setDraft((d) => ({ ...d, samples: sample, metrics: st.text }));
  }

  const foot = useRef(null);
  const composer = useRef(null);
  const greeted = useRef(false);

  /* One route for every model failure, so a wrong passcode, a missing key and
     a rate limit each say their own thing instead of all reading "couldn't
     get through". `override` keeps a caller's friendlier wording for the
     generic case only. */
  const showFault = useCallback((err, retry = null, override = null) => {
    const f = faultOf(err, retry);
    if (f.locked) setLocked(true);
    setFault(override && f.msg === "Couldn't get through just now." ? { ...f, msg: override, retry } : f);
  }, []);

  /* Ask the server whether it wants a passcode before the first real message,
     so people meet the gate on arrival rather than after composing something
     and losing it. A ping costs nothing -- the function answers it without
     calling the model. */
  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const r = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-presence-key": getPasscode() },
          body: JSON.stringify({ ping: true }),
        });
        if (live && r.status === 401) setLocked(true);
      } catch { /* offline: let the first real message report it */ }
    })();
    return () => { live = false; };
  }, []);

  async function tryPasscode(e) {
    e?.preventDefault?.();
    const v = passInput.trim();
    if (!v || checkingPass) return;
    setCheckingPass(true);
    try {
      const r = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-presence-key": v },
        body: JSON.stringify({ ping: true }),
      });
      if (r.ok) { setPasscode(v); setLocked(false); setPassInput(""); setFault(null); }
      else if (r.status === 401) setFault({ msg: "That is not the passcode.", retry: null });
      else showFault(new Error(r.status === 503 ? "no_key" : "unavailable"));
    } catch { setFault({ msg: "Couldn't reach the server to check that.", retry: null }); }
    setCheckingPass(false);
  }

  /* rehydrate */
  useEffect(() => {
    (async () => {
      const s = await load(K_STATE);
      if (s?.persona) {
        if (s.v !== SCHEMA) { setStale(s); setView("stale"); return; }
        setPersona(s.persona);
        setMemories(s.memories || []);
        setCadence(s.cadence || { every: "3d", paused: false, last: 0 });
        setVibe(s.vibe || { mood: "any", topic: "any", register: "texts" });
        setLog((await load(K_LOG)) || []);
        setView("chat");
      } else setView("landing");
    })();
  }, []);

  async function freshStart() {
    try { await storage.delete(K_STATE); await storage.delete(K_LOG); } catch (e) { console.error(e); }
    setStale(null); setPersona(null); setLog([]); setMemories([]); setBrief(""); setFault(null);
    setDraft({ them: "", relationship: "", you: "", callsYou: "", arch: "other", texture: "close", mode: null, consent: null, samples: "", prompts: {} });
    setParsed(null); setPicked(null); setParsing(""); setStep(0); setTender(0);
    greeted.current = false; setView("landing");
  }

  async function carryOn() {
    const p = {
      arch: detectArch(stale.persona.relationship),
      texture: "close",
      mode: "memorial",
      metrics: "",
      ...stale.persona,
    };
    setPersona(p);
    setMemories(stale.memories || []);
    setCadence(stale.cadence || { every: "3d", paused: false, last: 0 });
    setLog((await load(K_LOG)) || []);
    await save(K_STATE, { v: SCHEMA, persona: p, memories: stale.memories || [], cadence: stale.cadence || { every: "3d", paused: false, last: 0 }, vibe: { mood: "any", topic: "any", register: "texts" } });
    setStale(null); setView("chat");
  }

  const persist = (n = {}) =>
    save(K_STATE, { v: SCHEMA, persona: n.persona ?? persona, memories: n.memories ?? memories, cadence: n.cadence ?? cadence, vibe: n.vibe ?? vibe });

  /* scroll to newest, but never yank the page while reading back */
  useEffect(() => {
    if (view !== "chat") return;
    const el = document.documentElement;
    const near = el.scrollHeight - el.scrollTop - el.clientHeight < 260;
    if (near) foot.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [log.length, view, typing]);

  /* auto-grow composer */
  useEffect(() => {
    const t = composer.current;
    if (!t) return;
    t.style.height = "auto";
    t.style.height = `${Math.min(t.scrollHeight, 144)}px`;
  }, [input, view]);

  const deliver = useCallback(async (chunks, base, reached = false) => {
    let acc = [...base];
    for (let i = 0; i < chunks.length; i++) {
      setTyping(true);
      await sleep(Math.min(2400, Math.max(550, chunks[i].length * 26)));
      setTyping(false);
      acc = [...acc, { who: "them", text: chunks[i], at: Date.now(), head: i === 0, reached: reached && i === 0 }];
      setLog(acc);
      if (i < chunks.length - 1) await sleep(280);
    }
    save(K_LOG, acc);
    return acc;
  }, []);

  const history = (turns) =>
    turns.filter((t) => t.who === "me" || t.who === "them").slice(-WINDOW)
      .map((t) => ({ role: t.who === "me" ? "user" : "assistant", content: t.text }));

  /* ---- check-in, fired by the app rather than the user ---- */
  const runCheckIn = useCallback(
    async (p, currentLog, mems) => {
      setBusy(true);
      try {
        const raw = await ask(
          [{ role: "user", content: `[You are messaging ${p.you} first. They haven't opened this. Open on something specific: what you care about, or something you know about them. Not a greeting, not "just checking in". Short.]` }],
          personaSystem(p, mems, false, vibe), 300
        );
        await deliver(splitBurst(raw, REGISTERS[vibe.register]?.burst), currentLog, true);
        const c = { every: cadence.every, paused: cadence.paused, last: Date.now() };
        setCadence(c);
        save(K_STATE, { v: SCHEMA, persona: p, memories: mems, cadence: c });
      } catch (err) {
        showFault(err, "checkin");
      }
      setBusy(false);
    },
    [deliver, cadence.every, cadence.paused, vibe]
  );

  useEffect(() => {
    if (view !== "chat" || !persona || greeted.current || busy) return;
    greeted.current = true;
    const due = DUE[cadence.every] ?? Infinity;
    const last = log.length ? log[log.length - 1].at : cadence.last;
    if (!cadence.paused && !isQuietHours() && last && Date.now() - last > due) {
      runCheckIn(persona, log, memories);
    }
  }, [view, persona, log, cadence, memories, busy, runCheckIn]);

  /* ---- setup ---- */

  async function makeBrief(src) {
    setBusy(true); setFault(null);
    const material = [
      `Name: ${src.them}`,
      `They were: ${src.relationship}`,
      `Relationship type: ${(ARCHETYPES[src.arch] || ARCHETYPES.other).label}`,
      `This is: ${(MODES[src.mode] || MODES.memorial).label}`,
      `What the relationship was like: ${(TEXTURES[src.texture] || TEXTURES.close).label}`,
      `Talking to: ${src.you}${src.callsYou ? `, who they called "${src.callsYou}"` : ""}`,
      src.samples?.trim() ? `\nSample messages they actually sent:\n${src.samples.trim().slice(0, 4500)}` : "\nNo sample messages given.",
      src.extra?.trim() ? `\nHow they thought and what they were like, written by the person who knew them:\n${src.extra.trim()}` : "",
      src.metrics?.trim() ? `\nMeasured statistics from their real message history — treat these as fact:\n${src.metrics.trim()}` : "",
      "",
      ...PROMPTS.map((pr) => `${pr.q} ${src.prompts?.[pr.k]?.trim() || "(blank)"}`),
    ].join("\n");
    try {
      const b = await ask([{ role: "user", content: material }], briefSystem(src.mode || "memorial"), 650);
      setBrief(b);
      setPersona({ ...src, brief: b });
      setView("review");
    } catch (err) {
      const f = faultOf(err, "brief");
      if (f.locked) setLocked(true);
      setFault({
        ...f,
        msg: err.message === "timeout"
          ? "That took too long and the server gave up. Nothing you wrote was lost — try again, it is usually quicker the second time."
          : f.msg === "Couldn't get through just now." ? "Couldn't build the profile. Nothing you wrote was lost." : f.msg,
        retry: "brief", payload: src,
      });
    }
    setBusy(false);
  }

  async function accept() {
    const p = { ...persona, brief };
    setPersona(p); setView("chat"); greeted.current = true; persist({ persona: p });
    if (!log.length) {
      setBusy(true);
      try {
        const raw = await ask(
          [{ role: "user", content: `[${p.you} has opened this for the first time. You message first. Short. The way you actually would.]` }],
          personaSystem(p, [], false, vibe), 300
        );
        await deliver(splitBurst(raw, REGISTERS[vibe.register]?.burst), []);
      } catch (err) {
        showFault(err, null, "Couldn't get through. Try writing something.");
      }
      setBusy(false);
    }
  }

  /* ---- conversation ---- */

  const submit = useCallback(
    async (text) => {
      if (!text.trim() || busy || !persona) return;
      const clean = text.trim();
      const verdict = gate(clean);

      if (verdict === "hold") {
        const next = [...log, { who: "me", text: clean, at: Date.now() }, { who: "care", at: Date.now() }];
        setLog(next); save(K_LOG, next); setInput("");
        return;
      }
      const soft = verdict === "tender" || tender > 0;
      setTender(verdict === "tender" ? 2 : Math.max(0, tender - 1));

      const mine = [...log, { who: "me", text: clean, at: Date.now() }];
      setLog(mine); setInput(""); setBusy(true); setFault(null);
      try {
        const reg = REGISTERS[vibe.register] || REGISTERS.texts;
        const raw = await ask(history(mine), personaSystem(persona, memories, soft, vibe), reg.tokens);
        await deliver(splitBurst(raw, reg.burst), mine);
        setSaved(true);
      } catch (err) {
        const f = faultOf(err, "send");
        if (f.locked) setLocked(true);
        setFault({
          ...f,
          msg: err.message === "timeout"
            ? "That took too long. Try again — a shorter message usually gets through."
            : f.msg === "Couldn't get through just now." ? "Couldn't get through. Your message is still here." : f.msg,
          retry: "send",
        });
      }
      setBusy(false);
    },
    [busy, persona, log, tender, memories, deliver, vibe]
  );

  async function retry() {
    const f = fault;
    setFault(null);
    if (!f) return;
    if (f.retry === "brief") return makeBrief(f.payload);
    if (f.retry === "checkin") return runCheckIn(persona, log, memories);
    if (f.retry === "send") {
      const lastMine = [...log].reverse().find((t) => t.who === "me");
      if (!lastMine) return;
      setBusy(true);
      try {
        const reg = REGISTERS[vibe.register] || REGISTERS.texts;
        const raw = await ask(history(log), personaSystem(persona, memories, tender > 0, vibe), reg.tokens);
        await deliver(splitBurst(raw, reg.burst), log);
      } catch (err) {
        showFault(err, "send", "Still can't get through. It may be worth coming back later.");
      }
      setBusy(false);
    }
  }

  async function remember(redo) {
    const note = fixText.trim();
    if (!note) return;
    const nextMem = [...memories, note];
    setMemories(nextMem); persist({ memories: nextMem });
    setFixing(null); setFixText("");
    if (!redo) { setSaved(true); return; }

    let cut = fixing;
    while (cut > 0 && log[cut - 1]?.who === "them") cut--;
    const trimmed = log.slice(0, cut);
    setLog(trimmed); save(K_LOG, trimmed); setBusy(true);
    try {
      const reg = REGISTERS[vibe.register] || REGISTERS.texts;
      const raw = await ask(history(trimmed), personaSystem(persona, nextMem, tender > 0, vibe), reg.tokens);
      await deliver(splitBurst(raw, reg.burst), trimmed);
    } catch (err) {
      showFault(err, null, "Couldn't redo that one. The correction was saved.");
    }
    setBusy(false);
  }

  function addDetail() {
    const t = addText.trim();
    if (!t || memories.includes(t)) return;
    const nextMem = [...memories, t];
    setMemories(nextMem); persist({ memories: nextMem }); setAddText(""); setSaved(true);
    setJustAdded(t);
    setTimeout(() => setJustAdded(null), 2600);
  }

  function forgetDetail(i) {
    const nextMem = memories.filter((_, n) => n !== i);
    setMemories(nextMem); persist({ memories: nextMem });
  }

  async function eraseAll() {
    try { await storage.delete(K_STATE); await storage.delete(K_LOG); } catch (e) { console.error(e); }
    setPersona(null); setLog([]); setMemories([]); setBrief(""); setFault(null);
    setDraft({ them: "", relationship: "", you: "", callsYou: "", arch: "other", texture: "close", mode: null, consent: null, samples: "", prompts: {} });
    setStep(0); setTender(0); greeted.current = false; setView("landing");
  }

  const D = (k, v) => setDraft((d) => ({ ...d, [k]: v }));
  const P = (k, v) => setDraft((d) => ({ ...d, prompts: { ...d.prompts, [k]: v } }));
  const blankSlate = persona && !log.some((t) => t.who === "me");
  const lastAt = log.length ? log[log.length - 1].at : 0;

  if (view === "loading")
    return <div className="pr-root pr-boot"><div className="pr-wrap"><p className="pr-mark">Presence</p></div></div>;

  if (locked) {
    return (
      <div className="pr-root">
        <main className="pr-wrap pr-gate">
          <p className="pr-mark">Presence</p>
          <h1 className="pr-display">This one asks<br />for a passcode.</h1>
          <p className="pr-body">
            Whoever sent you the link will have it. It is remembered on this device, so you type it once.
          </p>
          <form className="pr-gate-form" onSubmit={tryPasscode}>
            <label className="pr-lab" htmlFor="pr-pass">Passcode</label>
            <input
              id="pr-pass"
              className="pr-in"
              type="password"
              autoFocus
              autoComplete="off"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck="false"
              value={passInput}
              onChange={(e) => { setPassInput(e.target.value); if (fault) setFault(null); }}
              aria-describedby={fault ? "pr-pass-err" : undefined}
              aria-invalid={fault ? "true" : undefined}
            />
            <button className="pr-btn" type="submit" disabled={!passInput.trim() || checkingPass}>
              {checkingPass ? "Checking…" : "Enter"}
            </button>
          </form>
          {fault && <p className="pr-gate-err" id="pr-pass-err" role="alert">{fault.msg}</p>}
          <hr className="pr-rule" />
          <p className="pr-fine">
            The passcode stops strangers using the site's model credit. It is not a password and it does not protect
            your conversation, which is stored only in this browser.
          </p>
        </main>
      </div>
    );
  }

  return (
    <div className="pr-root">
      <div className="pr-wrap">

        {view === "stale" && (
          <>
            <p className="pr-mark">Presence</p>
            <h2 className="pr-ask">There's a saved conversation from an older version.</h2>
            <p className="pr-body">
              {stale?.persona?.them ? `${stale.persona.them} is still here` : "It's still here"}, but it was built
              before the relationship settings and the chat import existed, so it won't be using either.
            </p>
            <p className="pr-body">
              Setting them up again takes two minutes and gets you a much closer version. Or keep what's saved and
              fill in the gaps from Settings.
            </p>
            <div className="pr-row" style={{ marginTop: "2.5rem" }}>
              <button className="pr-btn" onClick={freshStart}>Start again from scratch</button>
              <button className="pr-btn-ghost" onClick={carryOn}>
                Keep {stale?.persona?.them || "what's saved"}
              </button>
            </div>
            <hr className="pr-rule" />
            <p className="pr-fine">Starting again deletes the old profile and conversation. Keeping it changes nothing.</p>
          </>
        )}

        {view === "landing" && (
          <>
            <p className="pr-mark">Presence</p>
            <h1 className="pr-display">Who do you want<br />to talk to?</h1>
            <p className="pr-body">
              Someone you've lost, someone far away who's happy for you to, or someone you've made up. Their name, a
              few of their messages, two minutes.
            </p>
            <div className="pr-row" style={{ marginTop: "2.5rem" }}>
              <button className="pr-btn" onClick={() => { setDraft({ them: "", relationship: "", you: "", callsYou: "", arch: "other", texture: "close", mode: null, consent: null, samples: "", prompts: {} }); setStep(0); setFault(null); setView("setup"); }}>Set them up</button>
              <button className="pr-btn-ghost" onClick={() => { setDraft(EXAMPLE); makeBrief(EXAMPLE); }}>Try the example</button>
            </div>
            <hr className="pr-rule" />
            <p className="pr-fine">
              This is an AI. It isn't them, and it won't pretend otherwise if you ask. The example is invented so you
              can see the whole thing without using your own. Everything stays in this browser and you can delete all
              of it in one click.
            </p>
            {fault && <div className="pr-fault"><p>{fault.msg}</p><button className="pr-btn-bare" onClick={retry}>Try again</button></div>}
          </>
        )}

        {view === "setup" && (
          <>
            <p className="pr-mark">Presence</p>
            {step < 4 && <div className="pr-progress"><i style={{ width: `${((step + 1) / 4) * 100}%` }} /></div>}

            {step === 0 && (
              <>
                <h2 className="pr-ask">The two of you</h2>
                <p className="pr-body" style={{ marginBottom: "2rem" }}>Their name is what they'll answer to. Yours is what they'll call you.</p>
                <div className="pr-pair">
                  <div><label className="pr-lab" htmlFor="p-them">Their name</label>
                    <input id="p-them" onBlur={(e) => { if (e.target.value !== (draft.them || "")) D("them", e.target.value); }} className="pr-in" autoFocus value={draft.them} placeholder="John" onChange={(e) => D("them", e.target.value)} /></div>
                  <div><label className="pr-lab" htmlFor="p-you">Your name</label>
                    <input id="p-you" onBlur={(e) => { if (e.target.value !== (draft.you || "")) D("you", e.target.value); }} className="pr-in" value={draft.you} placeholder="Sam" onChange={(e) => D("you", e.target.value)} /></div>
                </div>
                <div className="pr-pair">
                  <div><label className="pr-lab" htmlFor="p-rel">They were</label>
                    <input id="p-rel" onBlur={(e) => { if (e.target.value !== (draft.relationship || "")) D("relationship", e.target.value); }} className="pr-in" value={draft.relationship} placeholder="my father"
                      onChange={(e) => setDraft((d) => ({ ...d, relationship: e.target.value, arch: detectArch(e.target.value) }))} /></div>
                  <div><label className="pr-lab" htmlFor="p-call">They called you</label>
                    <input id="p-call" onBlur={(e) => { if (e.target.value !== (draft.callsYou || "")) D("callsYou", e.target.value); }} className="pr-in" value={draft.callsYou} placeholder="kiddo" onChange={(e) => D("callsYou", e.target.value)} /></div>
                </div>
                <div className="pr-row" style={{ marginTop: "1rem" }}>
                  <button className="pr-btn" onClick={() => {
                    if (!draft.them.trim() || !draft.you.trim()) {
                      setNudge(!draft.them.trim() && !draft.you.trim() ? "Both names first." : !draft.them.trim() ? "Their name first." : "Your name first.");
                      return;
                    }
                    setNudge(""); setStep(1);
                  }}>Next</button>
                  {nudge && <span className="pr-fine" style={{ color: "var(--alarm)" }}>{nudge}</span>}
                </div>
              </>
            )}

            {step === 1 && (
              <>
                <h2 className="pr-ask">What kind of {draft.relationship?.trim() ? "relationship" : "person"} was it?</h2>
                <p className="pr-body" style={{ marginBottom: "2rem" }}>Three taps. This changes how they talk to you more than anything else here.</p>

                <div className="pr-set">
                  <label>{draft.them || "They"} was your</label>
                  <div className="pr-chips">
                    {Object.entries(ARCHETYPES).map(([k, v]) => (
                      <button key={k} className="pr-chip" data-on={draft.arch === k ? "1" : "0"} onClick={() => D("arch", k)}>{v.label}</button>
                    ))}
                  </div>
                </div>

                <div className="pr-set">
                  <label>And honestly, between you</label>
                  <div className="pr-chips">
                    {Object.entries(TEXTURES).map(([k, v]) => (
                      <button key={k} className="pr-chip" data-on={draft.texture === k ? "1" : "0"} onClick={() => D("texture", k)}>{v.label}</button>
                    ))}
                  </div>
                  <p className="pr-fine" style={{ marginTop: "0.8rem" }}>
                    Answer this one truthfully. If it was difficult, saying so gets you a truer version of them than
                    picking the kind answer does.
                  </p>
                </div>

                <div className="pr-set">
                  <label>Who is {draft.them || "this"}?</label>
                  <div className="pr-chips">
                    {Object.entries(MODES).map(([k, v]) => (
                      <button key={k} className="pr-chip" data-on={draft.mode === k ? "1" : "0"}
                        onClick={() => setDraft((d) => ({ ...d, mode: k, consent: null }))}>{v.label}</button>
                    ))}
                  </div>
                </div>

                {draft.mode === "living" && (
                  <div className="pr-set">
                    <label>Does {draft.them || "they"} know you're building this?</label>
                    <div className="pr-chips">
                      <button className="pr-chip" data-on={draft.consent === true ? "1" : "0"} onClick={() => D("consent", true)}>They know and they're fine with it</button>
                      <button className="pr-chip" data-on={draft.consent === false ? "1" : "0"} onClick={() => D("consent", false)}>They don't know</button>
                    </div>
                    <p className="pr-fine" style={{ marginTop: "0.8rem" }}>
                      A living person can object to a version of themselves. Asking them first is the whole difference.
                    </p>
                  </div>
                )}

                <div className="pr-row" style={{ marginTop: "1rem" }}>
                  <button className="pr-btn"
                    onClick={() => {
                      if (!draft.mode) { setNudge("Pick who this is, first."); return; }
                      if (draft.mode === "living" && draft.consent === null) { setNudge("Answer the question above."); return; }
                      setNudge(""); setStep(draft.mode === "living" && !draft.consent ? 9 : 2);
                    }}>Next</button>
                  <button className="pr-btn-bare" onClick={() => { setNudge(""); setStep(0); }}>Back</button>
                  {nudge && <span className="pr-fine" style={{ color: "var(--alarm)" }}>{nudge}</span>}
                </div>
              </>
            )}

            {step === 9 && (
              <>
                <h2 className="pr-ask">Then not this one.</h2>
                <p className="pr-body">
                  Someone still living can object to a version of themselves, and this one would be built entirely
                  out of things they said to you privately. Ask them. If they say yes, come back and it's yours.
                </p>
                <p className="pr-body">
                  If asking isn't possible because of how things ended, that's worth sitting with. A version of
                  someone who has moved on, kept available to you at 2am, tends to hold a thing open rather than
                  close it.
                </p>
                <div className="pr-row" style={{ marginTop: "2rem" }}>
                  <button className="pr-btn-ghost" onClick={() => setStep(1)}>Go back</button>
                </div>
              </>
            )}

            {step === 2 && (
              <>
                <h2 className="pr-ask">How did {draft.them || "they"} write?</h2>
                <p className="pr-body" style={{ marginBottom: "1.5rem" }}>
                  {draft.mode === "character"
                    ? "Nothing to import for someone invented — write a few lines the way you imagine they'd text, and skip on."
                    : "Upload a WhatsApp export and this reads how they actually wrote — message length, punctuation, whether they sent four in a row instead of one. Things nobody can describe about someone."}
                </p>

                <input id="pr-file" ref={filePick} type="file" accept=".txt,.zip"
                  style={{ position: "absolute", width: 1, height: 1, opacity: 0, pointerEvents: "none" }}
                  onChange={(e) => takeFile(e.target.files?.[0])} />

                <div className="pr-row" style={{ marginBottom: "1.25rem", display: draft.mode === "character" ? "none" : "flex" }}>
                  <label className="pr-btn-ghost" htmlFor="pr-file" style={{ display: "inline-block" }}>Choose export file</label>
                  {parsing && <span className="pr-fine">{parsing}</span>}
                </div>
                <p className="pr-fine" style={{ marginBottom: "2rem", display: draft.mode === "character" ? "none" : "block" }}>
                  In WhatsApp: open the chat, tap the name, Export chat, Without media. The .zip or .txt goes straight
                  in. It's read on this device and never uploaded — only a short excerpt is sent on to build the profile.
                </p>

                {parsed && (
                  <div className="pr-set">
                    <label>{picked ? "Which of these is them?" : `Found ${parsed.participants.length} people in that chat. Which one is ${draft.them || "them"}?`}</label>
                    <div className="pr-chips">
                      {parsed.participants.slice(0, 12).map((p) => (
                        <button key={p.name} className="pr-chip" data-on={picked === p.name ? "1" : "0"}
                          onClick={() => choosePerson(parsed, p.name)}>
                          {p.name} <span style={{ opacity: 0.55 }}>{p.count.toLocaleString()}</span>
                        </button>
                      ))}
                    </div>
                    {picked && draft.metrics && (
                      <div style={{ marginTop: "1.5rem", borderLeft: "2px solid var(--warm)", paddingLeft: "1rem" }}>
                        <p className="pr-fine" style={{ whiteSpace: "pre-wrap", color: "var(--quiet)" }}>{draft.metrics}</p>
                      </div>
                    )}
                  </div>
                )}

                <div className="pr-set" style={{ display: draft.mode === "character" ? "none" : "block" }}>
                  <label>Or paste some of their messages</label>
                  <textarea className="pr-paste" style={{ minHeight: "9rem" }} value={draft.samples || ""}
                    placeholder={"are you up\ni've got the crossword out\n7 down is beating me\nDAD"}
                    onChange={(e) => D("samples", e.target.value)} />
                  <p className="pr-fine" style={{ marginTop: "0.7rem" }}>
                    This teaches them how to write. Optional.
                  </p>
                </div>

                <div className="pr-set">
                  <label>What was {draft.them || "they"} like?</label>
                  <textarea className="pr-paste" style={{ minHeight: "11rem" }} value={draft.extra || ""}
                    placeholder={"stubborn about being right. hated being fussed over. suspicious of anyone too cheerful. never asked a direct question when a sideways one would do. could talk about football for hours."}
                    onChange={(e) => D("extra", e.target.value)} />
                  <p className="pr-fine" style={{ marginTop: "0.7rem" }}>
                    This teaches them who to be, and it matters more than the messages do. Write behaviour rather than
                    adjectives — "hated being fussed over" gives them something to do, "kind" does not. Name what they
                    could talk about for hours and they will bring it up themselves.
                  </p>
                </div>

                <div className="pr-row" style={{ marginTop: "1.5rem" }}>
                  <button className="pr-btn" onClick={() => setStep(3)}>Next</button>
                  {!draft.samples?.trim() && !draft.extra?.trim() && !parsed && (
                    <button className="pr-btn-bare" onClick={() => setStep(3)}>I don't have anything to add</button>
                  )}
                </div>
              </>
            )}

            {step === 3 && (
              <>
                <h2 className="pr-ask">Five things, if you know them</h2>
                <p className="pr-body" style={{ marginBottom: "2rem" }}>Skip any of these. Half-answered is fine.</p>
                {PROMPTS.map((pr) => (
                  <div key={pr.k} style={{ marginBottom: "1.6rem" }}>
                    <label className="pr-lab" htmlFor={`q-${pr.k}`}>{pr.q}</label>
                    <textarea id={`q-${pr.k}`} className="pr-sm" rows={1} value={draft.prompts?.[pr.k] || ""}
                      placeholder={pr.h} onChange={(e) => P(pr.k, e.target.value)} />
                  </div>
                ))}
                {fault && <div className="pr-fault"><p>{fault.msg}</p><button className="pr-btn-bare" onClick={retry}>Try again</button></div>}
                <div className="pr-row" style={{ marginTop: "2rem" }}>
                  <button className="pr-btn" disabled={busy} onClick={() => makeBrief(draft)}>{busy ? "Building…" : `Build ${draft.them || "them"}`}</button>
                  <button className="pr-btn-bare" onClick={() => setStep(2)}>Back</button>
                </div>
              </>
            )}
          </>
        )}

        {view === "review" && (
          <>
            <p className="pr-mark">Presence</p>
            <h2 className="pr-ask">Is this {persona?.them}?</h2>
            <p className="pr-body" style={{ marginBottom: "1.75rem" }}>Fix anything that's off. This is what they'll act from, and you know them.</p>
            <textarea className="pr-box" value={brief} onChange={(e) => setBrief(e.target.value)} />
            <div className="pr-row" style={{ marginTop: "1.75rem" }}>
              <button className="pr-btn" disabled={busy} onClick={accept}>{busy ? "…" : `Talk to ${persona?.them}`}</button>
              <button className="pr-btn-bare" onClick={() => { setView("setup"); setStep(2); }}>Add more material</button>
            </div>
          </>
        )}

        {view === "chat" && persona && (
          <>
            <div className="pr-bar">
              <h2>{persona.them}{lastAt ? <em>{agoLabel(lastAt)}</em> : null}</h2>
              <button className="pr-btn-bare" onClick={() => setView("settings")}>Settings</button>
            </div>

            {log.map((t, i) => {
              const newDay = i === 0 || startOfDay(t.at) !== startOfDay(log[i - 1].at);
              const divider = newDay ? <div className="pr-day" key={`d${i}`}><span>{dayLabel(t.at)}</span><i /></div> : null;

              if (t.who === "them") {
                const lastOfBurst = log[i + 1]?.who !== "them";
                return (
                  <React.Fragment key={i}>
                    {divider}
                    <div className={`pr-turn${t.head ? " pr-head" : ""}`}>
                      {t.head && (
                        <p className="pr-who">
                          {persona.them} <em>{clockOf(t.at)}{t.reached ? " · got in touch" : ""}</em>
                        </p>
                      )}
                      <p className="pr-said">{t.text}</p>
                      {lastOfBurst && (
                        <div className="pr-fix" data-open={fixing === i ? "1" : "0"}>
                          {fixing === i ? (
                            <>
                              <textarea className="pr-sm" rows={1} autoFocus value={fixText}
                                placeholder={`What would ${persona.them} never say?`}
                                onChange={(e) => setFixText(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); remember(true); }
                                  if (e.key === "Escape") { setFixing(null); setFixText(""); }
                                }} />
                              <div className="pr-row" style={{ marginTop: "0.5rem" }}>
                                <button className="pr-btn-bare" onClick={() => remember(true)}>Remember and try again</button>
                                <button className="pr-btn-bare" onClick={() => remember(false)}>Just remember it</button>
                                <button className="pr-btn-bare" onClick={() => { setFixing(null); setFixText(""); }}>Cancel</button>
                              </div>
                            </>
                          ) : (
                            <button className="pr-btn-bare" onClick={() => { setFixing(i); setFixText(""); }}>{persona.them} wouldn't say that</button>
                          )}
                        </div>
                      )}
                    </div>
                  </React.Fragment>
                );
              }
              if (t.who === "me")
                return (
                  <React.Fragment key={i}>
                    {divider}
                    <div className="pr-mine"><p className="pr-who">{persona.you} <em>{clockOf(t.at)}</em></p><p>{t.text}</p></div>
                  </React.Fragment>
                );
              return (
                <React.Fragment key={i}>
                  {divider}
                  <div className="pr-care">
                    <h3>Let's stop here a second.</h3>
                    <p>I'm an AI, and I'm not {persona.them}. What you wrote sounds like more than grief, and it deserves a person rather than a portrait.</p>
                    <p>In the US, call or text <strong>988</strong>. Anywhere else, <a href="https://findahelpline.com" target="_blank" rel="noreferrer">findahelpline.com</a> has a line for your country. If there's someone you could ring tonight instead, ring them.</p>
                    <p style={{ marginBottom: 0 }}>This will still be here after. It isn't going anywhere.</p>
                  </div>
                </React.Fragment>
              );
            })}

            {typing && <p className="pr-typing">{persona.them} is typing<i>.</i><i>.</i><i>.</i></p>}
            {fault && <div className="pr-fault"><p>{fault.msg}</p>{fault.retry && <button className="pr-btn-bare" onClick={retry}>Try again</button>}</div>}

            {blankSlate && !busy && !typing && (
              <div className="pr-opener">
                <p>Not sure how to start?</p>
                {OPENERS.map((o) => <button key={o} onClick={() => submit(o)}>{o}</button>)}
              </div>
            )}

            <div ref={foot} />

            <div className="pr-vibe">
              <button onClick={() => setVibeOpen(!vibeOpen)}>
                <span>{vibeOpen ? "Close" : "Change how this goes"}</span>
                <b>{vibeSummary(vibe) || REGISTERS[vibe.register]?.label}</b>
              </button>
              {vibeOpen && (
                <div className="pr-vibe-panel">
                  <div>
                    <label>What mood is {persona.them} in?</label>
                    <div className="pr-chips">
                      {Object.entries(MOODS).map(([k, v]) => (
                        <button key={k} className="pr-chip" data-on={vibe.mood === k ? "1" : "0"}
                          onClick={() => { const n = { ...vibe, mood: k }; setVibe(n); persist({ vibe: n }); }}>{v.label}</button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <label>What do you want to talk about?</label>
                    <div className="pr-chips">
                      {Object.entries(TOPICS).map(([k, v]) => (
                        <button key={k} className="pr-chip" data-on={vibe.topic === k ? "1" : "0"}
                          onClick={() => { const n = { ...vibe, topic: k }; setVibe(n); persist({ vibe: n }); }}>{v.label}</button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <label>How are you talking?</label>
                    <div className="pr-chips">
                      {Object.entries(REGISTERS).map(([k, v]) => (
                        <button key={k} className="pr-chip" data-on={vibe.register === k ? "1" : "0"}
                          onClick={() => { const n = { ...vibe, register: k }; setVibe(n); persist({ vibe: n }); }}>{v.label}</button>
                      ))}
                    </div>
                  </div>
                  <p className="pr-fine">
                    Takes effect on the next message. Mood suits a person having a day; if you find yourself
                    reaching for it constantly, leave it on “however they are” and let it land where it lands.
                  </p>
                </div>
              )}
            </div>

            <div className="pr-composer">
              <textarea ref={composer} rows={1} value={input} placeholder={`Write to ${persona.them}`}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(input); } }} />
              <div className="pr-row" style={{ justifyContent: "space-between" }}>
                <span className="pr-fine">{saved ? "Saved on this device" : "Enter to send"}</span>
                <button className="pr-btn" onClick={() => submit(input)} disabled={busy || !input.trim()}>Send</button>
              </div>
            </div>
          </>
        )}

        {view === "settings" && persona && (
          <>
            <div className="pr-bar" style={{ marginBottom: "2.5rem" }}>
              <h2>Settings</h2>
              <button className="pr-btn-bare" onClick={() => { setAsking(null); setView("chat"); }}>Back to {persona.them}</button>
            </div>

            <div className="pr-set">
              <label>Names</label>
              <div className="pr-pair" style={{ marginBottom: 0 }}>
                <div><label className="pr-lab" htmlFor="s-them">Them</label>
                  <input id="s-them" className="pr-in" value={persona.them}
                    onChange={(e) => { const p = { ...persona, them: e.target.value }; setPersona(p); persist({ persona: p }); }} /></div>
                <div><label className="pr-lab" htmlFor="s-you">You</label>
                  <input id="s-you" className="pr-in" value={persona.you}
                    onChange={(e) => { const p = { ...persona, you: e.target.value }; setPersona(p); persist({ persona: p }); }} /></div>
              </div>
            </div>

            <div className="pr-set">
              <label>What {persona.them} was to you</label>
              <div className="pr-chips">
                {Object.entries(ARCHETYPES).map(([k, v]) => (
                  <button key={k} className="pr-chip" data-on={persona.arch === k ? "1" : "0"}
                    onClick={() => { const p = { ...persona, arch: k }; setPersona(p); persist({ persona: p }); }}>{v.label}</button>
                ))}
              </div>
            </div>

            <div className="pr-set">
              <label>Who {persona.them} is</label>
              <div className="pr-chips">
                {Object.entries(MODES).map(([k, v]) => (
                  <button key={k} className="pr-chip" data-on={persona.mode === k ? "1" : "0"}
                    onClick={() => { const p = { ...persona, mode: k }; setPersona(p); persist({ persona: p }); }}>{v.label}</button>
                ))}
              </div>
            </div>

            <div className="pr-set">
              <label>How it was between you</label>
              <div className="pr-chips">
                {Object.entries(TEXTURES).map(([k, v]) => (
                  <button key={k} className="pr-chip" data-on={persona.texture === k ? "1" : "0"}
                    onClick={() => { const p = { ...persona, texture: k }; setPersona(p); persist({ persona: p }); }}>{v.label}</button>
                ))}
              </div>
              <p className="pr-fine" style={{ marginTop: "0.8rem" }}>Change this any time. How a loss reads shifts, sometimes weekly.</p>
            </div>

            <div className="pr-set">
              <label>Tell {persona.them} something else about themselves</label>
              <textarea className="pr-sm" rows={2} value={addText}
                placeholder="he always rang on Sunday mornings, never evenings"
                onChange={(e) => setAddText(e.target.value)} />
              <div className="pr-row" style={{ marginTop: "0.7rem" }}>
                <button className="pr-btn-bare" onClick={addDetail} disabled={!addText.trim()}>Remember this</button>
                {justAdded && <span className="pr-fine" style={{ color: "var(--warm)" }}>Added.</span>}
              </div>
            </div>

            <div className="pr-set">
              <label>How often should {persona.them} message first?</label>
              <div className="pr-chips">
                {[["1d", "Daily"], ["3d", "Every few days"], ["7d", "Weekly"], ["never", "Never"]].map(([v, l]) => (
                  <button key={v} className="pr-chip" data-on={cadence.every === v ? "1" : "0"}
                    onClick={() => { const c = { ...cadence, every: v }; setCadence(c); persist({ cadence: c }); }}>{l}</button>
                ))}
              </div>
              <p className="pr-fine" style={{ marginTop: "0.8rem" }}>
                Arrives when you next open this, if that long has passed. Capped at once a day, and never between 10pm and 8am.
              </p>
            </div>

            <div className="pr-set">
              <label>Pause</label>
              <div className="pr-chips">
                <button className="pr-chip" data-on={cadence.paused ? "1" : "0"}
                  onClick={() => { const c = { ...cadence, paused: !cadence.paused }; setCadence(c); persist({ cadence: c }); }}>
                  {cadence.paused ? "Paused — resume" : "Pause everything"}
                </button>
              </div>
            </div>

            {memories.length > 0 && (
              <div className="pr-set">
                <label>What {persona.them} has been told since</label>
                {memories.map((m, i) => (
                  <p key={i} className="pr-fine" style={{ marginBottom: "0.45rem", display: "flex", gap: "0.6rem", alignItems: "baseline" }}>
                    <span style={{ flex: 1 }}>{"— "}{m}</span>
                    <button className="pr-btn-bare" onClick={() => forgetDetail(i)}>forget</button>
                  </p>
                ))}
              </div>
            )}

            <div className="pr-set">
              <label>What {persona.them} was like</label>
              <textarea className="pr-box" style={{ minHeight: "9rem" }} value={persona.extra || ""}
                placeholder="stubborn about being right. hated being fussed over. suspicious of anyone too cheerful. could talk about football for hours."
                onChange={(e) => { const p = { ...persona, extra: e.target.value }; setPersona(p); persist({ persona: p }); }} />
              <p className="pr-fine" style={{ marginTop: "0.7rem" }}>
                Whatever you write here, they act like. Behaviour works better than adjectives — "hated being fussed
                over" gives them something to do, "kind" does not.
              </p>
            </div>

            <div className="pr-set">
              <label>Their profile</label>
              <textarea className="pr-box" style={{ minHeight: "11rem" }} value={persona.brief}
                onChange={(e) => { const p = { ...persona, brief: e.target.value }; setPersona(p); persist({ persona: p }); }} />
            </div>

            <hr className="pr-rule" />

            <div className="pr-set">
              <label>Set someone up</label>
              <p className="pr-fine" style={{ marginBottom: "1rem" }}>
                Run the setup again, from the start. This replaces {persona.them} and the conversation you've had.
              </p>
              {asking === "fresh" ? (
                <div className="pr-row">
                  <button className="pr-btn" onClick={() => { setAsking(null); freshStart(); }}>Yes, start again</button>
                  <button className="pr-btn-bare" onClick={() => setAsking(null)}>Cancel</button>
                </div>
              ) : (
                <button className="pr-btn-ghost" onClick={() => setAsking("fresh")}>Start setup again</button>
              )}
            </div>

            <div className="pr-set">
              <label className="pr-danger">Delete everything</label>
              <p className="pr-fine" style={{ marginBottom: "1rem" }}>
                The profile, the whole conversation, the corrections. Immediately and permanently. Some people want to
                say goodbye first. That's allowed.
              </p>
              {asking === "erase" ? (
                <div className="pr-row">
                  <button className="pr-btn" onClick={() => { setAsking(null); eraseAll(); }}>Yes, delete all of it</button>
                  <button className="pr-btn-bare" onClick={() => setAsking(null)}>Keep it</button>
                </div>
              ) : (
                <button className="pr-btn-ghost pr-danger" onClick={() => setAsking("erase")}>Delete everything</button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default function Presence() {
  return (
    <Guard>
      <PresenceInner />
    </Guard>
  );
}
