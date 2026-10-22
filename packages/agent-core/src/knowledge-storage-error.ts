/** Keep native loader details in cause, never in the user-facing message. */
export function knowledgeStorageWriteError(error: unknown): Error {
  if (error instanceof Error && 'code' in error && error.code === 'EMBEDDING_DIMENSION_MISMATCH') return error;
  const visited = new Set<unknown>();
  let current = error;
  while (current && typeof current === 'object' && !visited.has(current)) {
    visited.add(current);
    const detail = current as { code?: string; message?: string; cause?: unknown };
    const missingComponent = ['MODULE_NOT_FOUND', 'ERR_MODULE_NOT_FOUND', 'ERR_DLOPEN_FAILED'].includes(detail.code ?? '')
      && /@lancedb|lancedb[\\/]|lancedb\..*\.node/i.test(detail.message ?? '');
    if (missingComponent) {
      return Object.assign(new Error('当前安装包的本地检索组件缺失或不兼容，请安装修复版本后重试。原文已保留，无需重新上传或更换向量模型。', { cause: error }), {
        code: 'KNOWLEDGE_STORAGE_COMPONENT_UNAVAILABLE',
      });
    }
    current = detail.cause;
  }
  return new Error('知识入库未完成：检索数据写入失败，原文已保留，请重试。', { cause: error });
}
