"use client";

// Searchable combobox for player award picks.
// Filters the static player list as the user types; selecting a name fires
// onSelect and collapses the dropdown. The value prop reflects the currently
// saved name so the component stays controlled.

import { useEffect, useRef, useState } from "react";
import { PLAYER_LIST } from "@/lib/players";

interface Props {
  value: string;
  onChange: (name: string) => void;
  placeholder?: string;
  disabled?: boolean;
}

const MAX_RESULTS = 8;

export default function PlayerCombobox({ value, onChange, placeholder = "Search player name…", disabled = false }: Props) {
  const [query, setQuery] = useState(value);
  const [open, setOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Keep local query in sync when the saved value changes externally (e.g. after save).
  useEffect(() => {
    setQuery(value);
  }, [value]);

  const filtered =
    query.trim().length < 2
      ? []
      : PLAYER_LIST.filter((p) =>
          p.toLowerCase().includes(query.trim().toLowerCase())
        ).slice(0, MAX_RESULTS);

  function select(name: string) {
    setQuery(name);
    onChange(name);
    setOpen(false);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!open || filtered.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlighted((h) => Math.min(h + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlighted((h) => Math.max(h - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      select(filtered[highlighted]);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  // Close on outside click.
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  return (
    <div ref={containerRef} className="relative flex-1">
      <input
        ref={inputRef}
        type="text"
        value={query}
        disabled={disabled}
        placeholder={placeholder}
        autoComplete="off"
        onChange={(e) => {
          setQuery(e.target.value);
          onChange(e.target.value); // keep parent in sync with raw typing too
          setHighlighted(0);
          setOpen(true);
        }}
        onFocus={() => {
          if (query.trim().length >= 2) setOpen(true);
        }}
        onKeyDown={handleKeyDown}
        maxLength={80}
        className="w-full rounded-lg border border-neutral-300 px-3 py-1.5 text-sm focus:border-pitch focus:outline-none disabled:opacity-50"
      />
      {open && filtered.length > 0 && (
        <ul
          role="listbox"
          className="absolute left-0 right-0 top-full z-50 mt-1 overflow-hidden rounded-lg border border-neutral-200 bg-white shadow-lg"
        >
          {filtered.map((name, i) => (
            <li
              key={name}
              role="option"
              aria-selected={i === highlighted}
              onMouseDown={(e) => {
                e.preventDefault(); // prevent blur before click
                select(name);
              }}
              onMouseEnter={() => setHighlighted(i)}
              className={`cursor-pointer px-3 py-2 text-sm ${
                i === highlighted ? "bg-pitch text-gold" : "text-neutral-700 hover:bg-neutral-50"
              }`}
            >
              {name}
            </li>
          ))}
        </ul>
      )}
      {open && query.trim().length >= 2 && filtered.length === 0 && (
        <div className="absolute left-0 right-0 top-full z-50 mt-1 rounded-lg border border-neutral-200 bg-white px-3 py-2 text-xs text-neutral-400 shadow-lg">
          No match — you can still type the name manually and save.
        </div>
      )}
    </div>
  );
}
