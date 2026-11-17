"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { humanizeCategory } from "@/lib/utils/format";
import { useReports } from "@/lib/store/reports";
import { submitReport } from "@/app/actions/reports";

import type { PipelineTrace } from "@/lib/trace";

interface ReportResult {
  report: {
    report_id: string;
    hazard_category: string;
    severity_level: number;
    raw_location: string;
    action_required: string;
  };
  transcript: string;
  transcript_english?: string | null;
  transcript_mock: boolean;
  degraded: boolean;
  degraded_reason?: string | null;
  trace?: PipelineTrace;
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

  const getGeo = useCallback((): Promise<{ lat: number; lng: number } | null> => {
    return new Promise((resolve) => {
      if (!navigator.geolocation) return resolve(null);
      navigator.geolocation.getCurrentPosition(
        (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
        () => resolve(null),
        { timeout: 5000 }
      );
    });
  }, []);

  const stopRecording = useCallback(() => {
    if (mediaRecorder.current && mediaRecorder.current.state === "recording") {
      mediaRecorder.current.stop();
    }
    if (timer.current) clearInterval(timer.current);
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }
  }, []);

  const processAudio = useCallback(async (blob: Blob) => {
    setState("processing");
    try {
      const geo = await getGeo();
      const formData = new FormData();
      formData.append("audio", blob, "audio.wav");
      if (geo?.lat && geo?.lng) {
        formData.append("lat", geo.lat.toString());
        formData.append("lng", geo.lng.toString());
      }

      const res = await fetch("/api/report", {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.error || `HTTP ${res.status}`);
      }

      const data = await res.json();
      setResult(data);
      addReport(data.report);
      setState("success");
    } catch (err: unknown) {
      setState("error");
      setErrorMsg(err instanceof Error ? err.message : "Failed to process audio report.");
    }
  }, [addReport, getGeo]);

  useEffect(() => {
    return () => {
      if (timer.current) clearInterval(timer.current);
      if (streamRef.current) streamRef.current.getTracks().forEach(t => t.stop());
    };
  }, []);



  const recordingStartTime = useRef<number>(0);

  const resampleTo16kWav = async (blob: Blob): Promise<Blob> => {
    if (!blob || blob.size < 100) {
      throw new Error("Recording too short or empty audio.");
    }
    const AudioContextClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const audioCtx = new AudioContextClass();
    try {
      const arrayBuffer = await blob.arrayBuffer();
      if (!arrayBuffer || arrayBuffer.byteLength === 0) {
        throw new Error("Recording too short or empty audio.");
      }
      const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
      
      const offlineCtx = new OfflineAudioContext(1, Math.max(1, Math.floor(audioBuffer.duration * 16000)), 16000);
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
      
      let offset = 44;
      const channelData = rendered.getChannelData(0);
      for (let i = 0; i < length; i++) {
        const s = Math.max(-1, Math.min(1, channelData[i] || 0));
        view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
        offset += 2;
      }
      return new Blob([wavBuffer], { type: "audio/wav" });
    } finally {
      audioCtx.close();
    }
  };

  const startRecording = useCallback(async () => {
    if (state === "recording") {
      stopRecording();
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mr = new MediaRecorder(stream);
      mediaRecorder.current = mr;
      audioChunks.current = [];
      recordingStartTime.current = Date.now();

      mr.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) {
          audioChunks.current.push(e.data);
        }
      };

      mr.onstop = async () => {
        const rawBlob = new Blob(audioChunks.current, { type: mr.mimeType || "audio/webm" });
        const duration = Date.now() - recordingStartTime.current;
        if (duration < 600 || rawBlob.size < 100) {
          setState("error");
          setErrorMsg("Recording too short. Please speak clearly for at least 1-2 seconds.");
          return;
        }

        try {
          const wavBlob = await resampleTo16kWav(rawBlob);
          await processAudio(wavBlob);
        } catch (err: unknown) {
          setState("error");
          setErrorMsg(err instanceof Error ? err.message : "Audio processing failed.");
        }
      };

      mr.start(250);
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
  }, [state, stopRecording, processAudio]);

  const submitText = async () => {
    if (!textInput.trim()) return;
    setState("processing");
    try {
      const geo = await getGeo();
      const actionRes = await submitReport({
        text: textInput,
        lat: geo?.lat,
        lng: geo?.lng,
      });

      if (!actionRes.ok) {
        throw new Error(actionRes.error);
      }

      const { report: clientReport, trace } = actionRes.data;
      setResult({
        report: clientReport,
        transcript: clientReport.transcript || textInput,
        transcript_english: clientReport.translated_english || null,
        transcript_mock: false,
        degraded: false,
        trace,
      });
      addReport(clientReport);
      setState("success");
    } catch (err: unknown) {
      setState("error");
      setErrorMsg(err instanceof Error ? err.message : "Failed to submit text");
    }
  };

  return (
    <div className="p-5 max-w-md mx-auto bg-slate-900 border border-slate-800 rounded-xl shadow-md space-y-4 text-slate-100">
      {state === "idle" && (
        <>
          <div className="flex flex-col gap-2">
            <button 
              type="button"
              onClick={startRecording}
              className="w-full py-4 bg-red-600 hover:bg-red-700 active:bg-red-800 text-white font-semibold rounded-xl text-center shadow-md transition-all flex items-center justify-center gap-2"
            >
              <span className="w-3 h-3 rounded-full bg-white animate-ping" />
              <span>Click to Start Recording</span>
            </button>
            <div className="text-center text-xs text-slate-400">Tap once to start, speak clearly, then tap stop</div>
          </div>
          <div className="text-center text-slate-500 text-xs my-1 font-medium tracking-wide">OR TYPE BELOW</div>
          <textarea 
            value={textInput} 
            onChange={e => setTextInput(e.target.value)}
            className="w-full p-2.5 bg-slate-950 border border-slate-700 rounded-md text-slate-100 placeholder-slate-500 focus:outline-none focus:border-blue-500 text-sm"
            placeholder="Describe the hazard in Hindi or English..."
            rows={3}
          />
          <div className="flex flex-col gap-1.5 my-2">
            <span className="text-xs text-slate-400 font-medium">Try a sample:</span>
            <button onClick={() => setTextInput("medical waste dumped near Karol Bagh metro pillar 44")} className="text-left text-xs bg-slate-800/80 p-2 rounded text-slate-300 hover:bg-slate-800 hover:text-white border border-slate-700/60 transition-colors">medical waste at Karol Bagh metro pillar 44</button>
            <button onClick={() => setTextInput("heavy rubble and exposed electrical wiring near Connaught Place")} className="text-left text-xs bg-slate-800/80 p-2 rounded text-slate-300 hover:bg-slate-800 hover:text-white border border-slate-700/60 transition-colors">rubble and exposed wiring near Connaught Place</button>
            <button onClick={() => setTextInput("huge garbage overflow happening in Lajpat Nagar")} className="text-left text-xs bg-slate-800/80 p-2 rounded text-slate-300 hover:bg-slate-800 hover:text-white border border-slate-700/60 transition-colors">garbage overflow in Lajpat Nagar</button>
          </div>
          <button onClick={submitText} className="w-full py-2 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-md text-sm transition-colors">Submit Text</button>
        </>
      )}

      {state === "recording" && (
        <div className="flex flex-col gap-2">
          <button 
            type="button"
            onClick={stopRecording}
            className="w-full py-5 bg-red-700 hover:bg-red-800 text-white font-bold rounded-xl shadow-lg animate-pulse flex items-center justify-center gap-2"
          >
            <span className="w-4 h-4 bg-white rounded-sm" />
            <span>Click to Stop and Submit ({time}s)</span>
          </button>
          <div className="text-center text-xs text-red-400 font-medium animate-pulse">
            Listening... Speak now, then click the button to finish.
          </div>
        </div>
      )}

      {state === "processing" && (
        <div className="text-center text-blue-400 py-6 text-sm">Processing... Please wait.</div>
      )}

      {state === "error" && (
        <div className="text-red-400 text-center py-4 bg-red-950/40 border border-red-900 rounded-lg p-3">
          <p className="text-sm">{errorMsg}</p>
          <button onClick={() => setState("idle")} className="mt-3 text-blue-400 hover:underline text-xs">Try again</button>
        </div>
      )}

      {state === "success" && result && (
        <div className="border border-emerald-800/80 p-4 rounded-lg bg-emerald-950/40 text-slate-200">
          <div className="flex items-center justify-between mb-2">
            <h3 className="font-bold text-emerald-400 text-sm">Report Generated</h3>
            {result.degraded && (
              <span className="text-xs bg-amber-950 border border-amber-700 text-amber-300 px-2 py-0.5 rounded font-mono">
                Degraded Fallback
              </span>
            )}
          </div>
          {result.degraded && result.degraded_reason && (
            <div className="mb-2 text-xs bg-amber-950/60 border border-amber-800 p-2 rounded text-amber-300">
              <strong>Degraded Notice:</strong> {result.degraded_reason}
            </div>
          )}
          <p className="text-xs"><strong>ID:</strong> {result.report.report_id}</p>
          <p className="text-xs"><strong>Category:</strong> {humanizeCategory(result.report.hazard_category)}</p>
          <p className="text-xs"><strong>Severity:</strong> {result.report.severity_level}/10</p>
          <p className="text-xs"><strong>Location:</strong> {result.report.raw_location || <span className="text-slate-400 italic">Location not resolved</span>}</p>
          <p className="text-xs"><strong>Action:</strong> {result.report.action_required}</p>

          {result.trace && (
            <div className="mt-2 text-xs bg-slate-950 p-2.5 rounded-lg border border-slate-800 space-y-1.5">
              <div className="flex justify-between items-center text-slate-400 font-semibold border-b border-slate-800 pb-1">
                <span>Pipeline trace ({result.trace.stages.length} stages)</span>
                <span className="font-mono text-emerald-400">{result.trace.totalMs}ms</span>
              </div>
              <div className="space-y-1">
                {result.trace.stages.map((st, idx) => (
                  <div key={idx} className="flex justify-between items-center text-[11px]">
                    <div className="flex items-center gap-1.5 truncate">
                      <span className={st.ok ? "text-emerald-400" : "text-red-400 font-bold"}>
                        {st.ok ? "✓" : "✗"}
                      </span>
                      <span className="font-medium text-slate-300">{st.stage}</span>
                      {st.detail && <span className="text-slate-500 truncate">({st.detail})</span>}
                    </div>
                    <span className="font-mono text-slate-400 ml-2 shrink-0">{st.ms}ms</span>
                  </div>
                ))}
              </div>
              <div className="pt-1 border-t border-slate-800/80 text-[10px] text-slate-400 flex justify-between">
                <span>Coordinate source:</span>
                <span className="font-medium text-slate-300 uppercase">
                  {result.trace.coordinateSource === "gps"
                    ? "GPS"
                    : result.trace.coordinateSource === "gazetteer"
                    ? "Gazetteer"
                    : "Unresolved"}
                </span>
              </div>
            </div>
          )}

          <div className="mt-2 text-xs text-slate-300 bg-slate-900/90 p-2.5 rounded border border-slate-800">
            <div><strong className="text-slate-400">Original ({result.report.raw_location ? "Spoken" : "Audio"}):</strong> {result.transcript}</div>
            {result.transcript_english && result.transcript_english !== result.transcript && (
              <div className="mt-1 text-slate-300"><strong className="text-blue-400">English:</strong> {result.transcript_english}</div>
            )}
          </div>
          <button onClick={() => { setState("idle"); setTextInput(""); setResult(null); }} className="mt-4 w-full py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 font-medium rounded-md text-xs transition-colors">New Report</button>
        </div>
      )}
    </div>
  );
}
