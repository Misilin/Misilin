import { readFile, mkdir, writeFile, rename } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const DAY = 86400000;
const iso = date => date.toISOString().slice(0, 10);
const escapeXml = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[char]));

export function validateDays(days, start, end) {
  if (!Array.isArray(days)) throw new Error('Contribution days are missing.');
  const ordered = days.filter(day => day.date >= start && day.date <= end).sort((a, b) => a.date.localeCompare(b.date));
  const expected = Math.round((Date.parse(end) - Date.parse(start)) / DAY) + 1;
  if (ordered.length !== expected) throw new Error(`Expected ${expected} contribution days; received ${ordered.length}.`);
  for (let i = 0; i < expected; i++) {
    if (ordered[i].date !== iso(new Date(Date.parse(start) + i * DAY))) throw new Error('Contribution dates are missing or duplicated.');
    if (!Number.isInteger(ordered[i].contributionCount) || ordered[i].contributionCount < 0) throw new Error('Invalid contribution count.');
  }
  return ordered;
}

export function renderActivity(days, username) {
  if (days.length < 2) throw new Error('At least two contribution days are required.');
  const left = 64, right = 1140, top = 108, bottom = 266;
  const maximum = Math.max(4, Math.ceil(Math.max(...days.map(day => day.contributionCount)) / 4) * 4);
  const points = days.map((day, i) => ({ ...day, x: left + i * (right - left) / (days.length - 1), y: bottom - day.contributionCount / maximum * (bottom - top) }));
  const line = points.map((point, i) => `${i ? 'L' : 'M'}${point.x.toFixed(2)},${point.y.toFixed(2)}`).join(' ');
  const area = `${line} L${right},${bottom} L${left},${bottom} Z`;
  const total = days.reduce((sum, day) => sum + day.contributionCount, 0);
  const grids = Array.from({ length: 5 }, (_, i) => {
    const y = bottom - i * (bottom - top) / 4;
    return `<path d="M${left},${y}H${right}" stroke="#263249"/><text x="48" y="${y + 4}" text-anchor="end" fill="#9aaac6" font-size="12">${i * maximum / 4}</text>`;
  }).join('');
  const labels = [...new Set([0, 7, 14, 21, days.length - 1])].filter(i => i < days.length).map(i => `<text x="${points[i].x}" y="293" text-anchor="middle" fill="#9aaac6" font-size="12">${escapeXml(days[i].date.slice(5))}</text>`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="340" viewBox="0 0 1200 340" role="img" aria-labelledby="title description">
<title id="title">${escapeXml(username)} — GitHub contributions over the last ${days.length} days</title>
<desc id="description">${total} contributions from ${days[0].date} through ${days.at(-1).date}. Today is incomplete. GitHub contribution counts, not a measure of research quality.</desc>
<defs><linearGradient id="line"><stop stop-color="#61dafb"/><stop offset="1" stop-color="#b99aff"/></linearGradient><linearGradient id="area" x2="0" y2="1"><stop stop-color="#61dafb" stop-opacity=".23"/><stop offset="1" stop-color="#61dafb" stop-opacity="0"/></linearGradient></defs>
<rect x=".5" y=".5" width="1199" height="339" rx="20" fill="#0d1425" stroke="#33405b"/>
<g font-family="Segoe UI,Arial,sans-serif">
<text x="40" y="43" fill="#edf2ff" font-size="22" font-weight="600">Activity timeline</text>
<text x="40" y="70" fill="#9aaac6" font-size="13">${days[0].date} — ${days.at(-1).date} · contributions per day · UTC</text>
<text x="1160" y="43" fill="#61dafb" text-anchor="end" font-size="22" font-weight="600">${total} contributions</text>
${grids}<path d="${area}" fill="url(#area)"/><path d="${line}" stroke="url(#line)" stroke-width="2.5" fill="none" stroke-linejoin="round"/>
${points.map(point => `<circle cx="${point.x.toFixed(2)}" cy="${point.y.toFixed(2)}" r="3" fill="#91ddf7"><title>${point.date}: ${point.contributionCount} contributions</title></circle>`).join('')}
${labels}<text x="1160" y="322" text-anchor="end" fill="#7e8eab" font-size="11">GitHub contribution calendar · today is incomplete</text>
</g></svg>\n`;
}

export async function main() {
  const username = process.env.PROFILE_USERNAME || 'Misilin';
  const now = new Date();
  const end = iso(now);
  const start = iso(new Date(Date.parse(end) - 30 * DAY));
  let days;
  const inputIndex = process.argv.indexOf('--input');
  if (inputIndex !== -1) {
    days = JSON.parse(await readFile(process.argv[inputIndex + 1], 'utf8'));
  } else {
    if (!process.env.GITHUB_TOKEN) throw new Error('GITHUB_TOKEN is required to fetch the contribution calendar.');
    const query = `query($login: String!, $from: DateTime!, $to: DateTime!) {
      user(login: $login) {
        contributionsCollection(from: $from, to: $to) {
          contributionCalendar { weeks { contributionDays { date contributionCount } } }
        }
      }
    }`;
    const response = await fetch('https://api.github.com/graphql', {
      method: 'POST', signal: AbortSignal.timeout(30000),
      headers: { Authorization: `Bearer ${process.env.GITHUB_TOKEN}`, 'Content-Type': 'application/json', 'User-Agent': 'Misilin-profile-cards' },
      body: JSON.stringify({ query, variables: { login: username, from: `${start}T00:00:00Z`, to: now.toISOString() } })
    });
    if (!response.ok) throw new Error(`GitHub returned HTTP ${response.status}.`);
    const body = await response.json();
    if (body.errors?.length) throw new Error(`GitHub GraphQL error: ${body.errors.map(error => error.message).join('; ')}`);
    const calendar = body.data?.user?.contributionsCollection?.contributionCalendar;
    if (!calendar) throw new Error('GitHub returned no contribution calendar.');
    days = calendar.weeks.flatMap(week => week.contributionDays);
  }
  const svg = renderActivity(validateDays(days, start, end), username);
  const output = 'assets/activity.svg';
  await mkdir(dirname(output), { recursive: true });
  await writeFile(`${output}.tmp`, svg, 'utf8');
  await rename(`${output}.tmp`, output);
  console.log(`Updated ${output} for ${username}.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
