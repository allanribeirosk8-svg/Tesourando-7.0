import React from 'react';

export function LoadingScreen() {
  return (
    <div className="fixed inset-0 bg-white flex items-center justify-center z-50">
      <div className="w-10 h-10 border-4 border-[#1E1B4B] border-t-transparent rounded-full animate-spin" />
    </div>
  );
}
