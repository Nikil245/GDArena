"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import {
  AlertCircle,
  RefreshCw,
  Volume2,
  WifiOff,
  X,
} from "lucide-react";
import { AppHeader } from "@/components/AppHeader";
import { LeaderboardPanel } from "@/components/LeaderboardPanel";
import { LobbyPanel } from "@/components/LobbyPanel";
import { ModeratorPanel } from "@/components/ModeratorPanel";
import { ResultsView } from "@/components/ResultsView";
import {
  RoomHeaderControls,
  RoomMobileStatusStrip,
} from "@/components/RoomHeaderControls";
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
    <RoomHeaderControls
      roomCode={roomCode}
      you={you}
      connectionStatus={state.status}
      muted={aiSpeech.muted}
      testingVoice={aiSpeech.testingVoice}
      onToggleMute={aiSpeech.toggleMute}
      onTestVoice={aiSpeech.testVoice}
    />
  );

  const mobileStatusStrip = (
    <RoomMobileStatusStrip connectionStatus={state.status} />
  );

  // Fatal error screen (invalid room code or expired token)
  if (state.fatalError) {
    return (
      <div className="min-h-screen bg-page">
        <AppHeader />
        <main className="app-container py-10 sm:py-14">
          <div
            role="alert"
            className="ui-card max-w-lg border-danger-border p-6"
          >
            <div className="flex items-start gap-3">
              <AlertCircle
                className="mt-0.5 h-5 w-5 shrink-0 text-danger-text"
                strokeWidth={1.75}
              />
              <div>
                <h1 className="text-base font-semibold text-ink">
                  {state.fatalError.code === "room_not_found"
                    ? "Room Not Found"
                    : "Session Error"}
                </h1>
                <p className="mt-1 text-sm text-ink-muted">
                  {state.fatalError.message}
                </p>
                <div className="mt-5 flex flex-wrap gap-2.5">
                  {state.fatalError.code === "invalid_token" && (
                    <Link
                      href={`/join?code=${encodeURIComponent(roomCode)}`}
                      className="ui-btn-primary"
                    >
                      Rejoin Room
                    </Link>
                  )}
                  <Link href="/join" className="ui-btn-secondary">
                    Enter Another Code
                  </Link>
                  <Link href="/" className="ui-btn-secondary">
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
      <div className="min-h-screen bg-page">
        <AppHeader rightSlot={headerRight} subHeader={mobileStatusStrip} />
        <main className="app-container py-10 sm:py-12">
          <div className="ui-card p-8 text-center">
            <p className="text-sm font-semibold text-ink">
              {state.status === "reconnecting"
                ? "Reconnecting to discussion room..."
                : `Connecting to room ${roomCode}...`}
            </p>
            <p className="mt-1 text-caption text-ink-muted">
              Synchronising live room state from the server.
            </p>
            {state.status === "reconnecting" && (
              <button
                type="button"
                onClick={actions.reconnectNow}
                className="ui-btn-secondary mt-4"
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
    <div className="min-h-screen bg-page">
      <AppHeader rightSlot={headerRight} subHeader={mobileStatusStrip} />

      <main className="app-container space-y-4 py-4 sm:py-6">
        {/* Reconnecting banner */}
        {state.status === "reconnecting" && (
          <div
            role="status"
            className="ui-card flex flex-wrap items-center justify-between gap-2 border-line-strong px-4 py-2.5 text-sm text-ink"
          >
            <div className="flex items-center gap-2">
              <WifiOff
                className="h-4 w-4 shrink-0 text-ink-muted"
                strokeWidth={1.75}
              />
              <span>
                Connection interrupted. Reconnecting automatically...
              </span>
            </div>
            <button
              type="button"
              onClick={actions.reconnectNow}
              className="ui-btn-secondary min-h-[36px] px-3 py-1 text-xs"
            >
              <RefreshCw className="h-3 w-3" strokeWidth={1.75} />
              Retry Now
            </button>
          </div>
        )}

        {/* Spectator callout when user opened /room/[code] directly */}
        {!you && snapshot.room.status !== "finished" && (
          <div className="ui-card flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-sm text-ink-secondary">
            <span>
              You are viewing room{" "}
              <strong className="text-ink">{roomCode}</strong> as a read-only
              spectator.
            </span>
            {snapshot.room.status === "lobby" && (
              <Link
                href={`/join?code=${encodeURIComponent(roomCode)}`}
                className="ui-btn-primary min-h-[36px] px-3 py-1 text-xs"
              >
                Join Room
              </Link>
            )}
          </div>
        )}

        {/* Browser autoplay blocked banner */}
        {aiSpeech.autoplayBlocked && !aiSpeech.muted && (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-card border border-accent bg-accent-soft px-4 py-2.5 text-sm text-accent-text shadow-card">
            <div className="flex items-center gap-2">
              <Volume2
                className="h-4 w-4 shrink-0 text-accent"
                strokeWidth={1.75}
              />
              <span>Your browser blocked automatic AI audio playback.</span>
            </div>
            <button
              type="button"
              onClick={aiSpeech.enableAudio}
              className="ui-btn-primary min-h-[36px] px-3 py-1 text-xs"
            >
              Click here to enable AI voices
            </button>
          </div>
        )}

        {/* Voice test error / notice */}
        {aiSpeech.voiceNotice && (
          <div
            role="alert"
            className="flex items-center justify-between gap-3 rounded-card border border-danger-border bg-danger-bg px-4 py-2.5 text-sm text-danger-text shadow-card"
          >
            <div className="flex items-center gap-2">
              <AlertCircle className="h-4 w-4 shrink-0" strokeWidth={1.75} />
              <span>{aiSpeech.voiceNotice}</span>
            </div>
            <button
              type="button"
              onClick={aiSpeech.clearVoiceNotice}
              aria-label="Dismiss voice notice"
              className="ui-focus rounded-chip p-1.5 text-danger-text transition-colors duration-150 hover:bg-red-100"
            >
              <X className="h-4 w-4" strokeWidth={1.75} />
            </button>
          </div>
        )}

        {/* Non-fatal WebSocket error alert */}
        {state.lastError && (
          <div
            role="alert"
            className="flex items-center justify-between gap-3 rounded-card border border-danger-border bg-danger-bg px-4 py-2.5 text-sm text-danger-text shadow-card"
          >
            <div className="flex items-center gap-2">
              <AlertCircle className="h-4 w-4 shrink-0" strokeWidth={1.75} />
              <span>{state.lastError.message}</span>
            </div>
            <button
              type="button"
              onClick={actions.clearError}
              aria-label="Dismiss error"
              className="ui-focus rounded-chip p-1.5 text-danger-text transition-colors duration-150 hover:bg-red-100"
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
                <div className="min-w-0 space-y-4 lg:col-span-7">
                  <RoundTable
                    room={snapshot.room}
                    participants={snapshot.participants}
                    currentSpeaker={snapshot.current_speaker}
                    ttsSpeakingParticipantId={aiSpeech.aiSpeakingParticipantId}
                    isHumanRecording={isHumanRecording}
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

                <div className="min-w-0 space-y-4 lg:col-span-5">
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

