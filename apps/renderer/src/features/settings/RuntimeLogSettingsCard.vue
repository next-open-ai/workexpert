<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { RuntimeLogSettingsSchema } from '@workexpert/contracts';

const desktop = window.workexpertDesktop;
const available = Boolean(desktop?.getRuntimeLogSettings && desktop?.setRuntimeLogEnabled);
const enabled = ref<boolean | null>(null);
const busy = ref(false);
const error = ref('');
const feedback = ref('');

async function load() {
  if (!available) return;
  busy.value = true;
  error.value = '';
  try { enabled.value = RuntimeLogSettingsSchema.parse(await desktop!.getRuntimeLogSettings()).enabled; }
  catch { error.value = '无法读取运行日志设置，请重试。'; }
  finally { busy.value = false; }
}
async function toggle() {
  if (busy.value || enabled.value === null) return;
  busy.value = true;
  error.value = '';
  feedback.value = '';
  try {
    enabled.value = RuntimeLogSettingsSchema.parse(await desktop!.setRuntimeLogEnabled(!enabled.value)).enabled;
    feedback.value = enabled.value ? '已开启，立即生效。' : '已关闭，停止新增日志，历史日志保留。';
  } catch { error.value = '保存失败，开关状态未改变，请重试。'; }
  finally { busy.value = false; }
}
async function open(directory: boolean) {
  error.value = '';
  try { await desktop!.openRuntimeLogs(directory); }
  catch { error.value = '无法打开日志，请从应用“帮助”菜单重试。'; }
}
onMounted(load);
</script>

<template>
  <div class="mt-5 rounded-2xl border border-[var(--border)] bg-[var(--surface-muted)] p-5" :aria-busy="busy">
    <div class="flex items-start justify-between gap-5">
      <div class="min-w-0">
        <h3 id="runtime-log-label" class="text-[16px] font-bold">运行日志</h3>
        <p id="runtime-log-help" class="mt-1 max-w-2xl text-[13px] leading-relaxed text-[var(--muted)]">
          记录启动、请求耗时和错误码，便于排查安装后的问题。仅保存在本机，不记录密钥、文档正文或模型输出。
        </p>
      </div>
      <button v-if="available" type="button" role="switch" aria-labelledby="runtime-log-label" aria-describedby="runtime-log-help"
        :aria-checked="enabled === true" :disabled="busy || enabled === null" @click="toggle"
        :class="['relative mt-1 h-7 w-12 shrink-0 rounded-full border transition-colors focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--accent)] disabled:opacity-50', enabled ? 'border-[var(--accent)] bg-[var(--accent)]' : 'border-[var(--border)] bg-[var(--surface)]']">
        <span :class="['absolute top-0.5 h-5 w-5 rounded-full shadow-sm', enabled ? 'right-0.5 bg-white' : 'left-0.5 bg-[var(--muted)]']" />
      </button>
    </div>
    <template v-if="available">
      <div class="mt-3 flex flex-wrap items-center justify-between gap-3">
        <p class="text-xs text-[var(--muted)]" role="status" aria-live="polite">
          {{ busy ? '处理中…' : enabled === null ? '状态未读取' : enabled ? '已开启 · 自动保存，重启后保留' : '已关闭 · 历史日志保留' }}
        </p>
        <div class="flex flex-wrap gap-2">
          <button type="button" class="whitespace-nowrap rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-xs font-semibold hover:border-[var(--accent)]" @click="open(false)">查看日志</button>
          <button type="button" class="whitespace-nowrap rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-xs font-semibold hover:border-[var(--accent)]" @click="open(true)">打开日志文件夹</button>
        </div>
      </div>
      <p class="mt-2 text-xs leading-relaxed text-[var(--muted)]">仅影响当前设备的桌面运行日志；关闭不删除历史文件，不影响功能使用或 Actions 打包日志。</p>
      <p v-if="feedback" class="mt-2 text-xs text-[var(--text)]" role="status">{{ feedback }}</p>
      <div v-if="error" class="mt-3 text-xs" role="alert">
        <span class="text-rose-600 dark:text-rose-400">{{ error }}</span>
        <button v-if="enabled === null" type="button" :disabled="busy" class="ml-3 rounded px-2 py-1 font-semibold text-[var(--accent)] underline disabled:opacity-50" @click="load">重新读取</button>
      </div>
    </template>
    <p v-else class="mt-3 text-xs leading-relaxed text-[var(--muted)]">此设置仅在支持该功能的 WorkExpert 桌面版中可用，请使用新版桌面应用。</p>
  </div>
</template>
