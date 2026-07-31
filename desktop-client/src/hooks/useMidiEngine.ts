import { useState, useEffect, useRef } from 'react';

export interface MidiEvent {
  time: number; // in seconds
  channel: number; // 0-15
  programChange: number; // 0-127
  description?: string;
}

export const useMidiEngine = (events: MidiEvent[]) => {
  const [midiAccess, setMidiAccess] = useState<WebMidi.MIDIAccess | null>(null);
  const [outputs, setOutputs] = useState<WebMidi.MIDIOutput[]>([]);
  const [selectedOutputId, setSelectedOutputId] = useState<string>('');
  
  // Keep track of which events have already been fired so we don't spam the hardware
  const firedEvents = useRef<Set<number>>(new Set());

  useEffect(() => {
    // 1. Initialize Web MIDI API
    const initMidi = async () => {
      try {
        if (!navigator.requestMIDIAccess) {
          console.warn("Web MIDI API not supported in this browser/environment.");
          return;
        }
        
        const access = await navigator.requestMIDIAccess();
        setMidiAccess(access);

        // Map iterators to arrays
        const outputsArray: WebMidi.MIDIOutput[] = [];
        access.outputs.forEach(output => outputsArray.push(output));
        setOutputs(outputsArray);

        if (outputsArray.length > 0) {
          setSelectedOutputId(outputsArray[0].id);
        }

        access.onstatechange = (e) => {
          // Handle connection/disconnection of MIDI devices
          const updatedOutputs: WebMidi.MIDIOutput[] = [];
          access.outputs.forEach(output => updatedOutputs.push(output));
          setOutputs(updatedOutputs);
        };
      } catch (err) {
        console.error("Failed to acquire MIDI access:", err);
      }
    };

    initMidi();
  }, []);

  // 2. The Scheduler function - called by the AudioEngine loop
  const scheduleMidiEvents = (currentTime: number) => {
    if (!midiAccess || !selectedOutputId) return;

    const output = midiAccess.outputs.get(selectedOutputId);
    if (!output) return;

    events.forEach((event, index) => {
      // Lookahead window of 0.1 seconds to trigger events precisely
      // We check if the event time is within the current time window and hasn't been fired yet
      if (currentTime >= event.time && currentTime < event.time + 0.1) {
        if (!firedEvents.current.has(index)) {
          // Send Program Change message
          // Status byte for Program Change is 0xC0 (192) + channel (0-15)
          const statusByte = 0xC0 + event.channel;
          const dataByte1 = event.programChange;
          
          try {
            output.send([statusByte, dataByte1]);
            console.log(`[MIDI] Sent Program Change: ${event.programChange} on Channel: ${event.channel} at ${currentTime.toFixed(2)}s`);
            firedEvents.current.add(index);
          } catch (e) {
            console.error("Failed to send MIDI message", e);
          }
        }
      }
    });
  };

  // 3. Reset Scheduler (call this when seeking or stopping the track)
  const resetScheduler = (newTime: number = 0) => {
    // Clear all fired events that happen after the new time so they can be re-triggered
    events.forEach((event, index) => {
      if (event.time >= newTime) {
        firedEvents.current.delete(index);
      }
    });
  };

  return {
    outputs,
    selectedOutputId,
    setSelectedOutputId,
    scheduleMidiEvents,
    resetScheduler
  };
};
