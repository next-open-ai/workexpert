import { defineConfig } from 'tsup';
export default defineConfig({
  entry: { 'asr.test': 'src/modules/voice/asr.test.ts', 'mobile-https-proxy.test': 'src/modules/chat-mobile/https-proxy.test.ts' }, format: ['esm'], platform: 'node', target: 'node22',
  outDir: 'test-dist', clean: true, noExternal: ['@workexpert/contracts'], removeNodeProtocol: false,
});
