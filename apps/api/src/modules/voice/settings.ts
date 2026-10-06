import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AsrResourceSchema } from '@workexpert/contracts';

export type VoiceInputSettings = { enabled: boolean; apiKey: string; resourceId: string; enablePunc: boolean; enableItn: boolean };

function settingsPath() {
  const root = process.env.WORKEXPERT_DATA_DIR || path.join(os.homedir(), '.workexpert');
  return path.join(root, 'voice-input-settings.json');
}
function defaults(): VoiceInputSettings {
  return { enabled: true, apiKey: '', resourceId: 'volc.seedasr.sauc.duration', enablePunc: true, enableItn: true };
}
export function readVoiceInputSettings(): VoiceInputSettings {
  try {
    const raw = JSON.parse(fs.readFileSync(settingsPath(), 'utf8')) as Record<string, unknown>;
    return { enabled: raw.enabled !== false, apiKey: String(raw.apiKey || '').trim(), resourceId: AsrResourceSchema.catch('volc.seedasr.sauc.duration').parse(raw.resourceId), enablePunc: raw.enablePunc !== false, enableItn: raw.enableItn !== false };
  } catch { return defaults(); }
}
export function resolveAsrKey(value = readVoiceInputSettings()) {
  return process.env.WORKEXPERT_VOLCENGINE_ASR_API_KEY?.trim() || value.apiKey;
}
export function publicVoiceInputSettings(value = readVoiceInputSettings()) {
  const key = resolveAsrKey(value);
  return { enabled: value.enabled, resourceId: value.resourceId, enablePunc: value.enablePunc, enableItn: value.enableItn, configured: Boolean(key), apiKeyMasked: key ? `••••••••${key.slice(-4)}` : '', keySource: process.env.WORKEXPERT_VOLCENGINE_ASR_API_KEY?.trim() ? 'environment' : 'settings' };
}
export function saveVoiceInputSettings(input: Record<string, unknown>) {
  const current = readVoiceInputSettings();
  const next: VoiceInputSettings = { enabled: input.enabled === undefined ? current.enabled : input.enabled === true, apiKey: input.clearApiKey ? '' : String(input.apiKey || '').trim() || current.apiKey, resourceId: AsrResourceSchema.parse(input.resourceId ?? current.resourceId), enablePunc: input.enablePunc === undefined ? current.enablePunc : input.enablePunc === true, enableItn: input.enableItn === undefined ? current.enableItn : input.enableItn === true };
  const file = settingsPath(); fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 }); fs.writeFileSync(file, JSON.stringify(next, null, 2), { mode: 0o600 }); return next;
}
