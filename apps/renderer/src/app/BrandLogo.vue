<script setup lang="ts">
defineProps<{ size?: 'sm' | 'md' }>();
</script>

<template>
  <span
    :class="[
      'grid place-items-center overflow-hidden rounded-[10px] bg-[linear-gradient(145deg,#4c1d95_0%,#6d28d9_55%,#d97706_100%)] text-white shadow-[inset_0_0_0_1px_rgba(255,255,255,0.22)]',
      size === 'md' ? 'h-9 w-9' : 'h-8 w-8',
    ]"
    aria-hidden="true"
  >
    <svg
      :class="size === 'md' ? 'h-5 w-5' : 'h-[18px] w-[18px]'"
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M12 2.8 14.5 8l5.7.8-4.1 4 1 5.7-5.1-2.7-5.1 2.7 1-5.7-4.1-4L9.5 8 12 2.8Z"
        stroke="currentColor"
        stroke-width="1.6"
        stroke-linejoin="round"
        opacity="0.95"
      />
      <path
        d="M8.6 12.5h6.8M10.4 15.6h3.2"
        stroke="currentColor"
        stroke-width="1.35"
        stroke-linecap="round"
      />
    </svg>
  </span>
</template>
