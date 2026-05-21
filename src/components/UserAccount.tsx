"use client";

import { useState, useRef, useEffect } from "react";
import { useSession, signOut } from "next-auth/react";

export default function UserAccount() {
  const { data: session } = useSession();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const initial = session?.user?.name?.charAt(0) || session?.user?.email?.charAt(0) || "?";

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  if (!session) return null;

  return (
    <div ref={ref} className="fixed top-3 right-3 z-[9999]">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 px-2 py-1.5 rounded-lg bg-neutral-900/90 backdrop-blur-md border border-neutral-700 hover:bg-neutral-800 transition-colors cursor-pointer shadow-lg"
        title={session.user?.name || session.user?.email || "Account"}
      >
        {session.user?.image ? (
          <img src={session.user.image} alt="" className="w-7 h-7 rounded-full" />
        ) : (
          <span className="w-7 h-7 rounded-full bg-neutral-600 flex items-center justify-center text-sm font-medium text-white">
            {initial}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute top-full right-0 mt-2 w-48 bg-neutral-900 border border-neutral-700 rounded-lg shadow-2xl overflow-hidden">
          <div className="px-3 py-2 border-b border-neutral-700">
            <p className="text-sm text-neutral-200 font-medium truncate">
              {session.user?.name || "User"}
            </p>
            <p className="text-[11px] text-neutral-500 truncate">
              {session.user?.email}
            </p>
          </div>
          <button
            onClick={() => signOut()}
            className="w-full text-left px-3 py-2 text-sm text-neutral-400 hover:bg-neutral-800 hover:text-red-400 transition-colors cursor-pointer"
          >
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}
