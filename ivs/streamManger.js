// StreamManager.js
import crypto from "crypto";
import ScyllaDb from "./ScyllaDb.js";
import Redis from "ioredis";
import IVSService from "./IVSService.js";
import logEvent from "../utils/logEvent.js";
import logError from "../utils/logError.js";

const redis = process.env.REDIS_URL ? new Redis(process.env.REDIS_URL) : null;

const STREAMS_TABLE = "IVSStreams";
const CHANNELS_TABLE = "IVSChannels";
const STATS_TABLE = "IVSStats";

export default class StreamManager {
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
}
