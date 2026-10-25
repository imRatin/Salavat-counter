import AsyncStorage from "@react-native-async-storage/async-storage";
import { useEffect, useRef, useState } from "react";
import {
    Alert,
    Animated,
    AppState,
    Easing,
    Modal,
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
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

// Price of every normal shop item (coins).
const ITEM_PRICE = 500;

// Price of every special item (diamonds).
const DIAMOND_PRICE = 3;

// How long the full bar stays visible before the new round starts (ms).
const ROUND_END_DELAY = 1500;

const STORAGE_KEY = "salavat-state";

const GOLD = "#f2b01e";
const DIAMOND = "#38b6ff";

// Colors of the "buy" buttons in the shop
const COIN_BUY = { bg: GOLD, text: "#4a3300" };
const DIAMOND_BUY = { bg: "#8fdcff", text: "#06364d" };

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
const formatDate = (key: string) => {
  const [y, m, d] = key.split("-").map(Number);
  if (!y || !m || !d) return key;
  try {
    return new Date(y, m - 1, d).toLocaleDateString("fa-IR", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  } catch {
    return key;
  }
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
  name: string;
  desc: string;
  stat: keyof Stats;
  target: number;
};

const ACHIEVEMENTS: Achievement[] = [
  { id: "t1", icon: "🌱", name: "شروع خوب", desc: "1000 صلوات در مجموع", stat: "total", target: 1000 },
  { id: "t2", icon: "🌿", name: "ادامه‌دهنده", desc: "10000 صلوات در مجموع", stat: "total", target: 10000 },
  { id: "t3", icon: "🌳", name: "دریای صلوات", desc: "100000 صلوات در مجموع", stat: "total", target: 100000 },

  {
    id: "g7",
    icon: "📅",
    name: "یه هفته پایبند",
    desc: `روزی ${ACH_DAILY_GOAL} صلوات، برای 7 روز`,
    stat: "goalDays",
    target: 7,
  },
  {
    id: "g30",
    icon: "🗓️",
    name: "سی روز نور",
    desc: `روزی ${ACH_DAILY_GOAL} صلوات، برای 30 روز (لازم نیست پشت‌سرهم باشن)`,
    stat: "goalDays",
    target: 30,
  },
  {
    id: "g100",
    icon: "💯",
    name: "صد روز با صلوات",
    desc: `روزی ${ACH_DAILY_GOAL} صلوات، برای 100 روز`,
    stat: "goalDays",
    target: 100,
  },

  {
    id: "s7",
    icon: "🔥",
    name: "هفت روز پشت‌سرهم",
    desc: `روزی ${ACH_DAILY_GOAL} صلوات، 7 روز پشت‌سرهم`,
    stat: "bestStreak",
    target: 7,
  },
  {
    id: "s30",
    icon: "☀️",
    name: "سی روز پشت‌سرهم",
    desc: `روزی ${ACH_DAILY_GOAL} صلوات، 30 روز پشت‌سرهم`,
    stat: "bestStreak",
    target: 30,
  },

  { id: "d1", icon: "🚀", name: "روز پرکار", desc: "1000 صلوات در یک روز", stat: "bestDaily", target: 1000 },
  { id: "d2", icon: "🌟", name: "روز استثنایی", desc: "3000 صلوات در یک روز", stat: "bestDaily", target: 3000 },

  { id: "r1", icon: "🔄", name: "اولین دور", desc: "1 دور کامل (تا 1000)", stat: "rounds", target: 1 },
  { id: "r2", icon: "🔁", name: "ده دور", desc: "10 دور کامل", stat: "rounds", target: 10 },

  { id: "rec1", icon: "🏆", name: "رکوردشکن", desc: "شکستن رکورد روزانه برای اولین بار", stat: "recordsBroken", target: 1 },
  { id: "rec5", icon: "🥇", name: "پنج رکورد", desc: "شکستن رکورد روزانه 5 بار", stat: "recordsBroken", target: 5 },

  { id: "q1", icon: "🎯", name: "کوئست‌باز", desc: "کامل کردن همه‌ی کوئست‌های یک روز", stat: "perfectDays", target: 1 },
  { id: "q7", icon: "🎖️", name: "هفته‌ی کوئست", desc: "کامل کردن همه‌ی کوئست‌ها در 7 روز", stat: "perfectDays", target: 7 },

  { id: "p1", icon: "🛍️", name: "اولین خرید", desc: "خرید یک آیتم از فروشگاه", stat: "owned", target: 1 },
  { id: "p5", icon: "🛒", name: "کلکسیونر", desc: "داشتن 5 آیتم از فروشگاه", stat: "owned", target: 5 },
];

// Ids of the achievements that are unlocked with the given numbers
const unlockedIds = (s: Stats) =>
  ACHIEVEMENTS.filter((a) => s[a.stat] >= a.target).map((a) => a.id);

// ---------- Shop items ----------

type Theme = {
  id: string;
  name: string;
  premium?: boolean; // true = bought with diamonds
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
  name: string;
  premium?: boolean; // true = bought with diamonds
  color: string | null; // null = same color as the theme
};

const LIGHT_BADGE = { badgeBg: "#fff6dc", badgeText: "#8a5d00" };

const THEMES: Theme[] = [
  {
    id: "green",
    name: "سبز (پیش‌فرض)",
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
    name: "آبی",
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
    name: "بنفش",
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
    name: "نارنجی",
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
    name: "شب (تاریک)",
    primary: "#2fb98a",
    bg: "#0e1412",
    card: "#19221e",
    track: "#2b3732",
    text: "#e8efec",
    sub: "#a8b5af",
    muted: "#6f7f78",
    badgeBg: "#3a2f10",
    badgeText: "#ffd467",
  },
  // ----- Special themes (diamonds) -----
  {
    id: "royal",
    name: "سلطنتی (طلایی تیره)",
    premium: true,
    primary: "#c99a2e",
    bg: "#15120b",
    card: "#221d12",
    track: "#383019",
    text: "#f5ecd2",
    sub: "#c9bb91",
    muted: "#8a7d58",
    badgeBg: "#3a2f10",
    badgeText: "#ffd467",
  },
  {
    id: "ruby",
    name: "یاقوتی",
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
];

const BUTTONS: ButtonColor[] = [
  { id: "default", name: "پیش‌فرض (هم‌رنگ تم)", color: null },
  { id: "gold", name: "طلایی", color: "#d4a017" },
  { id: "red", name: "قرمز", color: "#c62f3a" },
  { id: "pink", name: "صورتی", color: "#d6457f" },
  { id: "teal", name: "فیروزه‌ای", color: "#0e8f9a" },
  { id: "black", name: "مشکی", color: "#2b2b2b" },
  // ----- Special button (diamonds) -----
  { id: "rainbow", name: "رنگین‌کمان (متحرک)", premium: true, color: "#8e24aa" },
];

// Colors the rainbow button slowly changes between
const RAINBOW = ["#e53935", "#fb8c00", "#fdd835", "#43a047", "#1e88e5", "#8e24aa", "#e53935"];
const RAINBOW_STEPS = RAINBOW.map((_, i) => i / (RAINBOW.length - 1));

const hexToRgba = (hex: string, alpha: number) => {
  const n = parseInt(hex.replace("#", ""), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
};

// Makes a color darker (used for the pressed state of the button).
const darken = (hex: string, amount = 0.2) => {
  const n = parseInt(hex.replace("#", ""), 16);
  const r = Math.round(((n >> 16) & 255) * (1 - amount));
  const g = Math.round(((n >> 8) & 255) * (1 - amount));
  const b = Math.round((n & 255) * (1 - amount));
  return `rgb(${r}, ${g}, ${b})`;
};

// Soft shadow that works on both Android and iOS.
const shadow = (color = "#000000", elevation = 4) => ({
  shadowColor: color,
  shadowOffset: { width: 0, height: elevation / 2 },
  shadowOpacity: 0.2,
  shadowRadius: elevation * 1.2,
  elevation,
});

// ---------- One row in the shop ----------

type RowProps = {
  name: string;
  swatches: string[];
  owned: boolean;
  active: boolean;
  affordable: boolean;
  price: number;
  icon: string;
  buy: { bg: string; text: string };
  theme: Theme;
  onPress: () => void;
};

function ShopRow({
  name,
  swatches,
  owned,
  active,
  affordable,
  price,
  icon,
  buy,
  theme,
  onPress,
}: RowProps) {
  let label = `${price} ${icon} خرید`;
  let bg = theme.track;
  let color = theme.muted;

  if (active) {
    label = "فعال ✓";
    bg = theme.track;
    color = theme.sub;
  } else if (owned) {
    label = "انتخاب";
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
      <Text style={[styles.rowName, { color: theme.text }]}>{name}</Text>
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
  onPress: () => void;
};

function BoostRow({ active, affordable, theme, onPress }: BoostRowProps) {
  let label = `${DIAMOND_PRICE} 💎 خرید`;
  let bg = theme.track;
  let color = theme.muted;

  if (active) {
    label = "فعال امروز ✓";
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
        <Text style={[styles.rowName, styles.boostName, { color: theme.text }]}>ضریب ×۲ سکه</Text>
        <Text style={[styles.boostDesc, { color: theme.sub }]}>
          تا پایان امروز، همه‌ی جایزه‌های سکه‌ای دو برابر می‌شن
        </Text>
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
};

function QuestRow({ target, reward, progress, done, theme }: QuestRowProps) {
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
        <Text style={[styles.questTitle, { color: theme.text }]}>{target} صلوات در روز</Text>
        <View style={[styles.rewardChip, { backgroundColor: done ? theme.track : theme.badgeBg }]}>
          <Text style={[styles.rewardText, { color: done ? theme.sub : theme.badgeText }]}>
            {done ? "دریافت شد ✓" : `+${reward} 🪙`}
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
  value: number;
  claimed: boolean;
  theme: Theme;
  onClaim: () => void;
};

function AchievementRow({ a, value, claimed, theme, onClaim }: AchRowProps) {
  const unlocked = value >= a.target;
  const pct = Math.min(value / a.target, 1) * 100;

  let label = "🔒";
  let bg = theme.track;
  let color = theme.muted;

  if (claimed) {
    label = "دریافت شد ✓";
    color = theme.sub;
  } else if (unlocked) {
    label = `دریافت ${ACH_REWARD} 💎`;
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
        <Text style={[styles.achName, { color: theme.text }]}>{a.name}</Text>
        <Text style={[styles.achDesc, { color: theme.sub }]}>{a.desc}</Text>
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
          setCoins(data.coins ?? 0);
          setDiamonds(data.diamonds ?? 0);
          setBoostDate(typeof data.boostDate === "string" ? data.boostDate : "");

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
          if (data.dailyDate === todayKey()) {
            setDailyDate(data.dailyDate);
            setDailyCount(data.dailyCount ?? 0);
            setDailyClaimed(Array.isArray(data.dailyClaimed) ? data.dailyClaimed : []);
          }

          // Record: also counts the last saved day (for data saved before records existed)
          const savedBest: number = data.bestDaily ?? 0;
          const lastDayCount: number = data.dailyCount ?? 0;
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
        setLoaded(true);
      }
    };
    load();

    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  // Notice when a new day starts (app comes back to the screen, or midnight passes)
  useEffect(() => {
    const refresh = () => setToday(todayKey());
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

  // Current look
  const theme = THEMES.find((t) => t.id === activeTheme) ?? THEMES[0];
  const btn = BUTTONS.find((b) => b.id === activeButton) ?? BUTTONS[0];
  const buttonColor = btn.color ?? theme.primary;
  const buttonPressed = darken(buttonColor, 0.2);

  // Today's quest progress (zero if the saved progress is from an older day)
  const dailyFresh = dailyDate === today;
  const effDailyCount = dailyFresh ? dailyCount : 0;
  const effDailyClaimed = dailyFresh ? dailyClaimed : [];
  const questsDone = QUESTS.filter((q) => effDailyClaimed.includes(q.id)).length;
  const boostActive = boostDate === today;

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
      titles.push(next === MAX ? `دور ${rounds + 1} کامل شد!` : `هدف ${next} کامل شد!`);
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
      titles.push(`کوئست روزانه ${q.target} صلوات کامل شد!`);
    });

    setToday(nowKey);
    setDailyDate(nowKey);
    setDailyCount(nextDaily);
    if (newQuests.length > 0) {
      setDailyClaimed([...baseClaimed, ...newQuests.map((q) => q.id)]);
    } else if (dailyDate !== nowKey) {
      setDailyClaimed([]);
    }

    // Double coins boost (bought with diamonds, valid for one day)
    if (earned > 0 && boostDate === nowKey) {
      earned *= 2;
      titles.push("⚡ ضریب ×۲ فعال بود");
    }

    // Personal record: highest number of salavat in one day
    let recordBroken = false;
    if (nextDaily > bestDaily) {
      // Celebrate once: the first time today's count passes the record of an older day
      if (bestDaily > 0 && bestDate !== nowKey) {
        recordBroken = true;
        titles.unshift(`🏆 رکورد جدید: ${nextDaily} صلوات در یک روز!`);
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
    const newAchievements = ACHIEVEMENTS.filter(
      (a) => unlockedIds(nextStats).includes(a.id) && !before.includes(a.id)
    );
    newAchievements.forEach((a) => titles.push(`🏅 دستاورد جدید: ${a.name}`));

    // Pay the rewards and show one popup for everything that happened on this tap
    const diamondsEarned = recordBroken ? DIAMOND_PER_RECORD : 0;
    const celebrate = earned > 0 || recordBroken || newAchievements.length > 0;
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
    Alert.alert(
      "صفر کردن",
      "شمارنده صفر شود؟ جایزه‌ی هدف‌هایی که توی این دور گرفتی دوباره داده نمی‌شه و دور بعد دوباره فعال می‌شه. پیشرفت کوئست‌ها، رکورد و دستاوردها هم سر جاش می‌مونه.",
      [
        { text: "انصراف", style: "cancel" },
        { text: "بله", style: "destructive", onPress: () => setCount(0) },
      ]
    );
  };

  // Buy an item (theme or button color) with coins or diamonds
  const buy = (
    kind: "theme" | "button",
    id: string,
    name: string,
    currency: "coins" | "diamonds" = "coins"
  ) => {
    const price = currency === "coins" ? ITEM_PRICE : DIAMOND_PRICE;
    const balance = currency === "coins" ? coins : diamonds;
    const unit = currency === "coins" ? "سکه" : "الماس";

    if (balance < price) {
      Alert.alert(
        `${unit} کافی نیست`,
        `قیمت این آیتم ${price} ${unit} هست و ${price - balance} ${unit} دیگه لازم داری.`
      );
      return;
    }
    Alert.alert("خرید", `«${name}» به قیمت ${price} ${unit} خریده بشه؟`, [
      { text: "انصراف", style: "cancel" },
      {
        text: "خرید",
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
      Alert.alert("فعاله", "ضریب ×۲ امروز فعاله و تا نیمه‌شب ادامه داره.");
      return;
    }
    if (diamonds < DIAMOND_PRICE) {
      Alert.alert(
        "الماس کافی نیست",
        `قیمت این آیتم ${DIAMOND_PRICE} الماس هست و ${DIAMOND_PRICE - diamonds} الماس دیگه لازم داری.`
      );
      return;
    }
    Alert.alert("خرید", `«ضریب ×۲ سکه (امروز)» به قیمت ${DIAMOND_PRICE} الماس خریده بشه؟`, [
      { text: "انصراف", style: "cancel" },
      {
        text: "خرید",
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
  const diamondAffordable = diamonds >= DIAMOND_PRICE;
  const walletText = `🪙 ${coins}   💎 ${diamonds}${boostActive ? "   ⚡" : ""}`;

  const statusText = locked
    ? "دور جدید شروع می‌شه..."
    : nextMilestone
    ? `${nextMilestone - count} تا هدف ${nextMilestone}${
        claimed.includes(nextMilestone) ? " (جایزه‌ش رو گرفتی)" : ""
      }`
    : "";

  // Record card texts
  const recordIsToday = bestDaily > 0 && bestDate === today;
  const recordPct = bestDaily > 0 ? Math.min(effDailyCount / bestDaily, 1) * 100 : 0;
  const recordHint =
    bestDaily === 0
      ? "با اولین صلوات، رکوردت ثبت می‌شه"
      : recordIsToday
      ? "رکورد مال امروزه 🎉 هرچی بیشتر بگی، رکورد بالاتر می‌ره"
      : `${bestDaily - effDailyCount + 1} صلوات تا شکستن رکورد`;

  return (
    <View style={[styles.container, { backgroundColor: theme.bg }]}>
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
            <Text style={[styles.pillButtonText, { color: theme.primary }]}>🛍 فروشگاه</Text>
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
        {toastReward > 0 && <Text style={styles.toastReward}>+{toastReward} سکه 🪙</Text>}
        {toastDiamonds > 0 && <Text style={styles.toastDiamond}>+{toastDiamonds} الماس 💎</Text>}
      </Animated.View>

      {/* Center: title, button, status */}
      <View style={styles.center}>
        <Text style={[styles.title, { color: theme.primary }]}>صلوات شمار</Text>
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
                  <Text style={styles.of}>صلوات</Text>
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
            <Text style={[styles.rounds, { color: theme.primary }]}>دورهای کامل: {rounds}</Text>
          </View>

          <Pressable onPress={reset} style={styles.resetButton}>
            <Text style={styles.resetText}>صفر کردن</Text>
          </Pressable>
        </View>
      </View>

      {/* Missions: daily quests, record and achievements */}
      <Modal visible={questsOpen} animationType="slide" onRequestClose={() => setQuestsOpen(false)}>
        <View style={[styles.shop, { backgroundColor: theme.bg }]}>
          <View style={styles.shopHeader}>
            <Text style={[styles.shopTitle, { color: theme.text }]}>🎯 ماموریت‌ها</Text>
            <Pressable
              onPress={() => setQuestsOpen(false)}
              style={[styles.closeButton, { backgroundColor: theme.card }, shadow("#000000", 2)]}
            >
              <Text style={[styles.closeText, { color: theme.primary }]}>بستن</Text>
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
                کوئست و رکورد
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
                🏅 دستاوردها{claimableCount > 0 ? ` (${claimableCount})` : ""}
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
                <Text style={[styles.recordLabel, { color: theme.badgeText }]}>🏆 رکورد شخصی</Text>
                <Text style={[styles.recordNumber, { color: theme.text }]}>{bestDaily}</Text>
                <Text style={[styles.recordSub, { color: theme.sub }]}>بیشترین صلوات در یک روز</Text>
                {bestDate !== "" && (
                  <Text style={[styles.recordDate, { color: theme.muted }]}>{formatDate(bestDate)}</Text>
                )}

                <View style={[styles.questTrack, styles.recordTrack, { backgroundColor: theme.track }]}>
                  <View style={[styles.questFill, { width: `${recordPct}%`, backgroundColor: GOLD }]} />
                </View>
                <Text style={[styles.recordToday, { color: theme.text }]}>
                  امروز: {effDailyCount} صلوات
                </Text>
                <Text style={[styles.recordHint, { color: theme.sub }]}>{recordHint}</Text>

                <View style={styles.diamondHint}>
                  <Text style={styles.diamondHintText}>
                    💎 با هر رکورد جدید {DIAMOND_PER_RECORD} الماس می‌گیری (الان {diamonds} الماس داری)
                  </Text>
                </View>
              </View>

              {/* Daily quests */}
              <View style={styles.sectionRow}>
                <View style={[styles.sectionBar, { backgroundColor: theme.primary }]} />
                <Text style={[styles.sectionTitle, { color: theme.text }]}>کوئست‌های امروز</Text>
              </View>
              <Text style={[styles.questNote, { color: theme.sub }]}>
                کوئست‌ها هر روز از نیمه‌شب دوباره شروع می‌شن. همه‌ی صلوات‌های امروز حساب می‌شن، حتی بعد از صفر کردن.
              </Text>

              {QUESTS.map((q) => (
                <QuestRow
                  key={q.id}
                  target={q.target}
                  reward={q.reward}
                  progress={effDailyCount}
                  done={effDailyClaimed.includes(q.id)}
                  theme={theme}
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
                    🏅 {achClaimed.length}/{ACHIEVEMENTS.length} دریافت شده
                  </Text>
                  <View style={[styles.summaryDiamond, { backgroundColor: `${DIAMOND}1f` }]}>
                    <Text style={styles.summaryDiamondText}>💎 {diamonds}</Text>
                  </View>
                </View>

                <View style={styles.statsRow}>
                  <View style={[styles.statBox, { backgroundColor: `${theme.primary}14` }]}>
                    <Text style={[styles.statValue, { color: theme.primary }]}>{currentStreak}</Text>
                    <Text style={[styles.statLabel, { color: theme.sub }]}>🔥 روز پشت‌سرهم</Text>
                  </View>
                  <View style={[styles.statBox, { backgroundColor: `${theme.primary}14` }]}>
                    <Text style={[styles.statValue, { color: theme.primary }]}>{goalDays}</Text>
                    <Text style={[styles.statLabel, { color: theme.sub }]}>📅 روز با {ACH_DAILY_GOAL}+</Text>
                  </View>
                  <View style={[styles.statBox, { backgroundColor: `${theme.primary}14` }]}>
                    <Text style={[styles.statValue, { color: theme.primary }]}>{totalSalavat}</Text>
                    <Text style={[styles.statLabel, { color: theme.sub }]}>∑ مجموع صلوات</Text>
                  </View>
                </View>

                <Text style={[styles.achNote, { color: theme.sub }]}>
                  هر دستاورد {ACH_REWARD} الماس جایزه داره و فقط یک بار قابل دریافته.
                </Text>
              </View>

              {ACHIEVEMENTS.map((a) => (
                <AchievementRow
                  key={a.id}
                  a={a}
                  value={stats[a.stat]}
                  claimed={achClaimed.includes(a.id)}
                  theme={theme}
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
          <View style={styles.shopHeader}>
            <Text style={[styles.shopTitle, { color: theme.text }]}>🛍 فروشگاه</Text>
            <Pressable
              onPress={() => setShopOpen(false)}
              style={[styles.closeButton, { backgroundColor: theme.card }, shadow("#000000", 2)]}
            >
              <Text style={[styles.closeText, { color: theme.primary }]}>بستن</Text>
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
              🪙 {coins} سکه     💎 {diamonds} الماس
            </Text>
          </View>

          <ScrollView contentContainerStyle={styles.shopContent}>
            {/* Special diamond rewards */}
            <View
              style={[
                styles.diamondSection,
                shadow(DIAMOND, 6),
                { backgroundColor: `${DIAMOND}14`, borderColor: DIAMOND },
              ]}
            >
              <Text style={[styles.diamondTitle, { color: theme.text }]}>💎 جوایز ویژه الماسی</Text>
              <Text style={[styles.diamondNote, { color: theme.sub }]}>
                با هر رکورد جدید {DIAMOND_PER_RECORD} الماس می‌گیری و با هر دستاورد {ACH_REWARD} الماس. قیمت هر جایزه‌ی ویژه {DIAMOND_PRICE} الماسه.
              </Text>

              <BoostRow
                active={boostActive}
                affordable={diamondAffordable}
                theme={theme}
                onPress={buyBoost}
              />

              {THEMES.filter((t) => t.premium).map((t) => (
                <ShopRow
                  key={t.id}
                  name={t.name}
                  swatches={[t.primary, t.bg]}
                  owned={ownedThemes.includes(t.id)}
                  active={activeTheme === t.id}
                  affordable={diamondAffordable}
                  price={DIAMOND_PRICE}
                  icon="💎"
                  buy={DIAMOND_BUY}
                  theme={theme}
                  onPress={() =>
                    ownedThemes.includes(t.id)
                      ? setActiveTheme(t.id)
                      : buy("theme", t.id, t.name, "diamonds")
                  }
                />
              ))}

              {BUTTONS.filter((b) => b.premium).map((b) => (
                <ShopRow
                  key={b.id}
                  name={b.name}
                  swatches={b.id === "rainbow" ? [RAINBOW[0], RAINBOW[4]] : [b.color ?? theme.primary]}
                  owned={ownedButtons.includes(b.id)}
                  active={activeButton === b.id}
                  affordable={diamondAffordable}
                  price={DIAMOND_PRICE}
                  icon="💎"
                  buy={DIAMOND_BUY}
                  theme={theme}
                  onPress={() =>
                    ownedButtons.includes(b.id)
                      ? setActiveButton(b.id)
                      : buy("button", b.id, b.name, "diamonds")
                  }
                />
              ))}
            </View>

            {/* Normal items (coins) */}
            <Text style={[styles.priceNote, styles.coinPriceNote, { color: theme.sub }]}>
              قیمت هر آیتم معمولی {ITEM_PRICE} سکه‌ست
            </Text>

            <View style={styles.sectionRow}>
              <View style={[styles.sectionBar, { backgroundColor: theme.primary }]} />
              <Text style={[styles.sectionTitle, { color: theme.text }]}>تم‌ها</Text>
            </View>
            {THEMES.filter((t) => !t.premium).map((t) => (
              <ShopRow
                key={t.id}
                name={t.name}
                swatches={[t.primary, t.bg]}
                owned={ownedThemes.includes(t.id)}
                active={activeTheme === t.id}
                affordable={coinAffordable}
                price={ITEM_PRICE}
                icon="🪙"
                buy={COIN_BUY}
                theme={theme}
                onPress={() =>
                  ownedThemes.includes(t.id) ? setActiveTheme(t.id) : buy("theme", t.id, t.name)
                }
              />
            ))}

            <View style={styles.sectionRow}>
              <View style={[styles.sectionBar, { backgroundColor: theme.primary }]} />
              <Text style={[styles.sectionTitle, { color: theme.text }]}>رنگ دکمه</Text>
            </View>
            {BUTTONS.filter((b) => !b.premium).map((b) => (
              <ShopRow
                key={b.id}
                name={b.name}
                swatches={[b.color ?? theme.primary]}
                owned={ownedButtons.includes(b.id)}
                active={activeButton === b.id}
                affordable={coinAffordable}
                price={ITEM_PRICE}
                icon="🪙"
                buy={COIN_BUY}
                theme={theme}
                onPress={() =>
                  ownedButtons.includes(b.id) ? setActiveButton(b.id) : buy("button", b.id, b.name)
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
  title: { fontSize: 30, fontWeight: "bold" },
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
    alignItems: "center",
    gap: 10,
    marginTop: 14,
  },
  roundsChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 16,
  },
  rounds: { fontSize: 15, fontWeight: "bold" },
  resetButton: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "rgba(217,69,58,0.5)",
  },
  resetText: { color: "#d9453a", fontSize: 15 },

  // Shop & missions (shared panel style)
  shop: { flex: 1, paddingTop: 52 },
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
  rowButton: {
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 14,
    minWidth: 96,
    alignItems: "center",
  },
  rowButtonText: { fontSize: 14, fontWeight: "bold" },

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
  diamondHintText: { fontSize: 13, color: "#1a79b3", textAlign: "center" },

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

  // Achievements
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
  summaryDiamondText: { fontSize: 16, fontWeight: "bold", color: "#1a79b3" },
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
