import React from 'react';

interface ToggleSwitchProps {
  isOn: boolean;
  onToggle: () => void;
}

export const ToggleSwitch: React.FC<ToggleSwitchProps> = ({ isOn, onToggle }) => {
  return (
    <label htmlFor="toggle-switch" className="flex items-center cursor-pointer">
      <div className="relative">
        <input
          type="checkbox"
          id="toggle-switch"
          className="sr-only"
          checked={isOn}
          onChange={onToggle}
          role="switch"
          aria-checked={isOn}
        />
        <div className="block bg-gray-700 w-14 h-8 rounded-full shadow-inner"></div>
        <div
          className={`dot absolute left-1 top-1 bg-white w-6 h-6 rounded-full shadow-md transition-transform duration-300 ease-in-out
            ${isOn ? 'translate-x-6 bg-gradient-to-r from-sky-400 to-indigo-500' : ''}
          `}
        ></div>
      </div>
    </label>
  );
};