import { config } from '../config';

/** Posts a plain-text message into the team space via its incoming webhook. */
export async function postToSpace(text: string): Promise<boolean> {
  if (!config.chatWebhookUrl) {
    console.warn('GOOGLE_CHAT_WEBHOOK_URL not set — skipping outbound message');
    return false;
  }
  try {
    const res = await fetch(config.chatWebhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });
    if (!res.ok) {
      console.warn(`Chat webhook responded ${res.status}`);
      return false;
    }
    return true;
  } catch (err) {
    console.warn(`Chat webhook post failed: ${err}`);
    return false;
  }
}

/** Chat @mentions (`<users/123>`), falling back to a plain "@Name". */
export function mentionList(members: { name: string; chatUserId: string | null }[]): string {
  return members.map((m) => (m.chatUserId ? `<${m.chatUserId}>` : `@${m.name}`)).join(', ');
}

/** The "spaces/XXXX" id embedded in GOOGLE_CHAT_WEBHOOK_URL. */
export function spaceIdFromWebhookUrl(): string | null {
  return /\/spaces\/([^/]+)\//.exec(config.chatWebhookUrl)?.[1] ?? null;
}
