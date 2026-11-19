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
      streamRef.current.getTracks().forEach((t) => t.stop());
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
      if (streamRef.current) streamRef.current.getTracks().forEach((t) => t.stop());
    };
  }, []);

  const startRecording = useCallback(async () => {
    setErrorMsg("");
    audioChunks.current = [];
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mr = new MediaRecorder(stream);
      mediaRecorder.current = mr;

      mr.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunks.current.push(e.data);
      };

      mr.onstop = () => {
        const blob = new Blob(audioChunks.current, { type: "audio/wav" });
        processAudio(blob);
      };

      mr.start();
      setState("recording");
      setTime(30);

      timer.current = setInterval(() => {
        setTime((t) => {
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
  }, [processAudio, stopRecording]);

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
    <div className="w-full max-w-full p-4 sm:p-5 mx-auto bg-slate-900 border border-slate-800 rounded-xl shadow-lg space-y-4 text-slate-100 box-border">
      <div className="flex items-center justify-between border-b border-slate-800 pb-2.5">
        <div>
          <h3 className="text-sm font-bold uppercase tracking-wider text-slate-200">Incident Reporter</h3>
          <p className="text-[11px] text-slate-400">Voice or text hazard dispatch intake</p>
        </div>
        <span className="text-[10px] font-mono bg-slate-800 text-slate-400 border border-slate-700 px-2 py-0.5 rounded">
          Live Stream
        </span>
      </div>

      {state === "idle" && (
        <>
          <div className="flex flex-col gap-2">
            <button
              type="button"
              onClick={startRecording}
              className="w-full py-3.5 bg-gradient-to-r from-red-600 to-rose-600 hover:from-red-500 hover:to-rose-500 active:from-red-700 active:to-rose-700 text-white font-semibold rounded-xl text-center shadow-md transition-all flex items-center justify-center gap-2.5 cursor-pointer border border-red-500/30"
            >
              <span className="relative flex h-3 w-3">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-white opacity-75"></span>
                <span className="relative inline-flex rounded-full h-3 w-3 bg-white"></span>
              </span>
              <span className="text-sm">Click to Start Voice Recording</span>
            </button>
            <div className="text-center text-[11px] text-slate-400">
              Microphone capture in Hindi or English (max 30s)
            </div>
          </div>

          <div className="flex items-center gap-2 my-1">
            <div className="flex-1 h-px bg-slate-800"></div>
            <span className="text-slate-500 text-[10px] font-bold tracking-wider">OR ENTER TEXT</span>
            <div className="flex-1 h-px bg-slate-800"></div>
          </div>

          <textarea
            value={textInput}
            onChange={(e) => setTextInput(e.target.value)}
            className="w-full p-3 bg-slate-950 border border-slate-800 rounded-lg text-slate-100 placeholder-slate-500 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 text-xs leading-relaxed"
            placeholder="Describe the hazard location and details in Hindi or English..."
            rows={3}
          />

          <div className="flex flex-col gap-1.5">
            <span className="text-[11px] text-slate-400 font-medium">Quick dispatch samples:</span>
            <button
              type="button"
              onClick={() => setTextInput("medical waste dumped near Karol Bagh metro pillar 44")}
              className="text-left text-[11px] bg-slate-950/70 p-2 rounded border border-slate-800 hover:border-slate-700 text-slate-300 hover:text-white transition-colors truncate"
            >
              <span className="text-red-400 font-bold mr-1.5">[Biohazard]</span>
              medical waste near Karol Bagh metro pillar 44
            </button>
            <button
              type="button"
              onClick={() => setTextInput("heavy rubble and exposed electrical wiring near Connaught Place")}
              className="text-left text-[11px] bg-slate-950/70 p-2 rounded border border-slate-800 hover:border-slate-700 text-slate-300 hover:text-white transition-colors truncate"
            >
              <span className="text-amber-400 font-bold mr-1.5">[Electrical]</span>
              rubble and exposed wiring near Connaught Place
            </button>
            <button
              type="button"
              onClick={() => setTextInput("huge garbage overflow happening in Lajpat Nagar")}
              className="text-left text-[11px] bg-slate-950/70 p-2 rounded border border-slate-800 hover:border-slate-700 text-slate-300 hover:text-white transition-colors truncate"
            >
              <span className="text-emerald-400 font-bold mr-1.5">[Overflow]</span>
              garbage overflow in Lajpat Nagar
            </button>
          </div>

          <button
            type="button"
            onClick={submitText}
            disabled={!textInput.trim()}
            className="w-full py-2.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed text-white font-medium rounded-lg text-xs transition-colors cursor-pointer shadow"
          >
            Submit Text Report
          </button>
        </>
      )}

      {state === "recording" && (
        <div className="flex flex-col gap-3 p-3 bg-red-950/30 border border-red-900/60 rounded-xl">
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-2 text-xs font-semibold text-red-400">
              <span className="w-2.5 h-2.5 rounded-full bg-red-500 animate-pulse"></span>
              Recording Audio Stream
            </span>
            <span className="font-mono text-sm font-bold text-red-300">{time}s remaining</span>
          </div>

          {/* Simple Animated Audio Wave Bars */}
          <div className="flex items-center justify-center gap-1.5 h-8 py-1">
            <span className="w-1.5 bg-red-500 rounded-full animate-bounce h-3"></span>
            <span className="w-1.5 bg-red-400 rounded-full animate-bounce h-6 delay-75"></span>
            <span className="w-1.5 bg-red-500 rounded-full animate-bounce h-4 delay-150"></span>
            <span className="w-1.5 bg-red-400 rounded-full animate-bounce h-7 delay-100"></span>
            <span className="w-1.5 bg-red-500 rounded-full animate-bounce h-5 delay-200"></span>
            <span className="w-1.5 bg-red-400 rounded-full animate-bounce h-3 delay-75"></span>
          </div>

          <button
            type="button"
            onClick={stopRecording}
            className="w-full py-3 bg-red-700 hover:bg-red-600 text-white font-bold rounded-lg shadow-lg flex items-center justify-center gap-2 cursor-pointer text-xs"
          >
            <span className="w-3 h-3 bg-white rounded-sm"></span>
            <span>Stop Recording & Submit</span>
          </button>
          <div className="text-center text-[10px] text-red-300/80">
            Speak clearly into microphone. Click above when finished.
          </div>
        </div>
      )}

      {state === "processing" && (
        <div className="flex flex-col items-center justify-center py-8 space-y-3">
          <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
          <div className="text-xs font-medium text-blue-400">Processing Incident Report...</div>
          <div className="text-[10px] text-slate-500">Transcribing audio, extracting hazard and resolving ward</div>
        </div>
      )}

      {state === "error" && (
        <div className="text-red-400 text-center py-4 bg-red-950/40 border border-red-900 rounded-lg p-3 space-y-2">
          <p className="text-xs">{errorMsg}</p>
          <button
            type="button"
            onClick={() => setState("idle")}
            className="text-xs text-blue-400 hover:text-blue-300 underline cursor-pointer"
          >
            Return to form
          </button>
        </div>
      )}

      {state === "success" && result && (
        <div className="border border-emerald-800/80 p-4 rounded-lg bg-emerald-950/30 text-slate-200 space-y-3">
          <div className="flex items-center justify-between border-b border-emerald-800/60 pb-2">
            <div className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-emerald-400"></span>
              <h4 className="font-bold text-emerald-400 text-xs">Incident Recorded</h4>
            </div>
            {result.degraded && (
              <span className="text-[10px] bg-amber-950 border border-amber-700 text-amber-300 px-2 py-0.5 rounded font-mono">
                Degraded Fallback
              </span>
            )}
          </div>

          {result.degraded && result.degraded_reason && (
            <div className="text-[11px] bg-amber-950/60 border border-amber-800 p-2 rounded text-amber-300">
              <strong>Degraded Notice:</strong> {result.degraded_reason}
            </div>
          )}

          <div className="grid grid-cols-2 gap-2 text-[11px] bg-slate-950/80 p-2.5 rounded border border-slate-800">
            <div>
              <span className="text-slate-500 block">Report ID:</span>
              <span className="font-mono text-slate-200">{result.report.report_id}</span>
            </div>
            <div>
              <span className="text-slate-500 block">Severity:</span>
              <span className={`font-bold ${result.report.severity_level >= 7 ? "text-red-400" : "text-amber-400"}`}>
                {result.report.severity_level} / 10
              </span>
            </div>
            <div>
              <span className="text-slate-500 block">Category:</span>
              <span className="font-medium text-slate-200">{humanizeCategory(result.report.hazard_category)}</span>
            </div>
            <div>
              <span className="text-slate-500 block">Action:</span>
              <span className="font-mono text-[10px] text-blue-300 truncate block">{result.report.action_required}</span>
            </div>
            <div className="col-span-2">
              <span className="text-slate-500 block">Location:</span>
              <span className="text-slate-300 truncate block">
                {result.report.raw_location || <span className="text-slate-500 italic">Location not resolved</span>}
              </span>
            </div>
          </div>

          {result.trace && (
            <div className="text-[10px] bg-slate-950 p-2.5 rounded-lg border border-slate-800 space-y-1.5">
              <div className="flex justify-between items-center text-slate-400 font-semibold border-b border-slate-800 pb-1">
                <span>Pipeline trace ({result.trace.stages.length} stages)</span>
                <span className="font-mono text-emerald-400">{result.trace.totalMs}ms</span>
              </div>
              <div className="space-y-1">
                {result.trace.stages.map((st, idx) => (
                  <div key={idx} className="flex justify-between items-center text-[10px]">
                    <div className="flex items-center gap-1.5 truncate">
                      <span className={st.ok ? "text-emerald-400 font-bold" : "text-red-400 font-bold"}>
                        {st.ok ? "[OK]" : "[FAIL]"}
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

          <div className="text-[11px] text-slate-300 bg-slate-950/80 p-2.5 rounded border border-slate-800">
            <div>
              <strong className="text-slate-400">Transcript:</strong> {result.transcript}
            </div>
            {result.transcript_english && result.transcript_english !== result.transcript && (
              <div className="mt-1">
                <strong className="text-blue-400">English:</strong> {result.transcript_english}
              </div>
            )}
          </div>

          <button
            type="button"
            onClick={() => {
              setState("idle");
              setTextInput("");
              setResult(null);
            }}
            className="w-full py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 font-medium rounded-lg text-xs transition-colors cursor-pointer"
          >
            Record Another Report
          </button>
        </div>
      )}
    </div>
  );
}
