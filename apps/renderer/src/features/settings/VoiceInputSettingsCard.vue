<script setup lang="ts">
import { onMounted, ref } from 'vue';
import VoiceInputDialog from '../chat/VoiceInputDialog.vue';
import { getVoiceInputSettings, saveVoiceInputSettings, type VoiceInputSettings } from '../../services/voice-input';
const props = defineProps<{ isAdmin: boolean }>();
const settings = ref<VoiceInputSettings>({ enabled: true, resourceId: 'volc.seedasr.sauc.duration', enablePunc: true, enableItn: true, configured: false, apiKeyMasked: '', keySource: 'settings' });
const apiKey = ref(''); const clearApiKey = ref(false); const loading = ref(false); const saving = ref(false); const testing = ref(false); const message = ref(''); const error = ref('');
async function load() { loading.value = true; try { settings.value = await getVoiceInputSettings(); } catch (cause) { error.value = cause instanceof Error ? cause.message : String(cause); } finally { loading.value = false; } }
async function save(test = false) { saving.value = true; error.value = ''; message.value = ''; try { settings.value = await saveVoiceInputSettings({ enabled: settings.value.enabled, resourceId: settings.value.resourceId, enablePunc: settings.value.enablePunc, enableItn: settings.value.enableItn, ...(apiKey.value.trim() ? { apiKey: apiKey.value.trim() } : {}), clearApiKey: clearApiKey.value }); apiKey.value = ''; clearApiKey.value = false; message.value = '语音输入配置已保存。'; if (test) testing.value = true; } catch (cause) { error.value = cause instanceof Error ? cause.message : String(cause); } finally { saving.value = false; } }
onMounted(load);
</script>

<template>
  <section class="mx-auto max-w-3xl space-y-5">
    <header><h2 class="text-xl font-bold">语音输入</h2><p class="mt-1 text-sm text-[var(--muted)]">将语音实时转成可编辑文字，由用户确认后再发送。WorkExpert 不提供实时语音通话。</p></header>
    <div v-if="loading" class="box">正在读取配置…</div>
    <div v-else class="box space-y-5">
      <label class="flex items-center justify-between gap-4"><span><strong>启用语音输入</strong><small class="mt-1 block text-[var(--muted)]">关闭后，对话输入区不再启动麦克风识别。</small></span><input v-model="settings.enabled" type="checkbox" :disabled="!props.isAdmin" /></label>
      <div><label class="text-sm font-semibold">火山引擎 ASR API Key</label><input v-model="apiKey" class="field mt-2 w-full" type="password" :placeholder="settings.configured ? `已配置 ${settings.apiKeyMasked}` : '请输入 API Key'" :disabled="!props.isAdmin" /><p class="mt-2 text-xs text-[var(--muted)]">密钥来源：{{ settings.keySource === 'environment' ? '环境变量' : '本地加密配置目录' }}</p><label v-if="settings.configured && settings.keySource === 'settings'" class="mt-3 flex items-center gap-2 text-sm"><input v-model="clearApiKey" type="checkbox" :disabled="!props.isAdmin" />清除已保存密钥</label></div>
      <label class="block text-sm font-semibold">识别资源<select v-model="settings.resourceId" class="field mt-2 w-full" :disabled="!props.isAdmin"><option value="volc.seedasr.sauc.duration">Seed ASR · 按时长</option><option value="volc.seedasr.sauc.concurrent">Seed ASR · 按并发</option><option value="volc.bigasr.sauc.duration">BigASR · 按时长</option><option value="volc.bigasr.sauc.concurrent">BigASR · 按并发</option></select></label>
      <div class="grid gap-3 sm:grid-cols-2"><label class="flex items-center gap-2"><input v-model="settings.enablePunc" type="checkbox" :disabled="!props.isAdmin" />自动标点</label><label class="flex items-center gap-2"><input v-model="settings.enableItn" type="checkbox" :disabled="!props.isAdmin" />数字与日期格式化</label></div>
      <p v-if="message" class="rounded-xl bg-emerald-500/10 p-3 text-sm text-emerald-700">{{ message }}</p><p v-if="error" class="rounded-xl bg-rose-500/10 p-3 text-sm text-rose-700">{{ error }}</p>
      <footer class="flex justify-end gap-3"><button class="secondary" type="button" :disabled="saving || !props.isAdmin" @click="save(false)">保存配置</button><button class="primary" type="button" :disabled="saving || !props.isAdmin" @click="save(true)">{{ saving ? '正在保存…' : '保存并测试' }}</button></footer>
    </div>
  </section>
  <VoiceInputDialog v-if="testing" test-mode @close="testing = false" @transcript="message = '识别测试通过，测试文字未发送给数字员工。'" />
</template>
