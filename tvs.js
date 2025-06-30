✅ IVS.js — Full Node.js Implementation
js
Copy
Edit
import crypto from 'crypto';
import ScyllaDb from './ScyllaDb.js';
import Redis from 'ioredis';

const redis = process.env.REDIS_URL ? new Redis(process.env.REDIS_URL) : null;

const STREAMS_TABLE = 'IVSStreams';
const JOIN_LOGS_TABLE = 'IVSJoinLogs';
const STATS_TABLE = 'IVSStats';
const CHANNELS_TABLE = 'IVSChannels';

function logEvent(event, data = {}) {
  console.log(`[${new Date().toISOString()}] EVENT: ${event}`, JSON.stringify(data));
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
    pricing_type = 'free',
    description = '',
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
      status: 'offline',
      created_at: now,
      updated_at: now,
    };

    await ScyllaDb.insert(STREAMS_TABLE, item);
    logEvent('createStream', { stream_id: id });

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
    logEvent('updateStream', { stream_id, updates });
  }

  static async joinStream(stream_id, user_id, role = 'viewer') {
    const entry = {
      id: crypto.randomUUID(),
      stream_id,
      user_id,
      joined_at: new Date().toISOString(),
      role,
    };
    await ScyllaDb.insert(JOIN_LOGS_TABLE, entry);
    await redis.sadd(`stream:${stream_id}:active`, user_id);
    logEvent('joinStream', entry);
  }

  static async leaveStream(stream_id, user_id) {
    await redis.srem(`stream:${stream_id}:active`, user_id);
    await ScyllaDb.updateWhere(JOIN_LOGS_TABLE, { stream_id, user_id }, { left_at: new Date().toISOString() });
    logEvent('leaveStream', { stream_id, user_id });
  }

  static async incrementLike(stream_id) {
    await ScyllaDb.increment(STATS_TABLE, stream_id, 'likes');
  }

  static async registerTip(stream_id, user_id, amount, message = '', gift_id = null) {
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
    await ScyllaDb.increment(STATS_TABLE, stream_id, 'tips_total', amount);
    await this.updateTipBoard(stream_id, user_id, amount);
    logEvent('registerTip', { stream_id, user_id, amount });
  }

  static async updateTipBoard(stream_id, user_id, amount) {
    const stats = await ScyllaDb.get(STATS_TABLE, stream_id);
    stats.tip_board = stats.tip_board || [];
    const user = stats.tip_board.find(x => x.user_id === user_id);
    if (user) user.total += amount;
    else stats.tip_board.push({ user_id, total: amount });
    stats.highest_tipper = stats.tip_board.sort((a, b) => b.total - a.total)[0]?.user_id;
    await ScyllaDb.update(STATS_TABLE, stream_id, stats);
  }

  static async getTipLeaderboard(stream_id) {
    const stats = await ScyllaDb.get(STATS_TABLE, stream_id);
    return (stats.tip_board || []).sort((a, b) => b.total - a.total);
  }

  static async setGoalProgress(stream_id, goalId, amount) {
    const stream = await ScyllaDb.get(STREAMS_TABLE, stream_id);
    stream.goals = stream.goals.map(goal =>
      goal.id === goalId ? { ...goal, progress: amount, achieved: amount >= goal.target } : goal
    );
    await ScyllaDb.update(STREAMS_TABLE, stream_id, { goals: stream.goals });
  }

  static async addAnnouncement(stream_id, title, body) {
    const stream = await ScyllaDb.get(STREAMS_TABLE, stream_id);
    stream.announcements.push({ title, body, timestamp: new Date().toISOString() });
    await ScyllaDb.update(STREAMS_TABLE, stream_id, { announcements: stream.announcements });
  }

  static async validateUserAccess(stream_id, user_id) {
    const stream = await ScyllaDb.get(STREAMS_TABLE, stream_id);
    if (stream.access_type.includes('open')) return true;
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
    const streamIds = await redis.smembers('active_streams');
    return Promise.all(streamIds.map(id => ScyllaDb.get(STREAMS_TABLE, id)));
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
      await ScyllaDb.update(STREAMS_TABLE, stream_id, { collaborators: stream.collaborators });
    }
  }

  static async listCollaborators(stream_id) {
    const stream = await ScyllaDb.get(STREAMS_TABLE, stream_id);
    return stream.collaborators || [];
  }
}
✅ Frontend Feature Summary
Core Panels:

Stream preview: thumbnail, trailer, and live feed

Creator dashboard: stream config, tips/goals, toy feedback, multi-cam

Viewer interaction: tip menu, tipboard, polls, games, emojis, VOD, reactions

Private viewer fallback (if no access)

Join notifications (batched by second)

Live translation (if enabled)

Announcements and event banners

Stream status indicators (live/offline/coming soon)

Viewer Metrics + Analytics:

Leaderboards: top tippers

Toy analytics

Session reach (views, duration, likes)

Content Gating:

PPV, SVOD, token unlock

DRM/Watermarking hooks placeholder

Let me know if you'd like:

API route mapping (Express.js)

Redis keys list

Cron job logic for cleanup/sync

Or anything else added/implemented next. 


✅ 1. IVSStreams
sql
Copy
Edit
CREATE TABLE "IVSStreams" (
  id UUID PRIMARY KEY,
  channel_id UUID NOT NULL,
  creator_user_id UUID NOT NULL,
  title TEXT NOT NULL,
  description TEXT DEFAULT '',
  thumbnail_url TEXT,
  trailer_url TEXT,
  access_type TEXT CHECK (access_type IN ('open_free', 'open_paid', 'invite_free', 'invite_paid')) NOT NULL,
  pricing_type TEXT CHECK (pricing_type IN ('ppv', 'svod', 'token_unlock', 'free')) DEFAULT 'free',
  is_private BOOLEAN DEFAULT FALSE,
  status TEXT CHECK (status IN ('offline', 'live', 'coming_soon')) DEFAULT 'offline',
  start_time TIMESTAMP,
  end_time TIMESTAMP,
  vod_url TEXT,
  linked_stream_id UUID,
  allow_comments BOOLEAN DEFAULT TRUE,
  goals JSONB DEFAULT '[]'::jsonb,
  games JSONB DEFAULT '[]'::jsonb,
  gifts JSONB DEFAULT '[]'::jsonb,
  tips JSONB DEFAULT '[]'::jsonb,
  collaborators UUID[] DEFAULT '{}',
  tags TEXT[] DEFAULT '{}',
  multi_cam_urls TEXT[] DEFAULT '{}',
  announcements JSONB DEFAULT '[]'::jsonb,
  stream_key TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
✅ 2. IVSJoinLogs
sql
Copy
Edit
CREATE TABLE "IVSJoinLogs" (
  id UUID PRIMARY KEY,
  stream_id UUID NOT NULL REFERENCES "IVSStreams"(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  role TEXT CHECK (role IN ('viewer', 'collaborator', 'moderator', 'owner')) DEFAULT 'viewer',
  joined_at TIMESTAMP NOT NULL,
  left_at TIMESTAMP
);
✅ 3. IVSStats
sql
Copy
Edit
CREATE TABLE "IVSStats" (
  stream_id UUID PRIMARY KEY REFERENCES "IVSStreams"(id) ON DELETE CASCADE,
  likes INTEGER DEFAULT 0,
  views INTEGER DEFAULT 0,
  watch_duration INTEGER DEFAULT 0,
  join_count INTEGER DEFAULT 0,
  leave_count INTEGER DEFAULT 0,
  concurrent_max INTEGER DEFAULT 0,
  toys_log JSONB DEFAULT '[]'::jsonb,
  tip_board JSONB DEFAULT '[]'::jsonb,
  highest_tipper UUID,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
✅ 4. Channels (Model owns 1 channel)
sql
Copy
Edit
CREATE TABLE "Channels" (
  id UUID PRIMARY KEY, -- same as creator_user_id
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  profile_thumbnail TEXT,
  tags TEXT[] DEFAULT '{}',
  language TEXT,
  category TEXT,
  followers INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
✅ Indexes (Performance & Search)
sql
Copy
Edit
CREATE INDEX idx_stream_channel ON "IVSStreams"(channel_id);
CREATE INDEX idx_stream_status ON "IVSStreams"(status);
CREATE INDEX idx_joinlogs_stream ON "IVSJoinLogs"(stream_id);
CREATE INDEX idx_stats_stream ON "IVSStats"(stream_id);
CREATE INDEX idx_stream_tags ON "IVSStreams" USING GIN (tags);
CREATE INDEX idx_stream_goals ON "IVSStreams" USING GIN (goals);




UOPDATES
✅ Updated createStream() (with shared IVS client)
js
Copy
Edit
import crypto from 'crypto';
import ScyllaDb from './ScyllaDb.js';
import Redis from 'ioredis';
import getIvsClient from './aws/ivsClient.js';
import {
  CreateChannelCommand,
  CreateStreamKeyCommand
} from '@aws-sdk/client-ivs';

const redis = process.env.REDIS_URL ? new Redis(process.env.REDIS_URL) : null;

const STREAMS_TABLE = 'IVSStreams';
const CHANNELS_TABLE = 'IVSChannels';

function logEvent(event, data = {}) {
  console.log(`[${new Date().toISOString()}] EVENT: ${event}`, JSON.stringify(data));
}

function logError(error, context = {}) {
  console.error(`[${new Date().toISOString()}] ERROR: ${error.message}`, {
    stack: error.stack,
    ...context,
  });
}

export default class IVS {
  static async createStream({
    creator_user_id,
    title,
    access_type,
    is_private = false,
    pricing_type = 'free',
    description = '',
    tags = [],
    allow_comments = true,
    collaborators = [],
  }) {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    let awsChannel, streamKey;

    try {
      const ivsClient = getIvsClient();

      const channelRes = await ivsClient.send(new CreateChannelCommand({
        name: `channel-${creator_user_id}-${Date.now()}`,
        latencyMode: 'LOW',
        type: 'STANDARD',
      }));
      awsChannel = channelRes.channel;

      const keyRes = await ivsClient.send(new CreateStreamKeyCommand({
        channelArn: awsChannel.arn,
      }));
      streamKey = keyRes.streamKey;

      await ScyllaDb.insert(CHANNELS_TABLE, {
        id: creator_user_id,
        name: awsChannel.name,
        description,
        profile_thumbnail: '',
        tags,
        language: '',
        category: '',
        followers: 0,
        aws_channel_arn: awsChannel.arn,
        playback_url: awsChannel.playbackUrl,
        created_at: now,
        updated_at: now,
      });

    } catch (err) {
      logError(err, { creator_user_id });
      throw new Error('Failed to create IVS channel or stream key');
    }

    const item = {
      id,
      channel_id: awsChannel.arn,
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
      status: 'offline',
      created_at: now,
      updated_at: now,
      stream_key: streamKey.value,
    };

    await ScyllaDb.insert(STREAMS_TABLE, item);
    logEvent('createStream', { stream_id: id, creator_user_id });

    return {
      ...item,
      ingest_endpoint: awsChannel.ingestEndpoint,
      playback_url: awsChannel.playbackUrl,
    };
  }
}
✅ Shared Helper: aws/ivsClient.js
js
Copy
Edit
// aws/ivsClient.js
import { IVSClient } from '@aws-sdk/client-ivs';

let cachedClient = null;

export default function getIvsClient() {
  if (cachedClient) return cachedClient;

  cachedClient = new IVSClient({
    region: process.env.AWS_REGION || 'us-west-2',
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    },
  });

  return cachedClient;
}
Let me k




✅ Add These AWS Commands First (top of IVS.js)
js
Copy
Edit
import {
  CreateChannelCommand,
  CreateStreamKeyCommand,
  DeleteChannelCommand,
  ListChannelsCommand,
  GetChannelCommand,
} from '@aws-sdk/client-ivs';
✅ deleteChannel(channelArn)
js
Copy
Edit
static async deleteChannel(channelArn) {
  try {
    const ivsClient = getIvsClient();
    await ivsClient.send(new DeleteChannelCommand({ arn: channelArn }));
    logEvent('deleteChannel', { channelArn });
    return true;
  } catch (err) {
    logError(err, { channelArn });
    return false;
  }
}
✅ listAllChannels()
js
Copy
Edit
static async listAllChannels() {
  const ivsClient = getIvsClient();
  let nextToken = null;
  const allChannels = [];

  try {
    do {
      const res = await ivsClient.send(new ListChannelsCommand({
        nextToken,
        maxResults: 100,
      }));
      allChannels.push(...res.channels);
      nextToken = res.nextToken;
    } while (nextToken);
    return allChannels;
  } catch (err) {
    logError(err);
    return [];
  }
}
✅ countAllChannels()
js
Copy
Edit
static async countAllChannels() {
  const channels = await this.listAllChannels();
  return channels.length;
}
✅ channelExists(channelArn)
js
Copy
Edit
static async channelExists(channelArn) {
  try {
    const ivsClient = getIvsClient();
    await ivsClient.send(new GetChannelCommand({ arn: channelArn }));
    return true;
  } catch (err) {
    if (err.name === 'ResourceNotFoundException') return false;
    logError(err, { channelArn });
    return false;
  }
}
✅ validateChannel(channelArn)
Optionally include logic to verify that the channel matches certain expected properties (like latency mode or type).

js
Copy
Edit
static async validateChannel(channelArn) {
  try {
    const ivsClient = getIvsClient();
    const res = await ivsClient.send(new GetChannelCommand({ arn: channelArn }));
    const channel = res.channel;

    // Example check
    if (!channel || !channel.playbackUrl || !channel.ingestEndpoint) {
      return { valid: false, reason: 'Missing playback or ingest info' };
    }

    return { valid: true, channel };
  } catch (err) {
    if (err.name === 'ResourceNotFoundException') {
      return { valid: false, reason: 'Channel does not exist' };
    }
    logError(err, { channelArn });
    return { valid: false, reason: 'Unexpected error' };
  }
}
🧠 Notes
AWS limits IVS channels to 500 per region per account — countAllChannels() helps track that.

You may want to implement a pre-check in createStream() to block new channels if nearing limit.

Redis caching can be added to avoid repeated calls to ListChannelsCommand.

Let me know if you want a rate-limiter or Redis TTL cache added to channel count checks.







