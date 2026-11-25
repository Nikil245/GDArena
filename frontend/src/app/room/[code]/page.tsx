"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import {
  AlertCircle,
  Check,
  Copy,
  LogOut,
  RefreshCw,
  Volume2,
  VolumeX,
  Wifi,
  WifiOff,
  X,
} from "lucide-react";
import { AppHeader } from "@/components/AppHeader";
import { LeaderboardPanel } from "@/components/LeaderboardPanel";
import { LobbyPanel } from "@/components/LobbyPanel";
import { ModeratorPanel } from "@/components/ModeratorPanel";
import { ResultsView } from "@/components/ResultsView";
import { RoundTable } from "@/components/RoundTable";
import { TimerBanner } from "@/components/TimerBanner";
import { TranscriptPanel } from "@/components/TranscriptPanel";
import { TurnControls } from "@/components/TurnControls";
import { useAiSpeech } from "@/hooks/useAiSpeech";
import { useRoomSocket } from "@/hooks/useRoomSocket";
import { clearRoomSession, loadRoomSession } from "@/lib/storage";
import type { StoredSession } from "@/lib/types";

interface RoomPageProps {
  params: Promise<{ code: string }>;
}

export default function RoomPage({ params }: RoomPageProps) {
  const { code: rawCode } = use(params);
  const roomCode = rawCode.trim().toUpperCase();

  const [sessionLoaded, setSessionLoaded] = useState(false);
  const [session, setSession] = useState<StoredSession | null>(null);
  const [copiedCode, setCopiedCode] = useState(false);
  const [isHumanRecording, setIsHumanRecording] = useState(false);

  useEffect(() => {
    const stored = loadRoomSession(roomCode);
    setSession(stored);
    setSessionLoaded(true);
  }, [roomCode]);

  const { state, actions } = useRoomSocket(
    roomCode,
    session?.token ?? null,
    sessionLoaded
  );

  // Clear invalid stored session if server rejects the token
  useEffect(() => {
    if (state.fatalError?.code === "invalid_token") {
      clearRoomSession(roomCode);
    }
  }, [state.fatalError, roomCode]);

  const copyCode = async () => {
    try {
      await navigator.clipboard.writeText(roomCode);
      setCopiedCode(true);
      setTimeout(() => setCopiedCode(false), 1800);
    } catch {
      // Ignore
    }
  };

  const snapshot = state.snapshot;
  const you = state.you;
  const isDisconnected = state.status !== "connected";
  const canModerate = Boolean(you?.can_moderate);

  const aiSpeech = useAiSpeech({
    transcript: snapshot?.transcript,
    participants: snapshot?.participants,
    roomStatus: snapshot?.room.status,
    welcomeCount: state.welcomeCount,
    isHumanRecording,
    onPlaybackEnded: actions.reportPlaybackEnded,
  });

  const headerRight = (
    <div className="flex flex-wrap items-center gap-2 sm:gap-3">
      <button
        type="button"
        onClick={copyCode}
        title="Copy room code"
        className="inline-flex items-center gap-1.5 rounded border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-semibold tracking-wider text-slate-800 transition-colors duration-150 hover:border-slate-300"
      >
        {copiedCode ? (
          <Check className="h-3.5 w-3.5 text-green-700" strokeWidth={2} />
        ) : (
          <Copy className="h-3.5 w-3.5 text-slate-500" strokeWidth={1.75} />
        )}
        {roomCode}
      </button>

      {you && (
        <span className="hidden rounded border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 sm:inline-block">
          {you.name} ·{" "}
          {you.role === "moderator"
            ? "Moderator"
            : you.can_moderate
            ? "Player (Host)"
            : "Player"}
        </span>
      )}

      <span
        className={`inline-flex items-center gap-1 rounded border px-2 py-1 text-xs font-medium ${
          state.status === "connected"
            ? "border-green-200 bg-green-50 text-green-800"
            : state.status === "reconnecting"
            ? "border-amber-200 bg-amber-50 text-amber-900"
            : state.status === "error"
            ? "border-red-200 bg-red-50 text-red-800"
            : "border-slate-200 bg-slate-50 text-slate-600"
        }`}
      >
        {state.status === "connected" ? (
          <Wifi className="h-3 w-3" strokeWidth={2} />
        ) : (
          <WifiOff className="h-3 w-3" strokeWidth={2} />
        )}
        {state.status === "connected"
          ? "Connected"
          : state.status === "reconnecting"
          ? "Reconnecting..."
          : state.status === "error"
          ? "Disconnected"
          : "Connecting..."}
      </span>

      <button
        type="button"
        onClick={aiSpeech.toggleMute}
        title={aiSpeech.muted ? "Unmute AI voices" : "Mute AI voices"}
        className={`inline-flex items-center gap-1 rounded border px-2.5 py-1 text-xs font-medium transition-colors duration-150 ${
          aiSpeech.muted
            ? "border-slate-300 bg-slate-100 text-slate-600 hover:bg-slate-200"
            : "border-slate-300 bg-white text-slate-700 hover:border-slate-400 hover:bg-slate-50"
        }`}
      >
        {aiSpeech.muted ? (
          <VolumeX className="h-3.5 w-3.5 text-slate-500" strokeWidth={1.75} />
        ) : (
          <Volume2 className="h-3.5 w-3.5 text-blue-800" strokeWidth={1.75} />
        )}
        <span className="hidden sm:inline">
          {aiSpeech.muted ? "AI Muted" : "AI Voice"}
        </span>
      </button>

      <button
        type="button"
        onClick={aiSpeech.testVoice}
        disabled={aiSpeech.testingVoice}
        title="Test server-side AI voice playback"
        className="inline-flex items-center gap-1 rounded border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 transition-colors duration-150 hover:border-slate-400 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {aiSpeech.testingVoice ? "Testing..." : "Test voice"}
      </button>

      <Link
        href="/"
        title="Leave room"
        className="inline-flex items-center gap-1 rounded border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 transition-colors duration-150 hover:border-slate-400 hover:bg-slate-50"
      >
        <LogOut className="h-3.5 w-3.5" strokeWidth={1.75} />
        <span className="hidden sm:inline">Leave</span>
      </Link>
    </div>
  );

  // Fatal error screen (invalid room code or expired token)
  if (state.fatalError) {
    return (
      <div className="min-h-screen bg-slate-50">
        <AppHeader />
        <main className="mx-auto max-w-lg px-4 py-16">
          <div className="rounded-md border border-red-200 bg-white p-6">
            <div className="flex items-start gap-3">
              <AlertCircle
                className="mt-0.5 h-5 w-5 shrink-0 text-red-700"
                strokeWidth={1.75}
              />
              <div>
                <h1 className="text-base font-semibold text-slate-900">
                  {state.fatalError.code === "room_not_found"
                    ? "Room Not Found"
                    : "Session Error"}
                </h1>
                <p className="mt-1 text-sm text-slate-600">
                  {state.fatalError.message}
                </p>
                <div className="mt-4 flex flex-wrap gap-2.5">
                  {state.fatalError.code === "invalid_token" && (
                    <Link
                      href={`/join?code=${encodeURIComponent(roomCode)}`}
                      className="rounded bg-blue-800 px-4 py-2 text-sm font-medium text-white transition-colors duration-150 hover:bg-blue-900"
                    >
                      Rejoin Room
                    </Link>
                  )}
                  <Link
                    href="/join"
                    className="rounded border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                  >
                    Enter Another Code
                  </Link>
                  <Link
                    href="/"
                    className="rounded border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                  >
                    Create New Room
                  </Link>
                </div>
              </div>
            </div>
          </div>
        </main>
      </div>
    );
  }

  // Initial loading state
  if (!sessionLoaded || !snapshot) {
    return (
      <div className="min-h-screen bg-slate-50">
        <AppHeader rightSlot={headerRight} />
        <main className="mx-auto max-w-7xl px-4 py-12 sm:px-6">
          <div className="rounded-md border border-slate-200 bg-white p-8 text-center">
            <p className="text-sm font-medium text-slate-800">
              {state.status === "reconnecting"
                ? "Reconnecting to discussion room..."
                : `Connecting to room ${roomCode}...`}
            </p>
            <p className="mt-1 text-xs text-slate-500">
              Synchronising live room state from the server.
            </p>
            {state.status === "reconnecting" && (
              <button
                type="button"
                onClick={actions.reconnectNow}
                className="mt-4 inline-flex items-center gap-1.5 rounded border border-slate-300 bg-white px-3.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
              >
                <RefreshCw className="h-3.5 w-3.5" strokeWidth={1.75} />
                Retry Now
              </button>
            )}
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <AppHeader rightSlot={headerRight} />

      <main className="mx-auto max-w-7xl space-y-4 px-4 py-5 sm:px-6">
        {/* Reconnecting banner */}
        {state.status === "reconnecting" && (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-amber-300 bg-amber-50 px-4 py-2.5 text-sm text-amber-900">
            <div className="flex items-center gap-2">
              <WifiOff className="h-4 w-4 shrink-0" strokeWidth={1.75} />
              <span>
                Connection interrupted. Reconnecting automatically...
              </span>
            </div>
            <button
              type="button"
              onClick={actions.reconnectNow}
              className="inline-flex items-center gap-1 rounded border border-amber-400 bg-white px-2.5 py-1 text-xs font-medium text-amber-900 hover:bg-amber-100"
            >
              <RefreshCw className="h-3 w-3" strokeWidth={1.75} />
              Retry Now
            </button>
          </div>
        )}

        {/* Spectator callout when user opened /room/[code] directly */}
        {!you && snapshot.room.status !== "finished" && (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-slate-300 bg-white px-4 py-2.5 text-sm text-slate-700">
            <span>
              You are viewing room <strong>{roomCode}</strong> as a read-only
              spectator.
            </span>
            {snapshot.room.status === "lobby" && (
              <Link
                href={`/join?code=${encodeURIComponent(roomCode)}`}
                className="rounded bg-blue-800 px-3 py-1 text-xs font-semibold text-white hover:bg-blue-900"
              >
                Join Room
              </Link>
            )}
          </div>
        )}

        {/* Browser autoplay blocked banner */}
        {aiSpeech.autoplayBlocked && !aiSpeech.muted && (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-blue-800 bg-blue-50 px-4 py-2.5 text-sm text-blue-900">
            <div className="flex items-center gap-2">
              <Volume2 className="h-4 w-4 shrink-0 text-blue-800" strokeWidth={1.75} />
              <span>Your browser blocked automatic AI audio playback.</span>
            </div>
            <button
              type="button"
              onClick={aiSpeech.enableAudio}
              className="rounded bg-blue-800 px-3 py-1 text-xs font-semibold text-white transition-colors duration-150 hover:bg-blue-900"
            >
              Click here to enable AI voices
            </button>
          </div>
        )}

        {/* Voice test error / notice */}
        {aiSpeech.voiceNotice && (
          <div className="flex items-center justify-between gap-3 rounded-md border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-800">
            <div className="flex items-center gap-2">
              <AlertCircle className="h-4 w-4 shrink-0" strokeWidth={1.75} />
              <span>{aiSpeech.voiceNotice}</span>
            </div>
            <button
              type="button"
              onClick={aiSpeech.clearVoiceNotice}
              aria-label="Dismiss voice notice"
              className="rounded p-1 text-red-700 hover:bg-red-100"
            >
              <X className="h-4 w-4" strokeWidth={1.75} />
            </button>
          </div>
        )}

        {/* Non-fatal WebSocket error alert */}
        {state.lastError && (
          <div className="flex items-center justify-between gap-3 rounded-md border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-800">
            <div className="flex items-center gap-2">
              <AlertCircle className="h-4 w-4 shrink-0" strokeWidth={1.75} />
              <span>{state.lastError.message}</span>
            </div>
            <button
              type="button"
              onClick={actions.clearError}
              aria-label="Dismiss error"
              className="rounded p-1 text-red-700 hover:bg-red-100"
            >
              <X className="h-4 w-4" strokeWidth={1.75} />
            </button>
          </div>
        )}

        {/* Finished State -> Results Screen */}
        {snapshot.room.status === "finished" ? (
          <ResultsView
            room={snapshot.room}
            timer={snapshot.timer}
            leaderboard={snapshot.leaderboard}
            transcript={snapshot.transcript}
            reportStatus={snapshot.report_status}
            report={snapshot.report}
            youId={you?.id ?? null}
          />
        ) : (
          <>
            {/* Topic + Server Countdown Timer Banner */}
            <TimerBanner
              room={snapshot.room}
              timer={snapshot.timer}
              currentSpeaker={snapshot.current_speaker}
            />

            {/* Lobby View */}
            {snapshot.room.status === "lobby" ? (
              <div className="space-y-4">
                <LobbyPanel
                  room={snapshot.room}
                  participants={snapshot.participants}
                  you={you}
                  disabled={isDisconnected}
                  onStartGd={actions.startGd}
                />
                <RoundTable
                  room={snapshot.room}
                  participants={snapshot.participants}
                  currentSpeaker={snapshot.current_speaker}
                  queue={snapshot.queue}
                  youId={you?.id ?? null}
                />
              </div>
            ) : (
              /* Running Discussion View */
              <div className="grid gap-4 lg:grid-cols-12">
                <div className="space-y-4 lg:col-span-7">
                  <RoundTable
                    room={snapshot.room}
                    participants={snapshot.participants}
                    currentSpeaker={snapshot.current_speaker}
                    ttsSpeakingParticipantId={aiSpeech.aiSpeakingParticipantId}
                    queue={snapshot.queue}
                    youId={you?.id ?? null}
                  />

                  <TurnControls
                    you={you}
                    currentSpeaker={snapshot.current_speaker}
                    queue={snapshot.queue}
                    turnRemainingSeconds={snapshot.timer.turn_remaining_seconds}
                    disabled={isDisconnected}
                    onRecordingChange={setIsHumanRecording}
                    onRaiseHand={actions.raiseHand}
                    onLowerHand={() => actions.lowerHand()}
                    onSubmitTurn={actions.submitTurn}
                    onYieldTurn={actions.yieldTurn}
                  />

                  {canModerate && (
                    <ModeratorPanel
                      room={snapshot.room}
                      participants={snapshot.participants}
                      currentSpeaker={snapshot.current_speaker}
                      transcript={snapshot.transcript}
                      disabled={isDisconnected}
                      onStartGd={actions.startGd}
                      onEndGd={actions.endGd}
                      onSkipSpeaker={actions.skipSpeaker}
                      onGrantTurn={actions.grantTurn}
                      onAdjustScore={actions.adjustScore}
                    />
                  )}
                </div>

                <div className="space-y-4 lg:col-span-5">
                  <TranscriptPanel
                    entries={snapshot.transcript}
                    activity={state.activity}
                    showComments={canModerate}
                  />

                  <LeaderboardPanel
                    rows={snapshot.leaderboard}
                    youId={you?.id ?? null}
                  />
                </div>
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}

