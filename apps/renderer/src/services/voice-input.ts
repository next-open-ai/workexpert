import { AsrEventSchema, type AsrEvent, type AsrPublicSettings } from '@workexpert/contracts';
import { getStoredSessionToken } from './auth';

export type VoiceInputSettings = AsrPublicSettings;
function apiBase() { return window.location.protocol === 'file:' ? 'http://127.0.0.1:50832' : ''; }
function authHeaders(json = false) { const token = getStoredSessionToken(); return { ...(json ? { 'content-type': 'application/json' } : {}), ...(token ? { 'x-workexpert-session': token } : {}) }; }
async function checkedJson(response: Response) { const body = await response.json().catch(() => ({})) as Record<string, unknown>; if (!response.ok || body.ok === false) throw new Error(String(body.error || body.message || `语音输入请求失败：HTTP ${response.status}`)); return body; }
export async function voiceInputCapabilities() { const response = await fetch(`${apiBase()}/api/voice/input/capabilities`, { headers: authHeaders() }); return checkedJson(response) as Promise<{ asr: VoiceInputSettings }>; }
export async function getVoiceInputSettings() { const response = await fetch(`${apiBase()}/api/settings/voice/input`, { headers: authHeaders() }); return checkedJson(response) as Promise<VoiceInputSettings>; }
export async function saveVoiceInputSettings(input: { enabled: boolean; apiKey?: string; clearApiKey?: boolean; resourceId: VoiceInputSettings['resourceId']; enablePunc: boolean; enableItn: boolean }) { const response = await fetch(`${apiBase()}/api/settings/voice/input`, { method: 'PUT', headers: authHeaders(true), body: JSON.stringify(input) }); return checkedJson(response) as Promise<VoiceInputSettings>; }
export async function asrCommand(operation: 'session' | 'audio' | 'finish' | 'close', payload: Record<string, unknown> = {}) { const response = await fetch(`${apiBase()}/api/voice/asr/${operation}`, { method: 'POST', headers: authHeaders(true), body: JSON.stringify(payload) }); return checkedJson(response); }
export async function consumeAsrEvents(sessionId: string, signal: AbortSignal, onEvent: (event: AsrEvent) => void) {
  const response = await fetch(`${apiBase()}/api/voice/asr/events?${new URLSearchParams({ session_id: sessionId })}`, { headers: authHeaders(), signal });
  if (!response.ok || !response.body) await checkedJson(response);
  const reader = response.body!.getReader(); const decoder = new TextDecoder(); let buffer = '';
  while (!signal.aborted) { const { value, done } = await reader.read(); if (done) break; buffer += decoder.decode(value, { stream: true }); let boundary = buffer.indexOf('\n\n'); while (boundary >= 0) { const block = buffer.slice(0, boundary); buffer = buffer.slice(boundary + 2); const data = block.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trim()).join('\n'); if (data) { try { const parsed = AsrEventSchema.safeParse(JSON.parse(data)); if (parsed.success) onEvent(parsed.data); } catch { /* ignore malformed diagnostics */ } } boundary = buffer.indexOf('\n\n'); } }
}
