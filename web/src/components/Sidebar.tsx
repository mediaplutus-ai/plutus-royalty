"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { GROUP_LABEL, NAV, type NavItem } from "@/lib/nav";
import type { AppRole } from "@/lib/types";

export function Sidebar({ role, unread }: { role: AppRole; unread: number }) {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const items = NAV.filter((n) => n.roles.includes(role));
  const groups = (["money", "catalog", "admin"] as NavItem["group"][])
    .map((g) => ({ g, items: items.filter((i) => i.group === g) }))
    .filter((x) => x.items.length);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls="main-nav"
        className="md:hidden fixed top-3 left-3 z-40 rounded-md bg-nav px-3 py-2 text-sm font-semibold text-white"
      >
        {open ? "Close" : "Menu"}
      </button>
      <nav
        id="main-nav"
        aria-label="Main"
        className={`${open ? "translate-x-0" : "-translate-x-full"} md:translate-x-0 fixed inset-y-0 left-0 z-30 flex w-60 flex-col bg-nav px-4 pb-6 pt-16 transition-transform md:pt-7`}
      >
        <Link href="/dashboard" className="mb-8 block px-2" onClick={() => setOpen(false)}>
          <span className="block text-[1.35rem] font-extrabold leading-none tracking-tight text-white">
            Plutus<span className="text-[#8c9bff]">.</span>
          </span>
          <span className="mt-1 block text-xs text-nav-ink">Royalty ledger</span>
        </Link>

        <div className="flex-1 space-y-6 overflow-y-auto">
          {groups.map(({ g, items }) => (
            <div key={g}>
              <p className="mb-1.5 px-2 text-xs font-medium text-nav-ink/70">{GROUP_LABEL[g]}</p>
              <ul className="space-y-0.5">
                {items.map((item) => {
                  const active = path === item.href || path.startsWith(item.href + "/");
                  return (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        onClick={() => setOpen(false)}
                        aria-current={active ? "page" : undefined}
                        className={`flex items-center justify-between rounded-md px-2 py-1.5 text-[0.92rem] ${
                          active
                            ? "bg-white/10 font-semibold text-white"
                            : "text-nav-ink hover:bg-white/5 hover:text-white"
                        }`}
                      >
                        {item.label}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>

        <Link
          href="/notifications"
          onClick={() => setOpen(false)}
          className="mt-6 flex items-center justify-between rounded-md px-2 py-1.5 text-[0.92rem] text-nav-ink hover:bg-white/5 hover:text-white"
        >
          Notifications
          {unread > 0 && (
            <span className="num rounded-full bg-[#8c9bff] px-2 text-xs font-bold text-nav" aria-label={`${unread} unread`}>
              {unread}
            </span>
          )}
        </Link>
      </nav>
      {open && (
        <div className="fixed inset-0 z-20 bg-black/40 md:hidden" onClick={() => setOpen(false)} aria-hidden />
      )}
    </>
  );
}
