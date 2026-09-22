import React from 'react';
import { CuratedRoom } from '../types';
import { CURATED_ROOMS } from '../constants';
import { Sparkles } from 'lucide-react';

interface CuratedRoomsGalleryProps {
  selectedRoomId: string | null;
  onSelectRoom: (room: CuratedRoom) => void;
}

export const CuratedRoomsGallery: React.FC<CuratedRoomsGalleryProps> = ({
  selectedRoomId,
  onSelectRoom,
}) => {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <label className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
          <Sparkles className="w-3.5 h-3.5 text-amber-400" />
          <span>Curated Studio Presets</span>
        </label>
        <span className="text-[10px] text-slate-500">1-Click Test</span>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        {CURATED_ROOMS.map((room) => {
          const isSelected = selectedRoomId === room.id;
          return (
            <button
              key={room.id}
              type="button"
              id={`curated-room-${room.id}`}
              onClick={() => onSelectRoom(room)}
              className={`group relative text-left rounded-xl overflow-hidden border transition-all duration-200 aspect-[16/10] bg-[#14161f] ${
                isSelected
                  ? 'border-amber-400 ring-2 ring-amber-400/30 shadow-md'
                  : 'border-white/[0.08] hover:border-white/20'
              }`}
            >
              <img
                src={room.thumbnail}
                alt={room.title}
                className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
                loading="lazy"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent" />

              <div className="absolute bottom-2 left-2 right-2">
                <p className="text-[10px] font-semibold text-white leading-tight truncate">
                  {room.title}
                </p>
                <p className="text-[9px] text-amber-300/90 truncate">
                  {room.roomType}
                </p>
              </div>

              {isSelected && (
                <div className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-amber-400 shadow-sm" />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
};
