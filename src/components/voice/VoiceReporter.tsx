"use client";

import { useState, useRef, useEffect } from "react";
import { humanizeCategory } from "@/lib/utils/format";
import { useReports } from "@/lib/store/reports";

interface ReportResult {
  report: {
    report_id: string;
    hazard_category: string;
    severity_level: number;
    raw_location: string;
    action_required: string;
  };
  transcript: string;
  transcript_mock: boolean;
  degraded: boolean;
}

export function VoiceReporter() {
  const [state, setState] = useState<"idle" | "recording" | "processing" | "success" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState("");
  const [time, setTime] = useState(30);
  const [result, setResult] = useState<ReportResult | null>(null);
  const [textInput, setTextInput] = useState("");
  const { addReport } = useReports();

  const mediaRecorder = useRef<MediaRecorder | null>(null);
  const audioChunks = useRef<Blob[]>([]);
  const timer = useRef<NodeJS.Timeout | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  useEffect(() => {
    return () => {
      if (timer.current) clearInterval(timer.current);
      if (streamRef.current) streamRef.current.getTracks().forEach(t => t.stop());
    };
  }, []);

  const getGeo = (): Promise<{ lat: number, lng: number } | null> => {
    return new Promise((resolve) => {
      if (!navigator.geolocation) return resolve(null);
      navigator.geolocation.getCurrentPosition(
        pos => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
        () => resolve(null),
        { timeout: 5000 }
      );
    });
  };

  const resampleTo16kWav = async (blob: Blob): Promise<Blob> => {
    const audioCtx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    const arrayBuffer = await blob.arrayBuffer();
    const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
    
    const offlineCtx = new OfflineAudioContext(1, audioBuffer.duration * 16000, 16000);
    const source = offlineCtx.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(offlineCtx.destination);
    source.start(0);
    const rendered = await offlineCtx.startRendering();
    
    const length = rendered.length;
    const wavBuffer = new ArrayBuffer(44 + length * 2);
    const view = new DataView(wavBuffer);
    
    const writeString = (offset: number, str: string) => {
      for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
    };
    writeString(0, 'RIFF');
    view.setUint32(4, 36 + length * 2, true);
    writeString(8, 'WAVE');
    writeString(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true); 
    view.setUint16(22, 1, true); 
    view.setUint32(24, 16000, true);
    view.setUint32(28, 16000 * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    writeString(36, 'data');
    view.setUint32(40, length * 2, true);
    
    const channelData = rendered.getChannelData(0);
    let offset = 44;
    for (let i = 0; i < length; i++) {
      const s = Math.max(-1, Math.min(1, channelData[i] || 0));
      view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
      offset += 2;
    }
    
    return new Blob([wavBuffer], { type: 'audio/wav' });
  };

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      mediaRecorder.current = new MediaRecorder(stream);
      audioChunks.current = [];
      
      mediaRecorder.current.ondataavailable = e => {
        if (e.data.size > 0) audioChunks.current.push(e.data);
      };
      
      mediaRecorder.current.onstop = async () => {
        if (timer.current) clearInterval(timer.current);
        const blob = new Blob(audioChunks.current, { type: 'audio/webm' });
        processAudio(blob);
      };

      mediaRecorder.current.start(200);
      setState("recording");
      setTime(30);
      
      timer.current = setInterval(() => {
        setTime(t => {
          if (t <= 1) {
            stopRecording();
            return 0;
          }
          return t - 1;
        });
      }, 1000);
    } catch {
      setState("error");
      setErrorMsg("Microphone access denied or unsupported.");
    }
  };

  const stopRecording = () => {
    if (mediaRecorder.current && mediaRecorder.current.state !== "inactive") {
      mediaRecorder.current.stop();
      streamRef.current?.getTracks().forEach(t => t.stop());
    }
  };

  const processAudio = async (rawBlob: Blob) => {
    setState("processing");
    try {
      const wavBlob = await resampleTo16kWav(rawBlob);
      const geo = await getGeo();
      
      const formData = new FormData();
      formData.append("audio", wavBlob, "recording.wav");
      if (geo) {
        formData.append("lat", geo.lat.toString());
        formData.append("lng", geo.lng.toString());
      }
      
      const res = await fetch("/api/report", { method: "POST", body: formData });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Server error");
      setResult(data);
      if (data.report) addReport(data.report);
      setState("success");
    } catch (err: unknown) {
      setState("error");
      setErrorMsg((err as Error).message || "Failed to process audio");
    }
  };

  const submitText = async () => {
    if (!textInput.trim()) return;
    setState("processing");
    try {
      const geo = await getGeo();
      const payload: Record<string, unknown> = { text: textInput };
      if (geo) {
        payload.lat = geo.lat;
        payload.lng = geo.lng;
      }
      const res = await fetch("/api/report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Server error");
      setResult(data);
      if (data.report) addReport(data.report);
      setState("success");
    } catch (err: unknown) {
      setState("error");
      setErrorMsg((err as Error).message || "Failed to submit text");
    }
  };

  return (
    <div className="p-6 max-w-md mx-auto bg-white rounded-xl shadow-md space-y-4">
      {state === "idle" && (
        <>
          <button 
            onPointerDown={startRecording}
            className="w-full py-4 bg-red-500 text-white rounded-lg active:bg-red-600 select-none"
            style={{ touchAction: "none" }}
          >
            Hold to Record
          </button>
          <div className="text-center text-gray-500">or type below</div>
          <textarea 
            value={textInput} 
            onChange={e => setTextInput(e.target.value)}
            className="w-full p-2 border rounded-md text-black"
            placeholder="Describe the hazard in Hindi or English..."
          />
          <div className="flex flex-col gap-2 my-2">
            <span className="text-xs text-slate-500">Try a sample:</span>
            <button onClick={() => setTextInput("medical waste dumped near Karol Bagh metro pillar 44")} className="text-left text-xs bg-slate-100 p-2 rounded text-black hover:bg-slate-200">medical waste at Karol Bagh metro pillar 44</button>
            <button onClick={() => setTextInput("heavy rubble and exposed electrical wiring near Connaught Place")} className="text-left text-xs bg-slate-100 p-2 rounded text-black hover:bg-slate-200">rubble and exposed wiring near Connaught Place</button>
            <button onClick={() => setTextInput("huge garbage overflow happening in Lajpat Nagar")} className="text-left text-xs bg-slate-100 p-2 rounded text-black hover:bg-slate-200">garbage overflow in Lajpat Nagar</button>
          </div>
          <button onClick={submitText} className="w-full py-2 bg-blue-500 text-white rounded-md">Submit Text</button>
        </>
      )}

      {state === "recording" && (
        <button 
          onPointerUp={stopRecording}
          onPointerLeave={stopRecording}
          className="w-full py-4 bg-red-700 text-white rounded-lg select-none animate-pulse"
          style={{ touchAction: "none" }}
        >
          Recording... Release to stop ({time}s)
        </button>
      )}

      {state === "processing" && (
        <div className="text-center text-blue-600">Processing... Please wait.</div>
      )}

      {state === "error" && (
        <div className="text-red-600 text-center">
          <p>{errorMsg}</p>
          <button onClick={() => setState("idle")} className="mt-4 text-blue-500 underline">Try again</button>
        </div>
      )}

      {state === "success" && result && (
        <div className="border p-4 rounded-lg bg-green-50 text-black">
          <h3 className="font-bold text-green-700 mb-2">Report Generated!</h3>
          <p className="text-sm"><strong>ID:</strong> {result.report.report_id}</p>
          <p className="text-sm"><strong>Category:</strong> {humanizeCategory(result.report.hazard_category)}</p>
          <p className="text-sm"><strong>Severity:</strong> {result.report.severity_level}/10</p>
          <p className="text-sm"><strong>Location:</strong> {result.report.raw_location}</p>
          <p className="text-sm"><strong>Action:</strong> {result.report.action_required}</p>
          <div className="mt-2 text-xs text-gray-600">Transcript: {result.transcript}</div>
          <button onClick={() => { setState("idle"); setTextInput(""); setResult(null); }} className="mt-4 w-full py-2 bg-gray-200 text-gray-800 rounded-md">New Report</button>
        </div>
      )}
    </div>
  );
}
