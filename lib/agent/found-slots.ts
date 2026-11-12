/**
 * ─────────────────────────────────────────────────────────────────────────────
 *  lib/agent/found-slots.ts — slot filling for found-item reports
 * ─────────────────────────────────────────────────────────────────────────────
 *  Why this exists: the router used to pass a fixed public string and drop
 *  everything the customer actually said. "کیف چرم مشکی با کارت دانشجویی،
 *  مترو تجریش" became the record «کیف» — no private marks, no place — so
 *  ownership could never be verified and every report looked identical.
 *
 *  A found report is only useful if two things survive:
 *    • descriptionPrivate — the marks only the true owner could know. This is
 *      what lets a human (or `matchFoundItem`) confirm ownership later. It is
 *      never shown on the public page.
 *    • area — where it was found, so a person nearby can be told.
 *
 *  Deliberately deterministic and extractive: it copies the customer's own
 *  words rather than composing new ones, so nothing is invented and nothing
 *  needs a model round-trip. When it cannot tell, it says so instead of
 *  guessing.
 */

export type FoundItemKind =
  | 'کیف'
  | 'کوله'
  | 'چمدان'
  | 'گوشی موبایل'
  | 'لپ‌تاپ'
  | 'تبلت'
  | 'کارت ملی'
  | 'کارت بانکی'
  | 'گذرنامه'
  | 'گواهینامه'
  | 'کلید'
  | 'عینک'
  | 'ساعت'
  | 'جواهر'
  | 'اسناد';

/**
 * Item kinds, ordered so the most specific pattern wins. «کارت ملی» must be
 * tested before «کارت» and «گوشی موبایل» before a bare «گوشی» phrase, or a
 * national ID gets registered as a phone.
 */
const ITEM_RULES: ReadonlyArray<{ kind: FoundItemKind; re: RegExp }> = [
  { kind: 'کارت ملی', re: /کارت\s*ملی|کارت\s*شناسایی|شناسنامه/ },
  { kind: 'گواهینامه', re: /گواهینامه|کارت\s*سواری/ },
  { kind: 'گذرنامه', re: /گذرنامه|پاسپورت/ },
  { kind: 'کارت بانکی', re: /کارت\s*بانکی|کارت\s*عابربانک|کارت\s*ATM|کارت\s*اعتباری/ },
  { kind: 'لپ‌تاپ', re: /لپ\s*تاپ|لپتاپ|مک\s*بوک|لنوو|ایسوس/ },
  { kind: 'تبلت', re: /تبلت|آی\s*پد|ipad/i },
  { kind: 'گوشی موبایل', re: /گوشی|موبایل|آی\s*فون|iphone|سامسونگ|شیائومی/i },
  { kind: 'کوله', re: /کوله|بک\s*پک|کوله\s*پشتی/ },
  { kind: 'چمدان', re: /چمدان|ساک\s*سفر/ },
  { kind: 'کیف', re: /کیف|دست\s*کیف/ },
  { kind: 'کلید', re: /کلید|سوئیچ/ },
  { kind: 'عینک', re: /عینک/ },
  { kind: 'ساعت', re: /ساعت\s*مچی|ساعت\s*هوشمند|اپل\s*واچ/ },
  { kind: 'جواهر', re: /طلا|جواهر|انگشتر|گردنبند|گوشواره/ },
  { kind: 'اسناد', re: /سند|مدرک|مدارک|قرارداد|دفترچه/ },
];

/** Places people actually lose things. Longest-match first. */
const PLACE_RULES: ReadonlyArray<{ place: string; re: RegExp }> = [
  { place: 'مترو', re: /مترو|ایستگاه\s*مترو|واگن/ },
  { place: 'اتوبوس', re: /اتوبوس|بی\s*آر\s*تی|BRT/i },
  { place: 'تاکسی', re: /تاکسی|اسنپ|تپسی|سفر/ },
  { place: 'فرودگاه', re: /فرودگاه|ترمینال\s*هوایی/ },
  { place: 'پارک', re: /پارک(?!ینگ)|بوستان/ },
  { place: 'پارکینگ', re: /پارکینگ/ },
  { place: 'دانشگاه', re: /دانشگاه|دانشکده|کلاس/ },
  { place: 'مدرسه', re: /مدرسه|دبیرستان/ },
  { place: 'بیمارستان', re: /بیمارستان|درمانگاه|مطب/ },
  { place: 'مرکز خرید', re: /مرکز\s*خرید|پاساژ|فروشگاه|سوپرمارکت/ },
  { place: 'رستوران', re: /رستوران|کافه|قهوه\s*خانه/ },
  { place: 'ورزشگاه', re: /ورزشگاه|باشگاه|استخر/ },
  { place: 'هتل', re: /هتل|اقامتگاه/ },
  { place: 'بانک', re: /بانک|شعبه/ },
  { place: 'خیابان', re: /خیابان|کوچه|پیاده\s*رو/ },
];

/**
 * Districts and landmarks are reported separately from the coarse place type:
 * «مترو تجریش» is far more actionable than «مترو».
 */
const LANDMARK_RULES: ReadonlyArray<RegExp> = [
  /(?:مترو|ایستگاه|پارک|بازار|میدان|ترمینال|پاساژ|بیمارستان|دانشگاه|خیابان|بلوار)\s+(?:[آ-ی]{3,}(?:\s+[آ-ی]{3,})?)/,
];

/**
 * Colour, material and content words. These are exactly the things an owner
 * can confirm and a stranger cannot guess, so they are the private marks.
 */
/**
 * NOTE: JavaScript's `\b` is defined against ASCII word characters, so it does
 * NOT match at the edge of Persian text — `/\bمشکی\b/` silently fails on
 * «کیف مشکی». Boundaries here are expressed with `(?:^|\s)` / `(?=\s|$)`.
 */
// `\u0640` is the ZWNJ stand-in produced by normalise(), so a colour written
// «قهوه‌ای» still matches after normalisation.
// Boundary classes as compiled regexes: no template-string escaping, and the
// ZWNJ stand-in (\u0640) counts as a boundary so «قهوه‌ای» still matches.
const SEP = '[\\s\u0640,.:;،!؟]';
const B = '(?:^|' + SEP + ')';
const E = '(?=' + SEP + '|$)';

// Patterns are built from word lists and then normalised the same way the
// input is, so a ZWNJ inside a word («قهوه‌ای») cannot break the match.
const join = (words: string[]) => words.join('|');

const COLOURS = ['مشکی','سفید','قرمز','آبی','سبز','زرد','قهوه‌ای','خاکستری','نقره‌ای','طلایی','صورتی','بنفش','نارنجی','کرم','بژ'];
const MATERIALS = ['چرم','چرمی','پارچه','برزنتی','پلاستیکی','فلزی','چوبی','مخمل','کتان'];
const CONTENTS = ['کارت دانشجویی','کارت بیمه','دفترچه','خودکار','شارژر','پاوربانک','هدفون','دستمال','کیف پول','سوئیچ','آویز','جاکلیدی'];
const WEAR = ['خراش','لکه','پاره','شکستگی','شکسته','برچسب','نشان','قفل','زیپ','بند','دسته'];

const asPattern = (words: string[]) => `${B}(?:${join(words.map(normalise))})${E}`;

const MARK_PATTERNS: ReadonlyArray<RegExp> = [
  new RegExp(asPattern(COLOURS), 'g'),
  new RegExp(asPattern(MATERIALS), 'g'),
  new RegExp(asPattern(CONTENTS), 'g'),
  new RegExp(asPattern(WEAR), 'g'),
];

function normalise(text: string): string {
  return text
    .replace(/\u064A/g, 'ی')
    .replace(/\u0643/g, 'ک')
    // ZWNJ joins parts of one word («قهوه‌ای»), so it becomes a hyphen-ish
    // join rather than a space: turning it into a space split colours in two
    // and made them unmatchable.
    .replace(/\u200c/g, '\u0640')
    .replace(/[\u200f\u200e]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** `قهوه‌ای` (with ZWNJ) and `قهوهـای` normalise to the same thing. */
const plain = (value: string) => value.replace(/\u0640/g, '\u200c');

/** The item kind, or null when the text truly does not say. */
export function extractItemType(raw: string): FoundItemKind | null {
  const text = normalise(raw);
  for (const rule of ITEM_RULES) {
    if (rule.re.test(text)) return rule.kind;
  }
  return null;
}

/**
 * Where it was found. Prefers the specific landmark («مترو تجریش») over the
 * coarse type («مترو») because the landmark is what a person can actually act
 * on; falls back to the type, then to null.
 */
export function extractArea(raw: string): string | null {
  const text = normalise(raw);
  const landmark = LANDMARK_RULES.map((re) => re.exec(text)?.[0]).find(Boolean)?.trim();
  if (landmark) return landmark;
  for (const rule of PLACE_RULES) {
    if (rule.re.test(text)) return rule.place;
  }
  return null;
}

/**
 * The identifying marks, extracted from the customer's own words.
 *
 * Returns a short comma-joined list (deduplicated, order preserved). `null`
 * when nothing identifying was said — which is itself information: the UI asks
 * a follow-up instead of pretending the record is complete.
 */
export function extractPrivateMarks(raw: string, itemType?: string | null): string | null {
  const text = normalise(raw);
  const found: string[] = [];
  for (const re of MARK_PATTERNS) {
    for (const match of text.matchAll(new RegExp(re.source, 'g'))) {
      const value = plain(match[0].trim());
      // The item type is already recorded; repeating it proves nothing about
      // ownership, so it is not a mark.
      if (!value || found.includes(value) || value === itemType) continue;
      found.push(value);
    }
  }
  if (!found.length) return null;
  return found.slice(0, 6).join('، ');
}

/**
 * Public description: safe for the open web. It must not leak a colour, a mark
 * or anything else that would let a stranger claim the item, so it only states
 * the kind and the coarse place.
 */
export function buildPublicDescription(itemType: string, area: string | null): string {
  const where = area ? ` در ${area}` : '';
  return (
    `${itemType}${where} پیدا شد و به دفتر آنی‌یاب تحویل داده شد. ` +
    'برای دریافت، کد رهگیری را ارائه دهید و مشخصات شیء را بگویید تا مالکیت تأیید شود.'
  );
}

export interface FoundSlots {
  itemType: FoundItemKind | null;
  area: string | null;
  descriptionPrivate: string | null;
  descriptionPublic: string;
  /** False when we could not name the item — the UI should ask. */
  complete: boolean;
}

/** One pass over the utterance; no network, no model. */
export function extractFoundSlots(raw: string): FoundSlots {
  const itemType = extractItemType(raw);
  const area = extractArea(raw);
  const descriptionPrivate = extractPrivateMarks(raw, itemType);
  const resolved = itemType ?? 'شیء پیدا‌شده';
  return {
    itemType,
    area,
    descriptionPrivate,
    descriptionPublic: buildPublicDescription(resolved, area),
    complete: Boolean(itemType),
  };
}
