import React from 'react';

interface SpinnerProps {
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

export const Spinner: React.FC<SpinnerProps> = ({ size = 'md', className = '' }) => {
  let spinnerSizeClasses = 'w-8 h-8';
  if (size === 'sm') {
    spinnerSizeClasses = 'w-5 h-5';
  } else if (size === 'lg') {
    spinnerSizeClasses = 'w-12 h-12';
  }

  return (
    <div
      className={`animate-spin rounded-full border-4 border-t-4 border-purple-500 border-t-transparent ${spinnerSizeClasses} ${className}`}
      role="status"
    >
      <span className="sr-only">Loading...</span>
    </div>
  );
};
