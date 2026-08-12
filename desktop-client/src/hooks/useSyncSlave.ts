import { useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { RealtimeChannel } from '@supabase/supabase-js';
import { SyncMessage } from './useSyncMaster';

export function useSyncSlave(bandId: string) {
  const channelRef = useRef<RealtimeChannel | null>(null);
  
  // Slave state
  const [currentSongId, setCurrentSongId] = useState<string | null>(null);
  const [songData, setSongData] = useState<any>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  
  // Transport control signals triggered by Master
  const [playTrigger, setPlayTrigger] = useState<{ startAt: number, offset: number } | null>(null);
  const [pauseTrigger, setPauseTrigger] = useState<{ time: number } | null>(null);
  const [seekTrigger, setSeekTrigger] = useState<{ offset: number } | null>(null);

  useEffect(() => {
    if (!bandId) return;

    const channel = supabase.channel(`sync-${bandId}`, {
      config: {
        presence: {
          key: `slave-${Math.random().toString(36).substr(2, 9)}`,
        },
      },
    });

    channel
      .on('broadcast', { event: 'transport' }, ({ payload }) => {
        const msg = payload as SyncMessage;
        
        switch (msg.type) {
          case 'LOAD_SONG':
            if (msg.songId) {
              setCurrentSongId(msg.songId);
              setSongData(msg.songData);
              setIsPlaying(false);
              setPauseTrigger({ time: Date.now() }); // Force pause
            }
            break;
          case 'PLAY':
            if (msg.startAt !== undefined && msg.offset !== undefined) {
              setPlayTrigger({ startAt: msg.startAt, offset: msg.offset });
              setIsPlaying(true);
            }
            break;
          case 'PAUSE':
            setPauseTrigger({ time: Date.now() });
            setIsPlaying(false);
            break;
          case 'SEEK':
            if (msg.offset !== undefined) {
              setSeekTrigger({ offset: msg.offset });
            }
            break;
        }
      })
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          channel.track({ isMaster: false });
        }
      });

    channelRef.current = channel;

    return () => {
      supabase.removeChannel(channel);
    };
  }, [bandId]);

  return { 
    currentSongId, 
    songData, 
    isPlaying,
    playTrigger,
    pauseTrigger,
    seekTrigger
  };
}
