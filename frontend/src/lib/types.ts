/**
 * TypeScript definitions strictly aligned with /backend/API_CONTRACT.md
 * and backend/app/schemas.py, backend/app/core/runtime.py.
 */

export type TopicCategory =
  | "current_affairs"
  | "business"
  | "social"
  | "abstract";

export type TopicSource = "user" | "bank";

export type RoomStatus = "lobby" | "running" | "finished";

export type Role = "player" | "moderator";

export type EndReason = "timer" | "moderator" | "server_restart";

export type ReportStatus = "generating" | "ready" | "failed" | null;

export type ServiceHealthState = "ok" | "degraded" | "exhausted";

export type TurnScoreStatus = "pending" | "scored" | "not_scored";

export type SpeakerPhase = "thinking" | "speaking";

export type TurnSource = "text" | "voice" | "ai";

export type SkipReason =
  | "yielded"
  | "time_up"
  | "disconnected"
  | "moderator_skip"
  | "ai_error";

export interface Persona {
  key: string;
  label: string;
  description: string;
  name?: string;
  voice?: string;
  rate?: string;
  groq_voice?: string | null;
  indian_voice?: string;
}

export interface Room {
  code: string;
  topic: string;
  topic_category: TopicCategory | null;
  topic_source: TopicSource;
  status: RoomStatus;
  max_participants: number;
  seats_taken: number;
  duration_seconds: number;
  turn_limit_seconds: number | null;
  fill_with_ai: boolean;
  has_moderator: boolean;
  created_at: string;
  started_at: string | null;
  ends_at: string | null;
  ended_at: string | null;
  end_reason: EndReason | null;
}

export interface Participant {
  id: number;
  name: string;
  role: Role;
  is_ai: boolean;
  persona: Persona | null;
  connected: boolean;
  hand_raised: boolean;
  is_speaking: boolean;
  can_moderate: boolean;
}

export interface TimerState {
  status: RoomStatus;
  duration_seconds: number;
  remaining_seconds: number;
  elapsed_seconds: number;
  ends_at: string | null;
  turn_limit_seconds: number | null;
  turn_remaining_seconds: number | null;
}

export interface Speaker {
  participant_id: number;
  name: string;
  is_ai: boolean;
  seq: number;
  phase: SpeakerPhase;
  started_at: string;
  deadline_at: string | null;
}

export interface QueueItem {
  participant_id: number;
  name: string;
  is_ai: boolean;
}

export interface ScoreBreakdown {
  relevance: number;
  clarity: number;
  content: number;
  teamwork: number;
}

export interface ScoreAverages {
  relevance: number | null;
  clarity: number | null;
  content: number | null;
  teamwork: number | null;
}

export interface TranscriptEntry {
  turn_id: number;
  seq: number;
  participant_id: number;
  name: string;
  is_ai: boolean;
  text: string;
  source: TurnSource;
  audio_url: string | null;
  audio_duration_seconds?: number | null;
  started_at: string;
  ended_at: string;
  scores: ScoreBreakdown | null;
  comment: string | null;
  turn_score: number | null;
  score_status?: TurnScoreStatus;
  score_reason?: string | null;
}

export interface LeaderboardRow {
  rank: number;
  participant_id: number;
  name: string;
  is_ai: boolean;
  turns: number;
  scored_turns: number;
  unscored_turns?: number;
  average: ScoreAverages;
  average_turn_score: number | null;
  adjustments: number;
  total_score: number;
}

export interface BestPerformer {
  participant_id: number;
  name: string;
  is_ai: boolean;
  total_score: number;
  reason: string;
}

export interface ParticipantReport {
  participant_id: number;
  name: string;
  is_ai: boolean;
  persona: Persona | null;
  rank: number;
  total_score: number;
  turns: number;
  scored_turns?: number;
  unscored_turns?: number;
  average: ScoreAverages;
  average_turn_score: number | null;
  adjustments: number;
  strengths: string[];
  improvements: string[];
  summary: string;
}

export interface FinalReport {
  room_code: string;
  topic: string;
  generated_at: string;
  started_at: string | null;
  ended_at: string | null;
  end_reason: EndReason | null;
  total_turns: number;
  unscored_turns?: number;
  scoring_note?: string | null;
  best_performer: BestPerformer | null;
  participants: ParticipantReport[];
}

export interface WsServiceStatusData {
  service: "llm" | "stt";
  state: ServiceHealthState;
  retry_at: string | null;
  message: string;
  continue_without_ai?: boolean;
}

export interface RoomSnapshot {
  room: Room;
  participants: Participant[];
  timer: TimerState;
  current_speaker: Speaker | null;
  queue: QueueItem[];
  transcript: TranscriptEntry[];
  leaderboard: LeaderboardRow[];
  report_status: ReportStatus;
  report: FinalReport | null;
  service_status?: WsServiceStatusData;
}

// ---------------------------------------------------------------------------
// REST request & response types
// ---------------------------------------------------------------------------

export interface CreateRoomRequest {
  topic: string | null;
  topic_category?: TopicCategory | null;
  max_participants: number;
  duration_seconds: number;
  turn_limit_seconds: number | null;
  fill_with_ai?: boolean;
}

export interface JoinRoomRequest {
  name: string;
  role: Role;
}

export interface JoinRoomResponse {
  participant: Participant;
  token: string;
  ws_url: string;
  room: Room;
}

export interface TopicItem {
  id: string;
  title: string;
  category: TopicCategory;
}

export interface TopicsResponse {
  categories: Record<TopicCategory, string>;
  topics: TopicItem[];
}

export interface HealthResponse {
  status: string;
  llm_provider: string;
  llm_model: string;
  stt_provider: string;
  stt_model?: string | null;
  tts_provider?: string;
  tts_model?: string | null;
  tts_accent_preference?: string;
}

export interface ServiceStatusResponse {
  llm: ServiceHealthState;
  stt: ServiceHealthState;
  retry_at: string | null;
}

export interface SttResponse {
  text: string;
  source: TurnSource;
  language: string | null;
  model?: string | null;
}

export interface DomainErrorPayload {
  code: string;
  message: string;
}

// ---------------------------------------------------------------------------
// WebSocket events (Server -> Client)
// ---------------------------------------------------------------------------

export interface WsWelcomeData {
  you: Participant | null;
  state: RoomSnapshot;
}

export interface WsParticipantsData {
  participants: Participant[];
}

export interface WsGdStartedData {
  topic: string;
  started_at: string;
  ends_at: string;
  duration_seconds: number;
  turn_limit_seconds: number | null;
  participants: Participant[];
  leaderboard?: LeaderboardRow[];
}

export interface WsQueueData {
  queue: QueueItem[];
}

export interface WsSpeakerChangedData {
  speaker: Speaker | null;
}

export interface WsTurnSkippedData {
  participant_id: number;
  name: string;
  seq: number;
  reason: SkipReason;
}

export interface WsTurnScoredData {
  turn_id: number;
  seq: number;
  participant_id: number;
  name: string;
  scores: ScoreBreakdown | null;
  comment: string | null;
  turn_score: number | null;
  score_status?: TurnScoreStatus;
  score_reason?: string | null;
}

export interface WsScoreAdjustedData {
  participant_id: number;
  name: string;
  delta: number;
  reason: string | null;
  by: {
    participant_id: number;
    name: string;
  };
  created_at: string;
}

export interface WsLeaderboardData {
  leaderboard: LeaderboardRow[];
}

export interface WsGdEndedData {
  reason: EndReason;
  ended_at: string;
  elapsed_seconds: number;
  leaderboard: LeaderboardRow[];
}

export interface WsReportReadyData {
  report: FinalReport;
}

export interface WsReportFailedData {
  message: string;
}

export interface WsErrorData {
  code: string;
  message: string;
  request_type?: string | null;
  request_id?: string | null;
}

export interface WsPongData {
  request_id: string | null;
}

export type ServerEvent =
  | { type: "welcome"; data: WsWelcomeData; ts: string }
  | { type: "state"; data: RoomSnapshot; ts: string }
  | { type: "pong"; data: WsPongData; ts: string }
  | { type: "participants"; data: WsParticipantsData; ts: string }
  | { type: "gd_started"; data: WsGdStartedData; ts: string }
  | { type: "timer"; data: TimerState; ts: string }
  | { type: "queue"; data: WsQueueData; ts: string }
  | { type: "speaker_changed"; data: WsSpeakerChangedData; ts: string }
  | { type: "transcript_entry"; data: TranscriptEntry; ts: string }
  | { type: "turn_skipped"; data: WsTurnSkippedData; ts: string }
  | { type: "turn_scored"; data: WsTurnScoredData; ts: string }
  | { type: "score_adjusted"; data: WsScoreAdjustedData; ts: string }
  | { type: "leaderboard"; data: WsLeaderboardData; ts: string }
  | { type: "gd_ended"; data: WsGdEndedData; ts: string }
  | { type: "report_ready"; data: WsReportReadyData; ts: string }
  | { type: "report_failed"; data: WsReportFailedData; ts: string }
  | { type: "service_status"; data: WsServiceStatusData; ts: string }
  | { type: "error"; data: WsErrorData; ts: string };

// ---------------------------------------------------------------------------
// Activity feed (lightweight client-side log for skipped turns & adjustments)
// ---------------------------------------------------------------------------

export interface ActivityNotice {
  id: string;
  kind: "turn_skipped" | "score_adjusted";
  message: string;
  ts: string;
}

export interface StoredSession {
  roomCode: string;
  participantId: number;
  name: string;
  role: Role;
  token: string;
}

