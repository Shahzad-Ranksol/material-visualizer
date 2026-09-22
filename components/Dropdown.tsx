import React, { useState } from 'react';

interface DropdownOption {
  value: string;
  label: string;
}

interface DropdownProps {
  options: DropdownOption[];
  selectedValue: string;
  onSelect: (value: string) => void;
  className?: string;
}

export const Dropdown: React.FC<DropdownProps> = ({ options, selectedValue, onSelect, className }) => {
  const [isOpen, setIsOpen] = useState(false);

  const selectedLabel = options.find(option => option.value === selectedValue)?.label || selectedValue;

  return (
    <div className={`relative ${className}`} onMouseLeave={() => setIsOpen(false)}>
      <button
        type="button"
        className="w-full flex items-center justify-between bg-slate-900 border border-slate-800 hover:border-slate-700 rounded-2xl py-3.5 px-5 text-left transition-all group"
        onClick={() => setIsOpen(!isOpen)}
      >
        <span className="text-xs font-bold uppercase tracking-widest text-slate-300 group-hover:text-white transition-colors">
          {selectedLabel}
        </span>
        <svg className={`w-4 h-4 text-slate-500 transition-transform duration-300 ${isOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" /></svg>
      </button>

      {isOpen && (
        <ul className="absolute z-50 mt-2 w-full bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl overflow-hidden py-2 animate-in fade-in slide-in-from-top-2 duration-200">
          {options.map((option) => (
            <li
              key={option.value}
              className={`px-5 py-3 text-xs font-bold uppercase tracking-widest cursor-pointer transition-colors ${
                option.value === selectedValue ? 'bg-purple-500/20 text-purple-400' : 'text-slate-500 hover:bg-slate-800 hover:text-white'
              }`}
              onClick={() => {
                onSelect(option.value);
                setIsOpen(false);
              }}
            >
              {option.label}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};