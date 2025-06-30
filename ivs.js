import crypto from "crypto";
import ScyllaDb from "./ScyllaDb.js";
import Redis from "ioredis";

const redis = process.env.REDIS_URL ? new Redis(process.env.REDIS_URL) : null;

const STREAMS_TABLE = "IVSStreams";
const JOIN_LOGS_TABLE = "IVSJoinLogs";
const STATS_TABLE = "IVSStats";
const CHANNELS_TABLE = "IVSChannels";

function logEvent(event, data = {}) {
  console.log(
    `[${new Date().toISOString()}] EVENT: ${event}`,
    JSON.stringify(data)
  );
}

function logError(error, context = {}) {
  console.error(`[${new Date().toISOString()}] ERROR: ${error.message}`, {
    stack: error.stack,
    ...context,
  });
}

export default class IVS {
  // Create new stream session
  static async createStream({
    creator_user_id,
    channel_id,
    title,
    access_type,
    is_private = false,
    pricing_type = "free",
    description = "",
    tags = [],
    allow_comments = true,
    collaborators = [],
  }) {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const item = {
      id,
      channel_id,
      creator_user_id,
      title,
      description,
      access_type,
      is_private,
      pricing_type,
      allow_comments,
      collaborators,
      tags,
      goals: [],
      games: [],
      gifts: [],
      tips: [],
      multi_cam_urls: [],
      announcements: [],
      status: "offline",
      created_at: now,
      updated_at: now,
    };

    await ScyllaDb.insert(STREAMS_TABLE, item);
    logEvent("createStream", { stream_id: id });

    return item;
  }

  static async getChannelMeta(channel_id) {
    return await ScyllaDb.get(CHANNELS_TABLE, channel_id);
  }

  static async updateChannel(channel_id, updates) {
    updates.updated_at = new Date().toISOString();
    return await ScyllaDb.update(CHANNELS_TABLE, channel_id, updates);
  }

  static async listChannelStreams(channel_id) {
    return await ScyllaDb.query(STREAMS_TABLE, { channel_id });
  }

  static async updateStream(stream_id, updates) {
    updates.updated_at = new Date().toISOString();
    await ScyllaDb.update(STREAMS_TABLE, stream_id, updates);
    logEvent("updateStream", { stream_id, updates });
  }

  static async joinStream(stream_id, user_id, role = "viewer") {
    const entry = {
      id: crypto.randomUUID(),
      stream_id,
      user_id,
      joined_at: new Date().toISOString(),
      role,
    };
    await ScyllaDb.insert(JOIN_LOGS_TABLE, entry);
    await redis.sadd(`stream:${stream_id}:active`, user_id);
    logEvent("joinStream", entry);
  }

  static async leaveStream(stream_id, user_id) {
    await redis.srem(`stream:${stream_id}:active`, user_id);
    await ScyllaDb.updateWhere(
      JOIN_LOGS_TABLE,
      { stream_id, user_id },
      { left_at: new Date().toISOString() }
    );
    logEvent("leaveStream", { stream_id, user_id });
  }

  static async incrementLike(stream_id) {
    await ScyllaDb.increment(STATS_TABLE, stream_id, "likes");
  }

  static async registerTip(
    stream_id,
    user_id,
    amount,
    message = "",
    gift_id = null
  ) {
    const stream = await ScyllaDb.get(STREAMS_TABLE, stream_id);
    const newTip = {
      user_id,
      amount,
      message,
      gift_id,
      timestamp: new Date().toISOString(),
    };
    stream.tips.push(newTip);
    await ScyllaDb.update(STREAMS_TABLE, stream_id, { tips: stream.tips });

    // update stats
    await ScyllaDb.increment(STATS_TABLE, stream_id, "tips_total", amount);
    await this.updateTipBoard(stream_id, user_id, amount);
    logEvent("registerTip", { stream_id, user_id, amount });
  }

  static async updateTipBoard(stream_id, user_id, amount) {
    const stats = await ScyllaDb.get(STATS_TABLE, stream_id);
    stats.tip_board = stats.tip_board || [];
    const user = stats.tip_board.find((x) => x.user_id === user_id);
    if (user) user.total += amount;
    else stats.tip_board.push({ user_id, total: amount });
    stats.highest_tipper = stats.tip_board.sort(
      (a, b) => b.total - a.total
    )[0]?.user_id;
    await ScyllaDb.update(STATS_TABLE, stream_id, stats);
  }

  static async getTipLeaderboard(stream_id) {
    const stats = await ScyllaDb.get(STATS_TABLE, stream_id);
    return (stats.tip_board || []).sort((a, b) => b.total - a.total);
  }

  static async setGoalProgress(stream_id, goalId, amount) {
    const stream = await ScyllaDb.get(STREAMS_TABLE, stream_id);
    stream.goals = stream.goals.map((goal) =>
      goal.id === goalId
        ? { ...goal, progress: amount, achieved: amount >= goal.target }
        : goal
    );
    await ScyllaDb.update(STREAMS_TABLE, stream_id, { goals: stream.goals });
  }

  static async addAnnouncement(stream_id, title, body) {
    const stream = await ScyllaDb.get(STREAMS_TABLE, stream_id);
    stream.announcements.push({
      title,
      body,
      timestamp: new Date().toISOString(),
    });
    await ScyllaDb.update(STREAMS_TABLE, stream_id, {
      announcements: stream.announcements,
    });
  }

  static async validateUserAccess(stream_id, user_id) {
    const stream = await ScyllaDb.get(STREAMS_TABLE, stream_id);
    if (stream.access_type.includes("open")) return true;
    // otherwise check invite list, token unlock, subscription
    return false; // TODO: implement logic
  }

  static async logToyAction(stream_id, toyData) {
    const stats = await ScyllaDb.get(STATS_TABLE, stream_id);
    stats.toys_log = stats.toys_log || [];
    stats.toys_log.push({ ...toyData, timestamp: new Date().toISOString() });
    await ScyllaDb.update(STATS_TABLE, stream_id, { toys_log: stats.toys_log });
  }

  static async getStats(stream_id) {
    return await ScyllaDb.get(STATS_TABLE, stream_id);
  }

  static async getSessionType(stream_id) {
    const stream = await ScyllaDb.get(STREAMS_TABLE, stream_id);
    return stream.access_type;
  }

  static async getActiveStreams() {
    const streamIds = await redis.smembers("active_streams");
    return Promise.all(streamIds.map((id) => ScyllaDb.get(STREAMS_TABLE, id)));
  }

  static async setTrailer(stream_id, trailer_url) {
    await ScyllaDb.update(STREAMS_TABLE, stream_id, { trailer_url });
  }

  static async setThumbnail(stream_id, thumbnail_url) {
    await ScyllaDb.update(STREAMS_TABLE, stream_id, { thumbnail_url });
  }

  static async addCollaborator(stream_id, user_id) {
    const stream = await ScyllaDb.get(STREAMS_TABLE, stream_id);
    if (!stream.collaborators.includes(user_id)) {
      stream.collaborators.push(user_id);
      await ScyllaDb.update(STREAMS_TABLE, stream_id, {
        collaborators: stream.collaborators,
      });
    }
  }

  static async listCollaborators(stream_id) {
    const stream = await ScyllaDb.get(STREAMS_TABLE, stream_id);
    return stream.collaborators || [];
  }
}
