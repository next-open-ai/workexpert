import type { FastifyInstance } from 'fastify';
import { registerAsrRoutes } from './asr-routes.js';
import { publicVoiceInputSettings } from './settings.js';

/**
 * WorkExpert intentionally excludes full-duplex realtime voice conversations.
 * The remaining voice surface is one-way ASR input: users review recognized
 * text before it is submitted to an employee.
 */
export async function voiceRoutes(app: FastifyInstance) {
  app.get('/voice/input/capabilities', async () => ({ asr: publicVoiceInputSettings() }));
  await registerAsrRoutes(app);
}
