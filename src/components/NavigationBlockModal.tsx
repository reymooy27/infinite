"use client";

import { useNavigationBlockStore } from "@/stores/useNavigationBlockStore";

export default function NavigationBlockModal() {
  const { isBlocked, message, unblock, confirm } = useNavigationBlockStore();

  if (!isBlocked) return null;

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
      <div className="relative bg-neutral-900 border border-neutral-700 rounded-xl p-6 shadow-2xl max-w-sm mx-4">
        <h2 className="text-lg font-semibold text-white mb-2">Leave this page?</h2>
        <p className="text-neutral-400 text-sm mb-6">
          {message || "Are you sure you want to leave? Your changes may not be saved."}
        </p>
        <div className="flex gap-3 justify-end">
          <button
            onClick={unblock}
            className="px-4 py-2 text-sm text-neutral-300 hover:text-white transition-colors"
          >
            Stay on Page
          </button>
          <button
            onClick={confirm}
            className="px-4 py-2 text-sm bg-red-600 hover:bg-red-500 text-white rounded-lg transition-colors"
          >
            Leave
          </button>
        </div>
      </div>
    </div>
  );
}