import AsyncStorage from "@react-native-async-storage/async-storage";
import type { ReactElement } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Animated,
  AppState,
  Easing,
  Modal,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  useColorScheme,
  useWindowDimensions,
  Vibration,
  View,
} from "react-native";

// ---------- Settings ----------

// Goals shown on the top bar. The last number is the end of a round.
const MILESTONES = [100, 313, 1000];
const MAX = MILESTONES[MILESTONES.length - 1];

// Coins given for every goal reached (once per round).
const REWARD_PER_GOAL = 100;

// Daily quests: say `target` salavat in one day to get `reward` coins.
// They reset every day at midnight and count ALL salavat of the day.
const QUESTS = [
  { id: "d100", target: 100, reward: 50 },
  { id: "d313", target: 313, reward: 100 },
  { id: "d1000", target: 1000, reward: 250 },
];

// Diamonds given every time a new daily record is broken.
const DIAMOND_PER_RECORD = 1;

// Diamonds given for every achievement (can be claimed only once each).
const ACH_REWARD = 1;

// A day counts as a "goal day" when you say at least this many salavat in it.
const ACH_DAILY_GOAL = 100;

// Price of every common and rare shop item (coins).
const ITEM_PRICE = 500;

// Price of every heavenly item (coins).
const HEAVENLY_PRICE = 1500;

// Price of every legendary item (diamonds).
const DIAMOND_PRICE = 3;

// How long the full bar stays visible before the new round starts (ms).
const ROUND_END_DELAY = 1500;

// How many days of history are kept for the weekly chart.
const HISTORY_DAYS = 60;

// The rank is based on the salavat of the last RANK_WINDOW_HOURS hours.
const RANK_WINDOW_HOURS = 24;

const STORAGE_KEY = "salavat-state";

const GOLD = "#f2b01e";
const DIAMOND = "#38b6ff";

// Colors of the "buy" buttons in the shop
const COIN_BUY = { bg: GOLD, text: "#4a3300" };
const DIAMOND_BUY = { bg: "#8fdcff", text: "#06364d" };

// ---------- Lucky wheel ----------

// Coins you pay for every spin.
const WHEEL_COST = 300;

// How long the wheel spins (ms).
const WHEEL_DURATION = 5200;

// Every slice of the wheel. You get `cost x mult` coins back.
// `weight` is the chance of the slice (the weights add up to 100).
// The slices are drawn the same size, but the chances are different (see the table on the wheel screen).
// Change `mult` and `weight` to make the wheel kinder or harder.
type WheelSegment = { mult: number; weight: number; color: string; text: string };

const WHEEL_SEGMENTS: WheelSegment[] = [
  { mult: 1, weight: 14, color: "#eab308", text: "#3b2f00" },
  { mult: 0.25, weight: 17, color: "#ef4444", text: "#ffffff" },
  { mult: 2, weight: 10, color: "#14b8a6", text: "#ffffff" },
  { mult: 0, weight: 20, color: "#4b5563", text: "#ffffff" },
  { mult: 3, weight: 5, color: "#3b82f6", text: "#ffffff" },
  { mult: 0.5, weight: 20, color: "#f97316", text: "#ffffff" },
  { mult: 10, weight: 0.5, color: "#ffc83d", text: "#3b2f00" },
  { mult: 1.5, weight: 11, color: "#22c55e", text: "#ffffff" },
  { mult: 5, weight: 2.5, color: "#8b5cf6", text: "#ffffff" },
];

const WHEEL_TOTAL_WEIGHT = WHEEL_SEGMENTS.reduce((s, x) => s + x.weight, 0);

// Average coins back for every 100 coins spent
const WHEEL_EV_PERCENT = Math.round(
  (WHEEL_SEGMENTS.reduce((s, x) => s + x.weight * x.mult, 0) / WHEEL_TOTAL_WEIGHT) * 100
);

// Picks the slice that will win (using the chances)
const pickSegment = () => {
  let r = Math.random() * WHEEL_TOTAL_WEIGHT;
  for (let i = 0; i < WHEEL_SEGMENTS.length; i++) {
    if (r < WHEEL_SEGMENTS[i].weight) return i;
    r -= WHEEL_SEGMENTS[i].weight;
  }
  return WHEEL_SEGMENTS.length - 1;
};

// ---------- Rarity ----------

type RarityId = "common" | "rare" | "legendary" | "heavenly";

const RARITIES: Record<RarityId, { color: string }> = {
  common: { color: "#8d9b94" },
  rare: { color: "#3b82f6" },
  legendary: { color: "#a855f7" },
  heavenly: { color: "#ffc83d" },
};

const HEAVENLY = RARITIES.heavenly.color;

const RARITY_ORDER: RarityId[] = ["common", "rare", "legendary", "heavenly"];

// ---------- Ranks ----------

// `min` = salavat needed in the last 24 hours to have this rank.
// Say more and you rank up. Say less (old salavat leave the 24 hours) and you rank down.
const RANKS = [
  { id: "novice", icon: "🌱", min: 0, color: "#8d9b94" },
  { id: "bronze", icon: "🥉", min: 50, color: "#cd7f32" },
  { id: "silver", icon: "🥈", min: 150, color: "#9aa5b1" },
  { id: "gold", icon: "🥇", min: 313, color: "#f2b01e" },
  { id: "platinum", icon: "💠", min: 600, color: "#3fb8c9" },
  { id: "diamond", icon: "💎", min: 1000, color: "#38b6ff" },
  { id: "master", icon: "👑", min: 2000, color: "#a64dff" },
  { id: "legend", icon: "🔥", min: 4000, color: "#ff5252" },
];

const HOUR_MS = 3600000;

// Number of the current hour (counted from 1970), used to group salavat by hour
const nowHourIndex = () => Math.floor(Date.now() / HOUR_MS);

// Salavat said in the last RANK_WINDOW_HOURS hours
const windowTotal = (hourly: Record<string, number>, nowHour: number) => {
  let sum = 0;
  for (let i = 0; i < RANK_WINDOW_HOURS; i++) sum += hourly[String(nowHour - i)] ?? 0;
  return sum;
};

// Which rank a total belongs to
const rankIndexFor = (total: number) => {
  let idx = 0;
  RANKS.forEach((r, i) => {
    if (total >= r.min) idx = i;
  });
  return idx;
};

// If nothing more is said, after how many hours does the rank drop (and to which rank)?
const dropInfo = (hourly: Record<string, number>, nowHour: number, currentIdx: number) => {
  if (currentIdx === 0) return null;
  for (let k = 1; k <= RANK_WINDOW_HOURS; k++) {
    let sum = 0;
    for (let j = nowHour + k - (RANK_WINDOW_HOURS - 1); j <= nowHour; j++) {
      sum += hourly[String(j)] ?? 0;
    }
    const idx = rankIndexFor(sum);
    if (idx < currentIdx) return { hours: k, rank: idx };
  }
  return null;
};

// ---------- Languages ----------

type Lang = "fa" | "en";
type DarkSetting = "system" | "light" | "dark";

const fa = {
  appTitle: "صلوات شمار",
  unit: "صلوات",
  roundsLabel: (n: number) => `دورهای کامل: ${n}`,
  resetBtn: "صفر کردن",
  newRound: "دور جدید شروع می‌شه...",
  untilGoal: (goal: number, left: number, got: boolean) =>
    `${left} تا هدف ${goal}${got ? " (جایزه‌ش رو گرفتی)" : ""}`,
  shopBtn: "🛍 فروشگاه",

  roundDone: (n: number) => `دور ${n} کامل شد!`,
  goalDone: (n: number) => `هدف ${n} کامل شد!`,
  questToast: (n: number) => `کوئست روزانه ${n} صلوات کامل شد!`,
  boostWas: "⚡ ضریب ×۲ فعال بود",
  recordNew: (n: number) => `🏆 رکورد جدید: ${n} صلوات در یک روز!`,
  achNew: (name: string) => `🏅 دستاورد جدید: ${name}`,
  coinsPlus: (n: number) => `+${n} سکه 🪙`,
  diamondsPlus: (n: number) => `+${n} الماس 💎`,

  cancel: "انصراف",
  yes: "بله",
  buyWord: "خرید",
  close: "بستن",
  resetTitle: "صفر کردن",
  resetMsg:
    "شمارنده صفر شود؟ جایزه‌ی هدف‌هایی که توی این دور گرفتی دوباره داده نمی‌شه و دور بعد دوباره فعال می‌شه. پیشرفت کوئست‌ها، رکورد، رنک و دستاوردها هم سر جاش می‌مونه.",
  unitCoin: "سکه",
  unitDiamond: "الماس",
  notEnoughTitle: (unit: string) => `${unit} کافی نیست`,
  notEnoughMsg: (price: number, unit: string, missing: number) =>
    `قیمت این آیتم ${price} ${unit} هست و ${missing} ${unit} دیگه لازم داری.`,
  buyConfirm: (name: string, price: number, unit: string) =>
    `«${name}» به قیمت ${price} ${unit} خریده بشه؟`,
  boostActiveTitle: "فعاله",
  boostActiveMsg: "ضریب ×۲ امروز فعاله و تا نیمه‌شب ادامه داره.",
  boostConfirm: (price: number) => `«ضریب ×۲ سکه (امروز)» به قیمت ${price} الماس خریده بشه؟`,

  shopTitle: "🛍 فروشگاه",
  walletLine: (c: number, d: number) => `🪙 ${c} سکه     💎 ${d} الماس`,
  heavenlyTitle: "✨ ایتم‌های بهشتی",
  heavenlyNote: (price: number) =>
    `کمیاب‌ترین ایتم‌ها: تم‌های طرح‌دار با پس‌زمینه‌ی نقش‌دار، هر کدوم ${price} سکه`,
  diamondTitle: "💎 جوایز ویژه الماسی",
  diamondNote: (rec: number, ach: number, price: number) =>
    `با هر رکورد جدید ${rec} الماس می‌گیری و با هر دستاورد ${ach} الماس. قیمت هر جایزه‌ی ویژه ${price} الماسه.`,
  coinPriceNote: (price: number) => `قیمت آیتم‌های معمولی و کمیاب ${price} سکه‌ست`,
  themesTitle: "تم‌ها",
  buttonsTitle: "رنگ دکمه",
  buyLabel: (price: number, icon: string) => `${price} ${icon} خرید`,
  activeLabel: "فعال ✓",
  selectLabel: "انتخاب",
  boostName: "ضریب ×۲ سکه",
  boostDesc: "تا پایان امروز، همه‌ی جایزه‌های سکه‌ای دو برابر می‌شن",
  boostActiveLabel: "فعال امروز ✓",

  missionsTitle: "🎯 ماموریت‌ها",
  tabQuests: "کوئست و رکورد",
  tabAch: (n: number) => `🏅 دستاوردها${n > 0 ? ` (${n})` : ""}`,
  recordTitle: "🏆 رکورد شخصی",
  recordSub: "بیشترین صلوات در یک روز",
  todayCount: (n: number) => `امروز: ${n} صلوات`,
  recordHintNone: "با اولین صلوات، رکوردت ثبت می‌شه",
  recordHintToday: "رکورد مال امروزه 🎉 هرچی بیشتر بگی، رکورد بالاتر می‌ره",
  recordHintRemain: (n: number) => `${n} صلوات تا شکستن رکورد`,
  diamondHint: (rec: number, d: number) =>
    `💎 با هر رکورد جدید ${rec} الماس می‌گیری (الان ${d} الماس داری)`,
  questsSection: "کوئست‌های امروز",
  questNote:
    "کوئست‌ها هر روز از نیمه‌شب دوباره شروع می‌شن. همه‌ی صلوات‌های امروز حساب می‌شن، حتی بعد از صفر کردن.",
  questTitle: (n: number) => `${n} صلوات در روز`,
  claimedLabel: "دریافت شد ✓",
  rewardLabel: (n: number) => `+${n} 🪙`,

  achSummary: (c: number, total: number) => `🏅 ${c}/${total} دریافت شده`,
  statStreak: "🔥 روز پشت‌سرهم",
  statGoalDays: (goal: number) => `📅 روز با ${goal}+`,
  statTotal: "∑ مجموع صلوات",
  achNote: (reward: number) => `هر دستاورد ${reward} الماس جایزه داره و فقط یک بار قابل دریافته.`,
  claimLabel: (reward: number) => `دریافت ${reward} 💎`,

  settingsTitle: "⚙️ تنظیمات",
  darkMode: "حالت تاریک",
  modeSystem: "خودکار",
  modeLight: "روشن",
  modeDark: "تاریک",
  language: "زبان برنامه",
  chartTitle: "📊 صلوات این هفته",
  chartTotal: "مجموع هفته",
  chartAvg: "میانگین روزانه",
  chartBest: "بهترین روز",
  chartNote: "هفته از شنبه شروع می‌شه و آمار از همین نسخه به بعد ذخیره می‌شه.",

  rankTitle: "⭐ رنک",
  rank24h: "صلوات 24 ساعت اخیر",
  rankToNext: (n: number, name: string) => `${n} صلوات تا رنک «${name}»`,
  rankTop: "به بالاترین رنک رسیدی! 🎉",
  rankAvg: "میانگین در ساعت",
  rankThisHour: "این ساعت",
  rankPeak: "بالاترین رنک تو",
  rankDecay: (h: number, name: string) =>
    `⏳ اگه از الان صلوات نگی، حدود ${h} ساعت دیگه رنکت میاد پایین به «${name}»`,
  rankDecayNone: "هرچی بیشتر بگی، رنکت بالاتر می‌ره 🚀",
  rankExpire: (n: number) => `تا ساعت بعد ${n} صلوات از حساب 24 ساعته‌ات خارج می‌شه`,
  rankLadder: "همه‌ی رنک‌ها",
  rankFrom: (n: number) => `از ${n} صلوات`,
  rankYours: "رنک تو",
  rankNote:
    "رنک بر اساس صلوات‌های 24 ساعت اخیرت حساب می‌شه. با گذشت زمان صلوات‌های قدیمی از حساب خارج می‌شن، پس اگه کم بگی رنکت میاد پایین و اگه بیشتر بگی بالا می‌ره.",
  rankUp: (name: string) => `🎉 رنک آپ! رنک جدید: ${name}`,
  rankDown: (name: string) => `📉 رنک داون! رنکت شد ${name}`,

  wheelTitle: "🎡 گردونه شانس",
  wheelNote: (cost: number) =>
    `هر چرخش ${cost} سکه‌ست. ممکنه چند برابر سکه بگیری یا کمتر از چیزی که دادی برگرده.`,
  wheelSpinBtn: (cost: number) => `بچرخون! (${cost} 🪙)`,
  wheelSpinning: "در حال چرخش...",
  wheelResult: (mult: number, payout: number, cost: number) =>
    payout > cost
      ? `🎉 ضریب ×${mult}! ${payout} سکه گرفتی (سود ${payout - cost})`
      : payout === cost
      ? `😐 ضریب ×${mult}: سکه‌هات برگشت`
      : payout === 0
      ? `💀 پوچ! چیزی برنگشت (ضرر ${cost})`
      : `😅 ضریب ×${mult}: ${payout} سکه برگشت (ضرر ${cost - payout})`,
  wheelToast: (mult: number) => `🎡 گردونه: ضریب ×${mult}`,
  wheelSpinsLabel: "تعداد چرخش",
  wheelNetLabel: "سود و ضرر کل",
  wheelOddsTitle: "شانس هر خانه",
  wheelEv: (pct: number) => `به‌طور میانگین حدود ${pct}% از سکه‌ای که خرج می‌کنی برمی‌گرده.`,
};

type Dict = typeof fa;

const en: Dict = {
  appTitle: "Salavat Counter",
  unit: "Salavat",
  roundsLabel: (n) => `Full rounds: ${n}`,
  resetBtn: "Reset",
  newRound: "A new round is starting...",
  untilGoal: (goal, left, got) => `${left} to goal ${goal}${got ? " (reward already taken)" : ""}`,
  shopBtn: "🛍 Shop",

  roundDone: (n) => `Round ${n} complete!`,
  goalDone: (n) => `Goal ${n} reached!`,
  questToast: (n) => `Daily quest of ${n} salavat complete!`,
  boostWas: "⚡ ×2 boost was active",
  recordNew: (n) => `🏆 New record: ${n} salavat in one day!`,
  achNew: (name) => `🏅 New achievement: ${name}`,
  coinsPlus: (n) => `+${n} coins 🪙`,
  diamondsPlus: (n) => `+${n} diamonds 💎`,

  cancel: "Cancel",
  yes: "Yes",
  buyWord: "Buy",
  close: "Close",
  resetTitle: "Reset",
  resetMsg:
    "Reset the counter? Rewards of the goals you already reached in this round will not be given again, and they become active again next round. Quest progress, record, rank and achievements stay as they are.",
  unitCoin: "coins",
  unitDiamond: "diamonds",
  notEnoughTitle: (unit) => `Not enough ${unit}`,
  notEnoughMsg: (price, unit, missing) =>
    `This item costs ${price} ${unit} and you need ${missing} more ${unit}.`,
  buyConfirm: (name, price, unit) => `Buy "${name}" for ${price} ${unit}?`,
  boostActiveTitle: "Already active",
  boostActiveMsg: "The ×2 boost is active today and lasts until midnight.",
  boostConfirm: (price) => `Buy "×2 coins (today)" for ${price} diamonds?`,

  shopTitle: "🛍 Shop",
  walletLine: (c, d) => `🪙 ${c} coins     💎 ${d} diamonds`,
  heavenlyTitle: "✨ Heavenly items",
  heavenlyNote: (price) =>
    `The rarest items: themes with a patterned background, ${price} coins each`,
  diamondTitle: "💎 Special diamond rewards",
  diamondNote: (rec, ach, price) =>
    `You get ${rec} diamond for every new record and ${ach} for every achievement. Each special reward costs ${price} diamonds.`,
  coinPriceNote: (price) => `Common and rare items cost ${price} coins`,
  themesTitle: "Themes",
  buttonsTitle: "Button color",
  buyLabel: (price, icon) => `${price} ${icon} Buy`,
  activeLabel: "Active ✓",
  selectLabel: "Select",
  boostName: "×2 coins",
  boostDesc: "Until the end of today, all coin rewards are doubled",
  boostActiveLabel: "Active today ✓",

  missionsTitle: "🎯 Missions",
  tabQuests: "Quests & record",
  tabAch: (n) => `🏅 Achievements${n > 0 ? ` (${n})` : ""}`,
  recordTitle: "🏆 Personal record",
  recordSub: "Most salavat in one day",
  todayCount: (n) => `Today: ${n} salavat`,
  recordHintNone: "Your record is saved with your first salavat",
  recordHintToday: "Today holds the record 🎉 The more you say, the higher it goes",
  recordHintRemain: (n) => `${n} salavat to break the record`,
  diamondHint: (rec, d) => `💎 You get ${rec} diamond for every new record (you have ${d} now)`,
  questsSection: "Today's quests",
  questNote:
    "Quests restart every day at midnight. All of today's salavat count, even after a reset.",
  questTitle: (n) => `${n} salavat in a day`,
  claimedLabel: "Claimed ✓",
  rewardLabel: (n) => `+${n} 🪙`,

  achSummary: (c, total) => `🏅 ${c}/${total} claimed`,
  statStreak: "🔥 days in a row",
  statGoalDays: (goal) => `📅 days with ${goal}+`,
  statTotal: "∑ total salavat",
  achNote: (reward) => `Every achievement gives ${reward} diamond and can be claimed only once.`,
  claimLabel: (reward) => `Claim ${reward} 💎`,

  settingsTitle: "⚙️ Settings",
  darkMode: "Dark mode",
  modeSystem: "Auto",
  modeLight: "Light",
  modeDark: "Dark",
  language: "App language",
  chartTitle: "📊 This week's salavat",
  chartTotal: "Week total",
  chartAvg: "Daily average",
  chartBest: "Best day",
  chartNote: "The week starts on Monday and stats are saved from this version on.",

  rankTitle: "⭐ Rank",
  rank24h: "Salavat in the last 24 hours",
  rankToNext: (n, name) => `${n} salavat to rank "${name}"`,
  rankTop: "You reached the highest rank! 🎉",
  rankAvg: "Average per hour",
  rankThisHour: "This hour",
  rankPeak: "Your highest rank",
  rankDecay: (h, name) =>
    `⏳ If you say nothing from now on, your rank drops to "${name}" in about ${h} hours`,
  rankDecayNone: "The more you say, the higher your rank goes 🚀",
  rankExpire: (n) => `${n} salavat will leave your 24-hour count by next hour`,
  rankLadder: "All ranks",
  rankFrom: (n) => `From ${n} salavat`,
  rankYours: "Your rank",
  rankNote:
    "Your rank is based on the salavat of the last 24 hours. Old salavat leave the count as time passes, so if you say less your rank drops and if you say more it goes up.",
  rankUp: (name) => `🎉 Rank up! New rank: ${name}`,
  rankDown: (name) => `📉 Rank down! Your rank is now ${name}`,

  wheelTitle: "🎡 Lucky wheel",
  wheelNote: (cost) =>
    `Every spin costs ${cost} coins. You may win many times more coins, or get back less than you paid.`,
  wheelSpinBtn: (cost) => `Spin! (${cost} 🪙)`,
  wheelSpinning: "Spinning...",
  wheelResult: (mult, payout, cost) =>
    payout > cost
      ? `🎉 ×${mult}! You won ${payout} coins (profit ${payout - cost})`
      : payout === cost
      ? `😐 ×${mult}: you got your coins back`
      : payout === 0
      ? `💀 Nothing! No coins back (loss ${cost})`
      : `😅 ×${mult}: ${payout} coins back (loss ${cost - payout})`,
  wheelToast: (mult) => `🎡 Wheel: ×${mult}`,
  wheelSpinsLabel: "Spins",
  wheelNetLabel: "Total profit / loss",
  wheelOddsTitle: "Chance of every slice",
  wheelEv: (pct) => `On average about ${pct}% of the coins you spend come back.`,
};

const T: Record<Lang, Dict> = { fa, en };

const RARITY_NAMES: Record<Lang, Record<RarityId, string>> = {
  fa: { common: "معمولی", rare: "کمیاب", legendary: "افسانه‌ای", heavenly: "بهشتی" },
  en: { common: "Common", rare: "Rare", legendary: "Legendary", heavenly: "Heavenly" },
};

const RANK_NAMES: Record<Lang, Record<string, string>> = {
  fa: {
    novice: "تازه‌کار",
    bronze: "برنز",
    silver: "نقره",
    gold: "طلا",
    platinum: "پلاتین",
    diamond: "الماس",
    master: "استاد",
    legend: "افسانه",
  },
  en: {
    novice: "Novice",
    bronze: "Bronze",
    silver: "Silver",
    gold: "Gold",
    platinum: "Platinum",
    diamond: "Diamond",
    master: "Master",
    legend: "Legend",
  },
};

const THEME_NAMES: Record<Lang, Record<string, string>> = {
  fa: {
    green: "سبز (پیش‌فرض)",
    blue: "آبی",
    purple: "بنفش",
    orange: "نارنجی",
    night: "شب (تاریک)",
    royal: "سلطنتی (طلایی تیره)",
    ruby: "یاقوتی",
    starry: "شب پرستاره",
    dome: "گنبد فیروزه‌ای",
    garden: "باغ بهشت",
    dawn: "طلوع نور",
  },
  en: {
    green: "Green (default)",
    blue: "Blue",
    purple: "Purple",
    orange: "Orange",
    night: "Night (dark)",
    royal: "Royal (dark gold)",
    ruby: "Ruby",
    starry: "Starry Night",
    dome: "Turquoise Dome",
    garden: "Garden of Paradise",
    dawn: "Dawn of Light",
  },
};

const BUTTON_NAMES: Record<Lang, Record<string, string>> = {
  fa: {
    default: "پیش‌فرض (هم‌رنگ تم)",
    gold: "طلایی",
    red: "قرمز",
    pink: "صورتی",
    teal: "فیروزه‌ای",
    black: "مشکی",
    rainbow: "رنگین‌کمان (متحرک)",
  },
  en: {
    default: "Default (theme color)",
    gold: "Gold",
    red: "Red",
    pink: "Pink",
    teal: "Teal",
    black: "Black",
    rainbow: "Rainbow (animated)",
  },
};

const G = ACH_DAILY_GOAL;

const ACH_TEXT: Record<Lang, Record<string, { name: string; desc: string }>> = {
  fa: {
    t1: { name: "شروع خوب", desc: "1000 صلوات در مجموع" },
    t2: { name: "ادامه‌دهنده", desc: "10000 صلوات در مجموع" },
    t3: { name: "دریای صلوات", desc: "100000 صلوات در مجموع" },
    g7: { name: "یه هفته پایبند", desc: `روزی ${G} صلوات، برای 7 روز` },
    g30: { name: "سی روز نور", desc: `روزی ${G} صلوات، برای 30 روز (لازم نیست پشت‌سرهم باشن)` },
    g100: { name: "صد روز با صلوات", desc: `روزی ${G} صلوات، برای 100 روز` },
    s7: { name: "هفت روز پشت‌سرهم", desc: `روزی ${G} صلوات، 7 روز پشت‌سرهم` },
    s30: { name: "سی روز پشت‌سرهم", desc: `روزی ${G} صلوات، 30 روز پشت‌سرهم` },
    d1: { name: "روز پرکار", desc: "1000 صلوات در یک روز" },
    d2: { name: "روز استثنایی", desc: "3000 صلوات در یک روز" },
    r1: { name: "اولین دور", desc: "1 دور کامل (تا 1000)" },
    r2: { name: "ده دور", desc: "10 دور کامل" },
    rec1: { name: "رکوردشکن", desc: "شکستن رکورد روزانه برای اولین بار" },
    rec5: { name: "پنج رکورد", desc: "شکستن رکورد روزانه 5 بار" },
    q1: { name: "کوئست‌باز", desc: "کامل کردن همه‌ی کوئست‌های یک روز" },
    q7: { name: "هفته‌ی کوئست", desc: "کامل کردن همه‌ی کوئست‌ها در 7 روز" },
    p1: { name: "اولین خرید", desc: "خرید یک آیتم از فروشگاه" },
    p5: { name: "کلکسیونر", desc: "داشتن 5 آیتم از فروشگاه" },
  },
  en: {
    t1: { name: "Good start", desc: "1000 salavat in total" },
    t2: { name: "Keeping going", desc: "10000 salavat in total" },
    t3: { name: "Ocean of salavat", desc: "100000 salavat in total" },
    g7: { name: "A week of commitment", desc: `${G} salavat a day, for 7 days` },
    g30: { name: "Thirty days of light", desc: `${G} salavat a day, for 30 days (not necessarily in a row)` },
    g100: { name: "A hundred days", desc: `${G} salavat a day, for 100 days` },
    s7: { name: "Seven days in a row", desc: `${G} salavat a day, 7 days in a row` },
    s30: { name: "Thirty days in a row", desc: `${G} salavat a day, 30 days in a row` },
    d1: { name: "Busy day", desc: "1000 salavat in one day" },
    d2: { name: "Exceptional day", desc: "3000 salavat in one day" },
    r1: { name: "First round", desc: "1 full round (up to 1000)" },
    r2: { name: "Ten rounds", desc: "10 full rounds" },
    rec1: { name: "Record breaker", desc: "Break the daily record for the first time" },
    rec5: { name: "Five records", desc: "Break the daily record 5 times" },
    q1: { name: "Quest runner", desc: "Complete all quests of a day" },
    q7: { name: "Quest week", desc: "Complete all quests on 7 days" },
    p1: { name: "First purchase", desc: "Buy one item from the shop" },
    p5: { name: "Collector", desc: "Own 5 shop items" },
  },
};

// Short weekday names, in the order the week is shown in each language
const WEEKDAYS: Record<Lang, string[]> = {
  fa: ["ش", "ی", "د", "س", "چ", "پ", "ج"], // Saturday ... Friday
  en: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
};

// ---------- Dates ----------

const keyFromDate = (d: Date) => {
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
};

// Today's date as text (local time), e.g. "2026-10-25"
const todayKey = () => keyFromDate(new Date());

// Moves a date text by some days, e.g. shiftDay("2026-10-25", -1) = "2026-10-24"
const shiftDay = (key: string, offset: number) => {
  const [y, m, d] = key.split("-").map(Number);
  return keyFromDate(new Date(y, m - 1, d + offset));
};

// Turns "2026-10-25" into a readable date (falls back to the raw text)
const formatDate = (key: string, lang: Lang) => {
  const [y, m, d] = key.split("-").map(Number);
  if (!y || !m || !d) return key;
  try {
    return new Date(y, m - 1, d).toLocaleDateString(lang === "fa" ? "fa-IR" : "en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  } catch {
    return key;
  }
};

// The 7 days of the current week (Saturday first in Persian, Monday first in English)
const weekKeys = (today: string, lang: Lang) => {
  const [y, m, d] = today.split("-").map(Number);
  const dow = new Date(y, m - 1, d).getDay(); // 0 = Sunday ... 6 = Saturday
  const sinceStart = lang === "fa" ? (dow + 1) % 7 : (dow + 6) % 7;
  const start = shiftDay(today, -sinceStart);
  return Array.from({ length: 7 }, (_, i) => shiftDay(start, i));
};

// ---------- Achievements ----------

// Numbers the achievements are based on
type Stats = {
  total: number; // all salavat ever
  goalDays: number; // days with at least ACH_DAILY_GOAL salavat
  bestStreak: number; // longest run of goal days in a row
  bestDaily: number; // most salavat in one day
  rounds: number; // completed rounds
  owned: number; // shop items owned
  recordsBroken: number; // how many times the daily record was broken
  perfectDays: number; // days with ALL daily quests completed
};

type Achievement = {
  id: string;
  icon: string;
  stat: keyof Stats;
  target: number;
};

const ACHIEVEMENTS: Achievement[] = [
  { id: "t1", icon: "🌱", stat: "total", target: 1000 },
  { id: "t2", icon: "🌿", stat: "total", target: 10000 },
  { id: "t3", icon: "🌳", stat: "total", target: 100000 },
  { id: "g7", icon: "📅", stat: "goalDays", target: 7 },
  { id: "g30", icon: "🗓️", stat: "goalDays", target: 30 },
  { id: "g100", icon: "💯", stat: "goalDays", target: 100 },
  { id: "s7", icon: "🔥", stat: "bestStreak", target: 7 },
  { id: "s30", icon: "☀️", stat: "bestStreak", target: 30 },
  { id: "d1", icon: "🚀", stat: "bestDaily", target: 1000 },
  { id: "d2", icon: "🌟", stat: "bestDaily", target: 3000 },
  { id: "r1", icon: "🔄", stat: "rounds", target: 1 },
  { id: "r2", icon: "🔁", stat: "rounds", target: 10 },
  { id: "rec1", icon: "🏆", stat: "recordsBroken", target: 1 },
  { id: "rec5", icon: "🥇", stat: "recordsBroken", target: 5 },
  { id: "q1", icon: "🎯", stat: "perfectDays", target: 1 },
  { id: "q7", icon: "🎖️", stat: "perfectDays", target: 7 },
  { id: "p1", icon: "🛍️", stat: "owned", target: 1 },
  { id: "p5", icon: "🛒", stat: "owned", target: 5 },
];

// Ids of the achievements that are unlocked with the given numbers
const unlockedIds = (s: Stats) =>
  ACHIEVEMENTS.filter((a) => s[a.stat] >= a.target).map((a) => a.id);

// ---------- Colors and shop items ----------

// Kinds of background pattern (only heavenly themes have one)
type PatternKind = "stars" | "geometric" | "circles" | "rays";

type Theme = {
  id: string;
  rarity: RarityId; // how rare the item is
  premium?: boolean; // true = bought with diamonds
  dark?: boolean; // true = already a dark theme
  pattern?: PatternKind; // background design (heavenly themes)
  accent?: string; // second color used by the pattern
  primary: string;
  bg: string;
  card: string;
  track: string;
  text: string;
  sub: string;
  muted: string;
  badgeBg: string;
  badgeText: string;
};

type ButtonColor = {
  id: string;
  rarity: RarityId;
  premium?: boolean; // true = bought with diamonds
  color: string | null; // null = same color as the theme
};

const LIGHT_BADGE = { badgeBg: "#fff6dc", badgeText: "#8a5d00" };
const DARK_BADGE = { badgeBg: "#3a2f10", badgeText: "#ffd467" };

const THEMES: Theme[] = [
  {
    id: "green",
    rarity: "common",
    primary: "#1b7f5c",
    bg: "#eef6f2",
    card: "#ffffff",
    track: "#d9e4df",
    text: "#2f3b36",
    sub: "#5b6b64",
    muted: "#9aa9a2",
    ...LIGHT_BADGE,
  },
  {
    id: "blue",
    rarity: "common",
    primary: "#1e6fd9",
    bg: "#eef4fc",
    card: "#ffffff",
    track: "#d6e2f3",
    text: "#2a3340",
    sub: "#55606e",
    muted: "#9aa7b8",
    ...LIGHT_BADGE,
  },
  {
    id: "purple",
    rarity: "common",
    primary: "#7b3fc4",
    bg: "#f4eefb",
    card: "#ffffff",
    track: "#e3d8f1",
    text: "#33293f",
    sub: "#5f5470",
    muted: "#a899bd",
    ...LIGHT_BADGE,
  },
  {
    id: "orange",
    rarity: "common",
    primary: "#e8730c",
    bg: "#fdf3e7",
    card: "#ffffff",
    track: "#f2dfc9",
    text: "#3a2f25",
    sub: "#6b5b4b",
    muted: "#bba58f",
    ...LIGHT_BADGE,
  },
  {
    id: "night",
    rarity: "rare",
    dark: true,
    primary: "#2fb98a",
    bg: "#0e1412",
    card: "#19221e",
    track: "#2b3732",
    text: "#e8efec",
    sub: "#a8b5af",
    muted: "#6f7f78",
    ...DARK_BADGE,
  },
  // ----- Legendary themes (diamonds) -----
  {
    id: "royal",
    rarity: "legendary",
    premium: true,
    dark: true,
    primary: "#c99a2e",
    bg: "#15120b",
    card: "#221d12",
    track: "#383019",
    text: "#f5ecd2",
    sub: "#c9bb91",
    muted: "#8a7d58",
    ...DARK_BADGE,
  },
  {
    id: "ruby",
    rarity: "legendary",
    premium: true,
    primary: "#b71c3a",
    bg: "#fbeef0",
    card: "#ffffff",
    track: "#f0d4da",
    text: "#3a252a",
    sub: "#6b4f56",
    muted: "#b8939b",
    ...LIGHT_BADGE,
  },
  // ----- Heavenly themes (1500 coins): they have a pattern in the background -----
  {
    id: "starry",
    rarity: "heavenly",
    dark: true,
    pattern: "stars",
    accent: "#ffe9a8",
    primary: "#7c9cff",
    bg: "#080d2b",
    card: "#141c4a",
    track: "#252f66",
    text: "#eaf0ff",
    sub: "#aab6e8",
    muted: "#7280b8",
    ...DARK_BADGE,
  },
  {
    id: "dome",
    rarity: "heavenly",
    dark: true,
    pattern: "geometric",
    accent: "#f2c14e",
    primary: "#1fc7be",
    bg: "#042a30",
    card: "#0b3d45",
    track: "#16565f",
    text: "#e6fbf9",
    sub: "#9fd8d4",
    muted: "#5fa7a3",
    ...DARK_BADGE,
  },
  {
    id: "garden",
    rarity: "heavenly",
    dark: true,
    pattern: "circles",
    accent: "#d9f99d",
    primary: "#46e08a",
    bg: "#07281a",
    card: "#0f3d28",
    track: "#1b5538",
    text: "#e8fff1",
    sub: "#a3dcbb",
    muted: "#63a982",
    ...DARK_BADGE,
  },
  {
    id: "dawn",
    rarity: "heavenly",
    dark: true,
    pattern: "rays",
    accent: "#ffe0a3",
    primary: "#ffb347",
    bg: "#2b1608",
    card: "#43240e",
    track: "#5f3517",
    text: "#fff1de",
    sub: "#e8c39a",
    muted: "#a9805a",
    ...DARK_BADGE,
  },
];

const BUTTONS: ButtonColor[] = [
  { id: "default", rarity: "common", color: null },
  { id: "gold", rarity: "rare", color: "#d4a017" },
  { id: "red", rarity: "common", color: "#c62f3a" },
  { id: "pink", rarity: "common", color: "#d6457f" },
  { id: "teal", rarity: "common", color: "#0e8f9a" },
  { id: "black", rarity: "rare", color: "#2b2b2b" },
  // ----- Legendary button (diamonds) -----
  { id: "rainbow", rarity: "legendary", premium: true, color: "#8e24aa" },
];

// Colors the rainbow button slowly changes between
const RAINBOW = ["#e53935", "#fb8c00", "#fdd835", "#43a047", "#1e88e5", "#8e24aa", "#e53935"];
const RAINBOW_STEPS = RAINBOW.map((_, i) => i / (RAINBOW.length - 1));

const hexToRgb = (hex: string) => {
  const n = parseInt(hex.replace("#", ""), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

const toHex = (r: number, g: number, b: number) =>
  "#" +
  [r, g, b]
    .map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, "0"))
    .join("");

// Mixes two colors. `weight` is how much of the first color is used (0 to 1).
const mix = (a: string, b: string, weight: number) => {
  const [ar, ag, ab] = hexToRgb(a);
  const [br, bg, bb] = hexToRgb(b);
  return toHex(
    ar * weight + br * (1 - weight),
    ag * weight + bg * (1 - weight),
    ab * weight + bb * (1 - weight)
  );
};

// Dark version of any theme (themes that are already dark stay the same)
const makeDark = (t: Theme): Theme =>
  t.dark
    ? t
    : {
        ...t,
        primary: mix("#ffffff", t.primary, 0.2),
        bg: mix(t.primary, "#0b0f0d", 0.1),
        card: mix(t.primary, "#151a18", 0.1),
        track: mix(t.primary, "#242c29", 0.18),
        text: "#e8efec",
        sub: "#a8b5af",
        muted: "#73827b",
        ...DARK_BADGE,
      };

const hexToRgba = (hex: string, alpha: number) => {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
};

// Makes a color darker (used for the pressed state of the button).
const darken = (hex: string, amount = 0.2) => {
  const [r, g, b] = hexToRgb(hex);
  return `rgb(${Math.round(r * (1 - amount))}, ${Math.round(g * (1 - amount))}, ${Math.round(
    b * (1 - amount)
  )})`;
};

// Soft shadow that works on both Android and iOS.
const shadow = (color = "#000000", elevation = 4) => ({
  shadowColor: color,
  shadowOffset: { width: 0, height: elevation / 2 },
  shadowOpacity: 0.2,
  shadowRadius: elevation * 1.2,
  elevation,
});

// Same "random" numbers every time, so the pattern never jumps around
const seededRandom = (seed: number) => {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return s / 2147483647;
  };
};

// ---------- Background patterns of heavenly themes ----------

type PatternProps = {
  kind: PatternKind;
  color: string;
  accent: string;
  width?: number; // leave empty to fill the whole screen
  height?: number;
  scale?: number; // smaller number = smaller shapes (used for the small previews)
};

function PatternBackground({ kind, color, accent, width, height, scale = 1 }: PatternProps) {
  const win = useWindowDimensions();
  const w = width ?? win.width;
  const h = height ?? win.height;

  const items = useMemo(() => {
    const out: ReactElement[] = [];

    if (kind === "stars") {
      // Little stars scattered over the sky
      const rand = seededRandom(7);
      const count = Math.max(8, Math.round((70 * w * h) / (360 * 800)));
      for (let i = 0; i < count; i++) {
        const size = 1 + rand() * 2.4;
        const left = rand() * w;
        const top = rand() * h;
        const golden = rand() > 0.78;
        const opacity = 0.25 + rand() * 0.65;
        out.push(
          <View
            key={`s${i}`}
            style={{
              position: "absolute",
              left,
              top,
              width: size,
              height: size,
              borderRadius: size / 2,
              backgroundColor: golden ? accent : "#ffffff",
              opacity,
            }}
          />
        );
      }
      // Soft glowing clouds
      out.push(
        <View
          key="c1"
          style={{
            position: "absolute",
            left: w * 0.45,
            top: -h * 0.05,
            width: w * 0.8,
            height: w * 0.8,
            borderRadius: w * 0.4,
            backgroundColor: `${color}12`,
          }}
        />,
        <View
          key="c2"
          style={{
            position: "absolute",
            left: -w * 0.3,
            top: h * 0.6,
            width: w * 0.9,
            height: w * 0.9,
            borderRadius: w * 0.45,
            backgroundColor: `${accent}0d`,
          }}
        />
      );
    }

    if (kind === "geometric") {
      // Eight-pointed stars made from two squares, repeated like tiles of a dome
      const S = 72 * scale;
      const inner = S * 0.6;
      const cols = Math.ceil(w / S) + 1;
      const rows = Math.ceil(h / S) + 1;
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const left = c * S + (S - inner) / 2;
          const top = r * S + (S - inner) / 2;
          out.push(
            <View
              key={`a${r}-${c}`}
              style={{
                position: "absolute",
                left,
                top,
                width: inner,
                height: inner,
                borderWidth: 1,
                borderColor: `${color}33`,
              }}
            />,
            <View
              key={`b${r}-${c}`}
              style={{
                position: "absolute",
                left,
                top,
                width: inner,
                height: inner,
                borderWidth: 1,
                borderColor: `${color}33`,
                transform: [{ rotate: "45deg" }],
              }}
            />
          );
          if ((r + c) % 2 === 0) {
            out.push(
              <View
                key={`d${r}-${c}`}
                style={{
                  position: "absolute",
                  left: c * S - 2,
                  top: r * S - 2,
                  width: 4,
                  height: 4,
                  borderRadius: 2,
                  backgroundColor: `${accent}66`,
                }}
              />
            );
          }
        }
      }
    }

    if (kind === "circles") {
      // Overlapping circles that make flower-like shapes
      const D = 64 * scale;
      const rowH = D * 0.866;
      const cols = Math.ceil(w / D) + 2;
      const rows = Math.ceil(h / rowH) + 2;
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          out.push(
            <View
              key={`o${r}-${c}`}
              style={{
                position: "absolute",
                left: c * D + (r % 2 === 1 ? D / 2 : 0) - D / 2,
                top: r * rowH - D / 2,
                width: D,
                height: D,
                borderRadius: D / 2,
                borderWidth: 1,
                borderColor: r % 3 === 0 ? `${accent}30` : `${color}2b`,
              }}
            />
          );
        }
      }
    }

    if (kind === "rays") {
      // Rays of light coming down from the sun at the top
      const cx = w / 2;
      const cy = -h * 0.04;
      const length = h * 1.3;
      const count = 15;
      for (let i = 0; i < count; i++) {
        const angle = -75 + (i * 150) / (count - 1);
        const thick = (i % 2 === 0 ? 3 : 1.5) * Math.max(scale, 0.5);
        out.push(
          <View
            key={`r${i}`}
            style={{
              position: "absolute",
              left: cx,
              top: cy,
              width: 0,
              height: 0,
              transform: [{ rotate: `${angle}deg` }],
            }}
          >
            <View
              style={{
                position: "absolute",
                left: -thick / 2,
                top: 0,
                width: thick,
                height: length,
                backgroundColor: i % 2 === 0 ? `${color}26` : `${accent}18`,
              }}
            />
          </View>
        );
      }
      [0.9, 0.6, 0.35].forEach((f, i) => {
        const size = w * f;
        out.push(
          <View
            key={`g${i}`}
            style={{
              position: "absolute",
              left: cx - size / 2,
              top: cy - size / 2,
              width: size,
              height: size,
              borderRadius: size / 2,
              backgroundColor: `${accent}${i === 2 ? "26" : "14"}`,
            }}
          />
        );
      });
    }

    return out;
  }, [kind, color, accent, w, h, scale]);

  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.patternBox]}>
      {items}
    </View>
  );
}

// ---------- The wheel ----------

type WheelProps = {
  size: number;
  rotation: Animated.Value; // rotation in degrees
};

function Wheel({ size, rotation }: WheelProps) {
  const R = size / 2;
  const n = WHEEL_SEGMENTS.length;
  const segAngle = 360 / n;

  const rotate = rotation.interpolate({
    inputRange: [0, 360],
    outputRange: ["0deg", "360deg"],
  });

  // The wheel is drawn with thin rays that start in the middle (angle 0 = up, clockwise)
  const body = useMemo(() => {
    const out: ReactElement[] = [];
    const step = 2;
    const rayWidth = (2 * Math.PI * R) / (360 / step) + 2.5;
    const zero = { position: "absolute" as const, left: 0, top: 0, width: 0, height: 0 };

    // Colors of the slices
    WHEEL_SEGMENTS.forEach((seg, i) => {
      const start = i * segAngle;
      for (let a = start + step / 2; a < start + segAngle; a += step) {
        out.push(
          <View key={`r${i}-${a}`} style={[zero, { transform: [{ rotate: `${a}deg` }] }]}>
            <View
              style={{
                position: "absolute",
                left: -rayWidth / 2,
                top: -R,
                width: rayWidth,
                height: R,
                backgroundColor: seg.color,
              }}
            />
          </View>
        );
      }
    });

    // White lines between the slices
    for (let i = 0; i < n; i++) {
      out.push(
        <View key={`d${i}`} style={[zero, { transform: [{ rotate: `${i * segAngle}deg` }] }]}>
          <View
            style={{
              position: "absolute",
              left: -1.25,
              top: -R,
              width: 2.5,
              height: R,
              backgroundColor: "rgba(255,255,255,0.85)",
            }}
          />
        </View>
      );
    }

    // Texts of the slices
    WHEEL_SEGMENTS.forEach((seg, i) => {
      const center = i * segAngle + segAngle / 2;
      out.push(
        <View key={`l${i}`} style={[zero, { transform: [{ rotate: `${center}deg` }] }]}>
          <View
            style={{
              position: "absolute",
              left: -32,
              top: -(R - 22),
              width: 64,
              alignItems: "center",
            }}
          >
            <Text style={{ fontSize: 17, fontWeight: "bold", color: seg.text }}>×{seg.mult}</Text>
            <Text style={{ fontSize: 12, color: seg.text, opacity: 0.9 }}>
              {Math.round(WHEEL_COST * seg.mult)}
            </Text>
          </View>
        </View>
      );
    });

    return out;
  }, [R, n, segAngle]);

  return (
    <Animated.View
      style={{
        width: size,
        height: size,
        borderRadius: R,
        overflow: "hidden",
        transform: [{ rotate }],
      }}
    >
      <View style={{ position: "absolute", left: R, top: R, width: 0, height: 0 }}>{body}</View>
    </Animated.View>
  );
}

// ---------- Small pieces of the screen ----------

// Row of buttons to pick one option
type SegProps<V extends string> = {
  options: { id: V; label: string }[];
  value: V;
  onChange: (v: V) => void;
  theme: Theme;
};

function Segmented<V extends string>({ options, value, onChange, theme }: SegProps<V>) {
  return (
    <View style={styles.segRow}>
      {options.map((o) => {
        const active = value === o.id;
        return (
          <Pressable
            key={o.id}
            onPress={() => onChange(o.id)}
            style={[
              styles.seg,
              {
                backgroundColor: active ? theme.primary : theme.card,
                borderColor: theme.primary,
              },
            ]}
          >
            <Text style={[styles.segText, { color: active ? "#ffffff" : theme.primary }]}>
              {o.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

// Small label that shows how rare an item is
function RarityBadge({ rarity, lang, theme }: { rarity: RarityId; lang: Lang; theme: Theme }) {
  const c = RARITIES[rarity].color;
  return (
    <View style={[styles.rarityBadge, { backgroundColor: `${c}33`, borderColor: c }]}>
      <Text style={[styles.rarityText, { color: theme.text }]}>
        {rarity === "heavenly" ? "✨ " : ""}
        {RARITY_NAMES[lang][rarity]}
      </Text>
    </View>
  );
}

// Bar chart of the 7 days of the week
type ChartDay = {
  key: string;
  label: string;
  value: number;
  isToday: boolean;
  future: boolean;
};

const CHART_HEIGHT = 130;

function WeekChart({ days, theme, L }: { days: ChartDay[]; theme: Theme; L: Dict }) {
  const maxVal = Math.max(1, ...days.map((d) => d.value));
  const past = days.filter((d) => !d.future);
  const total = past.reduce((sum, d) => sum + d.value, 0);
  const avg = past.length > 0 ? Math.round(total / past.length) : 0;
  const best = Math.max(0, ...days.map((d) => d.value));

  return (
    <View style={[styles.chartCard, shadow("#000000", 4), { backgroundColor: theme.card }]}>
      <Text style={[styles.chartTitle, { color: theme.text }]}>{L.chartTitle}</Text>

      <View style={styles.chartRow}>
        {days.map((d) => {
          const barHeight =
            d.future || d.value === 0 ? 4 : Math.max(8, (d.value / maxVal) * CHART_HEIGHT);
          const barColor = d.future
            ? theme.track
            : d.value === 0
            ? theme.track
            : d.isToday
            ? theme.primary
            : `${theme.primary}99`;

          return (
            <View key={d.key} style={styles.chartCol}>
              <Text style={[styles.chartValue, { color: theme.sub }]}>
                {!d.future && d.value > 0 ? d.value : ""}
              </Text>
              <View style={styles.chartBarArea}>
                <View style={[styles.chartBar, { height: barHeight, backgroundColor: barColor }]} />
              </View>
              <Text
                style={[
                  styles.chartLabel,
                  {
                    color: d.isToday ? theme.primary : theme.muted,
                    fontWeight: d.isToday ? "bold" : "normal",
                  },
                ]}
              >
                {d.label}
              </Text>
            </View>
          );
        })}
      </View>

      <View style={styles.statsRow}>
        <View style={[styles.statBox, { backgroundColor: `${theme.primary}14` }]}>
          <Text style={[styles.statValue, { color: theme.primary }]}>{total}</Text>
          <Text style={[styles.statLabel, { color: theme.sub }]}>{L.chartTotal}</Text>
        </View>
        <View style={[styles.statBox, { backgroundColor: `${theme.primary}14` }]}>
          <Text style={[styles.statValue, { color: theme.primary }]}>{avg}</Text>
          <Text style={[styles.statLabel, { color: theme.sub }]}>{L.chartAvg}</Text>
        </View>
        <View style={[styles.statBox, { backgroundColor: `${theme.primary}14` }]}>
          <Text style={[styles.statValue, { color: theme.primary }]}>{best}</Text>
          <Text style={[styles.statLabel, { color: theme.sub }]}>{L.chartBest}</Text>
        </View>
      </View>

      <Text style={[styles.chartNote, { color: theme.muted }]}>{L.chartNote}</Text>
    </View>
  );
}

// ---------- One row in the shop ----------

type RowProps = {
  name: string;
  rarity: RarityId;
  swatches: string[];
  owned: boolean;
  active: boolean;
  affordable: boolean;
  price: number;
  icon: string;
  buy: { bg: string; text: string };
  theme: Theme;
  lang: Lang;
  L: Dict;
  onPress: () => void;
};

function ShopRow({
  name,
  rarity,
  swatches,
  owned,
  active,
  affordable,
  price,
  icon,
  buy,
  theme,
  lang,
  L,
  onPress,
}: RowProps) {
  let label = L.buyLabel(price, icon);
  let bg = theme.track;
  let color = theme.muted;

  if (active) {
    label = L.activeLabel;
    bg = theme.track;
    color = theme.sub;
  } else if (owned) {
    label = L.selectLabel;
    bg = theme.primary;
    color = "#ffffff";
  } else if (affordable) {
    bg = buy.bg;
    color = buy.text;
  }

  return (
    <View
      style={[
        styles.row,
        shadow("#000000", 3),
        {
          backgroundColor: theme.card,
          borderColor: active ? theme.primary : "transparent",
        },
      ]}
    >
      <View style={styles.swatches}>
        {swatches.map((c, i) => (
          <View
            key={i}
            style={[styles.swatch, { backgroundColor: c, borderColor: theme.card }, shadow("#000000", 2)]}
          />
        ))}
      </View>
      <View style={styles.rowMid}>
        <Text style={[styles.rowTitle, { color: theme.text }]}>{name}</Text>
        <RarityBadge rarity={rarity} lang={lang} theme={theme} />
      </View>
      <Pressable
        disabled={active}
        onPress={onPress}
        style={[styles.rowButton, { backgroundColor: bg }]}
      >
        <Text style={[styles.rowButtonText, { color }]}>{label}</Text>
      </Pressable>
    </View>
  );
}

// ---------- One heavenly theme in the shop (with a small preview of its pattern) ----------

type HeavenlyRowProps = {
  t: Theme;
  name: string;
  owned: boolean;
  active: boolean;
  affordable: boolean;
  theme: Theme;
  lang: Lang;
  L: Dict;
  onPress: () => void;
};

function HeavenlyRow({ t, name, owned, active, affordable, theme, lang, L, onPress }: HeavenlyRowProps) {
  let label = L.buyLabel(HEAVENLY_PRICE, "🪙");
  let bg = theme.track;
  let color = theme.muted;

  if (active) {
    label = L.activeLabel;
    color = theme.sub;
  } else if (owned) {
    label = L.selectLabel;
    bg = theme.primary;
    color = "#ffffff";
  } else if (affordable) {
    bg = COIN_BUY.bg;
    color = COIN_BUY.text;
  }

  return (
    <View
      style={[
        styles.row,
        shadow(HEAVENLY, 5),
        {
          backgroundColor: theme.card,
          borderColor: active ? theme.primary : `${HEAVENLY}99`,
        },
      ]}
    >
      <View style={[styles.preview, { backgroundColor: t.bg, borderColor: t.primary }]}>
        {t.pattern && (
          <PatternBackground
            kind={t.pattern}
            color={t.primary}
            accent={t.accent ?? t.primary}
            width={56}
            height={56}
            scale={0.4}
          />
        )}
        <View style={[styles.previewDot, { backgroundColor: t.primary }]} />
      </View>
      <View style={styles.rowMid}>
        <Text style={[styles.rowTitle, { color: theme.text }]}>{name}</Text>
        <RarityBadge rarity="heavenly" lang={lang} theme={theme} />
      </View>
      <Pressable
        disabled={active}
        onPress={onPress}
        style={[styles.rowButton, { backgroundColor: bg }]}
      >
        <Text style={[styles.rowButtonText, { color }]}>{label}</Text>
      </Pressable>
    </View>
  );
}

// ---------- Special row: double coins for today ----------

type BoostRowProps = {
  active: boolean;
  affordable: boolean;
  theme: Theme;
  L: Dict;
  onPress: () => void;
};

function BoostRow({ active, affordable, theme, L, onPress }: BoostRowProps) {
  let label = L.buyLabel(DIAMOND_PRICE, "💎");
  let bg = theme.track;
  let color = theme.muted;

  if (active) {
    label = L.boostActiveLabel;
    color = theme.sub;
  } else if (affordable) {
    bg = DIAMOND_BUY.bg;
    color = DIAMOND_BUY.text;
  }

  return (
    <View
      style={[
        styles.row,
        shadow("#000000", 3),
        {
          backgroundColor: theme.card,
          borderColor: active ? theme.primary : "transparent",
        },
      ]}
    >
      <View style={[styles.swatch, styles.boostIcon, { borderColor: theme.card }]}>
        <Text style={styles.boostEmoji}>⚡</Text>
      </View>
      <View style={styles.boostInfo}>
        <Text style={[styles.rowName, styles.boostName, { color: theme.text }]}>{L.boostName}</Text>
        <Text style={[styles.boostDesc, { color: theme.sub }]}>{L.boostDesc}</Text>
      </View>
      <Pressable
        disabled={active}
        onPress={onPress}
        style={[styles.rowButton, { backgroundColor: bg }]}
      >
        <Text style={[styles.rowButtonText, { color }]}>{label}</Text>
      </Pressable>
    </View>
  );
}

// ---------- One daily quest card ----------

type QuestRowProps = {
  target: number;
  reward: number;
  progress: number;
  done: boolean;
  theme: Theme;
  L: Dict;
};

function QuestRow({ target, reward, progress, done, theme, L }: QuestRowProps) {
  const pct = Math.min(progress / target, 1) * 100;

  return (
    <View
      style={[
        styles.questCard,
        shadow("#000000", 3),
        {
          backgroundColor: theme.card,
          borderColor: done ? theme.primary : "transparent",
        },
      ]}
    >
      <View style={styles.questTop}>
        <Text style={[styles.questTitle, { color: theme.text }]}>{L.questTitle(target)}</Text>
        <View style={[styles.rewardChip, { backgroundColor: done ? theme.track : theme.badgeBg }]}>
          <Text style={[styles.rewardText, { color: done ? theme.sub : theme.badgeText }]}>
            {done ? L.claimedLabel : L.rewardLabel(reward)}
          </Text>
        </View>
      </View>
      <View style={[styles.questTrack, { backgroundColor: theme.track }]}>
        <View style={[styles.questFill, { width: `${pct}%`, backgroundColor: theme.primary }]} />
      </View>
      <Text style={[styles.questProgress, { color: theme.sub }]}>
        {Math.min(progress, target)} / {target}
      </Text>
    </View>
  );
}

// ---------- One achievement card ----------

type AchRowProps = {
  a: Achievement;
  name: string;
  desc: string;
  value: number;
  claimed: boolean;
  theme: Theme;
  L: Dict;
  onClaim: () => void;
};

function AchievementRow({ a, name, desc, value, claimed, theme, L, onClaim }: AchRowProps) {
  const unlocked = value >= a.target;
  const pct = Math.min(value / a.target, 1) * 100;

  let label = "🔒";
  let bg = theme.track;
  let color = theme.muted;

  if (claimed) {
    label = L.claimedLabel;
    color = theme.sub;
  } else if (unlocked) {
    label = L.claimLabel(ACH_REWARD);
    bg = DIAMOND_BUY.bg;
    color = DIAMOND_BUY.text;
  }

  return (
    <View
      style={[
        styles.achCard,
        shadow("#000000", 3),
        {
          backgroundColor: theme.card,
          borderColor: claimed ? theme.primary : unlocked ? DIAMOND : "transparent",
        },
      ]}
    >
      <View
        style={[
          styles.achIcon,
          { backgroundColor: unlocked ? `${DIAMOND}26` : theme.track },
        ]}
      >
        <Text style={[styles.achEmoji, !unlocked && styles.achEmojiLocked]}>{a.icon}</Text>
      </View>

      <View style={styles.achInfo}>
        <Text style={[styles.achName, { color: theme.text }]}>{name}</Text>
        <Text style={[styles.achDesc, { color: theme.sub }]}>{desc}</Text>
        <View style={[styles.achTrack, { backgroundColor: theme.track }]}>
          <View
            style={[
              styles.achFill,
              { width: `${pct}%`, backgroundColor: unlocked ? DIAMOND : theme.primary },
            ]}
          />
        </View>
        <Text style={[styles.achProgress, { color: theme.muted }]}>
          {Math.min(value, a.target)} / {a.target}
        </Text>
      </View>

      <Pressable
        disabled={claimed || !unlocked}
        onPress={onClaim}
        style={[styles.achButton, { backgroundColor: bg }]}
      >
        <Text style={[styles.achButtonText, { color }]}>{label}</Text>
      </Pressable>
    </View>
  );
}

// ---------- Main screen ----------

export default function Index() {
  const systemScheme = useColorScheme();

  const [count, setCount] = useState(0);
  const [coins, setCoins] = useState(0);
  const [diamonds, setDiamonds] = useState(0);
  const [rounds, setRounds] = useState(0);
  const [claimed, setClaimed] = useState<number[]>([]);
  const [toastTitle, setToastTitle] = useState("");
  const [toastReward, setToastReward] = useState(0);
  const [toastDiamonds, setToastDiamonds] = useState(0);
  const [locked, setLocked] = useState(false);
  const [loaded, setLoaded] = useState(false);

  // App settings
  const [lang, setLang] = useState<Lang>("fa");
  const [darkSetting, setDarkSetting] = useState<DarkSetting>("light");
  const [settingsOpen, setSettingsOpen] = useState(false);

  const [ownedThemes, setOwnedThemes] = useState<string[]>(["green"]);
  const [activeTheme, setActiveTheme] = useState("green");
  const [ownedButtons, setOwnedButtons] = useState<string[]>(["default"]);
  const [activeButton, setActiveButton] = useState("default");
  const [shopOpen, setShopOpen] = useState(false);

  // Day the "double coins" boost was bought for
  const [boostDate, setBoostDate] = useState("");

  // Daily quests
  const [today, setToday] = useState(todayKey());
  const [dailyDate, setDailyDate] = useState(todayKey());
  const [dailyCount, setDailyCount] = useState(0);
  const [dailyClaimed, setDailyClaimed] = useState<string[]>([]);
  const [questsOpen, setQuestsOpen] = useState(false);
  const [missionTab, setMissionTab] = useState<"quests" | "ach">("quests");

  // Salavat count of every day (for the weekly chart)
  const [history, setHistory] = useState<Record<string, number>>({});

  // Rank: salavat of every hour, the current hour, and the ranks we already announced
  const [hourly, setHourly] = useState<Record<string, number>>({});
  const [nowHour, setNowHour] = useState(nowHourIndex());
  const [lastRank, setLastRank] = useState(0);
  const [peakRank, setPeakRank] = useState(0);
  const [rankOpen, setRankOpen] = useState(false);
  const rankSeenRef = useRef<number | null>(null);

  // Lucky wheel
  const [wheelOpen, setWheelOpen] = useState(false);
  const [spinning, setSpinning] = useState(false);
  const [wheelResult, setWheelResult] = useState<{ mult: number; payout: number } | null>(null);
  // Prize of a spin that has not finished yet (saved, so it is never lost if the app closes)
  const [wheelPending, setWheelPending] = useState(0);
  const [wheelSpins, setWheelSpins] = useState(0);
  const [wheelNet, setWheelNet] = useState(0);
  const spinAnim = useRef(new Animated.Value(0)).current;
  const spinDeg = useRef(0);

  // Personal record: most salavat in a single day (no upper limit)
  const [bestDaily, setBestDaily] = useState(0);
  const [bestDate, setBestDate] = useState("");

  // Numbers for achievements
  const [totalSalavat, setTotalSalavat] = useState(0);
  const [goalDays, setGoalDays] = useState(0);
  const [streak, setStreak] = useState(0);
  const [bestStreak, setBestStreak] = useState(0);
  const [lastGoalDate, setLastGoalDate] = useState("");
  const [recordsBroken, setRecordsBroken] = useState(0);
  const [perfectDays, setPerfectDays] = useState(0);
  const [achClaimed, setAchClaimed] = useState<string[]>([]);
  const achClaimedRef = useRef<string[]>([]);

  const fill = useRef(new Animated.Value(0)).current;
  const toast = useRef(new Animated.Value(0)).current;
  const coinPulse = useRef(new Animated.Value(1)).current;
  const btnScale = useRef(new Animated.Value(1)).current;
  const countPop = useRef(new Animated.Value(1)).current;
  const rainbow = useRef(new Animated.Value(0)).current;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load saved data once when the app opens
  useEffect(() => {
    const load = async () => {
      try {
        const saved = await AsyncStorage.getItem(STORAGE_KEY);
        if (saved) {
          const data = JSON.parse(saved);
          const savedCount: number = data.count ?? 0;
          const savedRounds: number = data.rounds ?? 0;

          // A wheel prize that was not paid yet (the app closed while the wheel was spinning)
          const pendingPrize: number =
            typeof data.wheelPending === "number" && data.wheelPending > 0 ? data.wheelPending : 0;
          setCoins((data.coins ?? 0) + pendingPrize);
          setWheelPending(0);
          setWheelSpins(data.wheelSpins ?? 0);
          setWheelNet(data.wheelNet ?? 0);

          setDiamonds(data.diamonds ?? 0);
          setBoostDate(typeof data.boostDate === "string" ? data.boostDate : "");

          // App settings
          if (data.lang === "fa" || data.lang === "en") setLang(data.lang);
          if (data.darkSetting === "system" || data.darkSetting === "light" || data.darkSetting === "dark") {
            setDarkSetting(data.darkSetting);
          }

          // Shop data (only keep ids that still exist)
          const ot: string[] = Array.isArray(data.ownedThemes)
            ? data.ownedThemes.filter((id: string) => THEMES.some((t) => t.id === id))
            : [];
          const finalThemes = ot.includes("green") ? ot : ["green", ...ot];
          setOwnedThemes(finalThemes);
          setActiveTheme(finalThemes.includes(data.activeTheme) ? data.activeTheme : "green");

          const ob: string[] = Array.isArray(data.ownedButtons)
            ? data.ownedButtons.filter((id: string) => BUTTONS.some((b) => b.id === id))
            : [];
          const finalButtons = ob.includes("default") ? ob : ["default", ...ob];
          setOwnedButtons(finalButtons);
          setActiveButton(finalButtons.includes(data.activeButton) ? data.activeButton : "default");

          // Daily quests: keep the saved progress only if it is from today
          const lastDayCount: number = data.dailyCount ?? 0;
          if (data.dailyDate === todayKey()) {
            setDailyDate(data.dailyDate);
            setDailyCount(lastDayCount);
            setDailyClaimed(Array.isArray(data.dailyClaimed) ? data.dailyClaimed : []);
          }

          // History of every day (also adds the last saved day)
          const hist: Record<string, number> = {};
          if (data.history && typeof data.history === "object") {
            Object.keys(data.history).forEach((k) => {
              if (typeof data.history[k] === "number") hist[k] = data.history[k];
            });
          }
          if (typeof data.dailyDate === "string" && lastDayCount > (hist[data.dailyDate] ?? 0)) {
            hist[data.dailyDate] = lastDayCount;
          }
          setHistory(hist);

          // Rank data: salavat of every hour and the rank that was last announced
          const hr: Record<string, number> = {};
          if (data.hourly && typeof data.hourly === "object") {
            Object.keys(data.hourly).forEach((k) => {
              if (typeof data.hourly[k] === "number") hr[k] = data.hourly[k];
            });
          }
          setHourly(hr);
          setPeakRank(typeof data.peakRank === "number" ? data.peakRank : 0);
          if (typeof data.lastRank === "number") {
            setLastRank(data.lastRank);
            rankSeenRef.current = data.lastRank;
          }

          // Record: also counts the last saved day (for data saved before records existed)
          const savedBest: number = data.bestDaily ?? 0;
          if (lastDayCount > savedBest) {
            setBestDaily(lastDayCount);
            setBestDate(data.dailyDate ?? "");
          } else {
            setBestDaily(savedBest);
            setBestDate(data.bestDate ?? "");
          }

          // Achievements data
          setTotalSalavat(
            Math.max(data.totalSalavat ?? 0, savedRounds * MAX + savedCount, lastDayCount)
          );
          if (typeof data.goalDays === "number") {
            setGoalDays(data.goalDays);
            setStreak(data.streak ?? 0);
            setBestStreak(data.bestStreak ?? 0);
            setLastGoalDate(data.lastGoalDate ?? "");
          } else if (data.dailyDate && lastDayCount >= ACH_DAILY_GOAL) {
            // Data saved before achievements existed: count the last saved day
            setGoalDays(1);
            setStreak(1);
            setBestStreak(1);
            setLastGoalDate(data.dailyDate);
          }
          setRecordsBroken(data.recordsBroken ?? 0);
          setPerfectDays(data.perfectDays ?? 0);

          const ac: string[] = Array.isArray(data.achClaimed)
            ? data.achClaimed.filter((id: string) => ACHIEVEMENTS.some((a) => a.id === id))
            : [];
          achClaimedRef.current = ac;
          setAchClaimed(ac);

          if (savedCount >= MAX) {
            // App was closed right at the end of a round: start a new one
            setCount(0);
            setClaimed([]);
            setRounds(savedRounds + 1);
          } else {
            setCount(savedCount);
            setRounds(savedRounds);
            setClaimed(
              Array.isArray(data.claimed)
                ? data.claimed
                : MILESTONES.filter((m) => savedCount >= m)
            );
          }
        }
      } catch (e) {
        console.warn("Failed to load data", e);
      } finally {
        setNowHour(nowHourIndex());
        setLoaded(true);
      }
    };
    load();

    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  // Notice when a new day or a new hour starts (app comes back to the screen, or time passes)
  useEffect(() => {
    const refresh = () => {
      setToday(todayKey());
      setNowHour(nowHourIndex());
    };
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") refresh();
    });
    const id = setInterval(refresh, 60000);
    return () => {
      sub.remove();
      clearInterval(id);
    };
  }, []);

  // Save automatically after every change
  useEffect(() => {
    if (!loaded) return;
    AsyncStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        count,
        coins,
        diamonds,
        rounds,
        claimed,
        ownedThemes,
        activeTheme,
        ownedButtons,
        activeButton,
        boostDate,
        dailyDate,
        dailyCount,
        dailyClaimed,
        history,
        hourly,
        lastRank,
        peakRank,
        wheelPending,
        wheelSpins,
        wheelNet,
        bestDaily,
        bestDate,
        totalSalavat,
        goalDays,
        streak,
        bestStreak,
        lastGoalDate,
        recordsBroken,
        perfectDays,
        achClaimed,
        lang,
        darkSetting,
      })
    ).catch((e: unknown) => console.warn("Failed to save data", e));
  }, [
    count,
    coins,
    diamonds,
    rounds,
    claimed,
    ownedThemes,
    activeTheme,
    ownedButtons,
    activeButton,
    boostDate,
    dailyDate,
    dailyCount,
    dailyClaimed,
    history,
    hourly,
    lastRank,
    peakRank,
    wheelPending,
    wheelSpins,
    wheelNet,
    bestDaily,
    bestDate,
    totalSalavat,
    goalDays,
    streak,
    bestStreak,
    lastGoalDate,
    recordsBroken,
    perfectDays,
    achClaimed,
    lang,
    darkSetting,
    loaded,
  ]);

  // Smoothly animate the progress bar
  const progress = Math.min(count / MAX, 1);
  useEffect(() => {
    Animated.timing(fill, {
      toValue: progress,
      duration: 250,
      useNativeDriver: false,
    }).start();
  }, [progress, fill]);

  const fillWidth = fill.interpolate({
    inputRange: [0, 1],
    outputRange: ["0%", "100%"],
  });

  // Rainbow button animation (runs only while that button is selected)
  const isRainbow = activeButton === "rainbow";
  useEffect(() => {
    if (!isRainbow) return;
    rainbow.setValue(0);
    const loop = Animated.loop(
      Animated.timing(rainbow, {
        toValue: 1,
        duration: 8000,
        easing: Easing.linear,
        useNativeDriver: false,
      })
    );
    loop.start();
    return () => loop.stop();
  }, [isRainbow, rainbow]);

  const rainbowSolid = rainbow.interpolate({ inputRange: RAINBOW_STEPS, outputRange: RAINBOW });
  const rainbowRing1 = rainbow.interpolate({
    inputRange: RAINBOW_STEPS,
    outputRange: RAINBOW.map((c) => hexToRgba(c, 0.1)),
  });
  const rainbowRing2 = rainbow.interpolate({
    inputRange: RAINBOW_STEPS,
    outputRange: RAINBOW.map((c) => hexToRgba(c, 0.18)),
  });

  // Current language and look
  const L = T[lang];
  const isDark = darkSetting === "dark" || (darkSetting === "system" && systemScheme === "dark");
  const baseTheme = THEMES.find((t) => t.id === activeTheme) ?? THEMES[0];
  const theme = isDark ? makeDark(baseTheme) : baseTheme;
  const btn = BUTTONS.find((b) => b.id === activeButton) ?? BUTTONS[0];
  const buttonColor = btn.color ?? theme.primary;
  const buttonPressed = darken(buttonColor, 0.2);
  const hintColor = isDark ? "#8fdcff" : "#1a79b3";

  // Background design of the active theme (only heavenly themes have one).
  // The same design is drawn behind the main screen and behind every panel.
  const patternEl = theme.pattern ? (
    <PatternBackground kind={theme.pattern} color={theme.primary} accent={theme.accent ?? theme.primary} />
  ) : null;

  // Today's quest progress (zero if the saved progress is from an older day)
  const dailyFresh = dailyDate === today;
  const effDailyCount = dailyFresh ? dailyCount : 0;
  const effDailyClaimed = dailyFresh ? dailyClaimed : [];
  const questsDone = QUESTS.filter((q) => effDailyClaimed.includes(q.id)).length;
  const boostActive = boostDate === today;

  // Current rank, from the salavat of the last 24 hours
  const total24 = windowTotal(hourly, nowHour);
  const currentRank = rankIndexFor(total24);
  const rankInfo = RANKS[currentRank];
  const rankName = RANK_NAMES[lang][rankInfo.id];

  // Days of the current week for the chart
  const chartDays: ChartDay[] = weekKeys(today, lang).map((key, i) => {
    const future = key > today;
    const saved = history[key] ?? 0;
    const value = key === today ? Math.max(saved, effDailyCount) : saved;
    return {
      key,
      label: WEEKDAYS[lang][i],
      value: future ? 0 : value,
      isToday: key === today,
      future,
    };
  });

  // Achievements: current numbers, what is unlocked and what can be claimed
  const ownedCount = Math.max(0, ownedThemes.length + ownedButtons.length - 2);
  const stats: Stats = {
    total: totalSalavat,
    goalDays,
    bestStreak,
    bestDaily,
    rounds,
    owned: ownedCount,
    recordsBroken,
    perfectDays,
  };
  const claimableCount = ACHIEVEMENTS.filter(
    (a) => stats[a.stat] >= a.target && !achClaimed.includes(a.id)
  ).length;
  const currentStreak =
    lastGoalDate === today || lastGoalDate === shiftDay(today, -1) ? streak : 0;

  const playRewardAnimation = (pulse: boolean) => {
    toast.setValue(0);
    Animated.sequence([
      Animated.spring(toast, { toValue: 1, useNativeDriver: true, friction: 6 }),
      Animated.delay(1600),
      Animated.timing(toast, { toValue: 0, duration: 300, useNativeDriver: true }),
    ]).start();

    if (pulse) {
      Animated.sequence([
        Animated.timing(coinPulse, { toValue: 1.3, duration: 150, useNativeDriver: true }),
        Animated.timing(coinPulse, { toValue: 1, duration: 150, useNativeDriver: true }),
      ]).start();
    }
  };

  // Rank down happens by itself when time passes: announce it, and remember the highest rank
  useEffect(() => {
    if (!loaded) return;

    const seen = rankSeenRef.current;
    if (seen === null) {
      rankSeenRef.current = currentRank;
      setLastRank(currentRank);
    } else if (currentRank < seen) {
      rankSeenRef.current = currentRank;
      setLastRank(currentRank);
      setToastTitle(L.rankDown(RANK_NAMES[lang][RANKS[currentRank].id]));
      setToastReward(0);
      setToastDiamonds(0);
      playRewardAnimation(false);
    } else if (currentRank > seen) {
      rankSeenRef.current = currentRank;
      setLastRank(currentRank);
    }

    if (currentRank > peakRank) setPeakRank(currentRank);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentRank, loaded]);

  const onTap = () => {
    if (locked) return;

    const next = count + 1;
    setCount(next);

    // Small "pop" on the number
    countPop.setValue(1.18);
    Animated.spring(countPop, { toValue: 1, useNativeDriver: true, friction: 4 }).start();

    let earned = 0;
    const titles: string[] = [];

    // Round goals: reward only the first time in the current round
    const isGoal = MILESTONES.includes(next);
    if (isGoal && !claimed.includes(next)) {
      setClaimed((prev) => [...prev, next]);
      earned += REWARD_PER_GOAL;
      titles.push(next === MAX ? L.roundDone(rounds + 1) : L.goalDone(next));
    }

    // Daily quests: count every salavat of today
    const nowKey = todayKey();
    const baseCount = dailyDate === nowKey ? dailyCount : 0;
    const baseClaimed = dailyDate === nowKey ? dailyClaimed : [];
    const nextDaily = baseCount + 1;

    const newQuests = QUESTS.filter(
      (q) => nextDaily >= q.target && !baseClaimed.includes(q.id)
    );
    newQuests.forEach((q) => {
      earned += q.reward;
      titles.push(L.questToast(q.target));
    });

    setToday(nowKey);
    setDailyDate(nowKey);
    setDailyCount(nextDaily);
    if (newQuests.length > 0) {
      setDailyClaimed([...baseClaimed, ...newQuests.map((q) => q.id)]);
    } else if (dailyDate !== nowKey) {
      setDailyClaimed([]);
    }

    // Remember today's count for the weekly chart (old days are dropped)
    setHistory((prev) => {
      const cutoff = shiftDay(nowKey, -HISTORY_DAYS);
      const kept: Record<string, number> = {};
      Object.keys(prev).forEach((k) => {
        if (k >= cutoff) kept[k] = prev[k];
      });
      kept[nowKey] = nextDaily;
      return kept;
    });

    // Rank: add this salavat to the current hour and see if the rank changed
    const hourNow = nowHourIndex();
    setNowHour(hourNow);
    const rankBefore = rankIndexFor(windowTotal(hourly, hourNow));
    const nextHourly: Record<string, number> = {};
    Object.keys(hourly).forEach((k) => {
      if (Number(k) >= hourNow - 47) nextHourly[k] = hourly[k];
    });
    nextHourly[String(hourNow)] = (nextHourly[String(hourNow)] ?? 0) + 1;
    setHourly(nextHourly);
    const rankAfter = rankIndexFor(windowTotal(nextHourly, hourNow));
    const rankedUp = rankAfter > rankBefore;
    if (rankedUp) {
      rankSeenRef.current = rankAfter;
      setLastRank(rankAfter);
      titles.unshift(L.rankUp(RANK_NAMES[lang][RANKS[rankAfter].id]));
    }

    // Double coins boost (bought with diamonds, valid for one day)
    if (earned > 0 && boostDate === nowKey) {
      earned *= 2;
      titles.push(L.boostWas);
    }

    // Personal record: highest number of salavat in one day
    let recordBroken = false;
    if (nextDaily > bestDaily) {
      // Celebrate once: the first time today's count passes the record of an older day
      if (bestDaily > 0 && bestDate !== nowKey) {
        recordBroken = true;
        titles.unshift(L.recordNew(nextDaily));
      }
      setBestDaily(nextDaily);
      setBestDate(nowKey);
    }

    // ----- Numbers for achievements -----
    const nextTotal = totalSalavat + 1;
    setTotalSalavat(nextTotal);

    let nextGoalDays = goalDays;
    let nextBestStreak = bestStreak;
    if (nextDaily >= ACH_DAILY_GOAL && lastGoalDate !== nowKey) {
      // First time today the daily goal is reached
      const nextStreak = lastGoalDate === shiftDay(nowKey, -1) ? streak + 1 : 1;
      nextGoalDays = goalDays + 1;
      nextBestStreak = Math.max(bestStreak, nextStreak);
      setGoalDays(nextGoalDays);
      setStreak(nextStreak);
      setBestStreak(nextBestStreak);
      setLastGoalDate(nowKey);
    }

    const nextRecords = recordsBroken + (recordBroken ? 1 : 0);
    if (recordBroken) setRecordsBroken(nextRecords);

    const perfectNow =
      baseClaimed.length < QUESTS.length &&
      baseClaimed.length + newQuests.length >= QUESTS.length;
    const nextPerfect = perfectDays + (perfectNow ? 1 : 0);
    if (perfectNow) setPerfectDays(nextPerfect);

    // Did this tap unlock new achievements?
    const nextStats: Stats = {
      total: nextTotal,
      goalDays: nextGoalDays,
      bestStreak: nextBestStreak,
      bestDaily: Math.max(bestDaily, nextDaily),
      rounds: next >= MAX ? rounds + 1 : rounds,
      owned: ownedCount,
      recordsBroken: nextRecords,
      perfectDays: nextPerfect,
    };
    const before = unlockedIds(stats);
    const after = unlockedIds(nextStats);
    const newAchievements = ACHIEVEMENTS.filter((a) => after.includes(a.id) && !before.includes(a.id));
    newAchievements.forEach((a) => titles.push(L.achNew(ACH_TEXT[lang][a.id].name)));

    // Pay the rewards and show one popup for everything that happened on this tap
    const diamondsEarned = recordBroken ? DIAMOND_PER_RECORD : 0;
    const celebrate = earned > 0 || recordBroken || rankedUp || newAchievements.length > 0;
    if (celebrate) {
      if (earned > 0) setCoins((c) => c + earned);
      if (diamondsEarned > 0) setDiamonds((d) => d + diamondsEarned);
      setToastTitle(titles.join("\n"));
      setToastReward(earned);
      setToastDiamonds(diamondsEarned);
      playRewardAnimation(true);
    }

    if (next >= MAX) {
      // End of the round: show the full bar for a moment, then start over
      Vibration.vibrate([0, 300, 100, 300, 100, 300]);
      setLocked(true);
      timer.current = setTimeout(() => {
        setCount(0);
        setClaimed([]);
        setRounds((r) => r + 1);
        setLocked(false);
      }, ROUND_END_DELAY);
    } else if (celebrate) {
      Vibration.vibrate([0, 200, 100, 200]);
    } else {
      Vibration.vibrate(15);
    }
  };

  // Spin the lucky wheel: pay WHEEL_COST now, get the prize when the wheel stops
  const spinWheel = () => {
    if (spinning) return;
    if (coins < WHEEL_COST) {
      Alert.alert(
        L.notEnoughTitle(L.unitCoin),
        L.notEnoughMsg(WHEEL_COST, L.unitCoin, WHEEL_COST - coins)
      );
      return;
    }

    // The winning slice is chosen first, then the wheel is turned to stop on it
    const index = pickSegment();
    const mult = WHEEL_SEGMENTS[index].mult;
    const payout = Math.round(WHEEL_COST * mult);

    setCoins((c) => c - WHEEL_COST);
    setWheelPending(payout);
    setWheelResult(null);
    setSpinning(true);

    // Where to stop: the middle of the winning slice (a little random) under the pointer at the top
    const segAngle = 360 / WHEEL_SEGMENTS.length;
    const center = index * segAngle + segAngle / 2;
    const jitter = (Math.random() - 0.5) * segAngle * 0.7;
    const current = spinDeg.current;
    const extra = (((-(center + jitter) - current) % 360) + 360) % 360;
    const target = current + 360 * (5 + Math.floor(Math.random() * 3)) + extra;

    Animated.timing(spinAnim, {
      toValue: target,
      duration: WHEEL_DURATION,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start(() => {
      spinDeg.current = target;

      setCoins((c) => c + payout);
      setWheelPending(0);
      setWheelSpins((s) => s + 1);
      setWheelNet((n) => n + payout - WHEEL_COST);
      setWheelResult({ mult, payout });
      setSpinning(false);

      setToastTitle(L.wheelToast(mult));
      setToastReward(payout);
      setToastDiamonds(0);
      playRewardAnimation(payout > 0);

      if (payout > WHEEL_COST) Vibration.vibrate([0, 200, 100, 200, 100, 300]);
      else Vibration.vibrate([0, 120]);
    });
  };

  // Claim the diamond of an unlocked achievement (only once per achievement)
  const claimAchievement = (id: string) => {
    const a = ACHIEVEMENTS.find((x) => x.id === id);
    if (!a) return;
    if (achClaimedRef.current.includes(id)) return;
    if (stats[a.stat] < a.target) return;

    achClaimedRef.current = [...achClaimedRef.current, id];
    setAchClaimed(achClaimedRef.current);
    setDiamonds((d) => d + ACH_REWARD);
    Vibration.vibrate([0, 60, 40, 60]);
  };

  const reset = () => {
    if (locked) return;
    Alert.alert(L.resetTitle, L.resetMsg, [
      { text: L.cancel, style: "cancel" },
      { text: L.yes, style: "destructive", onPress: () => setCount(0) },
    ]);
  };

  // Buy an item (theme or button color) with coins or diamonds
  const buy = (
    kind: "theme" | "button",
    id: string,
    name: string,
    currency: "coins" | "diamonds",
    price: number
  ) => {
    const balance = currency === "coins" ? coins : diamonds;
    const unit = currency === "coins" ? L.unitCoin : L.unitDiamond;

    if (balance < price) {
      Alert.alert(L.notEnoughTitle(unit), L.notEnoughMsg(price, unit, price - balance));
      return;
    }
    Alert.alert(L.buyWord, L.buyConfirm(name, price, unit), [
      { text: L.cancel, style: "cancel" },
      {
        text: L.buyWord,
        onPress: () => {
          if (currency === "coins") setCoins((c) => Math.max(0, c - price));
          else setDiamonds((d) => Math.max(0, d - price));

          if (kind === "theme") {
            setOwnedThemes((p) => [...p, id]);
            setActiveTheme(id);
          } else {
            setOwnedButtons((p) => [...p, id]);
            setActiveButton(id);
          }
        },
      },
    ]);
  };

  // Buy "double coins for today"
  const buyBoost = () => {
    if (boostDate === todayKey()) {
      Alert.alert(L.boostActiveTitle, L.boostActiveMsg);
      return;
    }
    if (diamonds < DIAMOND_PRICE) {
      Alert.alert(
        L.notEnoughTitle(L.unitDiamond),
        L.notEnoughMsg(DIAMOND_PRICE, L.unitDiamond, DIAMOND_PRICE - diamonds)
      );
      return;
    }
    Alert.alert(L.buyWord, L.boostConfirm(DIAMOND_PRICE), [
      { text: L.cancel, style: "cancel" },
      {
        text: L.buyWord,
        onPress: () => {
          setDiamonds((d) => Math.max(0, d - DIAMOND_PRICE));
          setBoostDate(todayKey());
        },
      },
    ]);
  };

  if (!loaded) {
    return <View style={[styles.container, { backgroundColor: theme.bg }]} />;
  }

  const nextMilestone = MILESTONES.find((m) => count < m);
  const coinAffordable = coins >= ITEM_PRICE;
  const heavenlyAffordable = coins >= HEAVENLY_PRICE;
  const diamondAffordable = diamonds >= DIAMOND_PRICE;
  const walletText = `🪙 ${coins}   💎 ${diamonds}${boostActive ? "   ⚡" : ""}`;

  // Shop lists
  const heavenlyThemes = THEMES.filter((t) => t.rarity === "heavenly");
  const diamondThemes = THEMES.filter((t) => t.premium);
  const coinThemes = THEMES.filter((t) => !t.premium && t.rarity !== "heavenly");
  const diamondButtons = BUTTONS.filter((b) => b.premium);
  const coinButtons = BUTTONS.filter((b) => !b.premium);

  // Wheel screen: chances of every slice, from the smallest prize to the biggest
  const oddsList = [...WHEEL_SEGMENTS].sort((a, b) => a.mult - b.mult);
  const wheelSize = 280;
  const resultNet = wheelResult ? wheelResult.payout - WHEEL_COST : 0;
  const resultColor =
    resultNet > 0 ? "#22c55e" : resultNet === 0 ? theme.primary : "#ef4444";

  const statusText = locked
    ? L.newRound
    : nextMilestone
    ? L.untilGoal(nextMilestone, nextMilestone - count, claimed.includes(nextMilestone))
    : "";

  // Record card texts
  const recordIsToday = bestDaily > 0 && bestDate === today;
  const recordPct = bestDaily > 0 ? Math.min(effDailyCount / bestDaily, 1) * 100 : 0;
  const recordHint =
    bestDaily === 0
      ? L.recordHintNone
      : recordIsToday
      ? L.recordHintToday
      : L.recordHintRemain(bestDaily - effDailyCount + 1);

  // Rank screen numbers
  const nextRank = RANKS[currentRank + 1];
  const rankPct = nextRank
    ? Math.min((total24 - rankInfo.min) / (nextRank.min - rankInfo.min), 1) * 100
    : 100;
  const thisHour = hourly[String(nowHour)] ?? 0;
  const expireNext = hourly[String(nowHour - (RANK_WINDOW_HOURS - 1))] ?? 0;
  const drop = dropInfo(hourly, nowHour, currentRank);
  const avgPerHour = (total24 / RANK_WINDOW_HOURS).toFixed(1);

  return (
    <View style={[styles.container, { backgroundColor: theme.bg }]}>
      <StatusBar barStyle={isDark ? "light-content" : "dark-content"} />

      {/* Pattern of the theme (heavenly themes) */}
      {patternEl}

      {/* Soft background circles */}
      <View pointerEvents="none" style={[styles.deco1, { backgroundColor: `${theme.primary}14` }]} />
      <View pointerEvents="none" style={[styles.deco2, { backgroundColor: `${buttonColor}12` }]} />

      {/* Top: progress card + wallet + shop + quests */}
      <View style={styles.topBar}>
        <View style={[styles.card, shadow("#000000", 5), { backgroundColor: theme.card }]}>
          <View style={styles.labelsRow}>
            {MILESTONES.map((m) => {
              const done = claimed.includes(m);
              return (
                <View
                  key={m}
                  style={[styles.markerLabel, { left: `${(m / MAX) * 100}%` }]}
                >
                  <Text
                    style={[
                      styles.markerText,
                      {
                        color: done ? theme.primary : theme.muted,
                        fontWeight: done ? "bold" : "normal",
                      },
                    ]}
                  >
                    {done ? "✓ " : ""}
                    {m}
                  </Text>
                </View>
              );
            })}
          </View>

          <View style={styles.trackWrapper}>
            <View style={[styles.track, { backgroundColor: theme.track }]}>
              <Animated.View
                style={[styles.fill, { width: fillWidth, backgroundColor: theme.primary }]}
              />
            </View>
            {MILESTONES.map((m) => (
              <View
                key={m}
                style={[
                  styles.dot,
                  {
                    left: `${(m / MAX) * 100}%`,
                    borderColor: theme.card,
                    backgroundColor: claimed.includes(m) ? theme.primary : theme.muted,
                  },
                ]}
              />
            ))}
          </View>
        </View>

        <View style={styles.badgeRow}>
          <Animated.View
            style={[
              styles.coinBadge,
              shadow(GOLD, 4),
              { backgroundColor: theme.badgeBg, borderColor: GOLD, transform: [{ scale: coinPulse }] },
            ]}
          >
            <Text style={[styles.coinText, { color: theme.badgeText }]}>{walletText}</Text>
          </Animated.View>

          <Pressable
            onPress={() => setShopOpen(true)}
            style={[styles.pillButton, shadow("#000000", 3), { backgroundColor: theme.card, borderColor: theme.primary }]}
          >
            <Text style={[styles.pillButtonText, { color: theme.primary }]}>{L.shopBtn}</Text>
          </Pressable>

          <View>
            <Pressable
              onPress={() => setQuestsOpen(true)}
              style={[
                styles.pillButton,
                shadow("#000000", 3),
                {
                  backgroundColor: questsDone === QUESTS.length ? theme.primary : theme.card,
                  borderColor: theme.primary,
                },
              ]}
            >
              <Text
                style={[
                  styles.pillButtonText,
                  { color: questsDone === QUESTS.length ? "#ffffff" : theme.primary },
                ]}
              >
                🎯 {questsDone}/{QUESTS.length}
              </Text>
            </Pressable>
            {claimableCount > 0 && (
              <View pointerEvents="none" style={styles.notifyBadge}>
                <Text style={styles.notifyText}>{claimableCount}</Text>
              </View>
            )}
          </View>
        </View>
      </View>

      {/* Reward popup */}
      <Animated.View
        pointerEvents="none"
        style={[
          styles.toast,
          shadow("#000000", 8),
          {
            backgroundColor: theme.primary,
            opacity: toast,
            transform: [
              {
                translateY: toast.interpolate({
                  inputRange: [0, 1],
                  outputRange: [16, 0],
                }),
              },
              {
                scale: toast.interpolate({
                  inputRange: [0, 1],
                  outputRange: [0.85, 1],
                }),
              },
            ],
          },
        ]}
      >
        <Text style={styles.toastTitle}>{toastTitle}</Text>
        {toastReward > 0 && <Text style={styles.toastReward}>{L.coinsPlus(toastReward)}</Text>}
        {toastDiamonds > 0 && <Text style={styles.toastDiamond}>{L.diamondsPlus(toastDiamonds)}</Text>}
      </Animated.View>

      {/* Center: title, button, status */}
      <View style={styles.center}>
        <View style={styles.titleRow}>
          <Pressable
            onPress={() => setWheelOpen(true)}
            style={[
              styles.gearLeft,
              shadow("#000000", 3),
              { backgroundColor: theme.card, borderColor: theme.primary },
            ]}
          >
            <Text style={styles.gearText}>🎡</Text>
          </Pressable>
          <Text style={[styles.title, { color: theme.primary }, lang === "en" && styles.titleEn]}>
            {L.appTitle}
          </Text>
          <Pressable
            onPress={() => setSettingsOpen(true)}
            style={[
              styles.gear,
              shadow("#000000", 3),
              { backgroundColor: theme.card, borderColor: theme.primary },
            ]}
          >
            <Text style={styles.gearText}>⚙️</Text>
          </Pressable>
        </View>
        <View style={[styles.phraseChip, { backgroundColor: `${theme.primary}14` }]}>
          <Text style={[styles.phrase, { color: theme.sub }]}>اللهم صل علی محمد و آل محمد</Text>
        </View>

        <View style={styles.buttonWrap}>
          {isRainbow ? (
            <>
              <Animated.View style={[styles.ringOuter, { backgroundColor: rainbowRing1 }]} />
              <Animated.View style={[styles.ringMid, { backgroundColor: rainbowRing2 }]} />
            </>
          ) : (
            <>
              <View style={[styles.ringOuter, { backgroundColor: `${buttonColor}1a` }]} />
              <View style={[styles.ringMid, { backgroundColor: `${buttonColor}2e` }]} />
            </>
          )}
          <Animated.View style={{ transform: [{ scale: btnScale }] }}>
            <Pressable
              onPress={onTap}
              onPressIn={() =>
                Animated.spring(btnScale, { toValue: 0.94, useNativeDriver: true, friction: 6 }).start()
              }
              onPressOut={() =>
                Animated.spring(btnScale, { toValue: 1, useNativeDriver: true, friction: 4 }).start()
              }
              style={({ pressed }) => [
                styles.bigButton,
                shadow(buttonColor, 12),
                { backgroundColor: pressed && !isRainbow ? buttonPressed : buttonColor },
              ]}
            >
              {({ pressed }) => (
                <>
                  {isRainbow && (
                    <Animated.View style={[styles.rainbowFill, { backgroundColor: rainbowSolid }]} />
                  )}
                  {isRainbow && pressed && <View style={styles.pressedShade} />}
                  <View style={styles.innerRing} />
                  <View style={styles.gloss} />
                  <Animated.Text style={[styles.count, { transform: [{ scale: countPop }] }]}>
                    {count}
                  </Animated.Text>
                  <Text style={styles.of}>{L.unit}</Text>
                </>
              )}
            </Pressable>
          </Animated.View>
        </View>

        {statusText !== "" && (
          <View style={[styles.statusChip, shadow("#000000", 3), { backgroundColor: theme.card }]}>
            <Text style={[styles.status, { color: theme.text }]}>{statusText}</Text>
          </View>
        )}

        <View style={styles.bottomRow}>
          <View style={[styles.roundsChip, { backgroundColor: `${theme.primary}1a` }]}>
            <Text style={[styles.rounds, { color: theme.primary }]}>{L.roundsLabel(rounds)}</Text>
          </View>

          <Pressable
            onPress={() => setRankOpen(true)}
            style={[
              styles.rankChip,
              { backgroundColor: `${rankInfo.color}26`, borderColor: rankInfo.color },
            ]}
          >
            <Text style={[styles.rankChipText, { color: theme.text }]}>
              {rankInfo.icon} {rankName}
            </Text>
          </Pressable>

          <Pressable onPress={reset} style={styles.resetButton}>
            <Text style={styles.resetText}>{L.resetBtn}</Text>
          </Pressable>
        </View>
      </View>

      {/* Lucky wheel */}
      <Modal visible={wheelOpen} animationType="slide" onRequestClose={() => setWheelOpen(false)}>
        <View style={[styles.shop, { backgroundColor: theme.bg }]}>
          {patternEl}
          <View style={styles.shopHeader}>
            <Text style={[styles.shopTitle, { color: theme.text }]}>{L.wheelTitle}</Text>
            <Pressable
              onPress={() => setWheelOpen(false)}
              style={[styles.closeButton, { backgroundColor: theme.card }, shadow("#000000", 2)]}
            >
              <Text style={[styles.closeText, { color: theme.primary }]}>{L.close}</Text>
            </Pressable>
          </View>

          <ScrollView contentContainerStyle={styles.shopContent}>
            <View
              style={[
                styles.coinBadge,
                styles.wheelCoins,
                shadow(GOLD, 4),
                { backgroundColor: theme.badgeBg, borderColor: GOLD },
              ]}
            >
              <Text style={[styles.coinText, { color: theme.badgeText }]}>
                {L.walletLine(coins, diamonds)}
              </Text>
            </View>

            <Text style={[styles.wheelNote, { color: theme.sub }]}>{L.wheelNote(WHEEL_COST)}</Text>

            {/* The wheel with its pointer */}
            <View style={[styles.wheelWrap, { width: wheelSize + 28, height: wheelSize + 34 }]}>
              <View
                style={[
                  styles.wheelRing,
                  shadow("#000000", 10),
                  { width: wheelSize + 16, height: wheelSize + 16, borderRadius: (wheelSize + 16) / 2 },
                ]}
              >
                <Wheel size={wheelSize} rotation={spinAnim} />
                <View style={styles.wheelHub}>
                  <Text style={styles.wheelHubText}>🪙</Text>
                </View>
              </View>
              <View
                style={[styles.wheelPointer, { left: (wheelSize + 28) / 2 - 13 }]}
                pointerEvents="none"
              />
            </View>

            <Pressable
              disabled={spinning}
              onPress={spinWheel}
              style={[
                styles.spinButton,
                shadow(GOLD, 6),
                { backgroundColor: spinning ? theme.track : GOLD },
              ]}
            >
              <Text style={[styles.spinButtonText, { color: spinning ? theme.muted : COIN_BUY.text }]}>
                {spinning ? L.wheelSpinning : L.wheelSpinBtn(WHEEL_COST)}
              </Text>
            </Pressable>

            {wheelResult && !spinning && (
              <View
                style={[
                  styles.resultCard,
                  { backgroundColor: theme.card, borderColor: resultColor },
                ]}
              >
                <Text style={[styles.resultText, { color: theme.text }]}>
                  {L.wheelResult(wheelResult.mult, wheelResult.payout, WHEEL_COST)}
                </Text>
              </View>
            )}

            <View style={styles.statsRow}>
              <View style={[styles.statBox, { backgroundColor: `${theme.primary}14` }]}>
                <Text style={[styles.statValue, { color: theme.primary }]}>{wheelSpins}</Text>
                <Text style={[styles.statLabel, { color: theme.sub }]}>{L.wheelSpinsLabel}</Text>
              </View>
              <View style={[styles.statBox, { backgroundColor: `${theme.primary}14` }]}>
                <Text
                  style={[
                    styles.statValue,
                    { color: wheelNet > 0 ? "#22c55e" : wheelNet < 0 ? "#ef4444" : theme.primary },
                  ]}
                >
                  {wheelNet > 0 ? "+" : ""}
                  {wheelNet}
                </Text>
                <Text style={[styles.statLabel, { color: theme.sub }]}>{L.wheelNetLabel}</Text>
              </View>
            </View>

            {/* Chances of every slice */}
            <View style={[styles.oddsCard, shadow("#000000", 3), { backgroundColor: theme.card }]}>
              <Text style={[styles.oddsTitle, { color: theme.text }]}>{L.wheelOddsTitle}</Text>
              {oddsList.map((seg) => (
                <View key={seg.mult} style={styles.oddsRow}>
                  <View style={[styles.oddsDot, { backgroundColor: seg.color }]} />
                  <Text style={[styles.oddsMult, { color: theme.text }]}>×{seg.mult}</Text>
                  <Text style={[styles.oddsPayout, { color: theme.sub }]}>
                    {Math.round(WHEEL_COST * seg.mult)} 🪙
                  </Text>
                  <Text style={[styles.oddsChance, { color: theme.primary }]}>
                    {Number(((seg.weight / WHEEL_TOTAL_WEIGHT) * 100).toFixed(1))}%
                  </Text>
                </View>
              ))}
              <Text style={[styles.oddsEv, { color: theme.muted }]}>{L.wheelEv(WHEEL_EV_PERCENT)}</Text>
            </View>
          </ScrollView>
        </View>
      </Modal>

      {/* Rank */}
      <Modal visible={rankOpen} animationType="slide" onRequestClose={() => setRankOpen(false)}>
        <View style={[styles.shop, { backgroundColor: theme.bg }]}>
          {patternEl}
          <View style={styles.shopHeader}>
            <Text style={[styles.shopTitle, { color: theme.text }]}>{L.rankTitle}</Text>
            <Pressable
              onPress={() => setRankOpen(false)}
              style={[styles.closeButton, { backgroundColor: theme.card }, shadow("#000000", 2)]}
            >
              <Text style={[styles.closeText, { color: theme.primary }]}>{L.close}</Text>
            </Pressable>
          </View>

          <ScrollView contentContainerStyle={styles.shopContent}>
            {/* Current rank */}
            <View
              style={[
                styles.rankCard,
                shadow(rankInfo.color, 6),
                { backgroundColor: theme.card, borderColor: rankInfo.color },
              ]}
            >
              <Text style={styles.rankIcon}>{rankInfo.icon}</Text>
              <Text style={[styles.rankName, { color: rankInfo.color }]}>{rankName}</Text>

              <Text style={[styles.rankTotal, { color: theme.text }]}>{total24}</Text>
              <Text style={[styles.rankTotalLabel, { color: theme.sub }]}>{L.rank24h}</Text>

              <View style={[styles.questTrack, styles.rankTrack, { backgroundColor: theme.track }]}>
                <View
                  style={[styles.questFill, { width: `${rankPct}%`, backgroundColor: rankInfo.color }]}
                />
              </View>
              <Text style={[styles.rankNext, { color: theme.text }]}>
                {nextRank
                  ? L.rankToNext(nextRank.min - total24, RANK_NAMES[lang][nextRank.id])
                  : L.rankTop}
              </Text>
            </View>

            {/* Small numbers */}
            <View style={styles.rankStats}>
              <View style={[styles.statBox, { backgroundColor: `${theme.primary}14` }]}>
                <Text style={[styles.statValue, { color: theme.primary }]}>{avgPerHour}</Text>
                <Text style={[styles.statLabel, { color: theme.sub }]}>{L.rankAvg}</Text>
              </View>
              <View style={[styles.statBox, { backgroundColor: `${theme.primary}14` }]}>
                <Text style={[styles.statValue, { color: theme.primary }]}>{thisHour}</Text>
                <Text style={[styles.statLabel, { color: theme.sub }]}>{L.rankThisHour}</Text>
              </View>
              <View style={[styles.statBox, { backgroundColor: `${theme.primary}14` }]}>
                <Text style={[styles.statValue, { color: theme.primary }]}>
                  {RANKS[peakRank].icon}
                </Text>
                <Text style={[styles.statLabel, { color: theme.sub }]}>
                  {L.rankPeak}: {RANK_NAMES[lang][RANKS[peakRank].id]}
                </Text>
              </View>
            </View>

            {/* What will happen if nothing is said */}
            <View
              style={[
                styles.decayCard,
                { backgroundColor: theme.card, borderColor: drop ? "#e8730c" : theme.primary },
              ]}
            >
              <Text style={[styles.decayText, { color: theme.text }]}>
                {drop
                  ? L.rankDecay(drop.hours, RANK_NAMES[lang][RANKS[drop.rank].id])
                  : L.rankDecayNone}
              </Text>
              {expireNext > 0 && (
                <Text style={[styles.decaySub, { color: theme.sub }]}>{L.rankExpire(expireNext)}</Text>
              )}
            </View>

            {/* All ranks */}
            <View style={styles.sectionRow}>
              <View style={[styles.sectionBar, { backgroundColor: theme.primary }]} />
              <Text style={[styles.sectionTitle, { color: theme.text }]}>{L.rankLadder}</Text>
            </View>

            {RANKS.map((r, i) => {
              const isCurrent = i === currentRank;
              const reached = i <= currentRank;
              return (
                <View
                  key={r.id}
                  style={[
                    styles.ladderRow,
                    shadow("#000000", 2),
                    {
                      backgroundColor: theme.card,
                      borderColor: isCurrent ? r.color : "transparent",
                      opacity: reached ? 1 : 0.6,
                    },
                  ]}
                >
                  <Text style={styles.ladderIcon}>{r.icon}</Text>
                  <View style={styles.ladderInfo}>
                    <Text style={[styles.ladderName, { color: theme.text }]}>
                      {RANK_NAMES[lang][r.id]}
                    </Text>
                    <Text style={[styles.ladderFrom, { color: theme.sub }]}>{L.rankFrom(r.min)}</Text>
                  </View>
                  {isCurrent ? (
                    <View style={[styles.ladderTag, { backgroundColor: `${r.color}33` }]}>
                      <Text style={[styles.ladderTagText, { color: theme.text }]}>{L.rankYours}</Text>
                    </View>
                  ) : (
                    <Text style={[styles.ladderMark, { color: theme.muted }]}>{reached ? "✓" : "🔒"}</Text>
                  )}
                </View>
              );
            })}

            <Text style={[styles.rankNote, { color: theme.sub }]}>{L.rankNote}</Text>
          </ScrollView>
        </View>
      </Modal>

      {/* Settings: dark mode, language and weekly chart */}
      <Modal visible={settingsOpen} animationType="slide" onRequestClose={() => setSettingsOpen(false)}>
        <View style={[styles.shop, { backgroundColor: theme.bg }]}>
          {patternEl}
          <View style={styles.shopHeader}>
            <Text style={[styles.shopTitle, { color: theme.text }]}>{L.settingsTitle}</Text>
            <Pressable
              onPress={() => setSettingsOpen(false)}
              style={[styles.closeButton, { backgroundColor: theme.card }, shadow("#000000", 2)]}
            >
              <Text style={[styles.closeText, { color: theme.primary }]}>{L.close}</Text>
            </Pressable>
          </View>

          <ScrollView contentContainerStyle={styles.shopContent}>
            <View style={styles.sectionRow}>
              <View style={[styles.sectionBar, { backgroundColor: theme.primary }]} />
              <Text style={[styles.sectionTitle, { color: theme.text }]}>🌓 {L.darkMode}</Text>
            </View>
            <Segmented<DarkSetting>
              options={[
                { id: "system", label: L.modeSystem },
                { id: "light", label: L.modeLight },
                { id: "dark", label: L.modeDark },
              ]}
              value={darkSetting}
              onChange={setDarkSetting}
              theme={theme}
            />

            <View style={styles.sectionRow}>
              <View style={[styles.sectionBar, { backgroundColor: theme.primary }]} />
              <Text style={[styles.sectionTitle, { color: theme.text }]}>🌐 {L.language}</Text>
            </View>
            <Segmented<Lang>
              options={[
                { id: "fa", label: "فارسی" },
                { id: "en", label: "English" },
              ]}
              value={lang}
              onChange={setLang}
              theme={theme}
            />

            <View style={styles.chartSpace} />
            <WeekChart days={chartDays} theme={theme} L={L} />
          </ScrollView>
        </View>
      </Modal>

      {/* Missions: daily quests, record and achievements */}
      <Modal visible={questsOpen} animationType="slide" onRequestClose={() => setQuestsOpen(false)}>
        <View style={[styles.shop, { backgroundColor: theme.bg }]}>
          {patternEl}
          <View style={styles.shopHeader}>
            <Text style={[styles.shopTitle, { color: theme.text }]}>{L.missionsTitle}</Text>
            <Pressable
              onPress={() => setQuestsOpen(false)}
              style={[styles.closeButton, { backgroundColor: theme.card }, shadow("#000000", 2)]}
            >
              <Text style={[styles.closeText, { color: theme.primary }]}>{L.close}</Text>
            </Pressable>
          </View>

          {/* Tabs */}
          <View style={styles.tabRow}>
            <Pressable
              onPress={() => setMissionTab("quests")}
              style={[
                styles.tab,
                {
                  backgroundColor: missionTab === "quests" ? theme.primary : theme.card,
                  borderColor: theme.primary,
                },
              ]}
            >
              <Text
                style={[
                  styles.tabText,
                  { color: missionTab === "quests" ? "#ffffff" : theme.primary },
                ]}
              >
                {L.tabQuests}
              </Text>
            </Pressable>
            <Pressable
              onPress={() => setMissionTab("ach")}
              style={[
                styles.tab,
                {
                  backgroundColor: missionTab === "ach" ? theme.primary : theme.card,
                  borderColor: theme.primary,
                },
              ]}
            >
              <Text
                style={[styles.tabText, { color: missionTab === "ach" ? "#ffffff" : theme.primary }]}
              >
                {L.tabAch(claimableCount)}
              </Text>
            </Pressable>
          </View>

          {missionTab === "quests" ? (
            <ScrollView contentContainerStyle={styles.shopContent}>
              {/* Personal record */}
              <View
                style={[
                  styles.recordCard,
                  shadow(GOLD, 6),
                  { backgroundColor: theme.card, borderColor: GOLD },
                ]}
              >
                <Text style={[styles.recordLabel, { color: theme.badgeText }]}>{L.recordTitle}</Text>
                <Text style={[styles.recordNumber, { color: theme.text }]}>{bestDaily}</Text>
                <Text style={[styles.recordSub, { color: theme.sub }]}>{L.recordSub}</Text>
                {bestDate !== "" && (
                  <Text style={[styles.recordDate, { color: theme.muted }]}>
                    {formatDate(bestDate, lang)}
                  </Text>
                )}

                <View style={[styles.questTrack, styles.recordTrack, { backgroundColor: theme.track }]}>
                  <View style={[styles.questFill, { width: `${recordPct}%`, backgroundColor: GOLD }]} />
                </View>
                <Text style={[styles.recordToday, { color: theme.text }]}>
                  {L.todayCount(effDailyCount)}
                </Text>
                <Text style={[styles.recordHint, { color: theme.sub }]}>{recordHint}</Text>

                <View style={styles.diamondHint}>
                  <Text style={[styles.diamondHintText, { color: hintColor }]}>
                    {L.diamondHint(DIAMOND_PER_RECORD, diamonds)}
                  </Text>
                </View>
              </View>

              {/* Daily quests */}
              <View style={styles.sectionRow}>
                <View style={[styles.sectionBar, { backgroundColor: theme.primary }]} />
                <Text style={[styles.sectionTitle, { color: theme.text }]}>{L.questsSection}</Text>
              </View>
              <Text style={[styles.questNote, { color: theme.sub }]}>{L.questNote}</Text>

              {QUESTS.map((q) => (
                <QuestRow
                  key={q.id}
                  target={q.target}
                  reward={q.reward}
                  progress={effDailyCount}
                  done={effDailyClaimed.includes(q.id)}
                  theme={theme}
                  L={L}
                />
              ))}
            </ScrollView>
          ) : (
            <ScrollView contentContainerStyle={styles.shopContent}>
              {/* Summary */}
              <View
                style={[
                  styles.summaryCard,
                  shadow("#000000", 4),
                  { backgroundColor: theme.card },
                ]}
              >
                <View style={styles.summaryTop}>
                  <Text style={[styles.summaryTitle, { color: theme.text }]}>
                    {L.achSummary(achClaimed.length, ACHIEVEMENTS.length)}
                  </Text>
                  <View style={[styles.summaryDiamond, { backgroundColor: `${DIAMOND}1f` }]}>
                    <Text style={[styles.summaryDiamondText, { color: hintColor }]}>💎 {diamonds}</Text>
                  </View>
                </View>

                <View style={styles.statsRow}>
                  <View style={[styles.statBox, { backgroundColor: `${theme.primary}14` }]}>
                    <Text style={[styles.statValue, { color: theme.primary }]}>{currentStreak}</Text>
                    <Text style={[styles.statLabel, { color: theme.sub }]}>{L.statStreak}</Text>
                  </View>
                  <View style={[styles.statBox, { backgroundColor: `${theme.primary}14` }]}>
                    <Text style={[styles.statValue, { color: theme.primary }]}>{goalDays}</Text>
                    <Text style={[styles.statLabel, { color: theme.sub }]}>
                      {L.statGoalDays(ACH_DAILY_GOAL)}
                    </Text>
                  </View>
                  <View style={[styles.statBox, { backgroundColor: `${theme.primary}14` }]}>
                    <Text style={[styles.statValue, { color: theme.primary }]}>{totalSalavat}</Text>
                    <Text style={[styles.statLabel, { color: theme.sub }]}>{L.statTotal}</Text>
                  </View>
                </View>

                <Text style={[styles.achNote, { color: theme.sub }]}>{L.achNote(ACH_REWARD)}</Text>
              </View>

              {ACHIEVEMENTS.map((a) => (
                <AchievementRow
                  key={a.id}
                  a={a}
                  name={ACH_TEXT[lang][a.id].name}
                  desc={ACH_TEXT[lang][a.id].desc}
                  value={stats[a.stat]}
                  claimed={achClaimed.includes(a.id)}
                  theme={theme}
                  L={L}
                  onClaim={() => claimAchievement(a.id)}
                />
              ))}
            </ScrollView>
          )}
        </View>
      </Modal>

      {/* Shop */}
      <Modal visible={shopOpen} animationType="slide" onRequestClose={() => setShopOpen(false)}>
        <View style={[styles.shop, { backgroundColor: theme.bg }]}>
          {patternEl}
          <View style={styles.shopHeader}>
            <Text style={[styles.shopTitle, { color: theme.text }]}>{L.shopTitle}</Text>
            <Pressable
              onPress={() => setShopOpen(false)}
              style={[styles.closeButton, { backgroundColor: theme.card }, shadow("#000000", 2)]}
            >
              <Text style={[styles.closeText, { color: theme.primary }]}>{L.close}</Text>
            </Pressable>
          </View>

          <View
            style={[
              styles.coinBadge,
              styles.shopCoins,
              shadow(GOLD, 4),
              { backgroundColor: theme.badgeBg, borderColor: GOLD },
            ]}
          >
            <Text style={[styles.coinText, { color: theme.badgeText }]}>
              {L.walletLine(coins, diamonds)}
            </Text>
          </View>

          {/* Legend of the rarity levels */}
          <View style={styles.legend}>
            {RARITY_ORDER.map((r) => (
              <RarityBadge key={r} rarity={r} lang={lang} theme={theme} />
            ))}
          </View>

          <ScrollView contentContainerStyle={styles.shopContent}>
            {/* Heavenly items: themes with a pattern */}
            <View
              style={[
                styles.heavenlySection,
                shadow(HEAVENLY, 8),
                { backgroundColor: `${HEAVENLY}14`, borderColor: HEAVENLY },
              ]}
            >
              <Text style={[styles.diamondTitle, { color: theme.text }]}>{L.heavenlyTitle}</Text>
              <Text style={[styles.diamondNote, { color: theme.sub }]}>
                {L.heavenlyNote(HEAVENLY_PRICE)}
              </Text>

              {heavenlyThemes.map((t) => (
                <HeavenlyRow
                  key={t.id}
                  t={t}
                  name={THEME_NAMES[lang][t.id]}
                  owned={ownedThemes.includes(t.id)}
                  active={activeTheme === t.id}
                  affordable={heavenlyAffordable}
                  theme={theme}
                  lang={lang}
                  L={L}
                  onPress={() =>
                    ownedThemes.includes(t.id)
                      ? setActiveTheme(t.id)
                      : buy("theme", t.id, THEME_NAMES[lang][t.id], "coins", HEAVENLY_PRICE)
                  }
                />
              ))}
            </View>

            {/* Legendary items (diamonds) */}
            <View
              style={[
                styles.diamondSection,
                shadow(DIAMOND, 6),
                { backgroundColor: `${DIAMOND}14`, borderColor: DIAMOND },
              ]}
            >
              <Text style={[styles.diamondTitle, { color: theme.text }]}>{L.diamondTitle}</Text>
              <Text style={[styles.diamondNote, { color: theme.sub }]}>
                {L.diamondNote(DIAMOND_PER_RECORD, ACH_REWARD, DIAMOND_PRICE)}
              </Text>

              <BoostRow
                active={boostActive}
                affordable={diamondAffordable}
                theme={theme}
                L={L}
                onPress={buyBoost}
              />

              {diamondThemes.map((t) => (
                <ShopRow
                  key={t.id}
                  name={THEME_NAMES[lang][t.id]}
                  rarity={t.rarity}
                  swatches={[t.primary, t.bg]}
                  owned={ownedThemes.includes(t.id)}
                  active={activeTheme === t.id}
                  affordable={diamondAffordable}
                  price={DIAMOND_PRICE}
                  icon="💎"
                  buy={DIAMOND_BUY}
                  theme={theme}
                  lang={lang}
                  L={L}
                  onPress={() =>
                    ownedThemes.includes(t.id)
                      ? setActiveTheme(t.id)
                      : buy("theme", t.id, THEME_NAMES[lang][t.id], "diamonds", DIAMOND_PRICE)
                  }
                />
              ))}

              {diamondButtons.map((b) => (
                <ShopRow
                  key={b.id}
                  name={BUTTON_NAMES[lang][b.id]}
                  rarity={b.rarity}
                  swatches={b.id === "rainbow" ? [RAINBOW[0], RAINBOW[4]] : [b.color ?? theme.primary]}
                  owned={ownedButtons.includes(b.id)}
                  active={activeButton === b.id}
                  affordable={diamondAffordable}
                  price={DIAMOND_PRICE}
                  icon="💎"
                  buy={DIAMOND_BUY}
                  theme={theme}
                  lang={lang}
                  L={L}
                  onPress={() =>
                    ownedButtons.includes(b.id)
                      ? setActiveButton(b.id)
                      : buy("button", b.id, BUTTON_NAMES[lang][b.id], "diamonds", DIAMOND_PRICE)
                  }
                />
              ))}
            </View>

            {/* Common and rare items (coins) */}
            <Text style={[styles.priceNote, styles.coinPriceNote, { color: theme.sub }]}>
              {L.coinPriceNote(ITEM_PRICE)}
            </Text>

            <View style={styles.sectionRow}>
              <View style={[styles.sectionBar, { backgroundColor: theme.primary }]} />
              <Text style={[styles.sectionTitle, { color: theme.text }]}>{L.themesTitle}</Text>
            </View>
            {coinThemes.map((t) => (
              <ShopRow
                key={t.id}
                name={THEME_NAMES[lang][t.id]}
                rarity={t.rarity}
                swatches={[t.primary, t.bg]}
                owned={ownedThemes.includes(t.id)}
                active={activeTheme === t.id}
                affordable={coinAffordable}
                price={ITEM_PRICE}
                icon="🪙"
                buy={COIN_BUY}
                theme={theme}
                lang={lang}
                L={L}
                onPress={() =>
                  ownedThemes.includes(t.id)
                    ? setActiveTheme(t.id)
                    : buy("theme", t.id, THEME_NAMES[lang][t.id], "coins", ITEM_PRICE)
                }
              />
            ))}

            <View style={styles.sectionRow}>
              <View style={[styles.sectionBar, { backgroundColor: theme.primary }]} />
              <Text style={[styles.sectionTitle, { color: theme.text }]}>{L.buttonsTitle}</Text>
            </View>
            {coinButtons.map((b) => (
              <ShopRow
                key={b.id}
                name={BUTTON_NAMES[lang][b.id]}
                rarity={b.rarity}
                swatches={[b.color ?? theme.primary]}
                owned={ownedButtons.includes(b.id)}
                active={activeButton === b.id}
                affordable={coinAffordable}
                price={ITEM_PRICE}
                icon="🪙"
                buy={COIN_BUY}
                theme={theme}
                lang={lang}
                L={L}
                onPress={() =>
                  ownedButtons.includes(b.id)
                    ? setActiveButton(b.id)
                    : buy("button", b.id, BUTTON_NAMES[lang][b.id], "coins", ITEM_PRICE)
                }
              />
            ))}
          </ScrollView>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingTop: 52,
    overflow: "hidden",
  },
  patternBox: {
    overflow: "hidden",
  },

  // Background decoration
  deco1: {
    position: "absolute",
    top: -90,
    right: -90,
    width: 260,
    height: 260,
    borderRadius: 130,
  },
  deco2: {
    position: "absolute",
    bottom: -110,
    left: -100,
    width: 300,
    height: 300,
    borderRadius: 150,
  },

  // Top area
  topBar: {
    paddingHorizontal: 20,
  },
  card: {
    borderRadius: 22,
    paddingHorizontal: 30,
    paddingTop: 12,
    paddingBottom: 18,
  },
  labelsRow: {
    height: 26,
    position: "relative",
  },
  markerLabel: {
    position: "absolute",
    width: 60,
    marginLeft: -30,
    alignItems: "center",
  },
  markerText: { fontSize: 14 },
  trackWrapper: {
    height: 22,
    justifyContent: "center",
    position: "relative",
  },
  track: {
    height: 12,
    borderRadius: 6,
    overflow: "hidden",
  },
  fill: { height: 12, borderRadius: 6 },
  dot: {
    position: "absolute",
    top: 2,
    width: 18,
    height: 18,
    marginLeft: -9,
    borderRadius: 9,
    borderWidth: 3,
  },
  badgeRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "center",
    alignItems: "center",
    gap: 8,
    marginTop: 14,
  },
  coinBadge: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
  },
  coinText: { fontSize: 15, fontWeight: "bold" },
  pillButton: {
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1.5,
  },
  pillButtonText: { fontSize: 14, fontWeight: "bold" },
  notifyBadge: {
    position: "absolute",
    top: -7,
    right: -7,
    minWidth: 20,
    height: 20,
    paddingHorizontal: 5,
    borderRadius: 10,
    backgroundColor: "#e53935",
    alignItems: "center",
    justifyContent: "center",
  },
  notifyText: { color: "#fff", fontSize: 12, fontWeight: "bold" },

  // Popup
  toast: {
    position: "absolute",
    top: 250,
    alignSelf: "center",
    alignItems: "center",
    paddingHorizontal: 28,
    paddingVertical: 14,
    borderRadius: 20,
    zIndex: 10,
  },
  toastTitle: { color: "#fff", fontSize: 16, textAlign: "center" },
  toastReward: { color: "#ffe38a", fontSize: 24, fontWeight: "bold", marginTop: 2 },
  toastDiamond: { color: "#9fe3ff", fontSize: 24, fontWeight: "bold", marginTop: 2 },

  // Center
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  titleRow: {
    width: "100%",
    alignItems: "center",
    justifyContent: "center",
  },
  title: { fontSize: 30, fontWeight: "bold" },
  titleEn: { fontSize: 24 },
  gear: {
    position: "absolute",
    right: 20,
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 1.5,
    alignItems: "center",
    justifyContent: "center",
  },
  gearLeft: {
    position: "absolute",
    left: 20,
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 1.5,
    alignItems: "center",
    justifyContent: "center",
  },
  gearText: { fontSize: 18 },
  phraseChip: {
    marginTop: 8,
    paddingHorizontal: 16,
    paddingVertical: 6,
    borderRadius: 16,
  },
  phrase: { fontSize: 16 },
  buttonWrap: {
    width: 264,
    height: 264,
    marginTop: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  ringOuter: {
    position: "absolute",
    width: 264,
    height: 264,
    borderRadius: 132,
  },
  ringMid: {
    position: "absolute",
    width: 244,
    height: 244,
    borderRadius: 122,
  },
  bigButton: {
    width: 216,
    height: 216,
    borderRadius: 108,
    alignItems: "center",
    justifyContent: "center",
  },
  rainbowFill: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: 108,
  },
  pressedShade: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: 108,
    backgroundColor: "rgba(0,0,0,0.15)",
  },
  innerRing: {
    position: "absolute",
    top: 12,
    left: 12,
    width: 192,
    height: 192,
    borderRadius: 96,
    borderWidth: 2,
    borderColor: "rgba(255,255,255,0.28)",
  },
  gloss: {
    position: "absolute",
    top: 16,
    left: 38,
    width: 140,
    height: 64,
    borderRadius: 70,
    backgroundColor: "rgba(255,255,255,0.10)",
  },
  count: {
    fontSize: 68,
    fontWeight: "bold",
    color: "#fff",
    textShadowColor: "rgba(0,0,0,0.25)",
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 4,
  },
  of: { fontSize: 18, color: "rgba(255,255,255,0.85)" },
  statusChip: {
    marginTop: 8,
    paddingHorizontal: 20,
    paddingVertical: 8,
    borderRadius: 18,
  },
  status: { fontSize: 16, textAlign: "center" },
  bottomRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "center",
    alignItems: "center",
    gap: 8,
    marginTop: 14,
    paddingHorizontal: 12,
  },
  roundsChip: {
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 16,
  },
  rounds: { fontSize: 14, fontWeight: "bold" },
  rankChip: {
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 16,
    borderWidth: 1.5,
  },
  rankChipText: { fontSize: 14, fontWeight: "bold" },
  resetButton: {
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "rgba(217,69,58,0.5)",
  },
  resetText: { color: "#d9453a", fontSize: 14 },

  // Shop, missions, rank, wheel and settings (shared panel style)
  shop: { flex: 1, paddingTop: 52, overflow: "hidden" },
  shopHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 24,
  },
  shopTitle: { fontSize: 26, fontWeight: "bold" },
  closeButton: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 16,
  },
  closeText: { fontSize: 16, fontWeight: "bold" },
  shopCoins: { alignSelf: "center", marginTop: 16 },
  priceNote: { textAlign: "center", marginTop: 8, fontSize: 14, paddingHorizontal: 32 },
  coinPriceNote: { marginTop: 18 },
  shopContent: { padding: 20, paddingBottom: 48 },
  sectionRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 14,
    marginBottom: 12,
  },
  sectionBar: { width: 5, height: 22, borderRadius: 3, marginRight: 8 },
  sectionTitle: { fontSize: 20, fontWeight: "bold" },
  row: {
    flexDirection: "row",
    alignItems: "center",
    padding: 12,
    borderRadius: 16,
    borderWidth: 2,
    marginBottom: 12,
  },
  swatches: { flexDirection: "row", gap: 6 },
  swatch: { width: 34, height: 34, borderRadius: 17, borderWidth: 2 },
  rowName: { flex: 1, fontSize: 16, marginHorizontal: 12 },
  rowMid: { flex: 1, marginHorizontal: 12, alignItems: "flex-start", gap: 4 },
  rowTitle: { fontSize: 16 },
  rowButton: {
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 14,
    minWidth: 96,
    alignItems: "center",
  },
  rowButtonText: { fontSize: 14, fontWeight: "bold" },

  // Lucky wheel screen
  wheelCoins: { alignSelf: "center" },
  wheelNote: {
    textAlign: "center",
    fontSize: 14,
    lineHeight: 22,
    marginTop: 12,
    paddingHorizontal: 12,
  },
  wheelWrap: {
    alignSelf: "center",
    alignItems: "center",
    justifyContent: "flex-end",
    marginTop: 12,
  },
  wheelRing: {
    backgroundColor: "#ffc83d",
    alignItems: "center",
    justifyContent: "center",
  },
  wheelHub: {
    position: "absolute",
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: "#ffffff",
    borderWidth: 4,
    borderColor: "#ffc83d",
    alignItems: "center",
    justifyContent: "center",
  },
  wheelHubText: { fontSize: 20 },
  wheelPointer: {
    position: "absolute",
    top: 0,
    width: 0,
    height: 0,
    borderLeftWidth: 13,
    borderRightWidth: 13,
    borderTopWidth: 26,
    borderLeftColor: "transparent",
    borderRightColor: "transparent",
    borderTopColor: "#e53935",
  },
  spinButton: {
    alignSelf: "center",
    marginTop: 18,
    minWidth: 220,
    paddingVertical: 14,
    paddingHorizontal: 28,
    borderRadius: 26,
    alignItems: "center",
  },
  spinButtonText: { fontSize: 18, fontWeight: "bold" },
  resultCard: {
    marginTop: 16,
    padding: 14,
    borderRadius: 16,
    borderWidth: 2,
  },
  resultText: { fontSize: 16, fontWeight: "bold", textAlign: "center", lineHeight: 24 },
  oddsCard: {
    marginTop: 16,
    padding: 16,
    borderRadius: 18,
  },
  oddsTitle: { fontSize: 17, fontWeight: "bold", marginBottom: 10 },
  oddsRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 5,
  },
  oddsDot: { width: 14, height: 14, borderRadius: 7, marginRight: 10 },
  oddsMult: { width: 56, fontSize: 15, fontWeight: "bold" },
  oddsPayout: { flex: 1, fontSize: 14 },
  oddsChance: { fontSize: 14, fontWeight: "bold" },
  oddsEv: { fontSize: 12, lineHeight: 18, marginTop: 10 },

  // Rarity
  rarityBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
    borderWidth: 1,
  },
  rarityText: { fontSize: 11, fontWeight: "bold" },
  legend: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "center",
    gap: 6,
    marginTop: 12,
    paddingHorizontal: 16,
  },
  heavenlySection: {
    borderRadius: 22,
    borderWidth: 2,
    padding: 14,
    marginBottom: 16,
  },
  preview: {
    width: 56,
    height: 56,
    borderRadius: 14,
    borderWidth: 2,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
  },
  previewDot: {
    width: 18,
    height: 18,
    borderRadius: 9,
  },

  // Rank screen
  rankCard: {
    alignItems: "center",
    padding: 20,
    borderRadius: 24,
    borderWidth: 2,
  },
  rankIcon: { fontSize: 64 },
  rankName: { fontSize: 28, fontWeight: "bold", marginTop: 4 },
  rankTotal: { fontSize: 44, fontWeight: "bold", marginTop: 12 },
  rankTotalLabel: { fontSize: 14 },
  rankTrack: { alignSelf: "stretch", marginTop: 16 },
  rankNext: { fontSize: 15, fontWeight: "bold", marginTop: 10, textAlign: "center" },
  rankStats: {
    flexDirection: "row",
    gap: 8,
    marginTop: 14,
  },
  decayCard: {
    marginTop: 14,
    padding: 14,
    borderRadius: 16,
    borderWidth: 1.5,
  },
  decayText: { fontSize: 14, lineHeight: 22 },
  decaySub: { fontSize: 13, lineHeight: 20, marginTop: 6 },
  ladderRow: {
    flexDirection: "row",
    alignItems: "center",
    padding: 12,
    borderRadius: 16,
    borderWidth: 2,
    marginBottom: 10,
  },
  ladderIcon: { fontSize: 26, width: 40 },
  ladderInfo: { flex: 1 },
  ladderName: { fontSize: 16, fontWeight: "bold" },
  ladderFrom: { fontSize: 12, marginTop: 2 },
  ladderTag: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 12,
  },
  ladderTagText: { fontSize: 13, fontWeight: "bold" },
  ladderMark: { fontSize: 16, width: 30, textAlign: "center" },
  rankNote: { fontSize: 13, lineHeight: 21, marginTop: 8 },

  // Settings
  segRow: {
    flexDirection: "row",
    gap: 8,
  },
  seg: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 14,
    borderWidth: 1.5,
    alignItems: "center",
  },
  segText: { fontSize: 15, fontWeight: "bold" },
  chartSpace: { height: 18 },

  // Weekly chart
  chartCard: {
    padding: 16,
    borderRadius: 22,
  },
  chartTitle: { fontSize: 18, fontWeight: "bold", marginBottom: 12 },
  chartRow: {
    flexDirection: "row",
    gap: 6,
  },
  chartCol: {
    flex: 1,
    alignItems: "center",
  },
  chartValue: { fontSize: 11, height: 16 },
  chartBarArea: {
    height: CHART_HEIGHT,
    width: "100%",
    justifyContent: "flex-end",
    alignItems: "center",
  },
  chartBar: {
    width: "70%",
    borderRadius: 8,
  },
  chartLabel: { fontSize: 12, marginTop: 6 },
  chartNote: { fontSize: 12, lineHeight: 18, marginTop: 12 },

  // Tabs
  tabRow: {
    flexDirection: "row",
    gap: 8,
    paddingHorizontal: 24,
    marginTop: 16,
  },
  tab: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 14,
    borderWidth: 1.5,
    alignItems: "center",
  },
  tabText: { fontSize: 15, fontWeight: "bold" },

  // Diamond section
  diamondSection: {
    borderRadius: 22,
    borderWidth: 2,
    padding: 14,
  },
  diamondTitle: { fontSize: 20, fontWeight: "bold" },
  diamondNote: { fontSize: 13, lineHeight: 20, marginTop: 4, marginBottom: 14 },
  boostIcon: {
    backgroundColor: "#fff3c4",
    alignItems: "center",
    justifyContent: "center",
  },
  boostEmoji: { fontSize: 18 },
  boostInfo: { flex: 1, marginHorizontal: 12 },
  boostName: { flex: 0, marginHorizontal: 0 },
  boostDesc: { fontSize: 12, lineHeight: 18, marginTop: 2 },

  // Record card
  recordCard: {
    alignItems: "center",
    padding: 20,
    borderRadius: 22,
    borderWidth: 2,
    marginTop: 4,
  },
  recordLabel: { fontSize: 16, fontWeight: "bold" },
  recordNumber: { fontSize: 56, fontWeight: "bold", marginTop: 4 },
  recordSub: { fontSize: 15 },
  recordDate: { fontSize: 14, marginTop: 4 },
  recordTrack: { alignSelf: "stretch", marginTop: 18 },
  recordToday: { fontSize: 16, fontWeight: "bold", marginTop: 10 },
  recordHint: { fontSize: 14, marginTop: 4, textAlign: "center" },
  diamondHint: {
    marginTop: 14,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 14,
    backgroundColor: `${DIAMOND}1f`,
  },
  diamondHintText: { fontSize: 13, textAlign: "center" },

  // Quest cards
  questNote: { fontSize: 13, marginBottom: 14, lineHeight: 20 },
  questCard: {
    padding: 16,
    borderRadius: 18,
    borderWidth: 2,
    marginBottom: 14,
  },
  questTop: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  questTitle: { fontSize: 18, fontWeight: "bold" },
  rewardChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 14,
  },
  rewardText: { fontSize: 14, fontWeight: "bold" },
  questTrack: {
    height: 10,
    borderRadius: 5,
    overflow: "hidden",
    marginTop: 14,
  },
  questFill: { height: 10, borderRadius: 5 },
  questProgress: { marginTop: 8, fontSize: 14 },

  // Achievements and shared stat boxes
  summaryCard: {
    padding: 16,
    borderRadius: 20,
    marginBottom: 16,
  },
  summaryTop: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  summaryTitle: { fontSize: 18, fontWeight: "bold" },
  summaryDiamond: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 14,
  },
  summaryDiamondText: { fontSize: 16, fontWeight: "bold" },
  statsRow: {
    flexDirection: "row",
    gap: 8,
    marginTop: 14,
  },
  statBox: {
    flex: 1,
    alignItems: "center",
    paddingVertical: 10,
    paddingHorizontal: 4,
    borderRadius: 14,
  },
  statValue: { fontSize: 20, fontWeight: "bold" },
  statLabel: { fontSize: 11, marginTop: 2, textAlign: "center" },
  achNote: { fontSize: 13, marginTop: 14, lineHeight: 20 },

  achCard: {
    flexDirection: "row",
    alignItems: "center",
    padding: 12,
    borderRadius: 18,
    borderWidth: 2,
    marginBottom: 12,
  },
  achIcon: {
    width: 46,
    height: 46,
    borderRadius: 23,
    alignItems: "center",
    justifyContent: "center",
  },
  achEmoji: { fontSize: 24 },
  achEmojiLocked: { opacity: 0.4 },
  achInfo: { flex: 1, marginHorizontal: 10 },
  achName: { fontSize: 16, fontWeight: "bold" },
  achDesc: { fontSize: 12, lineHeight: 18, marginTop: 2 },
  achTrack: {
    height: 6,
    borderRadius: 3,
    overflow: "hidden",
    marginTop: 8,
  },
  achFill: { height: 6, borderRadius: 3 },
  achProgress: { fontSize: 11, marginTop: 4 },
  achButton: {
    paddingHorizontal: 10,
    paddingVertical: 9,
    borderRadius: 14,
    minWidth: 84,
    alignItems: "center",
  },
  achButtonText: { fontSize: 13, fontWeight: "bold" },
});
