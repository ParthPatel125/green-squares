#!/usr/bin/env node
// green-squares: your github contribution graph, drawn in your terminal.
// zero dependencies; auth is borrowed from the gh cli.
//
//   node green-squares.js                 your graph, sized to the terminal
//   node green-squares.js --user torvalds someone else's graph
//   node green-squares.js --weeks 20      exactly 20 weeks
//   node green-squares.js --year          the full 52 weeks
//   node green-squares.js --stats         numbers only, no graph

const { execFileSync } = require("node:child_process");

const CALENDAR = `contributionsCollection(from: $from, to: $to) {
  contributionCalendar {
    totalContributions
    weeks { contributionDays { date contributionCount contributionLevel } }
  }
}`;

const VIEWER_QUERY = `query($from: DateTime!, $to: DateTime!) {
  viewer { login ${CALENDAR} }
}`;

const USER_QUERY = `query($login: String!, $from: DateTime!, $to: DateTime!) {
  user(login: $login) { login ${CALENDAR} }
}`;

// github's dark-mode emerald scale, one color per contribution level
const PALETTE = {
  NONE: [55, 62, 71],
  FIRST_QUARTILE: [14, 68, 41],
  SECOND_QUARTILE: [0, 109, 50],
  THIRD_QUARTILE: [38, 166, 65],
  FOURTH_QUARTILE: [57, 211, 83],
};

const useColor =
  process.stdout.isTTY && !process.env.NO_COLOR && process.env.TERM !== "dumb";

function cell(level) {
  if (!useColor) return { NONE: "·", FIRST_QUARTILE: "░", SECOND_QUARTILE: "▒", THIRD_QUARTILE: "▓", FOURTH_QUARTILE: "█" }[level];
  const [r, g, b] = PALETTE[level];
  return `\x1b[38;2;${r};${g};${b}m■\x1b[0m`;
}

function arg(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function fetchCalendar(login) {
  const to = new Date();
  const from = new Date(to.getTime() - 364 * 24 * 3600 * 1000);
  const args = ["api", "graphql", "-f", `query=${login ? USER_QUERY : VIEWER_QUERY}`,
    "-f", `from=${from.toISOString()}`, "-f", `to=${to.toISOString()}`];
  if (login) args.push("-f", `login=${login}`);
  const out = execFileSync("gh", args, { encoding: "utf8" });
  const who = JSON.parse(out).data[login ? "user" : "viewer"];
  if (!who) throw new Error(`no such user: ${login}`);
  return { login: who.login, calendar: who.contributionsCollection.contributionCalendar };
}

function streaks(days) {
  // days: oldest -> newest, newest is today
  let longest = 0, run = 0, longestEnd = null;
  for (const d of days) {
    run = d.contributionCount > 0 ? run + 1 : 0;
    if (run > longest) { longest = run; longestEnd = d.date; }
  }
  // current streak: count back from today; a zero *today* doesn't break it
  // yet, there are still hours left to commit
  let current = 0, i = days.length - 1;
  if (days[i] && days[i].contributionCount === 0) i--;
  for (; i >= 0 && days[i].contributionCount > 0; i--) current++;
  return { current, longest, longestEnd };
}

function busiest(days) {
  return days.reduce((a, b) => (b.contributionCount > a.contributionCount ? b : a));
}

function prettyDate(iso) {
  return new Date(iso + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function render(weeks) {
  const lines = [];

  // month labels: mark each column where the month changes
  let label = Array(4 + weeks.length * 2).fill(" ");
  let prevMonth = null;
  weeks.forEach((week, col) => {
    const m = new Date(week.contributionDays[0].date + "T12:00:00")
      .toLocaleDateString("en-US", { month: "short" });
    if (m !== prevMonth) {
      const at = 4 + col * 2;
      if (label.slice(at, at + 4).every((ch) => ch === " ")) label.splice(at, 3, ...m);
      prevMonth = m;
    }
  });
  lines.push(label.join("").trimEnd());

  const dayLabel = ["", "Mon", "", "Wed", "", "Fri", ""];
  for (let row = 0; row < 7; row++) {
    let line = dayLabel[row].padEnd(4);
    for (const week of weeks) {
      const day = week.contributionDays[row];
      line += (day ? cell(day.contributionLevel) : " ") + " ";
    }
    lines.push(line.trimEnd());
  }
  return lines.join("\n");
}

function main() {
  const login = arg("--user");
  let data;
  try {
    data = fetchCalendar(login);
  } catch (err) {
    const msg = String(err.message || err);
    console.error(msg.includes("no such user")
      ? msg
      : "could not reach github. is the gh cli installed and logged in? (gh auth login)");
    process.exit(2);
  }

  let { weeks, totalContributions } = data.calendar;
  const today = new Date().toISOString().slice(0, 10);
  const days = weeks.flatMap((w) => w.contributionDays).filter((d) => d.date <= today);

  const fit = Math.max(4, Math.floor(((process.stdout.columns || 160) - 5) / 2));
  const wanted = process.argv.includes("--year") ? 52 : Number(arg("--weeks")) || Math.min(26, fit);
  const shown = weeks.slice(-Math.min(wanted, fit, weeks.length));

  console.log();
  if (!process.argv.includes("--stats")) {
    console.log(render(shown));
    console.log();
  }

  const s = streaks(days);
  const b = busiest(days);
  const span = shown.length === weeks.length ? "the last year" : `the last ${shown.length} weeks`;
  const shownTotal = process.argv.includes("--stats")
    ? totalContributions
    : shown.flatMap((w) => w.contributionDays).reduce((n, d) => n + d.contributionCount, 0);
  console.log(`  ${data.login}: ${shownTotal} contributions in ${process.argv.includes("--stats") ? "the last year" : span}`);
  console.log(
    `  current streak ${s.current} day${s.current === 1 ? "" : "s"}` +
    `  ·  longest ${s.longest}${s.longestEnd ? ` (ended ${prettyDate(s.longestEnd)})` : ""}` +
    `  ·  busiest day ${prettyDate(b.date)} (${b.contributionCount})`
  );
  console.log();
}

main();
