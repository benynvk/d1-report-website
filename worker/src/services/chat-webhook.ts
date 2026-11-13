import { config } from '../config';
import { localHour, toLocalDate } from '../date';
import type { Member } from '../db/schema';
import { unauthorized } from '../http';
import * as autoWip from './auto-wip';
import { postToSpace } from './chat';
import { verifyChatToken } from './google';
import * as members from './members';
import * as reports from './reports';
import * as wip from './wip';

/**
 * Google Chat app endpoint: handles the /wip commands people send in the
 * team space.
 */

const WIP_COMMAND = '/wip';

/** Before this local hour a flag-less /wip is "morning", from it "evening". */
const WIP_CUTOFF_HOUR = 11;

type WipFlag = 'morning' | 'evening' | 'auto';
type WipCommand = { flag: WipFlag | null; force: boolean; body: string };

interface ChatUser {
  name?: string; // users/1234567890
  displayName?: string;
  email?: string;
  type?: string; // HUMAN | BOT
}

interface ChatMessage {
  name?: string;
  text?: string;
  argumentText?: string;
  createTime?: string;
  sender?: ChatUser;
}

/** The nested "chat app event" shape Google POSTs (see normalizeEvent). */
export interface ChatEvent {
  chat?: {
    user?: ChatUser;
    eventTime?: string;
    appCommandPayload?: { space?: { name?: string }; message?: ChatMessage };
    messagePayload?: { space?: { name?: string }; message?: ChatMessage };
    addedToSpacePayload?: { space?: { name?: string } };
    removedFromSpacePayload?: { space?: { name?: string } };
  };
}

interface NormalizedEvent {
  type: 'ADDED_TO_SPACE' | 'MESSAGE' | 'REMOVED_FROM_SPACE' | 'UNKNOWN';
  spaceName?: string;
  message?: ChatMessage;
}

/** Runs work after the response is sent (the Worker's `waitUntil`). */
export type Defer = (promise: Promise<unknown>) => void;

function normalizeEvent(raw: ChatEvent): NormalizedEvent {
  const chat = raw.chat;
  if (!chat) return { type: 'UNKNOWN' };
  if (chat.addedToSpacePayload) return { type: 'ADDED_TO_SPACE', spaceName: chat.addedToSpacePayload.space?.name };
  if (chat.removedFromSpacePayload) {
    return { type: 'REMOVED_FROM_SPACE', spaceName: chat.removedFromSpacePayload.space?.name };
  }
  const payload = chat.appCommandPayload ?? chat.messagePayload;
  if (payload) return { type: 'MESSAGE', spaceName: payload.space?.name, message: payload.message };
  return { type: 'UNKNOWN' };
}

/**
 * "/wip -m|-e|-a" (+ "-f" to overwrite) with content on the following lines.
 * null when the message isn't a /wip command; flag null when it's malformed.
 */
function extractWipCommand(text: string): WipCommand | null {
  const lines = (text ?? '').split(/\r?\n/);
  const first = (lines[0] ?? '').trim();
  if (!first.toLowerCase().startsWith(WIP_COMMAND)) return null;
  let flag: WipFlag | null = null;
  let force = false;
  for (const t of first.slice(WIP_COMMAND.length).trim().toLowerCase().split(/\s+/).filter(Boolean)) {
    if (t === '-m' || t === '-morning') flag = 'morning';
    else if (t === '-e' || t === '-evening') flag = 'evening';
    else if (t === '-a' || t === '-auto') flag = 'auto';
    else if (t === '-f' || t === '-force') force = true;
  }
  return { flag, force, body: lines.slice(1).join('\n').trim() };
}

interface EveningWipItem {
  url: string;
  note: string;
  hours: number;
}

/** "<teamwork link>: <wip note> | <hours>", or null. */
function parseEveningWipLine(rawLine: string): EveningWipItem | null {
  const line = rawLine.replace(/^\s*(?:[-*•–]|\d+[.)])\s+/, '').trim();
  const match = /^(https?:\/\/\S+?):\s*(.+)$/.exec(line);
  if (!match) return null;
  const [, url, rest] = match;
  const bar = rest.indexOf('|');
  if (bar === -1) return null;
  const note = rest.slice(0, bar).trim();
  const hours = parseFloat(rest.slice(bar + 1).trim().replace(',', '.'));
  if (!note || Number.isNaN(hours)) return null;
  return { url, note, hours };
}

function parseEveningWipLines(text: string) {
  const items: EveningWipItem[] = [];
  const invalidLines: string[] = [];
  for (const raw of (text ?? '').split(/\r?\n/)) {
    if (!raw.trim()) continue;
    const parsed = parseEveningWipLine(raw);
    if (parsed) items.push(parsed);
    else invalidLines.push(raw.trim());
  }
  return { items, invalidLines };
}

/**
 * Verifies the Bearer JWT Google Chat attaches to every request. Skipped
 * when GOOGLE_CHAT_PROJECT_NUMBER is unset (local dev).
 */
export async function verify(authorizationHeader: string | null | undefined): Promise<void> {
  if (!config.chatProjectNumber) return;
  const token = authorizationHeader?.replace(/^Bearer\s+/i, '').trim();
  if (!token) throw unauthorized('Missing bearer token');
  try {
    await verifyChatToken(token, config.chatProjectNumber);
  } catch (err) {
    console.warn(`Chat token verification failed: ${err}`);
    throw unauthorized('Invalid Google Chat token');
  }
}

/**
 * Handles a Chat event; the returned message is posted back into the thread
 * by Chat. Slow work is handed to `defer` and reported via the webhook.
 */
export async function handleEvent(raw: ChatEvent, defer: Defer): Promise<{ text: string } | undefined> {
  const event = normalizeEvent(raw);
  console.log(
    `Chat event: type=${event.type} space=${event.spaceName} ` +
      `sender=${event.message?.sender?.email ?? event.message?.sender?.displayName ?? '-'}`,
  );
  if (event.type === 'ADDED_TO_SPACE') {
    return {
      text:
        '👋 D1 Report bot đã sẵn sàng.\n\n' +
        'WIP buổi sáng:\n' +
        '```\n/wip -m\nhttps://link1\nhttps://link2\n```\n' +
        'WIP buổi chiều (kèm log báo cáo giờ làm):\n' +
        '```\n/wip -e\nhttps://offspringdigital.teamwork.com/app/tasks/123: in progress, 30% | 5\n```\n' +
        'Tự động điền từ task Teamwork đang assign: `/wip -a`\n\n' +
        'Mặc định không ghi đè ô đã có nội dung - thêm `-f` vào cuối dòng lệnh để ép ghi đè, ví dụ `/wip -m -f`.',
    };
  }
  if (event.type !== 'MESSAGE' || !event.message) return undefined;

  const sender = event.message.sender;
  if (sender?.type === 'BOT') return undefined; // our own echoes

  const cmd = extractWipCommand(event.message.text ?? event.message.argumentText ?? '');
  if (cmd === null) return undefined;

  // Only registered members may report.
  const member = await members.authorizeChatSender({
    email: sender?.email ?? null,
    chatUserId: sender?.name ?? null,
  });
  if (!member) {
    const who = sender?.email || sender?.displayName || 'Bạn';
    console.warn(`Blocked report from unregistered sender: ${who}`);
    return {
      text:
        `🚫 ${who} chưa được đăng ký là thành viên dự án nên không thể ` +
        'báo cáo. Vui lòng liên hệ leader để được thêm vào hệ thống.',
    };
  }

  const messageTime = event.message.createTime ?? new Date();
  const date = toLocalDate(messageTime, config.tzOffset);
  const hour = localHour(messageTime, config.tzOffset);
  return handleWipCommand(member, date, hour, cmd, defer);
}

/**
 * Which entry and day a /wip command targets. No flag: by the cutoff hour,
 * same day. A flag on the "wrong" side of the cutoff means logging late or
 * early for the adjacent WIP day (`-e` in the morning = last working day's
 * evening, `-m` in the afternoon = next working day's morning).
 */
async function resolveWipTarget(
  flag: 'morning' | 'evening' | null,
  hour: number,
  todayIso: string,
): Promise<{ flag: wip.WipColumn; date: string }> {
  const isMorningHour = hour < WIP_CUTOFF_HOUR;
  if (!flag) return { flag: isMorningHour ? 'morning' : 'evening', date: todayIso };
  if (flag === 'morning' && !isMorningHour) return { flag, date: await wip.adjacentWipDay(todayIso, 1) };
  if (flag === 'evening' && isMorningHour) return { flag, date: await wip.adjacentWipDay(todayIso, -1) };
  return { flag, date: todayIso };
}

const errText = (err: unknown, fallback: string) =>
  `⚠️ ${err instanceof Error && err.message ? err.message : fallback}`;

async function handleWipCommand(
  member: Member,
  date: string,
  hour: number,
  cmd: WipCommand,
  defer: Defer,
): Promise<{ text: string }> {
  const { flag, force, body } = cmd;
  if (flag === 'auto') {
    // Sheet + Teamwork lookups can outlast Chat's response window — ack now,
    // post the result via the webhook when done.
    defer(
      handleAutoWip(member, date, force)
        .then((res) => postToSpace(res.text))
        .catch((err) => {
          console.warn(`handleAutoWip failed: ${err}`);
          return postToSpace(`⚠️ Lỗi khi tự động điền WIP: ${err?.message ?? err}`);
        }),
    );
    return { text: '⏳ Đang lấy task từ Teamwork và điền WIP, mình báo kết quả ngay khi xong...' };
  }
  if (!body) {
    return { text: '⚠️ Chưa có nội dung. Ví dụ:\n```\n/wip -m\nhttps://link1\nhttps://link2\n```' };
  }

  let target: { flag: wip.WipColumn; date: string };
  try {
    target = await resolveWipTarget(flag, hour, date);
  } catch (err) {
    return { text: errText(err, 'Không thể xác định ngày WIP.') };
  }

  // Don't clobber existing content unless "-f" was given.
  if (!force) {
    try {
      const missing = await wip.membersMissingEntry(target.date, target.flag);
      if (!missing.some((m) => m.id === member.id)) {
        const label = target.flag === 'morning' ? 'sáng' : 'chiều';
        return {
          text: `⚠️ WIP ${label} ngày ${target.date} đã có nội dung. Thêm \`-f\` vào cuối dòng lệnh nếu muốn ghi đè.`,
        };
      }
    } catch {
      // Can't check (e.g. no sheet configured) — let the write surface it.
    }
  }

  if (target.flag === 'evening') return handleEveningWip(member, target.date, body);

  try {
    const result = await wip.writeEntry(target.date, member, target.flag, body);
    return {
      text:
        `✅ Đã cập nhật WIP buổi sáng ngày ${target.date} cho ${member.name}` +
        (result.created ? ' (tạo dòng mới).' : '.'),
    };
  } catch (err) {
    return { text: errText(err, 'Không thể ghi vào WIP sheet.') };
  }
}

/**
 * "/wip -a": the 09:45 auto-WIP for this one member, on demand — previous
 * working day's evening (from its morning), then today's morning (from the
 * D1 board), each only if empty unless "-f". Ignores the autoWip flag and
 * leave: the sender asked for it.
 */
async function handleAutoWip(member: Member, today: string, force: boolean): Promise<{ text: string }> {
  const { items } = await autoWip.forMember(member, today, force);
  const label = (i: autoWip.AutoWipItem) => `${i.column === 'morning' ? 'sáng' : 'chiều'} ${i.date}`;
  const written = items.filter((i) => i.action === 'written');
  const failed = items.filter((i) => i.action === 'failed');
  const lines: string[] = [];
  if (written.length) lines.push(`✅ Đã tự động điền WIP: ${written.map(label).join(', ')}.`);
  for (const i of failed) lines.push(`⚠️ Không điền được WIP ${label(i)}: ${i.reason}`);
  if (!lines.length) lines.push('ℹ️ WIP chiều hôm qua và sáng nay đều đã có nội dung - không ghi đè.');
  return { text: lines.join('\n') };
}

/**
 * Evening WIP doubles as the daily report: each "<link>: <note> | <hours>"
 * line logs a report entry, and the note goes into the WIP cell next to the
 * linked task title.
 */
async function handleEveningWip(member: Member, date: string, body: string): Promise<{ text: string }> {
  const { items, invalidLines } = parseEveningWipLines(body);
  if (items.length === 0 || invalidLines.length > 0) {
    return {
      text:
        '⚠️ Định dạng WIP buổi chiều chưa đúng. Mỗi dòng cần theo format:\n' +
        '`<link task>: <nội dung wip> | <số giờ>`\n' +
        'Ví dụ: `https://offspringdigital.teamwork.com/app/tasks/123: in progress, 30% | 5`' +
        (invalidLines.length ? `\n\nDòng lỗi: ${invalidLines.join(' • ')}` : ''),
    };
  }

  let report: reports.DailyReport;
  try {
    report = await reports.upsert({
      member,
      date,
      rawText: items.map((i) => `${i.url}: ${i.hours}`).join('\n'),
      source: 'google-chat',
    });
  } catch (err) {
    return { text: errText(err, 'Không thể ghi báo cáo.') };
  }

  const lines: wip.RichLine[] = report.entries.map((entry, i) => ({
    display: entry.resolvedTitle || entry.href || entry.taskName,
    url: entry.href,
    suffix: ` => ${items[i].note}`,
  }));
  try {
    const result = await wip.writeRichLines(date, member, 'evening', lines);
    const totalHours = report.entries.reduce((s, e) => s + e.hours, 0);
    return {
      text:
        `✅ Đã cập nhật WIP buổi chiều ngày ${date} cho ${member.name}` +
        (result.created ? ' (tạo dòng mới).' : '.') +
        ` Đã ghi nhận báo cáo (${totalHours}h).`,
    };
  } catch (err) {
    return { text: errText(err, 'Không thể ghi vào WIP sheet.') };
  }
}
